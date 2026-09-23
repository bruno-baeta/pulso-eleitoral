import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { ARCHIVE, OFFICES, STATES, distinctColors, type Candidate, type Mode, type Office, type Race, type Snapshot, type StateProgress, type Turn, type FeedEvent, type WireRace } from '../shared/types.ts';
import { BASES, discoverElections, normalizeResult, normalizeProgress, officeCode, resultUrl, type ElectionRef } from './tse.ts';
import { archiveElection, archiveOffices, archiveProgress, archiveRef, normalizeArchive } from './archive.ts';
import { TseTransport } from './transport.ts';
import { Recorder } from './recorder.ts';
import { OFFICIAL_WINDOWS, SIMULADO_WINDOWS, openWindow, sessionWindow, describeWindow, nextWindow } from '../shared/windows.ts';

export interface Timeline { available: boolean; reason?: string; start: number; end: number; live: boolean; now: number }

/** Modes whose election IDs come from the TSE's live configuration file. */
type LiveMode = 'official' | 'simulado';
type RemoteMode = Mode;
const isLive = (mode: RemoteMode): mode is LiveMode => mode === 'official' || mode === 'simulado';
/** The archive never changes: one fetch per file, then served from memory. */
const ARCHIVE_TTL = 24 * 60 * 60_000;
/** Cadência dos estados que estão sendo apenas gravados, sem ninguém olhando (ver fetchRace). */
const TTL_GRAVACAO = 15_000;
/** How many events are kept per context. The night's thread is read after the fact, not only live. */
const FEED_MAX = 200;
/** Shares of the count worth being told about; anything finer is noise while you are not looking. */
const MARCOS = [1, 5, 10, 25, 50, 75, 90, 99];

const pp = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
/*
 * A margin in a race with hundreds of candidacies is often four decimals wide, and rounded to two
 * it reads "passa fulano por 0%", which says the opposite of what happened. Below that, the gap is
 * described instead of printed.
 */
const margem = (v: number) => Math.abs(v) < 0.01
  ? 'menos de 0,01 ponto'
  : `${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${Math.abs(v) < 2 ? 'ponto' : 'pontos'}`;
/*
 * Who leads a proportional race is not news: the top name among hundreds changes with almost every
 * file and means nothing for who takes the seats. Lead changes are announced for the races where
 * being ahead is the whole question.
 */
const MAJORITARIOS = new Set<Office>(['president', 'governor', 'senate']);
const quem = (c: Candidate) => ({ name: c.name, number: c.number, party: c.party, color: c.color });

/**
 * What changed between two readings of the same race, in the words someone would use to tell you.
 *
 * The feed used to carry one line per file — "84,01% das seções totalizadas" — repeated for every
 * office, which is the count talking to itself. What a person away from the screen wants to know
 * is narrower and rarer: who took the lead, which seats were decided, when the count crossed a
 * round number, and when it ended. Everything here is read off the two snapshots; nothing is
 * inferred beyond comparing them.
 */
export function feedEntries(before: Race | undefined, race: Race, area: string, office: Office, key: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  const onde = `${area} · ${OFFICES[office].short}`;
  const base = { at: race.receivedAt, uf: area, office };
  const mesmaEleicao = before?.election === race.election;

  // a lead change, which is the one thing that makes people look up
  const lider = race.candidates[0], antes = mesmaEleicao ? before?.candidates[0] : undefined;
  if (MAJORITARIOS.has(office) && lider && antes && antes.id !== lider.id && race.countedPercent > 0) {
    const gap = lider.percent - (race.candidates.find(c => c.id === antes.id)?.percent ?? 0);
    out.push({
      ...base, id: `${key}:lead:${lider.id}:${race.generationId || at0(race)}`, kind: 'lead',
      title: `Virada · ${onde}`, who: quem(lider),
      detail: `${lider.name} (${lider.party}) passa ${antes.name} (${antes.party}) por ${margem(gap)} com ${pp(race.countedPercent)} apurado.`,
    });
  }

  // seats the source itself declared decided
  const eleitosAntes = new Set((mesmaEleicao ? before?.candidates ?? [] : []).filter(c => c.elected).map(c => c.id));
  for (const c of race.candidates.filter(c => c.elected && !eleitosAntes.has(c.id))) {
    out.push({
      ...base, id: `${key}:elected:${c.id}`, kind: 'elected',
      title: `Eleito · ${onde}`, who: quem(c),
      detail: `${c.name} (${c.party}, ${c.number}) eleito com ${pp(c.percent)} dos votos válidos, a ${pp(race.countedPercent)} apurado.`,
    });
  }

  // round shares of the count, one line each instead of one per file
  const antesPct = mesmaEleicao ? before?.countedPercent ?? 0 : 0;
  for (const m of MARCOS) {
    if (antesPct < m && race.countedPercent >= m) {
      out.push({
        ...base, id: `${key}:marco:${m}`, kind: 'milestone', title: `${onde}`,
        detail: `${m}% das seções totalizadas. ${lider ? `${lider.name} (${lider.party}) à frente com ${pp(lider.percent)}.` : ''}`.trim(),
      });
    }
  }

  if (race.status === 'finished' && before?.status !== 'finished') {
    out.push({
      ...base, id: `${key}:fim`, kind: 'finished', title: `Totalização encerrada · ${onde}`,
      who: lider ? quem(lider) : undefined,
      detail: lider ? `${lider.name} (${lider.party}) termina com ${pp(lider.percent)} dos votos válidos.` : 'Totalização final informada pelo TSE.',
    });
  }
  return out;
}

