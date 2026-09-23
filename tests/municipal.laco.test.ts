/**
 * O laço da varredura municipal, exercitado inteiro contra um TSE de mentira.
 *
 * Cada teste aqui corresponde a um defeito que chegou à tela em 23/09/2026 e custou horas para ser
 * achado — todos no laço ao longo do tempo, nenhum visível em teste de função pura. Esta é a rede
 * que faltava: `MunicipalService` já recebia transporte e hooks por construtor, e nenhum teste
 * usava essa costura.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MunicipalService, type MunicipalHooks, type MunicipalPayload } from '../server/municipal.ts';
import { TseTransport } from '../server/transport.ts';
import type { ElectionRef } from '../server/tse.ts';
import type { Mode, Office, Turn } from '../shared/types.ts';
import { TseFalso, andamento, configMunicipal, relogioFalso, resultadoMunicipal, respirar } from './helpers/tseFalso.ts';

const ELEICAO = '21272';
const BASE = `https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/${ELEICAO}`;
const ref: ElectionRef = { code: ELEICAO, cycle: 'ele2026', turn: 1, offices: [3, 5, 6, 7], ufs: ['BR'] };

function hooks(extra: Partial<MunicipalHooks> = {}): MunicipalHooks {
  return {
    election: () => ref,
    allowed: () => true,
    race: () => undefined,
    touch: () => {},
    live: () => [],
    session: () => 'sessao-de-teste',
    ...extra,
  };
}

/** Um TSE com `quantos` municípios em Minas, todos com resultado publicado. */
function tseComMinas(quantos: number, opcoes: { encerradas?: boolean; cargos?: number[] } = {}) {
  const tse = new TseFalso();
  tse.em('/config/mun-', { corpo: configMunicipal({ MG: quantos }) });
  for (const cargo of opcoes.cargos ?? [3]) {
    tse.em(`-e0${ELEICAO}-ab.json`, { corpo: andamento(ELEICAO, 'mg', quantos, { encerradas: opcoes.encerradas }) });
    const alvo = `-c${String(cargo).padStart(4, '0')}-e0${ELEICAO}-u.json`;
    tse.em(alvo, url => {
      const cd = /mg(\d+)-c/.exec(url)?.[1] ?? '0';
      return { corpo: resultadoMunicipal(ELEICAO, cd, cargo, [['83', 100], ['89', 50]]) };
    });
  }
  return tse;
}

