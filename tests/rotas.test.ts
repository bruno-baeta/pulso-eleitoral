/**
 * As rotas HTTP como o navegador as vê.
 *
 * `server/index.ts` monta o Fastify no topo do módulo e já chama `listen`, então importar não dá:
 * o servidor sobe como processo filho, numa porta livre, e os testes batem nele por rede.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as pedirHttp } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));

interface Candidatura { id: string; name: string; party: string; votes: number; percent: number }
interface DisputaNoFio {
  office: string; uf: string; turn: number; status: string;
  countedPercent: number; countedSections: number; validVotes: number;
  candidates: Candidatura[]; candidateCount?: number;
}
interface Snapshot {
  mode: string; uf: string; turn: number; serverAt: number;
  races: Record<string, DisputaNoFio>;
  presidentUf?: DisputaNoFio;
  connection: { status: string; message: string };
}
interface Disputa {
  office: string; uf: string; turn: number;
  countedPercent: number; seats: number; validVotes: number; candidates: Candidatura[];
}
interface Timeline { available: boolean; reason?: string; start: number; end: number; live: boolean; now: number }
interface Serie {
  candidates: { id: string; name: string; party: string; color: string }[];
  points: { at: number; counted: number; votes: number[]; shares: number[] }[];
}

let porta = 0;
let filho: ChildProcess | null = null;

const base = () => `http://127.0.0.1:${porta}`;

const portaLivre = () => new Promise<number>((resolver, rejeitar) => {
  const sonda = createServer();
  sonda.once('error', rejeitar);
  sonda.listen(0, '127.0.0.1', () => {
    const endereco = sonda.address();
    if (endereco === null || typeof endereco === 'string') { sonda.close(); rejeitar(new Error('sem porta livre')); return; }
    const { port } = endereco;
    sonda.close(() => resolver(port));
  });
});

const dormir = (ms: number) => new Promise<void>(resolver => { setTimeout(resolver, ms); });

async function pegar<T>(caminho: string): Promise<T> {
  const resposta = await fetch(`${base()}${caminho}`);
  assert.equal(resposta.status, 200, `${caminho} devia responder 200`);
  return await resposta.json() as T;
}

const status = async (caminho: string) => (await fetch(`${base()}${caminho}`)).status;

/**
 * O `fetch` do Node descomprime sozinho, o que esconderia justamente o que o teste de compressão
 * quer ver; este pedido devolve os bytes como vieram do fio.
 */
function pedirBruto(caminho: string, aceita?: string): Promise<{ status: number; cabecalhos: Record<string, string>; corpo: Buffer }> {
  return new Promise((resolver, rejeitar) => {
    const pedido = pedirHttp({
      host: '127.0.0.1', port: porta, path: caminho, method: 'GET',
      headers: aceita === undefined ? {} : { 'accept-encoding': aceita },
    }, resposta => {
      const pedacos: Buffer[] = [];
      resposta.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
      resposta.on('end', () => {
        const cabecalhos: Record<string, string> = {};
        for (const [nome, valor] of Object.entries(resposta.headers)) {
          if (typeof valor === 'string') cabecalhos[nome] = valor;
          else if (Array.isArray(valor)) cabecalhos[nome] = valor.join(', ');
        }
        resolver({ status: resposta.statusCode ?? 0, cabecalhos, corpo: Buffer.concat(pedacos) });
      });
    });
    pedido.on('error', rejeitar);
    pedido.end();
  });
}

before(async () => {
  porta = await portaLivre();
  filho = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: raiz,
    env: { ...process.env, PORT: String(porta), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  filho.once('exit', codigo => { if (codigo !== null && codigo !== 0) porta = 0; });
  const limite = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > limite) throw new Error('o servidor não respondeu em /api/health a tempo');
    try {
      const resposta = await fetch(`${base()}/api/health`);
      if (resposta.ok) { await resposta.arrayBuffer(); break; }
    } catch { /* ainda subindo */ }
    await dormir(250);
  }
}, { timeout: 120_000 });

after(async () => {
  filho?.kill('SIGTERM');
  await dormir(300);
  if (filho && filho.exitCode === null) filho.kill('SIGKILL');
});

test('a sonda de saúde diz que o serviço está de pé', async () => {
  const saude = await pegar<{ ok: boolean; service: string; time: string }>('/api/health');
  assert.equal(saude.ok, true);
  assert.equal(saude.service, 'pulso-eleitoral');
  assert.ok(Number.isFinite(Date.parse(saude.time)), 'o horário precisa ser uma data legível');
});

