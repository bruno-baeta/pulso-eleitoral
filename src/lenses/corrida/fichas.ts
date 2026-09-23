/**
 * As duas folhas que abrem por cima da Corrida.
 *
 * A tela mostra as primeiras raias de cada disputa; estas respondem o que ela não cabe:
 *
 *   `abrirTabela`   — a disputa inteira, todas as candidaturas, com busca e a linha de corte.
 *   `abrirCandidato` — de onde vieram os votos de uma candidatura, município a município.
 *
 * Elas não guardam estado do painel: recebem o snapshot que está no ar e o cargo, e se viram.
 */
import { expandirCandidatura, type CandidaturaCompacta, type Office, type Snapshot, type WireRace as Race } from '../../../shared/types';
import type { RankedCandidate } from '../../domain/derive';
import { MODE, TURN, UF, all, contestedSeats, el, esc, fmtInt, fmtPercent, fold, initials, party, photoUrl, seatsByParty, stateName, titleCase, momentoNoAr} from '../../shell/dados';
import { colorOf } from './cores';

const YEAR = MODE === 'historico' ? 2022 : 2026;
const legislativeOf = (o: Office) => o === 'federal' || o === 'state';
const nomeDe = (c: RankedCandidate) => titleCase(c.name).replace(/ ([a-z])$/, m => m.toUpperCase());
const situacaoDe = (c: RankedCandidate) => c.statusKey === 'elected' ? ['elected', 'eleito'] : c.statusKey === 'runoff' ? ['runoff', '2º turno'] : c.statusKey === 'in_seat_range' ? ['range', 'na faixa'] : c.statusKey === 'leading' ? ['lead', 'lidera'] : c.statusKey === 'alternate' ? ['', 'suplente'] : c.statusKey === 'not_elected' ? ['', 'não eleito'] : ['', ''];

/** O título de cada disputa, como o cabeçalho das folhas o escreve. */
export const TITULOS: Record<Office, string> = {
  president: 'Presidente', governor: 'Governador', senate: 'Senado',
  federal: 'Dep. federais', state: UF === 'DF' ? 'Dep. distritais' : 'Dep. estaduais',
};

/** Candidate panel: the cities where this candidate got most votes (data from /api/municipal, loaded on demand). */
export function abrirCandidato(snap: Snapshot, office: Office, c: RankedCandidate) {
  document.querySelector('.modal')?.remove();
  const race = snap.races[office];
  const modal = el('div', 'modal');
  const sheet = el('div', 'sheet cand'); modal.appendChild(sheet);
  const url = race ? photoUrl(race, c.id) : null;
  const iniciais = initials(nomeDe(c));
  const terr = `/territorio.html?mode=${MODE}&uf=${UF}&turn=${TURN}&cargo=${office}&c=${office}-${encodeURIComponent(c.number)}`;
  sheet.innerHTML = `<header><div class="cph" style="--c:${colorOf(c.party)}"><span>${esc(iniciais)}</span>${url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : ''}</div><div class="ch"><div class="t">${esc(nomeDe(c))}</div><div class="s">${esc(TITULOS[office])} · ${esc(party(c.party))} ${esc(c.number)} · <b>${fmtInt(c.votes)}</b> votos · <b>${fmtPercent(c.percent, 2)}</b></div><div class="s half"></div></div><a class="terr" href="${terr}">Ver no Território</a><input placeholder="Buscar cidade" aria-label="Buscar cidade"><button aria-label="Fechar">✕</button></header><div class="status"></div><div class="scroll"><table><colgroup><col style="width:8%"><col style="width:40%"><col style="width:18%"><col style="width:16%"><col style="width:18%"></colgroup><thead><tr><th>#</th><th>Cidade</th><th class="r">Votos</th><th class="r">% válidos</th><th class="r">Posição na cidade</th></tr></thead><tbody></tbody></table><div class="more"></div></div><div class="note">Votos por município publicados pelo TSE.</div>`;
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
    // O instante reproduzido vai junto: a gravação por cidade devolve a tabela daquele momento.
    const at = momentoNoAr();
    try { const r = await fetch(`/api/municipal?mode=${MODE}&uf=${UF}&turn=${TURN}&office=${office}${at == null ? '' : `&at=${Math.round(at)}`}`, { cache: 'no-store' }); p = r.ok ? await r.json() : null; } catch { p = null; }
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
    if (!ready && at == null) timer = window.setTimeout(load, 2500);
  };
  input.addEventListener('input', () => { shownN = 200; draw(); });
  sheet.querySelector('.scroll')!.addEventListener('scroll', e => { const t = e.target as HTMLElement; if (t.scrollTop + t.clientHeight > t.scrollHeight - 300 && more.textContent) { shownN += 200; draw(); } });
  const close = () => { closed = true; clearTimeout(timer); modal.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  sheet.querySelector('button')!.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  modal.style.setProperty('--k', document.documentElement.style.getPropertyValue('--k'));
  status.textContent = 'Carregando municípios…';
  void load();
}

