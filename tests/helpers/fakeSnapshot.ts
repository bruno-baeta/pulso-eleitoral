import { COLORS, OFFICES, STATES, type Office, type Race, type Snapshot, type Turn } from '../../shared/types.ts';

const names: Record<Office, string[]> = {
  president: ['Candidatura A', 'Candidatura B', 'Candidatura C', 'Candidatura D'],
  governor: ['Candidatura E', 'Candidatura F', 'Candidatura G'],
  senate: ['Candidatura H', 'Candidatura I', 'Candidatura J', 'Candidatura K'],
  federal: Array.from({ length: 60 }, (_, i) => `Candidatura ${String(i + 1).padStart(2, '0')}`),
  state: Array.from({ length: 84 }, (_, i) => `Candidatura ${String(i + 61).padStart(2, '0')}`),
};

export function demoRace(office: Office, uf: string, turn: Turn, now: number): Race {
  const tick = Math.floor(now / 3000);
  const phase = (tick % 400) / 400;
  // A full count from the first sections to 100% every 20 minutes, so the demo shows a whole race.
  const percent = 2 + phase * 98;
  const isNational = office === 'president';
  const salt = isNational ? 0 : STATES.findIndex(s => s.uf === uf);
  const totalSections = isNational ? 472000 : 12000 + salt * 2900;
  const counted = Math.floor(totalSections * percent / 100);
  const totalVotes = Math.round(counted * 235 * (office === 'senate' ? 2 : 1));
  const validVotes = Math.round(totalVotes * 0.945);
  const weights = names[office].map((_, i) => office === 'president' ? [47.32, 43.16, 6.27, 3.25][i] : office === 'governor' ? [48.76, 41.86, 9.38][i] : office === 'senate' ? [33.68, 28.54, 23.16, 14.62][i] : 1 / (i + 1.7));
  if (['president', 'governor', 'senate'].includes(office)) {
  // Enough movement in the fictitious race to show trend arrows and the occasional lead change.
  const swing = Math.sin(phase * 6) * (['federal', 'state'].includes(office) ? 0.015 : 2.6);
  weights[0] += swing;
  weights[1] -= swing;
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const seats = office === 'senate' ? 2 : office === 'federal' ? 53 : office === 'state' ? 77 : 1;
  // Fictional seat allocation for the demo: not the top of the list, so the arena shows that ranking ≠ election.
  // No candidate is ever flagged as elected in the demo: a partial count must not look like a result.
  const electedIdx = new Set<number>();
  const candidates = names[office].map((name, i) => ({
    id: `demo-${office}-${i}`, name, number: String((i + 1) * 10 + (office === 'federal' ? 1000 : office === 'state' ? 10000 : 0)),
    party: `P${String.fromCharCode(65 + i % 6)}*`, votes: Math.floor(validVotes * weights[i] / sum), percent: weights[i] / sum * 100,
    elected: electedIdx.has(i), status: electedIdx.has(i) ? (i % 2 ? 'Eleito por QP' : 'Eleito por média') : (office === 'federal' || office === 'state') && percent > 80 ? 'Suplente' : '', color: COLORS[i % COLORS.length],
  })).sort((a, b) => b.votes - a.votes);
  const history = Array.from({ length: 50 }, (_, i) => ({
    at: now - (49 - i) * 60_000,
    percent: Math.max(1, percent - (49 - i) * 1.07),
    votes: Math.round(validVotes * (0.28 + i / 49 * 0.72)),
    shares: Object.fromEntries(candidates.slice(0, 3).map((c, j) => [c.id, c.percent + (49 - i) * (j === 0 ? -0.04 : j === 1 ? 0.035 : 0.005) + Math.sin(i / 5) * 0.2 * (49 - i) / 49])),
  }));
  return {
    office, uf: isNational ? 'BR' : uf, election: '21272', turn, status: 'partial', generationId: `demo-${tick}`, sourceAt: null, totalizedAt: null,
    receivedAt: now, sourceUrl: '', seats,
    countedPercent: percent, countedSections: counted, totalSections, validVotes, totalVotes,
    blankVotes: Math.round(totalVotes * 0.018), nullVotes: Math.round(totalVotes * 0.037),
    electorate: totalSections * 300, turnout: Math.floor(counted * 240), abstention: Math.floor(counted * 60), abstentionPercent: 20,
    candidates, parties: Array.from({ length: 6 }, (_, i) => ({ name: `P${String.fromCharCode(65 + i)}*`, votes: candidates.filter(c => c.party === `P${String.fromCharCode(65 + i)}*`).reduce((a, c) => a + c.votes, 0), elected: candidates.filter(c => c.party === `P${String.fromCharCode(65 + i)}*` && c.elected).length, color: COLORS[i] })).sort((a, b) => b.votes - a.votes), history,
  };
}

/** Synthetic snapshot used only by the tests (the app no longer has a demo mode). */
export function fakeSnapshot(uf: string, turn: Turn, now = Date.now()): Snapshot {
  const offices = (Object.keys(OFFICES) as Office[]).filter(o => turn === 1 || ['president', 'governor'].includes(o));
  const races = Object.fromEntries(offices.map(o => [o, demoRace(o, uf, turn, now)]));
  return {
    mode: 'simulado', uf, turn, serverAt: now, races,
    connection: { status: 'waiting', message: 'Dados fictícios para explorar o painel. Não são resultados, pesquisas ou projeções.' },
  };
}
