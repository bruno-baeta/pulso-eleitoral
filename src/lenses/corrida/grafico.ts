/*
 * Pulso · Corrida em linhas do tempo.
 * Cinco faixas, uma por cargo: dentro de cada uma, os candidatos são blocos com a
 * foto oficial, e a largura de cada bloco é a fatia dele nos votos válidos.
 * Clicar num bloco abre as cidades do candidato; clicar no título, a tabela do cargo.
 */
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import type { Office, WireRace as Race, Snapshot } from '../../../shared/types';
import type { RankedCandidate } from '../../domain/derive';
import { SIMULADO_WINDOWS, describeWindow, nextWindow, openWindow } from '../../../shared/windows';
import type { Timeline } from '../../shell/dados';
import { mountPlayer } from '../../shell/player';
import { HIT_CSS, hitInner, seedScale } from '../../shell/row';
import { CSS } from './estilo';
import { colorOf } from './cores';
import { Chime } from './som';
import { abrirCandidato, abrirTabela } from './fichas';
import { escalaY } from './escala';
import { escalaConteudo, estreita } from '../../shell/escala';
import { mountShellBar, mountShellNote, pageReady } from '../../shell/shell';
import { all, contestedSeats, el, esc, fmtInt, fmtPercent, fmtShortTime, fold, initials, loadSnapshot, loadTimeline, MODE, party, photoUrl, seatsByParty, shortVotes, stateName, titleCase, TURN, UF, YEAR } from '../../shell/dados';

const style = document.createElement('style'); style.textContent = HIT_CSS + CSS; document.head.appendChild(style);
seedScale();
const app = document.getElementById('app')!;

const nameOf = (c: RankedCandidate) => titleCase(c.name).replace(/ ([a-z])$/, m => m.toUpperCase());
/** Overview lists show only the first word of the ballot name, so every line fits at the same size. */
const firstName = (c: RankedCandidate) => nameOf(c).split(' ')[0];

const LANES: { office: Office; title: string; lanes: number }[] = [
  { office: 'president', title: 'Presidente', lanes: 4 },
  { office: 'governor', title: 'Governador', lanes: 4 },
  { office: 'senate', title: 'Senado', lanes: 4 },
  { office: 'federal', title: 'Dep. federais', lanes: 6 },
  { office: 'state', title: UF === 'DF' ? 'Dep. distritais' : 'Dep. estaduais', lanes: 6 },
];
const legislativeOf = (o: Office) => o === 'federal' || o === 'state';
const statusOf = (c: RankedCandidate) => c.statusKey === 'elected' ? ['elected', 'eleito'] : c.statusKey === 'runoff' ? ['runoff', '2º turno'] : c.statusKey === 'in_seat_range' ? ['range', 'na faixa'] : c.statusKey === 'leading' ? ['lead', 'lidera'] : c.statusKey === 'alternate' ? ['', 'suplente'] : c.statusKey === 'not_elected' ? ['', 'não eleito'] : ['', ''];
/**
 * Same as `shortVotes`, with the decimals pinned. Under the crosshair the numbers change on every
 * pixel of travel, and a tally that goes from `6 mi` to `6,04 mi` to `12,3 mi` resizes its column
 * on each step; pinned, the figures stay in place and only their digits move.
 */
const steadyVotes = (v: number) => v >= 1e6
  ? `${(v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`
  : v >= 1e3 ? `${(v / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`
    : v.toLocaleString('pt-BR');



const chime = new Chime();
const lastVotes = new Map<string, number>();
/** Replay state: live follows the collector; otherwise `at` is the instant shown, advancing at `speed` while playing. */
const rp = { live: true, playing: false, speed: 60, at: 0 };
const loud = () => rp.live || rp.speed <= 10;
const lastLeader = new Map<Office, string>();
/** Fixed per race: only ever grows, so a runner climbs exactly by the votes it receives. */

let snap: Snapshot;

function simuladoAvailability(): { disabled?: string; hint?: string } {
  const next = nextWindow(SIMULADO_WINDOWS);
  if (openWindow(SIMULADO_WINDOWS)) return { hint: 'Janela de testes do TSE aberta agora.' };
  return { disabled: next ? `Só abre nas janelas de teste do TSE. Próxima: ${describeWindow(next)}.` : 'Os testes do TSE para 2026 terminaram.' };
}