async function servico(tse: TseFalso, extra: Partial<MunicipalHooks> = {}, relogio?: () => number) {
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const transporte = new TseTransport(500, tse.fetch, relogio);
  const servico = new MunicipalService(transporte, hooks(extra), dir, 0.01);
  // Encerrar antes de apagar: o serviço grava os instantes em disco, e apagar a pasta debaixo de
  // uma escrita em curso derrubava testes com ENOTEMPTY, sem nada a ver com o que eles verificam.
  return { servico, transporte, dir, fechar: async () => { await servico.encerrar(); transporte.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}

const cidades = (p: MunicipalPayload | { unchanged: true }) => 'm' in p ? p.m.length : 0;

/**
 * Mantém o job vivo por um tempo, pedindo como uma tela pediria.
 *
 * O laço dorme três segundos quando não há nada sujo, então testar "não pediu de novo" ou "releu o
 * andamento" exige atravessar esse sono — esperar algumas centenas de milissegundos passaria sem
 * exercitar nada.
 */
async function manterAberto(s: MunicipalService, mode: Mode, uf: string, turn: Turn, office: Office, ms: number) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { await respirar(10); await s.get(mode, uf, turn, office); }
}

/**
 * Pede até o job ficar pronto, ou o prazo acabar. Devolve o último payload.
 *
 * O teto é de tempo, não de número de voltas. Contando voltas, a espera total dependia de quanto o
 * laço de eventos estava concorrido: com a suíte inteira em paralelo, sessenta voltas de trinta
 * milissegundos passavam voando e o teste acusava um defeito que não existia. Com prazo, o teste
 * fecha assim que a varredura fecha e só desiste depois de um tempo em que ela realmente deveria
 * ter fechado.
 */
async function ateFechar(s: MunicipalService, mode: Mode, uf: string, turn: Turn, office: Office, prazoMs = 20_000) {
  const limite = Date.now() + prazoMs;
  let ultimo = await s.get(mode, uf, turn, office);
  while (Date.now() < limite) {
    await respirar(6);
    ultimo = await s.get(mode, uf, turn, office);
    if ('status' in ultimo && ultimo.status === 'ready') break;
  }
  return ultimo;
}

test('a varredura ao vivo enche todas as cidades do estado', async () => {
  const { servico: s, fechar } = await servico(tseComMinas(12));
  try {
    const payload = await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    assert.equal('status' in payload ? payload.status : '', 'ready');
    assert.equal(cidades(payload), 12, 'as doze cidades chegaram');
  } finally { await fechar(); }
});

test('cidade nunca buscada entra na lista mesmo sem o andamento daquele estado', async () => {
  /*
   * O defeito: a lista de "sujas" exigia que a UF estivesse em `abSeen`, e `delta` lê o andamento
   * de dois estados por passada. Os demais nunca entravam, suas cidades nunca eram consideradas, e
   * como `delta` devolvia 'idle' a varredura completa também não rodava — a presidência parava em
   * 575 dos 5.571 e ficava ali.
   */
  const tse = tseComMinas(10);
  tse.em('-ab.json', { status: 500 });                     // o andamento não responde
  const { servico: s, fechar } = await servico(tse);
  try {
    const payload = await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    assert.equal(cidades(payload), 10, 'sem andamento, a varredura completa ainda tem de buscar tudo');
  } finally { await fechar(); }
});

test('estado que responde 304 no andamento continua sendo varrido', async () => {
  /*
   * O defeito: no 304 o código pulava sem marcar a UF como vista, então na segunda passada ela saía
   * de `abSeen` e as cidades dela paravam de ser consideradas.
   *
   * O andamento tem intervalo próprio (8 s), então uma segunda leitura só acontece depois disso —
   * daí o relógio falso, que o transporte aceita no construtor. Sem ele o teste passaria sem nunca
   * exercitar o 304, que é justamente o caso do defeito.
   */
  const tse = tseComMinas(8);
  tse.em('-ab.json', { corpo: andamento(ELEICAO, 'mg', 8), etag: 'W/"ab"' });
  const relogio = relogioFalso();
  const { servico: s, fechar } = await servico(tse, {}, relogio.agora);
  try {
    await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    const primeiras = tse.contar('-ab.json');

    relogio.avancar(30_000);                       // passa do intervalo do andamento
    await manterAberto(s, 'simulado', 'MG', 1, 'governor', 400);

    assert.ok(tse.contar('-ab.json') > primeiras, 'o andamento foi relido depois do intervalo');
    const payload = await s.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(payload), 8, 'e as cidades continuam lá depois do 304');
    assert.equal('status' in payload ? payload.status : '', 'ready');
  } finally { await fechar(); }
});

test('cidade encerrada pelo TSE não é pedida de novo', async () => {
  /*
   * O defeito: a varredura completa repassava por todas as cidades a cada ciclo. Com a apuração em
   * 100%, isso virava trabalho puro de 304 — 42 req/s sem nada a descobrir.
   */
  const tse = tseComMinas(10, { encerradas: true });
  const { servico: s, fechar } = await servico(tse);
  try {
    const payload = await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    assert.equal(cidades(payload), 10);
    // Só as cidades deste cargo: o transporte inteiro inclui os cargos irmãos sendo aquecidos.
    const depoisDeEncher = tse.contar('-c0003-e0');

    await manterAberto(s, 'simulado', 'MG', 1, 'governor', 400);
    const repedidas = tse.contar('-c0003-e0') - depoisDeEncher;
    assert.equal(repedidas, 0, `com tudo encerrado não se repede cidade; foram ${repedidas}`);
  } finally { await fechar(); }
});

