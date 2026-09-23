/**
 * O estilo da Corrida.
 *
 * Fica aqui, e não junto do desenho, pela mesma razão que a TV e o Território têm o seu: são
 * duzentas e poucas linhas de CSS, e misturadas ao código elas empurravam a lógica da tela para
 * o fim de um arquivo de mil e duzentas linhas.
 */
export const CSS = `
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
