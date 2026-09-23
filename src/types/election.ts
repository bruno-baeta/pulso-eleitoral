/**
 * O que as telas leem, além do que vem do servidor.
 *
 * O contrato de rede é `shared/types.ts` — o que o coletor emite. Aqui fica só o que o cliente
 * acrescenta ao ler aquilo: a ordem de cada candidatura na disputa e a situação dela já resolvida,
 * que é o que uma tela precisa para desenhar uma linha sem refazer a conta.
 */
import type { Candidate, Mode, Office, WireRace, Snapshot, StateProgress, Turn } from '../../shared/types';
/* A tela lê a disputa como ela chega pelo fio: `WireRace`, sem os campos que ninguém desenha. */
export type { Candidate, Mode, Office, Snapshot, StateProgress, Turn };
export type Race = WireRace;

export type CandidateStatus =
  | 'elected' | 'runoff' | 'leading' | 'in_seat_range' | 'alternate' | 'not_elected' | 'counting' | 'no_data';

export interface RankedCandidate extends Candidate {
  rank: number;
  statusKey: CandidateStatus;
  statusLabel: string;
  /** Votos atrás de quem está logo acima; nulo para quem lidera. */
  gapVotes: number | null;
  gapPoints: number | null;
}
