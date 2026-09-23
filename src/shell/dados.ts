/**
 * De qual apuração a tela está falando, e de onde os números vêm.
 *
 * As três telas são documentos separados, e esta é a peça que faz as três concordarem: ela lê o
 * modo, o estado e o turno da URL (caindo para o que este navegador usou por último), abre o
 * fluxo de eventos do servidor e sabe pedir um snapshot de agora ou de um instante gravado.
 * Nenhuma tela fala com a API por fora daqui.
 */
import { STATES, type WireRace as Race, type Snapshot, type Turn } from '../../shared/types';
import { rankCandidates } from '../domain/derive';
import { OFFICIAL_WINDOWS, SIMULADO_WINDOWS, openWindow } from '../../shared/windows';
export { contestedSeats, seatsByParty, stateName } from '../domain/derive';
export { esc, fmtInt, fmtPercent, fmtShortTime, fold, initials, shortVotes, titleCase } from '../domain/format';

export type Mode = 'official' | 'historico' | 'simulado';
const params = new URLSearchParams(location.search);
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/**
 * Que apuração abre quando ninguém pediu nenhuma.
 *
 * A URL manda; depois dela, o que este navegador usou por último. Faltando os dois, o padrão é o
 * arquivo de 2022 — porque é a única apuração que existe hoje —, **exceto na noite da eleição**:
 * com uma janela oficial aberta, quem chega ao Pulso quer a apuração que está acontecendo, não a
 * de quatro anos atrás. Sem esta exceção, o site abriria em 2022 justamente em 4 de outubro.
 */
const escolhido = params.get('mode') || stored('pulso:mode');
const padrao: Mode = openWindow(OFFICIAL_WINDOWS) ? 'official' : 'historico';
const requested: Mode = (['official', 'historico', 'simulado'] as const).find(m => m === escolhido) ?? padrao;
/**
 * The TSE simulation is only collected inside its test windows, but the recordings stay available:
 * outside a window the view opens on the last recorded session (replay), never requesting the TSE.
 */
export const MODE: Mode = requested;
const ufParam = (params.get('uf') || stored('pulso:uf') || 'MG').toUpperCase();
export const UF = STATES.some(s => s.uf === ufParam) ? ufParam : 'MG';
/*
 * O turno segue a mesma regra do modo: pedido primeiro, janela aberta depois.
 *
 * Em 25 de outubro a janela oficial é a do segundo turno, e abrir no primeiro mostraria uma
 * apuração encerrada três semanas antes enquanto a de verdade acontece.
 */
const turnoPedido = params.get('turn') || stored('pulso:turn');
export const TURN: Turn = turnoPedido === '2' ? 2
  : turnoPedido === '1' ? 1
  : (openWindow(OFFICIAL_WINDOWS)?.turn ?? 1);
/** Election year of the selected source; the Senate renews one seat per UF in 2022 and two in 2026. */
export const YEAR = MODE === 'historico' ? 2022 : 2026;

/** Change source, state or round: remembered in this browser and reflected in the URL. */
export function navigate(change: Partial<{ mode: Mode; uf: string; turn: Turn }>) {
  const next = new URLSearchParams(location.search);
  const mode = change.mode ?? MODE, uf = change.uf ?? UF, turn = change.turn ?? TURN;
  next.set('mode', mode); next.set('uf', uf); next.set('turn', String(turn));
  try { localStorage.setItem('pulso:mode', mode); localStorage.setItem('pulso:uf', uf); localStorage.setItem('pulso:turn', String(turn)); } catch { /* private mode */ }
  location.search = next.toString();
}

/** The current snapshot, or the count as it stood at `at` (ms) when replaying. */
/*
 * The server has published every accepted result on /api/events since the beginning, and nothing
 * ever listened: every view asked again every three seconds instead. Polling adds its own interval
 * to the wait — the count reached the server and then sat there until the next question. The
 * stream removes that half of the delay, and the poll stays as the fallback for when it drops.
 */
let pushed: { at: number; snapshot: Snapshot } | null = null;
const pushListeners = new Set<(s: Snapshot) => void>();
let stream: EventSource | null = null;

/*
 * Only the document on screen holds the stream open.
 *
 * Every view prerenders the others, so a reader with one tab open had five documents alive, each
 * with its own EventSource to the API. A browser allows six connections to one origin over
 * HTTP/1.1, and an open stream holds its slot forever: the pool was full before anything was
 * asked, so the next navigation queued behind connections nobody was reading. A hidden or
 * prerendered document now drops the stream and takes it back when it comes to the front — which
 * costs nothing, because the poll each view keeps is exactly the fallback for a dropped stream.
 */
