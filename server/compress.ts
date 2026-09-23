/**
 * Compressão das respostas da API.
 *
 * O JSON sai grande: um snapshot do arquivo de 2022 tem 100 KB e a lista inteira de deputados de
 * um estado passa de 160 KB. Vetores de números encolhem umas duas vezes e meia em brotli, e o
 * snapshot umas seis, então toda resposta acima de um kilobyte vai comprimida. O nível 5 custa
 * poucos milissegundos; o nível 11, pensado para arquivo estático, travaria o laço de eventos a
 * cada leitura. O fluxo de eventos é assumido antes deste gancho e nunca passa por aqui.
 */
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlib } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const br = promisify(brotliCompress), gz = promisify(gzip);
const MINIMO = 1024;
const TETO = 48 * 1024 * 1024;

/** A etiqueta de conteúdo: dois corpos iguais têm a mesma, e é ela que evita recomprimir. */
export const contentTag = (body: string | Buffer) => `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;

export function registrarCompressao(app: FastifyInstance) {
  /*
   * Sem cache, a mesma resposta é comprimida de novo a cada pedido — um megabyte custa uns 100 ms
   * de brotli, que em rede local é mais lento do que não comprimir. A chave é o conteúdo, então um
   * estado de 2022 já fechado, ou um snapshot entre dois arquivos do TSE, é comprimido uma vez só.
   * O limite é em bytes, e sai quem entrou primeiro.
   */
  const guardados = new Map<string, Buffer>();
  let bytes = 0;
  const guardar = (chave: string, valor: Buffer) => {
    guardados.set(chave, valor); bytes += valor.length;
    for (const [k, v] of guardados) { if (bytes <= TETO) break; guardados.delete(k); bytes -= v.length; }
  };

  app.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith('/api/') || reply.getHeader('content-encoding')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
    if (body.length < MINIMO) return payload;
    const aceita = String(request.headers['accept-encoding'] ?? '');
    const modo = /\bbr\b/.test(aceita) ? 'br' : /\bgzip\b/.test(aceita) ? 'gzip' : null;
    if (!modo) return payload;
    const chave = `${String(reply.getHeader('etag') ?? contentTag(body))}:${modo}`;
    let saida = guardados.get(chave);
    if (saida) { guardados.delete(chave); guardados.set(chave, saida); }   // volta para o fim da fila
    else {
      saida = modo === 'br'
        ? await br(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } })
        : await gz(body, { level: 6 });
      guardar(chave, saida);
    }
    reply.header('Content-Encoding', modo);
    reply.header('Vary', 'Accept-Encoding');
    reply.removeHeader('content-length');
    return saida;
  });
}
