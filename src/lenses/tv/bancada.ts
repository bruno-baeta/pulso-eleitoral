/**
 * As cadeiras desenhadas, uma bolinha por vaga.
 *
 * O painel mostra a bancada como sigla e número, que é o que cabe numa linha e se lê de longe. A
 * pergunta seguinte — "como essas cadeiras se repartem, e quanto custou cada uma?" — não cabe ali,
 * e é esta folha que responde.
 *
 * A regra do projeto vale aqui inteira: **cadeira desenhada cheia é cadeira que o TSE elegeu.**
 * Antes de haver eleito publicado, a bancada é projeção pelo quociente eleitoral, e então as
 * bolinhas saem vazadas, com til no número e a frase dizendo sobre quanto da apuração a conta foi
 * feita. Uma bolinha cheia a mais do que o TSE publicou seria afirmar que alguém se elegeu.
 */
import type { Candidate, WireRace as Race } from '../../../shared/types';
import { esc, fmtInt, fmtPercent } from '../../shell/dados';
import { montarCss } from '../../shell/tabela';
import { bancadasDe, quocienteEleitoral } from './bancadas';

export interface BancadaOpcoes {
  titulo: string;
  /** "Minas Gerais · 74,0% apurado" — o mesmo subtítulo dos outros modais. */
  subtitulo: string;
  race: Race;
  /** A lista inteira da disputa. A do painel vem cortada, e somar votos de partido nela subestima. */
  candidatos: Candidate[];
}

