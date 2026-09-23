/**
 * A tabela inteira de uma disputa, por cima do painel.
 *
 * Todo painel mostra os primeiros — três nomes, cinco colunas —, e essa é a decisão que o faz ser
 * legível de longe. Mas a pergunta "e o fulano, com quantos votos está?" não tem onde ser feita num
 * painel de três linhas, e quem assiste tem essa pergunta o tempo todo. Aqui ela é respondida sem
 * sair da tela: o título abre o cargo inteiro, o nome abre o cargo inteiro já parado naquela linha.
 *
 * O desenho é o mesmo da tabela da Corrida (src/lenses/corrida/grafico.ts), que é onde ele nasceu: fundo
 * escurecido atrás, folha centrada, busca no cabeçalho, cabeçalho de coluna que gruda ao rolar.
 * Esta é uma versão independente para não mexer numa tela que já está no ar.
 */
import type { Candidate } from '../../shared/types';
import { publishedStatus } from '../domain/derive';
import { esc, fmtInt, fmtPercent, fold, titleCase } from '../domain/format';

export interface TabelaOpcoes {
  titulo: string;
  subtitulo: string;
  candidatos: Candidate[];
  /** A linha que fecha as vagas: ganha o traço que separa quem está dentro de quem está fora. */
  corte?: number;
  /** Identificação da candidatura que abriu a tabela, para acender e rolar até ela. */
  destaque?: string;
  /*
   * O que fazer quando um nome da tabela é clicado. A tabela responde "quem está onde"; daí a
   * pergunta seguinte é sempre a mesma — "e de onde vêm os votos dele?" —, e quem sabe responder
   * é a folha das cidades. A tabela fecha e cede o lugar, em vez de empilhar duas por cima do
   * painel.
   */
  aoEscolher?: (c: Candidate) => void;
  /*
   * Como buscar o resto da lista.
   *
   * O snapshot traz só a cabeça de uma proporcional — são milhares de candidaturas, e mandar
   * todas em cada quadro custaria quatro vezes o peso do que a tela desenha. A tabela é o único
   * lugar que quer a lista inteira, então é ela quem pede, uma vez, ao abrir.
   */
  completar?: () => Promise<Candidate[]>;
}

const fmtPct = fmtPercent;
const dobrar = fold;

/** A situação publicada pela fonte, lida pelo mesmo helper que as telas usam. */
const situacao = (c: Candidate): [string, string] => {
  const s = publishedStatus(c);
  if (!s) return ['', ''];
  return [s.key === 'elected' ? 'eleito' : s.key === 'runoff' ? 'turno' : '', s.label];
};

