/*
 * Território — de onde vieram os votos?
 * Mapa municipal do Brasil para a fonte, o estado e o turno escolhidos no app.
 *  - Sem candidatura escolhida: cada município na cor de quem venceu ali; à direita, os mais votados.
 *  - Com candidatura escolhida (lista ou busca): tom = participação dela nos votos válidos de cada município.
 *  - Com cidade escolhida: a lista mostra todas as candidaturas daquela cidade, por votos.
 * Presidente usa todo o Brasil com o estado escolhido em destaque; os demais cargos, o estado.
 * Dados por município chegam do servidor sob demanda (/api/municipal) e são atualizados ao vivo.
 */
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { COLORS, STATES, partyColor, partySlot, type Office, type WireRace as Race, type Snapshot } from '../../../shared/types';
import { MODE, TURN, UF, el, esc, fmtInt, fmtPercent, initials, loadSnapshot, party, photoUrl, shortVotes, stateName, titleCase } from '../../raias/common';
import { mountPlayer } from '../../shell/player';
import { HIT_CSS, hitInner, ROW_CSS, rowInner, seedScale } from '../../shell/row';
import { mountShellBar, mountShellNote, pageReady } from '../../shell/shell';
import { empty, fetchMunicipal, fold, prepare, type CityData, type OfficeData, type Payload } from './data';
import { buildGeography, type Mesh } from './geo';
import { CSS } from './styles';

interface OfficeDef { key: Office; label: string; scope: 'BR' | 'UF'; noun: string; place: string; top: number }
interface Cand { key: string; office: OfficeDef; idx: number; number: string; name: string; party: string; color: string; votes: number; percent: number; status: string; elected: boolean; photo: string | null }

const DISTRITAL = UF === 'DF';
const OFFICES: OfficeDef[] = [
  { key: 'president', label: 'Presidente', scope: 'BR', noun: 'Presidente', place: 'Brasil', top: 5 },
  { key: 'governor', label: 'Governador', scope: 'UF', noun: 'Governador', place: stateName(UF), top: 5 },
  { key: 'senate', label: 'Senado', scope: 'UF', noun: 'Senado', place: stateName(UF), top: 5 },
  { key: 'federal', label: 'Dep. federais', scope: 'UF', noun: 'Deputado federal', place: stateName(UF), top: 10 },
  { key: 'state', label: DISTRITAL ? 'Dep. distritais' : 'Dep. estaduais', scope: 'UF', noun: DISTRITAL ? 'Deputado distrital' : 'Deputado estadual', place: stateName(UF), top: 10 },
];
const hasTurn = (o: OfficeDef) => TURN === 1 || o.key === 'president' || o.key === 'governor';
const LIVE = MODE === 'official' || MODE === 'simulado';
const SOURCE = { historico: '2022', simulado: '2026 · Simulação', official: '2026' }[MODE];
const params = new URLSearchParams(location.search);
const PHOTO_ROWS = 20;
const timings: { what: string; ms: number }[] = [];
(window as unknown as { __territorio: typeof timings }).__territorio = timings;
const timed = <T,>(what: string, fn: () => T): T => { const t0 = performance.now(); const r = fn(); timings.push({ what, ms: Math.round((performance.now() - t0) * 10) / 10 }); return r; };

