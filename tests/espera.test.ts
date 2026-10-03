import test from 'node:test';
import assert from 'node:assert/strict';
import { espera, relogioDeContagem } from '../src/lenses/tv/espera.ts';
import { OFFICIAL_WINDOWS } from '../shared/windows.ts';

const oficial = { oficial: true, reproduzindo: false, turno: 1 as const, temApuracao: false };
const em = (iso: string) => Date.parse(iso);

test('na véspera, a TV espera as 17h do dia 4 e conta o tempo que falta', () => {
  const e = espera(oficial, em('2026-10-03T17:00:00-03:00'));
  assert.equal(e?.fase, 'antes');
  assert.equal(e?.fase === 'antes' && e.inicio, em('2026-10-04T17:00:00-03:00'));
  assert.equal(e?.fase === 'antes' && relogioDeContagem(e.faltam), '24:00:00');
});

test('com a coleta aberta às 16h, ainda é espera: a contagem só começa às 17h', () => {
  assert.equal(espera(oficial, em('2026-10-04T16:30:00-03:00'))?.fase, 'antes');
});

test('depois das 17h sem seção apurada, a tela diz que busca os primeiros resultados', () => {
  assert.equal(espera(oficial, em('2026-10-04T17:02:00-03:00'))?.fase, 'buscando');
});

test('a primeira seção apurada tira a espera da tela', () => {
  assert.equal(espera({ ...oficial, temApuracao: true }, em('2026-10-04T17:05:00-03:00')), null);
});

test('replay e histórico nunca mostram espera', () => {
  assert.equal(espera({ ...oficial, reproduzindo: true }, em('2026-10-03T17:00:00-03:00')), null);
  assert.equal(espera({ ...oficial, oficial: false }, em('2026-10-03T17:00:00-03:00')), null);
});

test('no segundo turno, a espera é a do dia 25', () => {
  const e = espera({ ...oficial, turno: 2 }, em('2026-10-20T12:00:00-03:00'));
  assert.equal(e?.fase === 'antes' && e.inicio, em('2026-10-25T17:00:00-03:00'));
});

test('depois que a janela fecha, não se espera mais nada', () => {
  assert.equal(espera(oficial, em('2026-10-06T10:00:00-03:00'), OFFICIAL_WINDOWS), null);
});

test('a contagem não fica negativa', () => {
  assert.equal(relogioDeContagem(-5000), '00:00:00');
});