const at0 = (race: Race) => (race.sourceAt ? Date.parse(race.sourceAt) : race.receivedAt);

/**
 * O que atravessa o fio.
 *
 * O snapshot inteiro é reenviado a cada leitura aceita, e um quinto do peso dele eram campos que
 * nenhuma tela desenha: a série histórica (que tem rota própria, /api/series), a lista de
 * partidos (a bancada é contada a partir das candidaturas), a URL de origem e os totais de
 * eleitorado, comparecimento e abstenção. O coletor continua guardando tudo — é o que a gravação
 * e o replay usam —, mas só isto é publicado.
 */
function paraRede(race: Race): WireRace {
  const {
    history: _h, parties: _p, sourceUrl: _u, receivedAt: _r, totalizedAt: _t, totalSections: _ts,
    totalVotes: _tv, blankVotes: _b, nullVotes: _n, electorate: _e, turnout: _c, abstention: _a,
    abstentionPercent: _ap, ...resto
  } = race;
  return resto;
}
const aoVivo = (races: Partial<Record<Office, Race>>): Snapshot['races'] =>
  Object.fromEntries(Object.entries(races).map(([office, race]) => [office, paraRede(race)]));

/** Bump whenever normalisation changes, so a stale cache is dropped instead of served. */
const STATE_VERSION = 2;
interface Subscription { mode: Mode; uf: string; turn: Turn; send: (snapshot: Snapshot) => void; signature: string }

