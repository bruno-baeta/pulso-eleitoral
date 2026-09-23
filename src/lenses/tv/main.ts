/**
 * TV — as cinco disputas numa tela só, para ficar no ar a noite inteira.
 *
 * Duas formas, e a escolha entre elas é a tese da tela:
 *
 *   corrida  — presidente, governador e senado se decidem por votação, e o que importa é como a
 *              vantagem se move enquanto a apuração anda. Então são curvas: quem subiu, quem caiu,
 *              onde as linhas se cruzaram.
 *   cadeiras — deputado federal e estadual não se decidem por quem está na frente, e sim por
 *              quantas vagas cada partido tirou. Então são assentos, com o rosto de quem está
 *              sentado neles e as vagas ainda abertas como cadeiras vazias.
 *
 * Os mapas saíram. Por líder de município, uma proporcional com centenas de candidaturas vira
 * confete — quinhentas manchas de quinhentas cores que não respondem pergunta nenhuma —, e nas
 * majoritárias o mapa responde "onde", não "quem está ganhando", que é a pergunta de uma noite de
 * apuração. O território continua inteiro na tela Território, que existe para isso.
 */
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import type { Candidate, Office, WireRace as Race, Snapshot } from '../../../shared/types';
import { MODE, TURN, UF, esc, fmtInt, fmtPercent, loadSnapshot, loadTimeline, onSnapshot, stateName, type Timeline } from '../../raias/common';
import { mountShellBar, pageReady } from '../../shell/shell';
import { seedScale } from '../../shell/row';
import { publishedStatus } from '../../domain/derive';
import { abrirCandidato, abrirTabela } from '../../shell/tabela';
import { CSS } from './style';

const app = document.getElementById('app')!;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));

const CORRIDAS: { key: Office; nome: string }[] = [
  { key: 'president', nome: 'Presidente' },
  { key: 'governor', nome: 'Governador' },
  { key: 'senate', nome: 'Senado' },
];
const CADEIRAS: { key: Office; nome: string }[] = [
  { key: 'federal', nome: 'Deputados federais' },
  { key: 'state', nome: UF === 'DF' ? 'Deputados distritais' : 'Deputados estaduais' },
];

let snap: Snapshot | null = null;

/*
 * O que mudou desde a última atualização, por candidatura.
 *
 * Uma troca de posição é o fato mais alto e ganha de tudo: quem passou alguém sobe com a seta
 * verde. Quem não trocou de lugar mostra se a vantagem sobre quem vem logo atrás abriu ou
 * encurtou, que é o que antecipa a próxima ultrapassagem. É a mesma
 * leitura das outras telas, e existe porque uma apuração que só troca números não conta o que
 * aconteceu entre duas leituras.
 */
interface Movimento { dir: 1 | -1; texto: string; titulo: string }
const posicaoAnterior = new Map<string, number>();
const folgaAnterior = new Map<string, number>();
const movimentos = new Map<string, Movimento>();
function registrarMovimento(office: Office, race: Race, ordem: Race['candidates']) {
  ordem.forEach((c, i) => {
    const chave = `${office}:${race.election}:${race.uf}:${race.turn}:${c.id}`;
    const lugar = i + 1;
    const antesLugar = posicaoAnterior.get(chave), antesFolga = folgaAnterior.get(chave);
    /*
     * A folga: quantos votos separam esta candidatura da que vem logo abaixo.
     *
     * A última da lista não tem ninguém abaixo, então para ela a folga é negativa — a distância
     * que falta para alcançar quem está acima. Nos dois casos o sinal quer dizer a mesma coisa:
     * subiu, está melhor; desceu, está pior.
     */
    const abaixo = ordem[i + 1], acima = ordem[i - 1];
    const folga = abaixo ? c.percent - abaixo.percent : acima ? c.percent - acima.percent : 0;
    if (antesLugar !== undefined && antesLugar !== lugar) {
      const passos = antesLugar - lugar;                       // positivo: subiu na lista
      movimentos.set(chave, {
        dir: passos > 0 ? 1 : -1,
        texto: `${passos > 0 ? '+' : '−'}${Math.abs(passos)} pos`,
        titulo: `${passos > 0 ? 'Subiu' : 'Caiu'} ${Math.abs(passos)} `
          + `${Math.abs(passos) === 1 ? 'posição' : 'posições'} desde a última atualização`,
      });
    } else if (antesFolga !== undefined && Math.abs(folga - antesFolga) >= 0.001) {
      /*
       * Sem troca de posição, a seta mostra se a vantagem abriu ou encurtou — não quantos votos
       * entraram.
       *
       * Voto ganho é um número que só sobe: numa apuração, todo mundo ganha votos o tempo todo, e
       * a seta ficava verde em todas as linhas ao mesmo tempo dizendo nada. O que muda de fato
       * entre duas leituras é a distância para quem está logo atrás — é ela que diz se a disputa
       * está se resolvendo ou apertando, e é a única leitura que antecipa a ultrapassagem antes
       * de ela acontecer. Em pontos percentuais, e não em votos: a folga em votos cresce sozinha
       * conforme o eleitorado apurado aumenta, enquanto o ponto percentual é a mesma medida do
       * começo ao fim da noite.
       */
      const variou = folga - antesFolga;
      /*
       * O número é a distância, a seta é o que ela fez.
       *
       * Mostrar só a variação respondia "mexeu quanto?", que é a pergunta menor: entre duas
       * leituras ela é sempre um décimo de nada e não diz se a disputa está apertada. O que
       * interessa é a distância em si — "está 0,42 ponto à frente do segundo" —, e a seta ao lado
       * dela diz se essa distância abriu ou encurtou desde a leitura anterior.
       */
      // uma disputa com centenas de nomes se decide em milésimos: duas casas virariam "0,00"
      const dist = Math.abs(folga);
      const casas = dist < 0.01 ? 3 : 2;
      const pp = dist.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
      const quem = abaixo ? `sobre o ${lugar + 1}º` : `para o ${lugar - 1}º`;
      movimentos.set(chave, {
        dir: variou > 0 ? 1 : -1,
        texto: `${pp} pp`,
        titulo: `${abaixo ? 'Vantagem' : 'Distância'} ${quem}: ${pp} ponto${pp === '1,00' ? '' : 's'} `
          + `percentua${pp === '1,00' ? 'l' : 'is'} — ${variou > 0 ? 'abriu' : 'encurtou'} desde a última atualização`,
      });
    }
    posicaoAnterior.set(chave, lugar);
    folgaAnterior.set(chave, folga);
  });
}