export function abrirBancadas(o: BancadaOpcoes) {
  montarCss();
  montarEstilo();
  document.querySelector('.tbl-fundo')?.remove();

  /*
   * Sem voto apurado não há o que projetar.
   *
   * Com os válidos em zero o quociente é zero, todo partido "alcança" o quociente e as maiores
   * médias repartem as vagas entre listas vazias: setenta e sete bolinhas desenhadas a partir de
   * nada. Verificado no simulado das 14h de 23/09/2026, com a apuração em 0,0%. A folha abre
   * dizendo que a apuração não começou, que é a única coisa verdadeira nesse instante.
   */
  const semApuracao = o.race.validVotes <= 0 || o.race.countedPercent <= 0;
  const { bancadas, projetada } = semApuracao
    ? { bancadas: [], projetada: true }
    : bancadasDe(o.candidatos, o.race.seats, o.race.validVotes);
  /*
   * Os votos do partido, e não os dos eleitos dele.
   *
   * `bancadasDe` soma só as candidaturas eleitas quando o TSE já publicou eleitos — o que é certo
   * para contar cadeiras e errado para exibir como "votos do partido". A primeira versão desta
   * folha mostrou o Solidariedade com 86.042 votos e uma cadeira, contra um quociente de 210.964:
   * aquilo eram os votos pessoais do único eleito, não do partido, que fez 178.969. Número na tela
   * com rótulo que quer dizer outra coisa é a mesma família de erro que a regra 2 existe para
   * impedir.
   *
   * Isto ainda é o voto **nominal** — a soma das candidaturas. O voto de legenda, dado ao número do
   * partido, não vem na lista de candidatos: nesta disputa são 343.691 votos, 3% dos válidos.
   */
  const nominais = new Map<string, number>();
  for (const c of o.candidatos) nominais.set(c.party, (nominais.get(c.party) ?? 0) + c.votes);
  const votosDe = (partido: string) => nominais.get(partido) ?? 0;

  const qe = Math.round(quocienteEleitoral(o.race.validVotes, o.race.seats));
  const til = projetada ? '~' : '';
  const totalCadeiras = bancadas.reduce((t, b) => t + b.cadeiras, 0);

  /*
   * Cada vaga com o nome de quem a ocupa — quando há nome.
   *
   * Quem senta é quem o TSE elege, e é só isso que aparece escrito. Enquanto a bancada é projeção
   * pelo quociente, sabemos quantas cadeiras um partido faz e **não** sabemos quem: a lei ainda
   * exige que a candidatura alcance 10% do quociente, e a fila interna do partido depende disso.
   * Nesse estado as vagas saem como bolinhas vazadas, sem nome, e a folha diz por quê.
   */
  const eleitosDe = new Map<string, Candidate[]>();
  for (const c of o.candidatos) {
    if (!c.elected) continue;
    const lista = eleitosDe.get(c.party) ?? [];
    lista.push(c);
    eleitosDe.set(c.party, lista);
  }
  for (const lista of eleitosDe.values()) lista.sort((a, b) => b.votes - a.votes);

  const desenho = bancadas.filter(b => b.cadeiras > 0).map(b => {
    const votos = votosDe(b.partido);
    const eleitos = eleitosDe.get(b.partido) ?? [];
    const corpo = eleitos.length
      ? `<ol class="eleitos">${eleitos.map(c =>
          `<li><i class="assento" style="--cor:${esc(b.cor)}"></i>`
          + `<span class="nm">${esc(c.name)}</span>`
          + `<em>${fmtInt(c.votes)}</em></li>`).join('')}</ol>`
      : `<div class="assentos">${Array.from({ length: b.cadeiras }, () =>
          `<i class="assento previsto" style="--cor:${esc(b.cor)}"></i>`).join('')}</div>`;
    return `<div class="grupo">`
      + `<div class="cab"><span class="sg" style="--cor:${esc(b.cor)}">${esc(b.partido)}</span>`
      + `<b>${til}${b.cadeiras}</b> ${b.cadeiras === 1 ? 'cadeira' : 'cadeiras'}</div>`
      + `<div class="vts">${fmtInt(votos)} votos nominais</div>`
      + corpo
      + `</div>`;
  }).join('');

  const fundo = document.createElement('div');
  fundo.className = 'tbl-fundo';
  fundo.innerHTML = `<div class="tbl-folha bnc" role="dialog" aria-label="Cadeiras por partido">`
    + `<header><div><div class="t">${esc(o.titulo)} · cadeiras</div>`
    + `<div class="s">${esc(o.subtitulo)} · ${o.race.seats} vagas · ${bancadas.length} partidos</div></div>`
    + `<button aria-label="Fechar">✕</button></header>`
    + `<div class="rolo">`
    + `<p class="preco">${qe > 0 && !semApuracao
        ? `Cada cadeira custa <b>${fmtInt(qe)}</b> votos: é o quociente eleitoral, os ${fmtInt(o.race.validVotes)} votos válidos repartidos pelas ${o.race.seats} vagas.`
        : 'O quociente eleitoral aparece quando os votos válidos começam a ser publicados.'}</p>`
    + (desenho
      ? `<div class="hemi">${desenho}</div>`
      : `<p class="vazio">${semApuracao ? 'A apuração desta disputa ainda não começou.' : 'Nenhuma cadeira definida ainda.'}</p>`)
    + `<p class="nota">${semApuracao
        ? `As cadeiras aparecem quando os primeiros votos válidos forem publicados pelo TSE.`
        : projetada
        ? `Projeção pelo quociente eleitoral sobre <b>${fmtPercent(o.race.countedPercent, 1)}</b> apurado — as bolinhas vazadas e o til dizem isso. O TSE ainda não publicou nenhum eleito nesta disputa.`
        : `Cadeiras publicadas pelo TSE: <b>${totalCadeiras}</b> de ${o.race.seats}.`}</p>`
    + `<p class="nota">Voto nominal é a soma das candidaturas do partido; o voto de legenda, dado ao número do partido, não entra nesta conta. Um partido pode ficar abaixo do quociente e ainda assim eleger: as vagas que sobram da primeira distribuição vão por maiores médias, e disputa essas sobras quem tem ao menos 80% do quociente.</p>`
    + `</div>`
    + `<div class="pe">A ordem de votação não define as vagas proporcionais; quem senta é quem o TSE elege.</div>`
    + `</div>`;

  const fechar = () => { fundo.remove(); removeEventListener('keydown', naTecla); };
  const naTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
  addEventListener('keydown', naTecla);
  fundo.querySelector('header button')!.addEventListener('click', fechar);
  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });
  document.body.appendChild(fundo);
}

let posto = false;
function montarEstilo() {
  if (posto) return;
  posto = true;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
}

