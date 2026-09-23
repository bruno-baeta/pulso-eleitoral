/**
 * As cores dos partidos, como eles próprios as usam.
 *
 * Identidade nunca vem só da cor — toda marca na tela leva nome e sigla —, mas a cor é o que faz
 * reconhecer uma linha de longe, e inventar um tom para o PT ou para o PL seria desnecessariamente
 * estranho. O que a tabela não tem cai numa paleta de reserva, estável por sigla.
 *
 * Todas passam por `mute`: a cor de bandeira é feita para papel branco e, no fundo quase preto do
 * painel, ela estoura. O tom é mantido, a saturação quase toda, e só o brilho é contido.
 */
import { party } from '../../shell/dados';

/** The parties' own colours, as they use them in their flags and campaign material. */
const PARTIDOS: Record<string, string> = {
  PT: '#c8102e', PL: '#1b3a6b', PSDB: '#0f7dc2', MDB: '#0aa04b', PSD: '#12a5a0', PP: '#1f4fa0',
  REPUBLICANOS: '#0b63a8', 'UNIÃO': '#0b4ea2', PDT: '#d81e2c', PSB: '#f0a01e', PSOL: '#b01455',
  NOVO: '#f07f20', 'PC DO B': '#a8141c', PCDOB: '#a8141c', PODE: '#0f9d6e', AVANTE: '#00a0dc',
  PATRIOTA: '#1f4a8c', PTB: '#0f8f3d', PV: '#3faa34', REDE: '#00a99a', CIDADANIA: '#e0157d',
  SOLIDARIEDADE: '#ef6a1f', PROS: '#e8722c', PSC: '#1d8f4a', PRTB: '#123a8c', PMB: '#6d2f9c',
  PCB: '#b4151c', PSTU: '#c01527', PCO: '#8c1116', UP: '#d81232', DC: '#1e4f86', AGIR: '#2e7d4f',
  PMN: '#b8332a', 'PT+PV+PC DO B': '#c8102e', 'PSDB+CIDADANIA': '#0f7dc2', 'PSOL+REDE': '#b01455',
};
const FALLBACK = ['#6f8fa8', '#a8826f', '#7f9d7a', '#a07fa0', '#9a9460', '#6f9a93', '#b58a66', '#8a8fb0'];
/** Pulls a hue toward warm grey and caps its lightness, the same treatment used in Pelotão. */
export function mute(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l0 = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  // keep the party's own hue and most of its saturation; only tame what would glare on the dark board
  const S = s * 0.9, L = Math.min(l0, 0.62) * 0.98;
  const f = (t: number) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}
const partyColors = new Map<string, string>();
export const colorOf = (p: string) => {
  const key = party(p).toUpperCase();
  if (!partyColors.has(key)) {
    let hash = 0; for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    partyColors.set(key, mute(PARTIDOS[key] ?? FALLBACK[hash % FALLBACK.length]));
  }
  return partyColors.get(key)!;
};