/**
 * As acelerações oferecidas, em minutos de apuração por segundo de relógio.
 *
 * 1× é o tempo real, para acompanhar um trecho de perto; 60× percorre uma hora por minuto, que é
 * o passo em que uma virada de madrugada cabe num intervalo; 100× atravessa a noite inteira em
 * poucos minutos, para quem quer só ver o desenho da apuração.
 */
const VELOCIDADES = [1, 60, 100];

/** Os três gestos do transporte, desenhados: começo, toca, pausa. */
const ICO = {
  ini: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19 5.8v12.4L9.5 12z" fill="currentColor"/></svg>',
  toca: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/><rect x="13.1" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/></svg>',
};

/**
 * A situação que a própria fonte declara: eleito, 2º turno, suplente.
 *
 * É o TSE que diz, e é a informação que fecha a disputa — faltava justamente ela, então a tela
 * mostrava quem estava na frente sem dizer que ele já tinha se elegido ou ido para o segundo
 * turno. Quando o campo vem vazio, nada é inventado: a linha de corte já diz quem está dentro.
 */
function situacao(c: Candidate): string {
  const s = publishedStatus(c);
  if (!s) return '';
  const cor = s.key === 'elected' ? ' eleito' : s.key === 'runoff' ? ' turno' : '';
  return `<span class="tag${cor}">${s.label}</span>`;
}

const selo = (chave: string) => {
  const m = movimentos.get(chave);
  if (!m) return '';
  return `<span class="mov ${m.dir > 0 ? 'sobe' : 'desce'}" title="${esc(m.titulo)}">`
    + `${m.dir > 0 ? '▲' : '▼'} ${esc(m.texto)}</span>`;
};

/*
 * A presidência tem duas leituras, e as duas importam.
 *
 * O que decide a eleição é o total do país; o que interessa a quem está em Minas é como Minas
 * votou. São números diferentes da mesma disputa, então em vez de escolher um, o painel tem um
 * botão: BR mostra o nacional que vem do snapshot, o estado mostra os totais por candidatura que
 * o mapa municipal já traz somados. Nenhuma das duas é calculada aqui.
 */
type Escopo = 'BR' | 'UF';
let escopoPresidente: Escopo = 'BR';
/** Totais da presidência dentro do estado, como o TSE publica por município. */
let presidenteNoEstado: { numero: string; nome: string; partido: string; cor: string; votos: number }[] = [];

/**
 * O que dizer enquanto o painel não tem número.
 *
 * "Aguardando o TSE" é verdade quando a apuração ainda não começou, e mentira quando o leitor
 * acabou de trocar de estado: aí o que falta é o arquivo daquele estado chegar, o que leva
 * segundos. Dizer o nome do estado transforma um alarme em um aviso de carregamento.
 */
const esperando = () => `Carregando ${esc(stateName(UF))}…`;

/* ── as disputas majoritárias: quem está na frente, e por quanto ───────────────────────── */

/**
 * A lista de quem disputa: nome e partido à esquerda, porcentagem à direita.
 *
 * Havia aqui uma curva no tempo para cada candidatura, e ela saiu. Numa tela que fica no ar a
 * noite inteira, a pergunta é "quem está na frente e por quanto", e essa é respondida por três
 * linhas de texto — a curva respondia "como chegou até aqui", que é uma pergunta de quem senta e
 * estuda, e para isso existe a tela Corrida. Sem o gráfico, as três disputas ficam com o mesmo
 * desenho e as porcentagens das três alinhadas na mesma coluna.
 *
 * Quem aparece: três linhas em todas as disputas, senado incluído. No senado a linha de corte cai
 * depois da última vaga, então as duas eleitas ficam acima dela e a terceira, logo abaixo, é a que
 * pode tomar a segunda vaga — que é a única de fora que importa acompanhar. As três disputas ficam
 * com a mesma altura, e nenhuma empurra as outras.
 */
