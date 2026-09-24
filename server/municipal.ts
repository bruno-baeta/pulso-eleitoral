import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
   * Os estados que estão na tela de alguém agora.
   *
   * `live()` são os 27 que a janela do TSE manda gravar, e entre eles não há ordem nenhuma — foi
   * por isso que o aquecimento municipal começava por um cargo fixo de cada estado, sem saber qual
   * estado alguém estava olhando. A rodada precisa dessa diferença: o estado da TV vem antes de
   * qualquer outro, e os demais só recebem a folga que ele deixar.
   */
  foco(): { mode: Mode; uf: string; turn: Turn }[];
  /**
   * O eleitorado da UF, para ordenar os estados que não estão na tela.
   *
   * Sai do próprio arquivo do TSE — o total de eleitores da disputa —, e não de uma lista escrita
   * à mão, que seria opinião a ser revisada a cada eleição. Estado cuja corrida ainda não chegou
   * responde zero e vai para o fim da fila, o que é o certo: dele também não se sabe ainda qual
   * eleição consultar.
   */
  eleitorado(mode: Mode, uf: string, turn: Turn): number;
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
  /**
   * As seções do estado inteiro, e quantas já foram totalizadas — do arquivo de andamento.
   *
   * A porcentagem saía de `secoes/secoesTotais`, que são a soma **das cidades já buscadas**. Com 48
   * das 853 cidades de Minas publicadas, isso dava "98,48% apurado pelas cidades" ao lado de um
   * painel em 7,0%: o número era a fatia apurada dentro daquelas 48, não do estado. Um denominador
   * que cresce junto com o numerador nunca sai de perto de 100%.
   *
   * O arquivo de andamento da UF traz todas as cidades num instante só, e é dele que estes dois
   * saem. Zero quando ele ainda não foi lido — aí não há porcentagem a mostrar.
   */
  secoesEstado: number;
  secoesApuradasEstado: number;
}

export type MunicipalResponse = MunicipalPayload | ({ unchanged: true } & Pick<MunicipalPayload, 'status' | 'message' | 'loaded' | 'total' | 'version'>);

/** O que a folha de cidades desenha, e nada mais. */
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
  /** [nome, uf, votos, válidos, colocação, hora, seções apuradas, seções da cidade, código IBGE] */
  linhas: [string, string, number, number, number, string, number, number, string][];
}

/**
 * Uma disputa dentro de uma cidade: quem teve quantos votos ali.
 *
 * É a outra direção da mesma pergunta. A folha de cidades diz onde uma candidatura foi votada;
 * esta diz, dentro de um lugar, como a disputa ficou — que é como se lê um resultado municipal de
 * verdade, e o que permite ver a colocação de cada um naquela cidade.
 */
export interface CidadeMunicipal {
  status: MunicipalPayload['status'];
  message: string;
  /** Vazio quando esta cidade ainda não publicou nada. */
  nome: string;
  uf: string;
  /** Válidos, brancos, nulos e total da cidade, e o andamento dela — tudo publicado pelo TSE. */
  vv: number; vb: number; vn: number; tv: number;
  ht: string; st: number; ts: number;
  /** [número, nome, partido, cor, votos] — já em ordem de votação. */
  candidaturas: [string, string, string, string, number][];
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
  stamps: Map<string, AbCity>; fetched: Map<string, string>; abSeen: Set<string>; fetches: number;
  /** Quando cada cidade foi lida pela última vez. Encerrada não quer dizer nunca mais (ver `encerrada`). */
  lidaEm: Map<string, number>;
  /** Cidades que mudaram desde a última linha gravada, esperando virar um instante no disco. */
  mudadas: Map<string, Row>;
  /** Quando a primeira delas foi lida. É esta a hora do instante, não a da escrita. */
  mudadasDesde: number;
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

/**
 * Uma cidade no arquivo de andamento da UF.
 *
 * `st` e `ts` são as seções totalizadas e o total delas **naquela cidade**. Vêm daqui, e não do
 * arquivo de cada município, porque este arquivo traz todas as cidades do estado num instante só:
 * é o que permite dizer quanto do estado está apurado sem depender de quais cidades já foram
 * buscadas uma a uma.
 */
export interface AbCity { stamp: string; ht: string; te: number; st: number; ts: number; finished: boolean }

/** Onde o TSE publica uma eleição: a configuração, o andamento por UF e o arquivo de cada cidade. */
interface Alvo {
  election: string;
  configUrl: string;
  url: (m: MunRef) => string;
  code: (uf: string) => number;
  ab?: (uf: string) => string;
}
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

/**
 * O cargo pedido para abrir a rodada de um estado.
 *
 * Qualquer um serviria: quem busca é a rodada, e ela cobre os cinco cargos do estado. É o
 * governador porque ele existe nos dois turnos e é do próprio estado — a presidência é nacional, e
 * pedir por ela nomearia o país onde se quer nomear um estado.
 */
const SEMENTE: Office = 'governor';

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
      st: numeric(sections.st), ts: numeric(sections.ts),
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
   * Até quando um estado não tem nada a buscar.
   *
   * É o que passa a vez para o próximo estado sem perder o da tela: quando a rodada não encontra
   * cidade suja, o estado fica limpo até o arquivo de andamento poder ser lido de novo — antes
   * disso não há como descobrir nada novo nele. Vencido o prazo, ele retoma a vez.
   */
  private limpoAte = new Map<string, number>();

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

