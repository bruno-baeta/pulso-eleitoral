/** Território · page CSS. `--k` scales from the 3440×1440 design; the shared shell bar sits at the top right. */
export const CSS = `
  html, body { margin: 0; height: 100%; background: #0a0c0b; font-family: 'DM Sans Variable', system-ui, sans-serif; color: #e9e6df; -webkit-font-smoothing: antialiased; }
  body { overflow: hidden; }
  #app { position: fixed; inset: 0; background: radial-gradient(80% 100% at 36% 50%, #121513 0%, #0c0e0d 60%, #090a0a 100%); }
  .stage { position: absolute; inset: 0; overflow: hidden; }
  .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* Quiet shade under the ranking column, so the map can run beneath it when zoomed in. */
  .shade { position: absolute; top: 0; right: 0; bottom: 0; width: calc(1260px * var(--k)); pointer-events: none; background: linear-gradient(90deg, rgba(10,12,11,0) 0%, rgba(10,12,11,.82) 22%, rgba(10,12,11,.93) 45%); }

  .tabs { position: absolute; right: calc(72px * var(--k)); top: calc(var(--sh-head, 0px) + 126px * var(--k)); z-index: 4; display: inline-flex; padding: calc(4px * var(--k)); border-radius: 999px; background: rgba(18,21,19,.85); border: 1px solid #242826; }
  .tabs button { all: unset; position: relative; cursor: pointer; padding: calc(10px * var(--k)) calc(22px * var(--k)); border-radius: 999px; font-size: calc(19px * var(--k)); font-weight: 600; color: #8b8882; white-space: nowrap; }
  .tabs button:hover { color: #d6d3cc; }
  .tabs button.on { background: #2a2e2b; color: #f3f0e9; }
  .tabs button.off { color: #5a5853; }
  /* Hosted by the app header, like the chart screen: a segmented control, not a floating strip. */
  .sh-head .tabs { position: static; right: auto; top: auto; margin-left: calc(14px * var(--k)); padding: calc(3px * var(--k)); gap: calc(3px * var(--k)); background: rgba(255,255,255,.05); border: 0; }
  .sh-head .tabs button { padding: calc(8px * var(--k)) calc(15px * var(--k)); font-size: calc(19px * var(--k)); font-weight: 600; letter-spacing: .04em; color: #85837c; }
  .sh-head .tabs button:hover { color: #d8d5cd; }
  .sh-head .tabs button.on { background: #2f3431; color: #f2efe8; }
  .sh-head .find { position: absolute; left: 50%; top: auto; transform: translateX(-50%); width: auto; margin: 0; }
  .sh-head .find .sugg { top: calc(100% + 8px * var(--k)); }
  .tabs button.loading::after { content: ''; position: absolute; left: 30%; right: 30%; bottom: calc(4px * var(--k)); height: 2px; border-radius: 1px; background: #9b9892; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .tabs button:focus-visible, .rank button:focus-visible, .search input:focus-visible { outline: 2px solid #d9c9a0; outline-offset: 2px; }

  .rank { position: absolute; right: calc(72px * var(--k)); top: calc(var(--sh-head, 0px) + 24px * var(--k)); bottom: calc(var(--pl-h, 0px) + 16px * var(--k)); width: calc(900px * var(--k)); z-index: 3; display: flex; flex-direction: column; transition: opacity .2s; }
  .rank .head { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: calc(20px * var(--k)); padding: 0 0 calc(18px * var(--k)); border-bottom: 1px solid #1f2320; }
  .rank .head { --rank-pad: max(calc(18px * var(--k)), 14px); }
  .rank .eyebrow { font-size: max(calc(16px * var(--k)), 12px); font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #95928b; }
  .rank h2 { margin: calc(8px * var(--k)) 0 0; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(48px * var(--k)); line-height: 1; color: #f6f3ec; }
  .rank h2 small { margin-left: calc(10px * var(--k)); font-family: 'DM Sans Variable', sans-serif; font-size: calc(17px * var(--k)); letter-spacing: .14em; color: #75726c; font-weight: 600; }
  .rank .sub { margin-top: calc(8px * var(--k)); font-size: max(calc(18px * var(--k)), 13px); color: #95928b; font-variant-numeric: tabular-nums; }
  .rank .acts { display: flex; flex-direction: column; align-items: flex-end; gap: calc(8px * var(--k)); }
  .rank .chip { all: unset; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: calc(8px * var(--k)); padding: calc(8px * var(--k)) calc(16px * var(--k)); border-radius: 999px; border: 1px solid #2c302d; font-size: calc(17px * var(--k)); color: #b9b6ae; white-space: nowrap; }
  .rank .chip:hover { background: #1a1d1b; color: #f3f0e9; }
  .rank .chip b { font-weight: 400; font-size: 1.25em; line-height: 1; color: #8b8882; }
  .rank .list { container-type: inline-size; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #2a2e2b transparent; margin: 0; padding: calc(10px * var(--k)) 0 calc(6px * var(--k)); list-style: none; }
  .rank .list.long li { content-visibility: auto; contain-intrinsic-size: auto calc(110px * var(--k)); }
  .rank .list li + li { margin-top: max(calc(6px * var(--k)), 5px); }
  .rank .empty { padding: calc(40px * var(--k)) calc(20px * var(--k)); font-size: calc(22px * var(--k)); color: #8b8882; line-height: 1.5; }
  .rank .empty b { display: block; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(34px * var(--k)); color: #dcd9d2; }
  /* The line needs room inside its own box, or hover and selection paint a slab that the content
     sits flush against. The head is inset by the same amount so the number still lines up with the
     eyebrow and the title above it. */
  .rank .head, .rank .sep, .rank .foot { padding-inline: var(--rank-pad); }
  .rank .crow { --rank-pad: max(calc(18px * var(--k)), 14px); padding-inline: var(--rank-pad);
                transition: background .14s ease; }
  .rank .list { --rank-pad: max(calc(18px * var(--k)), 14px); }
  .rank .crow:hover { background: rgba(255,255,255,.045); }
  /* Picked: the line stays a line — no card, no border, no rule down the side. It just lifts off
     the background, and the name goes white. */
  .rank .crow.on, .rank .crow.on:hover { background: linear-gradient(90deg, rgba(255,255,255,.075), rgba(255,255,255,.015) 70%); }
  .rank .crow.on .crow-l1 b { color: #fff; }
  .rank .crow.on .crow-n { color: #8e8b84; }
  .rank .crow.on .crow-ph .ph, .rank .crow.on .crow-ph img { box-shadow: 0 0 0 calc(3px * var(--k)) var(--c); }
  /* The fact sits on its own line under the row, across every column. */
  .rank .crow .crow-fact { grid-column: 1 / -1; display: block; margin-top: calc(4px * var(--k)); font-size: calc(18px * var(--k)); color: #9b9892; }
  .rank .crow .crow-fact strong { color: #ebe8e1; font-weight: 600; }
  .rank .sep { padding: calc(10px * var(--k)) 0 calc(4px * var(--k)); font-size: calc(15px * var(--k)); letter-spacing: .14em; text-transform: uppercase; color: #5e5c57; }
  .rank .foot { flex: none; padding: calc(12px * var(--k)) 0 0; border-top: 1px solid #1a1d1b; font-size: max(calc(15px * var(--k)), 12px); color: #85827b; }

  .find { position: absolute; left: calc(72px * var(--k)); top: calc(var(--sh-head, 0px) + 126px * var(--k)); z-index: 5; width: calc(460px * var(--k)); }
  .search { position: relative; }
  .search svg { position: absolute; left: calc(20px * var(--k)); top: 50%; transform: translateY(-50%); width: calc(20px * var(--k)); height: calc(20px * var(--k)); stroke: #8b8882; fill: none; stroke-width: 2; pointer-events: none; z-index: 1; }
  .search input { width: 100%; box-sizing: border-box; height: calc(56px * var(--k)); padding: 0 calc(20px * var(--k)) 0 calc(54px * var(--k)); border-radius: 999px; background: rgba(18,21,19,.85); border: 1px solid #2a2e2b; color: #f3f0e9; font: inherit; font-size: calc(21px * var(--k)); outline: none; }
  .search input::placeholder { color: #6f6c66; }
  .search input:focus { border-color: #4a4f4b; }
  .sugg { position: absolute; left: 0; right: 0; top: calc(64px * var(--k)); background: #151816; border: 1px solid #2a2e2b; border-radius: calc(14px * var(--k)); overflow: hidden; box-shadow: 0 calc(20px * var(--k)) calc(50px * var(--k)) rgba(0,0,0,.6); z-index: 2; }

  .progress { position: absolute; z-index: 4; transform: translateX(-50%); display: flex; flex-direction: column; gap: calc(10px * var(--k)); padding: calc(14px * var(--k)) calc(24px * var(--k)); border-radius: 999px; background: rgba(18,21,19,.9); border: 1px solid #262a27; font-size: calc(19px * var(--k)); color: #b9b6ae; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
  .progress[hidden], .pending[hidden] { display: none; }
  .progress b { color: #f3f0e9; font-weight: 600; }
  .progress i { display: block; height: 2px; border-radius: 1px; background: #262a27; overflow: hidden; }
  .progress i span { display: block; height: 100%; background: #b9b6ae; transition: width .6s; }

  /* A conferencia pelas cidades: campos do TSE somados, nenhum derivado. Fica abaixo do
     cabecalho, a esquerda, porque e numero para ser lido junto do mapa e nao no pe de uma lista. */
  .soma { position: absolute; left: calc(72px * var(--k));
    /* A variavel --sh-head e a altura da barra do aplicativo. Sem ela o bloco nascia atras do
       cabecalho e so a ultima linha aparecia. Sem crase neste comentario: ela fecharia o literal. */
    top: calc(var(--sh-head, 0px) + 26px * var(--k)); z-index: 3; pointer-events: none; }
  .soma:empty { display: none; }
  /* Estes numeros sao a conferencia da apuracao, e competem em tamanho com a legenda ao lado
     (17px) e com o mapa. Na primeira versao ficaram menores que a legenda e se liam como nota de
     rodape; aqui eles tem o corpo de quem e para ser lido de longe, na TV. */
  .soma-t { font-size: max(calc(20px * var(--k)), 15px); color: #85827b; margin-bottom: calc(14px * var(--k)); }
  .soma-t b { color: #e8e4dc; font-variant-numeric: tabular-nums; }
  .soma dl { display: flex; flex-wrap: wrap; gap: calc(14px * var(--k)) calc(34px * var(--k)); margin: 0; }
  .soma dl > div { display: flex; flex-direction: column; gap: calc(4px * var(--k)); }
  .soma dt { font-size: max(calc(17px * var(--k)), 13px); color: #6a6863; }
  .soma dd { margin: 0; font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: max(calc(44px * var(--k)), 28px); color: #e8e4dc; font-variant-numeric: tabular-nums; line-height: 1.05; }
  .soma .ap dd { color: #e8c877; }
  .soma-p { margin-top: calc(12px * var(--k)); font-size: max(calc(16px * var(--k)), 12px); color: #5c605b; }

  .legend { position: absolute; left: calc(72px * var(--k)); bottom: calc(var(--pl-h, 0px) + 14px * var(--k)); z-index: 3; font-size: max(calc(17px * var(--k)), 13px); color: #a3a099; pointer-events: none; }
  .legend > div { display: flex; flex-direction: column; gap: calc(8px * var(--k)); width: calc(380px * var(--k)); }
  .legend i { display: block; width: 100%; height: calc(8px * var(--k)); border-radius: 2px; }
  .legend .ends { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  .legend em { font-style: normal; color: #c2bfb7; white-space: nowrap; }
  .legend .wins { display: flex; flex-wrap: wrap; gap: calc(8px * var(--k)) calc(20px * var(--k)); width: calc(760px * var(--k)); margin-bottom: calc(10px * var(--k)); }
  .legend .wins span { display: inline-flex; align-items: center; gap: calc(8px * var(--k)); font-size: max(calc(17px * var(--k)), 13px); color: #d8d5cd; white-space: nowrap; }
  .legend .wins span b { color: #f3f0e9; font-weight: 600; font-variant-numeric: tabular-nums; }
  .legend .wins i { display: inline-block; width: calc(14px * var(--k)); height: calc(14px * var(--k)); border-radius: 3px; margin: 0; }
  .legend .src { white-space: nowrap; margin-top: calc(14px * var(--k)); font-size: max(calc(14px * var(--k)), 11px); color: #7d7a74; }

  .tip { position: fixed; z-index: 40; pointer-events: none; padding: calc(14px * var(--k)) calc(18px * var(--k)); border-radius: calc(12px * var(--k)); background: rgba(22,25,23,.96); border: 1px solid #2c302d; box-shadow: 0 calc(16px * var(--k)) calc(40px * var(--k)) rgba(0,0,0,.55); white-space: nowrap; }
  .tip .t { display: flex; align-items: center; gap: calc(18px * var(--k)); }
  .tip .n { font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(30px * var(--k)); color: #f6f3ec; line-height: 1; }
  .tip .n small { margin-left: calc(8px * var(--k)); font-family: 'DM Sans Variable', sans-serif; font-size: calc(14px * var(--k)); letter-spacing: .12em; color: #75726c; }
  .tip .chip { margin-left: auto; flex: none; min-width: calc(44px * var(--k)); box-sizing: border-box; text-align: center; padding: calc(5px * var(--k)) calc(12px * var(--k)); border-radius: 999px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: calc(22px * var(--k)); line-height: 1; font-variant-numeric: tabular-nums; }
  .tip .v { margin-top: calc(8px * var(--k)); font-size: calc(21px * var(--k)); color: #ebe8e1; font-variant-numeric: tabular-nums; }
  .tip .d { margin-top: calc(4px * var(--k)); font-size: calc(15px * var(--k)); color: #75726c; font-variant-numeric: tabular-nums; }
  .tip.pin { pointer-events: auto; padding-right: calc(58px * var(--k)); z-index: 41; }
  .tip.pin .chip { margin-right: calc(-6px * var(--k)); }
  .tip.pin .x { all: unset; position: absolute; top: calc(10px * var(--k)); right: calc(10px * var(--k)); width: calc(36px * var(--k)); height: calc(36px * var(--k)); display: grid; place-items: center; border-radius: 50%; cursor: pointer; color: #b9b6ae; font-size: calc(26px * var(--k)); line-height: 1; }
  .tip.pin .x:hover { background: #2a2e2c; color: #fff; }
  .tip.pin .x:focus-visible { outline: 2px solid #e8c877; }
  .pending { position: absolute; top: 50%; transform: translate(-50%, -50%); z-index: 6; max-width: calc(900px * var(--k)); padding: calc(34px * var(--k)) calc(46px * var(--k)); border-radius: calc(18px * var(--k)); background: rgba(16,19,17,.94); border: 1px solid #262a27; text-align: center; }
  .pending b { display: block; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: calc(40px * var(--k)); color: #f3f0e9; }
  .pending span { display: block; margin-top: calc(8px * var(--k)); font-size: calc(19px * var(--k)); color: #8b8882; }
  .note { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); color: #8b8882; font-size: 16px; }

  /* Legibility floor below the design sizes — see the note in shell.ts. */
  @media (max-width: 1800px) {
    .tabs button, .sh-head .tabs button { font-size: max(calc(19px * var(--k)), 13px); }
    .rank .empty { font-size: max(calc(22px * var(--k)), 13px); }
    .rank .empty b { font-size: max(calc(34px * var(--k)), 19px); }
    .rank .crow .crow-fact { font-size: max(calc(18px * var(--k)), 12px); }
    .legend, .legend .wins span { font-size: max(calc(17px * var(--k)), 12px); }
    .pending b, .pending span { font-size: max(calc(20px * var(--k)), 12px); }
    .progress, .progress span { font-size: max(calc(19px * var(--k)), 12px); }
  }

  @media (max-width: 900px) {
    .shade { display: none; }
    body { overflow: auto; }
    #app { position: static; min-height: 100%; padding-bottom: 40px; display: flex; flex-direction: column; }
    .stage { position: relative; inset: auto; height: 96vw; order: 1; flex: none; }
    .legend { left: 16px; bottom: 8px; font-size: 10px; } .legend > div { width: 180px; } .legend i { height: 5px; } .legend .src { display: none; }
    .legend .wins { width: calc(100vw - 32px); gap: 3px 10px; margin-bottom: 0; } .legend .wins i { width: 8px; height: 8px; }
    .progress { font-size: 11px; padding: 7px 12px; gap: 5px; }
    .find { position: static; order: 2; width: auto; padding: 8px 16px 0; }
    .search input { height: 44px; font-size: 15px; padding-left: 42px; } .search svg { left: 16px; width: 16px; height: 16px; }
    .sugg { top: 50px; } .sugg button { font-size: 15px; padding: 11px 14px; } .sugg small { font-size: 11px; }
    .tabs { position: static; order: 3; margin: 12px 16px 0; overflow-x: auto; scrollbar-width: none; align-self: flex-start; max-width: calc(100% - 32px); box-sizing: border-box; } .tabs button { font-size: 13px; padding: 8px 12px; }
    .rank { position: static; order: 4; width: auto; padding: 16px 8px 0; }
    .rank .list { max-height: 70vh; } .rank .empty { font-size: 13px; } .rank .empty b { font-size: 20px; }
    .rank .head { padding: 0 8px 12px; } .rank .eyebrow { font-size: 11px; } .rank h2 { font-size: 28px; } .rank h2 small { font-size: 11px; } .rank .sub { font-size: 12px; } .rank .chip { font-size: 12px; padding: 6px 12px; }
    .rank .crow .crow-fact { font-size: 12px; margin-top: 6px; }
    .rank .sep { font-size: 10px; } .rank .foot { font-size: 11px; padding: 10px 8px 0; }
    .tip .n { font-size: 18px; } .tip .v { font-size: 13px; } .tip { padding: 8px 10px; } .tip.pin { padding-right: 40px; } .tip.pin .x { width: 28px; height: 28px; font-size: 20px; top: 4px; right: 4px; }
    .tip .chip { font-size: 13px; padding: 3px 8px; min-width: 28px; } .tip .t { gap: 10px; }
    .pending { width: calc(100vw - 64px); box-sizing: border-box; padding: 18px; } .pending b { font-size: 20px; } .pending span { font-size: 12px; }
  }
`;
