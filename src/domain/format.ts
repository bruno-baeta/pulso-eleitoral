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
export const shortVotes = (v: number) => {
  // o arredondamento vem antes da comparação: sem isso, 999.999 virava "1000 mil" em vez de "1 mi"
  const milhares = Math.round(v / 1e3);
  if (milhares >= 1e3) return `${(v / 1e6).toLocaleString(pt, { maximumFractionDigits: 2 })} mi`;
  return v >= 1e4 ? `${milhares} mil` : fmtInt(v);
};
/*
 * O sinal de menos é o tipográfico (−, U+2212), não o hífen.
 *
 * `toLocaleString` devolve hífen, e o painel mostra números negativos lado a lado com números
 * formatados à mão: a mesma tela ficava com dois traços de larguras diferentes na mesma coluna.
 */
const decimal = (n: number, digits: number) =>
  n.toLocaleString(pt, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−');

export function fmtPercent(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${decimal(n, digits)}%`;
}
/** Percentage points are a difference between two percentages, never "%". */
export function fmtPoints(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${decimal(n, digits)} p.p.`;
}
/** Nulo é ausência; zero é o instante epoch, e ele existe. */
export const fmtShortTime = (value: number | string | null | undefined) =>
  value == null || value === '' ? '—' : shortTimeFmt.format(new Date(value));
/**
 * Variação com sinal explícito, para uma diferença ser lida como diferença.
 *
 * O sinal sai do número já arredondado: tirado do valor bruto, uma queda de 0,04 apresentada com
 * uma casa virava "−0,0" — um menos zero, que não quer dizer nada.
 */
export const fmtSigned = (n: number, digits = 2) => {
  const arredondado = Number(n.toFixed(digits));
  const sinal = arredondado > 0 ? '+' : arredondado < 0 ? '−' : '';
  return `${sinal}${Math.abs(arredondado).toLocaleString(pt, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};


const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'von', 'van']);
/*
 * Algarismos romanos, que aparecem em nomes de urna ("Papa João XXIII", "Pio XII").
 *
 * A lista antes era enumerada à mão e tinha buracos — faltavam I, V, X, XX, XXI, XXIII —, então
 * "JOAO XXIII" saía como "Joao Xxiii". Esta expressão reconhece qualquer romano de 1 a 3.999, e
 * um nome que por acaso seja "Ivo" ou "Livi" não bate porque a palavra inteira tem de ser romana.
 */
const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const ENTITIES: Record<string, string> = { '&apos;': "'", '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const decode = (s: string) => s.replace(/&(?:apos|#39|quot|amp|lt|gt);/g, m => ENTITIES[m]);
/** TSE ballot names arrive in caps; title case reads better and keeps particles and numerals. */
export function titleCase(name: string): string {
  return decode(name).toLowerCase().split(/\s+/).filter(Boolean).map((word, i) => {
    if (word && ROMAN.test(word)) return word.toUpperCase();
    if (i > 0 && SMALL.has(word)) return word;
    return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }).join(' ');
}
/** Texto comparável: sem acento, sem caixa, sem espaço sobrando. É o que toda busca usa. */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Escapa o que vai para dentro de um template de HTML. Uma só versão, e ela escapa a aspa simples. */
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/**
 * As duas iniciais que aparecem quando a foto do TSE não carrega.
 *
 * Contam as palavras que `titleCase` deixou em maiúscula — ou seja, o nome de verdade. As
 * partículas ficam minúsculas lá e são descartadas aqui, senão "Maria dos Santos" viraria "MD",
 * a inicial de uma preposição; os números de urna, que aparecem no meio de alguns nomes, também
 * saem, porque "J1" não identifica ninguém.
 */
export const initials = (name: string) => {
  const palavras = titleCase(name).split(' ').filter(w => /^\p{Lu}/u.test(w));
  return palavras.slice(0, 2).map(w => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
};
