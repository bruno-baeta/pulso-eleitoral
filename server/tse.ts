import { OFFICES, partyColor, type Race, type Office, type Turn, type StateProgress } from '../shared/types.ts';

type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
export const array = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(object) : [];
export const str = (value: unknown): string => value == null ? '' : String(value);

/**
 * The TSE ships names XML-escaped inside JSON: `FELIPE D&apos;AVILA`. Anything that renders one
 * without undoing that shows the entity to the reader, so every name goes through here.
 */
const ENTITIES: Record<string, string> = { apos: "'", quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' };
export const text = (value: unknown): string => str(value)
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });

export function numeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = str(value).trim();
  const n = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(n) ? n : 0;
}

export function tseTime(date: unknown, time: unknown): string | null {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(date));
  if (!parts || !/^\d{2}:\d{2}:\d{2}$/.test(str(time))) return null;
  const iso = `${parts[3]}-${parts[2]}-${parts[1]}T${time}-03:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export interface ElectionRef { code: string; cycle: string; turn: Turn; offices: number[]; ufs: string[] }

/** Read EA11; never infer an official election ID from previous years or simulated IDs. */
export function discoverElections(raw: unknown, simulated = false): ElectionRef[] {
  const root = object(raw);
  if (root.f !== (simulated ? 's' : 'o')) return [];
  const refs: ElectionRef[] = [];
  for (const pleito of array(root.pl)) {
    // The 2026 file carries the cycle on each pleito; older layouts carried it at the root.
    const cycle = str(pleito.c ?? root.c);
    if (cycle !== 'ele2026') continue;
    for (const election of array(pleito.e)) {
      const turn = Number(election.t);
      if ((turn !== 1 && turn !== 2) || !/^\d{1,6}$/.test(str(election.cd))) continue;
      if (!simulated && pleito.dt !== (turn === 1 ? '04/10/2026' : '25/10/2026')) continue;
      for (const scope of array(election.abr)) {
        const offices = array(scope.cp).map(c => numeric(c.cd)).filter(c => [1, 3, 5, 6, 7, 8].includes(c));
        if (offices.length) refs.push({ code: str(election.cd), cycle, turn, offices, ufs: [str(scope.cd).toUpperCase()] });
      }
    }
  }
  return refs;
}

export function officeCode(office: Office, uf: string): number {
  return office === 'state' && uf === 'DF' ? 8 : OFFICES[office].code;
}

export const BASES = {
  official: 'https://resultados.tse.jus.br/oficial',
  simulado: 'https://resultados-sim.tse.jus.br/simulado/simulado2026',
};

export function resultUrl(base: string, election: ElectionRef, uf: string, office?: Office): string {
  const area = uf.toLowerCase();
  if (!/^(br|[a-z]{2})$/.test(area) || !/^\d{1,6}$/.test(election.code) || election.cycle !== 'ele2026') throw new Error('Parâmetros TSE inválidos');
  const suffix = office ? `c${String(officeCode(office, uf)).padStart(4, '0')}-e${election.code.padStart(6, '0')}-u` : `e${election.code.padStart(6, '0')}-ab`;
  return `${base}/${election.cycle}/${election.code}/dados/${area}/${area}-${suffix}.json`;
}

export interface ExpectedResult { office: Office; uf: string; election: string; turn: Turn; simulated: boolean; url: string }

export function normalizeResult(raw: unknown, expected: ExpectedResult, receivedAt = Date.now()): Race {
  const root = object(raw);
  if (str(root.ele) !== expected.election || Number(root.t) !== expected.turn || root.f !== (expected.simulated ? 's' : 'o') || str(root.cdabr).toUpperCase() !== expected.uf || root.sup === 's') {
    throw new Error('Arquivo de outra eleição, fase, turno ou abrangência');
  }
  if (root.dv === 'n') throw new Error('Divulgação ainda não autorizada pela fonte');
  const cargo = array(root.carg).find(c => Number(c.cd) === officeCode(expected.office, expected.uf));
  if (!cargo || !root.s || !root.e || !root.v) throw new Error('Estrutura EA20 não reconhecida');
  const sections = object(root.s), voters = object(root.e), votes = object(root.v);
  const candidates: Race['candidates'] = [];
  const parties: Race['parties'] = [];
  for (const group of array(cargo.agr)) {
    for (const party of array(group.par)) {
      const color = partyColor(str(party.sg));
      const partyCandidates = array(party.cand).map(c => ({
        id: str(c.sqcand) || `${party.n}-${c.n}`,
        name: text(c.nmu) || text(c.nm),
        number: str(c.n), party: str(party.sg), votes: numeric(c.vap),
        percent: numeric(c.pvapn ?? c.pvap),
        elected: c.e === 's', status: str(c.st), color,
      }));
      candidates.push(...partyCandidates);
      parties.push({ name: text(party.sg), votes: numeric(party.tvtn) + numeric(party.tvtl), elected: partyCandidates.filter(c => c.elected).length, color });
    }
  }
  candidates.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'pt-BR'));
  parties.sort((a, b) => b.votes - a.votes);
  return {
    office: expected.office, uf: expected.uf, election: expected.election, turn: expected.turn,
    status: root.and === 'f' ? 'finished' : root.and === 'p' ? 'partial' : 'waiting',
    generationId: str(root.idg), sourceAt: tseTime(root.dg, root.hg), totalizedAt: tseTime(root.dt, root.ht),
    receivedAt, sourceUrl: expected.url, seats: numeric(cargo.nv),
    countedPercent: numeric(sections.pstn ?? sections.pst), countedSections: numeric(sections.st), totalSections: numeric(sections.ts),
    validVotes: numeric(votes.vv), totalVotes: numeric(votes.tv), blankVotes: numeric(votes.vb), nullVotes: numeric(votes.tvn),
    electorate: numeric(voters.te), turnout: numeric(voters.c), abstention: numeric(voters.a), abstentionPercent: numeric(voters.pan ?? voters.pa),
    candidates, parties, history: [],
  };
}

export function normalizeProgress(raw: unknown, election: ElectionRef, simulated: boolean): StateProgress[] {
  const root = object(raw);
  if (str(root.ele) !== election.code || Number(root.t) !== election.turn || root.f !== (simulated ? 's' : 'o') || !Array.isArray(root.abr)) throw new Error('EA14 de outra eleição ou formato não reconhecido');
  return array(root.abr).filter(a => a.tpabr === 'uf').map(a => {
    const s = object(a.s);
    return { uf: str(a.cdabr).toUpperCase(), percent: numeric(s.pstn ?? s.pst), sections: numeric(s.st), total: numeric(s.ts), status: a.and === 'f' ? 'finished' : a.and === 'p' ? 'partial' : 'waiting', sourceAt: tseTime(a.dt, a.ht) };
  });
}
