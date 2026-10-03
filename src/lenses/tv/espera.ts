/**
 * O que a TV mostra antes do primeiro número.
 *
 * Antes da apuração o painel tinha cinco seções com "Carregando Minas Gerais…" e "Aguardando o
 * TSE" no rodapé de cada uma: dez avisos para dizer uma coisa só, e nenhum dizendo quando. A
 * espera vira um bloco no centro com a hora marcada — e, depois dela, o aviso de que os primeiros
 * boletins estão a caminho, que é o que de fato acontece nos minutos após as 17h.
 *
 * Mora sozinha e sem DOM porque decide o que a tela afirma sobre a eleição: dizer "começa às 17h"
 * com a apuração já correndo esconderia resultado publicado.
 */
import { OFFICIAL_WINDOWS, type TimeWindow } from '../../../shared/windows';

/**
 * A janela de coleta abre às 16h; a contagem, às 17h. A hora de começo da apuração é derivada da
 * janela, e não escrita de novo aqui, para as duas não se desencontrarem.
 */
export const ANTECEDENCIA_COLETA = 60 * 60 * 1000;

export type Espera =
  | { fase: 'antes'; inicio: number; faltam: number }
  | { fase: 'buscando'; inicio: number }
  | null;

export interface EstadoDaTela {
  oficial: boolean;
  /** Reproduzindo um instante gravado: a tela mostra o que foi, não o que se espera. */
  reproduzindo: boolean;
  turno: 1 | 2;
  /** Alguma disputa com seção apurada. Arquivo publicado com tudo zerado não conta. */
  temApuracao: boolean;
}

export function espera(t: EstadoDaTela, agora = Date.now(), janelas: TimeWindow[] = OFFICIAL_WINDOWS): Espera {
  if (!t.oficial || t.reproduzindo || t.temApuracao) return null;
  const janela = janelas.find(j => j.turn === t.turno && agora < j.end);
  if (!janela) return null;
  const inicio = janela.start + ANTECEDENCIA_COLETA;
  if (agora < inicio) return { fase: 'antes', inicio, faltam: inicio - agora };
  return { fase: 'buscando', inicio };
}

/** "23:41:07": horas corridas, sem dia, porque o maior intervalo que interessa é o da véspera. */
export function relogioDeContagem(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
}
