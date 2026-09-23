import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveOffices, archiveRef, archiveProgress, normalizeArchive } from '../server/archive.ts';
import { COLORS, distinctColors, partyColor } from '../shared/types.ts';

/** Shaped from the TSE's published 2022 `dados-simplificados` layout. Not election data. */
const fixture = (over: Record<string, unknown> = {}) => ({
  ele: '544', t: '1', f: 'o', cdabr: 'BR', tpabr: 'br',
  dg: '04/10/2022', hg: '12:07:13', dt: '04/10/2022', ht: '10:27:34',
  s: '1000', st: '1000', pst: '100,00', e: '3000', c: '2400', a: '600', pa: '20,00',
  vv: '2300', tv: '2400', vb: '40', tvn: '60',
  cand: [
    { sqcand: '1', n: '13', nm: 'PRIMEIRA', cc: 'PT - Federação Brasil da Esperança (PT/PC do B/PV) / PSB', e: 's', st: '2º turno', vap: '1200', pvap: '52,17' },
    { sqcand: '2', n: '22', nm: 'SEGUNDA', cc: 'PL - PP / REPUBLICANOS / PL', e: 's', st: '2º turno', vap: '900', pvap: '39,13' },
    { sqcand: '3', n: '15', nm: 'TERCEIRA', cc: 'MDB', e: 'n', st: 'Não eleito', vap: '200', pvap: '8,70' },
  ],
  ...over,
});
const ref = { election: '544', turn: 1 as const, office: 'president' as const, uf: 'BR', url: 'https://example.test/arquivo' };

test('arquivo 2022 lê votos, partido da coligação e ordena por votação', () => {
  const race = normalizeArchive(fixture(), ref, 1000);
  assert.equal(race.status, 'finished');
  assert.equal(race.countedPercent, 100);
  assert.equal(race.validVotes, 2300);
  assert.equal(race.abstentionPercent, 20);
  assert.deepEqual(race.candidates.map(c => c.name), ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA']);
  assert.deepEqual(race.candidates.map(c => c.party), ['PT', 'PL', 'MDB']);
  assert.equal(race.sourceAt, '2022-10-04T12:07:13-03:00');
  assert.equal(race.history.length, 0);
});

test('ida ao segundo turno não é eleição: só a situação oficial define eleito', () => {
  const race = normalizeArchive(fixture(), ref);
  assert.deepEqual(race.candidates.map(c => c.elected), [false, false, false]);
  const elected = normalizeArchive(fixture({ cand: [{ sqcand: '1', n: '13', nm: 'ELEITA', cc: 'PT', e: 's', st: 'Eleito', vap: '10', pvap: '100,00' }] }), ref);
  assert.equal(elected.candidates[0].elected, true);
  assert.equal(elected.seats, 1);
  const proportional = normalizeArchive(fixture({ cdabr: 'MG', cand: [
    { sqcand: '1', n: '1111', nm: 'A', cc: 'PT', e: 's', st: 'Eleito por QP', vap: '10', pvap: '50,00' },
    { sqcand: '2', n: '2222', nm: 'B', cc: 'PL', e: 'n', st: 'Suplente', vap: '5', pvap: '25,00' },
  ] }), { ...ref, office: 'federal', uf: 'MG' });
  assert.equal(proportional.seats, 1);
  assert.equal(proportional.candidates[1].elected, false);
});

test('arquivo de outra eleição, turno ou abrangência é recusado', () => {
  for (const invalid of [{ ele: '546' }, { t: '2' }, { cdabr: 'MG' }, { cand: [] }]) {
    assert.throws(() => normalizeArchive(fixture(invalid), ref));
  }
});

test('endereços seguem os códigos publicados pelo TSE para 2022', () => {
  assert.match(archiveRef('president', 'BR', 1)!.url, /ele2022\/544\/dados-simplificados\/br\/br-c0001-e000544-r\.json$/);
  assert.match(archiveRef('president', 'MG', 2)!.url, /ele2022\/545\/dados-simplificados\/mg\/mg-c0001-e000545-r\.json$/);
  assert.match(archiveRef('governor', 'MG', 1)!.url, /546\/dados-simplificados\/mg\/mg-c0003-e000546-r\.json$/);
  assert.match(archiveRef('state', 'DF', 1)!.url, /df-c0008-e000546-r\.json$/);
  assert.match(archiveRef('governor', 'SP', 2)!.url, /547\/dados-simplificados\/sp\/sp-c0003-e000547-r\.json$/);
  // Only twelve states held a gubernatorial runoff, and the legislature is decided in one round.
  assert.equal(archiveRef('governor', 'MG', 2), null);
  assert.equal(archiveRef('senate', 'MG', 2), null);
  assert.deepEqual(archiveOffices(1), ['president', 'governor', 'senate', 'federal', 'state']);
  assert.deepEqual(archiveOffices(2), ['president', 'governor']);
});

test('mapa por estado expõe líder, vantagem e segundo colocado', () => {
  const race = normalizeArchive(fixture({ cdabr: 'MG' }), { ...ref, uf: 'MG' });
  const [state] = archiveProgress([{ uf: 'MG', race }]);
  assert.equal(state.uf, 'MG');
  assert.equal(state.leader!.name, 'PRIMEIRA');
  assert.equal(state.leader!.runnerUp, 'SEGUNDA');
  assert.ok(Math.abs(state.leader!.margin - 13.04) < 0.001);
  assert.equal(state.status, 'finished');
});

test('cores são chave de identidade: sem repetição nem vizinhos indistinguíveis no painel', () => {
  assert.equal(partyColor('PT'), COLORS[7]);
  assert.equal(partyColor('PL'), COLORS[0]);
  assert.equal(partyColor('pt '), partyColor('PT'));
  const clashing = new Set(['0-6', '1-3', '1-4', '1-5', '1-7', '2-4', '2-5', '3-7', '4-7']);
  // Distinct parties never share a colour, at any list length.
  for (const parties of [['PT', 'PL', 'MDB', 'PDT'], ['PL', 'PP', 'PSDB', 'PSOL'], ['AAA', 'BBB', 'CCC', 'DDD'], ['PT', 'PL', 'MDB', 'PDT', 'NOVO', 'PSD', 'PSC', 'PP']]) {
    const colors = distinctColors(parties, p => p);
    assert.equal(new Set(colors).size, new Set(parties).size, `partidos distintos com a mesma cor em ${parties}`);
  }
  // A panel lists at most four candidacies, where there is always room to avoid a
  // close pair. Beyond that the slots run out and a close pair is the lesser evil.
  for (const parties of [['PT', 'PL', 'MDB', 'PDT'], ['PL', 'PP', 'PSDB', 'PSOL'], ['AAA', 'BBB', 'CCC', 'DDD']]) {
    const colors = distinctColors(parties, p => p);
    for (let i = 1; i < colors.length; i++) {
      const [a, b] = [COLORS.indexOf(colors[i - 1]), COLORS.indexOf(colors[i])].sort((x, y) => x - y);
      assert.ok(!clashing.has(`${a}-${b}`), `vizinhos ${colors[i - 1]}/${colors[i]} não passam na separação`);
    }
  }
  // Two candidacies of the same party share that party's colour: they are the same entity.
  const sameParty = distinctColors(['PT', 'PT', 'MDB'], p => p);
  assert.deepEqual(sameParty.slice(0, 2), [COLORS[7], COLORS[7]]);
  assert.notEqual(sameParty[2], COLORS[7]);
});
