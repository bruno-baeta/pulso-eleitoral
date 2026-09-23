/**
 * A escala da tela, num lugar só.
 *
 * O desenho é calibrado para 3440×1440 — a tela em que este painel foi feito para ficar — e tudo
 * o que tem tamanho fixo é escrito como `calc(Npx * var(--k))`. A conta que produz esse fator
 * estava repetida em quatro arquivos, com os mesmos números mágicos soltos em cada um; bastava
 * alguém mexer num para as telas passarem a medir coisas diferentes.
 *
 * Há dois fatores, e a diferença entre eles é intencional:
 *
 *   --k   o conteúdo. Numa janela estreita ou em pé, ele passa a medir pela largura (w/600), que
 *         é o que faz a tela caber num celular em vez de encolher tudo proporcionalmente.
 *   --sk  a moldura do aplicativo: cabeçalho, seletor, rodapé. Tem piso de 0,5 porque, abaixo
 *         disso, o texto da barra fica ilegível mesmo numa tela pequena — e a barra é onde se
 *         troca de tela, de estado e de eleição.
 */

/** O fator proporcional puro, pela tela de referência. */
export const escalaBase = (w = innerWidth, h = innerHeight) => Math.min(w / 3440, h / 1440);

/** Verdadeiro quando a janela é estreita ou está em pé: aí a largura manda. */
export const estreita = (w = innerWidth, h = innerHeight) => w < 900 || w / h < 1;

/** O fator do conteúdo. */
export const escalaConteudo = (w = innerWidth, h = innerHeight) => estreita(w, h) ? w / 600 : escalaBase(w, h);

/** O fator da moldura, que não desce abaixo do legível. */
export const escalaMoldura = (w = innerWidth, h = innerHeight) => Math.max(.5, escalaBase(w, h));