export function abrirTabela(o: TabelaOpcoes) {
  montarCss();
  document.querySelector('.tbl-fundo')?.remove();

  const fundo = document.createElement('div');
  fundo.className = 'tbl-fundo';
  fundo.innerHTML = `<div class="tbl-folha" role="dialog" aria-label="${esc(o.titulo)}">`
    + `<header><div><div class="t">${esc(o.titulo)}</div>`
    + `<div class="s">${esc(o.subtitulo)} · ${fmtInt(o.candidatos.length)} candidaturas</div></div>`
    + `<input placeholder="Buscar nome, número ou partido" aria-label="Buscar nesta disputa">`
    + `<button aria-label="Fechar">✕</button></header>`
    + `<div class="rolo"><table><colgroup><col style="width:9%"><col style="width:33%">`
    + `<col style="width:11%"><col style="width:12%"><col style="width:14%"><col style="width:10%">`
    + `<col style="width:11%"></colgroup>`
    + `<thead><tr><th>#</th><th>Candidatura</th><th>Número</th><th>Partido</th>`
    + `<th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr></thead>`
    + `<tbody></tbody></table></div>`
    + `<div class="pe">A ordem de votação não define as vagas proporcionais; a situação é a publicada pelo TSE.</div>`
    + `</div>`;

  const folha = fundo.querySelector('.tbl-folha')!;
  const busca = folha.querySelector('input')!;
  const corpo = folha.querySelector('tbody')!;
  let ordem = [...o.candidatos].sort((a, b) => b.votes - a.votes);

  const desenhar = () => {
    const q = dobrar(busca.value.trim());
    const achados = ordem
      .map((c, i) => ({ c, pos: i + 1 }))
      .filter(({ c }) => !q || dobrar(`${c.name} ${c.number} ${c.party}`).includes(q) || c.id === o.destaque);
    /*
     * Quatrocentas linhas por vez. Uma disputa proporcional tem milhares de candidaturas, e
     * montar todas elas trava a tela por segundos — a busca alcança as demais, que é para o que
     * ela existe.
     */
    const linhas = achados.length > 400
      ? [...achados.slice(0, 400), ...achados.filter((x, i) => i >= 400 && x.c.id === o.destaque)]
      : achados;
    corpo.innerHTML = linhas.length
      ? linhas.map(({ c, pos }) => {
          const [cls, rotulo] = situacao(c);
          return `<tr class="${c.id === o.destaque ? 'hl' : ''}${o.corte && pos === o.corte && !q ? ' corte' : ''}">`
            + `<td class="n">${pos}º</td>`
            + `<td><span class="cor" style="background:${esc(c.color || '#8a94a6')}"></span>`
            + `${o.aoEscolher ? `<button class="nome" data-id="${esc(c.id)}">${esc(c.name)}</button>` : esc(c.name)}</td>`
            + `<td>${esc(c.number ?? '')}</td><td>${esc(c.party)}</td>`
            + `<td class="r">${fmtInt(c.votes)}</td><td class="r">${fmtPct(c.percent)}</td>`
            + `<td class="st ${cls}">${esc(rotulo)}</td></tr>`;
        }).join('')
      : `<tr><td colspan="7" class="n">Nenhuma candidatura encontrada para “${esc(busca.value)}”.</td></tr>`;
    if (achados.length > linhas.length) {
      corpo.insertAdjacentHTML('beforeend',
        `<tr><td colspan="7" class="n">Mostrando 400 de ${fmtInt(achados.length)} candidaturas. Use a busca para encontrar as demais.</td></tr>`);
    }
    corpo.querySelector('tr.hl')?.scrollIntoView({ block: 'center' });
  };

  const fechar = () => { fundo.remove(); removeEventListener('keydown', naTecla); };
  const naTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
  addEventListener('keydown', naTecla);
  folha.querySelector('button')!.addEventListener('click', fechar);
  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });
  busca.addEventListener('input', desenhar);
  if (o.aoEscolher) corpo.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.nome') as HTMLElement | null;
    if (!b) return;
    const c = o.candidatos.find(x => x.id === b.dataset.id);
    if (!c) return;
    fechar();
    o.aoEscolher!(c);
  });

  document.body.appendChild(fundo);
  desenhar();
  // com destaque o leitor veio de um nome: a folha abre parada nele, e a busca esperaria digitação
  if (!o.destaque) busca.focus();

  void o.completar?.().then(todas => {
    if (!todas.length || !fundo.isConnected) return;
    ordem = [...todas].sort((a, b) => b.votes - a.votes);
    folha.querySelector('.s')!.textContent = `${o.subtitulo} · ${fmtInt(ordem.length)} candidaturas`;
    desenhar();
  }).catch(() => { /* fica a cabeça da lista, que é o que o painel já tinha */ });
}

/**
 * As cidades de uma candidatura.
 *
 * É a outra metade da pergunta: a tabela diz com quantos votos ele está, esta diz de onde eles
 * vieram. Os dados são os mesmos que pintam o mapa do Território — votos por município publicados
 * pelo TSE —, e por isso ela carrega aos poucos: o arquivo municipal chega cidade a cidade
 * durante a apuração, e a folha se redesenha conforme ele completa.
 */
