import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblySeats, CHAMBER_SEATS } from '../src/domain/seats.ts';
import { fmtInt, fmtPercent, fmtPoints, fmtSigned, titleCase, fold } from '../src/domain/format.ts';
import { candidateStatus, contestedSeats, publishedStatus, rankCandidates, seatsByParty } from '../src/domain/derive.ts';
import type { Race } from '../shared/types.ts';

const race = (over: Partial<Race> = {}): Race => ({
  office: 'senate', uf: 'MG', election: 'T', turn: 1, status: 'partial', generationId: '1', sourceAt: null, totalizedAt: null, receivedAt: 0, sourceUrl: '', seats: 2,
  countedPercent: 40, countedSections: 400, totalSections: 1000, validVotes: 1000, totalVotes: 1100, blankVotes: 50, nullVotes: 50, electorate: 2000, turnout: 1100, abstention: 900, abstentionPercent: 45,
  candidates: [
    { id: 'a', name: 'ANA', number: '100', party: 'PX', votes: 400, percent: 40, elected: false, status: '', color: '#111111' },
    { id: 'b', name: 'BIA', number: '200', party: 'PY', votes: 300, percent: 30, elected: false, status: '', color: '#222222' },
    { id: 'c', name: 'CAIO', number: '300', party: 'PZ', votes: 200, percent: 20, elected: false, status: '', color: '#333333' },
    { id: 'd', name: 'DÉBORA', number: '400', party: 'PX', votes: 100, percent: 10, elected: false, status: '', color: '#444444' },
  ], parties: [], history: [], ...over,
});

test('formatting: pt-BR numbers, percent vs percentage points', () => {
  assert.equal(fmtInt(88312421), '88.312.421');
  assert.equal(fmtPercent(72.45), '72,45%');
  assert.equal(fmtPoints(0.42), '0,42 p.p.');
  assert.equal(fmtSigned(-3, 0), '−3');
  assert.equal(titleCase('MARIA DA SILVA II'), 'Maria da Silva II');
  assert.equal(fold('São João'), 'sao joao');
});

test('vagas: a Câmara soma 513 e as assembleias seguem o art. 27', () => {
  assert.equal(Object.values(CHAMBER_SEATS).reduce((a, b) => a + b, 0), 513);
  assert.equal(assemblySeats('MG', CHAMBER_SEATS.MG), 77);
  assert.equal(assemblySeats('SP', CHAMBER_SEATS.SP), 94);
  assert.equal(assemblySeats('DF', CHAMBER_SEATS.DF), 24);
});

test('situação publicada: só o que a fonte declarou, e nada quando ela cala', () => {
  const [ana, bia] = race().candidates;
  assert.equal(publishedStatus({ ...ana, elected: true })!.key, 'elected');
  assert.equal(publishedStatus({ ...ana, status: 'ELEITO POR QP' })!.key, 'elected');
  assert.equal(publishedStatus({ ...ana, status: '2º turno' })!.key, 'runoff');
  assert.equal(publishedStatus({ ...ana, status: 'SUPLENTE' })!.label, 'suplente');
  assert.equal(publishedStatus({ ...ana, status: 'NÃO ELEITO' })!.label, 'não eleito');
  assert.equal(publishedStatus(bia), null, 'sem situação publicada, nada é afirmado');
});

test('bancada por partido: cadeiras vêm da situação do TSE, nunca de conta própria', () => {
  const r = race({ office: 'federal', seats: 3, candidates: race().candidates.map((c, i) => ({ ...c, elected: i === 0 })) });
  const bancadas = seatsByParty(r, 2026);
  assert.equal(bancadas[0].party, 'PX');
  assert.equal(bancadas[0].seats, 1, 'só quem o TSE elegeu ocupa cadeira');
  assert.equal(bancadas.reduce((t, p) => t + p.seats, 0), 1);
});


test('ranking sorts by votes for display and derives standing without inferring election', () => {
  const ranked = rankCandidates(race(), 2026);
  assert.deepEqual(ranked.map(c => c.rank), [1, 2, 3, 4]);
  assert.equal(ranked[0].statusKey, 'in_seat_range'); assert.equal(ranked[1].statusKey, 'in_seat_range'); assert.equal(ranked[2].statusKey, 'counting');
  assert.equal(ranked[1].gapVotes, 100); assert.equal(ranked[1].gapPoints, 10);
  const proportional = rankCandidates(race({ office: 'federal', seats: 53 }), 2026);
  assert.ok(proportional.every(c => c.statusKey === 'counting'), 'proportional never marks winners from the ranking');
  const official = candidateStatus({ ...race().candidates[3], status: 'Eleito por QP' }, 3, race({ office: 'federal' }), 1);
  assert.equal(official, 'elected');
  assert.equal(candidateStatus({ ...race().candidates[0], status: '2º turno' }, 0, race({ office: 'president' }), 1), 'runoff');
});







