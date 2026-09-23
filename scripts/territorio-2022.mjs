// Prepares static data for the "Território" lens (2022, 1st round):
//  - president per municipality for all of Brazil (election 544, c0001), abroad (ZZ) excluded;
//  - MG state offices per municipality (election 546: governor c0003, senate c0005, federal c0006, state c0007);
//  - IBGE municipality mesh for Brazil, quantized + delta-encoded, and state outlines.
// Network-polite: strictly sequential, <= 3 req/s, disk cache, aborts on any non-200 (403/429/404…).
// Outputs are built in data/territorio-build/ (not watched by Vite). Copy them into public/ once, at the end:
//   node scripts/territorio-2022.mjs [--only=mg|br]  # download (cached) + build
//   node scripts/territorio-2022.mjs --publish       # copy the finished build into public/data/territorio/ in one step
import { mkdir, readFile, writeFile, access, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, 'data/tse-cache/territorio-2022');
const BUILD = join(ROOT, 'data/territorio-build');
const PUBLIC = join(ROOT, 'public/data/territorio');
const UA = 'PulsoEleitoral/1.0 (preparo de dados)';
const TSE = 'https://resultados.tse.jus.br/oficial/ele2022';
const MIN_GAP = Number(process.env.GAP_MS) || 350; // ms between request starts (< 3 req/s)
const args = process.argv.slice(2);
const ONLY = args.find(a => a.startsWith('--only='))?.slice(7);

let last = 0, fetched = 0, cached = 0;
const exists = p => access(p).then(() => true, () => false);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, file) {
  const path = join(CACHE, file);
  if (await exists(path)) { cached++; return JSON.parse(await readFile(path, 'utf8')); }
  const wait = last + MIN_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  // Transient network failures (socket closed, reset, timeout) retry with 5 s → 15 s → 45 s backoff;
  // any HTTP status other than 200 (403/429/404…) still aborts immediately.
  let text;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status !== 200) { console.error(`\nABORT: HTTP ${res.status} for ${url}`); process.exit(2); }
      text = await res.text();
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      const delay = [5000, 15000, 45000][attempt];
      console.error(`\nfalha de rede (${e.cause?.code || e.name}); nova tentativa em ${delay / 1000} s: ${url}`);
      await sleep(delay);
      last = Date.now();
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  fetched++;
  return JSON.parse(text);
}

const num = s => Number(String(s ?? '0').replace(/\./g, '').replace(',', '.')) || 0;

/** Reduce the per-municipality files of one office. `keep` = number of candidates (by total) with full vectors. */
async function office({ election, code, label, ufs, keep }) {
  const rows = [];
  let i = 0; const n = ufs.reduce((s, u) => s + u.mu.length, 0);
  for (const uf of ufs) for (const m of uf.mu) {
    i++;
    const lc = uf.cd.toLowerCase();
    const d = await get(`${TSE}/${election}/dados/${lc}/${lc}${m.cd}-c${code}-e000${election}-v.json`, `${election === '544' ? 'p' : 'c'}${code}/${lc}${m.cd}.json`);
    const mu = d.abr.find(a => a.tpabr === 'MU') || d.abr[0];
    const cand = mu.cand.map(c => ({ n: c.n, v: num(c.vap) })).sort((a, b) => b.v - a.v);
    rows.push({ cdi: m.cdi, nm: m.nm, uf: uf.cd, vv: num(mu.vv), cand });
    if (i % 50 === 0 || i === n) process.stdout.write(`\r${label}: ${i}/${n} (baixados ${fetched}, cache ${cached})   `);
  }
  const totals = {};
  for (const r of rows) for (const c of r.cand) totals[c.n] = (totals[c.n] || 0) + c.v;
  // Sparse format, every candidate kept: c = [[number, total]] sorted by total (the index is the state/national rank − 1);
  // m = [[ibge, name, uf, validVotes, [candIndex, votes, …]]] with pairs sorted by votes in the city (first pair = winner),
  // only for votes > 0.
  const order = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const index = new Map(order.map(([n], i) => [n, i]));
  const out = {
    office: label, year: 2022, turn: 1, source: `${TSE}/${election}/dados/`,
    c: order.map(([n, v]) => [n, v]),
    m: rows.map(r => [r.cdi, r.nm, r.uf, r.vv, r.cand.filter(c => c.v > 0).flatMap(c => [index.get(c.n), c.v])]),
  };
  void keep;
  await writeFile(join(BUILD, `${label}.json`), JSON.stringify(out));
  console.log(`\n${label}: ${rows.length} municípios → data/territorio-build/${label}.json`);
}

/** Quantize to 0.001° and delta-encode outer rings: [x0, y0, dx1, dy1, …] in thousandths of a degree. */
function encodeGeometry(geo) {
  const Q = 1000, feats = [];
  for (const f of geo.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const rings = [];
    for (const poly of polys) {
      const pts = [];
      for (const p of poly[0]) {
        const q = [Math.round(p[0] * Q), Math.round(p[1] * Q)], l = pts[pts.length - 1];
        if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q);
      }
      if (pts.length < 4) continue;
      const enc = [pts[0][0], pts[0][1]];
      for (let i = 1; i < pts.length; i++) enc.push(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      rings.push(enc);
    }
    if (rings.length) feats.push({ c: String(f.properties.codarea), r: rings });
  }
  return { q: Q, f: feats };
}

async function main() {
  if (args.includes('--publish')) {
    await mkdir(PUBLIC, { recursive: true });
    const files = (await readdir(BUILD)).filter(f => f.endsWith('.json'));
    for (const f of files) await copyFile(join(BUILD, f), join(PUBLIC, f));
    console.log(`publicados: ${files.join(', ')}`);
    return;
  }
  await mkdir(BUILD, { recursive: true });
  const cfg546 = await get(`${TSE}/546/config/mun-e000546-cm.json`, 'mun-e000546-cm.json');
  const cfg544 = await get(`${TSE}/544/config/mun-e000544-cm.json`, 'mun-e000544-cm.json');
  const mg = cfg546.abr.filter(a => a.cd === 'MG');

  if (!(await exists(join(BUILD, 'br-municipios.json'))) && ONLY !== 'mg') {
    const geo = await get('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima', 'ibge-br-municipios.geojson');
    await writeFile(join(BUILD, 'br-municipios.json'), JSON.stringify(encodeGeometry(geo)));
    const ufs = await get('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima', 'ibge-br-ufs.geojson');
    await writeFile(join(BUILD, 'br-ufs.json'), JSON.stringify(encodeGeometry(ufs)));
    console.log('malhas: br-municipios.json, br-ufs.json');
  }
  if (ONLY !== 'br') {
    await office({ election: '546', code: '0003', label: 'mg-governador', ufs: mg, keep: 10 });
    await office({ election: '546', code: '0005', label: 'mg-senado', ufs: mg, keep: 9 });
    await office({ election: '546', code: '0006', label: 'mg-deputado-federal', ufs: mg, keep: 12 });
    await office({ election: '546', code: '0007', label: 'mg-deputado-estadual', ufs: mg, keep: 12 });
  }
  if (ONLY !== 'mg') {
    await office({ election: '544', code: '0001', label: 'br-presidente', ufs: cfg544.abr.filter(a => a.cd !== 'ZZ'), keep: 11 });
  }
  console.log(`done: ${fetched} baixados, ${cached} do cache`);
}
main().catch(e => { console.error(e); process.exit(1); });
