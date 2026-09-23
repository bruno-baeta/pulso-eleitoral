/**
 * O que é gravado numa janela do TSE.
 *
 * Gravação não se recupera: o arquivo que o TSE publicou às 10h04 não existe mais às 18h, e quem
 * não o buscou na hora fica sem aquele instante para sempre. Nas duas janelas de 22/09 só Minas
 * tinha sido gravada, e abrir São Paulo no dia seguinte mostrava uma tela sem linha do tempo. Este
 * teste existe para que a lista de estados gravados não volte a encolher sem que alguém perceba.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Collector } from '../server/collector.ts';
import { STATES } from '../shared/types.ts';

const DIR = './.teste-gravacao';
const dentro = Date.parse('2026-09-24T10:30:00-03:00');   // janela da manhã de uma quinta de teste
const fora = Date.parse('2026-09-24T13:00:00-03:00');     // entre as duas janelas

const comAmbiente = async (ufs: string | undefined, fn: (c: Collector) => void) => {
  const antes = process.env.RECORD_UFS;
  if (ufs === undefined) delete process.env.RECORD_UFS; else process.env.RECORD_UFS = ufs;
  const c = new Collector(DIR);
  try { fn(c); } finally {
    c.transport.close();
    if (antes === undefined) delete process.env.RECORD_UFS; else process.env.RECORD_UFS = antes;
    await rm(DIR, { recursive: true, force: true });
  }
};

test('por padrão a janela grava todos os estados, não só o que está na tela', async () => {
  await comAmbiente(undefined, c => {
    const ctx = c.liveContexts(dentro);
    assert.equal(ctx.length, STATES.length, 'todo estado publicado pelo TSE tem de ser gravado');
    for (const uf of ['SP', 'MG', 'BA', 'RS', 'AC']) {
      assert.ok(ctx.some(x => x.uf === uf && x.mode === 'simulado' && x.turn === 1), `faltou ${uf}`);
    }
  });
});

test('fora da janela nada é colhido: o TSE não publica e não há o que gravar', async () => {
  await comAmbiente(undefined, c => assert.deepEqual(c.liveContexts(fora), []));
});

test('RECORD_UFS continua podendo estreitar a gravação, quando for o caso', async () => {
  await comAmbiente('MG,SP', c => {
    assert.deepEqual(c.liveContexts(dentro).map(x => x.uf).sort(), ['MG', 'SP']);
  });
});
