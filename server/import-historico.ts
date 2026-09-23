/**
 * Turns the TSE's "Histórico de Totalização" CSV into a recording, so 2022 can be replayed from
 * the first section counted instead of showing only the final result.
 *
 * The CSV is the one public file that carries the count over time (one row per totalisation batch,
 * from 17:04 on election day). It only exists for Presidente/BR — every other race in the archive
 * is published as a final tally only, which is why this reconstructs the presidential line alone.
 *
 * Names, numbers, parties and colours are not in the CSV: they come from the archive's final file,
 * matched by name, so the ids here are the same ones the rest of the app uses.
 *
 *   npx tsx server/import-historico.ts data/Historico_Totalizacao_Presidente_BR_1T_2022.csv 1
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { archiveRef, normalizeArchive } from './archive.ts';
import type { Candidate, Race, Turn } from '../shared/types.ts';

/** One frame per batch is more than the charts can draw; this keeps the shape and loses the bulk. */
const MAX_FRAMES = 2000;

// The CSV writes a column name where the archive writes a person: `FELIPE_DAVILA` against
// `FELIPE D'AVILA`. Dropping everything that is not a letter or a digit makes the two meet.
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/gi, '').toUpperCase();
const num = (s: string) => Number(String(s).trim().replace(/\./g, '').replace(',', '.')) || 0;

/** `02/10/2022 17:04:47`, in Brasília time, which is UTC-3 on election day. */
function stamp(text: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Data não reconhecida: ${text}`);
  const [, d, mo, y, h, mi, s] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}-03:00`);
}

async function main() {
  const [file, turnArg] = process.argv.slice(2);
  if (!file) throw new Error('uso: import-historico.ts <csv> [turno]');
  const turn = (turnArg === '2' ? 2 : 1) as Turn;

  const ref = archiveRef('president', 'BR', turn);
  if (!ref) throw new Error('Sem referência de arquivo para presidente neste turno');
  const finalRace = normalizeArchive(await (await fetch(ref.url)).json(), ref);
  const byName = new Map(finalRace.candidates.map(c => [fold(c.name), c]));

  const text = await readFile(file, 'latin1');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(';').map(h => h.trim());
  const col = (name: string) => head.indexOf(name);

  // every `X_QT_VOTOS_TOT_ACUMULADO` is a candidacy, except the blank and null columns
  const cands: { c: Candidate; votes: number }[] = [];
  const missing: string[] = [];
  for (const [i, h] of head.entries()) {
    const m = /^(.+)_QT_VOTOS_TOT_ACUMULADO$/.exec(h);
    if (!m || ['BRANCO', 'NULO', 'QT_VOTOS_TOTAL', 'QT_VOTOS_CONCORRENTES'].includes(m[1])) continue;
    const c = byName.get(fold(m[1]));
    if (!c) { missing.push(m[1]); continue; }
    cands.push({ c, votes: i });
  }
  if (missing.length) throw new Error(`Candidaturas do CSV sem par no arquivo do TSE: ${missing.join(', ')}`);

  const iAt = col('DT_TOTALIZACAO'), iSecT = col('QT_SECOES_TOTAL'), iSec = col('QT_SECOES_TOT_ACUMULADO');
  const iPe = col('PE_SECOES_TOT_ACUMULADO'), iValid = col('QT_VOTOS_CONCORRENTES_ACUMULADO');
  const iTotal = col('QT_VOTOS_TOTAL_ACUMULADO'), iBranco = col('BRANCO_QT_VOTOS_TOT_ACUMULADO'), iNulo = col('NULO_QT_VOTOS_TOT_ACUMULADO');
  const iAptos = col('QT_APTOS_TOTAL'), iAptosAcc = col('QT_APTOS_TOT_ACUMULADO');
  for (const [name, i] of [['DT_TOTALIZACAO', iAt], ['QT_SECOES_TOT_ACUMULADO', iSec], ['QT_VOTOS_CONCORRENTES_ACUMULADO', iValid]] as const) {
    if (i < 0) throw new Error(`Coluna ausente no CSV: ${name}`);
  }

  const rows = lines.slice(1).map(l => l.split(';'));
  const stride = Math.max(1, Math.ceil(rows.length / MAX_FRAMES));
  const kept = rows.filter((_, i) => i % stride === 0 || i === rows.length - 1);

  const names = cands.map(({ c }) => ({ id: c.id, name: c.name, number: c.number, party: c.party, color: c.color }));
  let out = JSON.stringify({ m: names }) + '\n';
  for (const r of kept) {
    const valid = num(r[iValid]);
    const counted = iPe >= 0 ? num(r[iPe]) * 100 : (num(r[iSec]) / Math.max(1, num(r[iSecT]))) * 100;
    const electorate = num(r[iAptos]), voted = num(r[iAptosAcc]);
    const race: Omit<Race, 'candidates' | 'parties' | 'history'> = {
      office: 'president', uf: 'BR', election: ref.election, turn,
      // the last batch is the closed count; everything before it is still being totalised
      status: r === kept[kept.length - 1] ? 'finished' : 'partial',
      generationId: `hist-${stamp(r[iAt])}`, sourceAt: null, totalizedAt: null,
      receivedAt: stamp(r[iAt]), sourceUrl: file,
      seats: 1, countedPercent: counted, countedSections: num(r[iSec]), totalSections: num(r[iSecT]),
      validVotes: valid, totalVotes: num(r[iTotal]), blankVotes: num(r[iBranco]), nullVotes: num(r[iNulo]),
      electorate, turnout: voted, abstention: Math.max(0, electorate - voted),
      abstentionPercent: electorate ? Math.max(0, electorate - voted) / electorate * 100 : 0,
    };
    const frameRows = cands.map(({ c, votes }) => {
      const v = num(r[votes]);
      return [c.id, v, valid ? v / valid * 100 : 0, 0, 'counting'] as const;
    });
    out += JSON.stringify({ f: { at: race.receivedAt, race, rows: frameRows } }) + '\n';
  }

  const path = `./data/recordings/historico/${ref.election}/t${turn}/br-president.ndjson`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, out);
  const first = stamp(kept[0][iAt]), last = stamp(kept[kept.length - 1][iAt]);
  console.log(`${path}: ${kept.length} quadros de ${rows.length} linhas, ${cands.length} candidaturas`);
  console.log(`de ${new Date(first).toISOString()} a ${new Date(last).toISOString()}`);
}

main().catch(err => { console.error(err); process.exit(1); });
