/**
 * The night's thread. What matters here is what is *not* said: the feed used to emit a line for
 * every file the TSE published, and the point of these tests is that only a turn of events does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedEntries } from '../server/collector.ts';
import type { Candidate, Race } from '../shared/types.ts';

const cand = (id: string, name: string, votes: number, percent: number, extra: Partial<Candidate> = {}): Candidate => ({
  id, name, number: id, party: `P${id}`, color: '#fff', votes, percent, elected: false, status: '', ...extra,
} as Candidate);

const corrida = (percent: number, cands: Candidate[], extra: Partial<Race> = {}): Race => ({
  office: 'governor', uf: 'MG', election: '21270', turn: 1, status: 'partial',
  generationId: String(percent), sourceAt: null, totalizedAt: null, receivedAt: 1_700_000_000_000,
  seats: 1, countedPercent: percent, countedSections: 0, totalSections: 0,
  validVotes: 100, totalVotes: 100, blankVotes: 0, nullVotes: 0, electorate: 0,
  turnout: 0, abstention: 0, abstentionPercent: 0, candidates: cands, parties: [], history: [],
  ...extra,
} as Race);

test('uma virada vira uma frase, com quem passou quem e por quanto', () => {
  const antes = corrida(30, [cand('1', 'Ana', 50, 50), cand('2', 'Bruno', 40, 40)]);
  const depois = corrida(31, [cand('2', 'Bruno', 60, 48), cand('1', 'Ana', 55, 44)]);
  const evs = feedEntries(antes, depois, 'MG', 'governor', 'k');
  const virada = evs.find(e => e.kind === 'lead')!;
  assert.ok(virada, 'a virada tem de ser anunciada');
  assert.match(virada.detail, /Bruno .* passa Ana .* por 4 pontos/);
  assert.equal(virada.who?.name, 'Bruno');
});

test('uma diferença de quarta casa não vira "por 0%"', () => {
  const antes = corrida(30, [cand('1', 'Ana', 50, 10.0004), cand('2', 'Bruno', 40, 10)]);
  const depois = corrida(31, [cand('2', 'Bruno', 60, 10.0004), cand('1', 'Ana', 55, 10)]);
  const virada = feedEntries(antes, depois, 'MG', 'governor', 'k').find(e => e.kind === 'lead')!;
  assert.match(virada.detail, /por menos de 0,01 ponto/);
});

test('numa proporcional, quem está no topo não é notícia', () => {
  const antes = corrida(30, [cand('1', 'Ana', 50, 2), cand('2', 'Bruno', 40, 1.9)]);
  const depois = corrida(31, [cand('2', 'Bruno', 60, 2.1), cand('1', 'Ana', 55, 2)]);
  const evs = feedEntries(antes, depois, 'MG', 'federal', 'k');
  assert.equal(evs.filter(e => e.kind === 'lead').length, 0);
});

test('sem troca de liderança não há virada, por mais arquivos que cheguem', () => {
  const antes = corrida(30, [cand('1', 'Ana', 50, 50), cand('2', 'Bruno', 40, 40)]);
  const depois = corrida(30.4, [cand('1', 'Ana', 51, 50.2), cand('2', 'Bruno', 41, 40.1)]);
  assert.deepEqual(feedEntries(antes, depois, 'MG', 'governor', 'k'), []);
});

test('marcos são anunciados uma vez, ao serem cruzados', () => {
  const antes = corrida(48, [cand('1', 'Ana', 50, 50)]);
  const depois = corrida(51, [cand('1', 'Ana', 55, 51)]);
  const marcos = feedEntries(antes, depois, 'MG', 'governor', 'k').filter(e => e.kind === 'milestone');
  assert.equal(marcos.length, 1);
  assert.match(marcos[0].detail, /^50% das seções/);
  // o mesmo marco não volta no arquivo seguinte
  assert.equal(feedEntries(depois, corrida(52, [cand('1', 'Ana', 56, 52)]), 'MG', 'governor', 'k').length, 0);
});

test('uma vaga definida é anunciada uma vez, e só quando a fonte a declara', () => {
  const antes = corrida(80, [cand('1', 'Ana', 50, 50)]);
  const depois = corrida(90, [cand('1', 'Ana', 55, 51, { elected: true })]);
  const evs = feedEntries(antes, depois, 'MG', 'governor', 'k');
  const eleito = evs.find(e => e.kind === 'elected')!;
  assert.ok(eleito);
  assert.match(eleito.detail, /Ana .* eleit/);
  assert.equal(feedEntries(depois, corrida(91, [cand('1', 'Ana', 56, 51, { elected: true })]), 'MG', 'governor', 'k')
    .filter(e => e.kind === 'elected').length, 0);
});

test('o fim da totalização fecha o fio, uma vez', () => {
  const antes = corrida(99.9, [cand('1', 'Ana', 55, 51)]);
  const depois = corrida(100, [cand('1', 'Ana', 56, 51)], { status: 'finished' });
  const evs = feedEntries(antes, depois, 'MG', 'governor', 'k');
  assert.equal(evs.filter(e => e.kind === 'finished').length, 1);
  assert.equal(feedEntries(depois, depois, 'MG', 'governor', 'k').filter(e => e.kind === 'finished').length, 0);
});

test('um primeiro arquivo não inventa uma virada contra ninguém', () => {
  const primeiro = corrida(7, [cand('1', 'Ana', 50, 50), cand('2', 'Bruno', 40, 40)]);
  const evs = feedEntries(undefined, primeiro, 'MG', 'governor', 'k');
  assert.equal(evs.filter(e => e.kind === 'lead').length, 0);
  assert.ok(evs.some(e => e.kind === 'milestone'), 'mas os marcos cruzados valem');
});
