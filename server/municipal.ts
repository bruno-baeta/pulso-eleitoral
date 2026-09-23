import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ARCHIVE, OFFICES, STATES, type Mode, type Office, type Race, type Turn } from '../shared/types.ts';
import { BASES, array, numeric, object, officeCode, str, tseTime, type ElectionRef } from './tse.ts';
import { NOT_MODIFIED, type TseTransport } from './transport.ts';
import { archiveElection } from './archive.ts';

/**
 * Results per municipality for the Território view, on demand, for every source.
 *
 * - historico (2022): the TSE's per-municipality files are fetched the first time a UF + office is asked for,
 *   each municipality cached on disk forever, and the finished build kept in data/municipal/.
 * - simulado / official (2026): election codes come from the collector's live configuration; the requested
 *   UF + office is refreshed on a slow rotation only while someone keeps asking for it (and, for the
 *   simulation, only inside the TSE windows), through the transport's low-priority lane.
 *
 * URLs are only ever built from the municipal configuration file published by the TSE.
 */

export type LiveMode = 'official' | 'simulado';
export interface MunicipalHooks {
  election(mode: LiveMode, office: Office, area: string, turn: Turn): ElectionRef | undefined;
  allowed(mode: Mode): boolean;
  race(mode: Mode, uf: string, turn: Turn, office: Office): Race | undefined;
  touch(mode: Mode, uf: string, turn: Turn): void;
  /** What the collector is already recording: live contexts to keep a municipal build ready for. */
  live(): { mode: Mode; uf: string; turn: Turn }[];
  /**
   * Qual sessão de apuração está em curso, como o gravador das corridas a nomeia.
   *
   * A gravação municipal é guardada por sessão: sem isso, a janela da tarde abriria com os números
   * da manhã na tela, e uma apuração antiga passaria por atual.
   */
  session(mode: Mode): string;
}

/** Wire format: c = [[number, total]] by total; m = [[ibge, name, uf, valid, [candIndex, votes, …]]]; n = names. */
export interface MunicipalPayload {
  mode: Mode; uf: string; turn: Turn; office: Office; area: string;
  status: 'ready' | 'loading' | 'waiting' | 'paused' | 'unavailable';
  message: string;
  loaded: number; total: number; version: number; sourceAt: string | null;
  /** Municipal files requested for this view since the server started (live delta diagnostics). */
  fetches?: number;
  totais: TotaisMunicipais;
  c: [string, number][];
  /** [ibge, name, uf, valid, pairs, lastTotalizationTime?] — the time (hh:mm:ss) only for live sources. */
  m: [string, string, string, number, number[], string?][];
  n: Record<string, [string, string]>;
}
/**
 * A soma das cidades publicadas, campo a campo, como o TSE os publica.
 *
 * Serve para conferir o total da disputa por outro caminho: ele vem de outro arquivo, por outra
 * rota. `cidades` diz sobre quantas a soma foi feita — nem toda cidade publicada tem os totais
 * guardados, e um percentual preciso sobre base parcial é pior que nenhum.
 */
export interface TotaisMunicipais {
  cidades: number; nominais: number; brancos: number; nulos: number;
  total: number; secoes: number; secoesTotais: number;
  /**
   * A hora da publicação mais antiga entre as cidades somadas.
   *
   * A soma é um mosaico de instantes: cada cidade traz o número de quando o TSE a publicou, e o
   * total da disputa traz o agora. Sem esta hora na tela, a diferença entre os dois percentuais
   * parece erro — foi a pergunta que ela existe para responder.
   */
  desde: string;
  /**
   * Quantas das cidades somadas não trouxeram o bloco de totais do TSE.
   *
   * Cidade assim era pulada pela soma, e o buraco não aparecia em lugar nenhum: a tela mostrava
   * "126 de 817 cidades" como se fossem essas as apuradas, e a apuração pelas cidades dava 87,7%
   * contra os 94% do painel. Cidade que não entra na conta precisa ser cidade que se vê não
   * entrando na conta.
   */
  semTotais: number;
}

export type MunicipalResponse = MunicipalPayload | ({ unchanged: true } & Pick<MunicipalPayload, 'status' | 'message' | 'loaded' | 'total' | 'version'>);

/** O que a folha de cidades desenha, e nada mais: [nome, uf, votos, válidos na cidade, colocação]. */
export interface CandidaturaMunicipal {
  status: MunicipalPayload['status'];
  message: string;
  loaded: number;
  total: number;
  /**
   * Quantas cidades já têm resultado publicado — não quantas foram buscadas.
   *
   * A diferença importa e enganava: medido no simulado de 23/09/2026, a varredura do estadual de
   * Minas dizia "853 de 853 cidades recebidas" enquanto só 16 delas tinham algum voto. Os outros
   * 837 arquivos existem e vêm zerados. Quem abria a lista de uma candidatura via 169 de 3.057
   * votos e não tinha como saber que o resto ainda não fora publicado pela fonte.
   */
  cidadesComResultado: number;
  /**
   * A soma das cidades publicadas, campo a campo, como o TSE os publica.
   *
   * Serve para conferir o total da disputa por outro caminho: se o painel diz 50% apurado e as
   * seções somadas das cidades dizem outra coisa, a diferença é visível em vez de suposta.
   */
  totais: TotaisMunicipais;
  numero: string;
  linhas: [string, string, number, number, number][];
}

interface MunRef { uf: string; cd: string; cdi: string; nm: string; capital: boolean }
/**
 * Uma cidade: os votos por candidatura e os totais que o TSE publica junto.
 *
 * `vb`, `vn`, `tv`, `st` e `ts` são campos do próprio arquivo municipal, não contas nossas — é o
 * que permite somar as cidades e conferir o total da disputa por outro caminho.
 */
interface Row { vv: number; cand: [string, number][]; vb?: number; vn?: number; tv?: number; st?: number; ts?: number; esq?: number }
interface Job {
  key: string; mode: Mode; turn: Turn; office: Office; area: string; focus: string;
  status: MunicipalPayload['status']; message: string;
  muns: MunRef[]; rows: Map<string, Row>; names: Map<string, string>;
  version: number; sourceAt: string | null; lastRequest: number; running: boolean;
  /**
   * Quando uma tela pediu este cargo de verdade — não quando ele foi aquecido de fundo.
   *
   * `lastRequest` serve para saber que alguém ainda está por perto e vale manter o job vivo; o
   * aquecimento também o renova, senão o job morreria sozinho. Mas quem manda na fila é a tela, e
   * misturar os dois faria o aquecimento roubar a vez do cargo que está aberto.
   */
  pedidoEm: number;
  /** Live delta: last UF progress stamp per TSE municipality (uf+cd), the stamp each city was fetched at, and which UF files were read. */
  stamps: Map<string, AbCity>; fetched: Map<string, string>; abSeen: Set<string>; abRotation: number; fetches: number;
  /** Quando cada cidade foi lida pela última vez. Encerrada não quer dizer nunca mais (ver `encerrada`). */
  lidaEm: Map<string, number>;
  /** Versão já gravada em disco, e quando — o que evita reescrever um megabyte a cada volta. */
  salvo: { version: number; em: number };
  /**
   * A fonte já confirmou estas linhas nesta execução?
   *
   * Linha vinda do disco preenche `rows` e faria o job passar por completo — e um job completo
   * some da fila de varredura, então ele nunca mais perguntava nada e servia o retrato de uma hora
   * atrás como atual. Visto no simulado de 23/09/2026: senado e deputado federal com 853 linhas,
   * `fetches=0` e apenas 12 e 74 cidades com voto, enquanto governador e estadual, que varreram de
   * verdade, tinham 423 e 431.
   */
  confirmado: boolean;
  body?: { version: number; namesAt: number; payload: MunicipalPayload };
}