function corrida(office: Office, race: Race | undefined): string {
  if (office === 'president' && escopoPresidente === 'UF') return presidenciaNoEstado(race);
  if (!race) return `<p class="vazio">${esperando()}</p>`;
  const vagas = office === 'senate' ? (race.seats > 0 ? race.seats : 2) : 0;
  const quantos = 3;
  const todas = [...race.candidates].sort((a, b) => b.votes - a.votes);
  registrarMovimento(office, race, todas);
  const ordem = todas.slice(0, quantos);
  if (!ordem.length) return `<p class="vazio">Nenhum voto publicado ainda.</p>`;

  /*
   * Toda disputa tem uma linha de corte, e cada uma tem a sua.
   *
   * No senado ela vem depois da última vaga. Nas majoritárias, depois de quem continua na disputa:
   * dois, quando o primeiro ainda não passou de metade dos válidos e haveria segundo turno; um,
   * quando já passou. Quem fica abaixo da linha aparece mais apagado — continua na tela, porque o
   * terceiro colocado pode subir enquanto a apuração anda, mas não com o mesmo peso de quem está
   * dentro.
   */
  const dentro = vagas > 0 ? vagas : ordem[0].percent > 50 ? 1 : 2;

  return `<ol class="nomes">${ordem.map((c, i) => {
    const fora = i >= dentro;
    const chave = `${office}:${race.election}:${race.uf}:${race.turn}:${c.id}`;
    /*
     * A linha não pisca. O que mudou já está dito no selo — "▲ +1 pos", "▲ +0,12 pp" — e na
     * própria troca de lugar, que desliza. O fundo verde acendia de novo a cada leitura, porque o
     * painel é redesenhado inteiro e a animação renascia com o elemento: virava um pulso constante
     * em quem não tinha ganhado voto nenhum.
     */
    return `<li data-id="${esc(chave)}" class="${fora ? 'fora' : ''}${i === dentro ? ' corte' : ''}"`
      + ` style="--cor:${esc(c.color)}">`
      + `<span><button class="abre">${esc(c.name)}</button>${situacao(c)}${selo(chave)}</span><em>${fmtPercent(c.percent, 1)}</em>`
      + `<i>${esc(c.party)}${c.number ? ` · ${esc(c.number)}` : ''}</i>`
      + `<u>${fmtInt(c.votes)} votos</u></li>`;
  }).join('')}</ol>`;
}

/**
 * A presidência contada dentro do estado.
 *
 * Os votos vêm do mesmo arquivo que pinta o mapa municipal, somados por candidatura; a
 * porcentagem é sobre o total nominal do estado, e não sobre os válidos nacionais — dizer "8,7%"
 * aqui com o denominador do país seria inventar um número que não existe.
 */
function presidenciaNoEstado(race: Race | undefined): string {
  if (!presidenteNoEstado.length) {
    return `<p class="vazio">Aguardando os resultados de ${esc(stateName(UF))}.</p>`;
  }
  const total = presidenteNoEstado.reduce((t, c) => t + c.votos, 0) || 1;
  const ordem = presidenteNoEstado.slice(0, 3);
  const dentro = (ordem[0].votos / total) * 100 > 50 ? 1 : 2;
  return `<ol class="nomes">${ordem.map((c, i) => {
    const fora = i >= dentro;
    return `<li class="${fora ? 'fora' : ''}${i === dentro ? ' corte' : ''}" style="--cor:${esc(c.cor)}">`
      + `<span>${esc(c.nome)}</span><em>${fmtPercent((c.votos / total) * 100, 1)}</em>`
      + `<i>${esc(c.partido)} · ${esc(c.numero)}</i><u>${fmtInt(c.votos)} votos</u></li>`;
  }).join('')}</ol>`;
  void race;
}

/** A frase que diz o que decide aquela disputa — e ela é diferente em cada uma. */
function decide(office: Office, race: Race | undefined): string {
  if (!race?.candidates.length) return 'Aguardando o TSE';
  const ord = [...race.candidates].sort((a, b) => b.votes - a.votes);
  if (office === 'president' || office === 'governor') {
    /*
     * No segundo turno não há segundo turno a evitar.
     *
     * A frase era escrita a partir da distância para os 50% em qualquer turno, e no dia 25 de
     * outubro ela diria "precisa de mais 3,1% para evitar 2º turno" sobre a disputa que já é o
     * segundo turno. Com dois nomes na urna, o que a conta diz é outra coisa: a distância entre os
     * dois. Quem declara o eleito continua sendo o TSE, na etiqueta ao lado do nome.
     */
    if (race.turn === 2) {
      const folga = ord[0].percent - (ord[1]?.percent ?? 0);
      return ord[1]
        ? `${esc(ord[0].name)} está à frente por <b>${fmtPercent(folga, 1)}</b>`
        : `${esc(ord[0].name)} é o único na urna`;
    }
    const falta = 50 - ord[0].percent;
    return falta > 0
      ? `${esc(ord[0].name)} precisa de mais <b>${fmtPercent(falta, 1)}</b> para evitar 2º turno`
      : `${esc(ord[0].name)} passa em 1º turno`;
  }
  const vagas = race.seats > 0 ? race.seats : 2;
  const ultimo = ord[vagas - 1], fora = ord[vagas];
  if (!ultimo || !fora) return `${vagas} vagas em disputa`;
  const folga = ultimo.percent - fora.percent;
  // frase é frase: começa em maiúscula, como as das outras disputas
  return folga < 0.1
    ? `A ${vagas}ª vaga está por <b>menos de 0,1 ponto</b>`
    : `A ${vagas}ª vaga está por <b>${fmtPercent(folga, 1)}</b> sobre o ${vagas + 1}º`;
}

/* ── as cadeiras: quem está sentado, e quanto custa sentar ─────────────────────────────── */

