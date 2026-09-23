/**
 * A ordem em que a busca oferece o que encontrou.
 *
 * A caixa do Território procura duas coisas ao mesmo tempo — candidaturas e municípios — e o que
 * decide a lista não é o acaso do índice, é onde o texto bateu: começo do nome primeiro, começo de
 * uma palavra depois, meio de palavra por último. Dentro de cada um desses grupos vence quem tem
 * mais votos (ou o município com mais eleitores), porque é quem a pessoa provavelmente procurava.
 *
 * A regra vive aqui, fora da tela, porque é a parte que erra em silêncio: se "silveira" passar a
 * devolver o município de Silveiras antes do senador Alexandre Silveira, ninguém vê um erro — vê
 * uma busca ruim.
 */

/** Onde o texto bateu: 0 = começo do nome, 1 = começo de uma palavra, 2 = meio, −1 = não bateu. */
export function onde(texto: string, procurado: string): number {
  const i = texto.indexOf(procurado);
  return i < 0 ? -1 : i === 0 ? 0 : texto[i - 1] === ' ' ? 1 : 2;
}

export interface Achado<T> { item: T; posicao: number; peso: number }

/** Filtra e ordena um conjunto: primeiro por onde bateu, depois pelo peso (votos, eleitorado). */
export function achados<T>(itens: T[], procurado: string, chave: (x: T) => { texto: string; peso: number }): Achado<T>[] {
  const saida: Achado<T>[] = [];
  for (const item of itens) {
    const { texto, peso } = chave(item);
    const posicao = onde(texto, procurado);
    if (posicao >= 0) saida.push({ item, posicao, peso });
  }
  return saida.sort((a, b) => a.posicao - b.posicao || b.peso - a.peso);
}

/**
 * Quantas candidaturas e quantos municípios mostrar, dentro das oito linhas da caixa.
 *
 * Havendo os dois, as candidaturas ficam com quatro lugares e os municípios com o resto — sem
 * isso, uma busca por "santos" enchia a lista de cidades e escondia o candidato Santos, que era o
 * que estava sendo procurado. Havendo só um dos dois, ele ocupa as oito.
 */
export function repartir(candidatos: number, cidades: number, total = 8): [number, number] {
  const c = Math.min(candidatos, cidades ? 4 : total);
  return [c, Math.min(cidades, total - c)];
}