function abrirFluxo() {
  if (stream || typeof EventSource === 'undefined' || !pushListeners.size) return;
  if ((document as Document & { prerendering?: boolean }).prerendering) return;
  if (document.visibilityState === 'hidden') return;
  stream = new EventSource(`/api/events?mode=${MODE}&uf=${UF}&turn=${TURN}`);
  stream.addEventListener('snapshot', e => {
    try {
      const snapshot = JSON.parse((e as MessageEvent).data) as Snapshot;
      pushed = { at: Date.now(), snapshot };
      for (const l of pushListeners) l(snapshot);
    } catch { /* a malformed frame is not worth dropping the stream for */ }
  });
}
function fecharFluxo() { stream?.close(); stream = null; }

let vigiando = false;
export function onSnapshot(fn: (s: Snapshot) => void): () => void {
  pushListeners.add(fn);
  if (!vigiando && typeof document !== 'undefined') {
    vigiando = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') fecharFluxo(); else abrirFluxo();
    });
    document.addEventListener('prerenderingchange', () => abrirFluxo(), { once: true });
  }
  abrirFluxo();
  return () => {
    pushListeners.delete(fn);
    if (!pushListeners.size) fecharFluxo();
  };
}

/*
 * Que instante está no ar — e é uma pergunta só, para toda a tela.
 *
 * A reprodução acertava o painel e deixava o resto no agora: o rodapé anunciava quem tinha sido
 * eleito enquanto o painel mostrava 0,0% apurado, e a folha de cidades abria com 526.640 de
 * 526.640 seções, 100,00%, com a apuração reproduzida no minuto zero.
 *
 * O resultado por município não é gravado instante a instante — o TSE serve o estado de agora, e
 * só. Então quem lê `/api/municipal` precisa saber que não está no ao vivo, para dizer isso em vez
 * de mostrar o número de outra hora. Uma variável de módulo é o que faz as três telas concordarem
 * sem passar o instante por dez assinaturas.
 */
let instante: number | null = null;
/** O instante reproduzido, ou nulo no ao vivo. */
export const momentoNoAr = (): number | null => instante;
/** O transporte de cada tela anuncia aqui o instante que pôs no ar. */
export const porNoAr = (at?: number) => { instante = at ?? null; };
/** Frase única para o que não existe fora do ao vivo. */
export const SEM_REPRODUCAO = 'O resultado por município não é gravado instante a instante: o TSE publica só o estado de agora. Volte ao ao vivo para ver as cidades.';

export async function loadSnapshot(at?: number): Promise<Snapshot> {
  // a snapshot the stream delivered a moment ago is the same one the endpoint would return
  if (at === undefined && pushed && Date.now() - pushed.at < 2000) return pushed.snapshot;
  const r = await fetch(`/api/snapshot?mode=${MODE}&uf=${UF}&turn=${TURN}${at === undefined ? '' : `&at=${Math.max(0, Math.round(at))}`}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
export interface Timeline { available: boolean; reason?: string; start: number; end: number; live: boolean; now: number }
export async function loadTimeline(): Promise<Timeline> {
  const r = await fetch(`/api/timeline?mode=${MODE}&uf=${UF}&turn=${TURN}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
export const top = (race: Race | undefined, n: number) => rankCandidates(race, YEAR).slice(0, n);
export const all = (race: Race | undefined) => rankCandidates(race, YEAR);
export const party = (p: string) => p.replace(/\*$/, '');
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
/** Escape text before it goes into innerHTML. */


/**
 * Candidate photo published by the TSE next to the result files
 * (…/ele{ano}/{eleição}/fotos/{uf}/{sqcand}.jpeg), or null. Demo candidates are fictitious and never get one.
 * The 2022 path is verified; the 2026 path follows the same layout and falls back to initials if absent.
 */
export function photoUrl(race: Race, candidateId: string): string | null {
  if (!/^\d{6,}$/.test(candidateId)) return null;
  const base = MODE === 'historico' ? 'https://resultados.tse.jus.br/oficial/ele2022' : MODE === 'simulado' ? 'https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026' : 'https://resultados.tse.jus.br/oficial/ele2026';
  // Presidential photos live under br/, even when the race is counted inside one state.
  const area = race.office === 'president' ? 'br' : race.uf.toLowerCase();
  return `${base}/${race.election}/fotos/${area}/${candidateId}.jpeg`;
}
