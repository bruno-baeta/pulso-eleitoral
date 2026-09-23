import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASES, discoverElections, normalizeResult, normalizeProgress, resultUrl, tseTime, numeric, type ExpectedResult } from '../server/tse.ts';
import { fakeSnapshot } from './helpers/fakeSnapshot.ts';
import { TseTransport } from '../server/transport.ts';

const expected: ExpectedResult = { office: 'federal', uf: 'MG', election: '999001', turn: 1, simulated: false, url: 'https://resultados.tse.jus.br/oficial/test-fixture' };
const fixture = () => ({
  ele: '999001', t: '1', f: 'o', sup: 'n', tpabr: 'uf', cdabr: 'mg',
  dg: '04/10/2026', hg: '18:10:00', dt: '04/10/2026', ht: '18:09:00', idg: '123', dv: 's', and: 'p', tf: 'n',
  carg: [{ cd: '6', nv: '53', agr: [{ par: [{
    n: '99', sg: 'TESTE', tvtn: '1000', tvtl: '250', cand: [
      { n: '9999', sqcand: '9999', nmu: 'Maior votação', vap: '750', pvap: '75,00', pvapn: '75.000000000', e: 'n', st: 'Suplente' },
      { n: '9998', sqcand: '9998', nmu: 'Menor votação', vap: '250', pvap: '25,00', pvapn: '25.000000000', e: 's', st: 'Eleito por QP' },
    ],
  }] }] }],
  s: { ts: '100', st: '100', pst: '100,00', pstn: '100' },
  e: { te: '2000', c: '1800', a: '200', pa: '10,00', pan: '10' },
  v: { tv: '1800', vv: '1250', vb: '200', tvn: '350' },
});

test('EA20 mantém eleito por situação oficial, sem inferir pela ordem ou por 100% das seções', () => {
  const race = normalizeResult(fixture(), expected);
  assert.equal(race.countedPercent, 100);
  assert.equal(race.status, 'partial');
  assert.equal(race.candidates[0].name, 'Maior votação');
  assert.equal(race.candidates[0].elected, false);
  assert.equal(race.candidates[1].elected, true);
  assert.equal(race.parties[0].votes, 1250);
  assert.equal(race.parties[0].elected, 1);
  assert.equal(race.abstentionPercent, 10);
});

test('EA20 bloqueia eleição, fase, turno e UF incorretos e divulgação não autorizada', () => {
  for (const invalid of [{ ele: '619' }, { f: 's' }, { t: '2' }, { cdabr: 'sp' }, { sup: 's' }, { dv: 'n' }]) {
    assert.throws(() => normalizeResult({ ...fixture(), ...invalid }, expected));
  }
  const raw = fixture();
  raw.carg[0].cd = '7';
  assert.throws(() => normalizeResult(raw, expected));
});

test('timestamps da fonte preservam Brasília e números aceitam precisão decimal do TSE', () => {
  assert.equal(tseTime('04/10/2026', '18:10:00'), '2026-10-04T18:10:00-03:00');
  assert.equal(Date.parse(tseTime('04/10/2026', '18:10:00')!), Date.parse('2026-10-04T21:10:00Z'));
  assert.equal(tseTime('', '18:00:00'), null);
  assert.equal(numeric('52,123456789'), 52.123456789);
  assert.equal(numeric('52.123456789'), 52.123456789);
});

test('descoberta ignora 2024 e suplementares, identifica os cargos e o turno de 2026', () => {
  const config = { c: 'ele2026', f: 'o', pl: [
    { dt: '04/10/2026', e: [{ cd: '999001', t: '1', abr: [{ cd: 'br', cp: [{ cd: '1' }, { cd: '6' }] }] }] },
    { dt: '25/10/2026', e: [{ cd: '999002', t: '2', abr: [{ cd: 'mg', cp: [{ cd: '3' }] }] }] },
    { dt: '06/10/2024', e: [{ cd: '619', t: '1', abr: [{ cd: 'br', cp: [{ cd: '11' }] }] }] },
    { dt: '11/10/2026', e: [{ cd: '888001', t: '1', abr: [{ cd: 'br', cp: [{ cd: '3' }] }] }] },
  ] };
  assert.equal(discoverElections({ ...config, c: 'ele2024' }).length, 0);
  assert.equal(discoverElections({ ...config, f: 's' }).length, 0);
  const refs = discoverElections(config);
  assert.equal(refs.length, 2);
  assert.equal(refs[1].turn, 2);
  assert.deepEqual(refs[1].ufs, ['MG']);
  const federal = { code: '21270', cycle: 'ele2026', turn: 1 as const, offices: [1], ufs: ['BR'] };
  assert.equal(resultUrl(BASES.simulado, federal, 'BR', 'president'), 'https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/21270/dados/br/br-c0001-e021270-u.json');
  assert.match(resultUrl(BASES.official, { ...federal, code: '999001' }, 'DF', 'state'), /df-c0008-e999001-u\.json$/);
});