export interface CandidatoOpcoes {
  titulo: string;
  /** Nome, partido e número, para o cabeçalho. */
  nome: string;
  subtitulo: string;
  /** O número da candidatura, que é como o arquivo municipal a identifica. */
  numero: string;
  cor: string;
  mode: string; uf: string; turn: number | string;
  office: string;
}

export function abrirCandidato(o: CandidatoOpcoes) {
  montarCss();
  document.querySelector('.tbl-fundo')?.remove();

  const fundo = document.createElement('div');
  fundo.className = 'tbl-fundo';
  fundo.innerHTML = `<div class="tbl-folha" role="dialog" aria-label="${esc(o.nome)}">`
    + `<header><div><div class="t"><i class="pt" style="background:${esc(o.cor)}"></i>${esc(o.nome)}</div>`
    + `<div class="s">${esc(o.titulo)} · ${esc(o.subtitulo)}</div></div>`
    + `<input placeholder="Buscar cidade" aria-label="Buscar cidade">`
    + `<button aria-label="Fechar">✕</button></header>`
    + `<div class="estado"></div>`
    + `<div class="rolo"><table><colgroup><col style="width:9%"><col style="width:45%">`
    + `<col style="width:16%"><col style="width:15%"><col style="width:15%"></colgroup>`
    + `<thead><tr><th>#</th><th>Cidade</th><th class="r">Votos</th><th class="r">% válidos</th>`
    + `<th class="r">Posição na cidade</th></tr></thead><tbody></tbody></table><div class="mais"></div></div>`
    + `<div class="pe">Votos por município publicados pelo TSE.</div></div>`;

  const folha = fundo.querySelector('.tbl-folha')!;
  const busca = folha.querySelector('input')!;
  const corpo = folha.querySelector('tbody')!;
  const estado = folha.querySelector('.estado') as HTMLElement;
  const mais = folha.querySelector('.mais') as HTMLElement;

  type Linha = { nome: string; uf: string; busca: string; votos: number; validos: number; pos: number };
  let linhas: Linha[] = [], quantas = 200, relogio = 0, fechada = false, parcial = '';

  const desenhar = () => {
    const q = dobrar(busca.value.trim());
    const lista = linhas.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.busca.includes(q));
    corpo.innerHTML = lista.slice(0, quantas).map(({ r, i }) =>
      `<tr><td class="n">${i + 1}º</td><td>${esc(r.nome)} <span class="n">(${esc(r.uf)})</span></td>`
      + `<td class="r">${fmtInt(r.votos)}</td>`
      + `<td class="r">${r.validos ? fmtPct(r.votos / r.validos * 100, 1) : '—'}</td>`
      + `<td class="r"><span class="pos" style="--c:${esc(o.cor)}">${r.pos}º</span></td></tr>`).join('')
      || (linhas.length ? `<tr><td colspan="5" class="n">Nenhuma cidade encontrada.</td></tr>` : '');
    const rolagem = lista.length > quantas ? `Mostrando ${fmtInt(quantas)} de ${fmtInt(lista.length)} cidades · role para ver mais` : '';
    mais.textContent = [rolagem, parcial].filter(Boolean).join(' · ');
  };

  const carregar = async () => {
    if (fechada) return;
    type Municipal = {
      status: string; message?: string; loaded?: number; total?: number;
      /** [nome, uf, votos, válidos na cidade, colocação] — já filtrado e ordenado pelo servidor. */
      linhas: [string, string, number, number, number][];
    };
    let d: Municipal | null = null;
    try {
      /*
       * `numero` faz o servidor mandar só as cidades desta candidatura.
       *
       * Antes vinha o mapa inteiro — toda cidade com todos os candidatos — e o navegador varria
       * milhares de pares para ficar com um nome: 109 KB no governador de Minas e 748 KB na
       * presidência, quase tudo descartado. Pela rede de casa era o intervalo entre clicar e ver.
       */
      const r = await fetch(`/api/municipal?mode=${o.mode}&uf=${o.uf}&turn=${o.turn}&office=${o.office}&numero=${encodeURIComponent(o.numero)}`, { cache: 'no-store' });
      d = r.ok ? await r.json() as Municipal : null;
    } catch { d = null; }
    if (fechada) return;
    if (!d) { estado.textContent = 'Não foi possível carregar os municípios agora. Tentando de novo…'; relogio = window.setTimeout(carregar, 3000); return; }
    linhas = (d.linhas || []).map(([nome, uf, votos, validos, pos]) => {
      const cidade = titulo(nome);
      return { nome: cidade, uf, busca: dobrar(cidade), votos, validos, pos };
    });
    const pronto = d.status === 'ready';
    /*
     * Com cidades na mão, a folha mostra as cidades — não um aviso de carregamento.
     *
     * O aviso ocupava o lugar da lista mesmo quando ela já estava inteira, e era o que dava a
     * impressão de que nada tinha chegado. Ele volta a aparecer só quando não há uma linha sequer
     * para mostrar. Se ainda faltam cidades mas já há o que ver, isso é dito no rodapé, junto da
     * contagem — a lista não pode passar por completa quando não está.
     */
    estado.textContent = pronto || linhas.length ? ''
      : d.total ? `Carregando municípios · ${fmtInt(d.loaded ?? 0)} de ${fmtInt(d.total)}`
      : (d.message || 'Carregando municípios…');
    parcial = !pronto && d.total ? `${fmtInt(d.loaded ?? 0)} de ${fmtInt(d.total)} cidades recebidas` : '';
    desenhar();
    if (!pronto) relogio = window.setTimeout(carregar, 2500);
  };

  const fechar = () => { fechada = true; clearTimeout(relogio); fundo.remove(); removeEventListener('keydown', naTecla); };
  const naTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
  addEventListener('keydown', naTecla);
  folha.querySelector('button')!.addEventListener('click', fechar);
  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });
  busca.addEventListener('input', () => { quantas = 200; desenhar(); });
  folha.querySelector('.rolo')!.addEventListener('scroll', e => {
    const t = e.target as HTMLElement;
    if (t.scrollTop + t.clientHeight > t.scrollHeight - 300 && mais.textContent) { quantas += 200; desenhar(); }
  });

  document.body.appendChild(fundo);
  estado.textContent = 'Carregando municípios…';
  void carregar();
}

