import test from 'node:test';
import assert from 'node:assert/strict';
import { BASES, discoverElections, normalizeResult, normalizeProgress, numeric, officeCode, resultUrl, tseTime } from '../server/tse.ts';
import { config2026, resultFixture } from './fixtures.ts';
import { fakeSnapshot } from './helpers/fakeSnapshot.ts';

test('discovers federal/state scopes and only the requested 2026 general election dates', () => {
  const refs = discoverElections(config2026);
  assert.equal(refs.length, 4);
  assert.equal(refs.find(r => r.ufs.includes('DF'))?.offices.includes(8), true);
  assert.equal(refs.find(r => r.turn === 2)?.code, '9003');
  assert.deepEqual(discoverElections({ ...config2026, c: 'ele2024' }), []);
  assert.deepEqual(discoverElections({ ...config2026, f: 's' }), []);
  assert.deepEqual(discoverElections({ ...config2026, pl: [{ ...config2026.pl[0], dt: '14/06/2026' }] }), []);
});

test('simulated configuration is isolated from production and allows simulated dates', () => {
  const sim = { ...config2026, f: 's', pl: [{ ...config2026.pl[0], dt: '15/09/2026' }] };
  assert.equal(discoverElections(sim, true).length, 3);
  assert.deepEqual(discoverElections(sim, false), []);
});

test('URLs use exact published names and zero padding, including the DF office', () => {
  const e = discoverElections(config2026)[0];
  assert.equal(resultUrl(BASES.official, e, 'BR', 'president'), 'https://resultados.tse.jus.br/oficial/ele2026/9001/dados/br/br-c0001-e009001-u.json');
  assert.match(resultUrl(BASES.simulado, e, 'DF', 'state'), /simulado\/simulado2026\/ele2026\/9001\/dados\/df\/df-c0008-e009001-u.json$/);
  assert.equal(officeCode('state', 'DF'), 8);
  assert.match(resultUrl(BASES.official, e, 'BR'), /br-e009001-ab.json$/);
  assert.throws(() => resultUrl(BASES.official, e, '../', 'president'));
});

const expected = { office: 'president' as const, uf: 'BR', election: '9001', turn: 1 as const, simulated: false, url: 'https://example.test/source' };
test('EA20 normalizes nested candidates, exact percentages, aggregate null votes and source times', () => {
  const result = normalizeResult(resultFixture(), expected, 10);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].votes, 600);
  assert.equal(result.candidates[0].percent, 60);
  assert.equal(result.parties[0].votes, 610);
  assert.equal(result.nullVotes, 70);
  assert.equal(result.countedPercent, 75);
  assert.equal(result.sourceAt, '2026-10-04T18:30:00-03:00');
  assert.equal(result.receivedAt, 10);
  assert.equal(result.status, 'partial');
});

test('rejects wrong election, turn, phase, scope, office and withheld publication', () => {
  for (const changes of [{ ele: '545' }, { t: '2' }, { f: 's' }, { cdabr: 'mg' }, { dv: 'n' }, { sup: 's' }, { carg: [] }]) {
    assert.throws(() => normalizeResult({ ...resultFixture(), ...changes }, expected));
  }
});

test('100% sections do not invent finalization or elected candidates', () => {
  const fixture = resultFixture(); fixture.s.pstn = '100'; fixture.s.st = '100';
  const result = normalizeResult(fixture, expected);
  assert.equal(result.status, 'partial');
  assert.equal(result.candidates.every(c => !c.elected), true);
  fixture.and = 'f'; fixture.carg[0].agr[0].par[0].cand[0].e = 's';
  const final = normalizeResult(fixture, expected);
  assert.equal(final.status, 'finished'); assert.equal(final.candidates[0].elected, true);
});

test('a proportional ranking does not allocate seats and senate preserves two vacancies', () => {
  const race = normalizeResult(resultFixture(6, 'mg'), { ...expected, office: 'federal', uf: 'MG' });
  assert.equal(race.parties.reduce((n, p) => n + p.elected, 0), 0);
  assert.equal(normalizeResult(resultFixture(5, 'mg'), { ...expected, office: 'senate', uf: 'MG' }).seats, 2);
});

test('EA14 takes UF totals from nested section counts and rejects another election', () => {
  const ref = discoverElections(config2026)[0];
  const raw = { ele: '9001', t: '1', f: 'o', abr: [{ tpabr: 'br' }, { tpabr: 'uf', cdabr: 'mg', and: 'p', dt: '04/10/2026', ht: '18:00:00', s: { ts: '100', st: '75', pstn: '75.000000000' } }] };
  assert.deepEqual(normalizeProgress(raw, ref, false).map(s => [s.uf, s.percent]), [['MG', 75]]);
  assert.throws(() => normalizeProgress({ ...raw, f: 's' }, ref, false));
});

test('numeric and timestamp conversions preserve Brazilian and numeric representations', () => {
  assert.equal(numeric('47,56'), 47.56); assert.equal(numeric('47.560001'), 47.560001);
  assert.equal(numeric('12345678'), 12345678); assert.equal(numeric(''), 0);
  assert.equal(tseTime('', ''), null);
  assert.equal(Date.parse(tseTime('04/10/2026', '17:00:00')!), Date.parse('2026-10-04T20:00:00Z'));
});

test('o snapshot sintético vem ordenado por votos e sem disputa proporcional no 2º turno', () => {
  const snapshot = fakeSnapshot('MG', 1, Date.parse('2026-09-14T20:00:00Z'));
  assert.equal(snapshot.mode, 'simulado');
  assert.equal(Object.keys(snapshot.races).length, 5);
  for (const race of Object.values(snapshot.races)) {
    assert.equal(race.sourceAt, null); assert.equal(race.election, '21272');
    assert.ok(Math.abs(race.candidates.reduce((n, c) => n + c.percent, 0) - 100) < .0001);
    assert.deepEqual(race.candidates.map(c => c.votes), race.candidates.map(c => c.votes).sort((a, b) => b - a));
  }
  assert.deepEqual(Object.keys(fakeSnapshot('MG', 2).races), ['president', 'governor']);
});
