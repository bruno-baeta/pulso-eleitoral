/**
 * Shared shell for the three views of the app (TV, Corrida, Território):
 * a slim header with the app name and the only two controls worth keeping in sight — the view
 * dropdown and the year — with state and round tucked into a menu. The footnote at the bottom
 * carries the count and its source. Selection lives in the URL (+ localStorage) through
 * src/shell/dados.ts.
 */
import { STATES, type Turn } from '../../shared/types';
import { SIMULADO_WINDOWS, describeWindow, nextWindow, openWindow } from '../../shared/windows';
import { fmtShortTime } from '../domain/format';
import { MODE, TURN, UF, esc, navigate, type Mode } from './dados';

export type LensKey = 'corrida' | 'territorio' | 'tv';
export const LENSES: { key: LensKey; label: string; path: string }[] = [
  /*
   * A TV é a primeira, e mora na raiz.
   *
   * A Visão geral respondia "como está cada disputa" com um cartão por cargo; a TV responde a
   * mesma coisa com as cinco na tela ao mesmo tempo, com fio, replay e tela cheia. Duas telas para
   * a mesma pergunta é uma a mais, então a Visão geral saiu e a TV tomou o lugar dela na porta de
   * entrada — quem chega ao Pulso cai na tela que dá a noite inteira de uma vez.
   */
  { key: 'tv', label: 'TV', path: '/' },
  { key: 'corrida', label: 'Corrida', path: '/corrida.html' },
  { key: 'territorio', label: 'Território', path: '/territorio.html' },
];

/** Link to another view keeping source, state and round. */
export function lensHref(key: LensKey): string {
  const lens = LENSES.find(l => l.key === key)!;
  return `${lens.path}?mode=${MODE}&uf=${UF}&turn=${TURN}`;
}

/** Inside a window the simulation is collected live; outside it the recorded session is replayed. */
export function simuladoAvailability(now = Date.now()): { hint: string; recorded: boolean } {
  if (openWindow(SIMULADO_WINDOWS, now)) return { hint: 'Janela de testes do TSE aberta agora.', recorded: false };
  const next = nextWindow(SIMULADO_WINDOWS, now);
  return { recorded: true, hint: `Fora da janela: replay da última sessão gravada, sem consultar o TSE.${next ? ` Próxima janela: ${describeWindow(next)}.` : ''}` };
}

/**
 * As apurações que existem — e só elas.
 *
 * A lista era o cruzamento de três fontes por dois turnos, e metade do resultado não existia:
 * "2022 · Segundo Turno" para uma disputa estadual que não teve segundo turno, "Simulação ·
 * Segundo Turno" para um ensaio que o TSE só publica no primeiro. Escolher uma delas abria uma
 * tela vazia sem explicação. Aqui cada linha é uma apuração real: os dois turnos de 2026, o
 * primeiro de 2022 e o simulado, que não tem turno para escolher.
 */
const FONTES = (): { mode: Mode; turn: Turn; label: string; hint?: string }[] => [
  { mode: 'official', turn: 1, label: '2026 · 1º turno' },
  { mode: 'official', turn: 2, label: '2026 · 2º turno' },
  { mode: 'historico', turn: 1, label: '2022 · 1º turno' },
  { mode: 'simulado', turn: 1, label: '2026 · Simulação', ...simuladoAvailability() },
];

const chevron = '<svg class="chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const field = (label: string, key: string, options: string) =>
  `<label class="sh-field"><span>${label}</span><span class="sh-select"><select data-k="${key}" aria-label="${label}">${options}</select>${chevron}</span></label>`;

/** What the header keeps in sight: the view on screen, the year and the state. */
function headFieldsHtml(active: LensKey): string {
  const years = FONTES().map(o => {
    const on = o.mode === MODE && o.turn === TURN;
    return `<option value="${o.mode}|${o.turn}" ${on ? 'selected' : ''} title="${esc(o.hint ?? '')}">${o.label}</option>`;
  }).join('');
  return field('Visão', 'lens', LENSES.map(l => `<option value="${l.key}" ${l.key === active ? 'selected' : ''}>${l.label}</option>`).join(''))
    + field('Ano', 'year', years)
    + field('Estado', 'uf', STATES.map(s => `<option value="${s.uf}" ${s.uf === UF ? 'selected' : ''}>${esc(s.name)}</option>`).join(''));
}