export interface AbCity { stamp: string; ht: string; te: number; finished: boolean }
const KEEPALIVE = 90_000;
/** No view has asked for anything for this long: the server is free to fetch ahead. */
const IDLE_AFTER = 45_000;
/** How often idleness is re-checked. */
const IDLE_TICK = 15_000;
/**
 * A finished archive job holds every municipality of a state in memory — about 90 MB for the five
 * races of Minas. Kept forever, browsing a handful of states walks the process past a gigabyte and
 * it never comes back. The build is on disk, so after this long without a request the job is
 * dropped and rebuilt from the file when someone asks again, which costs milliseconds.
 */
const EVICT_AFTER = 10 * 60_000;
/** The UF progress file (-ab) is re-read this often while the view is open: one request that says which cities changed. */
const AB_INTERVAL = Number(process.env.MUNICIPAL_AB_MS) || 8000;
/** 2026: a full refresh cycle of the requested UF + office every few minutes, while it is being viewed. */
const LIVE_CYCLE = Number(process.env.MUNICIPAL_CYCLE_MS) || 3 * 60_000;
const ARCHIVE_TTL = 24 * 60 * 60_000;
/** Parallel readers; the transport's low lane still caps requests in flight and per second. */
const WORKERS = 16;

/*
 * A versão do que sabemos extrair de um arquivo municipal.
 *
 * Existe por causa de 23/09/2026: os totais por cidade (brancos, nulos, seções) passaram a ser
 * lidos no meio da janela, e as 691 cidades de Minas já buscadas — e já encerradas pelo TSE —
 * nunca mais foram relidas. Ficaram com zero nesses campos para sempre, e a soma as descartava
 * em silêncio: 126 de 817 na tela, 87,7% contra os 94% do painel.
 *
 * Subir este número marca como suja toda linha lida por um parser mais velho, ignorando carimbo
 * e o `and='f'` do andamento. Mudou o que se extrai do arquivo, sobe aqui — é a única coisa que
 * faz o já coletado voltar a ser coletado.
 */
const ESQUEMA = 2;

/** De quanto em quanto tempo uma cidade encerrada é conferida assim mesmo. */
const RELEITURA = Number(process.env.MUNICIPAL_RELEITURA_MS) || 10 * 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pad6 = (code: string) => code.padStart(6, '0');

export const municipalOffices = (turn: Turn): Office[] => (Object.keys(OFFICES) as Office[]).filter(o => turn === 1 || o === 'president' || o === 'governor');

/** Reads one per-municipality file: the 2022 layout (abr → cand) or the 2026 EA20-like one (carg → agr → par → cand). */
export function parseMunicipal(raw: unknown, expected: { election: string; cd: string; office: Office; uf: string }): Row & { sourceAt: string | null } {
  const root = object(raw);
  if (root.ele !== undefined && Number(root.ele) !== Number(expected.election)) throw new Error('Arquivo municipal de outra eleição');
  const code = officeCode(expected.office, expected.uf);
  let cand: [string, number][] = [], vv = 0;
  const mu = array(root.abr).find(a => str(a.tpabr).toUpperCase() === 'MU');
  if (mu) {
    if (mu.cdabr !== undefined && Number(mu.cdabr) !== Number(expected.cd)) throw new Error('Arquivo de outro município');
    cand = array(mu.cand).map(c => [str(c.n), numeric(c.vap)] as [string, number]);
    vv = numeric(mu.vv);
  } else if (Array.isArray(root.carg)) {
    if (root.cdabr !== undefined && Number(root.cdabr) !== Number(expected.cd)) throw new Error('Arquivo de outro município');
    const cargo = array(root.carg).find(c => Number(c.cd) === code) ?? array(root.carg)[0];
    for (const group of array(cargo?.agr)) for (const party of array(group.par)) for (const c of array(party.cand)) cand.push([str(c.n), numeric(c.vap)]);
    vv = numeric(object(root.v).vv);
  } else throw new Error('Estrutura municipal não reconhecida');
  cand = cand.filter(([n, v]) => n && v > 0).sort((a, b) => b[1] - a[1]);
  if (!vv) vv = cand.reduce((s, [, v]) => s + v, 0);
  const totais = object(root.v), secoes = object(root.s);
  return {
    vv, cand, sourceAt: tseTime(root.dg, root.hg),
    vb: numeric(totais.vb), vn: numeric(totais.vn), tv: numeric(totais.tv),
    st: numeric(secoes.st), ts: numeric(secoes.ts),
  };
}

/**
 * UF progress file (…/dados/<uf>/<uf>-e0<cd>-ab.json): per municipality the last totalization time and section count.
 * A city only needs a new fetch when its stamp changes.
 */
export function parseAb(raw: unknown, election: string): { sourceAt: string | null; cities: Map<string, AbCity> } {
  const root = object(raw);
  if (root.ele !== undefined && Number(root.ele) !== Number(election)) throw new Error('Arquivo de andamento de outra eleição');
  if (!Array.isArray(root.abr)) throw new Error('Andamento sem abrangências');
  const cities = new Map<string, AbCity>();
  for (const a of array(root.abr)) {
    if (str(a.tpabr).toLowerCase() !== 'mun' || !/^\d{1,5}$/.test(str(a.cdabr))) continue;
    const sections = object(a.s);
    cities.set(str(a.cdabr).padStart(5, '0'), {
      stamp: `${str(a.dt)} ${str(a.ht)}|${str(sections.st)}|${str(a.and)}`, ht: str(a.ht),
      te: numeric(object(a.e).te) || numeric(sections.ts), finished: a.and === 'f',
    });
  }
  return { sourceAt: tseTime(root.dg, root.hg), cities };
}

/** Municipalities of the area from a TSE municipal configuration file (abroad excluded). */
export function readConfig(raw: unknown, area: string): MunRef[] {
  return array(object(raw).abr)
    .filter(a => str(a.cd).toUpperCase() !== 'ZZ' && (area === 'BR' || str(a.cd).toUpperCase() === area))
    .flatMap(a => array(a.mu).filter(m => /^\d{1,5}$/.test(str(m.cd)) && /^\d{7}$/.test(str(m.cdi)))
      .map(m => ({ uf: str(a.cd).toUpperCase(), cd: str(m.cd).padStart(5, '0'), cdi: str(m.cdi), nm: str(m.nm), capital: m.c === 'S' })));
}

