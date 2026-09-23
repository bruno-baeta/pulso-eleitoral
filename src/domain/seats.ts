/**
 * Quantas vagas cada casa tem.
 *
 * O arquivo do TSE traz `nv` (vagas) quando a disputa está carregada, e esse valor manda; a tabela
 * abaixo é só a reserva para o estado cujo arquivo ainda não chegou.
 */
export const CHAMBER_SEATS: Record<string, number> = {
  SP: 70, MG: 53, RJ: 46, BA: 39, RS: 31, PR: 30, PE: 25, CE: 22, MA: 18, GO: 17, PA: 17, SC: 16,
  PB: 12, ES: 10, PI: 10, AL: 9, AM: 8, MT: 8, MS: 8, RN: 8, DF: 8, SE: 8, RO: 8, TO: 8, AC: 8, AP: 8, RR: 8,
};

/** Constituição, art. 27: o triplo da bancada federal até 36, depois 36 + (federal − 12). */
export function assemblySeats(uf: string, federal = CHAMBER_SEATS[uf] ?? 8): number {
  return federal <= 12 ? federal * 3 : 36 + (federal - 12);
}

/** Vagas de senador renovadas por estado em cada ciclo; o `nv` do arquivo tem precedência. */
export const SENATE_CONTESTED: Record<number, number> = { 2022: 1, 2026: 2 };
