export type Mode = 'official' | 'historico' | 'simulado';
export type Turn = 1 | 2;
export type Office = 'president' | 'governor' | 'senate' | 'federal' | 'state';
export type ResultStatus = 'waiting' | 'partial' | 'finished';

export interface Candidate {
  id: string;
  name: string;
  number: string;
  party: string;
  votes: number;
  percent: number;
  elected: boolean;
  status: string;
  color: string;
}

export interface Party {
  name: string;
  votes: number;
  elected: number;
  color: string;
}

export interface HistoryPoint {
  at: number;
  percent: number;
  votes: number;
  shares: Record<string, number>;
}

export interface Race {
  office: Office;
  uf: string;
  election: string;
  turn: Turn;
  status: ResultStatus;
  generationId: string;
  sourceAt: string | null;
  totalizedAt: string | null;
  receivedAt: number;
  sourceUrl: string;
  seats: number;
  countedPercent: number;
  countedSections: number;
  totalSections: number;
  validVotes: number;
  totalVotes: number;
  blankVotes: number;
  nullVotes: number;
  electorate: number;
  turnout: number;
  abstention: number;
  abstentionPercent: number;
  candidates: Candidate[];
  parties: Party[];
  history: HistoryPoint[];
  /** Set when `candidates` carries only the head of a much longer list. */
  candidateCount?: number;
}

export interface StateProgress {
  uf: string;
  percent: number;
  sections: number;
  total: number;
  status: ResultStatus;
  sourceAt: string | null;
  /** Presidential leader in the state, when the source publishes results by UF. */
  leader?: { name: string; party: string; percent: number; color: string; runnerUp?: string; margin: number };
}

export interface FeedEvent {
  id: string;
  at: number;
  /** Where it happened, so a reader can be told only about what they chose to watch. */
  uf?: string;
  office?: Office;
  /** Who it is about: the candidacy's number and party, for the same reason. */
  who?: { name: string; number: string; party: string; color: string };
  /**
   * What happened. `lead` is a change of who is ahead, `elected` a seat the source declared
   * decided, `milestone` a round share of the count being crossed — the three things worth being
   * told about while looking somewhere else. `update` stays for anything else.
   */
  kind: 'update' | 'finished' | 'info' | 'lead' | 'elected' | 'milestone';
  title: string;
  detail: string;
}

/**
 * A disputa como ela viaja até o navegador.
 *
 * `Race` é o que o coletor guarda; isto é o que alguma tela lê. A diferença não é estética: o
 * snapshot vai inteiro pelo fluxo de eventos a cada leitura aceita, e os campos de fora — a série
 * histórica, a lista de partidos, a URL de origem, os totais de eleitorado e comparecimento —
 * somavam um quinto do peso sem ninguém consultar. A série tem rota própria (/api/series), a
 * bancada é contada a partir das candidaturas e o resto não é desenhado em lugar nenhum.
 */
export type WireRace = Omit<Race,
  'history' | 'parties' | 'sourceUrl' | 'receivedAt' | 'totalizedAt' | 'totalSections'
  | 'totalVotes' | 'blankVotes' | 'nullVotes' | 'electorate' | 'turnout' | 'abstention' | 'abstentionPercent'>;

export interface Snapshot {
  mode: Mode;
  uf: string;
  turn: Turn;
  serverAt: number;
  races: Partial<Record<Office, WireRace>>;
  /** The presidential race counted inside `uf` alone, when the source publishes it by state. */
  presidentUf?: WireRace;
  connection: {
    status: 'waiting' | 'live' | 'degraded' | 'cooldown' | 'archive';
    message: string;
  };
}

export const OFFICES: Record<Office, { title: string; short: string; code: number }> = {
  president: { title: 'Presidência da República', short: 'Presidência', code: 1 },
  governor: { title: 'Governo do estado', short: 'Governador', code: 3 },
  senate: { title: 'Senado Federal', short: 'Senado', code: 5 },
  federal: { title: 'Câmara dos Deputados', short: 'Deputados federais', code: 6 },
  state: { title: 'Assembleia Legislativa', short: 'Deputados estaduais', code: 7 },
};