const pct = (x: number, d = 1) => fmtPercent(x * 100, d);
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Party colour pulled toward grey, so it reads as ink rather than neon. */
function mute(hex: string, amount = .3, light = 0): number[] {
  const [r, g, b] = hexToRgb(hex), grey = (r + g + b) / 3;
  const m = (c: number) => { const v = c + (grey - c) * amount; return Math.round(v + (light > 0 ? (255 - v) * light : v * light)); };
  return [m(r), m(g), m(b)];
}
const rgba = (c: ArrayLike<number>, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(a * 1000) / 1000})`;
const ease = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Slot pairs too close on the dark surface (same list as shared/types' distinctColors). */
const CLASH = new Set(['0-6', '1-3', '1-4', '1-5', '1-7', '2-4', '2-5', '3-7', '4-7']);
const clash = (a: number, b: number) => CLASH.has(a < b ? `${a}-${b}` : `${b}-${a}`);
/**
 * Colours for a map legend: PT red and PL blue stay put; every other party keeps its slot unless it is taken
 * or too close to ANY colour already on the map (not only the previous one), since winners sit side by side.
 */
function mapColors(parties: string[]): string[] {
  const used: number[] = [];
  return parties.map(p => {
    const key = p.toUpperCase().replace(/[^A-Z]/g, '');
    const reserved = key === 'PT' ? 7 : key === 'PL' ? 0 : -1;
    let slot = reserved >= 0 && !used.includes(reserved) ? reserved : -1;
    if (slot < 0) {
      const wanted = partySlot(key), options = [1, 2, 3, 4, 5, 6];
      const start = Math.max(0, options.indexOf(wanted));
      const ring = options.map((_, i) => options[(start + i) % options.length]);
      slot = ring.find(o => !used.includes(o) && used.every(u => !clash(u, o))) ?? ring.find(o => !used.includes(o)) ?? wanted;
    }
    used.push(slot);
    return COLORS[slot];
  });
}

async function main() {
  const app = document.getElementById('app')!;
  const style = document.createElement('style'); style.textContent = ROW_CSS + HIT_CSS + CSS; document.head.appendChild(style);
  seedScale();
  const shellBar = mountShellBar('territorio');
  const setNote = mountShellNote();

  const getJson = <T,>(url: string) => fetch(url).then(r => r.ok ? r.json() as Promise<T> : null).catch(() => null);
  const [snapInit, meshMun] = await Promise.all([loadSnapshot().catch(() => null), getJson<Mesh>('/data/territorio/br-municipios.json')]);
  if (!meshMun) { app.innerHTML = '<div class="note">Malha municipal indisponível.</div>'; return; }
  let snap: Snapshot | null = snapInit;
  let player: ReturnType<typeof mountPlayer> | null = null;
  const geo = timed('malha', () => buildGeography(meshMun));
  const ufId = STATES.find(s => s.uf === UF)!.id;
  const ufGeo = geo.states.get(ufId)!;
  const others = new Path2D();
  for (const [id, s] of geo.states) if (id !== ufId) others.addPath(s.outline);
  const munList = geo.list, N = munList.length;

  // --- DOM ----------------------------------------------------------------------------------
  const stage = el('div', 'stage');
  const cBase = el('canvas'), cLines = el('canvas'), cTop = el('canvas');
  // Software-backed contexts composite far more cheaply on machines without GPU raster.
  for (const c of [cBase, cLines, cTop]) c.getContext('2d', { willReadFrequently: true });
  const legend = el('div', 'legend');
  const progress = el('div', 'progress'); progress.hidden = true;
  const pending = el('div', 'pending'); pending.hidden = true;
  stage.append(cBase, cLines, el('div', 'shade'), cTop, legend, progress, pending);
  const tabs = el('div', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Cargo');
  const rank = el('section', 'rank'); rank.setAttribute('aria-label', 'Mais votados');
  const find = el('div', 'find', `<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" placeholder="Buscar cidade ou candidato" aria-label="Buscar cidade ou candidato" autocomplete="off" spellcheck="false"><div class="sugg" hidden></div></div>`);
  app.append(stage, rank);
  shellBar.classList.add('cr-head');
  shellBar.querySelector('.sh-view')!.insertAdjacentElement('afterend', tabs);
  shellBar.querySelector('.sh-right')!.insertAdjacentElement('beforebegin', find);
  const tip = el('div', 'tip'); tip.hidden = true; document.body.appendChild(tip);
  const pin = el('div', 'tip pin'); pin.hidden = true; pin.setAttribute('role', 'dialog'); document.body.appendChild(pin);
  let pinTimer = 0;
  const input = find.querySelector<HTMLInputElement>('input')!, sugg = find.querySelector<HTMLElement>('.sugg')!;

  // --- candidates (snapshot race first, municipal names as fallback) --------------------------
  const raceOf = (o: OfficeDef): Race | undefined => snap?.races[o.key];
  let raceIndex = new Map<string, Map<string, Race['candidates'][number]>>();
  const raceCand = (o: OfficeDef, number: string) => {
    let m = raceIndex.get(o.key);
    if (!m) { m = new Map((raceOf(o)?.candidates || []).map(c => [c.number, c])); raceIndex.set(o.key, m); }
    return m.get(number);
  };
  const loaded = new Map<Office, OfficeData>();
  let candCache = new Map<string, Cand>();
  /**
   * Colours for the office's leading candidacies, made distinct among themselves (PT red and PL blue stay put):
   * on the winner map two leaders must never share a hue, even when their parties hash to neighbouring slots.
   */
  const paletteCache = new Map<Office, Map<string, string>>();
  function palette(o: OfficeDef): Map<string, string> {
    let p = paletteCache.get(o.key);
    if (!p) {
      const d = loaded.get(o.key)!;
      const lead = [...new Set([...[...d.wins].sort((a, b) => b[1] - a[1]).map(([i]) => i), ...d.nums.map((_, i) => i)])].slice(0, 8);
      const partyOf = (i: number) => party(raceCand(o, d.nums[i])?.party || d.names.get(d.nums[i])?.[1] || '');
      // Reserved colours (PT, PL) first, so the next leader is checked against them and moves off a clashing hue.
      lead.sort((a, b) => Number(['PT', 'PL'].includes(partyOf(b))) - Number(['PT', 'PL'].includes(partyOf(a))));
      const parties = lead.map(partyOf);
      const colors = mapColors(parties);
      p = new Map(lead.map((i, j) => [d.nums[i], colors[j]]));
      paletteCache.set(o.key, p);
    }
    return p;
  }
  function candAt(o: OfficeDef, idx: number): Cand {
    const d = loaded.get(o.key)!, number = d.nums[idx], key = `${o.key}-${number}`;
    let c = candCache.get(key);
    if (!c || c.idx !== idx) {
      const rc = raceCand(o, number), race = raceOf(o), nm = d.names.get(number);
      const sum = d.cities.reduce((s, x) => s + x.vv, 0) || 1;
      const partyName = party(rc?.party || nm?.[1] || '');
      c = {
        key, office: o, idx, number, name: titleCase(rc?.name || nm?.[0] || `Nº ${number}`), party: partyName,
        color: palette(o).get(number) || rc?.color || (partyName ? partyColor(partyName) : '#8a8a86'), votes: rc?.votes ?? d.totals[idx], percent: rc?.percent ?? (d.totals[idx] / sum) * 100,
        status: rc?.status || '', elected: !!rc?.elected, photo: rc && race ? photoUrl(race, rc.id) : null,
      };
      candCache.set(key, c);
    }
    return c;
  }
  const photoHtml = (c: Cand, withPhoto: boolean) => `${esc(initials(c.name))}${withPhoto && c.photo ? `<img src="${c.photo}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`;

  // --- state --------------------------------------------------------------------------------
  let W = 0, H = 0, k = 1, dpr = 1, mobile = false;
  let office = OFFICES.find(o => o.key === params.get('cargo')) || OFFICES[1];
  let data: OfficeData = empty(office.key, 'loading', 'Carregando.');
  let sel: Cand | null = null, pendingSel = params.get('c')?.replace(/^[a-z]+-/, '') || null;
  let selMap = new Map<string, { votes: number; rank: number; share: number }>();
  let selTotal = 0, selN50 = 0;
  let city: string | null = null, pendingCity = params.get('city');
  let hover: string | null = null;
  const fromC = new Float32Array(N * 4), toC = new Float32Array(N * 4);
  let styles: (string | null)[] = new Array(N).fill(null);
  let toneT0 = -1e9, lo = 0, hi = 1;
  const TONE_MS = 700, ZOOM_MS = 1100;
  type View = { cx: number; cy: number; s: number };
  let view: View = { cx: 0, cy: 0, s: 1 }, vFrom = view, vTo = view, zoomT0 = -1e9;
  let scopeW = 1, scopeFrom = 1, scopeTo = 1; // 1 = all of Brazil lit, 0 = only the selected state
  let box = { l: 0, t: 0, r: 0, b: 0 };
  let dirtyBase = true, dirtyTop = true, lastView = '';

  // --- colours --------------------------------------------------------------------------------
  const winColor = (idx: number) => mute(candAt(office, idx).color, .32, .02);

  function retarget(instant: boolean) {
    const now = performance.now(), t = instant ? 1 : ease((now - toneT0) / TONE_MS);
    for (let i = 0; i < N * 4; i++) fromC[i] = lerp(fromC[i], toC[i], t);
    let winLo = 0, winHi = 1;
    if (!sel) {
      const shares = data.cities.filter(c => c.vv && c.pairs.length).map(c => c.pairs[1] / c.vv).sort((a, b) => a - b);
      winLo = shares[Math.floor(shares.length * .05)] || 0; winHi = Math.max(winLo + .02, shares[Math.floor(shares.length * .95)] || 1);
    } else {
      const locals = data.cities.filter(c => c.vv).map(c => selMap.get(c.cdi)?.share || 0).sort((a, b) => a - b);
      lo = locals[Math.floor(locals.length * .03)] || 0; hi = Math.max(lo + .01, locals[Math.floor(locals.length * .97)] || 1);
    }
    const selCol = sel ? mute(sel.color, .3, .12) : null;
    const winCols = new Map<number, number[]>();
    munList.forEach((m, i) => {
      const c = data.byCdi.get(m.cdi), o = i * 4;
      let rgb: number[] = [toC[o], toC[o + 1], toC[o + 2]], a = 0;
      if (c) {
        if (sel) {
          const share = selMap.get(m.cdi)?.share || 0;
          rgb = selCol!; a = share <= 0 ? .025 : .08 + .74 * Math.pow(Math.max(0, Math.min(1, (share - lo) / (hi - lo))), .85);
        } else if (c.pairs.length && c.vv) {
          let col = winCols.get(c.pairs[0]); if (!col) { col = winColor(c.pairs[0]); winCols.set(c.pairs[0], col); }
          rgb = col; a = .3 + .55 * Math.max(0, Math.min(1, (c.pairs[1] / c.vv - winLo) / (winHi - winLo)));
        } else {
          // Already received from the TSE but with no votes published yet: neutral tone, so the map
          // shows the same progress as the counter instead of looking empty.
          rgb = [112, 112, 107]; a = .22;
        }
      }
      if (fromC[o + 3] < .01) { fromC[o] = rgb[0]; fromC[o + 1] = rgb[1]; fromC[o + 2] = rgb[2]; }
      toC[o] = rgb[0]; toC[o + 1] = rgb[1]; toC[o + 2] = rgb[2]; toC[o + 3] = a;
    });
    if (instant) fromC.set(toC);
    styles = new Array(N).fill(null);
    toneT0 = instant ? -1e9 : now;
    dirtyBase = true;
  }

  // --- layout / view ------------------------------------------------------------------------
  function fit(bb: number[], pad = 1): View {
    const bw = box.r - box.l, bh = box.b - box.t;
    const w = Math.max(bb[2] - bb[0], .05), h = Math.max(bb[3] - bb[1], .05);
    return { cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2, s: Math.min(bw / w, bh / h) * pad };
  }
  const scopeView = () => office.scope === 'UF' ? fit(ufGeo.bb, UF === 'DF' ? .7 : .97) : fit(geo.bbBR, .99);
  function cityView(cdi: string): View {
    const m = geo.muns.get(cdi)!, sv = scopeView();
    const span = office.scope === 'UF' ? 5 : 13; // degrees of context around the city
    return { cx: m.X, cy: m.Y, s: Math.max(sv.s * 1.2, Math.min(box.r - box.l, box.b - box.t) / span) };
  }
  function currentView(now: number): View {
    const t = ease((now - zoomT0) / ZOOM_MS);
    if (t >= 1) return vTo;
    const s = Math.exp(lerp(Math.log(vFrom.s), Math.log(vTo.s), t));
    const f = Math.abs(vFrom.s - vTo.s) < 1e-6 ? t : (1 / s - 1 / vFrom.s) / (1 / vTo.s - 1 / vFrom.s);
    return { cx: lerp(vFrom.cx, vTo.cx, f), cy: lerp(vFrom.cy, vTo.cy, f), s };
  }
  function setView(v: View, instant = false) {
    vFrom = instant ? v : currentView(performance.now()); vTo = v; zoomT0 = instant ? -1e9 : performance.now();
    if (instant) view = v;
    dirtyBase = true;
  }
  const mx = () => (box.l + box.r) / 2, my = () => (box.t + box.b) / 2;

  function layout() {
    W = stage.clientWidth; H = stage.clientHeight; mobile = innerWidth <= 900;
    k = mobile ? .5 : Math.min(innerWidth / 3440, innerHeight / 1440);
    for (const e of [app, tip, pin, shellBar]) e.style.setProperty('--k', String(k));
    dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [cBase, cLines, cTop]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    box = mobile ? { l: 12, t: 58, r: W - 12, b: H - 44 } : { l: 560 * k, t: 110 * k, r: W - 1060 * k, b: H - 60 * k };
    pending.style.left = `${mx()}px`;
    progress.style.left = `${mx()}px`; progress.style.top = mobile ? '58px' : `${40 * k}px`;
    setView(city ? cityView(city) : scopeView(), true);
  }

  // --- selection ----------------------------------------------------------------------------
  function buildSel(c: Cand) {
    timed('mapa da candidatura', () => {
      const map = new Map<string, { votes: number; rank: number; share: number }>();
      let total = 0;
      const list: number[] = [];
      for (const ct of data.cities) {
        const p = ct.pairs;
        for (let j = 0; j < p.length; j += 2) if (p[j] === c.idx) { const v = p[j + 1]; map.set(ct.cdi, { votes: v, rank: j / 2 + 1, share: ct.vv ? v / ct.vv : 0 }); total += v; list.push(v); break; }
      }
      list.sort((a, b) => b - a);
      let cum = 0, n = 0;
      for (const v of list) { cum += v; n++; if (cum >= total / 2) break; }
      selMap = map; selTotal = total; selN50 = n;
    });
  }

  function selectCand(c: Cand | null) {
    sel = c; pendingSel = null;
    if (c) buildSel(c); else selMap = new Map();
    retarget(false);
    render();
  }

  /** New municipal data for the current office: keeps the selected candidate and city. */
  function apply(next: OfficeData, instant: boolean) {
    const selNumber = sel?.number ?? pendingSel;
    loaded.set(next.office, next);
    if (next.office !== office.key) return;
    data = next; candCache = new Map(); paletteCache.delete(next.office);
    sel = null;
    if (selNumber) {
      const idx = data.nums.indexOf(selNumber);
      if (idx >= 0) { sel = candAt(office, idx); buildSel(sel); pendingSel = null; } else pendingSel = selNumber;
    }
    if (pendingCity && data.byCdi.has(pendingCity)) {
      city = pendingCity; pendingCity = null;
      setView(cityView(city), instant);
      pinTimer = window.setTimeout(() => showPin(city!), instant ? 300 : ZOOM_MS + 40);
    }
    if (city && !data.byCdi.has(city) && data.status === 'ready') { city = null; pin.hidden = true; }
    retarget(instant);
    render(true);
  }

  // --- data loading and live refresh ---------------------------------------------------------
  let pollTimer = 0, pollGen = 0;
  async function poll(o: OfficeDef, gen: number) {
    const current = loaded.get(o.key);
    const res = await fetchMunicipal(o.key, current && current.version >= 0 ? current.version : undefined);
    if (gen !== pollGen) return;
    if (res && 'unchanged' in res) {
      if (current) { current.status = res.status; current.message = res.message; current.loaded = res.loaded; current.total = res.total; renderStatus(); }
    } else if (res) {
      const next = timed(`preparar ${o.key}`, () => prepare(res as Payload));
      const first = !current || current.version < 0 || !current.cities.length;
      apply(next, first);
      indexDirty = true;
    } else if (!current) {
      apply(empty(o.key, 'waiting', 'Não foi possível falar com o servidor. Nova tentativa em instantes.'), true);
    }
    const d = loaded.get(o.key);
    if (d?.status === 'ready') prefetchOthers();
    // Loading: short polls so the map fills in. Live sources: a slow refresh. The 2022 archive is final.
    const delay = !d || d.status !== 'ready' ? 2500 : LIVE ? 30_000 : 0;
    if (delay && d?.status !== 'unavailable') pollTimer = window.setTimeout(() => void poll(o, gen), delay);
  }

  /*
   * The first click on a tab used to wait for its download — up to 440 KB compressed for a
   * chamber. Once the tab on screen is complete, the others are fetched one by one while the page
   * is idle and kept in `loaded`, so every tab opens already drawn. Only finished builds are kept:
   * a half-collected office would be shown as if it were the whole state.
   */
  let prefetched = false;
  function prefetchOthers() {
    if (prefetched) return;
    prefetched = true;
    const queue = OFFICES.filter(o => o.key !== office.key && hasTurn(o) && !loaded.has(o.key));
    const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 400));
    const next = () => {
      const o = queue.shift();
      if (!o) return;
      idle(async () => {
        if (!loaded.has(o.key)) {
          const res = await fetchMunicipal(o.key);
          if (res && !('unchanged' in res) && res.status === 'ready' && !loaded.has(o.key)) apply(prepare(res), true);
        }
        next();
      });
    };
    next();
  }

  async function setOffice(o: OfficeDef, instant = false) {
    clearTimeout(pollTimer); const gen = ++pollGen;
    const prevScope = office.scope;
    office = o; sel = null; selMap = new Map();
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.o === o.key));
    scopeFrom = instant ? (o.scope === 'BR' ? 1 : 0) : scopeW; scopeTo = o.scope === 'BR' ? 1 : 0;
    if (!hasTurn(o)) {
      apply(empty(o.key, 'unavailable', 'Sem 2º turno para este cargo.'), instant);
    } else {
      const cached = loaded.get(o.key);
      if (cached) apply(cached, instant);
      else {
        data = empty(o.key, 'loading', 'Carregando os municípios.'); retarget(instant); render();
        tabs.querySelector(`[data-o="${o.key}"]`)?.classList.add('loading');
      }
      // a finished 2022 office is final: asking the server whether it changed is a request for nothing
      if (!(cached && !LIVE && cached.status === 'ready')) await poll(o, gen);
      tabs.querySelector(`[data-o="${o.key}"]`)?.classList.remove('loading');
    }
    if (prevScope !== o.scope || instant) setView(city ? cityView(city) : scopeView(), instant);
  }

  /** Candidate names, colours, photos and status come with the app snapshot; refreshed with the source. */
  async function refreshSnapshot() {
    if (player?.rp.live === false) { setTimeout(() => void refreshSnapshot(), 4000); return; }
    try {
      const next = await loadSnapshot();
      const changed = !snap || Object.keys(next.races).join() !== Object.keys(snap.races).join() || JSON.stringify(Object.values(next.races).map(r => r?.generationId)) !== JSON.stringify(Object.values(snap.races).map(r => r?.generationId));
      snap = next;
      if (changed) { raceIndex = new Map(); candCache = new Map(); paletteCache.clear(); if (sel) sel = candAt(office, sel.idx); indexDirty = true; render(true); }
    } catch { /* keep the last snapshot */ }
    const complete = snap && OFFICES.filter(hasTurn).every(o => snap!.races[o.key]);
    if (LIVE || !complete) setTimeout(() => void refreshSnapshot(), LIVE ? 15_000 : 4000);
  }

  // --- rendering ------------------------------------------------------------------------------
  function render(keepScroll = false) {
    const list = rank.querySelector<HTMLElement>('.list');
    const scroll = keepScroll && list ? list.scrollTop : 0;
    timed('lista', () => { renderTabs(); renderRank(); renderLegend(); renderStatus(); syncUrl(); });
    const nl = rank.querySelector<HTMLElement>('.list'); if (nl && scroll) nl.scrollTop = scroll;
    if (city && !pin.hidden) showPin(city);
    dirtyTop = true;
  }

  function renderStatus() {
    const lead = snap?.races.governor ?? snap?.races.senate ?? snap?.races.president;
    setNote(lead?.sourceAt ?? snap?.serverAt ?? null);
    const where = office.scope === 'BR' ? 'Brasil' : stateName(UF);
    if (data.status === 'loading' || (data.status === 'paused' && data.cities.length)) {
      progress.hidden = false;
      progress.innerHTML = data.total
        ? `<span>Carregando municípios · ${esc(where)} · <b>${fmtInt(data.loaded)}</b> de ${fmtInt(data.total)}</span><i><span style="width:${(data.loaded / data.total) * 100}%"></span></i>`
        : `<span>${esc(data.message || 'Buscando a lista de municípios.')}</span>`;
    } else progress.hidden = true;
    const blocking = !data.cities.length && data.status !== 'loading';
    pending.hidden = !blocking;
    if (blocking) pending.innerHTML = `<b>${esc(data.status === 'unavailable' ? data.message : data.status === 'paused' ? 'Consultas pausadas' : 'Aguardando os resultados por município')}</b>${data.status === 'unavailable' ? '' : `<span>${esc(data.message)}</span>`}`;
    tabs.querySelectorAll<HTMLElement>('button').forEach(b => { const o = OFFICES.find(x => x.key === b.dataset.o)!; b.classList.toggle('off', !hasTurn(o)); });
  }

  function syncUrl() {
    const u = new URL(location.href);
    u.searchParams.set('cargo', office.key);
    if (sel) u.searchParams.set('c', sel.key); else if (!pendingSel) u.searchParams.delete('c');
    if (city) u.searchParams.set('city', city); else if (!pendingCity) u.searchParams.delete('city');
    history.replaceState(null, '', u);
  }

  function renderTabs() {
    if (tabs.childElementCount) return;
    tabs.innerHTML = OFFICES.map(o => `<button role="tab" data-o="${o.key}" class="${o.key === office.key ? 'on' : ''}" aria-selected="${o.key === office.key}" ${hasTurn(o) ? '' : 'title="Sem 2º turno para este cargo"'}>${o.label}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => {
      const o = OFFICES.find(x => x.key === b.dataset.o)!;
      tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      if (o.key !== office.key) void setOffice(o);
    }));
  }

  type Item = { c: Cand; votes: number; share: number; place: number; tag: string; tagCls: string };
  function statusTag(c: Cand): [string, string] {
    if (c.elected) return ['Eleito', 'el'];
    if (/2º turno/i.test(c.status)) return ['2º turno', 'rn'];
    return ['', ''];
  }
  function rowHtml(x: Item, i: number, kind: 'big' | '' | 'sm', maxShare: number, fact = '') {
    void kind;   // every line has the same weight now
    const on = sel?.key === x.c.key;
    const color = rgba(mute(x.c.color, .25, .12), 1);
    return `<li><button class="row crow ${on ? 'on' : ''}" data-i="${x.c.idx}" aria-pressed="${on}"`
      + ` title="${on ? 'Clique de novo para ver os vencedores por cidade' : 'Pintar o mapa com os votos desta candidatura'}"`
      + ` style="--c:${color}">${rowInner({
        place: x.place, name: x.c.name, party: x.c.party,
        votes: shortVotes(x.votes), share: pct(x.share),
        fill: maxShare > 0 ? x.share / maxShare : 0, color,
        photo: photoHtml(x.c, i < PHOTO_ROWS || on),
        tag: x.tag, tagClass: x.tagCls, extra: fact,
      })}</button></li>`;
  }

  function renderRank() {
    const o = office, c = city ? data.byCdi.get(city) : null;
    const gen = String(Number(rank.dataset.gen || 0) + 1); rank.dataset.gen = gen;
    const listEl = () => rank.querySelector<HTMLElement>('.list')!;
    const clearSel = sel ? `<button class="chip clear-sel"><b>×</b> Ver vencedores por cidade</button>` : '';
    let body = '', head = '', rest: (() => void) | null = null;
    if (!data.cities.length) {
      head = `<div><div class="eyebrow">Mais votados · ${esc(o.noun)}</div><h2>${esc(o.place)}</h2></div>`;
      const msg = !hasTurn(o) ? 'Sem 2º turno para este cargo.' : data.status === 'loading' ? 'Os municípios estão chegando.' : data.message;
      body = `<li class="empty"><b>${esc(!hasTurn(o) ? 'Só presidente e governador têm 2º turno' : data.status === 'loading' ? 'Carregando' : 'Sem resultados por município')}</b>${esc(msg)}</li>`;
    } else if (c) {
      const items: Item[] = [];
      for (let j = 0; j < c.pairs.length; j += 2) {
        const cc = candAt(o, c.pairs[j]), v = c.pairs[j + 1];
        items.push({ c: cc, votes: v, share: c.vv ? v / c.vv : 0, place: j / 2 + 1, tag: j === 0 ? 'Venceu aqui' : '', tagCls: j === 0 ? 'win' : '' });
      }
      const max = items[0]?.share || 1;
      const kind = (i: number) => (i < 5 ? '' : 'sm') as '' | 'sm';
      const selPos = sel ? items.findIndex(x => x.c.key === sel!.key) : -1;
      const first = Math.max(60, selPos + 10);
      body = items.slice(0, first).map((x, i) => rowHtml(x, i, kind(i), max)).join('');
      // Long city lists: first rows now, the rest appended in chunks so a click never blocks.
      rest = () => { let i = first; const step = () => { if (i >= items.length || rank.dataset.gen !== gen) return; listEl().insertAdjacentHTML('beforeend', items.slice(i, i + 150).map((x, j) => rowHtml(x, i + j, kind(i + j), max)).join('')); i += 150; setTimeout(step, 16); }; setTimeout(step, 50); };
      head = `<div><div class="eyebrow">${esc(o.noun)} · ${fmtInt(items.length)} candidaturas com votos</div><h2>${esc(c.name)}<small>${esc(c.uf)}</small></h2><div class="sub">${fmtInt(c.vv)} votos válidos</div></div><div class="acts">${clearSel}<button class="chip back">← ${esc(o.place)}</button></div>`;
    } else {
      const items: Item[] = [];
      for (let i = 0; i < Math.min(o.top, data.nums.length); i++) {
        const cc = candAt(o, i), [tag, cls] = statusTag(cc);
        items.push({ c: cc, votes: cc.votes, share: cc.percent / 100, place: i + 1, tag, tagCls: cls });
      }
      const max = Math.max(...items.map(x => x.share), .0001);
      const kind = (i: number) => (o.top <= 5 ? (i < 2 ? 'big' : '') : (i < 5 ? '' : 'sm')) as 'big' | '' | 'sm';
      const fact = (x: Item) => sel?.key === x.c.key ? `<span class="crow-fact">Metade dos votos veio de <strong>${selN50 === 1 ? '1 município' : `${fmtInt(selN50)} municípios`}</strong></span>` : '';
      body = items.map((x, i) => rowHtml(x, i, kind(i), max, fact(x))).join('');
      if (sel && sel.idx >= o.top) {
        const [tag, cls] = statusTag(sel);
        const x: Item = { c: sel, votes: sel.votes, share: sel.percent / 100, place: sel.idx + 1, tag, tagCls: cls };
        body += `<li class="sep">Selecionado</li>${rowHtml(x, 0, '', max, fact(x))}`;
      }
      const lead = snap?.races[o.key];
      const sub = [
        lead ? `${fmtPercent(lead.countedPercent, 1)} apurado` : '',
        LIVE && data.sourceAt ? `atualizado às ${new Date(data.sourceAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : '',
      ].filter(Boolean).join(' · ');
      head = `<div><div class="eyebrow">Mais votados · ${esc(o.noun)}</div><h2>${esc(o.place)}</h2>`
        + `${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="acts">${clearSel}</div>`;
    }
    const foot = !data.cities.length ? '' : sel
      ? `Clique de novo no nome para voltar ao mapa de vencedores`
      : `Clique num nome para ver onde essa candidatura foi forte`;
    // `long` turns on content-visibility for the hundreds of rows a city can have. The state
    // ranking is a handful and must stay measurable: skipped content reports its intrinsic size,
    // so scrollHeight would come back equal to clientHeight and nothing would ever be trimmed.
    rank.innerHTML = `<div class="head">${head}</div><ol class="list${c ? ' long' : ''}">${body}</ol>${foot ? `<div class="foot">${foot}</div>` : ''}`;
    const listNode = listEl();
    listNode.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.row'); if (!b) return;
      const idx = Number(b.dataset.i);
      if (sel && sel.idx === idx) selectCand(null); else selectCand(candAt(office, idx));
    });
    rank.querySelector('.back')?.addEventListener('click', () => clearCity());
    rank.querySelector('.clear-sel')?.addEventListener('click', () => selectCand(null));
    const on = listNode.querySelector<HTMLElement>('.row.on');
    if (on && c) on.scrollIntoView({ block: 'nearest' });
    // The ranking of a state shows as many places as the panel has room for and stops there: a
    // scrollbar in a list whose order is the whole point reads as a page that was cut off. The
    // list of a single city keeps its scroll — there it is the full count, not a top N.
    if (!c && data.cities.length) trimToFit(listNode);
    rest?.();
  }

  /** Drops trailing rows until the list fits. Anything after the "Selecionado" divider stays. */
  function trimToFit(list: HTMLElement) {
    const sep = list.querySelector('.sep');
    let i = (sep ? [...list.children].indexOf(sep) : list.children.length) - 1;
    while (i > 0 && list.scrollHeight > list.clientHeight + 1) { list.children[i].remove(); i--; }
  }

  function renderLegend() {
    const src = `<div class="src">Fonte: TSE, resultados por município · malha municipal do IBGE</div>`;
    if (!data.cities.length) { legend.innerHTML = src; return; }
    if (!sel) {
      const top = [...data.wins].sort((a, b) => b[1] - a[1]);
      const shown = top.slice(0, 6), rest = top.slice(6).reduce((a, [, n]) => a + n, 0);
      const noVotes = data.cities.filter(c => !c.vv || !c.pairs.length).length;
      legend.innerHTML = `<div><em>Quem venceu em cada município · tom mais forte = vitória mais folgada</em><div class="wins">${shown.map(([idx, n]) => `<span><i style="background:${rgba(winColor(idx), .85)}"></i>${esc(candAt(office, idx).name)} <b>${fmtInt(n)}</b></span>`).join('')}${rest ? `<span><i style="background:rgba(110,110,106,.6)"></i>Outros <b>${fmtInt(rest)}</b></span>` : ''}${noVotes ? `<span><i style="background:rgba(104,104,100,.45)"></i>Sem votos ainda <b>${fmtInt(noVotes)}</b></span>` : ''}</div></div>${src}`;
      return;
    }
    const col = mute(sel.color, .3, .12);
    legend.innerHTML = `<div><em>${esc(sel.name)} · participação nos votos válidos do município</em><i style="background:linear-gradient(90deg, ${rgba(col, .08)}, ${rgba(col, .8)})"></i><div class="ends"><span>${pct(lo, lo < .1 ? 1 : 0)}</span><span>${pct(hi, hi < .1 ? 1 : 0)}</span></div></div>${src}`;
  }

  function pickCity(cdi: string) {
    city = cdi; pendingCity = null; input.value = ''; sugg.hidden = true; setView(cityView(cdi)); dirtyTop = true; renderRank(); syncUrl();
    pin.hidden = true; clearTimeout(pinTimer);
    pinTimer = window.setTimeout(() => showPin(cdi), ZOOM_MS + 40);
  }
  function clearCity() { city = null; pin.hidden = true; clearTimeout(pinTimer); setView(scopeView()); dirtyTop = true; renderRank(); syncUrl(); }
  /** City card (hover and pinned): name, one line of votes · %, and the position as a chip in the party colour. */
  function cityCardHtml(cdi: string) {
    const c = data.byCdi.get(cdi); if (!c) return '';
    let votes = 0, place = 0, color = '#8a8a86';
    if (sel) { const s = selMap.get(cdi); votes = s?.votes || 0; place = s?.rank || 0; color = sel.color; }
    else if (c.pairs.length) { votes = c.pairs[1]; place = 1; color = candAt(office, c.pairs[0]).color; }
    const bg = mute(color, .25, .04), lum = (bg[0] * .299 + bg[1] * .587 + bg[2] * .114) / 255;
    const chip = `<span class="chip" style="background:${rgba(bg, 1)};color:${lum > .6 ? '#141614' : '#fbfaf6'}">${place ? `${place}º` : '—'}</span>`;
    return `<div class="t"><div class="n">${esc(c.name)}<small>${esc(c.uf)}</small></div>${chip}</div><div class="v"><b>${fmtInt(votes)}</b> ${votes === 1 ? 'voto' : 'votos'} · ${pct(c.vv ? votes / c.vv : 0)}</div>${LIVE && c.ht ? `<div class="d">atualizado às ${esc(c.ht.slice(0, 5))}</div>` : ''}`;
  }
  function showPin(cdi: string) {
    if (city !== cdi || !data.byCdi.has(cdi)) { pin.hidden = true; return; }
    pin.innerHTML = `<button class="x" aria-label="Fechar">×</button>${cityCardHtml(cdi)}`;
    pin.querySelector('.x')!.addEventListener('click', () => clearCity());
    pin.hidden = false;
    const rect = cTop.getBoundingClientRect(), gap = 26 * (mobile ? .6 : k);
    const x = rect.left + mx(), y = rect.top + my();
    const tw = pin.offsetWidth, th = pin.offsetHeight;
    pin.style.left = `${Math.min(innerWidth - tw - 12, Math.max(12, x - tw / 2))}px`;
    pin.style.top = `${Math.max(8, y - th - gap < 8 ? y + gap : y - th - gap) + (mobile ? scrollY : 0)}px`;
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && !pin.hidden && document.activeElement !== input) clearCity(); });

  // --- search ---------------------------------------------------------------------------------
  type Hit = { kind: 'city'; c: CityData } | { kind: 'cand'; o: OfficeDef; number: string; name: string; party: string; votes: number };
  let indexDirty = true;
  let candIndex: { o: OfficeDef; number: string; name: string; party: string; votes: number; f: string }[] = [];
  function buildIndex() {
    const seen = new Set<string>();
    candIndex = [];
    for (const o of OFFICES.filter(hasTurn)) {
      for (const c of raceOf(o)?.candidates || []) if (c.votes > 0) { seen.add(`${o.key}-${c.number}`); candIndex.push({ o, number: c.number, name: titleCase(c.name), party: party(c.party), votes: c.votes, f: fold(c.name) }); }
      const d = loaded.get(o.key);
      if (d) d.nums.forEach((number, i) => {
        if (seen.has(`${o.key}-${number}`)) return;
        const nm = d.names.get(number); if (!nm) return;
        candIndex.push({ o, number, name: titleCase(nm[0]), party: party(nm[1]), votes: d.totals[i], f: fold(nm[0]) });
      });
    }
    indexDirty = false;
  }
  let hits: Hit[] = [], active = 0;
  async function pickHit(h: Hit) {
    input.value = ''; sugg.hidden = true;
    if (h.kind === 'city') { pickCity(h.c.cdi); return; }
    if (h.o.key !== office.key) { pendingSel = h.number; await setOffice(h.o); if (!pendingSel) return; }
    const idx = data.nums.indexOf(h.number);
    if (idx >= 0) selectCand(candAt(office, idx)); else { pendingSel = h.number; render(); }
  }
  function runSearch() {
    const q = fold(input.value);
    if (!q) { sugg.hidden = true; return; }
    if (indexDirty) buildIndex();
    const where = (f: string) => { const i = f.indexOf(q); return i < 0 ? -1 : i === 0 ? 0 : f[i - 1] === ' ' ? 1 : 2; };
    const cands: { h: Hit; w: number; v: number }[] = [];
    for (const c of candIndex) { const w = where(c.f); if (w >= 0) cands.push({ h: { kind: 'cand', ...c }, w, v: c.votes }); }
    cands.sort((a, b) => a.w - b.w || b.v - a.v);
    const cities: { h: Hit; w: number; v: number }[] = [];
    for (const c of data.cities) { const w = where(c.f); if (w >= 0) cities.push({ h: { kind: 'city', c }, w, v: c.vv }); }
    cities.sort((a, b) => a.w - b.w || b.v - a.v);
    const nc = Math.min(cands.length, cities.length ? 4 : 8);
    hits = [...cands.slice(0, nc), ...cities.slice(0, 8 - nc)].map(x => x.h); active = 0;
    const mark = (name: string) => { const f = fold(name), i = f.indexOf(q); return i < 0 || f.length !== name.length ? esc(name) : `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`; };
    sugg.innerHTML = hits.length ? hits.map((h, i) => h.kind === 'city'
      ? `<button class="sres ${i === active ? 'on' : ''}" data-i="${i}">${hitInner({
          name: mark(h.c.name), meta: 'Município', value: esc(h.c.uf) })}</button>`
      : `<button class="sres ${i === active ? 'on' : ''}" data-i="${i}">${hitInner({
          photo: esc(initials(h.name)), name: mark(h.name),
          meta: `${esc(h.party)} · ${esc(h.o.label)}`, value: shortVotes(h.votes) })}</button>`).join('')
      : `<div class="sres-none">Nenhuma cidade ou candidatura encontrada.</div>`;
    sugg.hidden = false;
  }
  sugg.addEventListener('mousedown', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return; e.preventDefault(); void pickHit(hits[Number(b.dataset.i)]); });
  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length); sugg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === active)); }
    if (e.key === 'Enter' && hits[active] && !sugg.hidden) void pickHit(hits[active]);
    if (e.key === 'Escape') { if (!sugg.hidden) sugg.hidden = true; else if (city) clearCity(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 120));
  addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); } });

  // --- drawing ----------------------------------------------------------------------------------
  const T = (g: CanvasRenderingContext2D) => g.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (mx() - view.cx * view.s), dpr * (my() - view.cy * view.s));
  let baseSettled = false;
  function drawBase(now: number) {
    const g = cBase.getContext('2d')!;
    const tt = ease((now - toneT0) / TONE_MS);
    scopeW = lerp(scopeFrom, scopeTo, ease((now - toneT0) / ZOOM_MS));
    const s = view.s, u = mobile ? .5 : k;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cBase.width, cBase.height);
    g.save(); T(g);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 36 * u * dpr; g.shadowOffsetY = 10 * u * dpr;
    g.fillStyle = '#121513'; g.fill(geo.country);
    g.restore(); T(g);
    const x0 = view.cx - mx() / s, x1 = view.cx + (W - mx()) / s, y0 = view.cy - my() / s, y1 = view.cy + (H - my()) / s;
    const settled = tt >= 1;
    // On slow machines a frame can land after the animation window: keep drawing until a settled frame is on screen.
    baseSettled = settled && ease((now - toneT0) / ZOOM_MS) >= 1;
    for (let i = 0; i < N; i++) {
      const m = munList[i];
      if (m.bb[2] < x0 || m.bb[0] > x1 || m.bb[3] < y0 || m.bb[1] > y1) continue;
      const o = i * 4;
      let st: string;
      if (settled) {
        if (toC[o + 3] < .01) continue;
        st = styles[i] ??= rgba([toC[o], toC[o + 1], toC[o + 2]], toC[o + 3]);
      } else {
        const a = lerp(fromC[o + 3], toC[o + 3], tt);
        if (a < .01) continue;
        st = rgba([lerp(fromC[o], toC[o], tt), lerp(fromC[o + 1], toC[o + 1], tt), lerp(fromC[o + 2], toC[o + 2], tt)], a);
      }
      g.fillStyle = st; g.fill(m.path);
    }
    if (scopeW < .999) { g.fillStyle = `rgba(9,11,10,${.55 * (1 - scopeW)})`; g.fill(others); }
  }

  /** Borders live on their own layer: a candidate switch only repaints the fills. */
  function drawLines() {
    const g = cLines.getContext('2d')!, s = view.s;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cLines.width, cLines.height);
    T(g); g.lineJoin = 'round';
    g.lineWidth = (mobile ? .3 : Math.max(.45, .8 * k)) / s; g.strokeStyle = `rgba(235,230,220,${Math.min(.075, .03 + s / 6000)})`;
    g.stroke(geo.borders);
    if (scopeW < .999) { g.strokeStyle = `rgba(235,230,220,${.04 * (1 - scopeW)})`; g.stroke(ufGeo.borders); }
    g.lineWidth = (mobile ? .6 : Math.max(.8, 1.4 * k)) / s; g.strokeStyle = 'rgba(235,230,220,.15)'; g.stroke(geo.country);
    g.lineWidth = (mobile ? 1 : 2.2 * k) / s; g.strokeStyle = `rgba(235,230,220,${.24 + .16 * (1 - scopeW)})`; g.stroke(ufGeo.outline);
  }

  function drawTop() {
    const g = cTop.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    T(g); g.lineJoin = 'round';
    for (const [cdi, w, c] of [[hover, 2, 'rgba(246,243,236,.75)'], [city, 3, '#f6f3ec']] as const) {
      const m = cdi ? geo.muns.get(cdi) : null; if (!m) continue;
      g.lineWidth = (mobile ? w * .6 : w * k) / view.s; g.strokeStyle = c; g.stroke(m.path);
    }
  }

  let lastFrame = 0, lastScope = -1;
  function frame(now: number) {
    requestAnimationFrame(frame);
    const animating = now - toneT0 < Math.max(TONE_MS, ZOOM_MS) + 50 || now - zoomT0 < ZOOM_MS + 50;
    if (animating && now - lastFrame < 32) return; // 30 fps while animating halves the raster work
    lastFrame = now;
    view = currentView(now);
    const vkey = `${view.cx.toFixed(4)},${view.cy.toFixed(4)},${view.s.toFixed(3)}`;
    const toning = now - toneT0 < Math.max(TONE_MS, ZOOM_MS) + 50;
    if (vkey !== lastView || toning || dirtyBase || !baseSettled) { drawBase(now); dirtyBase = false; dirtyTop = true; }
    if (vkey !== lastView || Math.abs(scopeW - lastScope) > .001) { drawLines(); lastScope = scopeW; }
    if (vkey !== lastView || dirtyTop) { drawTop(); dirtyTop = false; lastView = vkey; }
  }

  // --- hover / click ----------------------------------------------------------------------------
  function hitTest(x: number, y: number): string | null {
    const X = view.cx + (x - mx()) / view.s, Y = view.cy + (y - my()) / view.s;
    const g = cTop.getContext('2d')!; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    let hit: string | null = null;
    for (const m of munList) {
      if (X < m.bb[0] || X > m.bb[2] || Y < m.bb[1] || Y > m.bb[3]) continue;
      if (data.byCdi.has(m.cdi) && g.isPointInPath(m.path, X, Y)) { hit = m.cdi; break; }
    }
    g.restore();
    return hit;
  }
  cTop.addEventListener('mousemove', e => {
    const rect = cTop.getBoundingClientRect(), cdi = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (cdi !== hover) { hover = cdi; dirtyTop = true; cTop.style.cursor = cdi ? 'pointer' : 'default'; if (cdi) tip.innerHTML = cityCardHtml(cdi); }
    if (!cdi) { tip.hidden = true; return; }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 20 * (mobile ? .6 : k);
    tip.style.left = `${Math.min(innerWidth - tw - 12, Math.max(12, e.clientX - tw / 2))}px`;
    tip.style.top = `${e.clientY - th - gap < 8 ? e.clientY + gap : e.clientY - th - gap}px`;
  });
  cTop.addEventListener('mouseleave', () => { hover = null; dirtyTop = true; tip.hidden = true; });
  cTop.addEventListener('click', e => { const rect = cTop.getBoundingClientRect(), cdi = hitTest(e.clientX - rect.left, e.clientY - rect.top); if (cdi) { tip.hidden = true; pickCity(cdi); } });
  addEventListener('resize', () => { layout(); dirtyBase = true; renderRank(); if (!pin.hidden && city) showPin(city); });

  // --- boot: only the current office is fetched ---------------------------------------------------
  if (params.get('c')) {
    const wanted = OFFICES.find(o => params.get('c')!.startsWith(`${o.key}-`));
    if (wanted) office = wanted;
  }
  if (!hasTurn(office)) office = OFFICES[1];
  layout();
  requestAnimationFrame(frame);
  renderTabs();
  void setOffice(office, true);
  void refreshSnapshot();
  // the shell's playback bar, identical to the other views
  player = mountPlayer({
    render: async at => {
      const next = await loadSnapshot(at);
      snap = next;
      raceIndex = new Map(); candCache = new Map(); paletteCache.clear();
      if (sel) sel = candAt(office, sel.idx);
      indexDirty = true; render(true);
    },
  });
  // the bar reserves its height until the timeline answers: wait for its final size so the view
  // is laid out once instead of settling into the space it gives back
  await player.ready;
  pageReady();
}

main().catch(err => { document.getElementById('app')!.innerHTML = `<div class="note">Erro: ${esc(String(err))}</div>`; console.error(err); });