export function wireSelectors(root: ParentNode) {
  root.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach(sel => {
    // reaching for the Visão list is the earliest honest signal that another view is coming
    if (sel.dataset.k === 'lens') sel.addEventListener('pointerdown', () => primeNextViews(activeLens), { once: true });
    sel.addEventListener('focus', () => { if (sel.dataset.k === 'lens') primeNextViews(activeLens); }, { once: true });
    sel.addEventListener('change', () => {
      const k = sel.dataset.k;
      if (k === 'lens') { location.href = lensHref(sel.value as LensKey); return; }
      if (k === 'year') {
        const [mode, turn] = sel.value.split('|');
        navigate({ mode: mode as Mode, turn: turn === '2' ? 2 : 1 });
        return;
      }
      navigate({ uf: sel.value });
    });
  });
  // The simulation window opens and closes while the page is open.
  const sim = [...root.querySelectorAll<HTMLOptionElement>('select[data-k="year"] option')].filter(o => o.value.startsWith('simulado|'));
  if (sim.length) setInterval(() => {
    const a = simuladoAvailability();
    for (const opt of sim) { opt.disabled = false; opt.title = a.hint; }
  }, 30_000);
}

/* ─────────────────────────── footnote, shared by every view ─────────────────────────── */

let noteEl: HTMLElement | null = null;
function shellNote(): HTMLElement {
  mountShellCss();
  if (!noteEl) {
    noteEl = document.createElement('div');
    noteEl.className = 'sh-note';
    noteEl.innerHTML = '<span class="sh-upd"></span><span>Fonte: TSE</span>';
    (document.querySelector('.pl') ?? document.body).appendChild(noteEl);
  }
  return noteEl;
}

/** When the count on screen was read. `at` is an ISO string or ms; null until something loads. */
export function mountShellNote(): (at: number | string | null) => void {
  const upd = shellNote().querySelector<HTMLElement>('.sh-upd')!;
  return at => { upd.textContent = at ? `Atualizado às ${fmtShortTime(at)}` : ''; };
}

/* ──────────────────────────────────── chrome ──────────────────────────────────── */