const titulo = titleCase;

let montado = false;
function montarCss() {
  if (montado) return;
  montado = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
  /*
   * A folha é a TV vista de perto, não um cartão de outro aplicativo.
   *
   * A primeira versão tinha o kit de sempre: caixa arredondada, sombra funda, borda em volta de
   * tudo, cinza-azulado. Aqui vale a mesma regra do painel — fundo quase preto esverdeado, ouro
   * como único acento, título condensado em caixa alta, número em Barlow, e fio no lugar de
   * moldura. Ao abrir, o painel continua visível atrás, mais escuro: a tabela é uma camada da
   * mesma tela, não outra tela.
   */
  .tbl-fundo { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center;
    padding: 3vh 2.2vw; background: rgba(10,12,11,.82);
    font-family: 'DM Sans Variable', system-ui, sans-serif; color: #f6f3ec; }
  .tbl-folha { width: min(1500px, 95vw); height: min(86vh, 980px);
    display: flex; flex-direction: column; background: #0a0c0b;
    border: 1px solid #1c211f; box-shadow: 0 30px 90px rgba(0,0,0,.6); overflow: hidden; }

  .tbl-folha header { display: flex; align-items: center; gap: 1.6vw;
    padding: 2vh 2.2vw 1.6vh; border-bottom: 1px solid #1c211f; }
  .tbl-folha .t { font-family: 'Barlow Condensed', sans-serif; font-weight: 600;
    font-size: clamp(20px, 2vw, 40px); line-height: 1; letter-spacing: .08em;
    text-transform: uppercase; color: #f6f3ec; }
  .tbl-folha .s { margin-top: .5vh; font-size: clamp(11px, .88vw, 18px); color: #6a6863; }
  .tbl-folha .s b { color: #b9b6ae; font-weight: 600; }

  .tbl-folha input { margin-left: auto; width: min(340px, 30vw); padding: .9vh 1vw;
    background: none; border: 0; border-bottom: 1px solid #262c2a; color: #f6f3ec;
    font: inherit; font-size: clamp(11px, .85vw, 17px); outline: none; }
  .tbl-folha input::placeholder { color: #4f544f; }
  .tbl-folha input:focus { border-bottom-color: #e8c877; }
  .tbl-folha header button { all: unset; cursor: pointer; width: 34px; height: 34px;
    display: grid; place-items: center; color: #6a6863; font-size: 18px; }
  .tbl-folha header button:hover { color: #f6f3ec; }

  .tbl-folha .rolo { flex: 1; min-height: 0; overflow: auto; }
  .tbl-folha table { width: 100%; table-layout: fixed; border-collapse: collapse;
    font-size: clamp(11px, .95vw, 19px); }
  .tbl-folha th { position: sticky; top: 0; z-index: 1; background: #0a0c0b; text-align: left;
    padding: 1.2vh 1.1vw; font-weight: 500; font-size: clamp(9px, .66vw, 13px);
    letter-spacing: .14em; text-transform: uppercase; color: #4f544f;
    border-bottom: 1px solid #1c211f; }
  .tbl-folha td { padding: 1.1vh 1.1vw; border-bottom: 1px solid #141817; color: #e8e4dc;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* números em Barlow e alinhados à direita, como no painel */
  .tbl-folha td.r, .tbl-folha th.r { text-align: right; }
  .tbl-folha td.r { font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 1.12em; font-variant-numeric: tabular-nums; }
  .tbl-folha td.n { color: #4f544f; font-variant-numeric: tabular-nums; }
  .tbl-folha tbody tr:hover td { background: #101413; }
  .tbl-folha tr.hl td { background: rgba(232,200,119,.1); }
  /* a linha que fecha as vagas, como no painel: o que está acima dela está dentro */
  .tbl-folha tr.corte td { border-bottom: 1px dashed rgba(232,200,119,.4); }
  .tbl-folha .cor { display: inline-block; width: 4px; height: 1em; margin-right: .7em;
    vertical-align: -.12em; }
  .tbl-folha .nome { all: unset; cursor: pointer; }
  .tbl-folha .nome:hover, .tbl-folha .nome:focus-visible { text-decoration: underline;
    text-underline-offset: .22em; text-decoration-color: rgba(232,200,119,.7); }
  .tbl-folha .st { font-size: clamp(9px, .68vw, 13px); letter-spacing: .1em;
    text-transform: uppercase; color: #6a6863; }
  .tbl-folha .st.eleito { color: #6fcf97; }
  .tbl-folha .st.turno { color: #7fb6de; }
  .tbl-folha .t .pt { display: inline-block; width: .28em; height: .8em; margin-right: .45em;
    vertical-align: -.02em; }
  .tbl-folha .estado:not(:empty) { padding: 1.2vh 2.2vw; font-size: clamp(10px, .78vw, 15px);
    color: #6a6863; border-bottom: 1px solid #141817; }
  .tbl-folha .pos { color: #b9b6ae; }
  .tbl-folha .mais:not(:empty), .tbl-folha .pe { padding: 1.4vh 2.2vw;
    font-size: clamp(9px, .72vw, 14px); color: #4f544f; }
  .tbl-folha .pe { border-top: 1px solid #1c211f; }
`;
