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
  /* `o` é reatribuído por `atualizar`: a folha troca de conteúdo sem ser remontada. */
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
  let primeira = true;

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
    // Centralizar o destaque só na primeira pintura: repetir isso a cada atualização jogaria a
    // rolagem de volta enquanto a pessoa está lendo outra parte da lista.
    if (primeira) { corpo.querySelector('tr.hl')?.scrollIntoView({ block: 'center' }); primeira = false; }
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

  /*
   * A folha acompanha a apuração enquanto está aberta.
   *
   * Aberta durante a reprodução ela ficava no retrato de quando foi aberta: votos de um instante
   * sobre um painel que já estava em outro. A busca digitada e a rolagem ficam onde estão — só os
   * números e o cabeçalho trocam.
   */
  const atualizar = (novo: TabelaOpcoes) => {
    if (!fundo.isConnected) return;
    o = novo;
    ordem = [...novo.candidatos].sort((a, b) => b.votes - a.votes);
    folha.querySelector('.s')!.textContent = `${novo.subtitulo} · ${fmtInt(ordem.length)} candidaturas`;
    desenhar();
  };

  void o.completar?.().then(todas => {
    if (!todas.length || !fundo.isConnected) return;
    ordem = [...todas].sort((a, b) => b.votes - a.votes);
    folha.querySelector('.s')!.textContent = `${o.subtitulo} · ${fmtInt(ordem.length)} candidaturas`;
    desenhar();
  }).catch(() => { /* fica a cabeça da lista, que é o que o painel já tinha */ });

  /** Quem abriu mantém isto para repintar enquanto a apuração anda. */
  return { atualizar, aberta: () => fundo.isConnected };
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
  /**
   * Quantos votos a candidatura tem na disputa inteira.
   *
   * Serve para a folha conferir a própria soma e dizer quanto dela já foi localizado. Sem isso,
   * uma lista com doze cidades de cem votos parecia o total de quem tem cem mil, e a conta não
   * fechava para quem estava olhando — sem nenhum aviso de que faltavam cidades.
   */
  votos: number;
  cor: string;
  mode: string; uf: string; turn: number | string;
  office: string;
  /**
   * O instante que a tela está reproduzindo, ou nulo no ao vivo.
   *
   * Esta folha não fala com `dados.ts` de propósito — recebe modo, estado e turno por opção —, e o
   * instante segue a mesma regra. Quem monta a folha sabe se o painel está no agora.
   */
  momento?: () => number | null;
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
    + `<div class="soma"></div>`
    + `<div class="rolo"><table><colgroup><col style="width:9%"><col style="width:45%">`
    + `<col style="width:16%"><col style="width:15%"><col style="width:15%"></colgroup>`
    + `<thead><tr><th>#</th><th>Cidade</th><th class="r">Votos</th><th class="r">% válidos</th>`
    + `<th class="r">Posição na cidade</th></tr></thead><tbody></tbody></table></div>`
    // A conferência é rodapé fixo, não fim de lista: dentro da rolagem ela ia embora na primeira
    // rolada, e é justamente a linha que diz se a lista fecha com o total da candidatura.
    + `<div class="mais"></div>`
    + `</div>`;

  const folha = fundo.querySelector('.tbl-folha')!;
  const busca = folha.querySelector('input')!;
  const corpo = folha.querySelector('tbody')!;
  const estado = folha.querySelector('.estado') as HTMLElement;
  const soma = folha.querySelector('.soma') as HTMLElement;
  const mais = folha.querySelector('.mais') as HTMLElement;

  type Linha = { nome: string; uf: string; busca: string; votos: number; validos: number; pos: number };
  let linhas: Linha[] = [], quantas = 200, relogio = 0, fechada = false, vazio = '', conferencia = '';

  const desenhar = () => {
    const q = dobrar(busca.value.trim());
    const lista = linhas.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.busca.includes(q));
    corpo.innerHTML = lista.slice(0, quantas).map(({ r, i }) =>
      `<tr><td class="n">${i + 1}º</td><td>${esc(r.nome)} <span class="n">(${esc(r.uf)})</span></td>`
      + `<td class="r">${fmtInt(r.votos)}</td>`
      + `<td class="r">${r.validos && r.votos ? fmtPct(r.votos / r.validos * 100, 1) : '—'}</td>`
      + `<td class="r">${r.pos ? `<span class="pos" style="--c:${esc(o.cor)}">${r.pos}º</span>` : '<span class="n">—</span>'}</td></tr>`).join('')
      || (linhas.length ? `<tr><td colspan="5" class="n">Nenhuma cidade encontrada.</td></tr>` : '');
    /*
     * Uma frase, não três coladas por pontos.
     *
     * Dava "0 de 4.009 votos localizados · 0 de 853 cidades já publicadas pelo TSE" — dois zeros e
     * três números para dizer uma coisa só: ainda não tem nada. Sem cidade nenhuma, é isso que a
     * linha fala, e ponto.
     */
    const rolagem = lista.length > quantas ? `Mostrando ${fmtInt(quantas)} de ${fmtInt(lista.length)} cidades` : '';
    mais.textContent = !linhas.length ? vazio
      : [rolagem, conferencia].filter(Boolean).join(' · ');
  };

  const carregar = async () => {
    if (fechada) return;
    type Municipal = {
      status: string; message?: string; loaded?: number; total?: number; cidadesComResultado?: number;
      totais?: { cidades: number; nominais: number; brancos: number; nulos: number; total: number; secoes: number; secoesTotais: number };
      /** [nome, uf, votos, válidos na cidade, colocação] — já filtrado e ordenado pelo servidor. */
      linhas: [string, string, number, number, number][];
    };
    let d: Municipal | null = null;
    /*
     * `at` é o instante que a tela está reproduzindo. O servidor guarda as mudanças por cidade com
     * a hora, então a folha mostra as cidades como estavam ali — e não o retrato de agora, que no
     * minuto zero devolvia a apuração inteira ao lado de um painel em 0,0%.
     */
    const at = o.momento?.();
    try {
      /*
       * `numero` faz o servidor mandar só as cidades desta candidatura.
       *
       * Antes vinha o mapa inteiro — toda cidade com todos os candidatos — e o navegador varria
       * milhares de pares para ficar com um nome: 109 KB no governador de Minas e 748 KB na
       * presidência, quase tudo descartado. Pela rede de casa era o intervalo entre clicar e ver.
       */
      const r = await fetch(`/api/municipal?mode=${o.mode}&uf=${o.uf}&turn=${o.turn}&office=${o.office}&numero=${encodeURIComponent(o.numero)}${at == null ? '' : `&at=${Math.round(at)}`}`, { cache: 'no-store' });
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
    // Reproduzindo um instante em que nada tinha sido publicado, a tabela em branco precisa dizer
    // por que está em branco — senão parece falha de carregamento.
    estado.textContent = at != null && !linhas.length ? 'Nenhuma cidade tinha publicado resultado neste instante da apuração.'
      : pronto || linhas.length ? ''
      : d.total ? `Carregando municípios · ${fmtInt(d.loaded ?? 0)} de ${fmtInt(d.total)}`
      : (d.message || 'Carregando municípios…');
    /*
     * O que interessa é quantas cidades já têm resultado, não quantas foram buscadas.
     *
     * A varredura chegava a "853 de 853 cidades recebidas" com só 16 delas publicadas pelo TSE, e
     * a folha passava por completa mostrando 5% dos votos da candidatura.
     */
    const comResultado = d.cidadesComResultado ?? 0;
    vazio = comResultado ? 'Esta candidatura ainda não teve voto em nenhuma cidade publicada.'
      : `Nenhuma das ${fmtInt(d.total ?? 0)} cidades publicou resultado ainda.`;

    /*
     * A folha confere a própria soma contra o total da candidatura.
     *
     * Doze cidades de cem votos para quem tem cem mil não é uma lista curta: é uma lista
     * incompleta, e sem dizer isso a conta simplesmente não fechava para quem estava olhando.
     * Quando bate, a frase confirma que está tudo ali; quando não bate, diz quanto falta.
     */
    /*
     * A soma das cidades, para conferir o total da disputa por outro caminho.
     *
     * Todo número aqui é campo publicado pelo TSE em cada arquivo municipal — nominais, brancos,
     * nulos, total e seções —, somado cidade a cidade. Nenhum é derivado. Se o painel diz um
     * percentual apurado e as seções somadas dizem outro, a diferença fica visível em vez de
     * suposta.
     */
    const t = d.totais;
    soma.innerHTML = !t || !t.secoesTotais ? '' :
      `<div class="soma-t">Somando ${fmtInt(t.cidades)} de ${fmtInt(d.cidadesComResultado ?? 0)} cidades publicadas</div>`
      + `<dl>`
      + `<div><dt>Votos nominais</dt><dd>${fmtInt(t.nominais)}</dd></div>`
      + `<div><dt>Brancos</dt><dd>${fmtInt(t.brancos)}</dd></div>`
      + `<div><dt>Nulos</dt><dd>${fmtInt(t.nulos)}</dd></div>`
      + `<div><dt>Total de votos</dt><dd>${fmtInt(t.total)}</dd></div>`
      + `<div><dt>Seções totalizadas</dt><dd>${fmtInt(t.secoes)} de ${fmtInt(t.secoesTotais)}</dd></div>`
      + `<div class="ap"><dt>Apurado pelas cidades</dt><dd>${fmtPct(t.secoes / t.secoesTotais * 100, 2)}</dd></div>`
      + `</dl>`;

    const somado = linhas.reduce((t, r) => t + r.votos, 0);
    conferencia = !o.votos ? `${fmtInt(somado)} votos em ${fmtInt(linhas.length)} cidades`
      : somado >= o.votos ? `Os ${fmtInt(somado)} votos da candidatura estão todos nesta lista`
      : `${fmtInt(somado)} dos ${fmtInt(o.votos)} votos da candidatura · o resto está em cidades que ainda não publicaram`;
    desenhar();
    // Reproduzindo, o instante não anda sozinho: quem repede é o transporte.
    if (!pronto && at == null) relogio = window.setTimeout(carregar, 2500);
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

  /*
   * Quem abriu repete a busca a cada volta do painel.
   *
   * Reproduzindo, o instante não anda sozinho — o laço interno de repetição só existe para o ao
   * vivo. Sem isto a folha ficava nas cidades de quando foi aberta enquanto a gravação corria.
   */
  return {
    /** `novo` traz o cabeçalho do instante no ar: os votos da candidatura também andam. */
    recarregar: (novo?: { subtitulo: string; votos: number }) => {
      if (fechada) return;
      if (novo) {
        o.subtitulo = novo.subtitulo;
        o.votos = novo.votos;
        folha.querySelector('.s')!.textContent = `${o.titulo} · ${o.subtitulo}`;
      }
      void carregar();
    },
    aberta: () => fundo.isConnected,
  };
}

const titulo = titleCase;

let montado = false;
export function montarCss() {
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
  /* A conferencia da apuracao pelas cidades: campos do TSE somados, nenhum derivado. */
  .tbl-folha .soma:not(:empty) { padding: 1.4vh 2.2vw; border-bottom: 1px solid #1c211f; }
  .tbl-folha .soma-t { font-size: clamp(9px, .7vw, 13px); letter-spacing: .08em;
    text-transform: uppercase; color: #565954; margin-bottom: 1vh; }
  .tbl-folha .soma dl { display: flex; flex-wrap: wrap; gap: .8vh 2.2vw; margin: 0; }
  .tbl-folha .soma dl > div { display: flex; flex-direction: column; gap: .25vh; }
  .tbl-folha .soma dt { font-size: clamp(9px, .7vw, 13px); color: #6a6863; }
  .tbl-folha .soma dd { margin: 0; font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: clamp(13px, 1.05vw, 21px); color: #e8e4dc; font-variant-numeric: tabular-nums; }
  .tbl-folha .soma .ap dd { color: #e8c877; }

  .tbl-folha .estado:not(:empty) { padding: 1.2vh 2.2vw; font-size: clamp(10px, .78vw, 15px);
    color: #6a6863; border-bottom: 1px solid #141817; }
  .tbl-folha .pos { color: #b9b6ae; }
  .tbl-folha .mais, .tbl-folha .pe { padding: 1.4vh 2.2vw; border-top: 1px solid #201f1d;
    min-height: 1.2em;
    font-size: clamp(9px, .72vw, 14px); color: #4f544f; }
  .tbl-folha .pe { border-top: 1px solid #1c211f; }
`;
