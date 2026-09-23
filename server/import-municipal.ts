/**
 * Turns the TSE's "Votação por seção eleitoral" CSV into the Território builds.
 *
 * Território needs, per municipality, the votes of each candidacy and the valid total. The TSE
 * publishes that through Divulga as one file per municipality AND per office — a state costs
 * hundreds of requests, 3.412 for Minas across its four races. The same numbers are in a single
 * per-state CSV of section results, so when that file is at hand the whole state is built offline.
 *
 * The CSV has no time in it: `DT_GERACAO` is when the file was written, identical on every row.
 * It rebuilds the map, never the race over time.
 *
 *   npx tsx server/import-municipal.ts /caminho/votacao_secao_2022_MG.csv [turno]
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ARCHIVE, type Office, type Turn } from '../shared/types.ts';
import { archiveElection, archiveRef, normalizeArchive } from './archive.ts';

/** TSE office codes as they appear in CD_CARGO. 8 is the Federal District's own assembly. */
const OFFICE: Record<string, Office> = { 1: 'president', 3: 'governor', 5: 'senate', 6: 'federal', 7: 'state', 8: 'state' };
/**
 * SQ_CANDIDATO separates what is a candidacy from what is not: -1 is a blank or null vote and -3 is
 * a legend vote, cast on the party's own number. In a proportional race the legend is a large share
 * — 374 mil votes for the federal deputies of Minas alone — and counting it as a candidacy inflates
 * both the party and the city's valid total.
 */
const isCandidacy = (sq: string) => Number(sq) > 0;
/** A legend vote is cast on the party, not on a name: no candidacy, but a valid vote all the same. */
const isLegend = (sq: string) => Number(sq) === -3;

interface Muni { cdi: string; nm: string; uf: string }
interface Acc { vv: number; cand: Map<string, number> }

/**
 * The section file lists every number the urn accepted, including candidacies the courts later
 * threw out — their votes are cast but not counted. The file has no status column, so the official
 * result of the race is what says which numbers are candidacies that count.
 */
async function validNumbers(office: Office, uf: string, turn: Turn): Promise<Set<string> | null> {
  const ref = archiveRef(office, uf, turn);
  if (!ref) return null;
  try {
    const race = normalizeArchive(await (await fetch(ref.url)).json(), ref);
    return new Set(race.candidates.map(c => c.number));
  } catch { return null; }
}

/** The municipal configuration is the only place that ties the TSE's own code to the IBGE one. */
async function municipalities(election: string): Promise<Map<string, Muni>> {
  const url = `${ARCHIVE.base}/${election}/config/mun-e${election.padStart(6, '0')}-cm.json`;
  const raw = await (await fetch(url)).json() as { abr: { cd: string; mu: { cd: string; cdi: string; nm: string }[] }[] };
  const out = new Map<string, Muni>();
  for (const uf of raw.abr) for (const m of uf.mu) out.set(String(Number(m.cd)), { cdi: m.cdi, nm: m.nm, uf: uf.cd });
  return out;
}

/** 1,9 GB of latin-1 text: read as bytes, decode per chunk (single-byte, so lines never split badly). */
async function* lines(path: string) {
  let rest = '';
  for await (const chunk of createReadStream(path)) {
    const text = rest + (chunk as Buffer).toString('latin1');
    const parts = text.split('\n');
    rest = parts.pop() ?? '';
    for (const line of parts) yield line;
  }
  if (rest) yield rest;
}

async function main() {
  const [file, turnArg] = process.argv.slice(2);
  if (!file) throw new Error('uso: import-municipal.ts <csv de votação por seção> [turno]');
  const wantTurn = (turnArg === '2' ? 2 : 1) as Turn;

  const election = archiveElection('governor', wantTurn);
  if (!election) throw new Error(`Sem eleição de arquivo para o turno ${wantTurn}`);
  const muni = await municipalities(election);

  // office -> municipality (TSE code) -> tally
  const byOffice = new Map<Office, Map<string, Acc>>();
  let rows = 0, skipped = 0, uf = '';
  let cols: Record<string, number> | null = null;
  for await (const line of lines(file)) {
    if (!line.trim()) continue;
    const f = line.split(';');
    for (let i = 0; i < f.length; i++) { const v = f[i]; if (v.charCodeAt(0) === 34) f[i] = v.slice(1, -1); }
    if (!cols) { cols = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    if (f[cols.NR_TURNO] !== String(wantTurn)) { skipped++; continue; }
    const office = OFFICE[f[cols.CD_CARGO]];
    if (!office) { skipped++; continue; }
    uf ||= f[cols.SG_UF];
    const votes = Number(f[cols.QT_VOTOS]) || 0;
    const key = String(Number(f[cols.CD_MUNICIPIO]));
    let table = byOffice.get(office);
    if (!table) { table = new Map(); byOffice.set(office, table); }
    let acc = table.get(key);
    if (!acc) { acc = { vv: 0, cand: new Map() }; table.set(key, acc); }
    const sq = f[cols.SQ_CANDIDATO];
    // A legend vote counts towards the city's valid total without belonging to any name.
    if (isLegend(sq)) { acc.vv += votes; continue; }
    if (!isCandidacy(sq)) continue;
    acc.cand.set(f[cols.NR_VOTAVEL], (acc.cand.get(f[cols.NR_VOTAVEL]) ?? 0) + votes);
    rows++;
  }
  if (!cols) throw new Error('CSV vazio');

  for (const [office, table] of byOffice) {
    const valid = await validNumbers(office, uf, wantTurn);
    let dropped = 0;
    for (const acc of table.values()) {
      for (const [n, v] of acc.cand) {
        if (valid && !valid.has(n)) { acc.cand.delete(n); dropped += v; continue; }
        acc.vv += v;   // the valid total is the candidacies that count, plus the legend
      }
    }
    const totals = new Map<string, number>();
    for (const acc of table.values()) for (const [n, v] of acc.cand) totals.set(n, (totals.get(n) ?? 0) + v);
    const c = [...totals].sort((a, b) => b[1] - a[1]);
    const index = new Map(c.map(([n], i) => [n, i]));
    const m: [string, string, string, number, number[]][] = [];
    const unknown: string[] = [];
    for (const [cd, acc] of table) {
      const ref = muni.get(cd);
      if (!ref) { unknown.push(cd); continue; }
      // The wire format is "pairs by votes": the reader takes the first as the city's winner and
      // the position in the list as the place. Written in the order the CSV happened to list them,
      // a candidacy with three votes came out as the winner of Itabira.
      const byVotes = [...acc.cand].sort((a, b) => b[1] - a[1]);
      m.push([ref.cdi, ref.nm, ref.uf, acc.vv, byVotes.flatMap(([n, v]) => [index.get(n)!, v])]);
    }
    if (unknown.length) throw new Error(`Municípios do CSV sem par na configuração do TSE: ${unknown.slice(0, 5).join(', ')}`);
    const path = `./data/municipal/historico-t${wantTurn}-${uf.toLowerCase()}-${office}.json`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ c, m }));
    const total = c.reduce((a, [, v]) => a + v, 0);
    console.log(`${path}: ${m.length} municípios, ${c.length} candidaturas, ${total.toLocaleString('pt-BR')} votos nominais`
      + (dropped ? `, ${dropped.toLocaleString('pt-BR')} votos em candidaturas fora do resultado oficial descartados` : ''));
  }
  console.log(`${rows.toLocaleString('pt-BR')} linhas usadas, ${skipped.toLocaleString('pt-BR')} ignoradas (outro turno ou cargo)`);
}

main().catch(err => { console.error(err); process.exit(1); });
