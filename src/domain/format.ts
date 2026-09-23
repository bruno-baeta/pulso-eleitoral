const pt = 'pt-BR';
const intFmt = new Intl.NumberFormat(pt, { maximumFractionDigits: 0 });
const shortTimeFmt = new Intl.DateTimeFormat(pt, { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

export const fmtInt = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : intFmt.format(Math.round(n));
/**
 * Votos em forma curta: "1,24 mi", "318 mil".
 *
 * Existe porque uma coluna de gráfico e uma etiqueta de mapa não cabem "1.243.877" sem empurrar o
 * resto da linha; onde há espaço, o número vai inteiro. O corte em dez mil é deliberado: abaixo
 * disso "9 mil" esconde uma diferença que decide uma vaga proporcional.
 */
export const shortVotes = (v: number) => v >= 1e6
  ? `${(v / 1e6).toLocaleString(pt, { maximumFractionDigits: 2 })} mi`
  : v >= 1e4 ? `${Math.round(v / 1e3)} mil` : fmtInt(v);
export function fmtPercent(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString(pt, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
/** Percentage points are a difference between two percentages, never "%". */
export function fmtPoints(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString(pt, { minimumFractionDigits: digits, maximumFractionDigits: digits })} p.p.`;
}
export const fmtShortTime = (value: number | string | null | undefined) => value ? shortTimeFmt.format(new Date(value)) : '—';
export const fmtSigned = (n: number, digits = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(pt, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;


const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'von', 'van']);
const ROMAN = /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;
const ENTITIES: Record<string, string> = { '&apos;': "'", '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const decode = (s: string) => s.replace(/&(?:apos|#39|quot|amp|lt|gt);/g, m => ENTITIES[m]);
/** TSE ballot names arrive in caps; title case reads better and keeps particles and numerals. */
export function titleCase(name: string): string {
  return decode(name).toLowerCase().split(/\s+/).filter(Boolean).map((word, i) => {
    if (ROMAN.test(word)) return word.toUpperCase();
    if (i > 0 && SMALL.has(word)) return word;
    return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }).join(' ');
}
/** Texto comparável: sem acento, sem caixa, sem espaço sobrando. É o que toda busca usa. */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Escapa o que vai para dentro de um template de HTML. Uma só versão, e ela escapa a aspa simples. */
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** As duas iniciais que aparecem quando a foto do TSE não carrega. */
export const initials = (name: string) => {
  const palavras = titleCase(name).split(' ').filter(w => w.length > 2 || /^[\dA-Z]$/.test(w));
  return palavras.slice(0, 2).map(w => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
};