/**
 * O custo de uma cadeira: votos válidos divididos pelas vagas.
 *
 * É o quociente eleitoral, e explica a proporcional melhor que qualquer ranking — com um milhão de
 * votos e dez vagas, cada cadeira custa cem mil. Aparece como "agora" porque muda a noite inteira,
 * conforme entram votos.
 *
 * E ele não decide nada aqui: quem senta depende da soma do partido, da fila interna e da cláusula
 * que exige 10% do quociente para o candidato — e quem publica isso é o TSE. O que está abaixo é a
 * situação publicada, não o resultado desta conta; usar a conta sentaria na cadeira gente que não
 * se elegeu.
 */
function cadeiras(office: Office, race: Race | undefined): string {
  if (!race) return `<p class="vazio">${esperando()}</p>`;
  const eleitos = race.candidates.filter(c => c.elected).sort((a, b) => b.votes - a.votes);
  const vazias = Math.max(0, race.seats - eleitos.length);
  /*
   * Antes do primeiro eleito, o painel mostra a votação — não fica parado.
   *
   * O TSE só publica quem se elegeu quando a proporcional fecha, perto dos 100%: até lá estes dois
   * painéis ficavam a noite inteira com "a definir 53" e nenhuma coluna, enquanto as três disputas
   * de cima andavam a cada leitura. Sem eleitos, portanto, as colunas são os mais votados e a
   * linha de cima é a votação de cada partido — que é o que decide as cadeiras e se move desde o
   * primeiro voto. Nada aqui diz que alguém sentou: quem senta continua sendo quem o TSE elege, e
   * assim que ele eleger é isso que volta a aparecer.
   */
  const parcial = !eleitos.length;

  /*
   * As bancadas numa linha só.
   *
   * Já foram barra fatiada, barra por partido, pastilha por cadeira e lista em colunas; todas
   * comiam altura que faz falta às colunas dos mais votados, e nenhuma acrescentava nada a um
   * número inteiro e pequeno. Sigla e contagem, em sequência, do maior para o menor.
   */
  const porPartido = new Map<string, { cor: string; n: number; votos: number }>();
  for (const c of parcial ? race.candidates : eleitos) {
    const p = porPartido.get(c.party) ?? { cor: c.color, n: 0, votos: 0 };
    if (c.elected) p.n++;
    p.votos += c.votes;
    porPartido.set(c.party, p);
  }
  const validos = Math.max(1, race.validVotes
    || [...porPartido.values()].reduce((t, p) => t + p.votos, 0));
  /*
   * Enquanto o TSE não elege ninguém, a bancada é projetada — e continua contada em cadeiras.
   *
   * Mostrar a votação do partido em porcentagem trocava a unidade do painel no meio da noite:
   * "PT 3" virava "PT 2,1%", e as duas coisas não se comparam. A projeção é a regra da eleição
   * proporcional: quem não alcança o quociente eleitoral fica de fora, o resto divide as vagas
   * pelas maiores médias. É uma projeção sobre o que já foi apurado, marcada com o til, e some
   * assim que a situação publicada chega — quem senta é quem o TSE elege, nunca esta conta.
   */
  const projetar = () => {
    const qe = validos / Math.max(1, race.seats);
    const aptos = [...porPartido.entries()].filter(([, p]) => p.votos >= qe);
    for (const [, p] of aptos) p.n = 0;
    for (let v = 0; v < race.seats && aptos.length; v++) {
      let melhor = aptos[0];
      for (const e of aptos) if (e[1].votos / (e[1].n + 1) > melhor[1].votos / (melhor[1].n + 1)) melhor = e;
      melhor[1].n++;
    }
  };
  if (parcial) projetar();

  const bancadas = [...porPartido.entries()]
    .filter(([, p]) => !parcial || p.n > 0)
    .sort((a, b) => b[1].n - a[1].n || b[1].votos - a[1].votos);
  const quanto = ([, p]: [string, { n: number; votos: number }]) => `${parcial ? '~' : ''}${p.n}`;

  const barra = `<p class="bancadas${parcial ? ' previa' : ''}">`
    + bancadas.slice(0, 8).map(e =>
        `<span style="--cor:${esc(e[1].cor)}">${esc(e[0])} <b>${quanto(e)}</b></span>`).join('')
    + (bancadas.length > 8
      ? `<span class="resto">+${bancadas.length - 8} partidos `
        + `<b>${parcial ? '~' : ''}${bancadas.slice(8).reduce((t, [, p]) => t + p.n, 0)}</b></span>`
      : '')
    + (parcial
      ? `<span class="aberta">projeção sobre ${fmtPercent(race.countedPercent, 1)} apurado</span>`
      : vazias ? `<span class="aberta">a definir <b>${vazias}</b></span>` : '')
    + `</p>`;

  /*
   * Os cinco mais votados como colunas, e a altura é o voto.
   *
   * Antes eram cinco traços iguais com um número em cima — e cinco traços iguais dizem que os
   * cinco são iguais, que é o contrário do que uma votação é. Com a altura proporcional, a
   * diferença entre o primeiro e o quinto é vista antes de ser lida.
   *
   * A base da coluna não é zero: entre 11.468 e 11.402 votos, um eixo a partir do zero faria
   * cinco colunas indistinguíveis. A escala começa um pouco abaixo do quinto colocado — e o número
   * de votos vai escrito sob cada coluna, que é o que impede a leitura torta.
   */
  const ordem = parcial ? [...race.candidates].sort((a, b) => b.votes - a.votes) : eleitos;
  // o mesmo registro das disputas de cima: é o que dá a seta e o deslize a estas colunas também
  registrarMovimento(office, race, ordem);
  const cinco = ordem.slice(0, 5);
  if (!cinco.length || !cinco[0].votes) return barra + `<p class="vazio">Nenhum voto publicado ainda.</p>`;
  const teto = Math.max(1, ...cinco.map(c => c.votes));
  const piso = Math.min(...cinco.map(c => c.votes));
  const chao = Math.max(0, piso - (teto - piso) * 0.6 - teto * 0.02);
  const altura = (v: number) => `${(((v - chao) / Math.max(1, teto - chao)) * 100).toFixed(1)}%`;
  const lista = `<ol class="eleitos">${cinco.map((c, i) => {
    const chave = `${office}:${race.election}:${race.uf}:${race.turn}:${c.id}`;
    return `<li data-id="${esc(chave)}" style="--cor:${esc(c.color)};--h:${altura(c.votes)}"><em>${i + 1}</em>`
      + `<span class="coluna"></span>`
      + `<b>${fmtInt(c.votes)}${selo(chave)}</b><i><button class="abre">${esc(c.name)}</button></i>`
      + `<u>${esc(c.party)}${c.number ? ` · ${esc(c.number)}` : ''}</u></li>`;
  }).join('')}</ol>`;

  // o custo da cadeira subiu para o cabeçalho do painel; aqui ficam as bancadas e os mais votados
  return barra + lista;
}

