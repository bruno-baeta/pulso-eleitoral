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
import { bancadasDe, projetarEleitos, quocienteEleitoral } from './bancadas';

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
  const ocupantesDe = new Map<string, Candidate[]>();
  const semNomeDe = new Map<string, number>();
  if (projetada) {
    /*
     * A projeção também diz quem, e a regra é o art. 108 do Código Eleitoral: entre as candidaturas
     * do partido com ao menos 10% do quociente, elegem-se as mais votadas, até o número de cadeiras
     * que o partido fez. Vaga sem candidatura apta fica sem nome — ela volta para a redistribuição
     * do art. 109, §2º, e inventar um nome ali seria dizer que alguém se elegeu sem base.
     */
    for (const p of projetarEleitos(o.candidatos, bancadas, qe)) {
      ocupantesDe.set(p.partido, p.ocupantes);
      semNomeDe.set(p.partido, p.semNome);
    }
  } else {
    for (const c of o.candidatos) {
      if (!c.elected) continue;
      const lista = ocupantesDe.get(c.party) ?? [];
      lista.push(c);
      ocupantesDe.set(c.party, lista);
    }
    for (const lista of ocupantesDe.values()) lista.sort((a, b) => b.votes - a.votes);
  }

  const desenho = bancadas.filter(b => b.cadeiras > 0).map(b => {
    const votos = votosDe(b.partido);
    const ocupantes = ocupantesDe.get(b.partido) ?? [];
    const semNome = semNomeDe.get(b.partido) ?? Math.max(0, b.cadeiras - ocupantes.length);
    /*
     * Partido sem nenhum nome apto volta a ser bolinha, e não uma lista repetindo a mesma frase.
     *
     * Cedo na apuração isso é o normal: com o voto espalhado por mil e seiscentas candidaturas,
     * ninguém tem 10% do quociente ainda. Visto no simulado das 14h — setenta e sete linhas
     * iguais dizendo a mesma coisa, que é ruído no lugar de informação. O porquê fica dito uma vez
     * só, no rodapé, com o número do piso.
     */
    const corpo = !ocupantes.length
      ? `<div class="assentos">${Array.from({ length: b.cadeiras }, () =>
          `<i class="assento previsto" style="--cor:${esc(b.cor)}"></i>`).join('')}</div>`
      : `<ol class="eleitos">${ocupantes.map(c =>
        `<li><i class="assento${projetada ? ' previsto' : ''}" style="--cor:${esc(b.cor)}"></i>`
        + `<span class="nm">${esc(c.name)}</span>`
        + `<em>${fmtInt(c.votes)}</em></li>`).join('')}`
      + Array.from({ length: semNome }, () =>
        `<li class="anonima"><i class="assento previsto" style="--cor:${esc(b.cor)}"></i>`
        + `<span class="nm">vaga ainda sem candidatura apta</span></li>`).join('')
      + `</ol>`;
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
    + `<p class="estado">${semApuracao
        ? 'As cadeiras aparecem quando os primeiros votos válidos forem publicados pelo TSE.'
        : projetada
        ? `<b>Projeção</b> sobre ${fmtPercent(o.race.countedPercent, 1)} apurado — é o que as bolinhas vazadas e o til querem dizer. O TSE ainda não elegeu ninguém nesta disputa.`
        : `<b>Resultado publicado pelo TSE</b> — ${totalCadeiras} de ${o.race.seats} cadeiras definidas.`}</p>`
    /*
     * A regra em passos, com os números desta disputa.
     *
     * Antes eram dois parágrafos corridos com quatro regras dentro, e ninguém lê isso numa tela de
     * apuração. Cada passo é uma pergunta que a pessoa faz olhando a folha, na ordem em que ela faz.
     */
    + (semApuracao ? '' : `<dl class="regra">`
      + `<dt>O preço de uma cadeira</dt>`
      + `<dd>O <b>quociente eleitoral</b>: ${fmtInt(o.race.validVotes)} votos válidos repartidos pelas ${o.race.seats} vagas, ${fmtInt(qe)} votos cada.</dd>`
      + `<dt>Quantas cadeiras cada partido faz</dt>`
      + `<dd>Quantas vezes o total do partido couber no quociente. As vagas que sobram vão por <b>maiores médias</b>, e disputa essas sobras quem tem ao menos 80% do quociente — ${fmtInt(Math.round(qe * 0.8))} votos. É por isso que um partido abaixo do quociente ainda pode eleger.</dd>`
      + `<dt>Quem ocupa cada cadeira</dt>`
      + `<dd>Dentro do partido, as candidaturas mais votadas que tenham ao menos <b>10% do quociente</b> — ${fmtInt(Math.round(qe * 0.1))} votos. Vaga sem ninguém nesse piso fica sem nome: ela volta para a redistribuição.</dd>`
      + `<dt>O que entra em "votos nominais"</dt>`
      + `<dd>A soma das candidaturas do partido. O <b>voto de legenda</b>, dado ao número do partido, não entra nesta conta.</dd>`
      + `</dl>`)
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
.bnc ol.eleitos li.anonima .nm { color: #565954; font-style: italic; }
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

.bnc .estado { margin: 0; padding: 2.2vh 2.2vw .6vh; font-size: clamp(10px, .8vw, 15px);
  line-height: 1.5; color: #6a6863; }
.bnc .estado b { color: #b9b6ae; }

/* A regra em passos: o termo de um lado, a frase do outro. Dois paragrafos corridos com quatro
   regras dentro ninguem le numa tela de apuracao. */
.bnc dl.regra { display: grid; grid-template-columns: minmax(9vw, 15vw) 1fr;
  gap: .9vh 1.4vw; margin: 0; padding: 1.4vh 2.2vw 2.4vh; }
.bnc dl.regra dt { font-size: clamp(9px, .72vw, 14px); color: #8b8981; text-align: right;
  line-height: 1.45; }
.bnc dl.regra dd { margin: 0; font-size: clamp(10px, .78vw, 15px); color: #6a6863; line-height: 1.5; }
.bnc dl.regra dd b { color: #b9b6ae; font-weight: 600; }

@media (max-width: 720px) {
  .bnc dl.regra { grid-template-columns: 1fr; gap: .3vh 0; }
  .bnc dl.regra dt { text-align: left; color: #b9b6ae; margin-top: 1.4vh; }
}
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