const CSS = `
  /* The opt-in itself lives in each page's HTML, where the browser reads it in time. */
  /* The transition animations live in each page's HTML, beside the opt-in, because the browser
     needs them at the new document's first paint — see the comment there. */
  /* The fade-in itself is declared in each page's HTML, where it applies from the first paint. */
  .sh-head { position: fixed; top: 0; left: 0; right: 0; z-index: 60; box-sizing: border-box; display: flex; flex-direction: column; background: rgba(13,15,14,.94); border-bottom: 1px solid #232624; backdrop-filter: blur(10px); font-family: 'DM Sans Variable', system-ui, sans-serif; }
  .sh-row { box-sizing: border-box; display: flex; align-items: center; gap: calc(16px * var(--sk)); padding: 0 calc(36px * var(--sk)); }
  .sh-main { height: max(calc(96px * var(--sk)), 68px); padding-left: max(calc(56px * var(--sk)), 24px); }
  .sh-brand { font-family: 'Barlow Condensed', 'DM Sans Variable', sans-serif; font-weight: 700; font-size: calc(30px * var(--sk)); line-height: 1; letter-spacing: .16em; text-transform: uppercase; color: #f6f3ec; text-decoration: none; white-space: nowrap; }
  .sh-brand:hover { color: #fff; }
  .sh-sep { color: #3a3f3c; font-size: calc(26px * var(--sk)); font-weight: 300; line-height: 1; }
  .sh-view { font-family: 'Barlow Condensed', 'DM Sans Variable', sans-serif; font-weight: 600; font-size: calc(26px * var(--sk)); letter-spacing: .06em; color: #b9b6ae; white-space: nowrap; }
  .sh-right { margin-left: auto; display: flex; align-items: center; gap: calc(14px * var(--sk)); }
  .sh-field { display: flex; align-items: center; gap: calc(9px * var(--sk)); }
  .sh-field > span:first-child { font-size: calc(14px * var(--sk)); font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #6f6d68; white-space: nowrap; }
  .sh-select { position: relative; box-sizing: border-box; height: calc(42px * var(--sk)); display: inline-flex; align-items: center; border-radius: 999px; background: rgba(23,26,25,.92); border: 1px solid #2b2f2d; }
  .sh-select select { all: unset; box-sizing: border-box; height: 100%; min-width: calc(150px * var(--sk));
    padding: 0 calc(36px * var(--sk)) 0 calc(16px * var(--sk)); cursor: pointer; color: #e6e3dc;
    text-align: left; text-align-last: left;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(24px * var(--sk));
    letter-spacing: .04em; line-height: calc(40px * var(--sk)); }
  .sh-select select { border-radius: 999px; }
  .sh-select select option { background: #171a19; color: #dfdcd4; padding: calc(8px * var(--sk)) calc(12px * var(--sk)); }
  .sh-select select option:checked { background: #2f3431; color: #fff; }
  /* Chrome's customisable select: a proper card with rounded corners and a real hover. */
  @supports (appearance: base-select) {
    .sh-select select, .sh-select select::picker(select) { appearance: base-select; }
    .sh-select select { border: 0; background: none; padding-right: calc(40px * var(--sk)); }
    .sh-select select::picker-icon { display: none; }
    .sh-select select::picker(select) {
      margin-top: calc(8px * var(--sk)); padding: calc(6px * var(--sk)); border: 1px solid #313734;
      border-radius: calc(14px * var(--sk)); background: #141716; box-shadow: 0 24px 60px rgba(0,0,0,.65);
      max-height: 60vh; overflow-y: auto;
      /* The states list is long enough to scroll, and the browser's own bar lands on a dark card
         looking like a seam. This one is cut from the card's own palette. */
      scrollbar-width: thin; scrollbar-color: #39403c transparent;
    }

    .sh-select select option {
      display: flex; align-items: center; justify-content: flex-start; gap: calc(10px * var(--sk));
      padding: calc(9px * var(--sk)) calc(14px * var(--sk)); border-radius: calc(9px * var(--sk));
      background: none; color: #c9c6be; cursor: pointer; text-align: left;
      font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(22px * var(--sk));
      letter-spacing: .04em;
    }
    .sh-select select option::checkmark { display: none; }
    .sh-select select option:hover { background: #242927; color: #f2efe8; }
    .sh-select select option:checked { background: #2f3431; color: #fff; }
  }
  .sh-select .chev { position: absolute; right: calc(16px * var(--sk)); top: 50%; width: calc(13px * var(--sk)); height: calc(8px * var(--sk)); transform: translateY(-50%); color: #8e8c86; pointer-events: none; }
  .sh-select:hover { border-color: #414744; }
  .sh-select:focus-within { outline: none; border-color: #5c6360; background: rgba(32,36,34,.96); }
  .sh-brand:focus-visible { outline: 2px solid #e8c877; outline-offset: 2px; }

  /* Um campo de busca para todas as telas. Cada uma tem os seus resultados e o seu comportamento;
     a caixa é a mesma, para o cabeçalho ler igual em qualquer lugar. */
  .sh-head .search { position: relative; display: flex; align-items: center; box-sizing: border-box;
    width: calc(600px * var(--sk)); height: calc(46px * var(--sk)); margin: 0 auto; padding: 0 calc(13px * var(--sk));
    border-radius: 999px; background: rgba(18,21,19,.85); border: 1px solid #2a2e2b; }
  /* Centred on the header itself, not on whatever space the other controls leave over. */
  .sh-main > .search { position: absolute; left: 50%; transform: translateX(-50%); margin: 0; }
  .sh-head .search:focus-within { border-color: #6a705f; background: rgba(24,27,24,.96); }
  .sh-head .search svg { position: static; inset: auto; transform: none; margin: 0;
    width: calc(20px * var(--sk)); height: calc(20px * var(--sk)); flex-shrink: 0;
    color: #8b8882; stroke: currentColor; fill: none; stroke-width: 2; }
  .sh-head .search input { all: unset; flex: 1; min-width: 0; height: 100%; padding: 0 calc(12px * var(--sk));
    color: #f3f0e9; font-size: calc(21px * var(--sk)); }
  .sh-head .search input::placeholder { color: #6f6c66; }
  .sh-note { flex-shrink: 0; display: flex; align-items: center; gap: calc(9px * var(--sk)); font-size: max(calc(16px * var(--sk)), 12px); color: #6f6d68; white-space: nowrap; }
  .sh-note b { color: #b9b6ae; font-weight: 600; font-variant-numeric: tabular-nums; }
  .sh-note > span:empty { display: none; }
  .sh-note > span:not(:empty) ~ span::before { content: '· '; color: #45433f; }

  /*
   * Narrow: the row cannot hold the name, the three lists and a 600px search box, and a select
   * whose text wraps drags the whole header down over the view. So the row is allowed to wrap, the
   * search takes a line of its own, and every control is pinned to one line with an ellipsis.
   * The --sh-head variable is measured from the header's own height, so the views follow it.
   */
  /*
   * Below the sizes the layout was drawn for, the scale variables keep shrinking the chrome past
   * the point where it can be read — the field labels reach 7px at 1440 and the office chips 6,5px
   * at 1180. These floors lift the smallest text only under 1800px, so 1920 and 3440 stay exactly
   * as they were drawn. (At 1920 the labels are already 7,8px: that is the design, not a break.)
   */
  @media (max-width: 1800px) {
    .sh-field > span:first-child { font-size: max(calc(14px * var(--sk)), 11px); }
    .sh-view { font-size: max(calc(26px * var(--sk)), 15px); }
    .sh-sep { font-size: max(calc(26px * var(--sk)), 15px); }
    .sh-select select { font-size: max(calc(24px * var(--sk)), 14px); }
    .sh-head .search input { font-size: max(calc(21px * var(--sk)), 14px); }
    .sh-note { font-size: max(calc(16px * var(--sk)), 12px); }
  }

  .sh-menu { display: none; }

  @media (max-width: 900px) {
    .sh-head { --sk: .62; }
    /* the button lives on the first line, at the right end of it */
    .sh-menu { all: unset; display: grid; place-items: center; box-sizing: border-box; margin-left: auto;
      width: 40px; height: 40px; border-radius: 12px; border: 1px solid #2b2f2d; background: rgba(23,26,25,.92);
      color: #d8d5cd; cursor: pointer; flex: none; }
    .sh-menu svg { width: 18px; height: 13px; }
    .sh-menu[aria-expanded="true"] { background: #2f3431; border-color: #454b47; color: #fff; }
    /* the controls become a panel hanging from the header */
    .sh-right { position: absolute; top: 100%; right: 8px; left: 8px; z-index: 5;
      flex-direction: column; align-items: stretch; gap: 0; margin: 0; padding: 6px;
      border-radius: 14px; background: #141715; border: 1px solid #2b2f2d;
      box-shadow: 0 18px 40px rgba(0,0,0,.55);
      opacity: 0; transform: translateY(-6px); pointer-events: none; transition: opacity .16s ease, transform .16s ease; }
    :root.sh-menu-open .sh-right { opacity: 1; transform: none; pointer-events: auto; }
    .sh-right .sh-field { justify-content: space-between; gap: 12px; padding: 9px 8px; }
    .sh-right .sh-field + .sh-field { border-top: 1px solid #23261f; }
    /* inside the panel the labels are useful again, and the control can be thumb-sized */
    .sh-right .sh-field > span:first-child { display: block; font-size: 12px; }
    .sh-right .sh-select { height: 40px; }
    .sh-right .sh-select select { max-width: none; min-width: 148px; font-size: 16px; line-height: 38px; }
    .sh-row { gap: 8px; padding: 0 12px; }
    .sh-main { height: auto; min-height: 56px; padding: 8px 12px; flex-wrap: wrap; row-gap: 8px; }
    .sh-sep, .sh-view { font-size: 15px; }
    .sh-brand { font-size: 24px; letter-spacing: .1em; }
    .sh-right { gap: 8px; }
    .sh-select { height: 34px; flex: 0 1 auto; min-width: 0; }
    .sh-select select { min-width: 0; padding: 0 26px 0 12px; font-size: 14px; line-height: 32px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sh-select .chev { right: 10px; }
    .sh-note { display: none; }
    /* the search stops being centred on the header and becomes its second line */
    .sh-main > .search { position: static; transform: none; order: 10; flex: 1 0 100%; width: auto; height: 38px; margin: 0; }
    .sh-head .search input { font-size: 15px; padding: 0 10px; }
    .sh-head .search svg { width: 17px; height: 17px; }
  }
  /* Phone: the view's name is already in the Visão list, and the row needs the space. */
  @media (max-width: 560px) {
    .sh-sep, .sh-view { display: none; }
  }
`;

