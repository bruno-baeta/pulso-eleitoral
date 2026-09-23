import { performance } from 'node:perf_hooks';

interface CacheEntry {
  value?: unknown;
  etag?: string;
  modified?: string;
  nextAt: number;
  failures: number;
  error?: string;
  promise?: Promise<unknown | null>;
}

/** Returned by `retain: false` reads when the TSE answers 304: the caller keeps what it derived before. */
export const NOT_MODIFIED = Symbol('not-modified');
export interface GetOptions {
  /** 'low' waits for an idle slot in the shared queue, so it never delays race files (Território's municipal files). */
  priority?: 'normal' | 'low';
  /** Keep the parsed body in memory (default). Large rotations turn this off and rely on NOT_MODIFIED. */
  retain?: boolean;
  timeoutMs?: number;
  /**
   * O 404 aqui é esperado e não conta para a pausa geral.
   *
   * Três 404 em um minuto pausam o transporte inteiro por dezesseis minutos, e essa regra existe
   * para o caso em que o TSE responde 404 porque não quer ser consultado. A varredura municipal
   * pede dezenas de milhares de arquivos cujos municípios podem não ter publicado nada ainda: com
   * eles contando, a própria varredura derrubava a coleta das corridas no meio da apuração.
   */
  expectMissing?: boolean;
}

/** O teto publicado pelo TSE: cem requisições por segundo, por IP. */
export const TSE_CEILING = 100;

/** How often the bucket is refilled and drained; the rate itself comes from the tokens. */
const TICK_MS = 10;

/** One shared limiter for all windows, UFs, modes and conditional requests. */
export class TseTransport {
  readonly entries = new Map<string, CacheEntry>();
  requests = 0;
  notModified = 0;
  /*
   * O pico observado, em requisições por segundo.
   *
   * O teto do TSE é por IP, e quem o estoura é bloqueado no meio da apuração — sem aviso e sem
   * como saber, depois, se a culpa foi nossa. O balde de fichas garante que não passamos de
   * `maxRps`, mas garantia de código é uma promessa; isto é a medição. O contador anda numa
   * janela de um segundo e guarda o maior valor da execução.
   */
  pico = 0;
  private janela = { desde: 0, n: 0 };
  lastCheckAt: number | null = null;
  lastSuccessAt: number | null = null;
  rttMs: number | null = null;
  cooldownUntil = 0;
  private missing: number[] = [];
  private active = 0;
  private queue: (() => void)[] = [];
  private lowQueue: (() => void)[] = [];
  private lastLowAt = 0;
  private tokens = 0;
  private lastFill = 0;
  private timer: ReturnType<typeof setInterval>;
  readonly maxRps: number;

