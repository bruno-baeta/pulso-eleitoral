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
import { mkdtemp, rm } from 'node:fs/promises';
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
  const servico = new MunicipalService(transporte, hooks(extra), dir);
  return { servico, transporte, dir, fechar: async () => { transporte.close(); await rm(dir, { recursive: true, force: true }); } };
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

/** Pede até o job ficar pronto, ou desistir. Devolve o último payload. */
async function ateFechar(s: MunicipalService, mode: Mode, uf: string, turn: Turn, office: Office, voltas = 60) {
  let ultimo = await s.get(mode, uf, turn, office);
  for (let i = 0; i < voltas; i++) {
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
    await manterAberto(s, 'simulado', 'MG', 1, 'governor', 4500);

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

    await manterAberto(s, 'simulado', 'MG', 1, 'governor', 4500);
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
    const payload = await ateFechar(s, 'simulado', 'MG', 1, 'governor', 150);

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
    const antes = new MunicipalService(primeiro, hooks(), dir);
    const cheio = await ateFechar(antes, 'simulado', 'MG', 1, 'governor');
    assert.equal(cidades(cheio), 11);
    await antes.encerrar();
  } finally { primeiro.close(); }

  // Processo novo: memória zerada, e um TSE que recusa tudo. O que aparecer veio do disco.
  const mudo = new TseFalso();
  const segundo = new TseTransport(500, mudo.fetch);
  try {
    const depois = new MunicipalService(segundo, hooks({ allowed: () => false }), dir);
    const relido = await depois.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(relido), 11, 'as cidades voltaram do disco');
    assert.equal(mudo.pedidos.size, 0, 'e voltaram sem pedir nada ao TSE');
  } finally { segundo.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a gravação de uma sessão do simulado não ressuscita na sessão seguinte', async () => {
  const tse = tseComMinas(7);
  const dir = await mkdtemp(join(tmpdir(), 'pulso-mun-'));
  const t1 = new TseTransport(500, tse.fetch);
  try {
    const antes = new MunicipalService(t1, hooks({ session: () => '2026-09-23-09h' }), dir);
    assert.equal(cidades(await ateFechar(antes, 'simulado', 'MG', 1, 'governor')), 7);
    await antes.encerrar();
  } finally { t1.close(); }

  const mudo = new TseFalso();
  const t2 = new TseTransport(500, mudo.fetch);
  try {
    const outra = new MunicipalService(t2, hooks({ session: () => '2026-09-23-14h', allowed: () => false }), dir);
    const relido = await outra.get('simulado', 'MG', 1, 'governor');
    assert.equal(cidades(relido), 0, 'a sessão da tarde não herda os números da manhã');
  } finally { t2.close(); await rm(dir, { recursive: true, force: true }); }
});