/** Small deterministic hash in [0, 1). */
function unit(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export class MunicipalService {
  private jobs = new Map<string, Job>();
  /** `historico:<uf>` for every state a view has actually opened; what idle time is spent on. */
  private interest = new Set<string>();
  private idleJob: Job | null = null;
  private configs = new Map<string, MunRef[]>();
  private rawConfigs = new Map<string, unknown>();

  /**
   * `escala` encolhe as esperas internas do laço, e existe para os testes.
   *
   * O laço dorme segundos entre voltas — três quando não há nada sujo, cinco quando o andamento não
   * respondeu. É o ritmo certo contra o TSE e o ritmo errado numa suíte: os dez testes do laço
   * levavam 133 segundos esperando sono de produção. Com 0,01 eles levam o que devem levar, e o
   * comportamento testado é o mesmo — o que muda é só quanto tempo o relógio anda entre as voltas.
   */
  constructor(private transport: TseTransport, private hooks: MunicipalHooks, private dataDir = './data', private escala = 1) {}

  private pausa(ms: number) { return sleep(Math.max(1, Math.round(ms * this.escala))); }

  private area(office: Office, uf: string) { return office === 'president' ? 'BR' : uf; }

  async get(mode: Mode, uf: string, turn: Turn, office: Office, since?: number): Promise<MunicipalResponse> {
    const area = this.area(office, uf);
    const base = { mode, uf, turn, office, area, sourceAt: null, c: [], m: [], n: {}, loaded: 0, total: 0, version: 0, totais: this.somar(undefined) };
    if (!municipalOffices(turn).includes(office)) return { ...base, status: 'unavailable', message: 'Sem 2º turno para este cargo.' };
    if (mode === 'historico' && turn === 2 && office === 'governor' && !(ARCHIVE.runoffStates as readonly string[]).includes(uf)) {
      return { ...base, status: 'unavailable', message: `Não houve 2º turno para governador neste estado em ${ARCHIVE.year}.` };
    }
    const key = `${mode}:${turn}:${area}:${office}`;
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, mode, turn, office, area, focus: uf, status: 'loading', message: 'Preparando os municípios.', muns: [], rows: new Map(), names: new Map(), version: 0, sourceAt: null, lastRequest: Date.now(), pedidoEm: 0, running: false, stamps: new Map(), fetched: new Map(), lidaEm: new Map(), abSeen: new Set(), abRotation: 0, fetches: 0, salvo: { version: -1, em: 0 }, confirmado: false };
      this.jobs.set(key, job);
      await this.loadBuilt(job);
    }
    job.lastRequest = Date.now();
    job.pedidoEm = job.lastRequest;
    if (area === 'BR') job.focus = uf;
    if (mode === 'historico') this.interest.add(`${mode}:${uf}`);
    this.hooks.touch(mode, uf, turn);
    /*
     * Os outros cargos do estado começam a ser preparados junto, não depois.
     *
     * Cada cargo é um arquivo por cidade no TSE, então cada um tem a sua varredura de 853 — e ela
     * só começava quando alguém abria aquela aba, o que fazia a primeira abertura de cada cargo
     * esperar cerca de um minuto. Criados agora, eles entram na fila e a própria ordem de
     * prioridade resolve: o cargo que está na tela leva a faixa inteira, e quando ele fecha a vez
     * passa sozinha para os irmãos, que chegam prontos.
     */
    this.warmSiblings(mode, uf, turn, office);
    if (!job.running && !(mode === 'historico' && job.status === 'ready')) void this.run(job);
    if (since !== undefined && since === job.version && job.body) {
      return { unchanged: true, status: job.status, message: job.message, loaded: job.muns.length ? Math.min(job.rows.size, job.muns.length) : 0, total: job.muns.length, version: job.version };
    }
    return this.payload(job, uf);
  }

  /** Background load of the other offices of the same state, at low priority, while the view is open. */
  private warmSiblings(mode: Mode, uf: string, turn: Turn, except: Office) {
    for (const office of municipalOffices(turn)) {
      if (office === except) continue;
      const area = this.area(office, uf);
      const key = `${mode}:${turn}:${area}:${office}`;
      let job = this.jobs.get(key);
      if (!job) {
        job = { key, mode, turn, office, area, focus: uf, status: 'loading', message: 'Preparando os municípios.', muns: [], rows: new Map(), names: new Map(), version: 0, sourceAt: null, lastRequest: Date.now(), pedidoEm: 0, running: false, stamps: new Map(), fetched: new Map(), lidaEm: new Map(), abSeen: new Set(), abRotation: 0, fetches: 0, salvo: { version: -1, em: 0 }, confirmado: false };
        this.jobs.set(key, job);
        void this.loadBuilt(job).then(() => { if (!job!.running && job!.status !== 'ready') void this.run(job!); });
        continue;
      }
      job.lastRequest = Date.now();
      if (!job.running && !(mode === 'historico' && job.status === 'ready')) void this.run(job);
    }
  }

  /**
   * O que é buscado quando ninguém está pedindo nada.
   *
   * O TSE publica o resultado municipal em um arquivo por município e por cargo, então um estado
   * custa centenas de requisições na primeira vez que é aberto. Há duas políticas, e elas são
   * diferentes de propósito:
   *
   *   arquivo de 2022 — só os estados que alguém abriu. O resultado está fechado e não muda;
   *     buscar os 27 sem pedido seriam dezenas de milhares de requisições para nada.
   *   apuração ao vivo — todos os estados da janela (`warmLive`), porque o que não for buscado na
   *     hora não existe depois: a apuração passou. É o que faz trocar de estado no meio da noite
   *     não virar espera.
   *
   * Em qualquer um dos casos os arquivos municipais viajam na fila de baixa prioridade, que só usa
   * folga deixada pelas corridas, e a varredura para assim que o transporte entra em pausa.
   */
  startIdleWarming() {
    const timer = setInterval(() => void this.idleTick(), IDLE_TICK);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async idleTick() {
    const now = Date.now();
    this.evictIdle(now);
    if (this.transport.cooldownUntil > now) return;
    await this.warmLive();
    // anything on screen wins: the idle job is left to expire on its own KEEPALIVE
    for (const job of this.jobs.values()) {
      if (job !== this.idleJob && now - job.lastRequest < IDLE_AFTER) { this.idleJob = null; return; }
    }
    if (this.idleJob) {
      if (this.idleJob.status !== 'ready') { this.idleJob.lastRequest = now; return; }   // keep it alive
      this.idleJob = null;
    }
    const next = await this.nextToWarm();
    if (!next) return;
    next.lastRequest = now;
    this.idleJob = next;
    if (!next.running) void this.run(next);
  }

  /**
   * Keeps the live map built while the count runs, for the states the collector already records.
   *
   * Idle warming used to cover 2022 only, so someone who spent the apuração on another view and
   * then opened Território started the 853 municipal files from zero, with the count already in
   * progress. The states here are the ones being recorded anyway, and only while a TSE window is
   * open; governor is enough to start, because a finished build pulls its sibling offices in.
   */
  private async warmLive() {
    for (const { mode, uf, turn } of this.hooks.live()) {
      if (!this.hooks.allowed(mode)) continue;
      const office: Office = 'governor';
      await this.get(mode, uf, turn, office).catch(() => null);
    }
  }

  /** Frees finished archive jobs nobody has asked for in a while; the file on disk is the copy. */
  private evictIdle(now: number) {
    for (const [key, job] of this.jobs) {
      if (job === this.idleJob || job.running || job.mode !== 'historico') continue;
      if (job.status !== 'ready' || now - job.lastRequest < EVICT_AFTER) continue;
      this.jobs.delete(key);
    }
  }

  /** The first archive build of an opened state that is not on disk yet, this round then the other. */
  private async nextToWarm(): Promise<Job | null> {
    for (const entry of this.interest) {
      const uf = entry.split(':')[1];
      for (const turn of [1, 2] as Turn[]) {
        // The state's own races first: president is national, 5.570 files, and shared by every
        // state — left last it never starves the cheap build the reader is most likely to open.
        const own = municipalOffices(turn).filter(o => o !== 'president');
        const order: Office[] = [...own, 'president'];
        for (const office of order) {
          if (turn === 2 && office === 'governor' && !(ARCHIVE.runoffStates as readonly string[]).includes(uf)) continue;
          const area = this.area(office, uf);
          const key = `historico:${turn}:${area}:${office}`;
          let job = this.jobs.get(key);
          if (!job) {
            job = { key, mode: 'historico', turn, office, area, focus: uf, status: 'loading', message: 'Preparando os municípios.', muns: [], rows: new Map(), names: new Map(), version: 0, sourceAt: null, lastRequest: 0, pedidoEm: 0, running: false, stamps: new Map(), fetched: new Map(), lidaEm: new Map(), abSeen: new Set(), abRotation: 0, fetches: 0, salvo: { version: -1, em: 0 }, confirmado: false };
            this.jobs.set(key, job);
            await this.loadBuilt(job);
          }
          if (job.status !== 'ready') return job;
        }
      }
    }
    return null;
  }

  /**
   * A fonte publica município para esta área?
   *
   * Lido do próprio arquivo de configuração do TSE, e não do andamento do laço de coleta: era lá
   * que a resposta estava sendo decidida, e de lá ela não saía — a tabela de cidades girava em
   * "Recebendo os resultados por município" para sempre. Medido em 23/09/2026, o simulado publica
   * município de um lugar só no país inteiro (Fernando de Noronha, PE), então para qualquer outro
   * estado não há o que esperar, e a tela precisa dizer isso.
   *
   * `null` enquanto a configuração ainda não chegou: aí "buscando" é verdade.
   */
  private fontePublicaMunicipios(job: Job): boolean | null {
    const alvo = this.target(job);
    if (!alvo) return null;
    const bruto = this.rawConfigs.get(alvo.configUrl);
    if (bruto === undefined) return null;
    return readConfig(bruto, job.area).length > 0;
  }

  /** Soma toda cidade publicada. A que não trouxe o bloco de totais conta em `semTotais`. */
  private somar(job: Job | undefined): TotaisMunicipais {
    const t: TotaisMunicipais = { cidades: 0, nominais: 0, brancos: 0, nulos: 0, total: 0, secoes: 0, secoesTotais: 0, desde: '', semTotais: 0 };
    for (const [cdi, linha] of job?.rows ?? []) {
      if (linha.vv <= 0) continue;
      const m = job?.muns.find(x => x.cdi === cdi);
      const ht = m && job?.stamps.get(`${m.uf}${m.cd}`)?.ht;
      if (ht && (!t.desde || ht < t.desde)) t.desde = ht;
      /*
       * Cidade publicada entra na conta, com ou sem o bloco de totais.
       *
       * Antes ela era pulada por `!linha.ts`, e o buraco não aparecia em lugar nenhum: a tela dizia
       * "126 de 817 cidades" como se fossem só essas as apuradas. Agora toda cidade com voto conta,
       * e a que não trouxe os totais vira `semTotais` — um número na tela, não um sumiço.
       */
      if (!linha.ts) t.semTotais++;
      t.cidades++;
      t.nominais += linha.vv;
      t.brancos += linha.vb ?? 0;
      t.nulos += linha.vn ?? 0;
      t.total += linha.tv ?? 0;
      t.secoes += linha.st ?? 0;
      t.secoesTotais += linha.ts ?? 0;
    }
    return t;
  }

  private payload(job: Job, uf: string): MunicipalPayload {
    const race = this.hooks.race(job.mode, uf, job.turn, job.office);
    const namesAt = race ? race.receivedAt : 0;
    /*
     * A última palavra sobre "não tem" é da configuração do TSE, não do laço de coleta.
     *
     * Só vale enquanto não chegou linha nenhuma: com cidades já recebidas, o que está na tela é
     * verdade e continua valendo. E precisa ser decidido antes do atalho de cache logo abaixo,
     * senão a resposta guardada devolve a mensagem antiga e o conserto não aparece.
     */
    let status = job.status;
    let message = job.message;
    if (job.mode !== 'historico' && !job.rows.size && this.fontePublicaMunicipios(job) === false) {
      status = 'unavailable';
      message = `O TSE não publica resultado por município ${job.area === 'BR' ? 'nesta fonte' : `de ${job.area} nesta fonte`}.`;
    }
    if (job.body && job.body.version === job.version && job.body.namesAt === namesAt) return { ...job.body.payload, uf, status, message, fetches: job.fetches, sourceAt: job.sourceAt };
    const totals = new Map<string, number>();
    for (const row of job.rows.values()) for (const [n, v] of row.cand) totals.set(n, (totals.get(n) || 0) + v);
    const c = [...totals].sort((a, b) => b[1] - a[1]);
    const index = new Map(c.map(([n], i) => [n, i]));
    const byCdi = new Map(job.muns.map(m => [m.cdi, m]));
    const m: MunicipalPayload['m'] = [];
    for (const [cdi, row] of job.rows) {
      const ref = byCdi.get(cdi);
      const entry: MunicipalPayload['m'][number] = [cdi, ref?.nm ?? cdi, ref?.uf ?? job.area, row.vv, row.cand.flatMap(([n, v]) => [index.get(n)!, v])];
      const ht = ref && job.stamps.get(`${ref.uf}${ref.cd}`)?.ht;
      if (ht) entry.push(ht);
      m.push(entry);
    }
    const n: MunicipalPayload['n'] = {};
    if (race) for (const cand of race.candidates) if (totals.has(cand.number)) n[cand.number] = [cand.name, cand.party];
    const payload: MunicipalPayload = {
      mode: job.mode, uf, turn: job.turn, office: job.office, area: job.area, status, message, totais: this.somar(job),
      loaded: job.muns.length ? Math.min(job.rows.size, job.muns.length) : 0, total: job.muns.length, version: job.version, sourceAt: job.sourceAt, fetches: job.fetches, c, m, n,
    };
    job.body = { version: job.version, namesAt, payload };
    return payload;
  }

  // --- 2022 builds on disk -------------------------------------------------------------------
  /**
   * Onde a varredura de um cargo fica guardada.
   *
   * O 2022 é um resultado fechado e mora num arquivo só, com o nome que sempre teve — há 47 deles
   * em disco e eles continuam válidos. O ao vivo leva a sessão no caminho, como o gravador das
   * corridas já faz: a janela da tarde não pode abrir com os números da manhã, e a apuração de
   * outubro não pode herdar nada de um simulado de setembro.
   */
  private builtPath(job: Job) {
    if (job.mode === 'historico') return `${this.dataDir}/municipal/historico-t${job.turn}-${job.area.toLowerCase()}-${job.office}.json`;
    const sessao = this.hooks.session(job.mode) || 'sem-sessao';
    return `${this.dataDir}/municipal/${job.mode}/${sessao}/t${job.turn}-${job.area.toLowerCase()}-${job.office}.json`;
  }

  /**
   * Repõe do disco o que já tinha sido varrido.
   *
   * Vale para toda fonte, não só para 2022. O relato que trouxe isto à tona: reiniciar deixava
   * todas as tabelas de cidade vazias, porque o dado ao vivo só existia em memória — e, fora da
   * janela, o laço decide `rows.size ? 'ready' : 'waiting'`, então a tela ficava em "waiting" para
   * sempre, sem explicação e sem saída. Um restart no meio de uma apuração custava, além disso,
   * rebuscar 8.983 arquivos do TSE.
   */
  private async loadBuilt(job: Job) {
    const legacy = job.mode === 'historico' && job.turn === 1 && (job.area === 'MG' || (job.area === 'BR' && job.office === 'president'))
      ? `${this.dataDir}/territorio-build/${job.area === 'BR' ? 'br-presidente' : `mg-${{ governor: 'governador', senate: 'senado', federal: 'deputado-federal', state: 'deputado-estadual', president: '' }[job.office]}`}.json`
      : null;
    for (const path of [this.builtPath(job), legacy]) {
      if (!path) continue;
      try {
        const file = JSON.parse(await readFile(path, 'utf8')) as {
          c: [string, number][]; m: [string, string, string, number, number[]][]; t?: number[][];
          k?: [string, string, string, number, number][]; b?: [string, string][];
        };
        job.muns = file.m.map(([cdi, nm, uf]) => ({ cdi, nm, uf, cd: '', capital: false }));
        file.m.forEach(([cdi, , , vv, pairs], i) => {
          const cand: [string, number][] = [];
          for (let k = 0; k < pairs.length; k += 2) cand.push([file.c[pairs[k]][0], pairs[k + 1]]);
          // who won a city is read off the head of this list, so it is sorted here rather than
          // trusted from the file: a build written in the wrong order would invert a result
          cand.sort((a, b) => b[1] - a[1]);
          // `t` só existe nos arquivos gravados depois que os totais por cidade passaram a ser
          // guardados; sem ele a cidade entra sem eles, e a conferência aparece incompleta.
          const [vb, vn, tv, st, ts, esq] = file.t?.[i] ?? [];
          job.rows.set(cdi, { vv, cand, vb, vn, tv, st, ts, esq });
        });
        // Os carimbos e as buscas voltam junto: é o que faz o restart retomar em vez de recomeçar.
        for (const [k, stamp, ht, te, finished] of file.k ?? []) job.stamps.set(k, { stamp, ht, te, finished: !!finished });
        for (const [cdi, stamp] of file.b ?? []) job.fetched.set(cdi, stamp);
        job.version = 1;
        job.salvo = { version: job.version, em: Date.now() };
        // Disco não é confirmação: para o ao vivo, isto é ponto de partida até a fonte responder.
        job.confirmado = job.mode === 'historico';
        if (job.mode === 'historico') { job.status = 'ready'; job.message = `Resultado final de ${ARCHIVE.year} por município.`; }
        // Ao vivo o número continua andando: o que veio do disco é ponto de partida, e quem decide
        // se está completo é o laço, comparando com a lista de municípios da fonte.
        else job.message = 'Resultados por município recuperados do disco.';
        return;
      } catch { /* not built yet */ }
    }
  }

  private async saveBuilt(job: Job) {
    const payload = this.payload(job, job.focus);
    const path = this.builtPath(job);
    /*
     * `t` guarda os totais que o TSE publica por cidade — brancos, nulos, total e seções.
     * Sem ele, cada reinício apagava esses campos e eles só voltavam se a cidade fosse rebuscada;
     * a conferência da apuração pelas cidades ficava zerada sem explicação.
     */
    const totais = payload.m.map(([cdi]) => {
      const r = job.rows.get(cdi);
      // O sexto campo é a versão do esquema: arquivo gravado por um parser mais velho volta do
      // disco marcado como velho, e o laço rebusca a cidade em vez de servir zeros para sempre.
      return [r?.vb ?? 0, r?.vn ?? 0, r?.tv ?? 0, r?.st ?? 0, r?.ts ?? 0, r?.esq ?? 0];
    });
    /*
     * `k` e `b`: os carimbos do andamento e o que já foi buscado com cada carimbo.
     *
     * Sem eles um processo novo nascia sem saber nada sobre nada: toda cidade entrava como suja e
     * o restart custava rebuscar tudo — 8.983 arquivos, medidos em 23/09/2026. Guardando os dois,
     * a coleta recomeça de onde parou e só vai ao TSE atrás do que o próprio TSE diz ter mudado.
     *
     * Só ao vivo: o histórico não tem andamento.
     */
    const carimbos = [...job.stamps].map(([k, c]) => [k, c.stamp, c.ht, c.te, c.finished ? 1 : 0]);
    const buscados = [...job.fetched];
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify({ c: payload.c, m: payload.m, t: totais, k: carimbos, b: buscados }));
    await rename(`${path}.tmp`, path);
    job.salvo = { version: job.version, em: Date.now() };
  }

  /**
   * Grava se houver o que gravar, e não mais que de trinta em trinta segundos.
   *
   * O arquivo de um cargo passa de um megabyte, e a varredura muda a versão a cada cidade que
   * chega: escrever a cada volta seria reescrever um megabyte por segundo sem necessidade. Trinta
   * segundos é o que se perde num corte de luz, contra uma apuração inteira que se perdia antes.
   */
  private async talvezSalvar(job: Job, forcar = false) {
    if (job.mode === 'historico' || !job.rows.size || job.version === job.salvo.version) return;
    if (!forcar && Date.now() - job.salvo.em < 30_000) return;
    await this.saveBuilt(job).catch(e => console.error('Municípios:', e instanceof Error ? e.message : e));
  }

  /** Descarrega o que estiver pendente. O encerramento do processo não pode levar a varredura junto. */
  async encerrar() {
    for (const job of this.jobs.values()) await this.talvezSalvar(job, true);
  }

  private rowCachePath(election: string, code: number, uf: string, cd: string) {
    return `${this.dataDir}/tse-cache/municipal/${election}/c${String(code).padStart(4, '0')}/${uf.toLowerCase()}${cd}.json`;
  }

  // --- collection ----------------------------------------------------------------------------
  private async run(job: Job) {
    job.running = true;
    try {
      while (Date.now() - job.lastRequest < KEEPALIVE) {
        if (this.transport.cooldownUntil > Date.now()) {
          job.status = 'paused'; job.message = 'Consultas ao TSE pausadas após resposta do servidor. Retomada automática.';
          await this.pausa(Math.min(60_000, this.transport.cooldownUntil - Date.now())); continue;
        }
        if (job.mode === 'simulado' && !this.hooks.allowed('simulado')) {
          job.status = job.rows.size ? 'ready' : 'waiting'; job.message = 'Fora da janela de testes do TSE: municípios não são consultados agora.';
          await this.pausa(30_000); continue;
        }
        const target = this.target(job);
        if (!target) { job.status = job.rows.size ? job.status : 'waiting'; job.message = 'Aguardando a configuração da eleição ser publicada pelo TSE.'; await this.pausa(10_000); continue; }
        const muns = await this.config(target.configUrl, job.area, job.mode === 'historico' ? ARCHIVE_TTL : 10 * 60_000);
        if (!muns) {
          /*
           * Faltar a lista quer dizer duas coisas diferentes, e dizer "buscando" nas duas era o que
           * fazia a tabela de cidades parecer quebrada.
           *
           * Se o arquivo de configuração ainda não chegou, estamos mesmo buscando. Mas se ele
           * chegou e esta área não está nele, não há o que buscar, e a tela precisa dizer isso em
           * vez de girar para sempre prometendo resultados que a fonte não tem.
           */
          const lida = this.rawConfigs.has(target.configUrl);
          if (lida && !job.muns.length) {
            job.status = 'unavailable';
            job.message = `O TSE não publica resultado por município ${job.area === 'BR' ? 'nesta fonte' : `de ${job.area} nesta fonte`}.`;
            await this.pausa(60_000);
          } else {
            if (!job.muns.length) job.message = 'Buscando a lista de municípios no TSE.';
            await this.pausa(5000);
          }
          continue;
        }
        if (!job.muns.length || job.muns.length !== muns.length || !job.muns[0].cd) {
          job.muns = muns;
          // A different list (e.g. a country-wide config read before the state one) leaves rows that do not
          // belong here: drop them, otherwise the progress counts more cities than the state has.
          const keep = new Set(muns.map(m => m.cdi));
          for (const cdi of [...job.rows.keys()]) if (!keep.has(cdi)) { job.rows.delete(cdi); job.version++; }
          /*
           * `fetched` é indexado por `cdi`, e a poda usava `uf+cd` — as chaves nunca casavam, então
           * ela apagava o mapa inteiro a cada vez que a lista de municípios era atribuída. Enquanto
           * o mapa só vivia em memória isso passou despercebido; com os carimbos vindo do disco,
           * era o que jogava fora justamente o que tinha acabado de ser lido.
           *
           * Os carimbos, esses sim, são indexados por `uf+cd`, e é neles que a poda faz sentido.
           */
          for (const k of [...job.fetched.keys()]) if (!keep.has(k)) job.fetched.delete(k);
          const keepCodes = new Set(muns.map(m => `${m.uf}${m.cd}`));
          for (const k of [...job.stamps.keys()]) if (!keepCodes.has(k)) job.stamps.delete(k);
        }
        if (job.status === 'loading' && !job.rows.size) job.message = 'Buscando os resultados por município no TSE.';
        // A faixa municipal é uma só: quem não é a varredura da vez espera (ver `vezDeVarrer`).
        if (!this.vezDeVarrer(job)) { await this.pausa(2000); continue; }
        if (job.mode !== 'historico') {
          // Live: read the UF progress file and fetch only the cities whose stamp changed; rotation only as a fallback.
          if (job.rows.size < job.muns.length) { job.status = 'loading'; job.message = 'Recebendo os resultados por município.'; }
          const delta = await this.delta(job, target);
          if (!delta) await this.pass(job, target);
          /*
           * Confirmado quando a fonte respondeu alguma coisa para este job nesta execução.
           *
           * "Respondeu" é ter buscado alguma cidade ou ter lido o andamento de alguma UF. Olhar o
           * retorno de `delta` não serve: ele devolve 'idle' também quando o andamento veio do
           * cache e nenhuma cidade foi considerada — foi assim que o senado se declarou pronto com
           * `fetches=0`, servindo o que tinha vindo do disco.
           */
          if (job.fetches > 0 || job.abSeen.size > 0) job.confirmado = true;
          job.status = job.confirmado && job.rows.size >= job.muns.length ? 'ready' : 'loading';
          job.message = job.status === 'ready' ? 'Resultados por município recebidos do TSE.' : 'Recebendo os resultados por município.';
          await this.talvezSalvar(job, job.status === 'ready');
          await this.pausa(delta === 'idle' ? 3000 : delta ? 500 : 5000);
          continue;
        }
        const done = await this.pass(job, target);
        {
          if (job.rows.size >= job.muns.length) {
            job.status = 'ready'; job.message = `Resultado final de ${ARCHIVE.year} por município.`;
            await this.saveBuilt(job).catch(e => console.error('Municípios:', e instanceof Error ? e.message : e));
            break;
          }
          job.status = 'loading'; job.message = 'Buscando os resultados por município no TSE.';
          if (!done) await this.pausa(3000);
        }
      }
    } catch (e) {
      job.message = e instanceof Error ? e.message : 'Falha ao montar os municípios';
    } finally { job.running = false; }
  }

  /**
   * Live delta pass. The viewer's UF file every AB_INTERVAL; for the president (Brazil) one more UF per pass, in rotation.
   * Returns false when no progress file could be read yet, 'idle' when nothing changed, true after fetching changed cities.
   */
  /**
   * As cidades de uma candidatura só, já prontas para a folha desenhar.
   *
   * O caminho normal devolve o mapa inteiro — toda cidade com todos os candidatos —, e a folha
   * jogava fora tudo menos um nome: 109 KB no governador de Minas, 748 KB na presidência. Filtrar
   * aqui manda uma fração disso e tira do navegador a varredura de milhares de pares.
   *
   * `pos` é a colocação da candidatura naquela cidade, que é o que a coluna da direita mostra; ela
   * sai da ordem publicada pelo TSE, não de conta nossa.
   */
  async porCandidatura(mode: Mode, uf: string, turn: Turn, office: Office, numero: string): Promise<CandidaturaMunicipal> {
    const bruto = await this.get(mode, uf, turn, office);
    if ('unchanged' in bruto) return { status: bruto.status, message: bruto.message, loaded: bruto.loaded, total: bruto.total, cidadesComResultado: 0, totais: { cidades: 0, nominais: 0, brancos: 0, nulos: 0, total: 0, secoes: 0, secoesTotais: 0, desde: '', semTotais: 0 }, numero, linhas: [] };

    /*
     * Cidade que já publicou e não deu voto nenhum também entra, com zero.
     *
     * Ficar de fora fazia as duas coisas se confundirem: "a candidatura não teve voto aqui" e "esta
     * cidade ainda não publicou" sumiam da lista do mesmo jeito. Com o zero na tela, o tamanho da
     * lista passa a ser o número de cidades apuradas, e a ausência vira informação.
     *
     * `pos` zero significa sem colocação — não há como ser primeiro em lugar onde não se teve voto.
     */
    const linhas: CandidaturaMunicipal['linhas'] = [];
    const indice = bruto.c.findIndex(([n]) => n === numero);
    for (const [, nome, ufCidade, validos, pares] of bruto.m) {
      if (validos <= 0) continue;                       // esta cidade ainda não publicou
      let votos = 0, pos = 0;
      if (indice >= 0) {
        for (let k = 0; k < pares.length; k += 2) {
          if (pares[k] !== indice) continue;
          votos = pares[k + 1];
          pos = k / 2 + 1;
          break;
        }
      }
      linhas.push([nome, ufCidade, votos, validos, pos]);
    }
    linhas.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'pt-BR'));
    const cidadesComResultado = bruto.m.reduce((t, [, , , vv]) => t + (vv > 0 ? 1 : 0), 0);

    /*
     * A soma das cidades, campo a campo. Nenhum destes números é conta nossa: são os que o TSE
     * publica em cada arquivo municipal, somados. É por isso que eles servem de conferência do
     * total da disputa, que vem por outro arquivo e outro caminho.
     */
    const totais = this.somar(this.jobs.get(`${mode}:${turn}:${this.area(office, uf)}:${office}`));
    return { status: bruto.status, message: bruto.message, loaded: bruto.loaded, total: bruto.total, cidadesComResultado, totais, numero, linhas };
  }

  /**
   * Uma varredura de cada vez, e é a da tela.
   *
   * Cada cargo aberto vira um job próprio, e cada estado visitado mais um punhado: com o painel de
   * Minas aberto havia cerca de vinte e oito varreduras simultâneas dividindo a mesma faixa.
   * Medido em 23/09/2026, durante a janela: 42 req/s de arquivos municipais no total, e o job que
   * enchia a tabela na tela recebia 1,5 desses 42. Banda não faltava; faltava ordem — ninguém
   * terminava porque todos andavam um pouquinho.
   *
   * A regra é a mais simples que resolve: quem foi pedido mais recentemente e ainda não fechou leva
   * a faixa inteira. Os outros esperam. Com 42 req/s, as 853 cidades de um cargo fecham em vinte
   * segundos, e aí a vez passa sozinha para o próximo — os demais cargos do mesmo estado primeiro,
   * porque continuam sendo os mais pedidos enquanto o painel está aberto.
   */
  private vezDeVarrer(job: Job): boolean {
    const agora = Date.now();
    const vivos = [...this.jobs.values()].filter(j => agora - j.lastRequest <= KEEPALIVE);
    if (!vivos.length) return true;
    const completo = (j: Job) => j.confirmado && !!j.muns.length && j.rows.size >= j.muns.length;
    const maisPedido = (a: Job, b: Job) => b.pedidoEm - a.pedidoEm;

    /*
     * O cargo que está na tela nunca perde a vez — nem depois de completo.
     *
     * A primeira versão desta regra tirava da disputa todo job completo, e aí um cargo recém-fechado
     * nunca mais ganhava a vez enquanto qualquer irmão estivesse incompleto: parava de reler o
     * andamento e congelava no meio da apuração. Um teste do laço pegou isso antes de ir para a
     * tela. A volta de um cargo completo é barata — um arquivo de andamento e as cidades cujo
     * carimbo mudou —, e é exatamente assim que ele continua acompanhando.
     */
    const daTela = [...vivos].sort(maisPedido)[0];
    if (job === daTela) return true;

    // Fora ele, uma varredura de fundo por vez: é o que impede os cargos aquecidos de dividirem a
    // faixa entre si até nenhum terminar.
    return vivos.filter(j => j !== daTela && !completo(j)).sort(maisPedido)[0] === job;
  }

  private async delta(job: Job, target: NonNullable<ReturnType<MunicipalService['target']>>): Promise<boolean | 'idle'> {
    if (!target.ab) return false;
    const ufs = [...new Set(job.muns.map(m => m.uf))];
    const focus = ufs.includes(job.focus) ? job.focus : ufs[0];
    const others = ufs.filter(u => u !== focus);

    /*
     * Enquanto o estado que está na tela não fechar, só ele é buscado.
     *
     * O arquivo municipal da presidência é nacional: 5.571 municípios. Varrer o país inteiro
     * enquanto alguém olha um estado gasta a faixa toda enchendo telas que ninguém abriu, e é o
     * que fazia a tabela de cidades demorar a aparecer mesmo com a coleta funcionando. Os outros
     * estados entram quando o da tela fecha — que é também quando sobra faixa para eles.
     *
     * "O da tela" é sempre o selecionado agora, não o de quando a volta começou: trocar de estado
     * redireciona a coleta imediatamente (ver a checagem de `job.focus` dentro do trabalhador).
     *
     * O andamento dos outros também não é lido nessa fase: é uma requisição por passada que só
     * serviria para marcar como sujas cidades que não vão ser buscadas agora.
     */
    const doFoco = job.muns.filter(m => m.uf === focus);
    const focoCompleto = doFoco.length > 0 && doFoco.every(m => job.rows.has(m.cdi));
    const read = focoCompleto && others.length ? [focus, others[job.abRotation++ % others.length]] : [focus];
    for (const uf of read) {
      const url = target.ab(uf);
      const raw = await this.transport.get(url, AB_INTERVAL, { retain: false, timeoutMs: 20_000 });
      // 304 quer dizer que o andamento deste estado continua valendo, e os carimbos dele já estão
      // guardados — o estado segue visto. Sem esta linha ele saía de `abSeen` na segunda passada e
      // as cidades dele paravam de ser consideradas.
      if (raw === NOT_MODIFIED) { job.abSeen.add(uf); continue; }
      if (!raw) continue;
      try {
        const ab = parseAb(raw, target.election);
        for (const [cd, city] of ab.cities) job.stamps.set(`${uf}${cd}`, city);
        if (ab.sourceAt && (!job.sourceAt || ab.sourceAt > job.sourceAt)) job.sourceAt = ab.sourceAt;
        job.abSeen.add(uf);
      } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Andamento inválido'); }
    }
    if (!job.abSeen.size) return false;
    const stampOf = (m: MunRef) => job.stamps.get(`${m.uf}${m.cd}`);
    /*
     * Cidade que nunca foi buscada entra sempre; as já buscadas, só quando o carimbo muda.
     *
     * A condição exigia `abSeen` para as duas coisas, e `delta` lê o andamento de dois estados por
     * passada — o em foco e um por rodízio. Os outros nunca entravam, suas cidades nunca eram
     * consideradas sujas, e como `delta` devolvia 'idle' a varredura completa (`pass`) também não
     * rodava: a presidência parava em 575 dos 5.571 municípios e ficava ali. A tabela de cidades
     * abria vazia porque ninguém tinha ido buscar.
     *
     * O carimbo continua mandando na releitura, que é o que mantém a conta de requisições baixa
     * depois que a primeira volta termina.
     */
    const dirty = (focoCompleto ? job.muns : doFoco)
      .filter(m => !job.rows.has(m.cdi) || job.rows.get(m.cdi)!.esq !== ESQUEMA
        || (job.abSeen.has(m.uf) && stampOf(m) && job.fetched.get(m.cdi) !== stampOf(m)!.stamp))
      .sort((a, b) => Number(b.uf === focus) - Number(a.uf === focus) || (stampOf(b)?.te || 0) - (stampOf(a)?.te || 0));
    if (!dirty.length) return 'idle';
    let i = 0;
    const worker = async () => {
      while (i < dirty.length) {
        const m = dirty[i++];
        if (Date.now() - job.lastRequest > KEEPALIVE || this.transport.cooldownUntil > Date.now()) return;
        /*
         * Trocou o estado na tela? Esta volta perdeu a validade.
         *
         * Sem isto, escolher São Paulo no meio de uma varredura de Minas deixava os dezesseis
         * trabalhadores terminarem as 853 cidades mineiras antes de olhar para São Paulo — minutos
         * enchendo uma tela que ninguém está mais vendo. A próxima volta já monta a lista do estado
         * novo, então basta sair daqui.
         */
        if (job.focus !== focus) return;
        const stamp = stampOf(m)?.stamp ?? '';
        const url = target.url(m);
        /*
         * Uma cidade não é relida mais rápido que o arquivo que anuncia que ela mudou.
         *
         * O intervalo era de 1,5 s, e como o arquivo de andamento só é relido a cada `AB_INTERVAL`
         * não havia como descobrir nada de novo nesse meio-tempo: sobrava um pedido por cidade a
         * cada segundo e meio, todos respondendo 304. Amarrar os dois ritmos tira esse desperdício
         * sem atrasar nada — quando o carimbo muda, a cidade entra na lista da próxima volta.
         */
        const raw = await this.transport.get(url, AB_INTERVAL, { priority: 'low', retain: false, timeoutMs: 30_000, expectMissing: true });
        if (raw === null) continue;
        job.fetches++;
        if (raw === NOT_MODIFIED) { job.fetched.set(m.cdi, stamp); continue; }
        try {
          const row = parseMunicipal(raw, { election: target.election, cd: m.cd, office: job.office, uf: m.uf });
          this.guardar(job, m.cdi, row);
          job.fetched.set(m.cdi, stamp);
          job.lidaEm.set(m.cdi, Date.now());
        } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Arquivo municipal inválido'); }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    return true;
  }

  private target(job: Job): { election: string; configUrl: string; url: (m: MunRef) => string; code: (uf: string) => number; ab?: (uf: string) => string } | null {
    const code = (uf: string) => officeCode(job.office, uf);
    if (job.mode === 'historico') {
      const election = archiveElection(job.office, job.turn);
      if (!election) return null;
      const base = `${ARCHIVE.base}/${election}`;
      return {
        election, code, configUrl: `${base}/config/mun-e${pad6(election)}-cm.json`,
        url: m => `${base}/dados/${m.uf.toLowerCase()}/${m.uf.toLowerCase()}${m.cd}-c${String(code(m.uf)).padStart(4, '0')}-e${pad6(election)}-v.json`,
      };
    }
    const mode = job.mode as LiveMode;
    const ref = this.hooks.election(mode, job.office, job.area, job.turn);
    if (!ref || !/^\d{1,6}$/.test(ref.code) || ref.cycle !== 'ele2026') return null;
    const base = `${BASES[mode]}/${ref.cycle}/${ref.code}`;
    return {
      election: ref.code, code, configUrl: `${base}/config/mun-e${pad6(ref.code)}-cm.json`,
      ab: uf => `${base}/dados/${uf.toLowerCase()}/${uf.toLowerCase()}-e${pad6(ref.code)}-ab.json`,
      url: m => `${base}/dados/${m.uf.toLowerCase()}/${m.uf.toLowerCase()}${m.cd}-c${String(code(m.uf)).padStart(4, '0')}-e${pad6(ref.code)}-u.json`,
    };
  }

  /**
   * The municipal configuration is ONE file for every state. Keep the whole file per URL and slice the
   * state from it: the transport only re-downloads it after its TTL, so caching a single state's slice
   * left every other state waiting on "Buscando a lista de municípios" until the TTL expired.
   */
  private async config(url: string, area: string, ttl: number): Promise<MunRef[] | null> {
    const key = `${url}#${area}`;
    const cached = this.configs.get(key);
    const raw = await this.transport.get(url, ttl, { priority: 'normal', retain: true, timeoutMs: 30_000 });
    if (raw && raw !== NOT_MODIFIED) this.rawConfigs.set(url, raw);
    let source = this.rawConfigs.get(url);
    if (!source) {
      // 2022 configs were already downloaded by the Território build script: use them from disk.
      const local = url.match(/\/(mun-e\d{6}-cm\.json)$/)?.[1];
      if (local) try { source = JSON.parse(await readFile(`${this.dataDir}/tse-cache/territorio-2022/${local}`, 'utf8')); this.rawConfigs.set(url, source); } catch { /* not on disk */ }
    }
    if (source && (!cached || (raw && raw !== NOT_MODIFIED))) {
      const muns = readConfig(source, area);
      if (muns.length) this.configs.set(key, muns);
      // Uma fonte que não lista municípios para esta área não é falha de rede, e vira mensagem na
      // tela em vez de espera eterna — vale registrar quando acontece.
      // Uma fonte que não lista municípios para esta área não é falha de rede: vira mensagem na
      // tela em vez de espera eterna, e vale registrar quando acontece.
      else console.log(`Municípios: a configuração do TSE (${url}) não traz ${area}.`);
    }
    return this.configs.get(key) ?? null;
  }

  /**
   * Grava a linha de uma cidade, e diz se alguma coisa mudou.
   *
   * A comparação olhava só `vv` e `cand`. Um arquivo cujos votos não mudaram mas que agora traz
   * campos que antes não líamos era descartado inteiro — o segundo caminho pelo qual as cidades
   * de Minas ficaram congeladas em 23/09/2026. Aqui a linha nova entra sempre que qualquer campo
   * diferir, inclusive a versão do esquema.
   */
  private guardar(job: Job, cdi: string, row: Row): boolean {
    const nova: Row = { ...row, esq: ESQUEMA };
    const velha = job.rows.get(cdi);
    const igual = velha
      && velha.esq === nova.esq && velha.vv === nova.vv
      && velha.vb === nova.vb && velha.vn === nova.vn && velha.tv === nova.tv
      && velha.st === nova.st && velha.ts === nova.ts
      && JSON.stringify(velha.cand) === JSON.stringify(nova.cand);
    job.rows.set(cdi, nova);
    if (igual) return false;
    job.version++;
    return true;
  }

  /**
   * A cidade acabou e nós já temos o resultado dela.
   *
   * `and='f'` no arquivo de andamento é o TSE dizendo que a totalização daquele município
   * encerrou; conferido na fonte em 23/09/2026, com as 853 cidades de Minas encerradas, nenhum
   * carimbo mudou em vinte segundos. Com a linha já gravada e o carimbo igual ao da busca, não há
   * o que descobrir pedindo de novo.
   */
  private encerrada(job: Job, m: MunRef): boolean {
    const carimbo = job.stamps.get(`${m.uf}${m.cd}`);
    if (!carimbo?.finished || job.fetched.get(m.cdi) !== carimbo.stamp) return false;
    const linha = job.rows.get(m.cdi);
    /*
     * Duas razões para reler uma cidade que o TSE já declarou encerrada.
     *
     * A primeira é o esquema: linha lida por um parser mais velho não tem os campos que hoje
     * sabemos extrair, e nenhum carimbo vai mudar para avisar disso. Foi o que congelou 691
     * cidades de Minas em 23/09/2026.
     *
     * A segunda é não confiar em "encerrada" como palavra final nossa. Uma conferência a cada
     * `RELEITURA` custa 853 requisições por estado a cada dez minutos — nada perto do teto do
     * TSE — e é o que garante que o mapa inteiro continue certo até o fim, em vez de certo até o
     * momento em que paramos de olhar.
     */
    if (!linha || linha.esq !== ESQUEMA) return false;
    return Date.now() - (job.lidaEm.get(m.cdi) ?? 0) < RELEITURA;
  }

  /** One pass over the municipalities, the viewer's own state first. Returns true when nothing was left to try. */
  private async pass(job: Job, target: NonNullable<ReturnType<MunicipalService['target']>>): Promise<boolean> {
    const order = [...job.muns].sort((a, b) => Number(b.uf === job.focus) - Number(a.uf === job.focus) || Number(b.capital) - Number(a.capital));
    let i = 0, pending = false;
    const interval = job.mode === 'historico' ? ARCHIVE_TTL : LIVE_CYCLE;
    const worker = async () => {
      while (i < order.length) {
        const m = order[i++];
        if (Date.now() - job.lastRequest > KEEPALIVE || this.transport.cooldownUntil > Date.now()) { pending = true; return; }
        if (job.mode === 'historico' && job.rows.has(m.cdi)) continue;
        if (job.mode === 'historico' && await this.fromDisk(job, target, m)) continue;
        /*
         * Cidade que o TSE declarou encerrada e que já temos não é pedida de novo.
         *
         * A varredura completa repassava por todas as cidades a cada ciclo, e ao fim da apuração
         * isso vira trabalho puro de 304. Medido em 23/09/2026, com a simulação em 100%: 42 req/s
         * de arquivos municipais, todos "não modificado", com nada para descobrir. O `and='f'` do
         * arquivo de andamento é o próprio TSE dizendo que aquele município acabou — depois disso
         * o arquivo não muda mais.
         */
        if (job.mode !== 'historico' && this.encerrada(job, m)) continue;
        const url = target.url(m);
        const raw = await this.transport.get(url, interval, { priority: 'low', retain: false, timeoutMs: 30_000, expectMissing: true });
        if (raw === null) { if (job.mode === 'historico') pending = true; continue; }
        // A varredura completa também conta: `fetches` é o que diz que a fonte respondeu para este
        // job nesta execução, e era ele que faltava para um job vindo do disco se confirmar.
        job.fetches++;
        if (raw === NOT_MODIFIED) continue;
        try {
          const row = parseMunicipal(raw, { election: target.election, cd: m.cd, office: job.office, uf: m.uf });
          this.guardar(job, m.cdi, row);
          job.lidaEm.set(m.cdi, Date.now());
          // O carimbo da busca também é anotado aqui, senão `encerrada` nunca reconhece as cidades
          // que vieram pela varredura completa e elas continuam sendo repedidas para sempre.
          if (job.mode !== 'historico') job.fetched.set(m.cdi, job.stamps.get(`${m.uf}${m.cd}`)?.stamp ?? '');
          if (row.sourceAt && (!job.sourceAt || row.sourceAt > job.sourceAt)) job.sourceAt = row.sourceAt;
          if (job.mode === 'historico') {
            const path = this.rowCachePath(target.election, target.code(m.uf), m.uf, m.cd);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify([row.vv, row.cand]));
          }
        } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Arquivo municipal inválido'); pending = true; }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    return !pending;
  }

  /** 2022 rows already on disk: this service's own cache, or the raw files kept by scripts/territorio-2022.mjs. */
  private async fromDisk(job: Job, target: NonNullable<ReturnType<MunicipalService['target']>>, m: MunRef): Promise<boolean> {
    const code = target.code(m.uf);
    try {
      const [vv, cand] = JSON.parse(await readFile(this.rowCachePath(target.election, code, m.uf, m.cd), 'utf8')) as [number, [string, number][]];
      job.rows.set(m.cdi, { vv, cand }); job.version++;
      return true;
    } catch { /* not cached */ }
    try {
      const folder = `${target.election === '544' ? 'p' : 'c'}${String(code).padStart(4, '0')}`;
      const raw = JSON.parse(await readFile(`${this.dataDir}/tse-cache/territorio-2022/${folder}/${m.uf.toLowerCase()}${m.cd}.json`, 'utf8'));
      const row = parseMunicipal(raw, { election: target.election, cd: m.cd, office: job.office, uf: m.uf });
      job.rows.set(m.cdi, { vv: row.vv, cand: row.cand }); job.version++;
      return true;
    } catch { return false; }
  }

}

/** Every UF code accepted by the route. */
export const MUNICIPAL_UFS = STATES.map(s => s.uf);