async function main() {
  // The header is the same on every screen, so painting it before the data is fetched keeps the
  // page from opening blank: switching views then looks continuous instead of blinking.
  const shellBar = mountShellBar('corrida');
  snap = await loadSnapshot();
  // Uma linha fina sob a barra do aplicativo: título, contexto e a busca.
  // view, year, state and round all live in the app header now, and repeating them read as a
  // second header. Only the live/replay badge stays.
  const bar = el('div', 'bar cr-head', `
    <div class="cr-row">
      <div class="search"><svg class="lens" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input placeholder="Pesquisar candidato, partido ou número…" aria-label="Pesquisar candidato, partido ou número"><kbd>Ctrl K</kbd><div class="results" hidden></div></div>
      <button class="sound" aria-pressed="false">Som desligado</button>
      <button class="m-search" aria-label="Buscar candidato" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </div>`);
  app.appendChild(bar);
  /** Where the page chrome ends: the view's own bar, or the app header when there is none. */
  const chromeBottom = () => (bar.isConnected ? bar : shellBar).getBoundingClientRect().bottom;
  const setNote = mountShellNote();
  // Kept out of the page: nothing shows it now, but the replay readout still writes to it.
  const badge = el('span', 'demo badge');
  const simOption = shellBar.querySelector<HTMLOptionElement>('select[data-k="mode"] option[value="simulado"]');
  if (simOption) setInterval(() => {
    const a = simuladoAvailability();
    simOption.disabled = !!a.disabled && MODE !== 'simulado';
    simOption.title = a.disabled ?? a.hint ?? '';
  }, 30_000);
  const searchBtn = bar.querySelector('.m-search') as HTMLButtonElement;
  searchBtn.addEventListener('click', () => { const open = app.classList.toggle('search-open'); searchBtn.setAttribute('aria-expanded', String(open)); if (open) bar.querySelector<HTMLInputElement>('.search input')!.focus(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { app.classList.remove('search-open'); searchBtn.setAttribute('aria-expanded', 'false'); } });
  const soundBtn = bar.querySelector('.sound') as HTMLButtonElement;
  soundBtn.addEventListener('click', () => { const on = chime.toggle(); soundBtn.classList.toggle('on', on); soundBtn.setAttribute('aria-pressed', String(on)); if (on) chime.votes(); });
  const searchInput = bar.querySelector('input')!, results = bar.querySelector('.results') as HTMLElement;
  searchInput.addEventListener('input', () => {
    const q = fold(searchInput.value.trim());
    if (!q) { results.hidden = true; return; }
    const hits = LANES.flatMap(l => all(snap.races[l.office]).filter(c => fold(`${c.name} ${c.number} ${c.party}`).includes(q)).map(c => ({ l, c }))).slice(0, 8);
    results.hidden = false;
    results.innerHTML = hits.length ? hits.map((h, i) => {
      const url = photoUrl(snap.races[h.l.office]!, h.c.id);
      const iniciais = initials(nameOf(h.c));
      return `<button class="sres" data-i="${i}">${hitInner({
        photo: `${esc(iniciais)}${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`,
        name: esc(nameOf(h.c)),
        meta: `${esc(party(h.c.party))} · ${esc(h.l.title)} · ${h.c.rank}º`,
        value: fmtPercent(h.c.percent, 1),
      })}</button>`;
    }).join('') : '<div class="sres-none">Nenhuma candidatura encontrada.</div>';
    results.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const h = hits[Number(b.dataset.i)];
      results.hidden = true; searchInput.value = ''; searchInput.blur();
      revealCandidate(h.l.office, h.c.id);
    }));
  });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.focus(); } });

  // Phones show one race at a time: tabs for the five offices, swipe to move between them.
  const params0 = new URLSearchParams(location.search);
  const cargo0 = params0.get('cargo');
  /** Qual disputa está aberta: é ela que o gráfico desenha. */
  let view: Office = LANES.some(l => l.office === cargo0) ? cargo0 as Office : LANES[0].office;
  const tabs = el('div', 'tabs', LANES.map(l => `<button data-v="${l.office}">${l.title}</button>`).join(''));
  const setView = (v: Office) => {
    view = v;
    const i = LANES.findIndex(l => l.office === v);
    if (i >= 0) active = i;
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    const u = new URL(location.href);
    u.searchParams.set('cargo', v);
    history.replaceState(null, '', u);
    layout();
  };
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => {
    setView(b.dataset.v as Office);
  }));
  let touchX: number | null = null;
  app.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  app.addEventListener('touchend', e => {
    if (touchX === null || !app.classList.contains('mobile') || document.querySelector('.modal')) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 60) {
      const order: Office[] = LANES.map(l => l.office);
      const at = order.indexOf(view);
      setView(order[(at + (dx < 0 ? 1 : -1) + order.length) % order.length]);
    }
  }, { passive: true });
  const tip = el('div', 'tip'); tip.hidden = true; app.appendChild(tip);
  // vote arrivals float above every chrome, including the shell bar
  const gainLayer = el('div', 'gainlayer'); document.body.appendChild(gainLayer);
  const syncGainK = () => gainLayer.style.setProperty('--k', app.style.getPropertyValue('--k'));

  /* ───────────── Gráfico de linhas: cada cargo é um painel no tempo ───────────── */
  const SHOWN_PROP = 6;                 // deputies by party: six legends plus the aggregate
  const SHOWN_CAND = 4;                 // deputies by candidate: four curves plus the aggregate
  const SHOWN_MAJ = 3;                  // president, governor, senate: only the top three
  const pinned = new Map<Office, string>();   // a search result takes the last slot
  const lin = el('div', 'lin');
  app.insertBefore(lin, bar);
  /** The charts read left to right as the count comes in: the x axis is always % of urns. */
  const xMode: 'time' | 'counted' = 'counted';

  /** One office's history: timestamps, how much was counted, and each candidate's share at each stamp. */
  interface Store { stamps: number[]; counted: number[]; vals: Map<string, number[]>; pcts: Map<string, number[]> }
  const srv = new Map<string, Store>();                                   // what the recording gives us
  const obs = new Map<string, { t: number; c: number; m: Map<string, number>; q: Map<string, number> }[]>();  // what this session saw
  const merged = new Map<string, { key: string; st: Store }>();
  /** Which curve an office reads: the president has one for the country and one for the state. */
  const seriesKey = (office: Office) => office === 'president' && presScope === 'UF' ? `president:${UF}` : office;
  /*
   * Accumulated votes against the share of urns counted is close to a straight ramp by
   * construction: the tally grows with the count, and the only thing bending the line is how the
   * candidacy's share moves, which is small next to the whole climb from nothing to the final
   * total. The share of valid votes is the reading that actually has a shape — it starts where the
   * first urns fall, swings, and crosses. Both are true, so the axis is a choice.
   */
  let yMode: 'votes' | 'share' = 'share';
  /*
   * The tallest value on the scale is recomputed every refresh, and every change of it compresses
   * every curve at once. Over a real count that ladder steps ~32 times on the votes axis, and near
   * a boundary it flaps between two rungs refresh after refresh. While the count is running the
   * scale therefore only grows. A replay may shrink it: moving back in time is deliberate.
   */
  const yHeld = new Map<string, number>();
  const emptyStore = (): Store => ({ stamps: [], counted: [], vals: new Map(), pcts: new Map() });

  const push = (st: Store, t: number, c: number, m: Map<string, number>, q: Map<string, number>) => {
    if (st.stamps.length && t <= st.stamps[st.stamps.length - 1]) return;
    st.stamps.push(t); st.counted.push(c);
    const n = st.stamps.length;
    for (const [into, src] of [[st.vals, m], [st.pcts, q]] as const) {
      for (const [id, y] of src) {
        let a = into.get(id);
        if (!a) { a = new Array(n - 1).fill(0); into.set(id, a); }
        a.push(y);
      }
      for (const a of into.values()) while (a.length < n) a.push(a[a.length - 1] ?? 0);
    }
  };

  /** The server series plus every point observed since the page opened (the only source in demo). */
  const storeOf = (office: Office): Store => {
    const id0 = seriesKey(office);
    const base = srv.get(id0) ?? emptyStore();
    const extra = obs.get(id0) ?? [];
    const key = `${base.stamps.length}|${base.stamps[base.stamps.length - 1] ?? 0}|${extra.length}`;
    const cached = merged.get(id0);
    if (cached && cached.key === key) return cached.st;
    const st: Store = {
      stamps: [...base.stamps], counted: [...base.counted],
      vals: new Map([...base.vals].map(([id, a]) => [id, [...a]])),
      pcts: new Map([...base.pcts].map(([id, a]) => [id, [...a]])),
    };
    for (const p of extra) push(st, p.t, p.c, p.m, p.q);
    merged.set(id0, { key, st });
    return st;
  };

  /** Every live snapshot is one more point on the curve, so the line keeps growing between refreshes. */
  const observe = () => {
    if (!rp.live) return;
    const watched: { id: string; race: Race | undefined }[] = [
      ...LANES.map(l => ({ id: l.office as string, race: snap.races[l.office] })),
      { id: `president:${UF}`, race: snap.presidentUf },
    ];
    for (const l of watched) {
      const race = l.race;
      if (!race) continue;
      const t = (race.sourceAt ? Date.parse(race.sourceAt) : 0) || snap.serverAt || Date.now();
      const list = obs.get(l.id) ?? [];
      if (list.length && t <= list[list.length - 1].t) continue;
      const m = new Map<string, number>(), q = new Map<string, number>();
      for (const c of all(race)) { m.set(c.id, c.votes); q.set(c.id, c.percent); }
      list.push({ t, c: race.countedPercent, m, q });
      if (list.length > 400) list.shift();
      obs.set(l.id, list);
      merged.delete(l.id);
    }
  };

  const loadSeries = async () => {
    const wanted = [...LANES.map(l => ({ office: l.office, scope: '' })), { office: 'president' as Office, scope: UF }];
    await Promise.all(wanted.map(async l => {
      const id0 = l.scope ? `president:${l.scope}` : l.office;
      try {
        const r = await fetch(`/api/series?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${l.office}${l.scope ? `&scope=${l.scope}` : ''}`);
        if (!r.ok) return;
        const d = await r.json() as { candidates: { id: string }[]; points: { at: number; counted: number; votes?: number[]; shares: number[] }[] };
        const st = emptyStore();
        for (const p of d.points) {
          const m = new Map<string, number>(), q = new Map<string, number>();
          d.candidates.forEach((c, i) => { m.set(c.id, p.votes?.[i] ?? 0); q.set(c.id, p.shares?.[i] ?? 0); });
          push(st, p.at, p.counted, m, q);
        }
        srv.set(id0, st);
        merged.delete(id0);
      } catch { /* keeps whatever we already have */ }
    }));
  };

  /** Catmull-Rom turned into béziers, with the control points clamped so the curve never overshoots. */
  const clamp = (v: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
  const pathOf = (pts: [number, number][]) => {
    if (!pts.length) return '';
    if (pts.length < 3) return `M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? pts[i + 1], s = .17;
      const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
      // Both axes are clamped to the segment. Unclamped, an uneven gap between points pushes a
      // control point past its own end and the curve loops back on itself.
      const c1x = clamp(p1[0] + (p2[0] - p0[0]) * s, p1[0], p2[0]);
      const c2x = clamp(p2[0] - (p3[0] - p1[0]) * s, p1[0], p2[0]);
      const c1y = clamp(p1[1] + (p2[1] - p0[1]) * s, lo, hi);
      const c2y = clamp(p2[1] - (p3[1] - p1[1]) * s, lo, hi);
      d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };

  const cols = LANES.map((l, i) => {
    const row = el('section', 'prow');
    const head = el('button', 'phead');
    head.setAttribute('aria-label', `Abrir tabela: ${l.title}`);
    head.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.mtog.sw')) { col.showCands = !col.showCands; layout(); return; }
      if ((e.target as HTMLElement).closest('.mtog.ax')) { yMode = yMode === 'share' ? 'votes' : 'share'; layout(); return; }
      if ((e.target as HTMLElement).closest('.gscope')) return;
      abrirTabela(snap, l.office, '', undefined, l.office === 'president' ? presRace() : undefined);
    });
    if (l.office === 'president') {
      const scope = el('div', 'gscope', `<button data-sc="BR">Brasil</button><button data-sc="UF">${esc(UF)}</button>`);
      scope.setAttribute('role', 'group');
      scope.setAttribute('aria-label', 'Abrangência da apuração');
      scope.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => {
        presScope = b.dataset.sc === 'UF' ? 'UF' : 'BR';
        layout();
      }));
      row.appendChild(scope);
      scope.classList.add('pscope');
    }
    const plot = el('div', 'plot');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart');
    svg.innerHTML = '<g class="grid"></g><g class="refs"></g><g class="lines"></g><g class="cross"></g>';
    const heads = el('div', 'heads');
    const empty = el('div', 'pempty'); empty.hidden = true;
    plot.append(svg as unknown as HTMLElement, heads, empty);
    if (l.office === 'president') row.classList.add('solo');
    row.append(head, plot);
    lin.appendChild(row);
    row.dataset.office = l.office;
    const col = { l, i, row, head, plot, svg, heads, empty, list: [] as RankedCandidate[], marks: new Map<string, SVGPathElement>(), meds: new Map<string, HTMLElement>(), showCands: false, geo: null as null | { x0: number; x1: number; t0: number; t1: number; yMax: number; yMin: number; pad: { l: number; r: number; t: number; b: number }; w: number; h: number; st: Store; ids: string[]; valAt: (id: string, idx: number) => number; votesAt: (id: string, idx: number) => number; pctAt: (id: string, idx: number) => number; valid: number } };
    plot.addEventListener('mousemove', e => crosshair(col, e));
    plot.addEventListener('mouseleave', () => { tip.hidden = true; (col.svg.querySelector('.cross') as SVGGElement).innerHTML = ''; });
    return col;
  });
  type Col = typeof cols[number];

  /** Vertical crosshair with the instant and everyone's share at it. */
  const crosshair = (col: Col, e: MouseEvent) => {
    const g = col.geo, cross = col.svg.querySelector('.cross') as SVGGElement;
    if (!g || !g.st.stamps.length) return;
    const r = col.plot.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < g.pad.l - 4 || x > g.x1 + 4) { cross.innerHTML = ''; tip.hidden = true; return; }
    // nearest recorded instant
    let best = 0, bd = Infinity;
    g.st.stamps.forEach((t, idx) => { const d = Math.abs(xAt(g, t, idx) - x); if (d < bd) { bd = d; best = idx; } });
    const px = xAt(g, g.st.stamps[best], best);
    const race = snap.races[col.l.office];
    const rows = g.ids.map(id => ({ id, y: g.valAt(id, best) })).sort((a, b) => b.y - a.y);
    cross.innerHTML = `<line x1="${px}" x2="${px}" y1="${g.pad.t}" y2="${g.pad.t + g.h}" class="chair"/>`
      + rows.map(v => `<circle cx="${px}" cy="${yAt(g, v.y)}" r="${4.5 * kNow}" fill="${colorOf(idParty(col, v.id))}" stroke="#0e100f" stroke-width="${2 * kNow}"/>`).join('');
    tip.innerHTML = `<div class="n">${g.st.counted[best] !== undefined ? `${fmtPercent(g.st.counted[best], 1)} apurado` : ''}</div>`
      + `<div class="rows">${rows.slice(0, 9).map(v => `<span><i style="background:${colorOf(idParty(col, v.id))}"></i>`
        + `<u>${esc(idName(col, v.id))}</u><b>${steadyVotes(g.votesAt(v.id, best))}</b><em>${fmtPercent(g.pctAt(v.id, best), 2)}</em></span>`).join('')}</div>`;
    tip.hidden = false;
    const tr = tip.getBoundingClientRect();
    // Beside the crosshair, never over it: it takes the side with room and follows the pointer,
    // kept clear of the header above and of the playback bar below.
    const gap = 16 * kNow;
    const cx = r.left + px;
    const left = cx + gap + tr.width <= innerWidth - 12 ? cx + gap : cx - gap - tr.width;
    tip.style.left = `${Math.max(12, left)}px`;
    const floor = player.el.getBoundingClientRect().top - 8;
    const ceiling = chromeBottom() + 8;
    tip.style.top = `${Math.max(ceiling, Math.min(e.clientY - tr.height / 2, floor - tr.height))}px`;
    void race;
  };
  let kNow = 1;
  const nameById = new Map<string, { name: string; party: string }>();
  const idName = (col: Col, id: string) => id.startsWith('p:') ? id.slice(2) : nameById.get(`${col.l.office}:${id}`)?.name ?? id;
  const idParty = (col: Col, id: string) => id === 'rest' ? '—' : id.startsWith('p:') ? id.slice(2) : nameById.get(`${col.l.office}:${id}`)?.party ?? '';
  const xAt = (g: NonNullable<Col['geo']>, t: number, idx: number) =>
    xMode === 'counted' ? g.pad.l + Math.min(100, Math.max(0, g.st.counted[idx] ?? 0)) / 100 * g.w
      : g.pad.l + (g.t1 > g.t0 ? (t - g.t0) / (g.t1 - g.t0) : 1) * g.w;
  const yAt = (g: NonNullable<Col['geo']>, v: number) => g.pad.t + (1 - (Math.min(Math.max(v, g.yMin), g.yMax) - g.yMin) / Math.max(1e-6, g.yMax - g.yMin)) * g.h;

  /** Draws one office: curves, references, grid and the photo at the tip of each line. */
  let span: { t0: number; t1: number } = { t0: 0, t1: 1 };
  const drawChart = (col: Col, race: Race, k: number, mobile: boolean) => {
    kNow = k;
    const st = storeOf(col.l.office);
    const ranked = all(race);
    for (const c of ranked) nameById.set(`${col.l.office}:${c.id}`, { name: nameOf(c), party: c.party });
    const legislative = legislativeOf(col.l.office);
    // A deputy wins with a fraction of a percent, so alone each curve is a flat line at the bottom:
    // by default the proportional races are read party by party, where the seats are actually decided.
    const byParty = legislative && !col.showCands;
    const members = new Map<string, string[]>();        // party -> its candidate ids
    const seatsOf = new Map<string, number>();
    if (byParty) {
      for (const c of ranked) {
        const p = party(c.party);
        (members.get(p) ?? members.set(p, []).get(p)!).push(c.id);
      }
      for (const p of seatsByParty(race, YEAR)) seatsOf.set(party(p.party), p.seats);
    }
    const notes: string[] = [];
    const votesNow = (list: string[]) => list.reduce((a, r) => a + (ranked.find(c => c.id === r)?.votes ?? 0), 0);
    const pctNow = (list: string[]) => list.reduce((a, r) => a + (ranked.find(c => c.id === r)?.percent ?? 0), 0);
    // A party's share is the sum of its candidacies' shares, exactly as its tally is the sum of
    // their votes, so the same reduction serves both axes.
    const share = yMode === 'share';
    const sumNow = share ? pctNow : votesNow;
    const track = share ? st.pcts : st.vals;
    const sumAt = (list: string[], idx: number) => list.reduce((a, r) => a + (track.get(r)?.[idx] ?? 0), 0);
    // which curves are worth drawing
    const most = byParty ? SHOWN_PROP : legislative ? SHOWN_CAND : SHOWN_MAJ;
    let ids = byParty
      ? [...members.keys()].sort((a, b) => votesNow(members.get(b)!) - votesNow(members.get(a)!)).slice(0, most).map(p => `p:${p}`)
      : ranked.slice(0, most).map(c => c.id);
    // a name picked in the search takes the last slot, so it can be followed against the leaders
    const pin = pinned.get(col.l.office);
    if (!byParty && pin && ranked.some(c => c.id === pin) && !ids.includes(pin)) ids = [...ids.slice(0, most - 1), pin];
    const shown = new Set(ids);
    const restIds = !legislative ? []
      : byParty ? ranked.filter(c => !shown.has(`p:${party(c.party)}`)).map(c => c.id)
        : ranked.filter(c => !shown.has(c.id)).map(c => c.id);
    const restWhat = byParty ? 'partidos' : 'candidaturas';
    const restCount = byParty ? new Set(restIds.map(id => party(ranked.find(c => c.id === id)!.party))).size : restIds.length;
    const groupOf = (id: string) => id.startsWith('p:') ? members.get(id.slice(2)) ?? [] : [id];
    const topPct = Math.max(...ids.map(id => votesNow(groupOf(id))), .001);
    // The tail of a proportional race is an aggregate, not a candidacy: drawn as a curve it is the
    // tallest line on the chart and beats every real dispute, so it is only ever a note.
    if (restIds.length) notes.push(`demais ${restCount} ${restWhat} somam ${fmtPercent(pctNow(restIds), 1)}`);
    col.list = ranked.filter(c => shown.has(c.id));
    const valAt = (id: string, idx: number) => sumAt(groupOf(id), idx);
    // The crosshair states votes AND share whichever axis is on screen, so both are read from the
    // store directly instead of from the axis, whose unit changes with the toggle.
    const votesAt = (id: string, idx: number) => groupOf(id).reduce((a, r) => a + (st.vals.get(r)?.[idx] ?? 0), 0);
    const pctAt = (id: string, idx: number) => groupOf(id).reduce((a, r) => a + (st.pcts.get(r)?.[idx] ?? 0), 0);
    const nowOf = (id: string) => sumNow(groupOf(id));

    const r = col.plot.getBoundingClientRect();
    const W = Math.max(40, r.width), H = Math.max(40, r.height);
    const t0 = span.t0, t1 = span.t1;                    // the five panels share one clock
    const single = st.stamps.length < 2;                 // no recording: only the final state
    // The axis counts votes, so every curve climbs from nothing to its final tally as the urns
    // come in, instead of snapping to a share that barely moves after the first percent.
    const from = st.counted.findIndex(c => c > 0);        // ignore the instants before the first vote
    const seen0 = from < 0 ? [] : st.stamps.map((_, idx) => idx).slice(from);
    const vals = ids.flatMap(id => [nowOf(id), ...seen0.map(idx => valAt(id, idx))]).filter(v => Number.isFinite(v));
    const { teto: raw, passo: ystep } = escalaY(Math.max(...vals, 1), share);
    const scaleKey = `${col.l.office}|${presScope}|${yMode}`;
    const yMax = rp.live ? Math.max(raw, yHeld.get(scaleKey) ?? 0) : raw;
    if (rp.live) yHeld.set(scaleKey, yMax);
    const yMin = 0;
    const pad = { l: 74 * k, r: mobile ? 178 * k : 300 * k, t: 18 * k, b: 30 * k };
    const w = Math.max(10, W - pad.l - pad.r), h = Math.max(10, H - pad.t - pad.b);
    const g = { x0: pad.l, x1: pad.l + w, t0, t1, yMax, yMin, pad, w, h, st, ids, valAt, votesAt, pctAt, valid: race.validVotes };
    col.geo = g;
    col.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    col.svg.setAttribute('width', String(W)); col.svg.setAttribute('height', String(H));

    // grid: 10% steps on Y, hours (or 10% counted) on X
    const grid = col.svg.querySelector('.grid') as SVGGElement;
    let gd = '';
    // as bare as it gets: the y axis line, its labels, and one vertical rule per hour (the first included)
    gd += `<line x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${pad.t + h}" class="axis"/>`;
    gd += `<line x1="${pad.l}" x2="${pad.l + w}" y1="${pad.t + h}" y2="${pad.t + h}" class="axis"/>`;
    for (let v = yMin; v <= yMax + 1e-9; v += ystep) {
      const y = yAt(g, v);
      gd += `<text x="${pad.l - 10 * k}" y="${y + 5 * k}" class="ylab">${v === 0 ? '0' : share ? fmtPercent(v, 0) : shortVotes(v)}</text>`;
    }
    const hour = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    if (xMode === 'counted') {
      for (let c = 0; c <= 100; c += 20) {
        const x = pad.l + c / 100 * w;
        gd += `<line x1="${x}" x2="${x}" y1="${pad.t}" y2="${pad.t + h}" class="gl v"/><text x="${x}" y="${pad.t + h + 22 * k}" class="xlab">${c}%</text>`;
      }
    } else {
      const total = t1 - t0;
      const step = [1, 2, 3, 6, 12, 24].find(v => total / (v * 3600e3) <= 9) ?? 24;
      const marks = [t0];
      const d0 = new Date(t0); d0.setMinutes(0, 0, 0); d0.setHours(d0.getHours() + 1);
      if (!single) for (let ms = d0.getTime(); ms < t1 - total * .04 && marks.length < 12; ms += step * 3600e3) marks.push(ms);
      for (const ms of marks) {
        const x = pad.l + (ms - t0) / total * w;
        if (ms !== t0) gd += `<line x1="${x}" x2="${x}" y1="${pad.t}" y2="${pad.t + h}" class="gl v"/>`;
        if (!single) gd += `<text x="${x}" y="${pad.t + h + 22 * k}" class="xlab">${hour(ms)}</text>`;
      }
    }
    grid.innerHTML = gd;

    // No horizontal reference lines: a seat cut or a runoff threshold drawn against accumulated
    // votes is a moving number, so the line says nothing about who is winning.
    const refs = col.svg.querySelector('.refs') as SVGGElement;
    let rd = '';
    // the replay needle: where the story is paused
    if (!rp.live && st.stamps.length) {
      let idx = 0;
      st.stamps.forEach((t, j) => { if (t <= rp.at) idx = j; });
      const nx = xAt(g, Math.min(rp.at, st.stamps[st.stamps.length - 1]), idx);
      rd += `<rect x="${nx}" y="${pad.t}" width="${Math.max(0, pad.l + w - nx)}" height="${h}" class="future"/>`
        + `<line x1="${nx}" x2="${nx}" y1="${pad.t}" y2="${pad.t + h}" class="needle"/>`;
    }
    refs.innerHTML = rd;

    // one path per candidacy, reused so the curve grows instead of blinking
    const lines = col.svg.querySelector('.lines') as SVGGElement;
    // during a replay the story stops at the needle: nothing after it has happened yet
    const upTo = rp.live ? st.stamps.length : st.stamps.filter(t => t <= rp.at).length;
    const endIdx = Math.max(0, upTo - 1);
    const endX = st.stamps.length ? xAt(g, st.stamps[endIdx], endIdx) : g.x1;
    const seen = new Set<string>();
    ids.forEach((id, rank) => {
      seen.add(id);
      let p = col.marks.get(id);
      if (!p) {
        p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('fill', 'none');
        lines.appendChild(p);
        col.marks.set(id, p);
      }
      const series = st.stamps.map((t, idx): [number, number] => [xAt(g, t, idx), yAt(g, valAt(id, idx))]).slice(Math.max(0, from), upTo);
      // The count only ever moves forward. When the source reports a share of urns slightly below
      // the previous frame's, the curve would double back on itself and knot; pin it instead.
      for (let i = 1; i < series.length; i++) if (series[i][0] < series[i - 1][0]) series[i][0] = series[i - 1][0];
      // A tally starts at nothing, so the votes axis is anchored at zero. A share does not: nobody
      // has 0% of the valid votes before the first urn — the line begins where the count does, or
      // it drops a vertical spike down to the axis.
      const pts: [number, number][] = !series.length ? [] : share ? series : [[g.x0, yAt(g, 0)], ...series];
      p.setAttribute('d', single || pts.length < 2 ? '' : pathOf(pts));
      /*
       * The count did not start where the record did. The TSE's first published file already
       * carried 7% of the sections, so on the share axis every curve began seven points into an
       * axis drawn from zero, and the space to its left read as data that had gone missing.
       *
       * It cannot be filled with a measurement: nobody holds a share of the valid votes before the
       * first urn is opened, and a curve drawn down to zero would show every candidate collapsing
       * to nothing at the start of the night. So the gap is bridged, not invented — a dashed
       * stretch at the height of the first reading, which says "no file covers this" in the one
       * way a chart can say it, and the solid line still begins where the evidence does.
       */
      const leadKey = `lead:${id}`;
      let lead = col.marks.get(leadKey);
      const precisa = share && series.length > 0 && series[0][0] > g.x0 + 1;
      if (precisa) {
        if (!lead) {
          lead = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          lead.setAttribute('class', 'lead');
          lines.appendChild(lead);
          col.marks.set(leadKey, lead);
        }
        seen.add(leadKey);
        lead.setAttribute('d', `M${g.x0},${series[0][1]} L${series[0][0]},${series[0][1]}`);
        lead.setAttribute('stroke', id === 'rest' ? '#4b5250' : colorOf(idParty(col, id)));
        lead.setAttribute('stroke-width', String((rank < 2 ? 3.4 : 2.2) * k));
        lead.setAttribute('opacity', String(rank < 2 ? .42 : .26));
      } else if (lead) { lead.remove(); col.marks.delete(leadKey); }
      p.setAttribute('stroke', id === 'rest' ? '#4b5250' : colorOf(idParty(col, id)));
      p.setAttribute('stroke-width', String((rank < 2 ? 3.4 : 2.2) * k));
      p.setAttribute('opacity', String(rank < 2 ? 1 : id === 'rest' ? .5 : .62));
    });
    for (const [id, p] of [...col.marks]) if (!seen.has(id)) { p.remove(); col.marks.delete(id); }

    // photos at the tip of each line, nudged apart when they would collide
    const slots = ids.map((id, rank) => ({ id, rank, y: yAt(g, nowOf(id)), v: nowOf(id) })).sort((a, b) => a.y - b.y);
    const gap = 54 * k, fit = Math.max(1, Math.floor(h / gap));
    const show = new Set(slots.slice().sort((a, b) => a.rank - b.rank).slice(0, mobile ? 3 : fit).map(s => s.id));
    let prev = -Infinity;
    for (const s of slots) { if (!show.has(s.id)) continue; s.y = Math.max(s.y, prev + gap); prev = s.y; }
    const over = prev - (pad.t + h);
    if (over > 0) for (const s of slots) if (show.has(s.id)) s.y -= over;
    const alive = new Set<string>();
    for (const s of slots) {
      if (!show.has(s.id)) continue;
      alive.add(s.id);
      let m = col.meds.get(s.id);
      const c = s.id === 'rest' ? null : ranked.find(x => x.id === s.id);
      // .med carries a transform transition so a change of place slides. A medallion appearing for
      // the first time has no place to slide from, and `left/top: 0` means it would fly in from the
      // corner, so it is placed before it is attached and has nothing to animate.
      const place = `translate(${(single ? g.x1 : endX) + 14 * k}px, ${s.y}px) translateY(-50%)`;
      if (!m) {
        m = el('div', 'med');
        m.innerHTML = `<div class="ph"><img alt="" onerror="this.classList.add('gone')"><span class="ini"></span></div><div class="tx"><b></b><span></span></div>`;
        if (c) m.addEventListener('click', () => { const cc = all(snap.races[col.l.office]).find(x => x.id === s.id); if (cc) abrirCandidato(snap, col.l.office, cc); });
        else m.classList.add('rest');
        m.style.transform = place;
        col.heads.appendChild(m);
        col.meds.set(s.id, m);
      }
      const color = s.id === 'rest' ? '#4b5250' : colorOf(idParty(col, s.id));
      m.style.setProperty('--c', color);
      m.classList.toggle('lead', s.rank === 0);
      m.classList.toggle('party', !c && s.id !== 'rest');
      // Only the vertical move means something: it is a change of place in the race. The column is
      // laid out twice before it settles, and animating that horizontal correction sent the leader
      // gliding across the chart, so a move that shifts x is applied without the transition.
      const x = String(Math.round((single ? g.x1 : endX) + 14 * k));
      if (m.dataset.x !== x) {
        const keep = m.style.transition;
        m.style.transition = 'none';
        m.style.transform = place;
        void m.offsetWidth;
        m.style.transition = keep;
        m.dataset.x = x;
      } else m.style.transform = place;
      const img = m.querySelector('img') as HTMLImageElement;
      const url = c ? photoUrl(race, c.id) : null;
      if (url && img.getAttribute('src') !== url) { img.classList.remove('gone'); img.setAttribute('src', url); }
      if (!url) img.classList.add('gone');
      (m.querySelector('.ini') as HTMLElement).textContent = c ? nameOf(c).split(' ').map(x => x[0]).slice(0, 2).join('')
        : s.id === 'rest' ? '+' : '';
      (m.querySelector('b') as HTMLElement).textContent = c ? nameOf(c)
        : idName(col, s.id);
      // `s.v` is in whatever the axis reads; the other half of the pair comes from the race itself
      const group = groupOf(s.id);
      const tally = share ? votesNow(group) : s.v;
      const pct = share ? s.v : (race.validVotes > 0 ? s.v / race.validVotes * 100 : 0);
      (m.querySelector('.tx span') as HTMLElement).textContent = `${shortVotes(tally)} · ${fmtPercent(pct, 2)}`;
    }
    for (const [id, m] of [...col.meds]) if (!alive.has(id)) { m.remove(); col.meds.delete(id); }
    // a hairline ties each photo back to the end of its own curve
    let links = '';
    for (const s2 of slots) {
      if (!show.has(s2.id)) continue;
      const y0 = yAt(g, s2.v), color = s2.id === 'rest' ? '#4b5250' : colorOf(idParty(col, s2.id));
      const x0 = single ? g.x1 : endX;
      links += `<circle cx="${x0}" cy="${y0}" r="${3.4 * k}" fill="${color}"/>`;
      if (Math.abs(s2.y - y0) > 2) links += `<path d="M${x0},${y0} L${x0 + 8 * k},${y0} L${x0 + 12 * k},${s2.y} L${x0 + 14 * k},${s2.y}" class="link" stroke="${color}"/>`;
    }
    (col.svg.querySelector('.refs') as SVGGElement).insertAdjacentHTML('beforeend', links);

    // 2022 has no recording: show the final state honestly instead of inventing a curve
    if (single) notes.unshift('O TSE publicou só o resultado final de 2022; não há série temporal');
    col.empty.hidden = !notes.length;
    col.empty.textContent = notes.join(' · ');
    if (single) {
      let dots = '';
      for (const s of slots) dots += `<circle cx="${g.x1}" cy="${yAt(g, s.v)}" r="${6 * k}" fill="${s.id === 'rest' ? '#4b5250' : colorOf(idParty(col, s.id))}"/>`
        + `<line x1="${g.x1 - 26 * k}" x2="${g.x1}" y1="${yAt(g, s.v)}" y2="${yAt(g, s.v)}" class="stub" stroke="${s.id === 'rest' ? '#4b5250' : colorOf(idParty(col, s.id))}"/>`;
      (col.svg.querySelector('.lines') as SVGGElement).insertAdjacentHTML('beforeend', `<g class="final">${dots}</g>`);
    }
    col.svg.querySelectorAll('.final').forEach((n, idx, l2) => { if (!single || idx < l2.length - 1) n.remove(); });
  };

  let active = 0;
  const setActive = (i: number) => {
    active = (i + LANES.length) % LANES.length;
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === active));
    tabs.querySelectorAll('button')[active]?.scrollIntoView({ inline: 'center', block: 'nearest' });
    layout();
  };

  /** Ctrl K result: flash the candidate's medallion, or open the table when the curve is not drawn. */
  const revealCandidate = (office: Office, id: string) => {
    const col = cols.find(c => c.l.office === office);
    if (!col) return;
    if (app.classList.contains('mobile')) setActive(col.i);
    pinned.set(office, id);
    layout();
    const m = col.meds.get(id);
    if (!m) { abrirTabela(snap, office, '', id); return; }
    m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit');
    m.scrollIntoView({ block: 'nearest', inline: 'center' });
    setTimeout(() => m.classList.remove('hit'), 4000);
  };

  /** A candidatura escolhida na busca: destacada na coluna dela. */
  let picked: { office: Office; id: string } | null = null;
  /** The height of one line, measured once and kept, so the first paint sizes the list right. */
  let knownRowH = 106, reflowing = false;
  /** Whether the presidential column counts the whole country or only the selected state. */
  let presScope: 'BR' | 'UF' = 'BR';
  /** The presidential race as the column is currently scoped; null when the state's is missing. */
  const presRace = () => presScope === 'UF' ? snap.presidentUf : snap.races.president;

  const layout = () => {
    let changed = false; let overtakes = 0;
    const W = innerWidth, H = innerHeight;
    const mobile = estreita(W, H);
    const k = escalaConteudo(W, H);
    app.classList.toggle('mobile', mobile);
    shellBar.classList.toggle('mobile', mobile);
    app.style.setProperty('--k', String(k));
    shellBar.style.setProperty('--k', String(k));
    syncGainK();
    const barBottom0 = chromeBottom();
    {
      const lead = snap.races.governor ?? snap.races.senate ?? snap.races.president;
      setNote(lead?.sourceAt ?? snap.serverAt);
    }

    lin.classList.toggle('one', true);
    active = Math.max(0, LANES.findIndex(l => l.office === view));
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    const barBottom = barBottom0;
    lin.style.top = `${barBottom + 16 * k}px`;
    lin.style.bottom = `${innerHeight - player.el.getBoundingClientRect().top + 12 * k}px`;
    observe();
    // one time domain for the five panels, so a vertical read means the same instant everywhere
    let a0 = Infinity, a1 = -Infinity;
    for (const l of LANES) {
      const st = storeOf(l.office);
      if (st.stamps.length < 2) continue;                  // a single point is a final result, not a series
      a0 = Math.min(a0, st.stamps[0]); a1 = Math.max(a1, st.stamps[st.stamps.length - 1]);
    }
    if (!Number.isFinite(a0)) { a0 = Date.now() - 3600e3; a1 = Date.now(); }
    const fresh = Date.now() - a1 < 10 * 60e3;             // a finished recording stops where it stopped
    span = { t0: a0, t1: Math.max(a1, fresh && rp.live ? Date.now() : 0, rp.live ? 0 : rp.at, a0 + 60e3) };
    cols.forEach((col, i) => {
      const { l } = col, race: Race | undefined = l.office === 'president' ? presRace() : snap.races[l.office];
      col.row.classList.toggle('on', i === active);
      const legislative = legislativeOf(l.office);
      const tally = race && legislative ? seatsByParty(race, YEAR).reduce((a, p) => a + p.seats, 0) : 0;
      const scopeBox = col.row.querySelector<HTMLElement>('.pscope');
      if (scopeBox) {
        // without the state's own presidential file there is nothing to switch to
        const hasUf = !!snap.presidentUf;
        scopeBox.hidden = !hasUf;
        if (!hasUf && presScope === 'UF') presScope = 'BR';
        scopeBox.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
          const on = (b.dataset.sc === 'UF') === (presScope === 'UF');
          b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
        });
      }
      col.head.innerHTML = `<div class="t">${l.title}</div><div class="s">${l.office === 'president' ? (presScope === 'UF' ? esc(stateName(UF)) : 'Brasil') : esc(stateName(UF))} · <b>${race ? fmtPercent(race.countedPercent, 1) : '—'}</b> apurado${race && legislative ? ` · <b>${tally}</b>/${race.seats} vagas` : ''}${l.office === 'senate' && race ? ` · <b>${contestedSeats(race, 'senate', YEAR)}</b> ${contestedSeats(race, 'senate', YEAR) === 1 ? 'vaga' : 'vagas'}` : ''}</div>${race ? `<span class="mtog">ver tabela</span><span class="mtog ax">${yMode === 'share' ? 'ver em votos' : 'ver em %'}</span>${legislative ? `<span class="mtog sw">${col.showCands ? 'ver por partido' : 'ver por candidato'}</span>` : ''}` : ''}${race && legislative ? `<div class="seats" aria-label="${tally} de ${race.seats} vagas definidas">${(() => { const parties = seatsByParty(race, YEAR).filter(p => p.seats); return Array.from({ length: race.seats }, (_, sIdx) => { let acc = 0; const p = parties.find(t => (acc += t.seats) > sIdx); return `<i style="${p ? `background:${colorOf(p.party)}` : ''}"></i>`; }).join(''); })()}</div>` : ''}`;
      if (scopeBox && !scopeBox.hidden) {
        // The head is centred in its column, so the switch is placed under it once it has content,
        // flush with the heading's own left edge. On the first render the head has not been laid
        // out with its final font yet and the measurement lands on top of the title, so it stays
        // invisible until a measured head puts it somewhere, and is placed again after the frame
        // and after the webfonts swap in.
        const place = () => {
          const hb = col.head.getBoundingClientRect(), rb = col.row.getBoundingClientRect();
          if (hb.height < 1) return;
          scopeBox.style.top = `${hb.bottom - rb.top + 12 * k}px`;
          scopeBox.style.left = `${hb.left - rb.left}px`;
          scopeBox.style.visibility = 'visible';
        };
        if (!scopeBox.style.visibility) scopeBox.style.visibility = 'hidden';
        place();
        requestAnimationFrame(place);
        document.fonts?.ready.then(place);
      }
      if (!race) {
        col.list = [];
        col.marks.forEach(p => p.remove()); col.marks.clear();
        col.meds.forEach(m => m.remove()); col.meds.clear();
        (col.svg.querySelector('.grid') as SVGGElement).innerHTML = '';
        (col.svg.querySelector('.refs') as SVGGElement).innerHTML = '';
        col.geo = null;
        col.row.classList.add('blank');
        col.empty.hidden = false;
        col.empty.textContent = TURN === 2 && l.office !== 'president' && l.office !== 'governor' ? 'Definido no 1º turno'
          : TURN === 2 && l.office === 'governor' && snap.connection.status === 'archive' ? `Sem 2º turno em ${stateName(UF)}`
          : snap.connection.status === 'waiting' && MODE === 'historico' ? 'Carregando os arquivos do TSE…'
          : MODE === 'official' ? 'Aguardando o TSE publicar os resultados' : 'Sem dados para esta disputa';
        return;
      }
      col.row.classList.remove('blank');
      drawChart(col, race, k, mobile);
      // vote arrivals: the leader's medallion pulses and the gain floats above everything
      const ranked = all(race);
      const leader = ranked[0]?.id;
      const overtook = !!leader && lastLeader.has(l.office) && lastLeader.get(l.office) !== leader;
      if (leader) lastLeader.set(l.office, leader);
      if (overtook) overtakes++;
      ranked.slice(0, 8).forEach((c, idx) => {
        const before = lastVotes.get(c.id);
        lastVotes.set(c.id, c.votes);
        const m = col.meds.get(c.id);
        if (before !== undefined && c.votes > before && (!mobile || i === active)) {
          if (m) { m.classList.remove('grew'); void m.offsetWidth; m.classList.add('grew'); }
          if (idx <= 1 && m) {
            const r = m.getBoundingClientRect();
            const gain = el('div', `gain ${overtook && idx === 0 ? 'big' : ''}`, `+${shortVotes(c.votes - before)}`);
            gain.style.left = `${r.right}px`; gain.style.top = `${r.top + 10 * k}px`;
            gainLayer.appendChild(gain); setTimeout(() => gain.remove(), 2300);
          }
          changed = true;
        }
        if (overtook && idx === 0 && m) {
          m.classList.remove('newlead'); void m.offsetWidth; m.classList.add('newlead');
          clearTimeout(Number(m.dataset.leadTimer));
          m.dataset.leadTimer = String(setTimeout(() => m.classList.remove('newlead'), 4600));
        }
      });
    });
    if (overtakes) { if (loud()) chime.overtake(); }
    else if (changed && loud()) chime.votes();
    const status = snap.connection.status;
    badge.textContent = !rp.live ? `REPLAY · ${rp.playing ? `${rp.speed}×` : 'PAUSADO'}` : MODE === 'historico' ? 'RESULTADO FINAL 2022' : MODE === 'simulado' ? (openWindow(SIMULADO_WINDOWS) ? 'SIMULADO TSE' : 'SIMULADO ENCERRADO') : status === 'live' ? '● AO VIVO' : status === 'cooldown' ? 'PAUSA DO TSE' : status === 'degraded' ? 'RECONECTANDO' : 'AGUARDANDO TSE';
    badge.className = `demo badge ${!rp.live ? 'replay' : MODE === 'official' ? (status === 'live' ? 'live' : 'wait') : ''}`;
    badge.title = snap.connection.message;
    const lead = snap.races.governor ?? snap.races.senate ?? snap.races.president;
    const counted = lead?.countedPercent ?? 0;
    const source = MODE === 'historico' ? 'Fonte: TSE · eleições 2022' : snap.connection.status === 'live' ? `Fonte: TSE${MODE === 'simulado' ? ' · simulado 2026' : ''}` : `Fonte: TSE · ${esc(snap.connection.message)}`;
    void source; void counted;
  };

  // A tela não tem barra própria: com os controles prontos, a barra do aplicativo adota
  // them. It takes the .cr-head class so their rules keep applying, and the page's own --k.
  shellBar.classList.add('cr-head');
  // The sound toggle joins the other controls on the right, so what gets centred is the search
  // itself — landing in the same place as on the screens that have no sound button.
  const right = shellBar.querySelector('.sh-right')!;
  const searchBox = bar.querySelector('.search');
  if (searchBox) right.insertAdjacentElement('beforebegin', searchBox);
  for (const sel of ['.sound', '.m-search']) {
    const btn = bar.querySelector(sel);
    if (btn) right.insertAdjacentElement('afterbegin', btn);
  }
  shellBar.querySelector('.sh-view')!.insertAdjacentElement('afterend', tabs);
  // Nothing is left in the view's own bar on either screen.
  bar.remove();
  // The playback bar is the shell's, identical on every screen; it drives this view's replay
  // clock and asks for the snapshot of whichever instant it lands on.
  const player = mountPlayer({
    state: rp,
    render: async at => { snap = await loadSnapshot(at); layout(); },
    reset: () => { lastVotes.clear(); lastLeader.clear(); },
    isPhone: () => app.classList.contains('mobile'),
    // Live and demo refresh every 3 s; the final 2022 archive only until its files have arrived.
    liveEvery: () => (MODE === 'historico' && snap.connection.status === 'archive' && !!snap.presidentUf
      && Object.keys(snap.races).length >= (TURN === 1 ? 5 : 1)) ? 120_000 : 3000,
  });
  addEventListener('resize', layout);
  await loadSeries();
  await player.ready;   // the bar's final height, so the columns are laid out once
  layout();
  pageReady();
  setInterval(() => { void loadSeries().then(layout); }, 15_000);
  setInterval(() => { if (rp.playing && !rp.live) layout(); }, 250);
}

main().catch(e => app.appendChild(el('div', 'bar', `Não foi possível carregar os dados: ${esc(String(e))}`)));
