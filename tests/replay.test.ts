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
