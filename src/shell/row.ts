/**
 * A linha do candidato, compartilhada pela Corrida e pelo Território, para as duas não divergirem.
 *
 * Reading order: position, photo, name, party and votes, the share as a big number on the right,
 * and a rule across the full width of the line carrying the share as length.
 *
 * Sizes carry a floor: the design is calibrated for 3440×1440 and `--k` is .56 on a 1080p screen,
 * which alone would render every measure at little over half. Past ~1440p the computed value wins
 * and nothing changes. The line also answers to the width it is given: in a column narrower than
 * 430px the badge drops to the party line and the numbers give up a few pixels, so the name fits.
 */

export interface RowParts {
  /** 1-based place in the race; 0 prints nothing, for an aggregate line like "Outros". */
  place: number;
  name: string;
  party: string;
  /** Votes already counted, formatted ("57,26 mi"). */
  votes: string;
  /** Share of the valid votes, formatted ("48,43%"). */
  share: string;
  /** How much of the rule to fill, 0…1. */
  fill: number;
  /** The candidate's colour, for the rule. */
  color: string;
  /** Photo markup (an `<img>`, initials, or both). */
  photo: string;
  /** Optional badge: "Eleito", "2º turno". */
  tag?: string;
  /** Extra class for the badge, e.g. `el` or `rn`. */
  tagClass?: string;
  /**
   * What moved on the last update. The reading is the caller's: a majoritarian race talks in
   * points of margin, a proportional one in places gained or lost.
   */
  trend?: { dir: 1 | -1; text: string; title: string };
  /** An aggregate line ("Outros"), not a candidacy: no place, no photo, quieter type. */
  summary?: boolean;
  /** Anything else to append inside the line. */
  extra?: string;
}

import { esc } from '../domain/format';

/** The inner markup of a line. The caller owns the element and gives it the class `crow`. */
export function rowInner(p: RowParts): string {
  // The badge rides under the share, on the right: the name line keeps its whole width.
  const tag = p.tag ? `<span class="crow-tag ${p.tagClass ?? ''}">${esc(p.tag)}</span>` : '';
  // Which way the margin moved on the last update: ahead of the runner-up for the leader,
  // behind the leader for everyone else.
  // The sign carries the direction, so there is no arrow to read on top of it.
  const trend = p.trend
    ? `<span class="crow-trend ${p.trend.dir > 0 ? 'up' : 'down'}" title="${esc(p.trend.title)}" aria-label="${esc(p.trend.title)}">`
      + `${esc(p.trend.text)}</span>`
    : '';
  return (p.summary ? '' : `<span class="crow-n">${p.place || ''}</span><span class="crow-ph">${p.photo}</span>`)
    + `<span class="crow-body">`
    + `<span class="crow-l1"><b>${esc(p.name)}</b>${trend}</span>`
    + (p.party || p.votes
      ? `<span class="crow-l2"><span class="crow-p">${esc(p.party)}</span>${p.votes ? `<strong>${esc(p.votes)}</strong>` : ''}</span>`
      : '')
    + `</span>`
    + `<span class="crow-right"><span class="crow-pct">${esc(p.share)}</span>${tag}</span>`
    + `<span class="crow-bar"><i style="width:${Math.max(0.5, Math.min(100, p.fill * 100)).toFixed(1)}%;background:${p.color}"></i></span>`
    + (p.extra ?? '');
}

const px = (n: number, min: number) => `max(calc(${n}px * var(--k)), ${min}px)`;

/**
 * The views set `--k` inside their layout pass, which only runs once the data has arrived. Until
 * then every `calc(Npx * var(--k))` is invalid and the chrome paints at its natural size — the
 * search lens filling the screen for a second. This puts a sane value on the page immediately.
 */
export function seedScale() {
  const apply = () => {
    const w = innerWidth, h = innerHeight;
    const k = w < 900 || w / h < 1 ? w / 600 : Math.min(w / 3440, h / 1440);
    document.documentElement.style.setProperty('--k', String(k));
  };
  apply();
  addEventListener('resize', apply);
}

