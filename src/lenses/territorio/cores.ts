/**
 * As cores do mapa.
 *
 * Um mapa por líder de município é lido de longe e de relance, então duas regras valem aqui e não
 * valeriam num gráfico: a cor precisa parecer tinta, não neon — por isso todo tom é puxado para o
 * cinza antes de ir para a tela —, e duas cores vizinhas precisam ser distinguíveis, porque
 * municípios vizinhos se tocam. PT e PL têm lugar reservado; o resto pega o seu lugar de sempre,
 * a menos que ele já esteja ocupado ou perto demais de alguma cor que já está no mapa.
 */
import { COLORS, partySlot } from '../../../shared/types';

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Party colour pulled toward grey, so it reads as ink rather than neon. */
export function mute(hex: string, amount = .3, light = 0): number[] {
  const [r, g, b] = hexToRgb(hex), grey = (r + g + b) / 3;
  const m = (c: number) => { const v = c + (grey - c) * amount; return Math.round(v + (light > 0 ? (255 - v) * light : v * light)); };
  return [m(r), m(g), m(b)];
}
export const rgba = (c: ArrayLike<number>, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(a * 1000) / 1000})`;
export const ease = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Slot pairs too close on the dark surface (same list as shared/types' distinctColors). */
const CLASH = new Set(['0-6', '1-3', '1-4', '1-5', '1-7', '2-4', '2-5', '3-7', '4-7']);
const clash = (a: number, b: number) => CLASH.has(a < b ? `${a}-${b}` : `${b}-${a}`);
/**
 * As cores da legenda do mapa.
 *
 * PT e PL têm casa reservada — vermelho e azul, como eles se apresentam. Os demais ficam com a sua
 * casa de sempre, a menos que ela esteja ocupada ou perto demais de alguma cor **já no mapa** (não
 * só da anterior): num mapa, quem vence municípios vizinhos fica lado a lado, e duas casas
 * próximas viram uma mancha só.
 *
 * A partir de quatro partidos a restrição fica insatisfatível — são oito casas e vários pares
 * próximos entre si —, e aí a preferência é declarada: aceitar duas cores parecidas é melhor do
 * que repetir a mesma cor ou deixar um partido sem nenhuma. Com três partidos, que é o caso comum
 * de um mapa estadual, a lista sai sempre livre de pares próximos.
 */
export function mapColors(parties: string[]): string[] {
  const used: number[] = [];
  return parties.map(p => {
    const key = p.toUpperCase().replace(/[^A-Z]/g, '');
    const reserved = key === 'PT' ? 7 : key === 'PL' ? 0 : -1;
    let slot = reserved >= 0 && !used.includes(reserved) ? reserved : -1;
    if (slot < 0) {
      const wanted = partySlot(key), options = [1, 2, 3, 4, 5, 6];
      const start = Math.max(0, options.indexOf(wanted));
      const ring = options.map((_, i) => options[(start + i) % options.length]);
      slot = ring.find(o => !used.includes(o) && used.every(u => !clash(u, o))) ?? ring.find(o => !used.includes(o)) ?? wanted;
    }
    used.push(slot);
    return COLORS[slot];
  });
}
