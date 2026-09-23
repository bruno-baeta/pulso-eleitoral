/**
 * O que o cliente deriva do que o TSE publicou.
 *
 * Nada aqui inventa resultado: a situação vem do campo que a fonte manda, e o que esta camada
 * acrescenta é a ordem da lista e a leitura da parcial — "lidera", "na faixa de eleição" —, que
 * são fatos sobre a contagem em curso, nunca sobre o desfecho.
 */
import { STATES, type Candidate, type Office, type WireRace as Race } from '../../shared/types';

/** A situação de uma candidatura: o que a fonte declarou, ou a leitura da parcial. */
export type CandidateStatus =
  | 'elected' | 'runoff' | 'leading' | 'in_seat_range' | 'alternate' | 'not_elected' | 'counting' | 'no_data';

/** A candidatura com o que a tela acrescenta ao lê-la: a ordem, a situação e a distância. */
export interface RankedCandidate extends Candidate {
  rank: number;
  statusKey: CandidateStatus;
  statusLabel: string;
  /** Votos atrás de quem está logo acima; nulo para quem lidera. */
  gapVotes: number | null;
  gapPoints: number | null;
}
import { SENATE_CONTESTED } from './seats';
import { titleCase } from './format';

const MAJORITARIAN = new Set<Office>(['president', 'governor']);
const STATE_BY_UF = new Map(STATES.map(s => [s.uf, s]));
export const stateName = (uf: string) => uf === 'BR' ? 'Brasil' : STATE_BY_UF.get(uf)?.name ?? uf;

const STATUS_LABEL: Record<CandidateStatus, string> = {
  elected: 'Eleito', runoff: '2º turno', leading: 'Lidera', in_seat_range: 'Na faixa de eleição',
  alternate: 'Suplente', not_elected: 'Não eleito', counting: 'Em disputa', no_data: 'Sem dados',
};

/**
 * A situação do TSE é canônica. Só quando ela vem vazia o painel descreve a posição atual —
 * "lidera", "na faixa de eleição" —, que são fatos sobre a parcial, nunca sobre o resultado.
 */
export function candidateStatus(c: Candidate, rank: number, race: Race, contested: number): CandidateStatus {
  const st = c.status.trim().toLowerCase();
  if (/2º turno|segundo turno/.test(st)) return 'runoff';
  if (c.elected || /^eleit/.test(st)) return 'elected';
  if (/suplente/.test(st)) return 'alternate';
  if (/não eleito|nao eleito/.test(st)) return 'not_elected';
  if (race.status === 'waiting' || !race.countedSections) return 'no_data';
  if (MAJORITARIAN.has(race.office)) return rank === 0 && race.candidates.length > 1 ? 'leading' : 'counting';
  if (race.office === 'senate') return rank < contested ? 'in_seat_range' : 'counting';
  return 'counting';
}

/**
 * Só o que a fonte declarou, sem descrever a parcial.
 *
 * Há telas que mostram a etiqueta apenas quando existe um fato publicado, e silêncio quando não
 * existe. Esta é a leitura delas — era uma expressão regular repetida em cada tela, e cada cópia
 * reconhecia um conjunto ligeiramente diferente de textos.
 */
export function publishedStatus(c: Candidate): { key: 'elected' | 'runoff' | 'alternate' | 'not_elected'; label: string } | null {
  const st = (c.status ?? '').trim().toLowerCase();
  if (/2º turno|segundo turno/.test(st)) return { key: 'runoff', label: '2º turno' };
  if (c.elected || /^eleit/.test(st)) return { key: 'elected', label: 'eleito' };
  if (/suplente/.test(st)) return { key: 'alternate', label: 'suplente' };
  if (/não eleito|nao eleito/.test(st)) return { key: 'not_elected', label: 'não eleito' };
  return null;
}

/** Quantas vagas estão em jogo: o que o arquivo do TSE diz, e a tabela do ciclo como reserva. */
export function contestedSeats(race: Race | undefined, office: Office, year: number): number {
  if (office === 'senate') return race?.seats && race.seats > 0 ? race.seats : SENATE_CONTESTED[year] ?? 2;
  return race?.seats && race.seats > 0 ? race.seats : 1;
}

/** A disputa em ordem de votação, com a situação e a distância para quem está logo acima. */
export function rankCandidates(race: Race | undefined, year: number): RankedCandidate[] {
  if (!race) return [];
  const contested = contestedSeats(race, race.office, year);
  const sorted = [...race.candidates].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'pt-BR'));
  return sorted.map((c, i) => {
    const prev = sorted[i - 1];
    const key = candidateStatus(c, i, race, contested);
    const official = c.status.trim();
    return {
      ...c, rank: i + 1, statusKey: key,
      statusLabel: official && !['leading', 'in_seat_range', 'counting', 'no_data'].includes(key) ? titleCase(official) : STATUS_LABEL[key],
      gapVotes: prev ? prev.votes - c.votes : null,
      gapPoints: prev ? prev.percent - c.percent : null,
    };
  });
}

/**
 * Bancada por partido: cadeiras que o TSE já declarou, e votos para desempatar a ordem.
 *
 * As cadeiras saem da situação publicada de cada candidatura, nunca de uma conta própria — quem
 * senta é quem a fonte elegeu.
 */
export function seatsByParty(race: Race | undefined, year: number): { party: string; color: string; seats: number; votes: number }[] {
  if (!race) return [];
  const tally = new Map<string, { party: string; color: string; seats: number; votes: number }>();
  for (const c of rankCandidates(race, year)) {
    const t = tally.get(c.party) ?? { party: c.party, color: c.color, seats: 0, votes: 0 };
    t.votes += c.votes;
    if (c.statusKey === 'elected') t.seats++;
    tally.set(c.party, t);
  }
  return [...tally.values()].sort((a, b) => b.seats - a.seats || b.votes - a.votes);
}
