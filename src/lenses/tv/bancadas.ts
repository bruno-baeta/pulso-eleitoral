/**
 * Quantas cadeiras cada partido faz — as que o TSE já declarou e, antes disso, a projeção.
 *
 * Esta é a conta mais consequente do painel, e por isso ela mora sozinha, sem DOM por perto: dizer
 * que um partido fez sete cadeiras quando fez cinco é afirmar um resultado errado sobre uma
 * eleição. Duas coisas distintas acontecem aqui, e a diferença entre elas é o ponto:
 *
 *   contagem  — quando o TSE publica os eleitos, a bancada é simplesmente quantos eleitos cada
 *               partido tem. Não há conta nenhuma: quem senta é quem a fonte elegeu.
 *   projeção  — antes disso (e o TSE só marca eleitos perto dos 100%), aplicamos a regra da
 *               eleição proporcional sobre o que já foi apurado. É uma projeção, marcada como tal
 *               na tela com um til, e desaparece no instante em que o primeiro eleito é publicado.
 *
 * A regra projetada é a da Lei 4.737/65 com a redação da Lei 14.211/21, na parte que muda o
 * resultado numa noite de apuração:
 *
 *   quociente eleitoral  — votos válidos ÷ vagas. É o preço de uma cadeira.
 *   cláusula de partido  — quem não alcança o quociente não participa da distribuição.
 *   maiores médias       — as vagas vão, uma a uma, ao partido com a maior média (votos ÷
 *                          (cadeiras que já tem + 1)).
 *
 * O que esta projeção deliberadamente NÃO faz é dizer *quem* senta: a lei ainda exige que o
 * candidato tenha 10% do quociente, e a fila interna do partido depende disso. Nomes só aparecem
 * na tela quando o TSE os elege.
 */

export interface Bancada {
  partido: string;
  /** Cadeiras: contadas dos eleitos publicados, ou projetadas quando não há nenhum. */
  cadeiras: number;
  votos: number;
  cor: string;
}

export interface Candidatura {
  party: string;
  votes: number;
  color: string;
  elected: boolean;
}

/** O preço de uma cadeira: votos válidos divididos pelas vagas. */
export const quocienteEleitoral = (validos: number, vagas: number) => validos / Math.max(1, vagas);

/** Soma a votação de cada partido e conta os eleitos que a fonte já declarou. */
export function porPartido(candidatos: Candidatura[]): Bancada[] {
  const tabela = new Map<string, Bancada>();
  for (const c of candidatos) {
    const b = tabela.get(c.party) ?? { partido: c.party, cadeiras: 0, votos: 0, cor: c.color };
    if (c.elected) b.cadeiras++;
    b.votos += c.votes;
    tabela.set(c.party, b);
  }
  return [...tabela.values()];
}

/**
 * Distribui as vagas pelas maiores médias, entre quem alcançou o quociente.
 *
 * Devolve uma lista nova: quem ficou sem cadeira nenhuma sai, porque a linha do painel é de
 * bancadas, e bancada de zero não é bancada.
 */
export function projetarBancadas(bancadas: Bancada[], vagas: number, validos: number): Bancada[] {
  const qe = quocienteEleitoral(validos, vagas);
  const alcancaram = bancadas.filter(b => b.votos >= qe);
  /*
   * Ninguém alcançando o quociente, todos disputam — e isso é lei, não conveniência.
   *
   * O art. 109, §2º, do Código Eleitoral diz que, se nenhum partido atinge o quociente, elegem-se
   * os mais votados. Sem esta linha a projeção devolvia bancada nenhuma justamente nos dois casos
   * em que ela é mais provável: uma disputa de vaga única, onde o quociente é o total dos válidos,
   * e o primeiro arquivo de uma proporcional, com os votos ainda espalhados.
   */
  const aptos = (alcancaram.length ? alcancaram : bancadas).map(b => ({ ...b, cadeiras: 0 }));
  if (!aptos.length) return [];
  for (let v = 0; v < vagas; v++) {
    let melhor = aptos[0];
    for (const b of aptos) {
      if (b.votos / (b.cadeiras + 1) > melhor.votos / (melhor.cadeiras + 1)) melhor = b;
    }
    melhor.cadeiras++;
  }
  return aptos.filter(b => b.cadeiras > 0);
}

/**
 * A linha de bancadas do painel: contagem quando há eleitos, projeção quando não há.
 *
 * `projetada` diz qual dos dois está na tela — é o que faz o til aparecer ao lado do número, e
 * é a diferença entre relatar e estimar.
 */
export function bancadasDe(candidatos: Candidatura[], vagas: number, validos: number): { bancadas: Bancada[]; projetada: boolean } {
  const eleitos = candidatos.filter(c => c.elected);
  const projetada = eleitos.length === 0;
  const contadas = porPartido(projetada ? candidatos : eleitos);
  const total = Math.max(1, validos || contadas.reduce((t, b) => t + b.votos, 0));
  const bancadas = projetada ? projetarBancadas(contadas, vagas, total) : contadas;
  return {
    bancadas: bancadas.sort((a, b) => b.cadeiras - a.cadeiras || b.votos - a.votos),
    projetada,
  };
}