/* ── montagem ──────────────────────────────────────────────────────────────────────────── */

async function main() {
  seedScale();
  app.append(mountShellBar('tv'));

  const palco = document.createElement('main');
  palco.className = 'noite';
  /*
   * O cabeçalho é o do aplicativo, não um inventado aqui.
   *
   * As outras telas usam a mesma barra — marca, seletor de Visão, fonte, estado e turno — e
   * esta tinha um cabeçalho só dela, sem a troca de tela e com o estado num seletor diferente. Duas
   * barras de navegação no mesmo produto é uma a mais.
   */
  // o estado e a eleição vivem na barra do aplicativo; aqui sobram o relógio e a tela cheia
  palco.innerHTML = ``
    + `<div class="corridas">${CORRIDAS.map(c =>
        `<section data-c="${c.key}"><header><h2><button class="tudo">${esc(c.nome)}</button></h2>`
        + (c.key === 'president'
          ? `<nav class="escopo"><button data-e="BR">Brasil</button>`
            + `<button data-e="UF">${esc(UF)}</button></nav>`
          : '')
        + `<span class="ap">—</span></header>`
        + `<div class="corpo"></div><p class="decide">—</p></section>`).join('')}</div>`
    + `<div class="cadeiras">${CADEIRAS.map(c =>
        `<section data-c="${c.key}"><header><h2><button class="tudo">${esc(c.nome)}</button></h2><span class="ap">—</span></header>`
        + `<div class="corpo"></div><p class="decide">—</p></section>`).join('')}</div>`
    /*
     * O rodapé carrega o fio e, no canto, o relógio e o botão da TV — "TV" porque é o que se faz
     * com ele: jogar o painel na televisão, sem a barra do aplicativo por cima.
     */
    /*
     * O transporte, em pé, na lateral.
     *
     * A TV não tem a barra de reprodução das outras telas: ela ocuparia a faixa inferior inteira,
     * que aqui é do fio. Sobram os três gestos que se fazem de longe — voltar ao começo, tocar,
     * pausar —, empilhados na margem, onde a mão chega sem cruzar os números.
     */
    + `<nav class="fita" aria-label="Reprodução da apuração">`
    + `<button class="ini" title="Voltar ao início da apuração" aria-label="Voltar ao início">${ICO.ini}</button>`
    + `<button class="toca" title="Reproduzir a apuração" aria-label="Reproduzir">${ICO.toca}</button>`
    + `<button class="pausa" title="Pausar" aria-label="Pausar">${ICO.pausa}</button>`
    // a aceleração: quantos minutos de apuração cabem num segundo de relógio
    + VELOCIDADES.map(v => `<button class="vel" data-v="${v}" title="${v} vez${v === 1 ? '' : 'es'} mais rápido">${v}×</button>`).join('')
    + `<button class="vivo" title="Voltar ao ao vivo" aria-label="Ao vivo"><i></i></button>`
    + `<span class="quando">ao vivo</span></nav>`
    + `<footer class="fio"><div class="rolo"><div class="tira"></div></div>`
    + `<div class="canto"><span class="rel">—</span>`
    + `<button class="cheia" title="Ver em tela cheia, sem a barra do aplicativo">TV</button></div></footer>`;
  app.append(palco);

  /*
   * FLIP: a linha que trocou de lugar desliza até a posição nova.
   *
   * O painel é redesenhado inteiro a cada leitura, então as posições antigas são medidas antes e
   * reaplicadas como deslocamento nas linhas novas — sem isso, uma ultrapassagem é um salto, e um
   * salto não se vê. Quem tem a aba em segundo plano não paga nada: sem posição anterior, não há
   * animação.
   */
  /*
   * Os dois eixos, porque as duas listas trocam de lugar em direções diferentes: as disputas são
   * linhas empilhadas e trocam na vertical; os mais votados dos deputados são colunas lado a lado
   * e trocam na horizontal. Medir só o topo deixava a proporcional sem animação nenhuma.
   */
  const ALVOS = '.nomes li[data-id], .eleitos li[data-id]';
  const medirPosicoes = () => {
    const mapa = new Map<string, { x: number; y: number }>();
    for (const li of palco.querySelectorAll<HTMLElement>(ALVOS)) {
      const r = li.getBoundingClientRect();
      mapa.set(li.dataset.id!, { x: r.left, y: r.top });
    }
    return mapa;
  };
  const animarTrocas = (antes: Map<string, { x: number; y: number }>) => {
    for (const li of palco.querySelectorAll<HTMLElement>(ALVOS)) {
      const de = antes.get(li.dataset.id!);
      if (de === undefined) continue;
      const r = li.getBoundingClientRect();
      const dy = de.y - r.top, dx = de.x - r.left;
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) continue;
      li.style.transition = 'none';
      li.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        li.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1)';
        li.style.transform = '';
      });
    }
  };

  const desenhar = () => {
    const antes = medirPosicoes();
    for (const { key } of CORRIDAS) {
      const secao = palco.querySelector<HTMLElement>(`.corridas section[data-c="${key}"]`)!;
      const race = snap?.races?.[key];
      secao.querySelector('.ap')!.textContent = race ? `${fmtPercent(race.countedPercent, 1)} apurado` : '—';
      secao.querySelector('.corpo')!.innerHTML = corrida(key, race);
      secao.querySelector('.decide')!.innerHTML = key === 'president' && escopoPresidente === 'UF'
        ? `Votos da presidência apurados em ${esc(stateName(UF))}`
        : decide(key, race);
      for (const b of secao.querySelectorAll<HTMLButtonElement>('.escopo button')) {
        b.classList.toggle('on', b.dataset.e === escopoPresidente);
      }
    }
    for (const { key } of CADEIRAS) {
      const secao = palco.querySelector<HTMLElement>(`.cadeiras section[data-c="${key}"]`)!;
      const race = snap?.races?.[key];
      /*
       * O custo da cadeira vai no rodapé do painel, escrito por extenso — no mesmo lugar em que as
       * corridas dizem o que decide a disputa. Espremido no cabeçalho como "cadeira: 240.096
       * votos", virava um fragmento em amarelo disputando espaço com o percentual apurado.
       */
      secao.querySelector('.ap')!.textContent = race ? `${fmtPercent(race.countedPercent, 1)} apurado` : '—';
      const qe = race?.seats && race.validVotes ? Math.round(race.validVotes / race.seats) : null;
      const faltam = race ? Math.max(0, race.seats - race.candidates.filter(c => c.elected).length) : 0;
      secao.querySelector('.decide')!.innerHTML = race
        ? `${qe ? `Cada cadeira custa <b>${fmtInt(qe)}</b> votos` : `${race.seats} vagas em disputa`}`
          + `${faltam ? ` · <b>${faltam}</b> ${faltam === 1 ? 'vaga ainda em aberto' : 'vagas ainda em aberto'}` : ''}`
        : 'Aguardando o TSE';
      secao.querySelector('.corpo')!.innerHTML = cadeiras(key, race);
    }
    palco.querySelector('.rel')!.textContent = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    animarTrocas(antes);
  };

  /*
   * O fio: o que aconteceu, em frases. É o que permite deixar a tela no ar — quem olha de longe
   * não precisa interpretar três gráficos para saber que houve uma virada.
   */
  const VALE = new Set(['lead', 'elected', 'finished', 'milestone']);
  const lerFio = async () => {
    try {
      const r = await fetch(`/api/feed?mode=${MODE}&uf=${UF}&turn=${TURN}&limit=30`, { cache: 'no-store' });
      if (!r.ok) return;
      const { events } = await r.json() as { events: { kind: string; title: string; detail: string }[] };
      const linhas = events.filter(e => VALE.has(e.kind)).slice(0, 8);
      if (!linhas.length) return;
      const corpo = linhas.map(e =>
        `<span class="it k-${e.kind}"><b>${esc(e.title)}</b> ${esc(e.detail)}</span>`).join('');
      // escrito duas vezes para o laço fechar sem emenda
      palco.querySelector('.tira')!.innerHTML = corpo + corpo;
    } catch { /* o rodapé fica com o que tinha */ }
  };

  /*
   * O rótulo do assento, seguindo o cursor.
   *
   * O `title` do navegador levaria um segundo para aparecer e viria com a cara do sistema; num
   * plenário de 77 bolinhas, é a diferença entre poder ler a casa e ter de adivinhá-la. Um só
   * elemento serve os dois hemiciclos, e ele escuta no palco — os assentos são redesenhados a cada
   * atualização, e um ouvinte por bolinha morreria junto com elas.
   */
  const rotulo = document.createElement('div');
  rotulo.className = 'rotulo-assento';
  rotulo.hidden = true;
  palco.append(rotulo);
  palco.addEventListener('pointermove', e => {
    const alvo = (e.target as HTMLElement).closest('.assento') as SVGCircleElement | null;
    if (!alvo) { rotulo.hidden = true; return; }
    const nome = alvo.getAttribute('data-nome') ?? '';
    const partido = alvo.getAttribute('data-partido');
    const votos = alvo.getAttribute('data-votos');
    rotulo.innerHTML = `<b>${esc(nome)}</b>`
      + (partido ? `<i>${esc(partido)}</i>` : '')
      + (votos ? `<u>${esc(votos)} votos</u>` : '');
    rotulo.hidden = false;
    rotulo.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 10}px)`;
  });
  palco.addEventListener('pointerleave', () => { rotulo.hidden = true; });

  /*
   * A presidência dentro do estado é somada município a município — e essa soma é obrigatória.
   *
   * O arquivo municipal da presidência é nacional: são os 5.570 municípios do país, e a lista de
   * totais que vem junto é o total do Brasil. Usá-la aqui punha dez milhões de votos no painel de
   * Minas, que tem dezesseis milhões de eleitores no total. O que vale é filtrar as linhas pela UF
   * e somar os pares de cada uma.
   */
  const lerPresidenciaNoEstado = async () => {
    try {
      const r = await fetch(`/api/municipal?mode=${MODE}&uf=${UF}&turn=${TURN}&office=president`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json() as {
        c: [string, number][];
        m: [string, string, string, number, number[], string?][];
        n: Record<string, [string, string]>;
      };
      const soma = new Map<number, number>();
      for (const [, , uf, , pares] of d.m) {
        if (uf !== UF) continue;
        for (let i = 0; i < pares.length; i += 2) {
          soma.set(pares[i], (soma.get(pares[i]) ?? 0) + pares[i + 1]);
        }
      }
      if (!soma.size) return;
      const cores = new Map((snap?.races?.president?.candidates ?? []).map(c => [c.number, c.color]));
      presidenteNoEstado = [...soma.entries()]
        .map(([indice, votos]) => {
          const numero = d.c[indice]?.[0] ?? '';
          return {
            numero, votos,
            nome: d.n[numero]?.[0] ?? numero,
            partido: d.n[numero]?.[1] ?? '',
            cor: cores.get(numero) ?? '#7d93a0',
          };
        })
        .sort((a, b) => b.votos - a.votos);
    } catch { /* o painel continua no nacional */ }
  };

  palco.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.escopo button') as HTMLButtonElement | null;
    if (!b?.dataset.e) return;
    escopoPresidente = b.dataset.e as Escopo;
    desenhar();
  });

  /*
   * O painel mostra os primeiros; a tabela mostra o resto.
   *
   * Clicar no título de uma disputa abre o cargo inteiro — todas as candidaturas, com votos,
   * percentual e a situação publicada. Clicar num nome abre a mesma tabela, já parada na linha
   * dele. É a resposta para "e o fulano, com quantos está?", que num painel de três linhas não
   * tem onde ser feita.
   */
  const abrirDisputa = (office: Office, destaque?: string) => {
    const race = snap?.races?.[office];
    if (!race?.candidates.length) return;
    const nome = [...CORRIDAS, ...CADEIRAS].find(c => c.key === office)?.nome ?? office;
    const onde = office === 'president' ? 'Brasil' : stateName(UF);
    const vagas = office === 'senate' ? (race.seats > 0 ? race.seats : 2)
      : office === 'federal' || office === 'state' ? race.seats : 0;
    abrirTabela({
      titulo: nome,
      subtitulo: `${onde} · ${fmtPercent(race.countedPercent, 1)} apurado`,
      candidatos: race.candidates,
      corte: vagas || undefined,
      destaque,
      aoEscolher: c => abrirCidades(office, c),
      completar: race.candidateCount && race.candidateCount > race.candidates.length
        ? () => listaCompleta(office)
        : undefined,
    });
  };

  /** A lista inteira de uma disputa, que o snapshot não carrega por peso. */
  const listaCompleta = async (office: Office): Promise<Candidate[]> => {
    const r = await fetch(`/api/race?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${office}`, { cache: 'no-store' });
    if (!r.ok) return [];
    return (await r.json() as { candidates: Candidate[] }).candidates;
  };

  /** As cidades de uma candidatura: onde os votos dela foram dados. */
  const abrirCidades = (office: Office, c: Candidate) => {
    abrirCandidato({
      titulo: [...CORRIDAS, ...CADEIRAS].find(x => x.key === office)?.nome ?? office,
      nome: c.name,
      subtitulo: `${c.party}${c.number ? ` ${c.number}` : ''} · ${fmtInt(c.votes)} votos · ${fmtPercent(c.percent, 2)}`,
      numero: c.number ?? '',
      cor: c.color || '#8a94a6',
      mode: MODE, uf: UF, turn: TURN, office,
    });
  };

  palco.addEventListener('click', e => {
    const alvo = e.target as HTMLElement;
    const titulo = alvo.closest('.tudo');
    if (titulo) {
      const office = titulo.closest('section')?.getAttribute('data-c') as Office | null;
      if (office) abrirDisputa(office);
      return;
    }
    const nome = alvo.closest('.abre');
    if (!nome) return;
    const chave = nome.closest('li')?.getAttribute('data-id') ?? '';
    const office = chave.slice(0, chave.indexOf(':')) as Office;
    const id = chave.slice(chave.lastIndexOf(':') + 1);
    const race = office ? snap?.races?.[office] : undefined;
    const c = race?.candidates.find(x => x.id === id);
    if (!c) return;
    /*
     * O nome abre as cidades dele, não a tabela do cargo.
     *
     * São duas perguntas diferentes: o título pergunta "como está esta disputa", e a tabela
     * responde; o nome pergunta "quem é este e de onde vêm os votos dele", e a resposta é o mapa
     * dele em lista — onde foi mais votado, com que fatia da cidade e em que lugar ficou lá.
     */
    abrirCidades(office, c);
  });

  palco.querySelector<HTMLButtonElement>('.cheia')!.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  });
  /*
   * Em tela cheia, a barra do aplicativo sai.
   *
   * Ela existe para navegar entre telas e trocar estado ou eleição — tudo o que se faz antes de
   * deixar o painel no ar. Uma vez em tela cheia, ela é só uma faixa ocupando altura que os
   * números usam. Sair da tela cheia a traz de volta.
   */
  document.addEventListener('fullscreenchange', () => {
    const cheia = !!document.fullscreenElement;
    palco.querySelector('.cheia')!.textContent = cheia ? 'sair da TV' : 'TV';
    document.documentElement.classList.toggle('sem-barra', cheia);
  });

  /*
   * O transporte.
   *
   * A apuração é uma gravação: o servidor guarda cada leitura publicada e devolve o estado de um
   * instante qualquer. Aqui isso vira três gestos — voltar ao começo, tocar, pausar — e um relógio
   * que diz de que hora é o painel no ar. Tocando, o tempo corre a um minuto de apuração por
   * segundo, que é o passo em que uma virada de madrugada cabe num intervalo de comercial. Ao
   * chegar no fim de uma apuração que ainda está de pé, o painel volta sozinho para o ao vivo — é
   * onde ele tem de terminar.
   */
  const fita = palco.querySelector<HTMLElement>('.fita')!;
  let linha: Timeline | null = null, lidoEm = 0;
  let momento: number | null = null;     // nulo é o ao vivo
  let tocando = false;
  let velocidade = 60;
  const aoVivo = () => momento === null;
  const fimAgora = () => !linha ? Date.now() : linha.live ? linha.end + (Date.now() - lidoEm) : linha.end;
  const relogio = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });

  let buscando = false;
  const ler = async () => {
    if (buscando) return;
    buscando = true;
    try { snap = await loadSnapshot(momento ?? undefined); desenhar(); }
    catch { /* o painel segue com a última leitura */ }
    finally { buscando = false; }
  };

  const pintarFita = () => {
    fita.classList.toggle('some', !linha?.available);
    fita.classList.toggle('vivo', aoVivo());
    fita.querySelector('.toca')!.classList.toggle('on', tocando);
    fita.querySelector('.pausa')!.classList.toggle('on', !tocando && !aoVivo());
    fita.querySelector('.vivo')!.classList.toggle('on', aoVivo());
    for (const b of fita.querySelectorAll<HTMLElement>('.vel')) {
      b.classList.toggle('on', Number(b.dataset.v) === velocidade);
    }
    fita.querySelector('.quando')!.textContent = aoVivo() ? 'ao vivo' : relogio(momento!);
  };

  const irPara = (ms: number, toca: boolean) => {
    if (!linha) return;
    momento = Math.max(linha.start, Math.min(ms, fimAgora()));
    tocando = toca;
    void ler(); pintarFita();
  };
  const voltarAoVivo = () => { momento = null; tocando = false; void ler(); pintarFita(); };

  fita.querySelector('.ini')!.addEventListener('click', () => linha && irPara(linha.start, false));
  fita.querySelector('.toca')!.addEventListener('click', () => {
    if (!linha?.available) return;
    // tocar do ponto onde parou; no ao vivo, ou no fim da gravação, recomeça do início
    const fim = fimAgora();
    if (aoVivo() || momento! >= fim - 1000) irPara(linha.start, true);
    else { tocando = true; pintarFita(); }
  });
  fita.querySelector('.pausa')!.addEventListener('click', () => { tocando = false; pintarFita(); });
  fita.querySelector('.vivo')!.addEventListener('click', () => { if (!aoVivo()) voltarAoVivo(); });
  fita.querySelector('.quando')!.addEventListener('click', () => { if (!aoVivo()) voltarAoVivo(); });
  for (const b of fita.querySelectorAll<HTMLElement>('.vel')) {
    b.addEventListener('click', () => { velocidade = Number(b.dataset.v); pintarFita(); });
  }

  const lerLinha = async () => {
    try { linha = await loadTimeline(); lidoEm = Date.now(); } catch { /* mantém a anterior */ }
    pintarFita();
  };
  void lerLinha();
  setInterval(() => { if (visivel()) void lerLinha(); }, 15_000);

  let ultimo = performance.now(), ultimaBusca = 0;
  setInterval(() => {
    const agora = performance.now(), dt = agora - ultimo; ultimo = agora;
    if (aoVivo() || !tocando || !linha || !visivel()) return;
    momento! += dt * velocidade;
    if (momento! >= fimAgora()) {
      if (linha.live) { voltarAoVivo(); return; }
      momento = fimAgora(); tocando = false;
    }
    if (Date.now() - ultimaBusca >= 600) { ultimaBusca = Date.now(); void ler(); }
    pintarFita();
  }, 250);

  /*
   * Documento escondido não pede nada.
   *
   * Cada tela pré-renderiza as outras, então as quatro cópias que ninguém está lendo faziam as
   * mesmas leituras da que está na tela — e disputavam com ela as conexões do navegador. Aqui elas
   * ficam paradas, e a tela pede tudo de novo no instante em que vira a página da frente.
   */
  const visivel = () => document.visibilityState === 'visible'
    && !(document as Document & { prerendering?: boolean }).prerendering;

  snap = await loadSnapshot().catch(() => null);
  await lerPresidenciaNoEstado();
  desenhar();
  void lerFio();

  // no replay, o ao vivo não manda no painel: quem escolhe o instante é o transporte
  onSnapshot(s => { if (aoVivo()) { snap = s; desenhar(); } });
  setInterval(() => {
    if (!aoVivo() || !visivel()) return;
    void loadSnapshot().then(s => { snap = s; desenhar(); }).catch(() => {});
  }, 15_000);
  setInterval(() => { if (visivel()) void lerFio(); }, 12_000);
  setInterval(() => { if (visivel()) void lerPresidenciaNoEstado().then(desenhar); }, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (!visivel() || !aoVivo()) return;
    void loadSnapshot().then(s => { snap = s; desenhar(); }).catch(() => {});
    void lerFio();
  });

  pageReady();
}

void main();
