/**
 * Um TSE de mentira, com relógio próprio.
 *
 * Existe porque os erros que custaram caro neste projeto não foram de conta: foram do laço ao
 * longo do tempo — a faixa de baixa prioridade sufocada pela normal, um estado saindo da lista de
 * vistos quando o andamento respondia 304, cidade que nunca entrava na lista de sujas, varreduras
 * simultâneas dividindo a mesma faixa até nenhuma terminar. Nada disso aparece testando função
 * pura, e o laço não tinha como ser exercitado sem rede.
 *
 * Aqui o laço roda inteiro, em milissegundos, contra arquivos que este objeto serve — e contando
 * cada requisição, que é o que permite afirmar "não pediu de novo" em vez de torcer para o relógio
 * ajudar.
 */
export interface RespostaFalsa {
  status?: number;
  corpo?: unknown;
  /** Quando presente, o pedido com If-None-Match igual a isto responde 304. */
  etag?: string;
}

export class TseFalso {
  /** Quantas vezes cada URL foi pedida, inclusive as que responderam 304. */
  readonly pedidos = new Map<string, number>();
  private rotas: { casa: (url: string) => boolean; responde: (url: string) => RespostaFalsa }[] = [];

  /** Registra uma resposta fixa para toda URL que contiver `trecho`. */
  em(trecho: string, resposta: RespostaFalsa | ((url: string) => RespostaFalsa)) {
    // A última registrada vence: é o que deixa um teste sobrescrever uma rota do cenário padrão.
    this.rotas.unshift({
      casa: url => url.includes(trecho),
      responde: url => typeof resposta === 'function' ? resposta(url) : resposta,
    });
    return this;
  }

  /** Quantas vezes uma URL que contenha `trecho` foi pedida. */
  contar(trecho: string): number {
    let n = 0;
    for (const [url, vezes] of this.pedidos) if (url.includes(trecho)) n += vezes;
    return n;
  }

  zerar() { this.pedidos.clear(); }

  /**
   * O `fetch` para injetar no TseTransport.
   *
   * URL sem rota registrada responde 404 — que é o que o TSE faz com município que ainda não
   * publicou, e o caminho que o transporte trata como ausência esperada.
   */
  get fetch(): typeof fetch {
    return (async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = String(entrada);
      this.pedidos.set(url, (this.pedidos.get(url) ?? 0) + 1);
      const rota = this.rotas.find(r => r.casa(url));
      if (!rota) return new Response('', { status: 404 });

      const r = rota.responde(url);
      if (r.status && r.status !== 200) return new Response('', { status: r.status });

      const cabecalhos = new Headers(init?.headers as HeadersInit);
      if (r.etag && cabecalhos.get('If-None-Match') === r.etag) {
        return new Response('', { status: 304, headers: { etag: r.etag } });
      }
      return new Response(JSON.stringify(r.corpo ?? {}), {
        status: 200,
        headers: r.etag ? { etag: r.etag, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }
}

/** Relógio que só anda quando mandam. O transporte recebe isto no lugar de `Date.now`. */
export function relogioFalso(inicio = 1_700_000_000_000) {
  let agora = inicio;
  return { agora: () => agora, avancar: (ms: number) => { agora += ms; } };
}

/** Espera o laço de fundo dar algumas voltas. O laço é assíncrono; os testes precisam ceder a vez. */
export const respirar = (voltas = 8) => new Promise<void>(resolve => {
  let n = 0;
  const passo = () => (++n >= voltas ? resolve() : setTimeout(passo, 5));
  setTimeout(passo, 5);
});

/* ------------------------------------------------------------------ fábricas de arquivo do TSE */

/** Configuração municipal (`mun-…-cm.json`): a lista de municípios de cada UF. */
export function configMunicipal(porUf: Record<string, number>) {
  return {
    dg: '14/09/2026', hg: '22:57:56', idg: '1', f: 's',
    abr: Object.entries(porUf).map(([uf, quantos]) => ({
      cd: uf.toLowerCase(), ds: uf, mu: Array.from({ length: quantos }, (_, i) => ({
        cd: String(40000 + i), cdi: `31${String(i).padStart(5, '0')}`, nm: `CIDADE ${uf}${i}`, c: i === 0 ? 'S' : 'n', z: ['0001'],
      })),
    })),
  };
}

/** Andamento por UF (`-ab.json`): o carimbo de cada município. `encerradas` marca `and: 'f'`. */
export function andamento(eleicao: string, uf: string, quantos: number, opcoes: { hora?: string; encerradas?: boolean } = {}) {
  const hora = opcoes.hora ?? '10:45:45';
  return {
    ele: eleicao, t: 1, f: 's', dg: '17/09/2026', hg: hora,
    abr: Array.from({ length: quantos }, (_, i) => ({
      tpabr: 'mun', cdabr: String(40000 + i), dt: '17/09/2026', ht: hora,
      and: opcoes.encerradas ? 'f' : 'p',
      s: { st: '56', ts: '56' }, e: { te: 1000 + i },
    })),
  };
}

/** Resultado de um município (`-u.json`), no layout 2026. */
export function resultadoMunicipal(eleicao: string, cd: string, cargo: number, votos: [string, number][]) {
  return {
    ele: eleicao, cdabr: cd, dg: '17/09/2026', hg: '10:45:45',
    carg: [{ cd: cargo, agr: [{ par: [{ cand: votos.map(([n, v]) => ({ n, vap: String(v) })) }] }] }],
    v: { vv: String(votos.reduce((s, [, v]) => s + v, 0)) },
  };
}