test('uma varredura de cada vez, e é a do cargo que está na tela', async () => {
  /*
   * O defeito: cada cargo aberto virava um job, e todos varriam ao mesmo tempo dividindo a mesma
   * faixa — o total municipal era 42 req/s e o job que enchia a tela recebia 1,5 desses 42.
   */
  const tse = tseComMinas(15, { cargos: [3, 5] });
  const { servico: s, fechar } = await servico(tse);
  try {
    await s.get('simulado', 'MG', 1, 'senate');      // aquecido antes
    await respirar(4);
    await s.get('simulado', 'MG', 1, 'governor');    // este é o pedido da tela, e é o mais recente
    const payload = await ateFechar(s, 'simulado', 'MG', 1, 'governor');

    assert.equal('status' in payload ? payload.status : '', 'ready', 'o cargo da tela precisa fechar');
    assert.equal(cidades(payload), 15);

    /*
     * A serialização é cooperativa: um cargo que já estava dentro de uma varredura termina a volta
     * antes de ceder a vez — `vezDeVarrer` é consultado entre voltas, não no meio de uma. O que não
     * pode acontecer é o cargo da tela ficar sem faixa nenhuma, que era o defeito: o job que enchia
     * a tela recebia 1,5 das 42 requisições por segundo.
     */
    const semNinguemOlhando = await s.get('simulado', 'MG', 1, 'federal');
    assert.ok(cidades(semNinguemOlhando) < 15, 'cargo sem ninguém olhando não corre na frente do que está na tela');
  } finally { await fechar(); }
});

test('fora da janela do simulado, nenhuma cidade é pedida', async () => {
  const tse = tseComMinas(10);
  const { servico: s, fechar } = await servico(tse, { allowed: () => false });
  try {
    await s.get('simulado', 'MG', 1, 'governor');
    for (let i = 0; i < 8; i++) { await respirar(6); await s.get('simulado', 'MG', 1, 'governor'); }
    assert.equal(tse.contar('-u.json'), 0, 'fora da janela o TSE não é consultado');
  } finally { await fechar(); }
});

test('sem a área na configuração, a tela diz que a fonte não publica — e não fica girando', async () => {
  const tse = new TseFalso();
  tse.em('/config/mun-', { corpo: configMunicipal({ PE: 1 }) });   // Minas não está no arquivo
  const { servico: s, fechar } = await servico(tse);
  try {
    let payload = await s.get('simulado', 'MG', 1, 'governor');
    for (let i = 0; i < 10; i++) { await respirar(6); payload = await s.get('simulado', 'MG', 1, 'governor'); }
    assert.equal('status' in payload ? payload.status : '', 'unavailable');
    assert.match('message' in payload ? payload.message : '', /não publica resultado por município/);
  } finally { await fechar(); }
});

test('o corte por candidatura devolve só as cidades daquela candidatura', async () => {
  const { servico: s, fechar } = await servico(tseComMinas(9));
  try {
    await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    const recorte = await s.porCandidatura('simulado', 'MG', 1, 'governor', '83');
    assert.equal(recorte.linhas.length, 9);
    const [nome, uf, votos, validos, pos] = recorte.linhas[0];
    assert.equal(typeof nome, 'string');
    assert.equal(uf, 'MG');
    assert.equal(votos, 100);
    assert.equal(validos, 150);
    assert.equal(pos, 1, 'o 83 fez mais votos que o 89 em toda cidade');
  } finally { await fechar(); }
});

