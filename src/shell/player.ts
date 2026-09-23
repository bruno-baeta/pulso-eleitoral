/**
 * The playback bar, in the header's lower row on every screen. It owns the replay clock and
 * asks the view to render whichever instant it lands on through `render`; it knows nothing
 * else about the view.
 *
 * Reading order, left to right: transport, live state, the rail, the clock, the speed. The
 * rail is a thin line that thickens under the pointer, with a handle riding its head.
 */
import { loadTimeline, onSnapshot, type Timeline } from '../raias/common';
import { mountShellCss } from './shell';

export interface Replay { live: boolean; playing: boolean; speed: number; at: number }

export interface PlayerOptions {
  /** Render the view for this instant, or for the current state when `at` is undefined. */
  render: (at: number | undefined) => Promise<void> | void;
  /** Called before every jump, so the view can drop transient effects. */
  reset?: () => void;
  /** True while the view is in phone layout: one speed button that cycles. */
  isPhone?: () => boolean;
  /** How long to wait between live refreshes, in ms. Defaults to 3 s. */
  liveEvery?: () => number;
  /** A replay object the view already reads from; the bar drives this one instead of its own. */
  state?: Replay;
}

const SPEEDS = [1, 10, 60, 300];
const ICON = {
  start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19 5.8v12.4L9.5 12z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/><rect x="13.1" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/></svg>',
};
const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function mountPlayer(o: PlayerOptions) {
  mountShellCss(); mountCss();
  const rp: Replay = o.state ?? { live: true, playing: false, speed: 60, at: 0 };

  const bar = document.createElement('div');
  bar.className = 'pl';
  // Anatomy of a media player: the rail spans the full width on its own line, the transport
  // sits under it on the left, and the reading of what is on screen is a caption below.
  bar.innerHTML =
      `<div class="pl-rail"><div class="pl-segs"></div><div class="pl-labels"></div><b class="pl-head"></b>`
    + `<span class="pl-bubble" hidden></span><input type="range" min="0" max="1000" step="1" value="1000" aria-label="Linha do tempo da apuração"></div>`
    + `<div class="pl-ctrl">`
    + `<button class="pl-ico pl-start" aria-label="Voltar ao início">${ICON.start}</button>`
    + `<button class="pl-ico pl-main pl-play" aria-label="Reproduzir">${ICON.play}</button>`
    + `<b class="pl-time"></b>`
    + `<button class="pl-live" aria-pressed="true"><i></i>Ao vivo</button>`
    + `<div class="pl-caption"><span class="pl-off"></span></div>`
    + `<div class="pl-speeds" role="group" aria-label="Velocidade">${SPEEDS.map(v => `<button data-s="${v}" aria-pressed="false">${v}×</button>`).join('')}</div>`
    + `</div>`;
  document.body.appendChild(bar);
  const note = document.querySelector('.sh-note');
  if (note) bar.querySelector('.pl-caption')!.appendChild(note);

  const q = <T extends Element>(sel: string) => bar.querySelector<T>(sel)!;
  const playBtn = q<HTMLButtonElement>('.pl-play'), liveBtn = q<HTMLButtonElement>('.pl-live');
  const range = q<HTMLInputElement>('.pl-rail input'), timeEl = q<HTMLElement>('.pl-time');
  const rail = q<HTMLElement>('.pl-rail');
  const segsEl = q<HTMLElement>('.pl-segs'), labelsEl = q<HTMLElement>('.pl-labels');
  const head = q<HTMLElement>('.pl-head'), bubble = q<HTMLElement>('.pl-bubble');
  /** One block per hour of the recording, so the rail reads as a clock and not as one long fill. */
  let segs: { from: number; to: number }[] = [];

  let tickKey = '', tl: Timeline | null = null, tlAt = 0;
  let dragging = false, inflight = false, pending = false, lastFetch = Date.now();
  const endNow = () => !tl ? Date.now() : tl.live ? tl.end + (Date.now() - tlAt) : tl.end;

  const fetchNow = async () => {
    if (inflight) { pending = true; return; }
    inflight = true; lastFetch = Date.now();
    try { await o.render(rp.live ? undefined : rp.at); } catch (e) { console.error('Falha ao atualizar', e); }
    finally { inflight = false; if (pending) { pending = false; void fetchNow(); } }
  };

  const paint = () => {
    // Until the timeline answers, the bar holds its full height so the views do not have to
    // resize when it arrives. Once the answer is "there is none", it gives the space back.
    if (tl) bar.classList.add('known');
    bar.classList.toggle('off', !tl?.available);
    q<HTMLElement>('.pl-off').textContent = tl && !tl.available ? tl.reason ?? '' : '';
    if (!tl?.available) return;
    const end = endNow(), span = Math.max(1, end - tl.start), pos = rp.live ? end : Math.min(rp.at, end);
    const p = Math.min(1, Math.max(0, (pos - tl.start) / span));
    if (!dragging) range.value = String(Math.round(p * 1000));
    head.style.left = `${p * 100}%`;
    bubble.style.left = `${p * 100}%`; bubble.textContent = clockOf(pos); bubble.hidden = !dragging;
    // the blocks are rebuilt only when the recorded window grows by a minute
    // One label per hour only fits when the rail is wide: a 41-hour recording on a phone would put
    // 41 of them in 390px. They are thinned to whatever the rail can hold, on round hours, and the
    // width takes part in the key so a resize rebuilds them.
    const railW = Math.max(60, rail.clientWidth);
    const key = `${tl.start}|${Math.round(end / 60000)}|${Math.round(railW / 20)}`;
    if (key !== tickKey) {
      tickKey = key;
      segs = [];
      const edge = new Date(tl.start); edge.setMinutes(0, 0, 0); edge.setHours(edge.getHours() + 1);
      let from = tl.start;
      for (let ms = edge.getTime(); ms < end; ms += 3600e3) { segs.push({ from, to: ms }); from = ms; }
      segs.push({ from, to: end });
      segsEl.innerHTML = segs.map(sg => `<i style="left:${((sg.from - tl!.start) / span * 100).toFixed(3)}%;width:calc(${((sg.to - sg.from) / span * 100).toFixed(3)}% - 3px)"><b></b></i>`).join('');
      const hours = segs.slice(1);
      const fits = Math.max(2, Math.floor(railW / 42));
      const step = [1, 2, 3, 6, 12, 24].find(n => hours.length / n <= fits) ?? 48;
      const at = (ms: number) => (ms - tl!.start) / span * 100;
      const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      // The ends of the rail carry the instants the recording actually starts and stops — they are
      // rarely round hours, and without them the bar says when the middle is but not what it spans.
      // Round hours too close to either end are dropped rather than drawn on top of them.
      const clear = 46 / railW * 100;
      labelsEl.innerHTML =
        `<span class="pl-edge">${hhmm(tl.start)}</span>`
        + hours
          .filter(sg => new Date(sg.from).getHours() % step === 0)
          .filter(sg => at(sg.from) > clear && at(sg.from) < 100 - clear)
          .map(sg => `<span style="left:${at(sg.from).toFixed(3)}%">${new Date(sg.from).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit' })}h</span>`).join('')
        + `<span class="pl-edge last">${hhmm(end)}</span>`;
    }
    // each block fills with how much of its own hour has played; the unsaved tail stays hatched
    segs.forEach((sg, i) => {
      const box = segsEl.children[i] as HTMLElement | undefined; if (!box) return;
      const within = Math.min(1, Math.max(0, (pos - sg.from) / Math.max(1, sg.to - sg.from)));
      (box.firstElementChild as HTMLElement).style.width = `${within * 100}%`;
      box.classList.toggle('ahead', sg.from >= tl!.end);
    });
    timeEl.textContent = clockOf(pos);
    playBtn.innerHTML = rp.playing ? ICON.pause : ICON.play;
    playBtn.setAttribute('aria-label', rp.playing ? 'Pausar' : rp.live ? 'Assistir desde o início' : 'Reproduzir');
    playBtn.title = playBtn.getAttribute('aria-label')!;
    bar.classList.toggle('is-live', rp.live);
    liveBtn.setAttribute('aria-pressed', String(rp.live));
    // A closed count is not live: jumping to its end lands on the final result, not on "now".
    const ended = tl ? !tl.live : false;
    liveBtn.lastChild!.textContent = ended ? 'Resultado final' : 'Ao vivo';
    liveBtn.title = ended ? 'Ir para o fim da apuração' : 'Acompanhar a apuração em tempo real';
    bar.querySelectorAll<HTMLButtonElement>('.pl-speeds button').forEach(b => {
      const on = Number(b.dataset.s) === rp.speed;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  };

  const goLive = () => { rp.live = true; rp.playing = false; o.reset?.(); void fetchNow(); paint(); };
  const seek = (at: number, play = rp.playing) => {
    if (!tl) return;
    rp.live = false; rp.playing = play;
    rp.at = Math.max(tl.start, Math.min(at, endNow()));
    o.reset?.(); void fetchNow(); paint();
  };

  q('.pl-start').addEventListener('click', () => tl && seek(tl.start, false));
  playBtn.addEventListener('click', () => {
    if (!tl) return;
    if (rp.live) seek(tl.start, true);
    else if (!rp.playing && rp.at >= endNow() - 1000) seek(tl.start, true);
    else { rp.playing = !rp.playing; paint(); }
  });
  liveBtn.addEventListener('click', goLive);
  bar.querySelectorAll<HTMLButtonElement>('.pl-speeds button').forEach(b => b.addEventListener('click', () => {
    // Phones show one speed button that cycles through the options.
    rp.speed = o.isPhone?.() ? SPEEDS[(SPEEDS.indexOf(rp.speed) + 1) % SPEEDS.length] : Number(b.dataset.s);
    paint();
  }));
  range.addEventListener('input', () => {
    if (!tl) return;
    dragging = true; bar.classList.add('seeking');
    seek(tl.start + Number(range.value) / 1000 * (endNow() - tl.start), false);
  });
  range.addEventListener('change', () => {
    dragging = false; bar.classList.remove('seeking'); bubble.hidden = true;
    if (Number(range.value) >= 1000 && tl?.live) goLive();
  });
  addEventListener('keydown', e => {
    if (!tl?.available || (e.target as HTMLElement).closest('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'Home') seek(tl.start, false);
    else if (e.key === 'End') goLive();
  });

  const refreshTimeline = async () => {
    try { tl = await loadTimeline(); tlAt = Date.now(); } catch { /* keeps the last timeline */ }
    paint();
    measure();
  };
  // The bar reserves its full height until the timeline answers, so a view that lays itself out
  // before that keeps a gap the bar then gives back, and its content drops. Views await this.
  const ready = refreshTimeline();

  /*
   * Live, the view redraws when the server says something changed instead of asking on a timer.
   * The interval below stays: it is the fallback if the stream drops, and it is what drives a
   * replay. `fetchNow` reads the snapshot the stream just delivered, so this costs no request.
   */
  onSnapshot(() => { if (rp.live) void fetchNow(); });
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void refreshTimeline();
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && rp.live) void fetchNow();
  });

  let last = performance.now();
  setInterval(() => {
    const now = performance.now(), dt = now - last; last = now;
    if (!rp.live && rp.playing && tl) {
      rp.at += dt * rp.speed;
      if (rp.at >= endNow()) { if (tl.live) goLive(); else { rp.at = endNow(); rp.playing = false; } }
    }
    measure();
    // a hidden or prerendered document keeps its clock but asks nothing: the pool it would take
    // belongs to the view on screen, and it refreshes the moment it becomes that view
    const oculto = document.visibilityState === 'hidden'
      || !!(document as Document & { prerendering?: boolean }).prerendering;
    const every = rp.live ? (o.liveEvery?.() ?? 3000) : rp.playing ? 600 : Infinity;
    if (!oculto && Date.now() - lastFetch >= every) void fetchNow();
    paint();
  }, 250);

  // Views keep their own chrome clear of the bar by this, as they do with --sh-head. The bar
  // grows once the timeline arrives, so a change has to reach them: they size their content off it.
  let lastH = -1, notifying = false;
  const measure = () => {
    const h = bar.offsetHeight;
    if (h === lastH || notifying) return;   // the notification is a resize; do not answer our own
    lastH = h;
    document.documentElement.style.setProperty('--pl-h', `${h}px`);
    notifying = true;
    try { dispatchEvent(new Event('resize')); } finally { notifying = false; }
  };
  measure(); addEventListener('resize', measure);
  return { rp, paint, el: bar, ready };
}

let mounted = false;
function mountCss() {
  if (mounted) return;
  mounted = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* Sizes carry a floor: at 1080p the shell scale is .56, which alone would render this chrome
   at half size and illegible. Past ~1440p the computed value wins and nothing changes. */
const px = (n: number, min: number) => `max(calc(${n}px * var(--sk)), ${min}px)`;
const CSS = `
  .pl { position: fixed; left: 0; right: 0; bottom: 0; z-index: 58; box-sizing: border-box; min-height: ${px(98, 86)}; display: flex; flex-direction: column; justify-content: center; gap: ${px(4, 3)}; padding: ${px(14, 10)} ${px(36, 14)} ${px(14, 11)}; background: linear-gradient(180deg, rgba(10,12,11,0), rgba(10,12,11,.93) 26%); font-family: 'DM Sans Variable', system-ui, sans-serif; color: #8e8c86; }
  .pl-ctrl { display: flex; align-items: center; gap: ${px(14, 10)}; }
  .pl-ctrl .pl-speeds { margin-left: auto; }
  .pl-caption { display: flex; align-items: center; gap: ${px(10, 8)}; padding-left: ${px(6, 4)}; border-left: 1px solid #2a2e2c; font-size: ${px(16, 12)}; color: #5f5c56; white-space: nowrap; }
  .pl-caption:empty { display: none; }
  .pl.off > *:not(.pl-off) { display: none; }
  .pl.off.known { min-height: 0; padding-top: ${px(10, 8)}; padding-bottom: ${px(12, 10)}; }
  .pl.off.known:not(:has(.pl-off:not(:empty))):not(:has(.sh-note)) { display: none; }
  .pl-off { color: #6f6d68; font-size: ${px(16, 12)}; }

  .pl-ico { all: unset; cursor: pointer; flex-shrink: 0; display: grid; place-items: center; width: ${px(36, 30)}; height: ${px(36, 30)}; border-radius: 50%; color: #b9b6ae; transition: background .15s, color .15s, transform .1s; }
  .pl-ico:hover { background: rgba(255,255,255,.08); color: #fff; }
  .pl-ico:active { transform: scale(.94); }
  .pl-ico svg { width: ${px(18, 15)}; height: ${px(18, 15)}; }
  .pl-main { background: #f2efe8; color: #14150f; }
  .pl-main:hover { background: #fff; color: #14150f; }

  .pl-live { all: unset; cursor: pointer; flex-shrink: 0; display: inline-flex; align-items: center; gap: ${px(8, 6)}; height: ${px(30, 25)}; padding: 0 ${px(13, 10)}; border-radius: 999px; border: 1px solid #2f3431; color: #85837c; font-size: ${px(15, 11)}; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
  .pl-live:hover { border-color: #4a504d; color: #d8d5cd; }
  .pl-live i { width: ${px(8, 6)}; height: ${px(8, 6)}; border-radius: 50%; background: #4a504d; }
  .pl.is-live .pl-live { color: #ffb4b4; border-color: #5e2b2b; background: rgba(255,90,90,.1); }
  .pl.is-live .pl-live i { background: #ff5a5a; box-shadow: 0 0 0 ${px(3, 2)} rgba(255,90,90,.2); }

  .pl-rail { position: relative; width: 100%; height: ${px(38, 32)}; }
  .pl-segs { position: absolute; left: 0; right: 0; top: ${px(9, 8)}; height: ${px(12, 10)}; }
  .pl-segs i { position: absolute; top: 0; bottom: 0; overflow: hidden; border-radius: 2px; background: #242825; box-shadow: inset 0 0 0 1px #2c312e; }
  .pl-segs i b { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #d9d5cb; transition: width .26s linear; }
  .pl-segs i.ahead { background: repeating-linear-gradient(115deg, #1e2220 0 3px, #2a2f2c 3px 6px); box-shadow: none; }
  .pl-labels { position: absolute; left: 0; right: 0; top: ${px(24, 20)}; height: ${px(14, 12)}; }
  .pl-labels span { position: absolute; transform: translateX(-50%); font-size: ${px(13, 10)}; color: #5f5c56; font-variant-numeric: tabular-nums; }
  /* the two ends sit inside the rail instead of straddling it, so neither is clipped */
  .pl-labels .pl-edge { left: 0; transform: none; color: #7d7a74; }
  .pl-labels .pl-edge.last { left: auto; right: 0; }
  .pl-head { position: absolute; top: ${px(5, 5)}; width: 2px; height: ${px(20, 16)}; margin-left: -1px; border-radius: 1px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 10px rgba(255,255,255,.35); transition: left .26s linear; }
  .pl.seeking .pl-head, .pl.seeking .pl-segs i b { transition: none; }
  .pl-rail:hover .pl-head, .pl-rail:focus-within .pl-head { background: #e8c877; box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 12px rgba(232,200,119,.5); }
  .pl-bubble { position: absolute; bottom: calc(100% - 2px); transform: translateX(-50%); padding: ${px(4, 3)} ${px(10, 8)}; border-radius: ${px(7, 6)}; background: #2b302d; border: 1px solid #3f4542; color: #f2efe8; font-size: ${px(15, 11)}; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pl-bubble[hidden] { display: none; }
  .pl-rail input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; background: transparent; }
  .pl-rail input::-webkit-slider-thumb { -webkit-appearance: none; width: ${px(20, 16)}; height: ${px(40, 34)}; }

  .pl-time { flex-shrink: 0; color: #e6e3dc; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: ${px(25, 18)}; letter-spacing: .04em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pl-speeds { flex-shrink: 0; display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255,255,255,.05); }
  .pl-speeds button { all: unset; cursor: pointer; display: inline-flex; align-items: center; height: ${px(26, 22)}; padding: 0 ${px(11, 9)}; border-radius: 999px; font-size: ${px(15, 11)}; color: #7d7b75; font-variant-numeric: tabular-nums; }
  .pl-speeds button:hover { color: #d8d5cd; }
  .pl-speeds button.on { background: #2f3431; color: #f2efe8; }
  .pl .sh-note { color: inherit; font-size: inherit; }

  .pl-ico:focus-visible, .pl-live:focus-visible, .pl-speeds button:focus-visible, .pl-rail input:focus-visible { outline: 2px solid #e8c877; outline-offset: 2px; }
  @media (max-width: 900px) {
    .pl { gap: 8px; }
    .pl-time { display: none; }
    .pl-speeds button { display: none; } .pl-speeds button.on { display: inline-flex; }
  }
`;