  /**
   * De qual estado é esta varredura.
   *
   * A presidência é nacional e o job dela vale para o país todo; o estado que importa é o que a
   * tela está olhando, guardado em `focus`. Para os outros cargos os dois são a mesma coisa.
   */
  private ufDaRodada(job: Job) { return job.area === 'BR' ? job.focus : job.area; }
  private chaveDoEstado(job: Job) { return `${job.mode}:${job.turn}:${this.ufDaRodada(job)}`; }

  /**
   * Um job novo. Existia copiado em três lugares, com os dezoito campos escritos à mão em cada um.
   *
   * Um campo acrescentado num lugar e esquecido nos outros é um job que se comporta diferente
   * conforme quem o criou, e nada aponta para isso.
   */
  private criarJob(mode: Mode, turn: Turn, area: string, office: Office, focus: string, lastRequest = Date.now()): Job {
    const job: Job = {
      key: `${mode}:${turn}:${area}:${office}`, mode, turn, office, area, focus,
      status: 'loading', message: 'Preparando os municípios.',
      muns: [], rows: new Map(), names: new Map(), version: 0, sourceAt: null,
      lastRequest, pedidoEm: 0, running: false,
      stamps: new Map(), fetched: new Map(), lidaEm: new Map(), mudadas: new Map(), mudadasDesde: 0,
      abSeen: new Set(), fetches: 0, salvo: { version: -1, em: 0 }, confirmado: false,
    };
    this.jobs.set(job.key, job);
    return job;
  }