export function abrirTabela(snap: Snapshot, office: Office, query = '', highlight?: string, scoped?: Race) {
  document.querySelector('.modal')?.remove();
  let race = scoped ?? snap.races[office];
  const modal = el('div', 'modal');
  const sheet = el('div', 'sheet'); modal.appendChild(sheet);
  const legislative = legislativeOf(office);
  const defined = race && legislative ? seatsByParty(race, YEAR).reduce((a, p) => a + p.seats, 0) : 0;
  sheet.innerHTML = `<header><div><div class="t">${TITULOS[office]}</div><div class="s">${office === 'president' ? (race && race.uf !== 'BR' ? esc(stateName(race.uf)) : 'Brasil') : esc(stateName(UF))} · ${race ? `${fmtPercent(race.countedPercent, 1)} apurado` : 'sem dados'}${race && legislative ? ` · ${defined} de ${race.seats} vagas definidas` : ''} · ${race ? race.candidates.length : 0} candidaturas</div></div><input placeholder="Buscar nome, número ou partido" aria-label="Buscar nesta corrida"><button aria-label="Fechar">✕</button></header><div class="scroll"><table><colgroup><col style="width:8%"><col style="width:30%"><col style="width:10%"><col style="width:10%"><col style="width:15%"><col style="width:12%"><col style="width:15%"></colgroup><thead><tr><th>Raia</th><th>Candidatura</th><th>Número</th><th>Partido</th><th class="r">Votos</th><th class="r">% válidos</th><th>Situação</th></tr></thead><tbody></tbody></table></div><div class="note">A ordem de votação não define as vagas proporcionais; a situação é a publicada pela fonte.</div>`;
  const input = sheet.querySelector('input')!; input.value = query;
  const body = sheet.querySelector('tbody')!;
  const cut = office === 'senate' && race ? contestedSeats(race, 'senate', YEAR) : 0;
  const draw = () => {
    const q = fold(input.value.trim());
    const matches = all(race).filter(c => !q || fold(`${c.name} ${c.number} ${c.party}`).includes(q) || c.id === highlight);
    // Thousands of deputy candidacies: render the first 400, the search reaches all of them.
    const rows = matches.length > 400 ? [...matches.slice(0, 400), ...matches.filter((c, i) => i >= 400 && c.id === highlight)] : matches;
    body.innerHTML = rows.length ? rows.map(c => { const [cls, label] = situacaoDe(c); return `<tr class="${c.id === highlight ? 'hl' : ''} ${cut && c.rank === cut && !q ? 'cut' : ''}"><td><span class="lanebox">${c.rank}</span></td><td><span class="sw" style="background:${colorOf(c.party)}"></span>${esc(nomeDe(c))}</td><td>${esc(c.number)}</td><td>${esc(party(c.party))}</td><td class="r">${fmtInt(c.votes)}</td><td class="r">${fmtPercent(c.percent, 2)}</td><td class="st ${cls}">${esc(label)}</td></tr>`; }).join('')
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
      .then(r => r.ok ? r.json() as Promise<{ candidates: CandidaturaCompacta[] }> : null)
      .then(resposta => {
        if (!resposta || !modal.isConnected || !race) return;
        const full = { candidates: resposta.candidates.map(expandirCandidatura) };
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
  modal.style.setProperty('--k', document.documentElement.style.getPropertyValue('--k'));
  input.focus();
}

