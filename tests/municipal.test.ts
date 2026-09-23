import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAb, parseMunicipal, readConfig } from '../server/municipal.ts';

const ab = JSON.parse(readFileSync(new URL('./fixtures/territorio-ab-mg.json', import.meta.url), 'utf8'));

test('andamento por UF (-ab): um carimbo por município, só entradas "mun"', () => {
  const parsed = parseAb(ab, '21272');
  assert.equal(parsed.cities.size, ab.abr.filter((a: { tpabr: string }) => a.tpabr === 'mun').length);
  const first = parsed.cities.get('42510')!;
  assert.equal(first.ht, '10:45:45');
  assert.equal(first.finished, true);
  assert.equal(first.te, 11665);
  assert.match(first.stamp, /^17\/09\/2026 10:45:45\|56\|f$/);
  assert.ok(parsed.sourceAt?.startsWith('2026-09-17T11:01:25'));
  assert.throws(() => parseAb(ab, '21270'), /outra eleição/);
});

test('o carimbo muda quando a totalização ou as seções mudam', () => {
  const copy = structuredClone(ab);
  const before = parseAb(copy, '21272').cities.get('42510')!.stamp;
  copy.abr.find((a: { cdabr: string }) => a.cdabr === '42510').ht = '10:50:00';
  assert.notEqual(parseAb(copy, '21272').cities.get('42510')!.stamp, before);
});

test('arquivo municipal: layout de 2022 (abr → cand) e de 2026 (carg → agr → par → cand)', () => {
  const v2022 = { ele: '546', abr: [{ tpabr: 'MU', cdabr: '41238', vv: '100', cand: [{ n: '30', vap: '60' }, { n: '55', vap: '40' }, { n: '22', vap: '0' }] }] };
  assert.deepEqual(parseMunicipal(v2022, { election: '546', cd: '41238', office: 'governor', uf: 'MG' }), { vv: 100, cand: [['30', 60], ['55', 40]], sourceAt: null });
  const u2026 = { ele: '21272', cdabr: '41238', v: { vv: '90' }, carg: [{ cd: '3', agr: [{ par: [{ cand: [{ n: '10', vap: '30' }] }, { cand: [{ n: '20', vap: '60' }] }] }] }] };
  assert.deepEqual(parseMunicipal(u2026, { election: '21272', cd: '41238', office: 'governor', uf: 'MG' }).cand, [['20', 60], ['10', 30]]);
  assert.throws(() => parseMunicipal(v2022, { election: '546', cd: '99999', office: 'governor', uf: 'MG' }), /outro município/);
});

test('configuração municipal: exterior excluído, códigos com 5 dígitos', () => {
  const cfg = { abr: [{ cd: 'MG', mu: [{ cd: '1120', cdi: '3100104', nm: 'ABADIA', c: 'N' }] }, { cd: 'ZZ', mu: [{ cd: '29998', cdi: '9999999', nm: 'EXTERIOR' }] }] };
  assert.deepEqual(readConfig(cfg, 'BR'), [{ uf: 'MG', cd: '01120', cdi: '3100104', nm: 'ABADIA', capital: false }]);
  assert.equal(readConfig(cfg, 'SP').length, 0);
});