test('o que foi varrido sobrevive a um processo novo', async () => {
  /*
   * O defeito relatado: reiniciar deixava todas as tabelas de cidade vazias.
   *
   * Em 23/09/2026 `data/municipal/` tinha 47 arquivos, todos `historico-`: nenhum `simulado-` nem
   * `official-`. As duas escritas municipais do código estavam travadas em histórico, e a leitura
   * também — um job ao vivo nascia com `rows` vazio e nunca perguntava ao disco. Um restart no meio
   * de uma apuração custava rebuscar 8.983 arquivos do TSE.
   */
  const tse = tseComMinas(11);
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const primeiro = new TseTransport(500, tse.fetch);
  try {
    const antes = new MunicipalService(primeiro, hooks(), dir, 0.01);
    const cheio = await ateFechar(antes, 'simulado', 'MG', 1, 'governor');
    assert.equal(cidades(cheio), 11);
    await antes.encerrar();
  } finally { primeiro.close(); }

  // Processo novo: memória zerada, e um TSE que recusa tudo. O que aparecer veio do disco.
  const mudo = new TseFalso();
  const segundo = new TseTransport(500, mudo.fetch);
  try {
    const depois = new MunicipalService(segundo, hooks({ allowed: () => false }), dir, 0.01);
    const relido = await depois.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(relido), 11, 'as cidades voltaram do disco');
    assert.equal(mudo.pedidos.size, 0, 'e voltaram sem pedir nada ao TSE');
  } finally { segundo.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('a gravação de uma sessão do simulado não ressuscita na sessão seguinte', async () => {
  const tse = tseComMinas(7);
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const t1 = new TseTransport(500, tse.fetch);
  try {
    const antes = new MunicipalService(t1, hooks({ session: () => '2026-09-23-09h' }), dir, 0.01);
    assert.equal(cidades(await ateFechar(antes, 'simulado', 'MG', 1, 'governor')), 7);
    await antes.encerrar();
  } finally { t1.close(); }

  const mudo = new TseFalso();
  const t2 = new TseTransport(500, mudo.fetch);
  try {
    const outra = new MunicipalService(t2, hooks({ session: () => '2026-09-23-14h', allowed: () => false }), dir, 0.01);
    const relido = await outra.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(relido), 0, 'a sessão da tarde não herda os números da manhã');
  } finally { t2.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('o que veio do disco não passa por completo até a fonte confirmar', async () => {
  /*
   * A regressão: linha vinda do disco preenchia `rows`, o job passava por completo e sumia da fila
   * de varredura — então nunca mais perguntava nada e servia o retrato antigo como atual. Visto no
   * simulado de 23/09/2026 com senado e deputado federal em `fetches=0`, 853 linhas e só 12 e 74
   * cidades com voto, enquanto os cargos que varreram de verdade tinham 423 e 431.
   */
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const antes = new TseTransport(500, tseComMinas(6).fetch);
  try {
    const s = new MunicipalService(antes, hooks(), dir, 0.01);
    assert.equal(cidades(await ateFechar(s, 'simulado', 'MG', 1, 'governor')), 6);
    await s.encerrar();
  } finally { antes.close(); }

  /*
   * Processo novo. A fonte avançou: o andamento traz uma hora nova, e portanto carimbos novos.
   *
   * A confirmação que importa é o andamento, não rebuscar as 853 cidades: com os carimbos vindo do
   * disco, cidade cujo carimbo não mudou não precisa ser pedida de novo — é isso que faz o restart
   * retomar em vez de recomeçar. O que não pode, e é o que este teste guarda, é o job se declarar
   * pronto servindo o retrato do disco sem ter falado com o TSE.
   */
  const tse = tseComMinas(6);
  tse.em(`-e0${ELEICAO}-ab.json`, { corpo: andamento(ELEICAO, 'mg', 6, { hora: '11:30:00' }) });
  const depois = new TseTransport(500, tse.fetch);
  try {
    const s = new MunicipalService(depois, hooks(), dir, 0.01);
    const primeiro = await s.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(primeiro), 6, 'o disco entrega as linhas na hora');
    assert.notEqual('status' in primeiro ? primeiro.status : '', 'ready',
      'mas não pode se declarar pronto antes de a fonte confirmar');

    await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    assert.ok(tse.contar('-ab.json') > 0, 'o job foi mesmo falar com a fonte, e não ficou no disco');
    assert.ok(tse.contar('-c0003-e0') > 0, 'e com carimbo novo as cidades foram rebuscadas');
  } finally { depois.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('restart não rebusca cidade cujo carimbo não mudou', async () => {
  /*
   * O outro lado da mesma moeda: `fetched` e os carimbos não sobreviviam ao processo, então toda
   * cidade nascia suja e reiniciar custava rebuscar tudo — 8.983 arquivos no simulado de
   * 23/09/2026. Com os dois no disco, o TSE só é consultado sobre o que o próprio TSE diz ter
   * mudado.
   */
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const primeiroTse = tseComTotais(6);
  const antes = new TseTransport(500, primeiroTse.fetch);
  try {
    const s = new MunicipalService(antes, hooks(), dir, 0.01);
    assert.equal(cidades(await ateFechar(s, 'simulado', 'MG', 1, 'governor')), 6);
    await s.encerrar();
  } finally { antes.close(); }

  // Mesmo TSE, mesma hora no andamento: nada mudou desde o desligamento.
  const tse = tseComTotais(6);
  const depois = new TseTransport(500, tse.fetch);
  try {
    const s = new MunicipalService(depois, hooks(), dir, 0.01);
    await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    assert.equal(tse.contar('-c0003-e0'), 0, 'nenhum arquivo de cidade foi pedido de novo');
    assert.ok(tse.contar('-ab.json') > 0, 'mas o andamento foi lido, que é onde a mudança apareceria');
  } finally { depois.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

/** Um TSE de Minas cujas cidades publicam o bloco de totais junto dos votos. */
function tseComTotais(quantos: number, opcoes: { encerradas?: boolean } = {}) {
  const tse = tseComMinas(quantos, opcoes);
  tse.em(`-c0003-e0${ELEICAO}-u.json`, url => {
    const cd = /mg(\d+)-c/.exec(url)?.[1] ?? '0';
    return { corpo: resultadoMunicipal(ELEICAO, cd, 3, [['83', 100], ['89', 50]], { vb: 7, vn: 3, st: 20, ts: 20 }) };
  });
  return tse;
}

const totaisDe = (p: MunicipalPayload | { unchanged: true }) => ('totais' in p ? p.totais : null);

test('a soma não perde cidade publicada que não trouxe o bloco de totais', async () => {
  /*
   * O defeito, relatado como "os números nunca batem": `somar` pulava toda cidade sem `ts`, e o
   * buraco não aparecia em lugar nenhum. A tela dizia "126 de 817 cidades apuradas" como se fossem
   * essas as apuradas, e a apuração pelas cidades dava 87,7% contra os 94% do painel.
   *
   * Cidade publicada conta sempre. A que não trouxe os totais vira um número visível.
   */
  const { servico: s, fechar } = await servico(tseComMinas(9));  // sem bloco de totais
  try {
    const t = totaisDe(await ateFechar(s, 'simulado', 'MG', 1, 'governor'));
    assert.equal(t?.cidades, 9, 'as nove cidades publicadas entram na soma');
    assert.equal(t?.semTotais, 9, 'e as nove aparecem como cidades sem o bloco de totais');
    assert.equal(t?.nominais, 9 * 150, 'os votos válidos somam mesmo sem o resto');
  } finally { await fechar(); }
});

test('cidade encerrada lida por um parser mais velho é rebuscada', async () => {
  /*
   * O defeito que custou a simulação de 23/09/2026.
   *
   * Os totais por cidade passaram a ser lidos no meio da janela. As 691 cidades de Minas já
   * buscadas antes disso estavam encerradas (`and='f'`), e `encerrada` nunca mais pedia cidade
   * encerrada: ficaram com zero nesses campos para sempre. Nenhum carimbo do TSE muda para avisar
   * que quem mudou fomos nós — só a versão do esquema avisa.
   */
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const tse = tseComTotais(6, { encerradas: true });
  try {
    // Um arquivo gravado pelo parser velho: totais zerados e sem a sexta coluna, a da versão.
    const carimbo = '17/09/2026 10:45:45|56|f';
    const velho = {
      c: [['83', 0], ['89', 0]],
      m: Array.from({ length: 6 }, (_, i) => [`31${String(i).padStart(5, '0')}`, `CIDADE MG${i}`, 'MG', 150, [0, 100, 1, 50]]),
      t: Array.from({ length: 6 }, () => [0, 0, 0, 0, 0]),
      // Carimbos e buscas também voltam do disco — sem isso toda cidade nasceria suja e o
      // congelamento não aconteceria nem com o defeito presente, que era o que este teste deixava
      // passar na primeira versão.
      k: Array.from({ length: 6 }, (_, i) => [`MG${40000 + i}`, carimbo, '10:45:45', 56, 1]),
      b: Array.from({ length: 6 }, (_, i) => [`31${String(i).padStart(5, '0')}`, carimbo]),
    };
    await mkdir(join(dir, 'municipal', 'simulado', 'sessao-de-teste'), { recursive: true });
    await writeFile(join(dir, 'municipal', 'simulado', 'sessao-de-teste', 't1-mg-governor.json'), JSON.stringify(velho));

    const transporte = new TseTransport(500, tse.fetch);
    try {
      const s = new MunicipalService(transporte, hooks(), dir, 0.01);
      const t = totaisDe(await ateFechar(s, 'simulado', 'MG', 1, 'governor'));
      assert.equal(t?.cidades, 6);
      assert.equal(t?.semTotais, 0, 'nenhuma cidade ficou presa no esquema velho');
      assert.equal(t?.secoes, 6 * 20, 'e as seções voltaram do TSE');
      assert.equal(t?.brancos, 6 * 7);
    } finally { transporte.close(); }
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('a tabela de um instante passado vem da gravação, não do estado de agora', async () => {
  /*
   * O pedido, e o defeito que ele conserta: abrir um candidato no minuto zero da reprodução
   * devolvia "526.640 de 526.640 seções · 100,00% apurado pelas cidades" ao lado de um painel em
   * 0,0%. O resultado por município só existia como retrato de agora.
   *
   * Agora cada mudança de cidade vai para o disco com a hora, e a tabela de um instante é a soma
   * das linhas até ele.
   */
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const tse = tseComTotais(4);
  // Relógio próprio: o transporte não repede a mesma URL dentro do intervalo dela, e o teste
  // inteiro roda em menos tempo que esse intervalo. Sem adiantar o relógio, nada é rebuscado.
  const relogio = relogioFalso();
  const transporte = new TseTransport(500, tse.fetch, relogio.agora);
  try {
    const s = new MunicipalService(transporte, hooks(), dir, 0.01);
    const cedo = totaisDe(await ateFechar(s, 'simulado', 'MG', 1, 'governor'));
    assert.equal(cedo?.nominais, 4 * 150, 'a primeira leitura tem 150 votos por cidade');

    const instante = Date.now();
    await respirar(4);
    relogio.avancar(60_000);

    // A fonte anda: votos novos e carimbo novo, senão nada é rebuscado.
    tse.em(`-e0${ELEICAO}-ab.json`, { corpo: andamento(ELEICAO, 'mg', 4, { hora: '12:00:00' }) });
    tse.em(`-c0003-e0${ELEICAO}-u.json`, url => {
      const cd = /mg(\d+)-c/.exec(url)?.[1] ?? '0';
      return { corpo: resultadoMunicipal(ELEICAO, cd, 3, [['83', 900], ['89', 100]], { vb: 7, vn: 3, st: 20, ts: 20 }) };
    });
    for (let i = 0; i < 80; i++) {
      await respirar(6);
      relogio.avancar(10_000);
      const t = totaisDe(await s.get('simulado', 'MG', 1, 'governor'));
      if (t?.nominais === 4 * 1000) break;
    }
    await s.encerrar();

    const agora = totaisDe(await s.get('simulado', 'MG', 1, 'governor'));
    assert.equal(agora?.nominais, 4 * 1000, 'o ao vivo mostra os votos novos');

    const passado = totaisDe(await s.get('simulado', 'MG', 1, 'governor', undefined, instante));
    assert.equal(passado?.nominais, 4 * 150, 'e o instante gravado mostra os de antes');
    assert.equal(passado?.cidades, 4, 'com as quatro cidades que já existiam ali');
  } finally { transporte.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('um instante anterior a qualquer gravação devolve tabela vazia, não a de agora', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const transporte = new TseTransport(500, tseComTotais(4).fetch);
  try {
    const s = new MunicipalService(transporte, hooks(), dir, 0.01);
    await ateFechar(s, 'simulado', 'MG', 1, 'governor');
    await s.encerrar();
    // Antes de tudo: nenhuma cidade tinha publicado, e é isso que a tela tem de mostrar.
    const vazio = totaisDe(await s.get('simulado', 'MG', 1, 'governor', undefined, 1));
    assert.equal(vazio?.cidades, 0);
    assert.equal(vazio?.nominais, 0);
  } finally { transporte.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