  /** `lowRps` caps the low-priority lane below the global limit, which still applies to both lanes. */
  constructor(maxRps = 10, private fetcher: typeof fetch = fetch, private clock = Date.now, readonly lowRps = Number(process.env.TSE_LOW_RPS) || 60, readonly maxInFlight = Number(process.env.TSE_MAX_INFLIGHT) || 24) {
    /*
     * Cem por segundo é o limite do TSE, e nenhuma configuração passa disso.
     *
     * O número vinha do ambiente sem teto: um `.env` com 150 estouraria o limite em produção, e
     * quem descobre isso é o IP bloqueado no meio da apuração. O valor é preso aqui, no único
     * lugar por onde toda requisição passa.
     */
    maxRps = Math.max(1, Math.min(TSE_CEILING, maxRps));
    this.maxRps = maxRps;
    /*
     * A token bucket, not one request per tick. Releasing a single request per timer tick capped
     * the whole transport at the tick rate — asking for 90 req/s produced the same 49 as asking
     * for 50, because the interval could not go below 20 ms. Tokens accrue with real elapsed time
     * and the queue drains while there are any, so the configured rate is the rate that happens.
     * The bucket never holds more than a tenth of a second of allowance, so a quiet spell cannot
     * turn into a burst that the TSE reads as an attack.
     *
     * Pacing reads the wall clock, not the injected one: `clock` is the seam tests freeze to check
     * cache expiry and cooldowns, and a frozen clock must not mean a transport that never sends.
     */
    this.lastFill = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      this.tokens = Math.min(Math.max(1, maxRps / 10), this.tokens + (now - this.lastFill) * maxRps / 1000);
      this.lastFill = now;
      /*
       * A faixa baixa tem vez própria, não as sobras da normal.
       *
       * A regra anterior só a servia quando `this.queue` estava vazia. Isso funcionava enquanto o
       * Pulso gravava um estado; com os 27 a fila normal nunca mais esvaziou, e a faixa baixa
       * parou de andar por completo. Medido em 23/09/2026, durante a janela: active=2 de 48,
       * fila=33, filaBaixa=454 — quatrocentos e cinquenta e quatro arquivos municipais parados com
       * o transporte praticamente ocioso. A tela de cidades abria vazia por causa disto, e não por
       * falta de dado no TSE.
       *
       * Agora ela toma um lugar sempre que o próprio ritmo dela permite (`lowRps`), e a normal fica
       * com todo o resto. Como `lowRps` é menor que `maxRps`, sobra faixa de sobra para as corridas
       * — que são o que não pode atrasar — e o balde de fichas continua sendo o único teto.
       */
      while (this.tokens >= 1) {
        const vezDaBaixa = this.active < this.maxInFlight - 2 && this.lowQueue.length
          && now - this.lastLowAt >= 1000 / Math.max(.1, Math.min(lowRps, maxRps));
        if (vezDaBaixa) {
          this.lastLowAt = now;
          this.lowQueue.shift()!();
        } else if (this.active < this.maxInFlight && this.queue.length) this.queue.shift()!();
        else break;
        this.tokens--;
      }
    }, TICK_MS);
  }

  close() { clearInterval(this.timer); }

  get(url: string, intervalMs: number, options: GetOptions = {}): Promise<unknown | null> {
    let entry = this.entries.get(url);
    if (!entry) { entry = { nextAt: 0, failures: 0 }; this.entries.set(url, entry); }
    if (entry.promise) return entry.promise;
    if (this.clock() < entry.nextAt || this.clock() < this.cooldownUntil) return Promise.resolve(null);
    const cache = entry;
    cache.promise = new Promise<unknown | null>(resolve => {
      (options.priority === 'low' ? this.lowQueue : this.queue).push(() => {
        if (this.clock() < this.cooldownUntil) { cache.promise = undefined; resolve(null); return; }
        this.active++;
        this.request(url, cache, intervalMs, options).then(value => { this.active--; cache.promise = undefined; resolve(value); });
      });
    });
    return cache.promise;
  }

  private async request(url: string, entry: CacheEntry, intervalMs: number, options: GetOptions = {}): Promise<unknown | null> {
    const retain = options.retain !== false;
    const started = performance.now();
    this.requests++;
    const agora = Date.now();
    if (agora - this.janela.desde >= 1000) this.janela = { desde: agora, n: 0 };
    this.janela.n++;
    if (this.janela.n > this.pico) this.pico = this.janela.n;
    this.lastCheckAt = this.clock();
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'PulsoEleitoral/1.0 (+https://github.com/bruno-baeta/pulso-eleitoral; consumo condicional)' };
      if (entry.etag) headers['If-None-Match'] = entry.etag;
      if (entry.modified) headers['If-Modified-Since'] = entry.modified;
      const response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(options.timeoutMs ?? 8000), redirect: 'error' });
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry || '') - this.clock()) || 0;
        this.cooldownUntil = this.clock() + Math.max(16 * 60_000, delay);
        throw new Error(`HTTP ${response.status}: pausa de acesso ao TSE`);
      }
      if (response.status === 404) {
        entry.nextAt = this.clock() + 15 * 60_000;
        if (!options.expectMissing) {
          this.missing = [...this.missing.filter(at => this.clock() - at < 60_000), this.clock()];
          if (this.missing.length >= 3) this.cooldownUntil = this.clock() + 16 * 60_000;
        }
        throw new Error('Arquivo ainda não publicado (404)');
      }
      if (response.status !== 304 && !response.ok) throw new Error(`TSE indisponível (HTTP ${response.status})`);
      let result: unknown;
      if (response.status === 304) {
        if (retain && entry.value === undefined) throw new Error('304 sem conteúdo anterior');
        this.notModified++;
        result = retain ? entry.value : NOT_MODIFIED;
      } else {
        const content = await response.text();
        if (content.length > 20_000_000) throw new Error('Arquivo excedeu o tamanho esperado');
        result = JSON.parse(content);
        if (retain) entry.value = result;
        entry.etag = response.headers.get('etag') || undefined;
        entry.modified = response.headers.get('last-modified') || undefined;
      }
      this.rttMs = Math.round(performance.now() - started);
      this.lastSuccessAt = this.clock();
      entry.failures = 0;
      entry.error = undefined;
      entry.nextAt = this.clock() + intervalMs;
      return result;
    } catch (error) {
      entry.failures++;
      entry.error = error instanceof Error ? error.message : 'Falha na conexão com o TSE';
      entry.nextAt = Math.max(entry.nextAt, this.clock() + Math.min(120_000, 3000 * 2 ** Math.min(entry.failures, 6)));
      return null;
    }
  }

  reject(url: string, reason: string) {
    const entry = this.entries.get(url);
    if (entry) {
      entry.error = reason;
      entry.nextAt = this.clock() + 60_000;
      entry.value = undefined;
      entry.etag = undefined;
      entry.modified = undefined;
    }
  }
}