/* Comentario de CSS sem crase: uma crase aqui fecharia o template literal. */
const CSS = `
/* Na casca o que empurra o fechar para a direita e o margin-left:auto do campo de busca. Esta
   folha nao tem busca, entao o X ficava encostado no titulo, no meio da linha. */
.bnc header button { margin-left: auto; }

/* O recuo lateral e o mesmo da casca (2.2vw no cabecalho, no rodape e no .estado). Sem ele estes
   blocos comecavam na borda e a folha ficava com tres margens esquerdas diferentes. */
.bnc .preco { margin: 0; padding: 1.8vh 2.2vw 0; font-size: clamp(12px, .9vw, 17px);
  line-height: 1.5; color: #b9b6ae; }
.bnc .preco b { color: #f6f3ec; font-variant-numeric: tabular-nums; }

/* Grade, nao linha solta: numa fileira as celulas tem a mesma altura, entao as siglas assentam
   todas na mesma base. Com flex, uma bancada que quebrava para a segunda fileira de bolinhas
   empurrava so a sigla dela para baixo e serrilhava a linha inteira. */
.bnc .hemi { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(230px, 20vw, 330px), 1fr));
  gap: 1.6vh 1.2vw; padding: 2.2vh 2.2vw 0;
  /* stretch: numa fileira todas as celulas ficam com a altura da mais alta, entao os blocos viram
     cartoes do mesmo tamanho em vez de uma linha serrilhada. */
  align-items: stretch; }
.bnc .grupo { display: flex; flex-direction: column; gap: .7vh;
  padding: 1.4vh 1.2vw; border: 1px solid #1c211f; border-radius: 4px; background: #0c0f0e; }
.bnc .cab { display: flex; align-items: baseline; gap: .45em;
  font-size: clamp(11px, .85vw, 16px); color: #6a6863; }
.bnc .cab .sg { color: var(--cor); font-weight: 700; letter-spacing: .04em;
  font-size: clamp(12px, .95vw, 18px); }
.bnc .cab b { color: #f6f3ec; font-variant-numeric: tabular-nums; margin-left: auto; }
.bnc .vts { font-size: clamp(9px, .72vw, 14px); color: #565954; margin-bottom: .5vh; }

/* Uma linha por vaga, com o nome de quem senta. */
.bnc ol.eleitos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .55vh; }
.bnc ol.eleitos li { display: flex; align-items: center; gap: .5em;
  font-size: clamp(10px, .8vw, 15px); color: #e8e4dc; }
.bnc ol.eleitos .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bnc ol.eleitos em { margin-left: auto; font-style: normal; color: #8b8981;
  font-variant-numeric: tabular-nums; font-size: .92em; }

/* Projecao: so as vagas, sem nome — o TSE ainda nao disse quem senta. */
.bnc .assentos { display: flex; flex-wrap: wrap; gap: 5px; margin-top: .3vh; }

/* Cheia e cadeira publicada pelo TSE; vazada e projecao. A diferenca e de preenchimento, nao de
   tom, porque precisa ser visivel de longe. */
.bnc .assento { width: clamp(9px, .72vw, 14px); aspect-ratio: 1; border-radius: 50%;
  background: var(--cor); flex: none; }
.bnc .assento.previsto { background: transparent; box-shadow: inset 0 0 0 2px var(--cor); }

.bnc .sigla { font-size: clamp(10px, .78vw, 15px); white-space: nowrap; color: #8b8981; }
.bnc .sigla span { color: var(--cor); font-weight: 600; }
.bnc .sigla b { color: #f6f3ec; font-variant-numeric: tabular-nums; margin-left: .2em; }

.bnc .nota { margin: 0; padding: 2vh 2.2vw; font-size: clamp(10px, .78vw, 15px);
  line-height: 1.55; color: #6a6863; }
.bnc .nota b { color: #b9b6ae; }
.bnc .vazio { margin: 0; padding: 4vh 2.2vw 0; text-align: center; color: #6a6863;
  font-size: clamp(11px, .85vw, 16px); }

.bnc table { margin-top: .6vh; }
.bnc tr.fora td { color: #5c605b; }
.bnc .pt { display: inline-block; width: .62em; height: .62em; border-radius: 50%;
  margin-right: .6em; vertical-align: middle; }

@media (max-width: 720px) {
  .bnc .assentos { width: 46vw; }
  .bnc .hemi { gap: 2vh 6vw; }
}
`;
