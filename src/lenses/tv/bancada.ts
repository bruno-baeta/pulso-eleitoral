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
  const qe = Math.round(quocienteEleitoral(o.race.validVotes, o.race.seats));
  const til = projetada ? '~' : '';
  const totalCadeiras = bancadas.reduce((t, b) => t + b.cadeiras, 0);
  const semCadeira = bancadas.filter(b => b.cadeiras === 0).length;

  /*
   * Uma bolinha por vaga, agrupadas por partido.
   *
   * Sem hemiciclo: o arco é bonito e mente sobre a ordem — ele sugere uma posição no plenário que
   * a apuração não define. Fileiras por partido dizem a mesma coisa sem inventar geografia.
   */
  const desenho = bancadas.filter(b => b.cadeiras > 0).map(b =>
    `<div class="grupo">`
    + `<div class="assentos">${Array.from({ length: b.cadeiras }, () =>
        `<i class="assento${projetada ? ' previsto' : ''}" style="--cor:${esc(b.cor)}"></i>`).join('')}</div>`
    + `<div class="sigla"><span style="--cor:${esc(b.cor)}">${esc(b.partido)}</span> <b>${til}${b.cadeiras}</b></div>`
    + `</div>`).join('');

  const linhas = bancadas.map(b => {
    const porCadeira = b.cadeiras ? Math.round(b.votos / b.cadeiras) : null;
    return `<tr${b.cadeiras ? '' : ' class="fora"'}>`
      + `<td><i class="pt" style="background:${esc(b.cor)}"></i>${esc(b.partido)}</td>`
      + `<td class="r">${fmtInt(b.votos)}</td>`
      + `<td class="r">${o.race.validVotes ? fmtPercent(b.votos / o.race.validVotes * 100, 2) : '—'}</td>`
      + `<td class="r"><b>${b.cadeiras ? `${til}${b.cadeiras}` : '—'}</b></td>`
      + `<td class="r">${porCadeira ? fmtInt(porCadeira) : '—'}</td></tr>`;
  }).join('');

  const fundo = document.createElement('div');
  fundo.className = 'tbl-fundo';
  fundo.innerHTML = `<div class="tbl-folha bnc" role="dialog" aria-label="Cadeiras por partido">`
    + `<header><div><div class="t">${esc(o.titulo)} · cadeiras</div>`
    + `<div class="s">${esc(o.subtitulo)} · ${o.race.seats} vagas · ${bancadas.length} partidos</div></div>`
    + `<button aria-label="Fechar">✕</button></header>`
    + `<div class="rolo">`
    + `<p class="preco">${qe > 0 && !semApuracao
        ? `Cada cadeira custa <b>${fmtInt(qe)}</b> votos — o quociente eleitoral, que é os votos válidos divididos pelas vagas.`
        : 'O quociente eleitoral aparece quando os votos válidos começam a ser publicados.'}</p>`
    + (desenho
      ? `<div class="hemi">${desenho}</div>`
      : `<p class="vazio">${semApuracao ? 'A apuração desta disputa ainda não começou.' : 'Nenhuma cadeira definida ainda.'}</p>`)
    + `<p class="nota">${semApuracao
        ? `As cadeiras aparecem quando os primeiros votos válidos forem publicados pelo TSE.`
        : projetada
        ? `Projeção pelo quociente eleitoral sobre <b>${fmtPercent(o.race.countedPercent, 1)}</b> apurado — as bolinhas vazadas e o til dizem isso. O TSE ainda não publicou nenhum eleito nesta disputa.`
        : `Cadeiras publicadas pelo TSE: <b>${totalCadeiras}</b> de ${o.race.seats}.`}</p>`
    + `<table><colgroup><col style="width:26%"><col style="width:20%"><col style="width:16%">`
    + `<col style="width:16%"><col style="width:22%"></colgroup>`
    + `<thead><tr><th>Partido</th><th class="r">Votos</th><th class="r">% válidos</th>`
    + `<th class="r">Cadeiras</th><th class="r">Votos por cadeira</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table>`
    + (semCadeira ? `<p class="nota">${semCadeira} ${semCadeira === 1 ? 'partido não alcançou' : 'partidos não alcançaram'} o quociente e ${semCadeira === 1 ? 'fica' : 'ficam'} fora da distribuição.</p>` : '')
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
.bnc .preco { margin: 0 0 18px; font-size: 15px; color: var(--tinta-2, #b9c2cc); }
.bnc .preco b { color: inherit; font-variant-numeric: tabular-nums; }

.bnc .hemi { display: flex; flex-wrap: wrap; gap: 18px 22px; margin-bottom: 16px; }
.bnc .grupo { display: flex; flex-direction: column; gap: 7px; }
.bnc .assentos { display: flex; flex-wrap: wrap; gap: 4px; max-width: 220px; }

/* Cheia é cadeira publicada pelo TSE; vazada é projecao. A diferenca precisa ser visivel de
   longe, entao ela e de preenchimento, nao de tom. */
.bnc .assento { width: 15px; height: 15px; border-radius: 50%; background: var(--cor); display: block; }
.bnc .assento.previsto { background: transparent; box-shadow: inset 0 0 0 2px var(--cor); }

.bnc .sigla { font-size: 13px; opacity: .85; white-space: nowrap; }
.bnc .sigla span { color: var(--cor); font-weight: 600; }
.bnc .sigla b { font-variant-numeric: tabular-nums; }

.bnc .nota { margin: 0 0 16px; font-size: 13px; opacity: .7; line-height: 1.5; }
.bnc tr.fora td { opacity: .45; }
.bnc .pt { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; vertical-align: baseline; }
.bnc .vazio { padding: 24px 0; text-align: center; opacity: .6; }

@media (max-width: 720px) {
  .bnc .assentos { max-width: 150px; }
  .bnc .hemi { gap: 14px; }
}
`;