/**
 * The header paints at once, but a view's own content only exists after its data has arrived and
 * its first frame is drawn. Without this it pops in, and switching screens reads as a blink. The
 * body starts hidden and fades in when the view says it is ready — or after a second, whichever
 * comes first, so a failure never leaves a blank page.
 */
export function pageReady() { document.documentElement.classList.add('sh-ready'); }
let readyArmed = false;
function armReady() {
  if (readyArmed) return;
  readyArmed = true;
  setTimeout(pageReady, 1000);
}

/**
 * Cada tela é um documento próprio e leva de 0,4 a 0,8 s para se montar — quase tudo numa tarefa
 * longa só, que desenha o mapa ou as curvas. Uma troca de documento mostraria a página vazia por
 * esse tempo, e animação nenhuma esconde isso. A pré-renderização move esse trabalho para antes do
 * clique: o navegador monta a tela de destino em segundo plano e a navegação vira uma ativação.
 * Ela é disparada quando a mão vai ao seletor de Visão, não num relógio, porque montar as outras
 * telas custa o mesmo que montar a que está sendo lida.
 */
let activeLens: LensKey = 'tv';
let primed = false;
let aquecido = false;

/**
 * Território is built ahead of time, while another view is on screen.
 *
 * Esperar a mão chegar ao seletor serve para uma tela de 400 ms, e não para esta: numa apuração
 * as pessoas ficam uma hora na TV e só então pagam a partida inteira do mapa —
 * the municipal mesh over the network, 5.570 outlines turned into paths, the first municipal
 * results — with the count already running. So the map is primed once the current view is quiet,
 * and only the map: prerendering every view at once costs as much as the one being read.
 *
 * Where prerendering is not available the mesh is still fetched into the HTTP cache, which is the
 * megabyte of the wait, and it is skipped when the reader is on a metered or slow connection.
 */
