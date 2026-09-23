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
import { mountShellBar, mountShellNote, pageReady } from '../../shell/shell';
import { all, contestedSeats, el, esc, fmtInt, fmtPercent, fmtShortTime, fold, initials, loadSnapshot, loadTimeline, MODE, party, photoUrl, seatsByParty, shortVotes, stateName, titleCase, TURN, UF, YEAR } from '../../shell/dados';

const css = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0c0c; font-family: 'DM Sans Variable', system-ui, sans-serif; color: #eeece6; }
  #app { position: fixed; inset: 0; background: #0b0c0c; }
  .bar .badge.live { color: #ff6b6b; border-color: #6e2d2d; } .bar .badge.wait { color: #b9b6ae; border-color: #3a3e3c; }
  .tabs { position: absolute; left: 0; right: 0; display: flex; gap: calc(8px * var(--k)); padding: 0 calc(24px * var(--k)); overflow-x: auto; scrollbar-width: none; z-index: 9; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { all: unset; flex-shrink: 0; cursor: pointer; padding: calc(10px * var(--k)) calc(20px * var(--k)); border-radius: 999px; background: rgba(26,29,28,.9); border: 1px solid #2a2e2c; color: #b9b6ae; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(24px * var(--k)); letter-spacing: .06em; text-transform: uppercase; }
  .tabs button.on { background: #f2efe8; color: #111; border-color: #f2efe8; }
  /* Hosted by the app header on the chart screen: a segmented control, not a floating strip. */
  .sh-head .tabs { position: static; left: auto; right: auto; width: auto; padding: 0; margin-left: calc(14px * var(--k)); gap: calc(3px * var(--k)); border-radius: 999px; background: rgba(255,255,255,.05); }
  .sh-head .tabs button { padding: calc(8px * var(--k)) calc(15px * var(--k)); border: 0; background: none; font-size: calc(19px * var(--k)); letter-spacing: .04em; color: #85837c; }
  .sh-head .tabs button:hover { color: #d8d5cd; }
  .sh-head .tabs button.on { background: #2f3431; color: #f2efe8; border: 0; }
  #app.mobile .tabs { display: flex; }
  /* ── as colunas: uma por disputa, com a curva de cada candidatura no tempo ── */
  .gscope { margin-left: auto; display: inline-flex; gap: calc(2px * var(--k)); padding: calc(3px * var(--k)); border-radius: 999px; background: rgba(255,255,255,.05); }
  .gscope[hidden] { display: none; }
  .gscope button { all: unset; cursor: pointer; display: inline-flex; align-items: center; height: calc(26px * var(--k)); padding: 0 calc(12px * var(--k)); border-radius: 999px; font-size: calc(16px * var(--k)); font-weight: 600; letter-spacing: .04em; color: #85837c; }
  .gscope button:hover { color: #d8d5cd; }
  .gscope button.on { background: #2f3431; color: #f2efe8; }
  /* Same number of rows: each one grows to use the free height. */
  /* The shared line brings its own grid and padding; what is left here is the state of the line. */
  /* The shared line carries the whole look; what is left here is the state of a line. */
  /* The candidacy picked in the search: highlighted where it stands, or pinned to the last line. */
    box-shadow: inset 0 0 0 calc(2px * var(--k)) rgba(232,200,119,.5);
    padding: max(calc(18px * var(--k)), 15px) max(calc(46px * var(--k)), 38px) max(calc(13px * var(--k)), 11px) max(calc(12px * var(--k)), 10px); }
  /* Only a line that gained a place lights up; every reorder would make the screen flicker. */
  @media (max-width: 1600px) {
    .ger { grid-template-columns: repeat(3, 1fr); grid-template-rows: auto; overflow-y: auto; }
  }
  @media (max-width: 1100px) {
    .ger { grid-template-columns: repeat(2, 1fr); }
  }

  /* ---- header: one thin line aligned with the shell bar ---- */
  .cr-head.bar { position: absolute; left: calc(56px * var(--k)); top: calc(var(--sh-head, 0px) + 16px * var(--k)); z-index: 40; display: flex; align-items: center; gap: calc(18px * var(--k)); height: calc(46px * var(--k)); font-size: calc(21px * var(--k)); color: #9c9a93; }
  .cr-row { display: flex; gap: calc(8px * var(--k)); align-items: center; }
  .cr-head .search { position: relative; display: flex; align-items: center; box-sizing: border-box; width: calc(600px * var(--k)); height: calc(46px * var(--k)); padding: 0 calc(13px * var(--k)); border-radius: 999px; background: rgba(18,21,19,.85); border: 1px solid #2a2e2b; transition: width .2s; }
  .cr-head .search:focus-within { border-color: #6a705f; background: rgba(24,27,24,.96); }
  .cr-head .search .lens { width: calc(20px * var(--k)); height: calc(20px * var(--k)); color: #8b8882; flex-shrink: 0; }
  .cr-head .search input { all: unset; flex: 1; min-width: 0; height: 100%; padding: 0 calc(12px * var(--k)); color: #f3f0e9; font-size: calc(21px * var(--k)); }
    .cr-head .search input::placeholder { color: #6f6c66; }
  .cr-head .search kbd { font: inherit; font-size: calc(15px * var(--k)); color: #6f6d68; border: 1px solid #2b2f2d; border-radius: calc(6px * var(--k)); padding: calc(2px * var(--k)) calc(8px * var(--k)); flex-shrink: 0; }
    .cr-head .sound { all: unset; box-sizing: border-box; cursor: pointer; width: calc(46px * var(--k)); height: calc(46px * var(--k)); border-radius: 999px; background: rgba(18,21,19,.85) no-repeat center; background-size: calc(20px * var(--k)); border: 1px solid #2a2e2b; font-size: 0; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b9b6ae' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 9v6h4l5 4V5L8 9z'/%3E%3Cpath d='M17 9l4 6M21 9l-4 6'/%3E%3C/svg%3E"); }
  .cr-head .sound.on { background-color: #e8c877; border-color: #e8c877; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a1508' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 9v6h4l5 4V5L8 9z'/%3E%3Cpath d='M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12'/%3E%3C/svg%3E"); }
  .cr-head .sound:focus-visible, .cr-head .m-search:focus-visible, .cr-seg button:focus-visible { outline: 2px solid #e8c877; outline-offset: 2px; }
  .cr-head .m-search { display: none; }
  .results { position: absolute; left: 0; top: calc(100% + 8px * var(--k)); width: min(max(100%, calc(640px * var(--k))), calc(100vw - 24px)); background: #161917; border: 1px solid #2a2e2c; border-radius: calc(14px * var(--k)); box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; z-index: 12; }
  .results button { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: calc(56px * var(--k)) minmax(0, 1fr) auto; gap: calc(16px * var(--k)); align-items: center; width: 100%; padding: calc(12px * var(--k)) calc(20px * var(--k)); border-top: 1px solid #1f2320; }
  .results button:first-child { border-top: 0; }
  .results button:hover, .results button:focus-visible { background: #202421; }
  .results .ph { position: relative; overflow: hidden; width: calc(56px * var(--k)); height: calc(56px * var(--k)); border-radius: 50%; background: #1c1f1c; display: grid; place-items: center; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(20px * var(--k)); color: #cbc8c0; }
  .results .ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 24%; }
  .results .nm { min-width: 0; }
  .results .nm b { display: block; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(26px * var(--k)); letter-spacing: .04em; text-transform: uppercase; color: #f6f3ec; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .results .nm span { display: block; font-size: calc(17px * var(--k)); font-weight: 600; letter-spacing: .06em; color: #8e8c86; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .results .pct { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(26px * var(--k)); color: #f6f3ec; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .results .none { padding: calc(18px * var(--k)) calc(20px * var(--k)); color: #8e8c86; font-size: calc(20px * var(--k)); }
  /* ---- per-race header on the left ---- */
  @keyframes gain { 0% { opacity: 0; margin-top: 0; } 15% { opacity: 1; } 100% { opacity: 0; margin-top: calc(-70px * var(--k)); } }
  @keyframes pulse { 0% { transform: translate(-50%, -50%) scale(1); } 25% { transform: translate(-50%, -50%) scale(1.2); } 100% { transform: translate(-50%, -50%) scale(1); } }
  @keyframes lead-pop { 0% { transform: translate(-50%, -50%) scale(1); } 40% { transform: translate(-50%, -50%) scale(1.3); } 100% { transform: translate(-50%, -50%) scale(1); } }
  @keyframes lead-ring { 0% { box-shadow: 0 0 0 calc(3px * var(--k)) #e8c877, 0 0 0 calc(3px * var(--k)) rgba(232, 200, 119, .75); } 100% { box-shadow: 0 0 0 calc(3px * var(--k)) #e8c877, 0 0 0 calc(32px * var(--k)) rgba(232, 200, 119, 0); } }
  @media (prefers-reduced-motion: reduce) { .med.pulse, .med.overtake, .med.took-lead { animation: none !important; } .gain { animation-duration: .01s; } }
  .tip { position: fixed; z-index: 80; pointer-events: none; padding: calc(10px * var(--k)) calc(14px * var(--k)); border-radius: calc(10px * var(--k)); background: rgba(20,23,21,.92); backdrop-filter: blur(6px); border: 1px solid #2a2e2c; box-shadow: 0 10px 26px rgba(0,0,0,.45); white-space: nowrap; }
  .tip .n { font-size: calc(19px * var(--k)); font-weight: 500; letter-spacing: .02em; color: #8e8c86; }
  .tip .d { margin-top: calc(3px * var(--k)); font-size: calc(21px * var(--k)); color: #9c9a93; font-variant-numeric: tabular-nums; }
  .tip .d b { color: #e6e3dc; font-weight: 600; }
  .tip .g { margin-top: calc(6px * var(--k)); font-size: calc(20px * var(--k)); color: #e8c877; }
  .tip .g.one { margin-top: 0; font-weight: 600; }
  .bar .badge.replay { color: #9fd0ff; border-color: #2d4d6e; }
  /* ---- tables and the candidate panel ---- */
  .modal { position: fixed; inset: 0; z-index: 30; background: rgba(5,6,6,.72); display: grid; place-items: center; }
  .sheet { width: min(calc(1500px * var(--k)), 92vw); height: 82vh; display: flex; flex-direction: column; background: #151816; border: 1px solid #2a2e2c; border-radius: calc(20px * var(--k)); box-shadow: 0 40px 100px rgba(0,0,0,.7); overflow: hidden; }
  .sheet header { display: flex; align-items: center; gap: calc(24px * var(--k)); padding: calc(30px * var(--k)) calc(36px * var(--k)); border-bottom: 1px solid #262a28; }
  .sheet header .t { font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(50px * var(--k)); letter-spacing: .06em; text-transform: uppercase; }
  .sheet header .s { font-size: calc(22px * var(--k)); color: #8e8c86; }
  .sheet header input { margin-left: auto; width: calc(420px * var(--k)); height: calc(52px * var(--k)); padding: 0 calc(20px * var(--k)); border-radius: 999px; background: #1d201e; border: 1px solid #2f3431; color: #fff; font: inherit; font-size: calc(22px * var(--k)); outline: none; }
  .sheet header button { all: unset; cursor: pointer; width: calc(52px * var(--k)); height: calc(52px * var(--k)); display: grid; place-items: center; border-radius: 50%; background: #1d201e; color: #ddd; font-size: calc(26px * var(--k)); }
  .sheet .scroll { flex: 1; min-height: 0; overflow: auto; }
  .sheet table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: calc(24px * var(--k)); }
  .sheet th { position: sticky; top: 0; background: #151816; text-align: left; padding: calc(14px * var(--k)) calc(24px * var(--k)); font-weight: 600; font-size: calc(17px * var(--k)); letter-spacing: .12em; text-transform: uppercase; color: #7d7b75; border-bottom: 1px solid #262a28; }
  .sheet td { padding: calc(16px * var(--k)) calc(24px * var(--k)); border-bottom: 1px solid #1f2320; font-variant-numeric: tabular-nums; }
  .sheet td.r, .sheet th.r { text-align: right; }
  .sheet tr.hl td { background: rgba(232, 200, 119, .12); }
  .sheet tr.cut td { border-bottom: 2px solid #3f7fb0; }
  .sheet .lanebox { display: inline-grid; place-items: center; width: calc(46px * var(--k)); height: calc(46px * var(--k)); border-radius: calc(6px * var(--k)); background: #36474f; color: #f2efe8; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(26px * var(--k)); }
  .sheet .sw { display: inline-block; width: calc(12px * var(--k)); height: calc(12px * var(--k)); border-radius: 3px; margin-right: calc(12px * var(--k)); }
  .sheet .st { font-size: calc(18px * var(--k)); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8e8c86; }
  .sheet .st.elected { color: #6fcf97; } .sheet .st.range, .sheet .st.lead { color: #7fb6de; } .sheet .st.runoff { color: #e8c877; }
  .sheet .note { padding: calc(16px * var(--k)) calc(36px * var(--k)); font-size: calc(18px * var(--k)); color: #6f6d68; border-top: 1px solid #262a28; }
  .sheet.cand header { gap: calc(20px * var(--k)); }
  .sheet.cand .cph { position: relative; flex-shrink: 0; width: calc(96px * var(--k)); height: calc(96px * var(--k)); border-radius: 50%; overflow: hidden; background: #26292a; box-shadow: 0 0 0 calc(3px * var(--k)) var(--c); display: grid; place-items: center; font: 600 calc(34px * var(--k))/1 'Barlow Condensed', sans-serif; color: #cfccc4; }
  .sheet.cand .cph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 20%; }
  .sheet.cand .ch { min-width: 0; }
  .sheet.cand .ch .s { margin-top: calc(6px * var(--k)); }
  .sheet.cand .ch .s b { color: #e6e3dc; font-weight: 600; }
  .sheet.cand .terr { margin-left: auto; white-space: nowrap; color: #e8c877; text-decoration: none; font-size: calc(20px * var(--k)); padding: calc(10px * var(--k)) calc(18px * var(--k)); border-radius: 999px; border: 1px solid #4a4230; }
  .sheet.cand .terr:hover { background: rgba(232,200,119,.1); }
  .sheet.cand header input { margin-left: 0; }
  .sheet.cand .status { padding: calc(14px * var(--k)) calc(36px * var(--k)); color: #b9b6ae; font-size: calc(20px * var(--k)); }

  /*
   * The sheet had no narrow layout at all: its header is one flex row holding a photo, the name,
   * the facts, a link, a search box and the close button, and at phone width every inline piece
   * wrapped a word per line while the link landed on the text and the close button left the
   * screen. Here the row is allowed to wrap into three: identity, then the link, then the search.
   * The table loses its least useful column instead of letting two numbers collide.
   */
  @media (max-width: 900px) {
    /* the app header is two lines tall here, and a sheet centred on the whole window hides its own
       title behind it; the box is given the space that is actually free */
    .modal { box-sizing: border-box; padding: var(--sh-head, 0px) 0 var(--pl-h, 0px); }
    .sheet { width: 100vw; height: 100%; border-radius: 16px; }
    .sheet header { flex-wrap: wrap; gap: 10px; row-gap: 10px; padding: 14px; }
    .sheet header .t { font-size: 26px; }
    .sheet header .s { font-size: 13px; line-height: 1.45; }
    .sheet.cand .cph { width: 52px; height: 52px; font-size: 20px; }
    .sheet.cand .ch { flex: 1 1 0; min-width: 0; }
    /* the close button keeps the end of the first line, where a thumb expects it */
    .sheet header > button { order: 2; margin-left: auto; flex: none; width: 38px; height: 38px; font-size: 20px; }
    .sheet.cand .terr { order: 5; margin-left: 0; font-size: 13px; padding: 7px 12px; }
    .sheet header input { order: 6; flex: 1 1 100%; width: auto; margin-left: 0; height: 38px; font-size: 15px; }
    .sheet .note, .sheet.cand .status { padding: 12px 14px; font-size: 12px; }
    .sheet table { font-size: 14px; }
    .sheet th { font-size: 10px; letter-spacing: .06em; padding: 9px 10px; }
    .sheet td { padding: 10px; overflow: hidden; text-overflow: ellipsis; }
    /* a candidate's cities: the share of valid votes goes, the place in the city stays */
    .sheet.cand th:nth-child(4), .sheet.cand td:nth-child(4) { display: none; }
    /* a race's table: the number and the party ride under the name instead of in columns */
    /* number, party and the share go; the tally and whether they were elected are what is read */
    .sheet:not(.cand) th:nth-child(3), .sheet:not(.cand) td:nth-child(3),
    .sheet:not(.cand) th:nth-child(4), .sheet:not(.cand) td:nth-child(4),
    .sheet:not(.cand) th:nth-child(6), .sheet:not(.cand) td:nth-child(6) { display: none; }
    .sheet .lanebox { width: 30px; height: 30px; font-size: 16px; }
    /* A fixed layout splits 390px into equal shares, which truncates "3.276.512" into "3.276…" and
       loses the column's whole point. Here the content sizes the columns: the numbers ask for what
       they need and the city name gives way, since it is the one thing an ellipsis still conveys. */
    .sheet table { table-layout: auto; }
    .sheet td { white-space: nowrap; }   /* the figures; a column label may wrap, a tally may not */
    /* except the sentence that spans the whole table: kept on one line it sets the table's width */
    .sheet td[colspan] { white-space: normal; }
    .sheet td:nth-child(2) { max-width: 34vw; overflow: hidden; text-overflow: ellipsis; }
  }
  .sheet.cand .status:empty { display: none; }
  .sheet.cand td small { color: #7d7b75; }
  .sheet.cand td.muted { color: #7d7b75; }
  .sheet.cand .pos { display: inline-block; min-width: calc(40px * var(--k)); text-align: center; padding: calc(2px * var(--k)) calc(10px * var(--k)); border-radius: 999px; font-weight: 600; font-size: calc(18px * var(--k)); color: #f4f1ea; background: color-mix(in srgb, var(--c) 55%, #1b1e1d); }
  .sheet.cand .more { padding: calc(14px * var(--k)) calc(24px * var(--k)); color: #7d7b75; font-size: calc(18px * var(--k)); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

  /* ---- placar overlays ---- */
  /* ---- mosaico ---- */
  .tip .legend { display: flex; flex-wrap: wrap; gap: calc(4px * var(--k)) calc(14px * var(--k)); max-width: calc(560px * var(--k)); margin-top: calc(8px * var(--k)); white-space: normal; font-size: calc(19px * var(--k)); color: #cdc7bc; }
  .tip .legend i { display: inline-block; width: calc(11px * var(--k)); height: calc(11px * var(--k)); border-radius: 2px; margin-right: calc(6px * var(--k)); }
  .tip .legend b { color: #fff; }
  @keyframes grew { 0% { box-shadow: inset -3px 0 0 rgba(255,255,255,.85); } 100% { box-shadow: inset -3px 0 0 rgba(255,255,255,0); } }
  @keyframes newlead { 0% { box-shadow: inset 0 0 0 0 rgba(232,200,119,.9); } 100% { box-shadow: inset 0 0 0 calc(10px * var(--k)) rgba(232,200,119,0); } }
  @keyframes hit { 0%, 60% { box-shadow: inset 0 0 0 calc(4px * var(--k)) #e8c877; } 100% { box-shadow: inset 0 0 0 calc(4px * var(--k)) rgba(232,200,119,0); } }
  .gainlayer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
  /* ── Painéis de linha: cinco cargos empilhados, um gráfico por faixa ── */
  .lin { position: absolute; left: calc(56px * var(--k)); right: calc(56px * var(--k)); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: calc(26px * var(--k)) calc(86px * var(--k)); }
  .lin.one { grid-template-columns: 1fr; grid-template-rows: 1fr; }
  .prow.solo { grid-column: 1 / -1; }
  .lin.one .prow { display: none; } .lin.one .prow.on { display: grid; }
  .prow { position: relative; display: grid; grid-template-columns: calc(300px * var(--k)) 1fr; gap: calc(20px * var(--k)); align-items: stretch; min-height: 0; }
  .phead { all: unset; display: block; cursor: pointer; align-self: center; text-align: left; white-space: nowrap; }
  .phead .t { font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(46px * var(--k)); letter-spacing: .04em; text-transform: uppercase; color: #eeeae0; line-height: .95; }
  .phead .s { margin-top: calc(8px * var(--k)); font-size: calc(17px * var(--k)); color: #a39e93; }
  .phead .s b { color: #e6e3dc; font-weight: 600; font-variant-numeric: tabular-nums; }
  .phead .mtog { display: inline-block; margin-top: calc(10px * var(--k)); padding: calc(4px * var(--k)) calc(12px * var(--k)); border-radius: 999px; border: 1px solid #33383a; color: #9c9a93; font-size: calc(16px * var(--k)); letter-spacing: .04em; text-transform: uppercase; }
  .phead:hover .mtog { border-color: #5a5f55; color: #e6e3dc; }
  .phead .seats { margin-top: calc(10px * var(--k)); display: flex; flex-wrap: wrap; gap: calc(3px * var(--k)); max-width: calc(320px * var(--k)); }
  /* Brasil / state switch, beside the panel's own heading. */
  .prow .pscope { position: absolute; z-index: 6; }
  .phead .seats i { width: calc(7px * var(--k)); height: calc(7px * var(--k)); border-radius: 1px; background: #2a2e2c; }
  .prow:not(.solo) .phead .t { font-size: calc(38px * var(--k)); }
  .phead:hover .t { color: #fff; } .phead:focus-visible { outline: 2px solid #e8c877; outline-offset: 4px; }
  .plot { position: relative; min-width: 0; overflow: visible; }
  .chart { position: absolute; inset: 0; }
  .chart .gl { stroke: rgba(255,255,255,.07); stroke-width: 1; }
  .chart .axis { stroke: rgba(255,255,255,.18); stroke-width: 1; }
  .chart .ylab { fill: #6b6963; font-size: calc(16px * var(--k)); text-anchor: end; font-variant-numeric: tabular-nums; }
  .chart .xlab { fill: #6b6963; font-size: calc(16px * var(--k)); text-anchor: middle; font-variant-numeric: tabular-nums; }
  /* the stretch before the first file: dashed and dim, because it is a bridge, not a measurement */
  .chart .lead { fill: none; stroke-dasharray: 2 6; stroke-linecap: round; }
  .chart .future { fill: rgba(12,13,13,.66); }
  .chart .needle { stroke: #f2efe8; stroke-width: calc(2px * var(--k)); opacity: .55; }
  .chart .chair { stroke: rgba(242,239,232,.45); stroke-width: 1; stroke-dasharray: 4 4; }
  .chart .link { fill: none; stroke-width: 1; opacity: .28; stroke-dasharray: calc(3px * var(--k)) calc(5px * var(--k)); }
  .chart .stub { stroke-width: calc(2px * var(--k)); stroke-dasharray: calc(4px * var(--k)) calc(4px * var(--k)); opacity: .6; }
  .chart path { stroke-linecap: round; stroke-linejoin: round; transition: d .55s cubic-bezier(.33,0,.15,1); }
  .heads { position: absolute; inset: 0; pointer-events: none; }
  .med { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: calc(12px * var(--k)); pointer-events: auto; cursor: pointer; transition: transform .5s cubic-bezier(.33,0,.15,1); }
  .med .ph { position: relative; flex: 0 0 auto; width: calc(46px * var(--k)); height: calc(46px * var(--k)); border-radius: 50%; overflow: hidden; background: #1b1e1c; box-shadow: 0 0 0 calc(3px * var(--k)) var(--c), 0 calc(6px * var(--k)) calc(16px * var(--k)) rgba(0,0,0,.6); }
  .med.lead .ph { box-shadow: 0 0 0 calc(3px * var(--k)) #e8c877, 0 0 calc(22px * var(--k)) rgba(232,200,119,.45); }
  .med .ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 16%; filter: grayscale(.2) brightness(.92); }
  .med .ph img.gone { display: none; }
  .med .ini { position: absolute; inset: 0; display: grid; place-items: center; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(19px * var(--k)); color: #7d7870; }
  .med .ph img + .ini { display: none; } .med .ph img.gone + .ini { display: grid; }
  /* A party has no face: the disc is the party's colour instead of its initials. */
  .med.party .ph { background: var(--c); }
  .med.party .ph img.gone + .ini { display: none; }
  .med .tx { min-width: 0; }
  .med .tx b { display: block; max-width: calc(210px * var(--k)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(28px * var(--k)); line-height: 1.05; color: #f6f3ec; }
  .med.lead .tx b { color: #fff; }
  .med .tx span { display: block; font-size: calc(19px * var(--k)); color: #b4afa6; font-variant-numeric: tabular-nums; }
  .med.rest .tx b { color: #9c9a93; }
  .med.grew .ph { animation: medgrew 1.1s ease-out; }
  @keyframes medgrew { 0% { transform: scale(1.14); } 100% { transform: scale(1); } }
  .med.newlead .ph { animation: mednew 1.3s ease-out 3; }
  @keyframes mednew { 0% { box-shadow: 0 0 0 0 rgba(232,200,119,.9); } 100% { box-shadow: 0 0 0 calc(14px * var(--k)) rgba(232,200,119,0); } }
  .med.hit .ph { animation: medhit 2.4s ease-out 2; }
  @keyframes medhit { 0%, 60% { box-shadow: 0 0 0 calc(5px * var(--k)) #e8c877; } 100% { box-shadow: 0 0 0 calc(5px * var(--k)) rgba(232,200,119,0); } }
  .pempty[hidden] { display: none; }
  .pempty { position: absolute; top: calc(6px * var(--k)); right: calc(318px * var(--k)); left: auto; display: block; padding: calc(3px * var(--k)) calc(10px * var(--k)); border-radius: calc(6px * var(--k)); background: rgba(10,11,11,.72); font-size: calc(17px * var(--k)); color: #8e8b84; z-index: 4; }
  .prow.blank .pempty { inset: 0; padding: 0; border-radius: 0; display: grid; place-items: center; background: none; font-size: calc(20px * var(--k)); }
  #app.mobile .pempty { right: calc(16px * var(--k)); }
  .tip .rows { display: grid; gap: calc(3px * var(--k)); margin-top: calc(7px * var(--k)); font-size: calc(19px * var(--k)); color: #a8a49b; }
  .tip .rows span { display: grid; grid-template-columns: calc(9px * var(--k)) minmax(calc(110px * var(--k)), 1fr) calc(78px * var(--k)) calc(66px * var(--k)); gap: 0 calc(14px * var(--k)); align-items: center; }
  .tip .rows u { text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
  .tip .rows em { font-style: normal; text-align: left; color: #8e8c86; font-variant-numeric: tabular-nums; }
  .tip .rows i { width: calc(9px * var(--k)); height: calc(9px * var(--k)); border-radius: 50%; }
  .tip .rows b { text-align: left; color: #dcd8cf; font-weight: 500; font-variant-numeric: tabular-nums; }
  #app.mobile .lin { left: calc(16px * var(--k)); right: calc(16px * var(--k)); }
  #app.mobile .prow { grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: calc(12px * var(--k)); }
  #app.mobile .phead { align-self: start; }
  #app.mobile .phead .t { font-size: calc(40px * var(--k)); }
  #app.mobile .phead .s { font-size: calc(21px * var(--k)); }
  #app.mobile .med { gap: calc(8px * var(--k)); }
  #app.mobile .med .ph { width: calc(38px * var(--k)); height: calc(38px * var(--k)); }
  #app.mobile .med .tx b { font-size: calc(22px * var(--k)); max-width: calc(120px * var(--k)); }
  #app.mobile .med .tx span { font-size: calc(16px * var(--k)); }
  .gain { position: fixed; transform: translate(-100%, -50%); pointer-events: none; white-space: nowrap; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(30px * var(--k)); color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.9); animation: gain 2.2s ease-out forwards; }
  .gain.big { font-size: calc(32px * var(--k)); color: #e8c877; }
  @keyframes gain { 0% { opacity: 0; margin-top: 0; } 15% { opacity: 1; } 100% { opacity: 0; margin-top: calc(-60px * var(--k)); } }
  #app.mobile .cr-head .search, .sh-head.mobile .search { width: calc(46px * var(--k)); overflow: hidden; }
  #app.mobile .cr-head .search, .sh-head.mobile .search:focus-within { overflow: visible; }
  #app.mobile .cr-head .search, .sh-head.mobile .search:focus-within { width: calc(400px * var(--k)); }

`;
const style = document.createElement('style'); style.textContent = HIT_CSS + css; document.head.appendChild(style);
seedScale();
const app = document.getElementById('app')!;

/** Muted party hues shared with Pelotão and Território: distinct enough to group, quiet on a dark stage. */
/** The parties' own colours, as they use them in their flags and campaign material. */
const PARTY_COLORS: Record<string, string> = {
  PT: '#c8102e', PL: '#1b3a6b', PSDB: '#0f7dc2', MDB: '#0aa04b', PSD: '#12a5a0', PP: '#1f4fa0',
  REPUBLICANOS: '#0b63a8', 'UNIÃO': '#0b4ea2', PDT: '#d81e2c', PSB: '#f0a01e', PSOL: '#b01455',
  NOVO: '#f07f20', 'PC DO B': '#a8141c', PCDOB: '#a8141c', PODE: '#0f9d6e', AVANTE: '#00a0dc',
  PATRIOTA: '#1f4a8c', PTB: '#0f8f3d', PV: '#3faa34', REDE: '#00a99a', CIDADANIA: '#e0157d',
  SOLIDARIEDADE: '#ef6a1f', PROS: '#e8722c', PSC: '#1d8f4a', PRTB: '#123a8c', PMB: '#6d2f9c',
  PCB: '#b4151c', PSTU: '#c01527', PCO: '#8c1116', UP: '#d81232', DC: '#1e4f86', AGIR: '#2e7d4f',
  PMN: '#b8332a', 'PT+PV+PC DO B': '#c8102e', 'PSDB+CIDADANIA': '#0f7dc2', 'PSOL+REDE': '#b01455',
};
const FALLBACK = ['#6f8fa8', '#a8826f', '#7f9d7a', '#a07fa0', '#9a9460', '#6f9a93', '#b58a66', '#8a8fb0'];
/** Pulls a hue toward warm grey and caps its lightness, the same treatment used in Pelotão. */
function mute(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l0 = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  // keep the party's own hue and most of its saturation; only tame what would glare on the dark board
  const S = s * 0.9, L = Math.min(l0, 0.62) * 0.98;
  const f = (t: number) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}
const partyColors = new Map<string, string>();
const colorOf = (p: string) => {
  const key = party(p).toUpperCase();
  if (!partyColors.has(key)) {
    let hash = 0; for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    partyColors.set(key, mute(PARTY_COLORS[key] ?? FALLBACK[hash % FALLBACK.length]));
  }
  return partyColors.get(key)!;
};
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



/** Soft sounds for new votes and a lead change. Off by default; browsers only allow audio after a click. */
class Chime {
  private ctx: AudioContext | null = null;
  enabled = false;
  toggle() { this.enabled = !this.enabled; if (this.enabled && !this.ctx) this.ctx = new AudioContext(); if (this.ctx?.state === 'suspended') void this.ctx.resume(); return this.enabled; }
  private tone(freq: number, at: number, dur: number, gain: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime + at); g.gain.linearRampToValueAtTime(gain, ctx.currentTime + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.05);
  }
  votes() { if (this.enabled && this.ctx) { this.tone(880, 0, 0.18, 0.06); this.tone(1320, 0.07, 0.22, 0.04); } }
  overtake() { if (this.enabled && this.ctx) { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.09, 0.5, 0.07)); } }
}
const chime = new Chime();
const lastVotes = new Map<string, number>();
/** Replay state: live follows the collector; otherwise `at` is the instant shown, advancing at `speed` while playing. */
const rp = { live: true, playing: false, speed: 60, at: 0 };
const loud = () => rp.live || rp.speed <= 10;
const lastLeader = new Map<Office, string>();
/** Fixed per race: only ever grows, so a runner climbs exactly by the votes it receives. */

let snap: Snapshot;

/** Candidate panel: the cities where this candidate got most votes (data from /api/municipal, loaded on demand). */
function openCandidate(office: Office, c: RankedCandidate) {
  document.querySelector('.modal')?.remove();
  const lane = LANES.find(l => l.office === office)!;
  const race = snap.races[office];
  const modal = el('div', 'modal');
  const sheet = el('div', 'sheet cand'); modal.appendChild(sheet);
  const url = race ? photoUrl(race, c.id) : null;
  const iniciais = initials(nameOf(c));
  const terr = `/territorio.html?mode=${MODE}&uf=${UF}&turn=${TURN}&cargo=${office}&c=${office}-${encodeURIComponent(c.number)}`;
  sheet.innerHTML = `<header><div class="cph" style="--c:${colorOf(c.party)}"><span>${esc(iniciais)}</span>${url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : ''}</div><div class="ch"><div class="t">${esc(nameOf(c))}</div><div class="s">${esc(lane.title)} · ${esc(party(c.party))} ${esc(c.number)} · <b>${fmtInt(c.votes)}</b> votos · <b>${fmtPercent(c.percent, 2)}</b></div><div class="s half"></div></div><a class="terr" href="${terr}">Ver no Território</a><input placeholder="Buscar cidade" aria-label="Buscar cidade"><button aria-label="Fechar">✕</button></header><div class="status"></div><div class="scroll"><table><colgroup><col style="width:8%"><col style="width:40%"><col style="width:18%"><col style="width:16%"><col style="width:18%"></colgroup><thead><tr><th>#</th><th>Cidade</th><th class="r">Votos</th><th class="r">% válidos</th><th class="r">Posição na cidade</th></tr></thead><tbody></tbody></table><div class="more"></div></div><div class="note">Votos por município publicados pelo TSE.</div>`;
  const input = sheet.querySelector('input')!, body = sheet.querySelector('tbody')!, status = sheet.querySelector('.status') as HTMLElement, half = sheet.querySelector('.half') as HTMLElement, more = sheet.querySelector('.more') as HTMLElement;
  type Row = { name: string; uf: string; f: string; votes: number; valid: number; pos: number };
  let rows: Row[] = [], shownN = 200, timer = 0, closed = false;
  const draw = () => {
    const q = fold(input.value.trim());
    const list = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.f.includes(q));
    body.innerHTML = list.slice(0, shownN).map(({ r, i }) => `<tr><td class="muted">${i + 1}º</td><td>${esc(r.name)} <small>(${esc(r.uf)})</small></td><td class="r">${fmtInt(r.votes)}</td><td class="r">${r.valid ? fmtPercent(r.votes / r.valid * 100, 1) : '—'}</td><td class="r"><span class="pos" style="--c:${colorOf(c.party)}">${r.pos}º</span></td></tr>`).join('') || (rows.length ? `<tr><td colspan="5" class="muted">Nenhuma cidade encontrada.</td></tr>` : '');
    more.textContent = list.length > shownN ? `Mostrando ${fmtInt(shownN)} de ${fmtInt(list.length)} cidades · role para ver mais` : '';
  };
  const load = async () => {
    if (closed) return;
    let p: { status: string; message: string; loaded: number; total: number; c: [string, number][]; m: [string, string, string, number, number[]][] } | null = null;
    try { const r = await fetch(`/api/municipal?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${office}`, { cache: 'no-store' }); p = r.ok ? await r.json() : null; } catch { p = null; }
    if (closed) return;
    if (!p) { status.textContent = 'Não foi possível carregar os municípios agora. Tentando de novo…'; timer = window.setTimeout(load, 3000); return; }
    const idx = (p.c || []).findIndex(x => x[0] === c.number);
    rows = [];
    if (idx >= 0) for (const [, nm, uf, vv, pairs] of p.m || []) {
      for (let k = 0; k < pairs.length; k += 2) if (pairs[k] === idx) { const name = titleCase(nm); rows.push({ name, uf, f: fold(name), votes: pairs[k + 1], valid: vv, pos: k / 2 + 1 }); break; }
    }
    rows.sort((a, b) => b.votes - a.votes);
    const total = rows.reduce((a, r) => a + r.votes, 0);
    let acc = 0, n = 0; for (const r of rows) { if (acc >= total / 2) break; acc += r.votes; n++; }
    half.innerHTML = rows.length ? `Metade dos votos veio de <b>${fmtInt(n)}</b> ${n === 1 ? 'município' : 'municípios'} · votos em <b>${fmtInt(rows.length)}</b>` : '';
    const ready = p.status === 'ready';
    status.textContent = ready ? '' : p.total ? `Carregando municípios · ${fmtInt(p.loaded)} de ${fmtInt(p.total)}` : (p.message || 'Carregando municípios…');
    draw();
    if (!ready) timer = window.setTimeout(load, 2500);
  };
  input.addEventListener('input', () => { shownN = 200; draw(); });
  sheet.querySelector('.scroll')!.addEventListener('scroll', e => { const t = e.target as HTMLElement; if (t.scrollTop + t.clientHeight > t.scrollHeight - 300 && more.textContent) { shownN += 200; draw(); } });
  const close = () => { closed = true; clearTimeout(timer); modal.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  sheet.querySelector('button')!.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  modal.style.setProperty('--k', app.style.getPropertyValue('--k'));
  status.textContent = 'Carregando municípios…';
  void load();
}

function openTable(office: Office, query = '', highlight?: string, scoped?: Race) {
  document.querySelector('.modal')?.remove();
  const lane = LANES.find(l => l.office === office)!;
  let race = scoped ?? snap.races[office];
  const modal = el('div', 'modal');
  const sheet = el('div', 'sheet'); modal.appendChild(sheet);
  const legislative = legislativeOf(office);
  const defined = race && legislative ? seatsByParty(race, YEAR).reduce((a, p) => a + p.seats, 0) : 0;
  sheet.innerHTML = `<header><div><div class="t">${lane.title}</div><div class="s">${office === 'president' ? (race && race.uf !== 'BR' ? esc(stateName(race.uf)) : 'Brasil') : esc(stateName(UF))} · ${race ? `${fmtPercent(race.countedPercent, 1)} apurado` : 'sem dados'}${race && legislative ? ` · ${defined} de ${race.seats} vagas definidas` : ''} · ${race ? race.candidates.length : 0} candidaturas</div></div><input placeholder="Buscar nome, número ou partido" aria-label="Buscar nesta corrida"><button aria-label="Fechar">✕</button></header><div class="scroll"><table><colgroup><col style="width:8%"><col style="width:30%"><col style="width:10%"><col style="width:10%"><col style="width:15%"><col style="width:12%"><col style="width:15%"></colgroup><thead><tr><th>Raia</th><th>Candidatura</th><th>Número</th><th>Partido</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr></thead><tbody></tbody></table></div><div class="note">A ordem de votação não define as vagas proporcionais; a situação é a publicada pela fonte.</div>`;
  const input = sheet.querySelector('input')!; input.value = query;
  const body = sheet.querySelector('tbody')!;
  const cut = office === 'senate' && race ? contestedSeats(race, 'senate', YEAR) : 0;
  const draw = () => {
    const q = fold(input.value.trim());
    const matches = all(race).filter(c => !q || fold(`${c.name} ${c.number} ${c.party}`).includes(q) || c.id === highlight);
    // Thousands of deputy candidacies: render the first 400, the search reaches all of them.
    const rows = matches.length > 400 ? [...matches.slice(0, 400), ...matches.filter((c, i) => i >= 400 && c.id === highlight)] : matches;
    body.innerHTML = rows.length ? rows.map(c => { const [cls, label] = statusOf(c); return `<tr class="${c.id === highlight ? 'hl' : ''} ${cut && c.rank === cut && !q ? 'cut' : ''}"><td><span class="lanebox">${c.rank}</span></td><td><span class="sw" style="background:${colorOf(c.party)}"></span>${esc(nameOf(c))}</td><td>${esc(c.number)}</td><td>${esc(party(c.party))}</td><td class="r">${fmtInt(c.votes)}</td><td class="r">${fmtPercent(c.percent, 2)}</td><td class="st ${cls}">${esc(label)}</td></tr>`; }).join('')
      : `<tr><td colspan="7" style="color:#8e8c86">Nenhuma candidatura encontrada para “${esc(input.value)}”.</td></tr>`;
    if (matches.length > rows.length) body.insertAdjacentHTML('beforeend', `<tr><td colspan="7" style="color:#8e8c86">Mostrando 400 de ${fmtInt(matches.length)} candidaturas. Use a busca para encontrar as demais.</td></tr>`);
    body.querySelector('tr.hl')?.scrollIntoView({ block: 'center' });
  };
  input.addEventListener('input', draw); draw();
  /*
   * A tabela é quem pede a lista inteira.
   *
   * O snapshot manda só a cabeça de uma proporcional — mandar as mil e poucas candidaturas em
   * cada quadro custaria quatro vezes o peso do que a tela desenha. Aqui, aberta uma vez, ela
   * busca o resto e se redesenha; até chegar, mostra o que o painel já tinha.
   */
  if (race?.candidateCount && race.candidateCount > race.candidates.length) {
    const escopo = scoped && scoped.uf !== 'BR' ? `&scope=${scoped.uf}` : '';
    void fetch(`/api/race?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${office}${escopo}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() as Promise<{ candidates: Race['candidates'] }> : null)
      .then(full => {
        if (!full || !modal.isConnected || !race) return;
        race = { ...race, candidates: full.candidates, candidateCount: undefined };
        sheet.querySelector('.s')!.textContent = `${sheet.querySelector('.s')!.textContent!.replace(/· \d[\d.]* candidaturas$/, '')}· ${fmtInt(full.candidates.length)} candidaturas`;
        draw();
      }).catch(() => { /* fica a cabeça da lista */ });
  }
  const close = () => { modal.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  sheet.querySelector('button')!.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  modal.style.setProperty('--k', app.style.getPropertyValue('--k'));
  input.focus();
}

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
      openTable(l.office, '', undefined, l.office === 'president' ? presRace() : undefined);
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
    const hi0 = Math.max(...vals, 1);
    // No majority line: half of the valid votes is a moving target while they are still being
    // counted, so crossing today's half assures nothing. The scale just frames the curves.
    const top = share ? Math.min(100, Math.max(hi0 * 1.12, 1)) : Math.max(hi0 * 1.08, 1);
    // a decimal ladder, so the labels land on round vote counts — or on round points
    const decade = Math.pow(10, Math.floor(Math.log10(top)));
    const ystep = share
      ? ([1, 2, 5, 10, 20, 25].find(v => top / v <= 5) ?? 50)
      : ([.1, .2, .25, .5, 1, 2].map(m => m * decade).find(v => top / v <= 5) ?? decade * 2);
    const raw = Math.ceil(top / ystep) * ystep;
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
        if (c) m.addEventListener('click', () => { const cc = all(snap.races[col.l.office]).find(x => x.id === s.id); if (cc) openCandidate(col.l.office, cc); });
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
    if (!m) { openTable(office, '', id); return; }
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
    const mobile = W < 900 || W / H < 1;
    const k = mobile ? W / 600 : Math.min(W / 3440, H / 1440);
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
