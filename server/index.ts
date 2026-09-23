import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { registrarCompressao, contentTag } from './compress.ts';
import { Collector } from './collector.ts';
import { MunicipalService } from './municipal.ts';
import { STATES, type Mode, type Office, type Turn } from '../shared/types.ts';

try { loadEnvFile(); } catch { /* .env is optional. */ }
const app = Fastify({ logger: true });
const collector = new Collector();
await collector.start();
const municipal = new MunicipalService(collector.transport, {
  election: (mode, office, area, turn) => collector.electionRef(mode, office, area, turn),
  allowed: mode => collector.isAllowed(mode),
  race: (mode, uf, turn, office) => collector.fullRace(mode, uf, turn, office),
  touch: (mode, uf, turn) => collector.touch(mode, uf, turn),
  live: () => collector.liveContexts(),
});
// Idle time is when the archive's per-municipality files get fetched ahead (see municipal.ts).
municipal.startIdleWarming();

const querySchema = { type: 'object', properties: {
  mode: { type: 'string', enum: ['official', 'historico', 'simulado'], default: 'official' },
  uf: { type: 'string', enum: STATES.map(s => s.uf), default: 'MG' },
  turn: { type: 'integer', enum: [1, 2], default: 1 },
  at: { type: 'integer', minimum: 0 },
}, additionalProperties: false };
type Query = { mode: Mode; uf: string; turn: Turn; at?: number };

app.addHook('onSend', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

registrarCompressao(app);

app.get('/api/health', async () => ({ ok: true, service: 'pulso-eleitoral', time: new Date().toISOString() }));
app.get<{ Querystring: Query }>('/api/snapshot', { schema: { querystring: querySchema } }, async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const { mode, uf, turn, at } = request.query;
  // Polling pages have no SSE subscription: keep this context collected while it is being viewed.
  collector.touch(mode, uf, turn);
  return at === undefined ? collector.snapshot(mode, uf, turn) : collector.snapshotAt(mode, uf, turn, at);
});
const municipalSchema = { type: 'object', properties: {
  mode: querySchema.properties.mode, uf: querySchema.properties.uf, turn: querySchema.properties.turn,
  office: { type: 'string', enum: ['president', 'governor', 'senate', 'federal', 'state'] },
  v: { type: 'integer', minimum: 0 },
}, required: ['office'], additionalProperties: false };
/** Território: results per municipality for one UF + office, fetched on demand (see server/municipal.ts). */
app.get<{ Querystring: { mode: Mode; uf: string; turn: Turn; office: Office; v?: number } }>('/api/municipal', { schema: { querystring: municipalSchema } }, async (request, reply) => {
  const { mode, uf, turn, office, v } = request.query;
  const result = await municipal.get(mode, uf, turn, office, v);
  // A finished 2022 build never changes, so the browser may keep it and only ask whether it is
  // still the same: switching states reloads the page, and this turns the megabyte it used to
  // download again into a 304. Anything still loading, and every live source, stays uncached.
  if (mode !== 'historico' || result.status !== 'ready' || 'unchanged' in result) {
    reply.header('Cache-Control', 'no-store');
    return result;
  }
  const body = JSON.stringify(result);
  const tag = contentTag(body);
  reply.header('Cache-Control', 'no-cache');
  reply.header('ETag', tag);
  if (request.headers['if-none-match'] === tag) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(body);
});
/** A disputa inteira, com todas as candidaturas: o que a tabela e a busca pedem ao abrir. */
app.get<{ Querystring: Query & { office: Office; scope?: string } }>('/api/race', { schema: { querystring: { type: 'object', properties: { ...querySchema.properties, office: { type: 'string', enum: ['president', 'governor', 'senate', 'federal', 'state'] }, scope: { type: 'string', pattern: '^[A-Za-z]{2}$' } }, required: ['office'], additionalProperties: false } } }, async (request, reply) => {
  const { mode, uf, turn, office, scope } = request.query;
  const race = collector.fullRace(mode, scope ?? uf, turn, office);
  if (!race) return reply.code(404).send({ error: 'Disputa ainda não publicada.' });
  reply.header('Cache-Control', 'no-store');
  return { office: race.office, uf: race.uf, turn: race.turn, countedPercent: race.countedPercent, seats: race.seats, validVotes: race.validVotes, candidates: race.candidates };
});

/** Time series of one race for the line charts, built from the local recording. */
app.get<{ Querystring: Query & { office: Office; scope?: string } }>('/api/series', { schema: { querystring: { type: 'object', properties: { ...querySchema.properties, office: { type: 'string', enum: ['president', 'governor', 'senate', 'federal', 'state'] }, scope: { type: 'string', pattern: '^[A-Za-z]{2}$' } }, required: ['office'], additionalProperties: false } } }, async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const { mode, uf, turn, office, scope } = request.query;
  collector.touch(mode, uf, turn);
  return (await collector.series(mode, uf, turn, office, scope)) ?? { candidates: [], points: [] };
});
/**
 * The night's thread: what happened, newest first, for one source/state/round.
 *
 * It is a route of its own rather than more of the snapshot, because the views that draw results
 * do not read events and would pay for them in every poll. The state's own races and the national
 * ones are merged here, which is how a reader thinks about the night.
 */
app.get<{ Querystring: Query & { limit?: number } }>('/api/feed', { schema: { querystring: { type: 'object', properties: { ...querySchema.properties, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } } }, async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const { mode, uf, turn, limit } = request.query;
  collector.touch(mode, uf, turn);
  return { events: collector.feed(mode, uf, turn, limit ?? 120) };
});
app.get<{ Querystring: Query }>('/api/timeline', { schema: { querystring: querySchema } }, async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return collector.timeline(request.query.mode, request.query.uf, request.query.turn);
});
app.get<{ Querystring: Query }>('/api/events', { schema: { querystring: querySchema } }, (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
  });
  reply.raw.write('retry: 3000\n\n');
  const unsubscribe = collector.subscribe(request.query.mode, request.query.uf, request.query.turn, snapshot => {
    if (reply.raw.destroyed || reply.raw.writableEnded) return;
    // Slow clients reconnect to the latest complete snapshot, without an unbounded write buffer.
    if (reply.raw.writableLength > 2_000_000) { reply.raw.destroy(); return; }
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 15000);
  reply.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

const dist = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist, preCompressed: true,
    setHeaders(reply, path) {
      reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Rota desconhecida' }) : reply.sendFile('index.html'));
} else {
  app.get('/', async (_request, reply) => reply.redirect('http://localhost:5173'));
}
app.addHook('onClose', async () => collector.close());
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 3001 });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