test('mapa aceita apenas o EA14 da eleição e fase selecionadas', () => {
  const election = { code: '999001', cycle: 'ele2026', turn: 1 as const, offices: [1], ufs: ['BR'] };
  const raw = { ele: '999001', t: '1', f: 'o', abr: [{ tpabr: 'uf', cdabr: 'mg', dt: '04/10/2026', ht: '18:10:00', and: 'p', s: { ts: '100', st: '70', pstn: '70' } }] };
  assert.equal(normalizeProgress(raw, election, false)[0].percent, 70);
  assert.throws(() => normalizeProgress({ ...raw, ele: '619' }, election, false));
  assert.throws(() => normalizeProgress({ ...raw, f: 's' }, election, false));
});

test('o gerador sintético dos testes não gera votos negativos, ranking invertido nem falsos eleitos durante todo seu ciclo', () => {
  for (let tick = 0; tick < 400; tick++) {
    const data = fakeSnapshot('MG', 1, tick * 3000);
    assert.equal(data.mode, 'simulado');
    for (const race of Object.values(data.races)) {
      assert.equal(race.sourceAt, null);
      assert.equal(race.election, '21272');
      let previous = Infinity;
      for (const c of race.candidates) {
        assert.ok(c.votes >= 0 && c.percent >= 0);
        assert.ok(c.votes <= previous);
        assert.equal(c.elected, false);
        previous = c.votes;
      }
      assert.ok(Math.abs(race.candidates.reduce((sum, c) => sum + c.percent, 0) - 100) < .000001);
    }
  }
  assert.deepEqual(Object.keys(fakeSnapshot('MG', 2).races).sort(), ['governor', 'president']);
});

test('coletor usa ETag e 304 sem baixar novamente o conteúdo', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  let now = 100000;
  const calls: RequestInit[] = [];
  const transport = new TseTransport(20, (async (_url, init) => {
    calls.push(init || {});
    return calls.length === 1 ? new Response('{"idg":"1"}', { headers: { etag: '"v1"', 'last-modified': 'Sun, 04 Oct 2026 21:00:00 GMT' } }) : new Response(null, { status: 304 });
  }) as typeof fetch, () => now);
  try {
    const first = await transport.get('https://example.test/file', 2000);
    assert.deepEqual(first, { idg: '1' });
    assert.equal(await transport.get('https://example.test/file', 2000), null);
    now += 2001;
    assert.deepEqual(await transport.get('https://example.test/file', 2000), first);
    assert.equal((calls[1].headers as Record<string, string>)['If-None-Match'], '"v1"');
    assert.equal(transport.notModified, 1);
    assert.equal(transport.requests, 2);
  } finally { transport.close(); clearInterval(keepAlive); }
});

test('HTTP 429 aplica pausa global e respeita Retry-After maior que 16 minutos', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  let now = 100000;
  let calls = 0;
  const transport = new TseTransport(20, (async () => { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '1800' } }); }) as typeof fetch, () => now);
  try {
    assert.equal(await transport.get('https://example.test/one', 2000), null);
    assert.equal(transport.cooldownUntil, now + 1800000);
    now += 960001;
    assert.equal(await transport.get('https://example.test/two', 2000), null);
    assert.equal(calls, 1);
  } finally { transport.close(); clearInterval(keepAlive); }
});

test('arquivo 404 não é consultado repetidamente enquanto aguarda publicação', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  let now = 100000;
  let calls = 0;
  const transport = new TseTransport(20, (async () => { calls++; return new Response(null, { status: 404 }); }) as typeof fetch, () => now);
  try {
    await transport.get('https://example.test/missing', 2000);
    now += 10000;
    await transport.get('https://example.test/missing', 2000);
    assert.equal(calls, 1);
    assert.ok(transport.entries.get('https://example.test/missing')!.nextAt >= 100000 + 15 * 60000);
  } finally { transport.close(); clearInterval(keepAlive); }
});