test('o arquivo de 2022 chega com as cinco disputas do primeiro turno', async () => {
  const snapshot = await pegar<Snapshot>('/api/snapshot?mode=historico&uf=MG&turn=1');
  assert.deepEqual(Object.keys(snapshot.races).sort(), ['federal', 'governor', 'president', 'senate', 'state']);
  assert.equal(snapshot.connection.status, 'archive');
  assert.equal(snapshot.races.governor?.uf, 'MG');
  assert.equal(snapshot.races.president?.uf, 'BR');
  assert.ok((snapshot.races.president?.candidates[0]?.votes ?? 0) > 0, 'a liderança presidencial tem votos');
});

/*
 * O corte destes campos foi deliberado — valiam um quinto do peso do snapshot e nenhuma tela os
 * desenha. Este teste existe para que nenhum deles volte por acidente.
 */
test('o snapshot não carrega os campos que nenhuma tela desenha', async () => {
  const snapshot = await pegar<Snapshot>('/api/snapshot?mode=historico&uf=MG&turn=1');
  const proibidos = ['history', 'parties', 'sourceUrl', 'receivedAt', 'totalizedAt', 'electorate',
    'turnout', 'abstention', 'totalVotes', 'blankVotes', 'nullVotes', 'totalSections'];

  const achados = new Set<string>();
  const varrer = (valor: unknown): void => {
    if (Array.isArray(valor)) { for (const item of valor) varrer(item); return; }
    if (valor === null || typeof valor !== 'object') return;
    for (const [chave, dentro] of Object.entries(valor as Record<string, unknown>)) {
      if (proibidos.includes(chave)) achados.add(chave);
      varrer(dentro);
    }
  };
  varrer(snapshot);
  assert.deepEqual([...achados], [], 'campos cortados do fio voltaram ao snapshot');

  assert.equal('states' in snapshot, false, 'o envelope não leva o andamento por estado');
  assert.equal('events' in snapshot, false, 'os eventos têm rota própria, /api/feed');
  assert.deepEqual(Object.keys(snapshot.connection).sort(), ['message', 'status']);
});

test('a rota da disputa traz a lista inteira, que o snapshot corta em 300', async () => {
  const snapshot = await pegar<Snapshot>('/api/snapshot?mode=historico&uf=MG&turn=1');
  const disputa = await pegar<Disputa>('/api/race?mode=historico&uf=MG&turn=1&office=federal');
  const noSnapshot = snapshot.races.federal;
  assert.ok(noSnapshot, 'a federal precisa estar no snapshot');
  assert.equal(noSnapshot.candidates.length, 300);
  assert.ok(disputa.candidates.length > noSnapshot.candidates.length, 'a rota da disputa traz mais candidaturas');
  assert.equal(disputa.candidates.length, noSnapshot.candidateCount, 'o snapshot anuncia quantas ficaram de fora');
  assert.equal(disputa.office, 'federal');
  assert.equal(disputa.uf, 'MG');
  assert.deepEqual(disputa.candidates.slice(0, 5).map(c => c.id), noSnapshot.candidates.slice(0, 5).map(c => c.id));
});

test('uma disputa que não foi publicada responde 404', async () => {
  // Em 2022 o segundo turno só teve presidente e governador: não há deputado federal para devolver.
  const resposta = await fetch(`${base()}/api/race?mode=historico&uf=MG&turn=2&office=federal`);
  assert.equal(resposta.status, 404);
  const erro = await resposta.json() as { error: string };
  assert.match(erro.error, /não publicada/);
});

test('querystring fora do combinado é recusada com 400', async () => {
  assert.equal(await status('/api/snapshot?mode=historico&uf=XX&turn=1'), 400, 'UF inexistente');
  assert.equal(await status('/api/snapshot?mode=historico&uf=MG&turn=3'), 400, 'só existem dois turnos');
  assert.equal(await status('/api/snapshot?mode=inventado&uf=MG&turn=1'), 400, 'fonte inexistente');
  assert.equal(await status('/api/race?mode=historico&uf=MG&turn=1&office=prefeito'), 400, 'cargo inexistente');
  assert.equal(await status('/api/race?mode=historico&uf=MG&turn=1'), 400, 'a disputa exige o cargo');
});