export const ROW_CSS = `
  /* all:unset comes first: the line may be a button, and the browser's own styling has to go. */
  .crow { all: unset; box-sizing: border-box; width: 100%; display: grid;
          grid-template-columns: ${px(44, 22)} var(--crow-ph) minmax(0, 1fr) auto;
          column-gap: ${px(20, 16)}; row-gap: ${px(14, 13)};
          align-items: center; padding: ${px(16, 14)} 0 ${px(9, 8)};
          border-radius: ${px(14, 12)}; position: relative; cursor: pointer;
          --crow-ph: ${px(64, 52)}; }
  .crow-n { font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: ${px(22, 17)};
            color: #5e5c57; text-align: left; font-variant-numeric: tabular-nums; }
  .crow-ph { position: relative; width: var(--crow-ph); height: var(--crow-ph); border-radius: 50%; overflow: hidden;
             background: #1f2220; display: grid; place-items: center; font-family: 'Barlow Condensed', sans-serif;
             font-weight: 600; font-size: calc(var(--crow-ph) * .36); color: #a9a69f; }
  .crow-ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 18%; }
  .crow-body { min-width: 0; }
  .crow-l1 { display: flex; align-items: center; gap: ${px(12, 10)}; min-width: 0; }
  .crow-trend { flex: none; font-size: ${px(17, 13)}; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .crow-trend.up { color: #4fd18b; } .crow-trend.down { color: #ff6b6b; }
  .crow-l1 b { min-width: 0; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: ${px(34, 27)};
               line-height: 1.1; color: #f6f3ec; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crow-l2 { display: flex; align-items: baseline; gap: ${px(10, 9)}; margin-top: ${px(6, 6)};
             font-size: ${px(19, 15)}; color: #8b8882; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .crow-l2 .crow-p { color: #75726c; letter-spacing: .04em; }
  .crow-l2 strong { color: #ebe8e1; font-weight: 600; }
  /* Kept narrow on purpose: this column is sized by its widest child, and a roomy badge
     would steal the width the name needs. */
  .crow-tag { flex: none; padding: ${px(3, 2)} ${px(8, 7)}; border-radius: 999px; font-size: ${px(12, 10)};
              font-weight: 600; letter-spacing: .06em; text-transform: uppercase; background: #1d201e; color: #9b9892; white-space: nowrap; }
  .crow-tag.el { background: rgba(127,196,150,.12); color: #8fc9a3; }
  .crow-tag.rn { background: rgba(214,190,128,.12); color: #d8c28a; }
  .crow-tag.win { background: rgba(214,205,180,.1); color: #d9d2bd; }
  .crow-right { align-self: start; margin-top: ${px(2, 2)}; display: flex; flex-direction: column;
                align-items: flex-end; gap: ${px(6, 5)}; }
  .crow-pct { font-family: 'Barlow Condensed', sans-serif; font-weight: 600;
              font-size: ${px(34, 27)}; line-height: 1.1; color: #f6f3ec; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .crow-bar { grid-column: 1 / -1; display: block; height: ${px(3, 3)}; border-radius: 2px; background: #1c1f1d; overflow: hidden; }
  .crow-bar i { display: block; height: 100%; opacity: .75; }

  /* The aggregate line is not a candidacy: it drops the place and the photo, speaks in the page's
     own type instead of the display face, and keeps the share so the column stays comparable. */
  .crow.sum { grid-template-columns: minmax(0, 1fr) auto; }
  .crow.sum .crow-l1 b { font-family: inherit; font-weight: 500; font-size: ${px(21, 16)};
                         letter-spacing: .01em; color: #8b8882; }
  .crow.sum .crow-l2 { color: #6f6d68; }
  .crow.sum .crow-pct { font-weight: 500; color: #a8a49b; }
  .crow.sum .crow-bar { height: ${px(2, 2)}; background: transparent; }
  .crow.sum .crow-bar i { opacity: .4; }
  .crow.sum:hover .crow-l1 b, .crow.sum:hover .crow-pct { color: #d8d5cd; }

  /* Narrow column: the badge moves down and the numbers give up a few pixels, so the name fits. */
  @container (max-width: 430px) {
    .crow { column-gap: ${px(14, 11)};
            grid-template-columns: ${px(22, 15)} var(--crow-ph) minmax(0, 1fr) auto; }
    .crow-l1 b { font-size: ${px(30, 24)}; }
    .crow-pct { font-size: ${px(30, 24)}; }
  }
`;

/* ──────────────────────────── search results ──────────────────────────── */

export interface HitParts {
  /** Photo markup (an `<img>`, initials, or both). Empty for a hit that is not a candidacy. */
  photo?: string;
  /** The name. Already escaped by the caller, which may wrap matches in `<mark>`. */
  name: string;
  /** The line under it: party, race, place. Already escaped. */
  meta?: string;
  /** The figure on the right: a share or a tally. */
  value?: string;
}

/** One line of a search result list, the same on every screen. */
export function hitInner(p: HitParts): string {
  return `<span class="sres-ph">${p.photo ?? ''}</span>`
    + `<span class="sres-nm"><b>${p.name}</b>${p.meta ? `<span>${p.meta}</span>` : ''}</span>`
    + `<span class="sres-val">${p.value ?? ''}</span>`;
}

export const HIT_CSS = `
  .sres { all: unset; box-sizing: border-box; cursor: pointer; display: grid;
          grid-template-columns: ${px(56, 42)} minmax(0, 1fr) auto; gap: ${px(16, 12)};
          align-items: center; width: 100%; padding: ${px(12, 9)} ${px(20, 14)}; border-top: 1px solid #1f2320; }
  .sres:first-child { border-top: 0; }
  .sres:hover, .sres:focus-visible, .sres.on { background: #202421; }
  .sres-ph { position: relative; overflow: hidden; width: ${px(56, 42)}; height: ${px(56, 42)}; border-radius: 50%;
             background: #1c1f1c; display: grid; place-items: center; font-family: 'Barlow Condensed', sans-serif;
             font-weight: 600; font-size: ${px(20, 15)}; color: #cbc8c0; }
  .sres-ph:empty { display: none; }
  .sres:has(.sres-ph:empty) { grid-template-columns: minmax(0, 1fr) auto; }
  .sres-ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 24%; }
  .sres-nm { min-width: 0; }
  .sres-nm b { display: block; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: ${px(26, 20)};
               letter-spacing: .04em; text-transform: uppercase; color: #f6f3ec;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sres-nm span { display: block; font-size: ${px(17, 13)}; font-weight: 600; letter-spacing: .06em; color: #8e8c86;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sres-nm mark { background: none; color: #f6f3ec; }
  .sres-nm em { font-style: normal; color: #a8a49b; }
  .sres-val { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: ${px(26, 20)};
              color: #f6f3ec; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sres-none { padding: ${px(18, 14)} ${px(20, 14)}; color: #8e8c86; font-size: ${px(20, 14)}; }
`;