export function warmMap(active: LensKey) {
  if (aquecido || active === 'territorio') return;
  aquecido = true;
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) { document.addEventListener('prerenderingchange', () => { aquecido = false; warmMap(active); }, { once: true }); return; }
  const rede = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (rede?.saveData || /^(slow-)?2g$/.test(rede?.effectiveType ?? '')) return;
  const quando = (fn: () => void) => 'requestIdleCallback' in window
    ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500);
  quando(() => {
    /*
     * Both, not one or the other. Prerendering is the whole win where it works — the map arrives
     * already drawn — but it is silently declined often enough (memory pressure, a browser that
     * does not do it, a rule the engine drops) that relying on it alone leaves the reader with the
     * same wait and no sign of why. The two fetches below are the megabyte and the first results
     * of that wait; they cost one request each and land in the HTTP cache, so a prerender that
     * does happen reads them from there too.
     */
    if (HTMLScriptElement.supports?.('speculationrules')) {
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prerender: [{ source: 'list', urls: [lensHref('territorio')], eagerness: 'eager' }] });
      document.head.appendChild(s);
    }
    const baixo = { priority: 'low' } as RequestInit;
    void fetch('/data/territorio/br-municipios.json', baixo).catch(() => {});
    // the office the map opens on, so the first frame has results instead of an empty outline
    void fetch(`/api/municipal?mode=${MODE}&uf=${UF}&turn=${TURN}&office=governor`, baixo).catch(() => {});
  });
}
export function primeNextViews(active: LensKey) {
  if (primed || !HTMLScriptElement.supports?.('speculationrules')) return;
  primed = true;
  // a prerendered document must not prerender in turn; it primes once it is the page on screen
  if ((document as Document & { prerendering?: boolean }).prerendering) { document.addEventListener('prerenderingchange', () => primeNextViews(active), { once: true }); return; }
  const urls = LENSES.filter(l => l.key !== active).map(l => lensHref(l.key));
  const run = () => {
    const s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify({ prerender: [{ source: 'list', urls, eagerness: 'eager' }] });
    document.head.appendChild(s);
  };
  run();
}

