/**
 * A noite, desenhada como o resto do Pulso — e não como um kit.
 *
 * A versão anterior era o conjunto que sai pronto de qualquer gerador: tudo em card arredondado,
 * vidro fosco, um azul de acento e rótulos minúsculos, o mesmo raio em cima de tudo. Aqui não há
 * card nenhum. O que separa uma seção da outra é fio e espaço, que é como uma página impressa faz
 * — e a hierarquia é de tipo: o título condensado em caixa alta, o número grande em Barlow, o
 * resto em corpo de texto. A paleta é a do app (o fundo quase preto esverdeado, o ouro como único
 * acento), para esta tela pertencer ao mesmo produto que as outras quatro.
 */
export const CSS = `
  html, body { height: 100%; margin: 0; overflow: hidden; background: #0a0c0b; }
  /* em tela cheia a barra do aplicativo some e o painel ocupa a altura inteira */
  :root.sem-barra .sh-head { display: none; }
  :root.sem-barra .noite { padding-top: 1.8vh; }

  /*
   * A barra do aplicativo é fixa; o espaço dela entra no recuo do próprio painel.
   *
   * Estava numa declaração de topo à parte, e a forma curta, declarada depois, a zerava: o painel
   * subia para debaixo da barra, o primeiro título colava no topo e a faixa com o botão da TV
   * ficava atrás dela — invisível e sem poder ser clicada.
   */
  .noite { box-sizing: border-box; height: 100vh; overflow: hidden; display: grid;
    grid-template-rows: minmax(0, 1.02fr) minmax(0, .98fr) auto;
    padding: calc(var(--sh-head, 69px) + 1.8vh) 2.2vw 0; column-gap: 0;
    font-family: 'DM Sans Variable', system-ui, sans-serif; color: #f6f3ec; }

  /* ── cabeçalho: nome do estado e relógio, sem caixa ────────────────────────────────── */
  /*
   * O cabeçalho é etiqueta, não manchete.
   *
   * Ele nasceu com o corpo de um título de capa e comia uma faixa inteira da altura — altura que
   * faltava às curvas e aos assentos, que são o assunto. Aqui ele tem o tamanho de um rótulo: diz
   * onde estamos e sai da frente.
   */
  /*
   * Não há segunda barra: o relógio e o botão da TV moram no rodapé, ao lado do fio.
   *
   * Uma faixa própria logo abaixo da barra do aplicativo dava duas barras empilhadas na mesma
   * tela — e a de baixo ainda ficava escondida atrás da de cima.
   */
  .canto { display: flex; align-items: center; gap: .8vw; padding-left: 1.2vw;
    border-left: 1px solid #1c211f; }
  /* o estado é escolhido aqui mesmo: trocar de estado é a segunda coisa que se faz nesta tela */

  .canto .cheia { all: unset; cursor: pointer; padding: .4vh .9vw;
    border: 1px solid #262c2a; border-radius: 3px; font-size: clamp(9px, .74vw, 16px);
    letter-spacing: .12em; text-transform: uppercase; color: #cdc9c1; white-space: nowrap; }
  .canto .cheia:hover { color: #0f1210; background: #f6f3ec; border-color: #f6f3ec; }

  .canto .rel { font-size: clamp(10px, .85vw, 17px); color: #6a6863;
    font-variant-numeric: tabular-nums; }

  /* ── o transporte: em pé, na margem direita ────────────────────────────────────────── */
  /*
   * Fica na lateral, e não no rodapé, porque o rodapé é do fio — e fica em pé porque é onde a mão
   * chega sem passar por cima de nenhum número. Fora do apontador ele quase desaparece: é um
   * controle, não um elemento do painel.
   */
  /* começa na altura em que os painéis começam: a mesma linha do título do Senado */
  .fita { position: fixed; right: .3vw; top: calc(var(--sh-head, 69px) + 1.8vh); z-index: 60;
    display: flex; flex-direction: column; align-items: center; gap: .4vh;
    opacity: .38; transition: opacity .25s ease; }
  .fita:hover, .fita:focus-within { opacity: 1; }
  .fita.some { display: none; }
  .fita button { all: unset; cursor: pointer; display: grid; place-items: center;
    width: clamp(26px, 2.1vw, 42px); height: clamp(26px, 2.1vw, 42px); border-radius: 50%;
    color: #8e8c86; transition: color .15s ease, background .15s ease; }
  .fita button svg { width: 58%; height: 58%; }
  .fita button:hover { color: #f6f3ec; background: #1c211f; }
  .fita button.on { color: #0f1210; background: #e8c877; }
  /* as acelerações e o ao vivo: bolinhas, na mesma coluna dos três gestos */
  .fita .vel, .fita .vivo { width: clamp(22px, 1.7vw, 34px); height: clamp(22px, 1.7vw, 34px);
    border: 1px solid #262c2a; border-radius: 50%;
    font-size: clamp(8px, .6vw, 12px); font-variant-numeric: tabular-nums; color: #8e8c86; }
  .fita .vel.on { color: #0f1210; background: #e8c877; border-color: #e8c877; }
  /*
   * Ao vivo não há velocidade: o tempo é o tempo. As bolinhas só aparecem quando a apuração está
   * sendo reproduzida, que é quando "60×" quer dizer alguma coisa.
   */
  .fita.vivo .vel { display: none; }
  .fita .vivo i { width: 32%; height: 32%; border-radius: 50%; background: currentColor; }
  .fita .vivo.on { color: #6fcf97; border-color: rgba(111,207,151,.55); background: none; }
  .fita .quando { font-size: clamp(8px, .62vw, 13px); letter-spacing: .08em;
    text-transform: uppercase; color: #6a6863; font-variant-numeric: tabular-nums; }
  /* no ao vivo o relógio da fita não é clicável: já estamos onde ele levaria */
  .fita:not(.vivo) .quando { cursor: pointer; color: #e8c877; }

  /* ── as seções: separadas por fio, nunca por moldura ───────────────────────────────── */
  .corridas, .cadeiras { display: grid; min-height: 0; }
  .corridas { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cadeiras { grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 2px solid #1c211f; }
  /* o respiro entre o título e o conteúdo: colados, o cabeçalho parecia parte da lista */
  .noite section { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 1.6vh;
    min-height: 0; padding: 1.8vh 1.6vw; border-left: 1px solid #161a18; }
  .noite section:first-child { border-left: 0; padding-left: 0; }
  /* altura fixa: o botão BR/MG deixava o cabeçalho do presidente 2px mais alto que os outros dois,
     e esses 2px desalinhavam as três listas inteiras */
  .noite section > header { display: flex; align-items: center; justify-content: space-between;
    gap: .6vw; min-height: clamp(24px, 2.8vh, 48px); }
  .noite h2 { margin: 0; font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: clamp(14px, 1.35vw, 28px); letter-spacing: .12em; text-transform: uppercase; color: #f6f3ec; }
  /* o apurado em branco suave: é dado de cabeçalho, não um alerta — amarelo aqui só fazia barulho */
  .noite .ap { font-size: clamp(11px, .95vw, 19px); color: #cdc9c1; font-variant-numeric: tabular-nums; }
  /* o alternador do painel da presidência: país ou estado, a mesma disputa por dois denominadores */
  .escopo { display: inline-flex; gap: 1px; margin-right: auto; margin-left: .8vw;
    border: 1px solid #262c2a; border-radius: 3px; overflow: hidden; }
  .escopo button { all: unset; cursor: pointer; padding: .25vh .6vw;
    font-size: clamp(9px, .72vw, 15px); letter-spacing: .08em; text-transform: uppercase;
    color: #8e8c86; transition: background .15s ease, color .15s ease; }
  .escopo button:hover { color: #f6f3ec; background: #171c1a; }
  .escopo button.on { background: #f6f3ec; color: #0f1210; }
  .noite .corpo { min-height: 0; overflow: hidden; display: grid;
    grid-template-rows: auto auto minmax(0, 1fr); gap: .8vh; align-content: start; }
  /* a lista é o único conteúdo do painel: recebe a faixa inteira, e nada dela fica fora */
  .noite .corpo:has(.nomes) { grid-template-rows: minmax(0, 1fr); align-content: start; }
  /* a lista é o único conteúdo do painel: ela recebe a faixa inteira e divide as linhas dentro */
  .noite .corpo:has(.nomes) { grid-template-rows: minmax(0, 1fr); align-content: stretch; }
  /*
   * Nas cadeiras quem estica é o desenho, e a lista dos cinco fica com a altura que pede.
   *
   * Sem esta regra valia a ordem padrão — custo, casa, lista —, em que a casa é dimensionada pelo
   * próprio conteúdo e a lista herda o que sobrou: doze siglas de legenda empurravam os cinco mais
   * votados para duas linhas e meia, cortadas no rodapé do painel.
   */
  /* nas cadeiras: a conta em cima, a barra da casa, e a lista dos cinco ocupando o resto */
  /*
   * Nas cadeiras, a linha dos partidos tem a altura que precisa e as colunas ficam com o resto.
   *
   * Estava ao contrário — a linha dos partidos dentro de uma faixa elástica e as colunas fixas —,
   * e quando o painel apertava era ela que era cortada, justamente a informação que resume a casa.
   */
  .noite .corpo:has(.bancadas) { grid-template-rows: auto minmax(0, 1fr); align-content: stretch; }
  .noite .vazio { margin: 0; align-self: center;
    font-size: clamp(11px, .95vw, 19px); color: #6a6863; }

  /* ── as disputas: a lista de quem está na frente ──────────────────────────────────── */
  /*
   * Linhas compactas, espaçadas por um intervalo fixo.
   *
   * Esticadas para preencher o painel, cada linha ficava com o dobro da altura do seu conteúdo e o
   * número de votos descia para longe do nome a que pertence. Aqui a linha tem a altura do que
   * carrega, e o respiro entre uma e outra é o mesmo nos três painéis.
   */
  .nomes { list-style: none; margin: 0; padding: 0;
    display: grid; grid-auto-rows: max-content; gap: 1.2vh; align-content: start; }
  /* a barra de cor é a coluna da esquerda, não uma borda decorativa: ela nomeia a candidatura */
  /*
   * A coluna da porcentagem tem largura fixa e a linha tem altura mínima.
   *
   * Sem isso, cada painel dimensionava a sua coluna pelo maior número que tinha, e as
   * porcentagens de presidente, governador e senado caíam em posições diferentes; e um nome que
   * quebrava em duas linhas empurrava as linhas seguintes daquele painel para baixo, desalinhando
   * a leitura horizontal entre os três. Agora a mesma linha, nos três, nasce na mesma altura e
   * termina na mesma coluna.
   */
  /*
   * O corpo da linha mora no li, não no nome.
   *
   * Partido e votos são medidos em em, e com o tamanho declarado só no span eles mediam contra os
   * 16px herdados da página: numa TV, o nome crescia e o número de votos ficava parado no tamanho
   * de rodapé. Com a escala no li, a linha inteira cresce junto.
   */
  .nomes li { display: grid; grid-template-columns: 4px minmax(0, 1fr) auto;
    column-gap: .7vw; row-gap: .2vh; align-items: baseline; min-height: 0;
    font-size: clamp(14px, 1.3vw, 27px); }
  .nomes li::before { content: ''; grid-row: 1 / 3; align-self: stretch; background: var(--cor, #3a403c); }
  .nomes li span { grid-column: 2; font-size: 1em; line-height: 1.15;
    overflow-wrap: anywhere; display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: .5vw; }
  /* a situação declarada pela fonte: eleito, 2º turno, suplente */
  /*
   * A etiqueta é uma anotação, não um segundo nome: fica no tamanho de uma legenda, para que a
   * linha continue sendo lida pelo nome do candidato, e não pela tarja ao lado dele.
   */
  /*
   * Título e nome são botões, mas não parecem botões: são o mesmo texto de antes, que abre a
   * tabela do cargo ao ser clicado. O sublinhado só aparece sob o apontador, para não riscar o
   * painel inteiro de tracinhos numa tela que fica no ar a noite toda.
   */
  .noite h2 .tudo, .noite .abre { all: unset; cursor: pointer; }
  .noite h2 .tudo:hover, .noite .abre:hover,
  .noite h2 .tudo:focus-visible, .noite .abre:focus-visible {
    text-decoration: underline; text-underline-offset: .22em;
    text-decoration-color: rgba(232,200,119,.7); }

  .noite .nomes li span .tag { flex: none; align-self: center; padding: .25em .45em;
    border: 1px solid #2c312e; border-radius: 3px;
    font-size: 11px !important; line-height: 1; letter-spacing: .06em; text-transform: uppercase;
    white-space: nowrap; color: #6a6863; }
  .noite .nomes li span .tag.eleito { border-color: rgba(111,207,151,.5); color: #6fcf97; }
  .noite .nomes li span .tag.turno { border-color: rgba(127,182,222,.5); color: #7fb6de; }

  /* o selo do que mudou: verde quando sobe, vermelho quando cai, e só aparece quando há mudança */
  .mov { flex: none; font-size: .58em; font-weight: 600; font-variant-numeric: tabular-nums;
    white-space: nowrap; }
  .mov.sobe { color: #6fcf97; }
  .mov.desce { color: #e2707a; }
  .nomes li em { grid-column: 3; grid-row: 1; justify-self: end; font-style: normal;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: clamp(18px, 1.9vw, 40px); font-variant-numeric: tabular-nums; }
  /* partido e votos na mesma linha, logo abaixo do nome: é onde o olho já está */
  .nomes li i { grid-column: 2; grid-row: 2; font-style: normal; font-size: .78em; color: #8e8c86; }
  /*
   * Sem série gravada, esta lista é tudo o que o painel tem — e o número de votos era o menor
   * texto da tela justamente onde ele é o dado principal. Sobe para quase o corpo do nome.
   */
  .nomes li u { grid-column: 3; grid-row: 2; justify-self: end; text-align: right;
    text-decoration: none; font-size: .8em; color: #b9b6ae; font-variant-numeric: tabular-nums;
    white-space: nowrap; min-width: 6.5em; }
  /* a linha de corte: acima dela se elege ou se continua na disputa, abaixo não */
  .nomes li.corte { margin-top: .6vh; padding-top: 1.4vh; border-top: 1px dashed rgba(232,200,119,.4); }
  .nomes li.fora { opacity: .42; }
  @media (prefers-reduced-motion: reduce) {
    .nomes li { transition: none !important; }
  }
  .decide { margin: 0; padding-top: 1vh; border-top: 1px solid #161a18;
    font-size: clamp(10px, .9vw, 18px); line-height: 1.4; color: #8e8c86; }
  .decide b { color: #f6f3ec; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* ── as cadeiras: um hemiciclo, como a casa é ──────────────────────────────────────── */
  .custo { margin: 0; font-size: clamp(10px, .92vw, 19px); color: #8e8c86; }
  .custo b { color: #f6f3ec; font-weight: 600; font-variant-numeric: tabular-nums; }
  /* ── as bancadas: uma linha, sigla e cadeiras ─────────────────────────────────────── */
  /*
   * A linha das bancadas desce até encostar nas colunas.
   *
   * Ancorada no alto, ela ficava colada no cabeçalho com um vão de vinte por cento da tela abaixo
   * — e esse vão é altura que as colunas dos mais votados usam para mostrar diferença de votos.
   */
  .bancadas { margin: 0; display: flex; flex-wrap: wrap; align-content: start;
    gap: .4vh 1.2vw; font-size: clamp(10px, .85vw, 17px); color: #8e8c86; }
  .bancadas span { display: inline-flex; align-items: baseline; gap: .3vw; }
  .bancadas span::before { content: ''; align-self: center; width: .5em; height: .5em;
    border-radius: 2px; background: var(--cor, #3a403c); }
  .bancadas b { font-weight: 700; color: #f6f3ec; font-variant-numeric: tabular-nums; }
  .bancadas .resto::before, .bancadas .aberta::before { background: #2b3236; }
  .bancadas .aberta b { color: #8e8c86; }

  /*
   * Os cinco mais votados ocupam a largura, não a altura.
   *
   * Empilhados, eles usavam um terço do painel e deixavam dois terços de vazio à direita — num
   * painel que tem metade da tela de largura, isso é desperdício de espaço e de tamanho: lado a
   * lado, cada um ganha rosto maior e o bloco inteiro é lido de uma vez, como um pódio.
   */
  /* as colunas ocupam a faixa que sobrou, inteira: a altura delas é o que compara os cinco */
  .eleitos { list-style: none; margin: 0; padding: 0; min-height: 0;
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .6vw;
    align-content: stretch; align-items: stretch; }
  /*
   * A faixa da coluna tem altura própria, e não uma fração do que sobrar.
   *
   * Medida em fração do que sobra, ela herdava a folga da lista — e a lista é dimensionada pelo
   * próprio conteúdo, então a folga era zero e as cinco colunas viravam riscos de dois pixels.
   */
  .eleitos li { min-width: 0; display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto auto;
    gap: .15vh; justify-items: start; align-content: end; }
  /* a coluna: a altura é o voto, e é ela que mostra a diferença antes de o número ser lido */
  .eleitos .coluna { width: 100%; min-height: 2px; height: var(--h, 10%);
    align-self: end; background: var(--cor, #3a403c); border-radius: 2px 2px 0 0; }
  /* a posição, em corpo pequeno e cor fraca: ela ordena a leitura sem competir com o número */
  .eleitos em { font-style: normal; font-size: clamp(9px, .72vw, 14px); color: #4f544f;
    font-variant-numeric: tabular-nums; }
  .eleitos b { display: flex; align-items: baseline; gap: .4em;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700; line-height: 1;
    font-size: clamp(15px, 1.5vw, 32px); font-variant-numeric: tabular-nums; color: #f6f3ec; }
  /* a seta do que mudou também aqui, no tamanho de legenda, ao lado do número de votos */
  .eleitos b .mov { font-family: 'DM Sans Variable', system-ui, sans-serif; font-size: 11px; }
  .eleitos i { max-width: 100%; font-style: normal; font-size: clamp(11px, .95vw, 19px);
    color: #e8e4dc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eleitos u { max-width: 100%; text-decoration: none; font-size: clamp(9px, .7vw, 14px);
    color: #6a6863; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── o fio da noite ────────────────────────────────────────────────────────────────── */
  .fio { margin: 0 -2.2vw; height: 4.6vh; display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: center; border-top: 2px solid #1c211f; }
  .fio .rolo { overflow: hidden; }
  .fio .tira { display: flex; gap: 3.4vw; padding: 0 3.4vw; white-space: nowrap; width: max-content;
    animation: fio-corre 70s linear infinite; }
  .fio .it { font-size: clamp(11px, .92vw, 19px); color: #6a6863; }
  .fio .it b { color: #cdc9c1; font-weight: 600; }
  .fio .it.k-lead b { color: #e8c877; }
  .fio .it.k-milestone b { color: #8e8c86; }
  .fio .it.k-elected b { color: #6fcf97; }
  .fio .it.k-finished b { color: #7fb6de; }
  @keyframes fio-corre { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) { .fio .tira { animation: none; } }

  @media (max-width: 900px) {
    html, body { overflow: auto; }
    .noite { height: auto; grid-template-rows: auto auto auto auto; }
    .corridas, .cadeiras { grid-template-columns: minmax(0, 1fr); }
    .noite section { border-left: 0; padding-left: 0; border-top: 1px solid #161a18; }
  }
`;