/**
 * Categorical slots, fixed order, stepped for the dark surface (#131315).
 * Identity never comes from colour alone: every mark is labelled with the name
 * and the party, so a repeated slot across different panels stays readable.
 */
export const COLORS = ['#2f7bf5', '#17d4c5', '#7b3fe4', '#f4a400', '#ff6a3d', '#4cc3ff', '#9be33b', '#e03b3b'];
/** Neutral for the tail beyond the slots a chart form can safely carry. */
export const COLOR_OTHER = '#8a94a6';

/**
 * Slot pairs that fail the separation gates on the dark surface, measured with
 * the data-viz validator (normal-vision ΔE < 15 or simulated CVD ΔE < 6).
 * Neighbouring marks never use a pair listed here.
 */
const CLASHING = new Set(['0-6', '1-3', '1-4', '1-5', '1-7', '2-4', '2-5', '3-7', '4-7']);
const clash = (a: number, b: number) => CLASHING.has(a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Only two party colours are a public convention in Brazil, so only those two are
 * reserved: red is always PT, blue is always PL, and no other party may take them.
 * The rest hash into the remaining slots — stable per party, and never claiming an
 * identity the reader already assigned to someone else.
 */
const RESERVED: Record<string, number> = { PT: 7, PL: 0 };
const SHARED = [1, 2, 3, 4, 5, 6];

export function partySlot(party: string): number {
  const key = party.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (key in RESERVED) return RESERVED[key];
  let hash = 0;
  for (const char of key) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return SHARED[Math.abs(hash) % SHARED.length];
}
export const partyColor = (party: string): string => COLORS[partySlot(party)];

/**
 * Colours for one panel's list of marks: each keeps its party's slot unless that
 * slot is already taken or would clash with the mark directly above it.
 */
export function distinctColors<T>(items: T[], party: (item: T) => string): string[] {
  const used = new Set<number>();
  let previous = -1;
  return items.map(item => {
    const name = party(item).trim().toUpperCase().replace(/[^A-Z]/g, '');
    const wanted = partySlot(name);
    // A reserved colour never moves: PT stays red and PL stays blue in every panel.
    let slot = wanted;
    if (!(name in RESERVED)) {
      const start = SHARED.indexOf(wanted);
      let free = -1;
      slot = -1;
      for (let step = 0; step < SHARED.length; step++) {
        const option = SHARED[(start + step) % SHARED.length];
        if (used.has(option)) continue;
        if (free < 0) free = option;
        if (previous < 0 || !clash(previous, option)) { slot = option; break; }
      }
      // Reusing a colour is worse than a close pair: names and parties label every mark,
      // so a repeated hue is the one failure that actually misleads.
      if (slot < 0) slot = free >= 0 ? free : wanted;
    }
    used.add(slot);
    previous = slot;
    return COLORS[slot];
  });
}

export const STATES = [
  { uf: 'AC', name: 'Acre', id: '12', region: 'Norte' },
  { uf: 'AL', name: 'Alagoas', id: '27', region: 'Nordeste' },
  { uf: 'AP', name: 'Amapá', id: '16', region: 'Norte' },
  { uf: 'AM', name: 'Amazonas', id: '13', region: 'Norte' },
  { uf: 'BA', name: 'Bahia', id: '29', region: 'Nordeste' },
  { uf: 'CE', name: 'Ceará', id: '23', region: 'Nordeste' },
  { uf: 'DF', name: 'Distrito Federal', id: '53', region: 'Centro-Oeste' },
  { uf: 'ES', name: 'Espírito Santo', id: '32', region: 'Sudeste' },
  { uf: 'GO', name: 'Goiás', id: '52', region: 'Centro-Oeste' },
  { uf: 'MA', name: 'Maranhão', id: '21', region: 'Nordeste' },
  { uf: 'MT', name: 'Mato Grosso', id: '51', region: 'Centro-Oeste' },
  { uf: 'MS', name: 'Mato Grosso do Sul', id: '50', region: 'Centro-Oeste' },
  { uf: 'MG', name: 'Minas Gerais', id: '31', region: 'Sudeste' },
  { uf: 'PA', name: 'Pará', id: '15', region: 'Norte' },
  { uf: 'PB', name: 'Paraíba', id: '25', region: 'Nordeste' },
  { uf: 'PR', name: 'Paraná', id: '41', region: 'Sul' },
  { uf: 'PE', name: 'Pernambuco', id: '26', region: 'Nordeste' },
  { uf: 'PI', name: 'Piauí', id: '22', region: 'Nordeste' },
  { uf: 'RJ', name: 'Rio de Janeiro', id: '33', region: 'Sudeste' },
  { uf: 'RN', name: 'Rio Grande do Norte', id: '24', region: 'Nordeste' },
  { uf: 'RS', name: 'Rio Grande do Sul', id: '43', region: 'Sul' },
  { uf: 'RO', name: 'Rondônia', id: '11', region: 'Norte' },
  { uf: 'RR', name: 'Roraima', id: '14', region: 'Norte' },
  { uf: 'SC', name: 'Santa Catarina', id: '42', region: 'Sul' },
  { uf: 'SP', name: 'São Paulo', id: '35', region: 'Sudeste' },
  { uf: 'SE', name: 'Sergipe', id: '28', region: 'Nordeste' },
  { uf: 'TO', name: 'Tocantins', id: '17', region: 'Norte' },
];

/**
 * Archived election kept for exploring the panel with real results.
 * Codes read from the TSE's own published files: 544/545 carry the presidential
 * race, 546/547 every state-level race. Nothing here is inferred from 2026.
 */
export const ARCHIVE = {
  year: 2022,
  cycle: 'ele2022',
  base: 'https://resultados.tse.jus.br/oficial/ele2022',
  elections: { president: { 1: '544', 2: '545' }, state: { 1: '546', 2: '547' } },
  dates: { 1: '2022-10-02', 2: '2022-10-30' },
  /** States that held a second round for governor in 2022. */
  runoffStates: ['AL', 'AM', 'BA', 'ES', 'MS', 'PB', 'PE', 'RS', 'RO', 'SC', 'SP', 'SE'],
  /** The Senate renewed one third of its seats in 2022: one seat per state. */
  senateSeats: 1,
} as const;

export const ELECTION_DATES: Record<Turn, string> = {
  1: '2026-10-04T17:00:00-03:00',
  2: '2026-10-25T17:00:00-03:00',
};
export const TSE_DOCS = 'https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados';

/*
 * A disputa inteira no fio, com as candidaturas em listas posicionais.
 *
 * Uma proporcional tem mais de mil e quinhentas candidaturas, e como objeto JSON cada uma repete
 * os nove nomes de campo: medido em Minas, 282 KB no deputado estadual e 211 KB no federal, dos
 * quais quase metade eram as chaves. Pela rede de casa isso é o intervalo entre abrir a tabela e
 * ela mostrar a lista inteira. A ordem abaixo é o contrato; mexer nela é mexer nos dois lados.
 */
export const CAMPOS_CANDIDATURA = ['id', 'name', 'number', 'party', 'votes', 'percent', 'elected', 'status', 'color'] as const;
export type CandidaturaCompacta = [string, string, string, string, number, number, 0 | 1, string, string];

export function compactarCandidatura(c: Candidate): CandidaturaCompacta {
  return [c.id, c.name, c.number, c.party, c.votes, c.percent, c.elected ? 1 : 0, c.status, c.color];
}

export function expandirCandidatura(l: CandidaturaCompacta): Candidate {
  const [id, name, number, party, votes, percent, elected, status, color] = l;
  return { id, name, number, party, votes, percent, elected: elected === 1, status, color };
}