let cssMounted = false;
export function mountShellCss() {
  if (cssMounted) return;
  cssMounted = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const k = () => document.documentElement.style.setProperty('--sk', String(Math.max(.5, Math.min(innerWidth / 3440, innerHeight / 1440))));
  k(); addEventListener('resize', k);
  armReady();
}

/**
 * Fixed app header: name on the left, view and year on the right, everything else behind the
 * menu. It publishes its own height as `--sh-head`, which every view offsets its top chrome by.
 */
export function mountShellBar(active: LensKey): HTMLElement {
  mountShellCss();
  activeLens = active;
  const head = document.createElement('header');
  head.className = 'sh-head';
  const lensLabel = LENSES.find(l => l.key === active)?.label ?? '';
  head.innerHTML = `<div class="sh-row sh-main"><a class="sh-brand" href="${lensHref('tv')}">Pulso</a>`
    + `<span class="sh-sep" aria-hidden="true">|</span><span class="sh-view">${esc(lensLabel)}</span>`
    + `<button class="sh-menu" aria-expanded="false" aria-controls="sh-panel" aria-label="Abrir controles">`
    + `<svg viewBox="0 0 20 14" aria-hidden="true"><path d="M1 1h18M1 7h18M1 13h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`
    + `<div class="sh-right" id="sh-panel">${headFieldsHtml(active)}`
    + `</div></div>`;
  document.body.appendChild(head);

  /*
   * Narrow screens cannot show three lists, a name and a search box at once, and cramming them in
   * shrinks every one of them past reading. They move into a panel behind one button, where they
   * get their labels back and a size a thumb can hit. Above the breakpoint the button is not shown
   * and the panel is the same row it always was.
   */
  const menu = head.querySelector<HTMLButtonElement>('.sh-menu')!;
  const setMenu = (open: boolean) => {
    document.documentElement.classList.toggle('sh-menu-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Fechar controles' : 'Abrir controles');
  };
  menu.addEventListener('click', () => setMenu(!document.documentElement.classList.contains('sh-menu-open')));
  // choosing something is the end of the errand; so is a click outside, or Escape
  head.querySelector('.sh-right')!.addEventListener('change', () => setMenu(false));
  addEventListener('pointerdown', e => {
    if (!document.documentElement.classList.contains('sh-menu-open')) return;
    const t = e.target as Node;
    if (!head.querySelector('.sh-right')!.contains(t) && !menu.contains(t)) setMenu(false);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  wireSelectors(head);

  // Once this view has drawn and the main thread goes quiet, the map starts building itself.
  addEventListener('load', () => warmMap(active), { once: true });

  // Views anchor their own headers below this one.
  const measure = () => document.documentElement.style.setProperty('--sh-head', `${head.offsetHeight}px`);
  measure(); addEventListener('resize', measure);
  return head;
}