  async get(mode: Mode, uf: string, turn: Turn, office: Office, since?: number, at?: number): Promise<MunicipalResponse> {
    const area = this.area(office, uf);
    const base = { mode, uf, turn, office, area, sourceAt: null, c: [], m: [], n: {}, loaded: 0, total: 0, version: 0, totais: this.somar(undefined) };
    if (!municipalOffices(turn).includes(office)) return { ...base, status: 'unavailable', message: 'Sem 2º turno para este cargo.' };
    if (mode === 'historico' && turn === 2 && office === 'governor' && !(ARCHIVE.runoffStates as readonly string[]).includes(uf)) {
      return { ...base, status: 'unavailable', message: `Não houve 2º turno para governador neste estado em ${ARCHIVE.year}.` };
    }
    const key = `${mode}:${turn}:${area}:${office}`;
    let job = this.jobs.get(key);
    if (!job) {
      job = this.criarJob(mode, turn, area, office, uf);
      await this.loadBuilt(job);
    }
    job.lastRequest = Date.now();
    job.pedidoEm = job.lastRequest;
    if (area === 'BR') job.focus = uf;
    if (mode === 'historico') this.interest.add(`${mode}:${uf}`);
    this.hooks.touch(mode, uf, turn);
    /*
     * Os outros cargos do estado existem desde já, porque a rodada preenche os cinco juntos.
     *
     * Cada cargo é um arquivo por cidade no TSE, e cada um tem o seu job — mas quem busca é a
     * rodada do estado, que baixa os cinco arquivos de cada cidade. Os irmãos precisam existir
     * antes disso para receberem as linhas.
     */
    this.warmSiblings(mode, uf, turn, office);
    if (!job.running && !(mode === 'historico' && job.status === 'ready')) void this.run(job);
    /*
     * Reproduzindo, a tabela vem da gravação — não do estado de agora.
     *
     * O cache por versão não vale aqui: a versão é a do ao vivo, e dois instantes diferentes têm a
     * mesma. Por isso o atalho de `since` fica depois desta saída.
     */
    if (at !== undefined) return this.payload(job, uf, await this.linhasEm(job, at));
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
        job = this.criarJob(mode, turn, area, office, uf);
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
   * Mantém o mapa municipal montado enquanto a apuração corre, na ordem certa dos estados.
   *
   * O aquecimento cobria só 2022, então quem passava a apuração em outra tela e abria o Território
   * começava as 853 cidades do zero, com a contagem já adiantada. Os estados daqui são os que já
   * estão sendo gravados de qualquer jeito, e só enquanto uma janela do TSE está aberta.
   *
   * Um cargo basta como semente: quem busca é a rodada do estado, e ela cobre os cinco. O que
   * importa aqui é a **ordem** — o estado que está na tela de alguém primeiro, depois os maiores.
   * Antes esta função pedia um cargo fixo (`governor`) de cada estado, na ordem em que a janela os
   * devolvia; medido na janela de 24/09/2026, foi isso que fez a gravação municipal de Minas
   * começar às 14:00:36 no governador e só às 14:20:19 no estadual — quem reproduzia o começo da
   * apuração via cidade em um cargo e tabela vazia nos outros quatro.
   */
  private async warmLive() {
    for (const { mode, uf, turn } of this.contextosPorPrioridade()) {
      if (!this.hooks.allowed(mode)) continue;
      await this.get(mode, uf, turn, SEMENTE).catch(() => null);
    }
  }

  /**
   * Os contextos ao vivo na ordem em que devem ser buscados: os da tela primeiro, depois por
   * eleitorado. Sem repetição — um estado que está na tela e também está sendo gravado é um só.
   */
  private contextosPorPrioridade(): { mode: Mode; uf: string; turn: Turn }[] {
    const unicos = new Map<string, { mode: Mode; uf: string; turn: Turn; foco: boolean }>();
    for (const c of this.hooks.foco()) unicos.set(`${c.mode}:${c.turn}:${c.uf}`, { ...c, foco: true });
    for (const c of this.hooks.live()) {
      const chave = `${c.mode}:${c.turn}:${c.uf}`;
      if (!unicos.has(chave)) unicos.set(chave, { ...c, foco: false });
    }
    return [...unicos.values()]
      .sort((a, b) => Number(b.foco) - Number(a.foco)
        || this.hooks.eleitorado(b.mode, b.uf, b.turn) - this.hooks.eleitorado(a.mode, a.uf, a.turn)
        || a.uf.localeCompare(b.uf))
      .map(({ mode, uf, turn }) => ({ mode, uf, turn }));
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
            job = this.criarJob('historico', turn, area, office, uf, 0);
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
  private somar(job: Job | undefined, linhas?: Map<string, Row>): TotaisMunicipais {
    const t: TotaisMunicipais = { cidades: 0, nominais: 0, brancos: 0, nulos: 0, total: 0, secoes: 0, secoesTotais: 0, desde: '', semTotais: 0, secoesEstado: 0, secoesApuradasEstado: 0 };
    /*
     * O estado inteiro, do andamento: toda cidade entra, tenha sido buscada ou não.
     *
     * É o que torna a porcentagem comparável com a do painel. As cidades buscadas dizem os votos;
     * o andamento diz o tamanho do todo.
     */
    for (const m of job?.muns ?? []) {
      const c = job?.stamps.get(`${m.uf}${m.cd}`);
      if (!c?.ts) continue;
      t.secoesEstado += c.ts;
      t.secoesApuradasEstado += c.st;
    }
    for (const [cdi, linha] of linhas ?? job?.rows ?? []) {
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

  /**
   * `linhas` põe no ar um instante gravado em vez do estado de agora; o cache de corpo é pulado,
   * porque ele guarda o retrato do ao vivo.
   */
  private payload(job: Job, uf: string, linhas?: Map<string, Row>): MunicipalPayload {
    const rows = linhas ?? job.rows;
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
    if (!linhas && job.body && job.body.version === job.version && job.body.namesAt === namesAt) return { ...job.body.payload, uf, status, message, fetches: job.fetches, sourceAt: job.sourceAt };
    const totals = new Map<string, number>();
    for (const row of rows.values()) for (const [n, v] of row.cand) totals.set(n, (totals.get(n) || 0) + v);
    const c = [...totals].sort((a, b) => b[1] - a[1]);
    const index = new Map(c.map(([n], i) => [n, i]));
    const byCdi = new Map(job.muns.map(m => [m.cdi, m]));
    const m: MunicipalPayload['m'] = [];
    for (const [cdi, row] of rows) {
      const ref = byCdi.get(cdi);
      const entry: MunicipalPayload['m'][number] = [cdi, ref?.nm ?? cdi, ref?.uf ?? job.area, row.vv, row.cand.flatMap(([n, v]) => [index.get(n)!, v])];
      const ht = ref && job.stamps.get(`${ref.uf}${ref.cd}`)?.ht;
      if (ht) entry.push(ht);
      m.push(entry);
    }
    const n: MunicipalPayload['n'] = {};
    if (race) for (const cand of race.candidates) if (totals.has(cand.number)) n[cand.number] = [cand.name, cand.party];
    const payload: MunicipalPayload = {
      mode: job.mode, uf, turn: job.turn, office: job.office, area: job.area, status, message, totais: this.somar(job, linhas),
      loaded: job.muns.length ? Math.min(rows.size, job.muns.length) : 0, total: job.muns.length, version: job.version, sourceAt: job.sourceAt, fetches: job.fetches, c, m, n,
    };
    if (!linhas) job.body = { version: job.version, namesAt, payload };
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
   * Onde ficam os instantes: a mesma chave do arquivo montado, em NDJSON.
   *
   * O arquivo montado é o retrato de agora e é reescrito por cima. Este é acréscimo puro, uma
   * linha por vez em que alguma cidade mudou — é dele que sai a tabela de um instante passado.
   */
  private gravacaoPath(job: Job) {
    if (job.mode === 'historico') return null;   // 2022 é resultado fechado: não tem instantes
    const sessao = this.hooks.session(job.mode) || 'sem-sessao';
    return `${this.dataDir}/municipal-instantes/${job.mode}/${sessao}/t${job.turn}-${job.area.toLowerCase()}-${job.office}.ndjson`;
  }

  /**
   * Grava as cidades que mudaram, com a hora.
   *
   * Sem isto a tabela de cidades só sabia dizer o agora: reproduzindo o minuto zero da apuração,
   * abrir um candidato devolvia "526.640 de 526.640 seções · 100,00%" ao lado de um painel em
   * 0,0%. Cada linha é um acréscimo pequeno — só as cidades que mudaram —, e a tabela de qualquer
   * instante é a soma das linhas até ele.
   */
  private async gravarInstante(job: Job) {
    const path = this.gravacaoPath(job);
    if (!path || !job.mudadas.size) return;
    const linhas = [...job.mudadas].map(([cdi, r]) => [cdi, r.vv, r.cand, r.vb ?? 0, r.vn ?? 0, r.tv ?? 0, r.st ?? 0, r.ts ?? 0]);
    const t = job.mudadasDesde || Date.now();
    job.mudadas.clear();
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify({ t, r: linhas }) + '\n');
    } catch (e) { console.error('Municípios (instantes):', e instanceof Error ? e.message : e); }
  }

  /**
   * A tabela como estava em `at`: as linhas gravadas até aquele instante, dobradas uma sobre a
   * outra. Cidade que ainda não tinha mudado simplesmente não está lá, que é o certo.
   */
  private async linhasEm(job: Job, at: number): Promise<Map<string, Row>> {
    const path = this.gravacaoPath(job);
    const rows = new Map<string, Row>();
    if (!path) return rows;
    let texto = '';
    try { texto = await readFile(path, 'utf8'); } catch { return rows; }
    for (const linha of texto.split('\n')) {
      if (!linha) continue;
      try {
        const { t, r } = JSON.parse(linha) as { t: number; r: [string, number, [string, number][], number, number, number, number, number][] };
        if (t > at) break;              // o arquivo é cronológico: o primeiro depois encerra a volta
        for (const [cdi, vv, cand, vb, vn, tv, st, ts] of r) rows.set(cdi, { vv, cand, vb, vn, tv, st, ts, esq: ESQUEMA });
      } catch { /* uma linha truncada por um desligamento não invalida as anteriores */ }
    }
    return rows;
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
          k?: [string, string, string, number, number, number?, number?][]; b?: [string, string][];
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
        for (const [k, stamp, ht, te, finished, st, ts] of file.k ?? []) job.stamps.set(k, { stamp, ht, te, finished: !!finished, st: st ?? 0, ts: ts ?? 0 });
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
    const carimbos = [...job.stamps].map(([k, c]) => [k, c.stamp, c.ht, c.te, c.finished ? 1 : 0, c.st, c.ts]);
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
    // Parar é parar: sem isto os laços seguiam escrevendo em disco depois do desligamento, e nos
    // testes a pasta temporária era apagada por baixo de uma gravação em curso (ENOTEMPTY).
    this.parado = true;
    for (const job of this.jobs.values()) { await this.gravarInstante(job); await this.talvezSalvar(job, true); }
  }

  private rowCachePath(election: string, code: number, uf: string, cd: string) {
    return `${this.dataDir}/tse-cache/municipal/${election}/c${String(code).padStart(4, '0')}/${uf.toLowerCase()}${cd}.json`;
  }

  // --- collection ----------------------------------------------------------------------------
  private parado = false;

  private async run(job: Job) {
    job.running = true;
    try {
      while (!this.parado && Date.now() - job.lastRequest < KEEPALIVE) {
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
          // Ao vivo: a rodada do estado lê o andamento e busca os cinco cargos de cada cidade suja.
          if (job.rows.size < job.muns.length) { job.status = 'loading'; job.message = 'Recebendo os resultados por município.'; }
          const cargos = await this.cargosDoEstado(job);
          const feito = await this.rodada(job, cargos);
          /*
           * Confirmado quando a fonte respondeu alguma coisa para este job nesta execução.
           *
           * "Respondeu" é ter buscado alguma cidade ou ter lido o andamento de alguma UF. Olhar o
           * retorno da rodada não serve: ela devolve 'idle' também quando o andamento veio do
           * cache e nenhuma cidade foi considerada — foi assim que o senado se declarou pronto com
           * `fetches=0`, servindo o que tinha vindo do disco.
           */
          for (const { job: irmao } of cargos) {
            if (irmao.fetches > 0 || irmao.abSeen.size > 0) irmao.confirmado = true;
            if (irmao === job) continue;
            irmao.status = irmao.confirmado && irmao.muns.length && irmao.rows.size >= irmao.muns.length ? 'ready' : irmao.status;
          }
          job.status = job.confirmado && job.rows.size >= job.muns.length ? 'ready' : 'loading';
          job.message = job.status === 'ready' ? 'Resultados por município recebidos do TSE.' : 'Recebendo os resultados por município.';
          /*
           * Os cinco cargos gravam o instante da mesma rodada.
           *
           * Antes cada cargo gravava por conta própria, quando lhe chegava a vez, e a vez chegava
           * minutos depois para os últimos: reproduzindo o começo de uma apuração, a tabela de
           * cidades existia num cargo e vinha vazia nos outros, dizendo que nenhuma cidade havia
           * publicado. Quem grava junto é quem foi buscado junto.
           */
          for (const { job: irmao } of cargos) {
            await this.gravarInstante(irmao);
            await this.talvezSalvar(irmao, irmao === job && job.status === 'ready');
          }
          // Nada sujo aqui: a vez passa ao próximo estado até o andamento poder dizer algo novo.
          if (feito === 'idle') this.limpoAte.set(this.chaveDoEstado(job), Date.now() + AB_INTERVAL);
          else this.limpoAte.delete(this.chaveDoEstado(job));
          await this.pausa(feito === 'idle' ? 3000 : feito ? 500 : 5000);
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
  async porCandidatura(mode: Mode, uf: string, turn: Turn, office: Office, numero: string, at?: number): Promise<CandidaturaMunicipal> {
    const bruto = await this.get(mode, uf, turn, office, undefined, at);
    if ('unchanged' in bruto) return { status: bruto.status, message: bruto.message, loaded: bruto.loaded, total: bruto.total, cidadesComResultado: 0, totais: { cidades: 0, nominais: 0, brancos: 0, nulos: 0, total: 0, secoes: 0, secoesTotais: 0, desde: '', semTotais: 0, secoesEstado: 0, secoesApuradasEstado: 0 }, numero, linhas: [] };

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
    /*
     * A hora e o apurado de cada cidade vêm do andamento da UF, não do arquivo dela.
     *
     * O andamento traz todas as cidades num instante só, inclusive as que ainda não foram
     * buscadas uma a uma — é a única fonte que sabe dizer, linha a linha, de quando é aquele
     * número e quanto daquela cidade já foi totalizado.
     */
    const job = this.jobs.get(`${mode}:${turn}:${this.area(office, uf)}:${office}`);
    const porCdi = new Map((job?.muns ?? []).map(m => [m.cdi, job!.stamps.get(`${m.uf}${m.cd}`)]));
    for (const [cdi, nome, ufCidade, validos, pares] of bruto.m) {
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
      const c = porCdi.get(cdi);
      linhas.push([nome, ufCidade, votos, validos, pos, c?.ht ?? '', c?.st ?? 0, c?.ts ?? 0, cdi]);
    }
    linhas.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'pt-BR'));
    const cidadesComResultado = bruto.m.reduce((t, [, , , vv]) => t + (vv > 0 ? 1 : 0), 0);

    /*
     * A soma das cidades, campo a campo. Nenhum destes números é conta nossa: são os que o TSE
     * publica em cada arquivo municipal, somados. É por isso que eles servem de conferência do
     * total da disputa, que vem por outro arquivo e outro caminho.
     */
    /*
     * A soma sai do mesmo retrato que gerou as linhas, não do job ao vivo.
     *
     * Reproduzindo o minuto zero, as linhas vinham vazias e a soma vinha de agora: a folha dizia
     * "Somando 5.571 de 0 cidades publicadas · 100,00% apurado" com a tabela em branco embaixo.
     * Dois instantes na mesma folha, e o número grande era o do instante errado.
     */
    const totais = bruto.totais;
    return { status: bruto.status, message: bruto.message, loaded: bruto.loaded, total: bruto.total, cidadesComResultado, totais, numero, linhas };
  }

  /**
   * A disputa dentro de uma cidade.
   *
   * Os votos por candidatura daquele município já estão guardados — é o mesmo dado que alimenta a
   * folha de cidades, lido pelo outro eixo. Os nomes vêm da corrida, que é quem os tem; número
   * sem nome aparece pelo número, porque some-lo seria esconder voto que o TSE publicou.
   */
  async porCidade(mode: Mode, uf: string, turn: Turn, office: Office, cdi: string, at?: number): Promise<CidadeMunicipal> {
    const vazio: CidadeMunicipal = {
      status: 'loading', message: '', nome: '', uf: '', vv: 0, vb: 0, vn: 0, tv: 0,
      ht: '', st: 0, ts: 0, candidaturas: [],
    };
    const bruto = await this.get(mode, uf, turn, office, undefined, at);
    if ('unchanged' in bruto) return { ...vazio, status: bruto.status, message: bruto.message };

    const linha = bruto.m.find(m => m[0] === cdi);
    if (!linha) return { ...vazio, status: bruto.status, message: 'Esta cidade ainda não publicou resultado.' };
    const [, nome, ufCidade, vv, pares, ht] = linha;

    const race = this.hooks.race(mode, uf, turn, office);
    const porNumero = new Map((race?.candidates ?? []).map(c => [c.number, c]));
    const candidaturas: CidadeMunicipal['candidaturas'] = [];
    for (let k = 0; k < pares.length; k += 2) {
      const numero = bruto.c[pares[k]]?.[0] ?? '';
      const c = porNumero.get(numero);
      candidaturas.push([numero, c?.name ?? numero, c?.party ?? '', c?.color ?? '#8a94a6', pares[k + 1]]);
    }
    candidaturas.sort((a, b) => b[4] - a[4]);

    const job = this.jobs.get(`${mode}:${turn}:${this.area(office, uf)}:${office}`);
    const r = job?.rows.get(cdi);
    const m = job?.muns.find(x => x.cdi === cdi);
    const carimbo = m && job?.stamps.get(`${m.uf}${m.cd}`);
    return {
      status: bruto.status, message: '', nome, uf: ufCidade, vv,
      vb: r?.vb ?? 0, vn: r?.vn ?? 0, tv: r?.tv ?? 0,
      ht: carimbo?.ht ?? ht ?? '', st: carimbo?.st ?? 0, ts: carimbo?.ts ?? 0,
      candidaturas,
    };
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
   * Ao vivo o que se escolhe é o **estado**, não o cargo: a rodada busca os cinco cargos de cada
   * cidade, então não há mais cinco varreduras do mesmo estado para desempatar. A ordem é a pedida:
   * o estado que está na tela de alguém primeiro e sempre; quando não há mais nada a buscar nele,
   * os outros, do maior eleitorado para o menor, um por vez.
   *
   * Escolher entre cargos era o que produzia o defeito que isto conserta: a vez passava para o
   * cargo seguinte só quando o anterior fechava, e na janela de 24/09/2026 a gravação municipal de
   * Minas começou às 14:00:36 no governador, 14:14:15 na presidência, 14:16:21 no senado e
   * 14:20:19 no estadual. Quem reproduzia o começo da apuração via cidades num cargo e tabela
   * vazia nos outros quatro.
   *
   * No arquivo de 2022 a regra antiga continua: não há andamento para dizer o que mudou, cada
   * cargo é uma varredura de milhares de arquivos que termina e não volta, e é assim que os
   * builds são montados um a um.
   */
  private vezDeVarrer(job: Job): boolean {
    const agora = Date.now();
    const vivos = [...this.jobs.values()].filter(j => agora - j.lastRequest <= KEEPALIVE);
    if (!vivos.length) return true;
    if (job.mode !== 'historico') return this.vezDeVarrerAoVivo(job, vivos.filter(j => j.mode !== 'historico'), agora);
    /*
     * Completo é "não há mais nada a descobrir", não "tenho todas as linhas".
     *
     * A regra era `rows.size >= muns.length`. Isso valia enquanto um job nascia vazio e ia
     * enchendo — mas desde que as linhas passaram a ser gravadas em disco, todo job nasce com as
     * 853 cidades e portanto nasce "completo": some da rodada de fundo para sempre e só o cargo da
     * tela continua andando. Medido na janela de 24/09/2026, às 15h24: o federal de Minas com
     * fetches=1286 e 703 cidades apuradas, igual ao TSE, enquanto governador e senado do mesmo
     * estado estavam em fetches=0, congelados às 14h47 com 201 e 229 cidades.
     *
     * Quem diz que acabou é o TSE, pelo `and='f'` de cada município — que é o que `encerrada` já
     * sabe ler. O `every` sai na primeira cidade em aberto, então no meio da apuração isto custa
     * uma comparação.
     */
    const completo = (j: Job) => j.confirmado && !!j.muns.length && j.rows.size >= j.muns.length
      && j.muns.every(m => this.encerrada(j, m));
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

  /**
   * A vez, ao vivo: qual estado, e quem conduz a rodada dentro dele.
   *
   * O estado que está na tela de alguém vem sempre primeiro — nem quando não tem nada a buscar ele
   * some da fila, porque o prazo de "limpo" vence junto com o intervalo do andamento e ele retoma a
   * vez. Os outros entram por eleitorado, um por vez, com a folga que o primeiro deixar.
   */
  private vezDeVarrerAoVivo(job: Job, vivos: Job[], agora: number): boolean {
    if (!vivos.length) return true;
    const naTela = new Set(this.hooks.foco().map(c => `${c.mode}:${c.turn}:${c.uf}`));
    const estados = new Map<string, Job[]>();
    for (const j of vivos) {
      const chave = this.chaveDoEstado(j);
      const lista = estados.get(chave);
      if (lista) lista.push(j); else estados.set(chave, [j]);
    }
    const ordem = [...estados.keys()].sort((a, b) =>
      Number(naTela.has(b)) - Number(naTela.has(a))
      || this.eleitoradoDaChave(b) - this.eleitoradoDaChave(a)
      || a.localeCompare(b));
    const daVez = ordem.find(chave => (this.limpoAte.get(chave) ?? 0) <= agora) ?? ordem[0];
    if (this.chaveDoEstado(job) !== daVez) return false;
    /*
     * Dentro do estado, conduz a rodada o cargo que a tela pediu.
     *
     * Sem pedido nenhum, conduz sempre o mesmo — a ordem dos cargos é fixa. Um condutor que muda a
     * cada volta faria duas rodadas do mesmo estado se acharem simultaneamente no direito de andar.
     */
    const ordemDeCargo = municipalOffices(job.turn);
    const lider = [...estados.get(daVez)!].sort((a, b) => b.pedidoEm - a.pedidoEm
      || ordemDeCargo.indexOf(a.office) - ordemDeCargo.indexOf(b.office))[0];
    return job === lider;
  }

  private eleitoradoDaChave(chave: string): number {
    const [mode, turn, uf] = chave.split(':');
    return this.hooks.eleitorado(mode as Mode, uf, Number(turn) as Turn);
  }

  /**
   * Os cargos de um estado, cada um com o alvo que o TSE publica para a eleição dele.
   *
   * São duas eleições para os cinco cargos: a estadual leva governador, senado, federal e estadual
   * (dá para ver no nosso próprio cache, `municipal/546/` com c0003, c0005, c0006, c0007 e c0008
   * juntos), e a presidência tem a sua. Logo são dois arquivos de andamento por rodada, não cinco —
   * e o carimbo é da cidade, não do cargo: se a cidade totalizou, os cinco arquivos dela mudaram.
   *
   * O job de cada cargo continua sendo o dono das linhas, do arquivo em disco e da resposta da
   * tela. A rodada só preenche os cinco.
   */
  private async cargosDoEstado(referencia: Job): Promise<{ job: Job; target: Alvo }[]> {
    const uf = this.ufDaRodada(referencia);
    const { mode, turn } = referencia;
    const saida: { job: Job; target: Alvo }[] = [];
    for (const office of municipalOffices(turn)) {
      if (mode === 'historico' && turn === 2 && office === 'governor' && !(ARCHIVE.runoffStates as readonly string[]).includes(uf)) continue;
      const area = this.area(office, uf);
      let job = this.jobs.get(`${mode}:${turn}:${area}:${office}`);
      if (!job) { job = this.criarJob(mode, turn, area, office, uf); await this.loadBuilt(job); }
      // O job da presidência é nacional e é compartilhado: o estado dele é o que a rodada olha.
      if (job.area === 'BR') job.focus = uf;
      const target = this.target(job);
      if (target) saida.push({ job, target });
    }
    return saida;
  }

  /**
   * Uma rodada do estado: as cidades que mudaram, e os cinco cargos de cada uma.
   *
   * Antes cada cargo tinha a sua varredura das 853 cidades e `vezDeVarrer` deixava uma andar por
   * vez, então os cargos enchiam em fila: medido na janela de 24/09/2026 em Minas, a gravação
   * municipal começou às 14:00:36 no governador, 14:14:15 na presidência, 14:16:21 no senado e
   * 14:20:19 no estadual. Quem reproduzia o começo da apuração via cidade num cargo e tabela vazia
   * nos outros quatro, com a tela dizendo que nenhuma cidade havia publicado — o que era falso: as
   * cidades estavam publicadas, nós é que ainda não as tínhamos buscado.
   *
   * Agora a unidade é a cidade. O total de requisições é o mesmo — o arquivo do TSE é um por cidade
   * e por cargo, cinco cargos são cinco arquivos, aqui e antes. O que muda é a ordem: a cidade
   * entra completa nas cinco tabelas, ou não entra.
   *
   * Devolve 'idle' quando não havia nada a buscar neste estado agora, o que passa a vez ao próximo.
   */
  private async rodada(lider: Job, cargos: { job: Job; target: Alvo }[]): Promise<boolean | 'idle'> {
    if (!cargos.length) return false;
    const uf = this.ufDaRodada(lider);

    /*
     * O andamento, um por eleição — não um por cargo.
     *
     * Os quatro cargos estaduais dividem o mesmo arquivo, e é dele que sai o carimbo de cada
     * cidade. Antes cada cargo lia o seu por conta própria e agia num momento diferente; o mesmo
     * fato era descoberto quatro vezes.
     */
    const andamentos = new Map<string, { election: string; jobs: Job[] }>();
    for (const { job, target } of cargos) {
      const url = target.ab?.(uf);
      if (!url) continue;
      const entrada = andamentos.get(url);
      if (entrada) entrada.jobs.push(job);
      else andamentos.set(url, { election: target.election, jobs: [job] });
    }
    for (const [url, { election, jobs }] of andamentos) {
      const raw = await this.transport.get(url, AB_INTERVAL, { retain: false, timeoutMs: 20_000 });
      if (raw === NOT_MODIFIED) {
        /*
         * 304 é o andamento deste estado continuando a valer, e os carimbos já estão guardados.
         * Sem esta linha a UF saía de `abSeen` na segunda passada e as cidades dela paravam de ser
         * consideradas. O cargo criado depois da primeira leitura copia os carimbos de um irmão:
         * ele responde 304 sem nunca ter visto o arquivo, e ficaria sem carimbo nenhum.
         */
        const comCarimbo = jobs.find(j => j.stamps.size);
        for (const j of jobs) {
          j.abSeen.add(uf);
          if (comCarimbo && j !== comCarimbo && !j.stamps.size) for (const [k, v] of comCarimbo.stamps) j.stamps.set(k, v);
        }
        continue;
      }
      if (!raw) continue;
      try {
        const ab = parseAb(raw, election);
        for (const j of jobs) {
          for (const [cd, city] of ab.cities) j.stamps.set(`${uf}${cd}`, city);
          if (ab.sourceAt && (!j.sourceAt || ab.sourceAt > j.sourceAt)) j.sourceAt = ab.sourceAt;
          j.abSeen.add(uf);
        }
      } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Andamento inválido'); }
    }

    /*
     * A lista de cidades do estado. A do próprio estado quando há um cargo estadual carregado;
     * senão a nacional da presidência, filtrada — é a mesma lista, do mesmo arquivo do TSE.
     */
    const doEstado = cargos.find(c => c.job.area === uf && c.job.muns.length)?.job.muns
      ?? cargos.find(c => c.job.muns.length)?.job.muns.filter(m => m.uf === uf)
      ?? [];
    if (!doEstado.length) return false;

    /** Este cargo precisa desta cidade agora? */
    const precisa = (job: Job, m: MunRef): boolean => {
      const linha = job.rows.get(m.cdi);
      const carimbo = job.stamps.get(`${m.uf}${m.cd}`);
      // Linha que falta, ou lida por um parser mais velho: nenhum carimbo do TSE avisa que quem
      // mudou fomos nós.
      if (!linha || linha.esq !== ESQUEMA) return true;
      // Seção apurada na fonte e nenhum voto aqui é contradição interna, e quem manda é a fonte.
      if ((carimbo?.st ?? 0) > 0 && !linha.vv) return true;
      if (this.encerrada(job, m)) return false;
      // Sem andamento não há carimbo para comparar: cai no ciclo lento, que é o que a varredura
      // completa fazia antes de existir um arquivo dizendo o que mudou.
      if (!job.abSeen.has(m.uf)) return Date.now() - (job.lidaEm.get(m.cdi) ?? 0) >= LIVE_CYCLE;
      return !!carimbo && job.fetched.get(m.cdi) !== carimbo.stamp;
    };

    const sujas: { m: MunRef; pendentes: { job: Job; target: Alvo }[] }[] = [];
    for (const m of doEstado) {
      const pendentes = cargos.filter(c => precisa(c.job, m));
      if (pendentes.length) sujas.push({ m, pendentes });
    }
    if (!sujas.length) return 'idle';
    // As maiores primeiro: o eleitorado de cada cidade vem do arquivo de andamento.
    const eleitores = (m: MunRef) => lider.stamps.get(`${m.uf}${m.cd}`)?.te ?? 0;
    sujas.sort((a, b) => eleitores(b.m) - eleitores(a.m) || a.m.cd.localeCompare(b.m.cd));

    let i = 0, pedidos = 0;
    const worker = async () => {
      while (i < sujas.length) {
        const { m, pendentes } = sujas[i++];
        if (Date.now() - lider.lastRequest > KEEPALIVE || this.transport.cooldownUntil > Date.now()) return;
        /*
         * Trocou o estado na tela? Esta rodada perdeu a validade.
         *
         * Sem isto, escolher São Paulo no meio de uma rodada de Minas deixava os dezesseis
         * trabalhadores terminarem as 853 cidades mineiras antes de olhar para São Paulo — minutos
         * enchendo uma tela que ninguém está mais vendo. A próxima rodada já monta a lista do
         * estado novo, então basta sair daqui.
         */
        if (this.ufDaRodada(lider) !== uf) return;
        /*
         * Os cinco arquivos da mesma cidade, um atrás do outro.
         *
         * Em série de propósito: é o que faz a cidade ficar pronta nas cinco tabelas no mesmo
         * momento, que é a razão de a rodada existir. Os dezesseis trabalhadores dão o paralelismo,
         * e o teto continua sendo o balde de fichas do transporte.
         */
        for (const { job, target } of pendentes) {
          const carimbo = job.stamps.get(`${m.uf}${m.cd}`)?.stamp ?? '';
          const url = target.url(m);
          /*
           * Uma cidade não é relida mais rápido que o arquivo que anuncia que ela mudou. Sem
           * andamento, o ritmo é o do ciclo lento — não há o que descobrir a cada oito segundos.
           */
          const intervalo = job.abSeen.has(m.uf) ? AB_INTERVAL : LIVE_CYCLE;
          const raw = await this.transport.get(url, intervalo, { priority: 'low', retain: false, timeoutMs: 30_000, expectMissing: true });
          if (raw === null) continue;
          pedidos++;
          job.fetches++;
          if (raw === NOT_MODIFIED) { job.fetched.set(m.cdi, carimbo); continue; }
          try {
            const row = parseMunicipal(raw, { election: target.election, cd: m.cd, office: job.office, uf: m.uf });
            this.guardar(job, m.cdi, row);
            job.fetched.set(m.cdi, carimbo);
            job.lidaEm.set(m.cdi, Date.now());
            if (row.sourceAt && (!job.sourceAt || row.sourceAt > job.sourceAt)) job.sourceAt = row.sourceAt;
          } catch (e) { this.transport.reject(url, e instanceof Error ? e.message : 'Arquivo municipal inválido'); }
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    /*
     * Lista suja sem nenhuma requisição de verdade é estado sem nada a buscar agora.
     *
     * Acontece quando o que falta está dentro do intervalo do próprio arquivo, ou em espera depois
     * de um 404 — cidade que ainda não publicou. Sem isto a rodada se declarava ativa sem ter
     * pedido nada, e o estado da tela ficava com a vez enquanto os outros esperavam por nada.
     */
    return pedidos > 0 ? true : 'idle';
  }

  private target(job: Job): Alvo | null {
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
    /*
     * A mudança entra na fila do gravador: é ela que permite remontar a tabela de qualquer
     * instante depois, em vez de servir sempre o estado de agora.
     *
     * A hora do instante é a da leitura, não a da escrita. A gravação sai em lotes, e datar o lote
     * pela escrita empurrava o dado para depois do momento em que ele já existia: quem pedisse
     * aquele instante recebia uma tabela vazia de um minuto em que a tabela já tinha números.
     */
    if (!job.mudadas.size) job.mudadasDesde = Date.now();
    job.mudadas.set(cdi, nova);
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
    // Seção apurada na fonte e nenhum voto aqui é contradição: não há como isto estar encerrado.
    if (carimbo.st > 0 && !linha.vv) return false;
    return Date.now() - (job.lidaEm.get(m.cdi) ?? 0) < RELEITURA;
  }

  /** One pass over the municipalities, the viewer's own state first. Returns true when nothing was left to try. */
  private async pass(job: Job, target: Alvo): Promise<boolean> {
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
  private async fromDisk(job: Job, target: Alvo, m: MunRef): Promise<boolean> {
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
