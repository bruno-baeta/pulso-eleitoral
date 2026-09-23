import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder } from '../server/recorder.ts';
import { SIMULADO_WINDOWS, OFFICIAL_WINDOWS, openWindow, nextWindow } from '../shared/windows.ts';
import { demoRace } from './helpers/fakeSnapshot.ts';

const race = (at: number, votes: number, percent: number) => {
  // a gravação guarda a disputa inteira, não a versão enxuta que vai para o navegador
  const r = demoRace('governor', 'MG', 1, at);
  return { ...r, receivedAt: at, countedPercent: percent, candidates: r.candidates.map((c, i) => ({ ...c, votes: votes - i * 10 })) };
};

test('simulado só abre nas janelas publicadas pelo TSE (horário de Brasília)', () => {
  assert.ok(openWindow(SIMULADO_WINDOWS, Date.parse('2026-09-17T09:30:00-03:00')));
  assert.equal(openWindow(SIMULADO_WINDOWS, Date.parse('2026-09-17T12:00:00-03:00')), null);
  assert.equal(openWindow(SIMULADO_WINDOWS, Date.parse('2026-09-17T13:59:00-03:00')), null);
  assert.ok(openWindow(SIMULADO_WINDOWS, Date.parse('2026-09-24T16:59:00-03:00')));
  assert.equal(openWindow(SIMULADO_WINDOWS, Date.parse('2026-09-18T10:00:00-03:00')), null);
  assert.equal(nextWindow(SIMULADO_WINDOWS, Date.parse('2026-09-17T17:00:00-03:00'))!.start, Date.parse('2026-09-22T09:00:00-03:00'));
  assert.equal(openWindow(OFFICIAL_WINDOWS, Date.parse('2026-10-04T20:00:00-03:00'))!.turn, 1);
});

test('gravação reconstrói a apuração em qualquer instante, inclusive o instante 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rec-'));
  try {
    const key = Recorder.key('simulado', 's1', 1, 'MG', 'governor');
    const rec = new Recorder(dir);
    await rec.record(key, race(10_000, 100, 10));
    await rec.record(key, race(12_000, 150, 12)); // under the minimum gap: skipped
    await rec.record(key, race(20_000, 500, 50));
    await rec.record(key, race(30_000, 900, 100));
    assert.deepEqual(await rec.span([key]), { start: 10_000, end: 30_000 });
    assert.equal((await rec.raceAt(key, 5_000))!.countedPercent, 0);
    assert.equal((await rec.raceAt(key, 5_000))!.candidates[0].votes, 0);
    assert.equal((await rec.raceAt(key, 15_000))!.candidates[0].votes, 100);
    assert.equal((await rec.raceAt(key, 25_000))!.countedPercent, 50);
    // A fresh process reads the same answer back from disk, names included.
    const again = new Recorder(dir);
    const r = (await again.raceAt(key, 99_000))!;
    assert.equal(r.countedPercent, 100);
    assert.equal(r.candidates[0].name, race(0, 0, 0).candidates[0].name);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('os totais por partido são gravados, e não recalculados da lista cortada', async () => {
  /*
   * O defeito, visto no modal de cadeiras da TV durante a reprodução: seis partidos com vaga aos
   * 7% apurado viravam um só aos 20%. A gravação guarda as 400 candidaturas mais votadas, o que
   * numa proporcional é cerca de um terço dos votos; o quociente saía dos votos válidos cheios e
   * as bancadas, da lista cortada. Quociente inteiro contra bancada pela metade elege quase
   * ninguém.
   *
   * Os partidos são poucas dezenas de linhas por quadro, e são eles que fazem a conta fechar.
   */
  const dir = await mkdtemp(join(tmpdir(), 'rec-'));
  try {
    const key = Recorder.key('simulado', 's1', 1, 'MG', 'federal');
    const base = demoRace('federal', 'MG', 1, 10_000);
    // A fonte publica 900.000 votos para o partido; a lista guardada só explica uma fração deles.
    const publicado = {
      ...base, receivedAt: 10_000, countedPercent: 20,
      candidates: base.candidates.map((c, i) => ({ ...c, party: 'P 1', votes: i === 0 ? 1_000 : 0 })),
      parties: [{ name: 'P 1', votes: 900_000, elected: 0, color: '#f4a400' }],
    };
    const rec = new Recorder(dir);
    await rec.record(key, publicado);

    const lido = (await new Recorder(dir).raceAt(key, 20_000))!;
    const p1 = lido.parties.find(p => p.name === 'P 1');
    assert.equal(p1?.votes, 900_000, 'o total do partido é o publicado, não a soma das linhas guardadas');
    assert.ok(lido.candidates.reduce((t, c) => t + c.votes, 0) < 900_000,
      'e a lista de candidaturas continua sendo o recorte — é justamente por isso que o total precisa vir à parte');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
