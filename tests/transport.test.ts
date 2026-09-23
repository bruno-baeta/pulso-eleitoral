import test from 'node:test';
import assert from 'node:assert/strict';
import { TSE_CEILING, TseTransport } from '../server/transport.ts';

test('shares simultaneous reads, sends conditional validators and retains 304 contents', async t => {
  let now = 1000, calls = 0;
  const headers: Record<string, string>[] = [];
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    headers.push(init.headers as Record<string, string>); calls++;
    return calls === 1 ? new Response('{"idg":"7"}', { headers: { etag: '"7"', 'last-modified': 'Sun, 04 Oct 2026 20:00:00 GMT' } }) : new Response(null, { status: 304 });
  }) as typeof fetch;
  const client = new TseTransport(20, fetcher, () => now); t.after(() => client.close());
  const first = client.get('https://test.test/one', 2000);
  const second = client.get('https://test.test/one', 2000);
  assert.strictEqual(first, second);
  assert.deepEqual(await first, { idg: '7' }); assert.equal(calls, 1);
  assert.equal(await client.get('https://test.test/one', 2000), null);
  now += 2001;
  assert.deepEqual(await client.get('https://test.test/one', 2000), { idg: '7' });
  assert.equal(headers[1]['If-None-Match'], '"7"');
  assert.ok(headers[1]['If-Modified-Since']);
  assert.equal(client.requests, 2); assert.equal(client.notModified, 1);
});

for (const status of [403, 429]) test(`HTTP ${status} pauses every endpoint for at least 16 minutes`, async t => {
  let calls = 0;
  const client = new TseTransport(20, (async () => { calls++; return new Response('', { status, headers: { 'retry-after': '1200' } }); }) as typeof fetch, () => 1000);
  t.after(() => client.close());
  assert.equal(await client.get('https://test.test/a', 2000), null);
  assert.equal(client.cooldownUntil, 1201000);
  assert.equal(await client.get('https://test.test/b', 2000), null);
  assert.equal(calls, 1);
});

test('404 does not get retried rapidly; three missing files trigger a global pause', async t => {
  let now = 1000;
  const client = new TseTransport(20, (async () => new Response('', { status: 404 })) as typeof fetch, () => now);
  t.after(() => client.close());
  await client.get('https://test.test/a', 2000);
  now += 60000;
  await client.get('https://test.test/a', 2000);
  assert.equal(client.requests, 1);
  await client.get('https://test.test/b', 2000);
  await client.get('https://test.test/c', 2000);
  await client.get('https://test.test/d', 2000);
  assert.ok(client.cooldownUntil >= now + 960000);
});

test('a transient failure preserves the cache and backs off', async t => {
  let now = 1000, calls = 0;
  const client = new TseTransport(20, (async () => ++calls === 1 ? new Response('{"votes":123}') : new Response('', { status: 503 })) as typeof fetch, () => now);
  t.after(() => client.close());
  await client.get('https://test.test/a', 2000); now += 2001;
  assert.equal(await client.get('https://test.test/a', 2000), null);
  assert.deepEqual(client.entries.get('https://test.test/a')?.value, { votes: 123 });
  assert.match(client.entries.get('https://test.test/a')?.error || '', /503/);
  assert.equal(await client.get('https://test.test/a', 2000), null); assert.equal(calls, 2);
});

test('a fila compartilhada respeita o teto de requisições por segundo', async t => {
  /*
   * Mede o tempo total das cinco, não o intervalo entre cada par.
   *
   * A versão anterior exigia pelo menos 80 ms entre duas partidas consecutivas, contra um alvo de
   * 100 — vinte por cento de folga contra qualquer pausa do coletor de lixo ou da máquina ocupada.
   * É o mesmo desenho que fez o teste do cache de compressão piscar duas vezes em 23/09/2026. O
   * total só pode crescer com uma pausa, nunca encolher, então a asserção não tem como falhar por
   * carga: se ela falhar, o balde de fichas deixou mesmo de segurar.
   */
  const client = new TseTransport(10, (async () => new Response('{}')) as typeof fetch);
  t.after(() => client.close());
  const inicio = performance.now();
  await Promise.all(Array.from({ length: 5 }, (_, i) => client.get(`https://test.test/${i}`, 2000)));
  const total = performance.now() - inicio;

  const minimo = 4 * (1000 / 10) * 0.8;          // quatro intervalos de 100 ms, com folga
  assert.ok(total >= minimo, `cinco requisições a 10/s não podem sair em ${total.toFixed(0)} ms`);
  assert.equal(client.requests, 5);
});

test('nunca há mais requisições em voo do que o teto de simultâneas', async t => {
  /*
   * Esta é a metade determinística do teste antigo: contar quantas estão em voo não depende de
   * relógio nenhum.
   */
  let emVoo = 0, pico = 0;
  const client = new TseTransport(500, (async () => {
    emVoo++; pico = Math.max(pico, emVoo);
    await new Promise(r => setTimeout(r, 5));
    emVoo--;
    return new Response('{}');
  }) as typeof fetch, Date.now, 60, 4);
  t.after(() => client.close());
  await Promise.all(Array.from({ length: 30 }, (_, i) => client.get(`https://test.test/voo/${i}`, 2000)));
  assert.ok(pico <= 4, `o teto de simultâneas é 4 e o pico foi ${pico}`);
  assert.equal(client.requests, 30, 'e todas saíram');
});

test('o teto do TSE é cem por segundo, e nenhuma configuração passa disso', async t => {
  /*
   * O limite é do TSE, não uma preferência: quem o estoura é bloqueado por IP no meio da apuração,
   * e quem descobre isso é o leitor com a tela parada. O valor vinha do ambiente sem nenhum freio.
   */
  const alto = new TseTransport(500, (async () => new Response('{}')) as typeof fetch);
  t.after(() => alto.close());
  assert.equal(alto.maxRps, TSE_CEILING);
  assert.equal(TSE_CEILING, 100);

  const baixo = new TseTransport(8, (async () => new Response('{}')) as typeof fetch);
  t.after(() => baixo.close());
  assert.equal(baixo.maxRps, 8, 'abaixo do teto, o valor pedido é o que vale');
});

test('o 404 esperado da varredura municipal não pausa a coleta inteira', async t => {
  /*
   * A varredura pede dezenas de milhares de arquivos por município, e muitos ainda não existem. Se
   * cada ausência contasse para a pausa geral, a própria varredura derrubaria as corridas.
   */
  let now = 1000;
  const client = new TseTransport(20, (async () => new Response('', { status: 404 })) as typeof fetch, () => now);
  t.after(() => client.close());
  for (const nome of ['a', 'b', 'c', 'd']) await client.get(`https://test.test/${nome}`, 2000, { expectMissing: true });
  assert.equal(client.cooldownUntil, 0, 'ausência esperada não é motivo de pausa');
  for (const nome of ['e', 'f', 'g']) await client.get(`https://test.test/${nome}`, 2000);
  assert.ok(client.cooldownUntil > now, 'a regra continua valendo para os arquivos de resultado');
});
