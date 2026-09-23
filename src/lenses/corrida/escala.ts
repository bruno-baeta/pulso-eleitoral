/**
 * A escala do eixo vertical do gráfico.
 *
 * Sai daqui, e não de dentro do desenho, porque é a única parte da curva que é conta pura: dado o
 * maior valor em jogo, qual o teto do eixo e de quanto em quanto ele é rotulado. E é conta que
 * erra fácil — um passo mal escolhido enche o eixo de rótulos ou deixa a curva colada no topo.
 *
 * Duas regras a governam:
 *
 *   folga    — o teto fica acima do maior valor (8% em votos, 12% em porcentagem), para a curva
 *              não encostar na borda. Em porcentagem o teto nunca passa de 100.
 *   escada   — o passo é um número redondo da década do teto (0,1 · 0,2 · 0,25 · 0,5 · 1 · 2 vezes
 *              a potência de dez), escolhido para caber no máximo cinco rótulos. Em porcentagem a
 *              escada é fixa: 1, 2, 5, 10, 20, 25 ou 50 pontos.
 *
 * Não há linha de maioria nem de corte: metade dos válidos é um número que se move enquanto a
 * apuração anda, e cruzar a metade de agora não garante nada. O eixo só emoldura as curvas.
 */
export interface EscalaY {
  /** O topo do eixo. */
  teto: number;
  /** De quanto em quanto o eixo é rotulado. */
  passo: number;
}

export function escalaY(maiorValor: number, emPorcentagem: boolean): EscalaY {
  const alto = Math.max(maiorValor, 1);
  const teto = emPorcentagem ? Math.min(100, Math.max(alto * 1.12, 1)) : Math.max(alto * 1.08, 1);
  const decada = Math.pow(10, Math.floor(Math.log10(teto)));
  const passo = emPorcentagem
    ? ([1, 2, 5, 10, 20, 25].find(v => teto / v <= 5) ?? 50)
    : ([.1, .2, .25, .5, 1, 2].map(m => m * decada).find(v => teto / v <= 5) ?? decada * 2);
  return { teto: Math.ceil(teto / passo) * passo, passo };
}
