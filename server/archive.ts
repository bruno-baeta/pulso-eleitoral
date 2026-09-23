import { ARCHIVE, OFFICES, distinctColors, partyColor, type Office, type Race, type StateProgress, type Turn } from '../shared/types.ts';
import { array, numeric, object, str, text, tseTime } from './tse.ts';

/**
 * Reader for the TSE's archived 2022 files (`dados-simplificados`). The archive
 * has its own layout — flat totals and one candidate list per file — so it gets
 * its own reader instead of bending the 2026 one, which must stay strict.
 */

export interface ArchiveRef { election: string; turn: Turn; office: Office; uf: string; url: string }

const OFFICE_CODE: Record<Office, number> = { president: 1, governor: 3, senate: 5, federal: 6, state: 7 };

export function archiveElection(office: Office, turn: Turn): string | null {
  const group = office === 'president' ? ARCHIVE.elections.president : ARCHIVE.elections.state;
  if (turn === 2 && !['president', 'governor'].includes(office)) return null;
  return group[turn] ?? null;
}

export function archiveRef(office: Office, uf: string, turn: Turn): ArchiveRef | null {
  const election = archiveElection(office, turn);
  const area = office === 'president' ? uf.toUpperCase() : uf.toUpperCase();
  if (!election || !/^(BR|[A-Z]{2})$/.test(area)) return null;
  if (turn === 2 && office === 'governor' && !(ARCHIVE.runoffStates as readonly string[]).includes(area)) return null;
  const code = area === 'DF' && office === 'state' ? 8 : OFFICE_CODE[office];
  const lower = area.toLowerCase();
  const url = `${ARCHIVE.base}/${election}/dados-simplificados/${lower}/${lower}-c${String(code).padStart(4, '0')}-e${election.padStart(6, '0')}-r.json`;
  return { election, turn, office, uf: area, url };
}

/** The archive marks a runoff berth with the same flag as a win; only `st` separates them. */
const isElected = (situation: string) => /^eleito/i.test(situation.trim());
const partyOf = (coalition: string) => str(coalition).split(' - ')[0].split('/')[0].trim().toUpperCase() || '—';

export function normalizeArchive(raw: unknown, expected: ArchiveRef, receivedAt = Date.now()): Race {
  const root = object(raw);
  if (str(root.ele) !== expected.election || Number(root.t) !== expected.turn || str(root.cdabr).toUpperCase() !== expected.uf) {
    throw new Error('Arquivo de outra eleição, turno ou abrangência');
  }
  const entries = array(root.cand);
  if (!entries.length) throw new Error('Arquivo do histórico sem candidaturas');
  const rows = entries.map(c => ({
    id: str(c.sqcand) || `${expected.uf}-${str(c.n)}`,
    name: text(c.nm),
    number: str(c.n),
    party: partyOf(str(c.cc)),
    votes: numeric(c.vap),
    percent: numeric(c.pvap),
    elected: isElected(str(c.st)),
    status: str(c.st),
  })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'pt-BR'));
  const colors = distinctColors(rows, row => row.party);
  const candidates = rows.map((row, i) => ({ ...row, color: colors[i] }));

  const byParty = new Map<string, { votes: number; elected: number }>();
  for (const candidate of candidates) {
    const entry = byParty.get(candidate.party) || { votes: 0, elected: 0 };
    entry.votes += candidate.votes;
    entry.elected += candidate.elected ? 1 : 0;
    byParty.set(candidate.party, entry);
  }
  const parties = [...byParty].map(([name, entry]) => ({ name, ...entry, color: partyColor(name) })).sort((a, b) => b.votes - a.votes);
  const electedCount = candidates.filter(c => c.elected).length;

  return {
    office: expected.office, uf: expected.uf, election: expected.election, turn: expected.turn,
    status: numeric(root.pst) >= 100 ? 'finished' : numeric(root.st) ? 'partial' : 'waiting',
    generationId: `${expected.election}-${expected.uf}-${expected.office}`,
    sourceAt: tseTime(root.dg, root.hg), totalizedAt: tseTime(root.dt, root.ht),
    receivedAt, sourceUrl: expected.url,
    seats: ['federal', 'state'].includes(expected.office) ? electedCount
      : expected.office === 'senate' ? Math.max(ARCHIVE.senateSeats, electedCount) : 1,
    countedPercent: numeric(root.pst), countedSections: numeric(root.st), totalSections: numeric(root.s),
    validVotes: numeric(root.vv), totalVotes: numeric(root.tv), blankVotes: numeric(root.vb), nullVotes: numeric(root.tvn),
    electorate: numeric(root.e), turnout: numeric(root.c), abstention: numeric(root.a), abstentionPercent: numeric(root.pa),
    candidates, parties, history: [],
  };
}

/** Per-state presidential results, used for the winner map and the state ranking. */
export function archiveProgress(files: { uf: string; race: Race }[]): StateProgress[] {
  return files.map(({ uf, race }) => {
    const [first, second] = race.candidates;
    return {
      uf,
      percent: race.countedPercent,
      sections: race.countedSections,
      total: race.totalSections,
      status: race.status,
      sourceAt: race.totalizedAt || race.sourceAt,
      leader: first ? {
        name: first.name, party: first.party, percent: first.percent, color: first.color,
        runnerUp: second?.name, margin: first.percent - (second?.percent || 0),
      } : undefined,
    };
  });
}

export const archiveOffices = (turn: Turn): Office[] =>
  (Object.keys(OFFICES) as Office[]).filter(office => archiveElection(office, turn) !== null);