export class Collector {
  readonly transport: TseTransport;
  readonly pollMs: number;
  private refs: Record<LiveMode, ElectionRef[]> = { official: [], simulado: [] };
  private archiveStates = new Map<string, Race>();
  private races = new Map<string, Race>();
  private progress = new Map<string, StateProgress[]>();
  private events = new Map<string, FeedEvent[]>();
  private subs = new Set<Subscription>();
  /** Contexts kept collecting for a while by other views (Território's municipal requests), without an event stream. */
  private touched = new Map<string, { mode: Mode; uf: string; turn: Turn; until: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setInterval>;
  private dirty = false;
  private saving = false;
  private lastSavedCooldown = 0;
  private busy = false;
  private jobs = new Set<string>();
  private raw = new Map<string, unknown>();
  readonly recorder: Recorder;
  /** States collected and recorded during TSE windows even with no browser open (RECORD_UFS=MG,SP or all). */
  private recordUfs: string[];
  /** Which simulation session the results in memory belong to (see dropStaleSimulado). */
  private simSession = '';

  constructor(private dataDir = './data') {
    // Measured: one state's five races plus its progress file are six URLs a cycle — 6 req/s at
    // this cadence, 6% of what the TSE allows. The ceiling was never what made the dashboard late;
    // this clock was, so it runs at the fastest the code permits.
    this.pollMs = Math.max(1000, Math.min(30000, Number(process.env.TSE_POLL_MS) || 1000));
    // The TSE allows 100 requests/s per IP. The ceiling here is half of that, and it is a ceiling
    // for the whole process, not per reader: the collector polls on its own clock and everyone is
    // served from what it already has, so the rate does not move with the number of people.
    this.transport = new TseTransport(Number(process.env.TSE_MAX_RPS) || 80);
    this.recorder = new Recorder(`${dataDir}/recordings`);
    /*
     * Todos os estados, por padrão.
     *
     * Gravava só Minas, e o resto do país só existia enquanto alguém estava com a tela aberta —
     * quem abrisse São Paulo no dia seguinte não tinha nem resultado nem linha do tempo. Como é
     * gravação, o que não foi buscado na hora não se recupera depois: a apuração já passou.
     */
    const ufs = (process.env.RECORD_UFS ?? 'ALL').toUpperCase();
    this.recordUfs = ufs === 'ALL' ? STATES.map(s => s.uf) : ufs.split(',').map(u => u.trim()).filter(u => STATES.some(s => s.uf === u));
  }

  async start() {
    try {
      const saved = JSON.parse(await readFile(`${this.dataDir}/state.json`, 'utf8'));
      // Races carry values derived at normalisation time, colours among them. A cache
      // written by an older build would keep serving them, so the version gates it.
      if (saved.version === STATE_VERSION) {
        this.races = new Map(saved.races || []);
        this.progress = new Map(saved.progress || []);
        this.events = new Map(saved.events || []);
        this.transport.cooldownUntil = Number(saved.cooldownUntil) || 0;
        this.simSession = String(saved.simSession || '');
      }
    } catch { /* First start has no persisted results. */ }
    this.dropStaleSimulado();
    await this.restoreFromRecording();
    this.timer = setInterval(() => { void this.tick(); }, 500);
    this.saveTimer = setInterval(() => { void this.save(); }, 5000);
  }

  /*
   * Brings back what the current simulation session already counted, from its own recording.
   *
   * Between two test windows the site shows the last session's result, and that lives in memory:
   * a restart, or dropping a session that turned out to be the current one, leaves the dashboard
   * blank with a full recording sitting on disk. The last recorded point of each race is read back
   * and put where a freshly fetched one would go, so the view is whole again and the next file
   * from the TSE simply replaces it.
   */
  private async restoreFromRecording(now = Date.now()) {
    const session = this.session('simulado', now);
    if (session === 'fora-da-janela') return;
    for (const uf of this.recordUfs) {
      for (const office of Object.keys(OFFICES) as Office[]) {
        const area = office === 'president' ? 'BR' : uf;
        const chave = `simulado:1:${area}:${office}`;
        if (this.races.has(chave)) continue;
        const race = await this.recorder.raceAt(Recorder.key('simulado', session, 1, area, office), now);
        if (race) { this.races.set(chave, race); this.dirty = true; }
      }
    }
  }

  async close() {
    clearInterval(this.timer); clearInterval(this.saveTimer);
    this.transport.close();
    await this.save();
  }

  private async save() {
    if (this.saving || (!this.dirty && this.lastSavedCooldown === this.transport.cooldownUntil)) return;
    this.saving = true;
    this.dirty = false;
    try {
      await mkdir(this.dataDir, { recursive: true });
      const state = { version: STATE_VERSION, races: [...this.races], progress: [...this.progress], events: [...this.events], cooldownUntil: this.transport.cooldownUntil, simSession: this.simSession };
      await writeFile(`${this.dataDir}/state.tmp`, JSON.stringify(state));
      await rename(`${this.dataDir}/state.tmp`, `${this.dataDir}/state.json`);
      this.lastSavedCooldown = state.cooldownUntil;
    } catch (e) { this.dirty = true; console.error('Falha ao salvar o histórico local:', e instanceof Error ? e.message : e); }
    finally { this.saving = false; }
  }

  subscribe(mode: Mode, uf: string, turn: Turn, send: Subscription['send']) {
    const sub = { mode, uf, turn, send, signature: '' };
    this.subs.add(sub);
    send(this.snapshot(mode, uf, turn));
    void this.tick();
    return () => this.subs.delete(sub);
  }

  private findElection(mode: LiveMode, office: Office, uf: string, turn: Turn): ElectionRef | undefined {
    const code = officeCode(office, uf);
    const ref = this.refs[mode].find(r => r.turn === turn && r.offices.includes(code) && (r.ufs.includes(uf) || r.ufs.includes('BR')));
    if (ref) return ref;
    // Manual overrides are optional and accepted only for the production environment.
    const override = process.env[`TSE_${office === 'president' ? 'FEDERAL' : 'STATE'}_${turn}`];
    if (mode === 'official' && /^\d{1,6}$/.test(override || '') && (turn === 1 || ['president', 'governor'].includes(office))) {
      return { code: override!, cycle: 'ele2026', turn, offices: [code], ufs: [uf] };
    }
    return undefined;
  }

  // --- Hooks for server/municipal.ts (Território): same election refs, windows and races as the main app.
  electionRef(mode: LiveMode, office: Office, area: string, turn: Turn) { return this.findElection(mode, office, area, turn); }
  isAllowed(mode: Mode) { return this.allowed(mode); }
  /** The whole race (not trimmed), for candidate names. */
  fullRace(mode: Mode, uf: string, turn: Turn, office: Office): Race | undefined {
    return this.races.get(`${mode}:${turn}:${office === 'president' ? 'BR' : uf}:${office}`);
  }
  touch(mode: Mode, uf: string, turn: Turn) {
    this.touched.set(`${mode}:${turn}:${uf}`, { mode, uf, turn, until: Date.now() + 60_000 });
  }

  /** The simulation environment is only requested inside the TSE's test windows. */
  private allowed(mode: Mode, now = Date.now()) {
    return mode !== 'simulado' || !!openWindow(SIMULADO_WINDOWS, now);
  }

  /** Recordings are grouped per test window for the simulation, per election for production. */
  private session(mode: LiveMode, now = Date.now()) {
    if (mode === 'official') return 'ele2026';
    const w = sessionWindow(SIMULADO_WINDOWS, now);
    return w ? new Date(w.start - 3 * 3600_000).toISOString().slice(0, 13).replace('T', '-') + 'h' : 'fora-da-janela';
  }

  private recordKeys(mode: LiveMode, uf: string, turn: Turn, session = this.session(mode)) {
    return (Object.keys(OFFICES) as Office[])
      .filter(o => turn === 1 || ['president', 'governor'].includes(o))
      .map(o => Recorder.key(mode, session, turn, o === 'president' ? 'BR' : uf, o));
  }

  async timeline(mode: Mode, uf: string, turn: Turn, now = Date.now()): Promise<Timeline> {
    // 2022 is published as a closed result, race by race. The one exception is the presidential
    // count, whose totalisation history the TSE releases as a CSV. Imported, it is a real timeline,
    // so the bar works — but it can only move the presidential race, and `snapshotAt` leaves the
    // others out rather than freeze them at a final tally they had not reached yet.
    if (mode === 'historico') {
      const key = this.historicoKey(turn, 'president', 'BR');
      const span = key ? await this.recorder.span([key]) : null;
      if (!span) return { available: false, reason: 'De 2022 o TSE publica só o resultado final de cada disputa.', start: now, end: now, live: false, now };
      return { available: true, start: span.start, end: span.end, live: false, now };
    }
    const span = await this.recorder.span(this.recordKeys(mode, uf, turn));
    const windowOpen = mode === 'simulado' ? openWindow(SIMULADO_WINDOWS, now) : openWindow(OFFICIAL_WINDOWS, now);
    const session = mode === 'simulado' ? sessionWindow(SIMULADO_WINDOWS, now) : null;
    if (!span) return { available: false, reason: 'Ainda não há gravação desta apuração. Ela começa quando os primeiros arquivos chegam.', start: now, end: now, live: !!windowOpen, now };
    const start = session ? Math.min(session.start, span.start) : span.start;
    return { available: true, start, end: windowOpen ? now : span.end, live: !!windowOpen || mode === 'official', now };
  }

  /** Recorded series of one race, for the time charts (empty when nothing was recorded). */
  async series(mode: Mode, uf: string, turn: Turn, office: Office, scope?: string) {
    // `scope` asks for the race counted inside one state; the president is national without it.
    const area = scope ?? (office === 'president' ? 'BR' : uf);
    if (mode === 'historico') {
      const key = this.historicoKey(turn, office, area);
      return key ? this.recorder.series(key) : null;
    }
    const key = Recorder.key(mode, this.session(mode as LiveMode), turn, area, office);
    return this.recorder.series(key);
  }

  /**
   * What was imported from the TSE's totalisation history — today the national presidential count
   * of each round, written by `server/import-historico.ts`.
   */
  private historicoKey(turn: Turn, office: Office, area: string): string | null {
    if (office !== 'president' || area.toUpperCase() !== 'BR') return null;
    const election = archiveElection('president', turn);
    return election ? `historico/${election}/t${turn}/br-president` : null;
  }

  async snapshotAt(mode: Mode, uf: string, turn: Turn, at: number): Promise<Snapshot> {
    if (mode === 'historico') {
      const key = this.historicoKey(turn, 'president', 'BR');
      const race = key ? await this.recorder.raceAt(key, at) : null;
      const full = this.archiveSnapshot(uf, turn);
      if (!race) return full;
      // Only the presidential count was published over time. The rest of the ballot is dropped for
      // the instant asked: showing a final tally at 17h would be inventing an apuração.
      return {
        ...full, serverAt: at, races: { president: paraRede(race) },
        connection: { ...full.connection, message: 'Apuração para presidente reconstituída do histórico de totalização do TSE. As demais disputas de 2022 só têm resultado final.' },
      };
    }
    const races: Partial<Record<Office, Race>> = {};
    const offices = (Object.keys(OFFICES) as Office[]).filter(o => turn === 1 || ['president', 'governor'].includes(o));
    const keys = this.recordKeys(mode, uf, turn);
    await Promise.all(offices.map(async (office, i) => { const race = await this.recorder.raceAt(keys[i], at); if (race) races[office] = race; }));
    const live = this.snapshot(mode, uf, turn);
    return { ...live, serverAt: at, races: aoVivo(this.harmonize(races, []).races), connection: { ...live.connection, message: 'Replay da gravação local desta apuração.' } };
  }

  private async fetchConfig(mode: LiveMode) {
    const data = await this.transport.get(`${BASES[mode]}/comum/config/ele-c.json`, 5 * 60_000);
    if (data) this.refs[mode] = discoverElections(data, mode === 'simulado');
  }

  /**
   * Busca uma corrida. `ttl` é a idade máxima aceitável da resposta em cache.
   *
   * É por aí que os 27 estados cabem no teto do TSE: o estado que alguém está vendo é relido a
   * cada segundo, e os outros a cada quinze. Cinco cargos por estado dá 135 arquivos; a um
   * segundo seriam 135 req/s, acima do limite da casa. A quinze, são nove — e a linha do tempo de
   * cada estado fica com um ponto a cada quinze segundos, que para uma apuração é fino.
   */
  private async fetchRace(mode: RemoteMode, uf: string, turn: Turn, office: Office, scope?: string, ttl?: number) {
    // `scope` overrides the office's natural area: the president is national unless a state is asked for.
    const area = scope ?? (office === 'president' ? 'BR' : uf);
    if (!isLive(mode)) return this.fetchArchiveRace(uf, turn, office, scope);
    const ref = this.findElection(mode, office, area, turn);
    if (!ref) return;
    const key = `${mode}:${turn}:${area}:${office}`;
    const url = resultUrl(BASES[mode], ref, area, office);
    const raw = await this.transport.get(url, ttl ?? this.pollMs);
    if (!raw || raw === this.raw.get(key)) return;
    try {
      const race = normalizeResult(raw, { office, uf: area, election: ref.code, turn, simulated: mode === 'simulado', url });
      this.raw.set(key, raw);
      const previous = this.races.get(key);
      // IDG is an identity, not a monotonic sequence. Compare generation times separately.
      if (previous && previous.election === race.election) {
        if (previous.sourceAt && race.sourceAt && Date.parse(race.sourceAt) < Date.parse(previous.sourceAt)) return;
        if (previous.generationId && race.generationId === previous.generationId) return;
      }
      const history = previous?.election === race.election ? previous.history : [];
      const at = race.sourceAt ? Date.parse(race.sourceAt) : race.receivedAt;
      const point = { at, percent: race.countedPercent, votes: race.validVotes, shares: Object.fromEntries(race.candidates.slice(0, 3).map(c => [c.id, c.percent])) };
      // Keep the newest real observation in each 15s bucket (six hours maximum).
      race.history = [...history.filter(p => Math.floor(p.at / 15000) < Math.floor(at / 15000)), point].slice(-1440);
      this.races.set(key, race);
      if (isLive(mode)) void this.recorder.record(Recorder.key(mode, this.session(mode), turn, area, office), race).catch(e => console.error('Gravação:', e instanceof Error ? e.message : e));
      const feedKey = `${mode}:${turn}:${area}`;
      for (const entry of feedEntries(previous, race, area, office, key)) {
        this.events.set(feedKey, [entry, ...(this.events.get(feedKey) || []).filter(e => e.id !== entry.id)].slice(0, FEED_MAX));
      }
      this.dirty = true;
    } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Arquivo inválido'); }
  }

  /** One archived file per race. Final results, so a single fetch is enough. */
  private async fetchArchiveRace(uf: string, turn: Turn, office: Office, scope?: string) {
    const area = scope ?? (office === 'president' ? 'BR' : uf);
    const ref = archiveRef(office, area, turn);
    if (!ref) return;
    const key = `historico:${turn}:${area}:${office}`;
    if (this.races.has(key)) return;
    const raw = await this.transport.get(ref.url, ARCHIVE_TTL);
    if (!raw) return;
    try {
      const race = normalizeArchive(raw, ref);
      this.races.set(key, race);
      const feedKey = `historico:${turn}:${area}`;
      const entry: FeedEvent = {
        id: key, at: race.receivedAt, kind: 'finished',
        title: `${area} · ${OFFICES[office].short}`,
        detail: `Totalização final de ${ARCHIVE.year} publicada pelo TSE em ${race.totalizedAt ? new Date(race.totalizedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'data não informada'}.`,
      };
      this.events.set(feedKey, [entry, ...(this.events.get(feedKey) || []).filter(e => e.id !== key)].slice(0, 30));
      this.dirty = true;
    } catch (e) { this.transport.reject(ref.url, e instanceof Error ? e.message : 'Arquivo inválido'); }
  }

  /** Presidential results state by state: the winner map and the state ranking. */
  private async fetchArchiveMap(turn: Turn) {
    const pending = STATES.filter(state => !this.archiveStates.has(`${turn}:${state.uf}`));
    if (!pending.length) return;
    await Promise.all(pending.slice(0, 6).map(async state => {
      const ref = archiveRef('president', state.uf, turn);
      if (!ref) return;
      const raw = await this.transport.get(ref.url, ARCHIVE_TTL);
      if (!raw) return;
      try { this.archiveStates.set(`${turn}:${state.uf}`, normalizeArchive(raw, ref)); }
      catch (e) { this.transport.reject(ref.url, e instanceof Error ? e.message : 'Arquivo inválido'); }
    }));
    const collected = STATES.map(state => ({ uf: state.uf, race: this.archiveStates.get(`${turn}:${state.uf}`) }))
      .filter((entry): entry is { uf: string; race: Race } => !!entry.race);
    this.progress.set(`historico:${turn}`, archiveProgress(collected));
    this.dirty = true;
  }

  private async fetchProgress(mode: RemoteMode, turn: Turn) {
    if (!isLive(mode)) return this.fetchArchiveMap(turn);
    // EA14 describes the election identified by its own ID. Use the federal scope for this map.
    const ref = this.findElection(mode, 'president', 'BR', turn);
    if (!ref) return;
    const url = resultUrl(BASES[mode], ref, 'BR');
    const raw = await this.transport.get(url, 5000);
    const key = `${mode}:${turn}:progress`;
    if (!raw || raw === this.raw.get(key)) return;
    try {
      const next = normalizeProgress(raw, ref, mode === 'simulado');
      const previous = this.progress.get(`${mode}:${turn}`) || [];
      this.progress.set(`${mode}:${turn}`, next.map(state => {
        const old = previous.find(s => s.uf === state.uf);
        return old?.sourceAt && state.sourceAt && Date.parse(state.sourceAt) < Date.parse(old.sourceAt) ? old : state;
      }));
      this.raw.set(key, raw); this.dirty = true;
    }
    catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Arquivo inválido'); }
  }

  /*
   * Each TSE test window is a new count from zero, and the results of the previous one are kept in
   * memory and on disk so the site has something to show between windows. The moment a new window
   * opens they stop being an answer to "what is happening now": until the first file of the day
   * arrives, the page would show last week's session, finished at 100%, under a clock reading
   * "ao vivo". So results from an earlier session are dropped as soon as the session changes —
   * the recording of it stays on disk, under its own session key, and can still be replayed.
   */
  private dropStaleSimulado(now = Date.now()) {
    const session = this.session('simulado', now);
    if (session === this.simSession) return;
    const anterior = this.simSession;
    this.simSession = session;
    // A state file written before this existed says nothing about which session it holds. Assuming
    // the worst would throw away the last session's results, which are exactly what the site shows
    // between windows, so an unknown session is adopted rather than purged.
    if (!anterior) { this.dirty = true; return; }
    for (const map of [this.races, this.raw, this.progress, this.events] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (key.startsWith('simulado:')) map.delete(key);
    }
    this.dirty = true;
    /*
     * Trocar de sessão não pode significar tela em branco.
     *
     * O que foi apagado acima é o resultado da sessão anterior, que deixou de valer; o que a nova
     * já gravou, se ela já começou, continua valendo. Antes isso só era lido na partida do
     * servidor: com o processo no ar desde a véspera, o começo de cada janela abria vazio até o
     * primeiro arquivo novo chegar do TSE.
     */
    void this.restoreFromRecording(now).catch(() => { /* a próxima leitura preenche */ });
  }

  /** The night's thread for one context: the state's races and the national ones, newest first. */
  feed(mode: Mode, uf: string, turn: Turn, limit = 120): FeedEvent[] {
    return [...(this.events.get(`${mode}:${turn}:${uf}`) || []), ...(this.events.get(`${mode}:${turn}:BR`) || [])]
      .sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /** The contexts collected on their own during a TSE window, with no browser open. */
  liveContexts(now = Date.now()): { mode: Mode; uf: string; turn: Turn }[] {
    const simulado = openWindow(SIMULADO_WINDOWS, now), official = openWindow(OFFICIAL_WINDOWS, now);
    return [
      ...(simulado ? this.recordUfs.map(uf => ({ mode: 'simulado' as Mode, uf, turn: simulado.turn })) : []),
      ...(official ? this.recordUfs.map(uf => ({ mode: 'official' as Mode, uf, turn: official.turn })) : []),
    ];
  }

  private async tick() {
    const now = Date.now();
    this.dropStaleSimulado(now);
    // During TSE windows the chosen states are collected and recorded even with no browser open.
    const background = this.liveContexts(now);
    for (const [key, t] of this.touched) if (t.until < now) this.touched.delete(key);
    if (this.busy || (!this.subs.size && !background.length && !this.touched.size)) return;
    this.busy = true;
    try {
      /*
       * Quem está sendo visto é lido no ritmo do relógio; quem está sendo apenas gravado, mais
       * devagar. Os dois conjuntos são unidos com o primeiro ganhando: um estado aberto numa aba
       * continua a um segundo mesmo estando também na lista de gravação.
       */
      const emFoco = [...this.subs].map(s => ({ mode: s.mode, uf: s.uf, turn: s.turn, fundo: false }));
      const observados = [...this.touched.values()].map(s => ({ ...s, fundo: false }));
      const gravados = background.map(s => ({ ...s, fundo: true }));
      const contexts = [...new Map([...gravados, ...observados, ...emFoco]
        .filter(s => this.allowed(s.mode, now))
        .map(s => [`${s.mode}:${s.turn}:${s.uf}`, s])).values()];
      const modes = [...new Set(contexts.map(c => c.mode as RemoteMode))];
      const launch = (key: string, task: () => Promise<unknown>) => {
        if (this.jobs.has(key)) return;
        this.jobs.add(key);
        void task().catch(e => console.error('Coleta:', e instanceof Error ? e.message : e)).finally(() => { this.jobs.delete(key); this.broadcast(); });
      };
      for (const mode of modes) if (isLive(mode)) launch(`${mode}:config`, () => this.fetchConfig(mode));
      /*
       * Quem está sendo visto manda na cadência, mesmo aparecendo também na lista de gravação.
       *
       * A chave da presidência nacional é a mesma para todos os contextos, e o primeiro a reclamá-la
       * fixava o intervalo — como os gravados entram antes na lista, o painel nacional da tela
       * aberta era lido a cada quinze segundos enquanto o resto dela andava a cada segundo. Agora a
       * ordem é a do foco: contexto em foco primeiro, gravação depois.
       */
      contexts.sort((a, b) => Number(a.fundo) - Number(b.fundo));
      const seen = new Set<string>();
      for (const c of contexts) {
        for (const office of Object.keys(OFFICES) as Office[]) {
          if (c.turn === 2 && !['president', 'governor'].includes(office)) continue;
          const key = `${c.mode}:${c.turn}:${office === 'president' ? 'BR' : c.uf}:${office}`;
          if (!seen.has(key)) {
            seen.add(key);
            const ttl = c.fundo ? TTL_GRAVACAO : this.pollMs;
            launch(key, () => this.fetchRace(c.mode as RemoteMode, c.uf, c.turn, office, undefined, ttl));
          }
        }
        // The president counted inside the viewer's state, for the column's Brasil/UF switch.
        const ufPresKey = `${c.mode}:${c.turn}:${c.uf}:president`;
        if (c.uf !== 'BR' && !seen.has(ufPresKey)) {
          seen.add(ufPresKey);
          const ttl = c.fundo ? TTL_GRAVACAO : this.pollMs;
          launch(ufPresKey, () => this.fetchRace(c.mode as RemoteMode, c.uf, c.turn, 'president', c.uf, ttl));
        }
        const progressKey = `${c.mode}:${c.turn}:progress`;
        if (!seen.has(progressKey)) { seen.add(progressKey); launch(progressKey, () => this.fetchProgress(c.mode as RemoteMode, c.turn)); }
      }
      // Independent jobs prevent one slow file from delaying the next poll of other races.
      this.broadcast();
    } finally { this.busy = false; }
  }

  private broadcast() {
    for (const sub of this.subs) {
      const snapshot = this.snapshot(sub.mode, sub.uf, sub.turn);
      // The archive is final: which files arrived is enough to tell two snapshots apart,
      // and stringifying a few thousand candidacies twice a second is not.
      const signature = sub.mode === 'historico' ? `${Object.keys(snapshot.races).join(',')}|${snapshot.connection.status}`
        : JSON.stringify({ ...snapshot, serverAt: 0 });
      if (signature !== sub.signature) { sub.signature = signature; sub.send(snapshot); }
    }
  }

  /**
   * O snapshot carrega o que o painel desenha; a lista inteira tem rota própria.
   *
   * Ele é reenviado a cada leitura aceita, e uma proporcional tem milhares de candidaturas: mandar
   * todas em cada quadro custava quatro vezes o peso do que aparece na tela. Quem precisa do resto
   * — a tabela e a busca — pede em /api/race, uma vez, quando é aberta. `candidateCount` diz que
   * há mais, para a tela saber que precisa perguntar.
   */
  private trim(race: Race): Race {
    const limit = ['federal', 'state'].includes(race.office) ? 300 : 40;
    if (race.candidates.length <= limit) return race;
    return { ...race, candidates: race.candidates.slice(0, limit), candidateCount: race.candidates.length };
  }

  /**
   * Colour is assigned per race, but the reader sees every race at once: two parties
   * side by side in different panels must not share a hue. One pass over the parties
   * actually on screen fixes that, and keeps one party on one colour across panels.
   */
  private harmonize(races: Partial<Record<Office, Race>>, states: StateProgress[]): { races: Partial<Record<Office, Race>>; states: StateProgress[] } {
    const shown: Office[] = ['president', 'governor', 'senate'];
    const parties: string[] = [];
    // Exactly the rows the cards render: colouring more than that spends slots on
    // marks nobody sees and forces a repeat among the ones they do.
    for (const office of shown) for (const candidate of races[office]?.candidates.slice(0, office === 'president' ? 4 : 3) || []) {
      if (!parties.includes(candidate.party)) parties.push(candidate.party);
    }
    for (const state of states) if (state.leader && !parties.includes(state.leader.party)) parties.push(state.leader.party);
    if (!parties.length) return { races, states };
    const colors = distinctColors(parties, party => party);
    const palette = new Map(parties.map((party, i) => [party, colors[i]]));
    const paint = (race: Race): Race => ({
      ...race,
      candidates: race.candidates.map(c => ({ ...c, color: palette.get(c.party) || c.color })),
      parties: race.parties.map(p => ({ ...p, color: palette.get(p.name) || p.color })),
    });
    return {
      races: Object.fromEntries(Object.entries(races).map(([office, race]) => [office, shown.includes(office as Office) ? paint(race) : race])),
      states: states.map(state => state.leader ? { ...state, leader: { ...state.leader, color: palette.get(state.leader.party) || state.leader.color } } : state),
    };
  }

  private archiveSnapshot(uf: string, turn: Turn): Snapshot {
    const races: Partial<Record<Office, Race>> = {};
    for (const office of archiveOffices(turn)) {
      const area = office === 'president' ? 'BR' : uf;
      const race = this.races.get(`historico:${turn}:${area}:${office}`);
      if (race) races[office] = this.trim(race);
    }
    const loaded = Object.keys(races).length;
    const harmonized = this.harmonize(races, this.progress.get(`historico:${turn}`) || []);
    return {
      mode: 'historico', uf, turn, serverAt: Date.now(), races: aoVivo(harmonized.races),
      presidentUf: ((r?: Race) => r && paraRede(r))(this.races.get(`historico:${turn}:${uf}:president`) ?? this.archiveStates.get(`${turn}:${uf}`)),
      connection: {
        status: loaded ? 'archive' : 'waiting',
        message: loaded
          ? `Resultado final das eleições de ${ARCHIVE.year}, ${turn}º turno, como publicado pelo TSE. Não é uma apuração em andamento.`
          : `Carregando os arquivos de ${ARCHIVE.year} publicados pelo TSE.`,
      },
    };
  }

  snapshot(mode: Mode, uf: string, turn: Turn): Snapshot {
    if (mode === 'historico') return this.archiveSnapshot(uf, turn);
    const races: Partial<Record<Office, Race>> = {};
    const relevantUrls: string[] = [`${BASES[mode]}/comum/config/ele-c.json`];
    for (const office of Object.keys(OFFICES) as Office[]) {
      if (turn === 2 && !['president', 'governor'].includes(office)) continue;
      const area = office === 'president' ? 'BR' : uf;
      const race = this.races.get(`${mode}:${turn}:${area}:${office}`);
      if (race) {
        const stride = Math.max(1, Math.ceil(race.history.length / 180));
        races[office] = this.trim({ ...race, history: race.history.filter((_, i) => i % stride === 0 || i === race.history.length - 1) });
      }
      const ref = this.findElection(mode, office, area, turn);
      if (ref) relevantUrls.push(resultUrl(BASES[mode], ref, area, office));
    }
    const errors = relevantUrls.map(u => this.transport.entries.get(u)?.error).filter(Boolean);
    const cooldown = this.transport.cooldownUntil > Date.now();
    const ready = !!this.findElection(mode, 'president', 'BR', turn);
    const hasData = Object.keys(races).length > 0;
    const status = cooldown ? 'cooldown' : errors.length || (hasData && !this.transport.lastSuccessAt) ? 'degraded' : hasData ? 'live' : 'waiting';
    const harmonized = this.harmonize(races, this.progress.get(`${mode}:${turn}`) || []);
    return {
      mode, uf, turn, serverAt: Date.now(), races: aoVivo(harmonized.races),
      presidentUf: ((r?: Race) => r && paraRede(r))(this.races.get(`${mode}:${turn}:${uf}:president`)),
      connection: {
        status,
        message: mode === 'simulado' && !this.allowed(mode) ? `Fora da janela de testes do TSE. ${(() => { const w = nextWindow(SIMULADO_WINDOWS); return w ? `Próxima: ${describeWindow(w)}.` : 'Os testes de 2026 terminaram.'; })()}` : cooldown ? 'Consultas pausadas após resposta do TSE. Retomada automática no horário indicado.' : errors.length ? String(errors[0]) : !ready ? 'Aguardando a configuração de 2026 ser publicada pelo TSE.' : !hasData ? 'Configuração encontrada. Aguardando a publicação dos resultados.' : 'Recebendo os arquivos de resultados do TSE.',
      },
    };
  }
}