test('uma resposta grande volta em brotli e descomprime no mesmo JSON', async () => {
  const claro = await pedirBruto('/api/snapshot?mode=historico&uf=MG&turn=1', 'identity');
  const comprimido = await pedirBruto('/api/snapshot?mode=historico&uf=MG&turn=1', 'br');

  assert.equal(comprimido.cabecalhos['content-encoding'], 'br');
  assert.equal(comprimido.cabecalhos['vary'], 'Accept-Encoding');
  assert.ok(comprimido.corpo.length < claro.corpo.length, 'comprimido tem de ser menor que o original');
  assert.equal(Number(comprimido.cabecalhos['content-length']), comprimido.corpo.length, 'o tamanho anunciado é o do corpo comprimido');

  const devolta = JSON.parse(brotliDecompressSync(comprimido.corpo).toString()) as Snapshot;
  const original = JSON.parse(claro.corpo.toString()) as Snapshot;
  assert.deepEqual(Object.keys(devolta.races), Object.keys(original.races));
  assert.deepEqual(devolta.races.governor?.candidates, original.races.governor?.candidates);
});

test('quem só entende gzip recebe gzip', async () => {
  const resposta = await pedirBruto('/api/snapshot?mode=historico&uf=MG&turn=1', 'gzip');
  assert.equal(resposta.cabecalhos['content-encoding'], 'gzip');
  const devolta = JSON.parse(gunzipSync(resposta.corpo).toString()) as Snapshot;
  assert.equal(devolta.uf, 'MG');
});

test('uma resposta pequena não paga compressão', async () => {
  const resposta = await pedirBruto('/api/health', 'br, gzip');
  assert.equal(resposta.cabecalhos['content-encoding'], undefined);
  assert.ok(resposta.corpo.length < 1024, 'a sonda de saúde é menor que o mínimo de um kilobyte');
  assert.equal((JSON.parse(resposta.corpo.toString()) as { ok: boolean }).ok, true);
});

test('a linha do tempo de 2022 vem da totalização importada do TSE', async () => {
  const linha = await pegar<Timeline>('/api/timeline?mode=historico&uf=MG&turn=1');
  assert.equal(linha.available, true);
  assert.equal(linha.live, false, 'o arquivo não está em andamento');
  assert.ok(Number.isFinite(linha.start) && Number.isFinite(linha.end));
  assert.ok(linha.start < linha.end, 'a apuração dura mais que um instante');
  assert.ok(linha.now >= linha.end, 'o agora do servidor é posterior ao fim do arquivo');
});

test('a série presidencial traz um ponto por quadro gravado, alinhado às candidaturas', async () => {
  const serie = await pegar<Serie>('/api/series?mode=historico&uf=MG&turn=1&office=president');
  assert.ok(serie.candidates.length > 0, 'a série nomeia as candidaturas das linhas');
  assert.ok(serie.points.length > 1, 'uma linha do tempo precisa de mais de um ponto');
  for (const ponto of [serie.points[0], serie.points[serie.points.length - 1]]) {
    assert.equal(ponto.votes.length, serie.candidates.length, 'um voto por linha desenhada');
    assert.equal(ponto.shares.length, serie.candidates.length, 'uma fatia por linha desenhada');
    assert.ok(Number.isFinite(ponto.at) && Number.isFinite(ponto.counted));
  }
  const primeiro = serie.points[0], ultimo = serie.points[serie.points.length - 1];
  assert.ok(primeiro.at < ultimo.at, 'os pontos vêm em ordem de tempo');
  assert.ok(ultimo.counted > primeiro.counted, 'a apuração avança do primeiro ao último ponto');
});

test('uma disputa sem gravação devolve a série vazia em vez de erro', async () => {
  const serie = await pegar<Serie>('/api/series?mode=historico&uf=MG&turn=1&office=state');
  assert.deepEqual(serie, { candidates: [], points: [] });
});

test('toda resposta leva os cabeçalhos de segurança', async () => {
  for (const caminho of ['/api/health', '/api/snapshot?mode=historico&uf=MG&turn=1']) {
    const resposta = await pedirBruto(caminho);
    assert.equal(resposta.cabecalhos['x-content-type-options'], 'nosniff', caminho);
    assert.equal(resposta.cabecalhos['referrer-policy'], 'strict-origin-when-cross-origin', caminho);
  }
});
