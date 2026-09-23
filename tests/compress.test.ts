/**
 * A compressão sozinha, sem o coletor nem a rede.
 *
 * O gancho de `server/compress.ts` é registrado num Fastify criado aqui, com rotas de tamanho
 * escolhido, e os pedidos vão por `inject` — o que interessa é a decisão (comprimir ou não, em
 * quê, e se já estava guardado), não o transporte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { registrarCompressao, contentTag } from '../server/compress.ts';

const MINIMO = 1024;

/** Um corpo JSON válido com exatamente `bytes` bytes, para encostar no limite dos dois lados. */
function corpoDe(bytes: number, semente = 'x'): string {
  const molde = JSON.stringify({ t: '' });
  return JSON.stringify({ t: semente.repeat(bytes - molde.length) });
}

/** Ruído previsível: comprime, mas não a ponto de o custo do brotli sumir na medição. */
function corpoGrande(quantos: number): string {
  let x = 1;
  const numeros: number[] = [];
  for (let i = 0; i < quantos; i++) { x = (x * 1103515245 + 12345) % 2147483647; numeros.push(x % 100000); }
  return JSON.stringify({ numeros });
}

function montar(): FastifyInstance {
  const app = Fastify();
  registrarCompressao(app);
  const texto = (conteudo: string) => async (_pedido: unknown, resposta: { type: (t: string) => { send: (c: string) => unknown } }) =>
    resposta.type('application/json; charset=utf-8').send(conteudo);

  app.get('/api/pequena', texto(corpoDe(MINIMO - 1)));
  app.get('/api/limite', texto(corpoDe(MINIMO)));
  app.get('/api/grande', texto(corpoGrande(20_000)));
  app.get('/fora/grande', texto(corpoGrande(20_000)));
  return app;
}

test('abaixo de um kilobyte não vale comprimir', async () => {
  const app = montar();
  const resposta = await app.inject({ method: 'GET', url: '/api/pequena', headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(resposta.headers['content-encoding'], undefined);
  assert.equal(resposta.rawPayload.length, MINIMO - 1);
  await app.close();
});

test('a partir de um kilobyte a resposta já vai comprimida', async () => {
  const app = montar();
  const resposta = await app.inject({ method: 'GET', url: '/api/limite', headers: { 'accept-encoding': 'br' } });
  assert.equal(resposta.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(resposta.rawPayload).toString(), corpoDe(MINIMO));
  await app.close();
});

test('quando o navegador aceita os dois, brotli ganha do gzip', async () => {
  const app = montar();
  const original = corpoGrande(20_000);
  const ambos = await app.inject({ method: 'GET', url: '/api/grande', headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(ambos.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(ambos.rawPayload).toString(), original);

  const soGzip = await app.inject({ method: 'GET', url: '/api/grande', headers: { 'accept-encoding': 'gzip, deflate' } });
  assert.equal(soGzip.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(soGzip.rawPayload).toString(), original);
  assert.ok(ambos.rawPayload.length < original.length, 'brotli tem de encolher o corpo');
  await app.close();
});

test('quem não aceita codificação nenhuma recebe o JSON cru', async () => {
  const app = montar();
  const resposta = await app.inject({ method: 'GET', url: '/api/grande', headers: { 'accept-encoding': 'identity' } });
  assert.equal(resposta.headers['content-encoding'], undefined);
  assert.equal(resposta.rawPayload.toString(), corpoGrande(20_000));
  await app.close();
});

test('a resposta comprimida avisa que varia com o Accept-Encoding', async () => {
  const app = montar();
  const resposta = await app.inject({ method: 'GET', url: '/api/grande', headers: { 'accept-encoding': 'br' } });
  assert.equal(resposta.headers['vary'], 'Accept-Encoding');
  await app.close();
});

test('o tamanho anunciado é o do corpo comprimido, não o do original', async () => {
  const app = montar();
  const original = corpoGrande(20_000);
  const resposta = await app.inject({ method: 'GET', url: '/api/grande', headers: { 'accept-encoding': 'br' } });
  const anunciado = Number(resposta.headers['content-length']);
  assert.equal(anunciado, resposta.rawPayload.length, 'um content-length do corpo original truncaria a resposta');
  assert.ok(anunciado < original.length);
  await app.close();
});

/*
 * O gancho guarda o resultado por conteúdo justamente para não pagar brotli duas vezes pela mesma
 * resposta. Aqui a etiqueta é fixada à mão e o corpo muda: se os bytes do primeiro pedido voltarem,
 * é porque o segundo veio do cache em vez de ser comprimido de novo.
 */
test('duas respostas com a mesma etiqueta não são comprimidas duas vezes', async () => {
  const app = Fastify();
  registrarCompressao(app);
  let volta = 0;
  app.get('/api/etiquetado', async (_pedido, resposta) => {
    resposta.header('ETag', 'W/"fixo"');
    return resposta.type('application/json; charset=utf-8').send(corpoDe(4096, String(volta++)));
  });

  const primeira = await app.inject({ method: 'GET', url: '/api/etiquetado', headers: { 'accept-encoding': 'br' } });
  const segunda = await app.inject({ method: 'GET', url: '/api/etiquetado', headers: { 'accept-encoding': 'br' } });
  assert.equal(volta, 2, 'a rota respondeu duas vezes, com corpos diferentes');
  assert.deepEqual(segunda.rawPayload, primeira.rawPayload, 'o segundo pedido reaproveitou o brotli guardado');
  await app.close();
});

test('recomprimir o mesmo corpo custa menos na segunda vez', async () => {
  const app = montar();
  const grande = corpoGrande(1_000_000);
  app.get('/api/enorme', async (_pedido, resposta) => resposta.type('application/json; charset=utf-8').send(grande));

  const medir = async () => {
    const inicio = process.hrtime.bigint();
    const resposta = await app.inject({ method: 'GET', url: '/api/enorme', headers: { 'accept-encoding': 'br' } });
    return { ms: Number(process.hrtime.bigint() - inicio) / 1e6, resposta };
  };
  const primeira = await medir();
  const segunda = await medir();

  assert.equal(primeira.resposta.headers['content-encoding'], 'br');
  assert.deepEqual(segunda.resposta.rawPayload, primeira.resposta.rawPayload);
  assert.ok(segunda.ms < primeira.ms / 3, `a segunda passada (${segunda.ms.toFixed(1)} ms) devia ser muito mais barata que a primeira (${primeira.ms.toFixed(1)} ms)`);
  await app.close();
});

test('o que não é /api/ passa intocado', async () => {
  const app = montar();
  const resposta = await app.inject({ method: 'GET', url: '/fora/grande', headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(resposta.headers['content-encoding'], undefined);
  assert.equal(resposta.headers['vary'], undefined);
  assert.equal(resposta.rawPayload.toString(), corpoGrande(20_000));
  await app.close();
});

test('a etiqueta de conteúdo é a mesma para o mesmo corpo e muda quando o corpo muda', () => {
  const corpo = corpoDe(2048);
  assert.equal(contentTag(corpo), contentTag(corpo));
  assert.equal(contentTag(corpo), contentTag(Buffer.from(corpo)), 'texto e bytes iguais valem a mesma etiqueta');
  assert.notEqual(contentTag(corpo), contentTag(corpoDe(2048, 'y')));
  assert.notEqual(contentTag('a'), contentTag('b'), 'um byte de diferença já muda a etiqueta');
  assert.match(contentTag(corpo), /^W\/"[A-Za-z0-9_-]{22}"$/, 'é uma etiqueta fraca, curta e segura em cabeçalho');
});
