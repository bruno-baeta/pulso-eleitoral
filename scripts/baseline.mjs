/**
 * Guarda de pixels do layout, para uma mudança responsiva não vazar para cima.
 *
 * As imagens de referência ficam em `tests/baseline/` e não são versionadas: são artefato da
 * máquina que as gerou, e a mesma tela renderiza diferente em outra fonte ou GPU. Quem for mexer
 * no layout grava a sua própria referência antes (`npm run baseline`) e compara depois
 * (`npm run baseline -- check`).
 *
 * The rule is that nothing changes at the sizes the app was designed for. This captures the three
 * views at those sizes and compares a later capture against them, pixel by pixel, so a responsive
 * change that leaks upwards is caught instead of argued about.
 *
 *   npm run baseline -- save     grava a referência em tests/baseline/
 *   npm run baseline -- check    recaptura e compara com ela
 */
import { chromium } from '@playwright/test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const DIR = 'tests/baseline';
const BASE = process.env.TEST_URL || 'http://127.0.0.1:5173';
const QUERY = 'mode=historico&uf=MG&turn=1';
const VIEWS = [['tv', '/'], ['corrida', '/corrida.html'], ['territorio', '/territorio.html']];
/** The sizes the layout was drawn for; below these the app is allowed to change. */
const SIZES = [[3440, 1440], [1920, 1080]];

const mode = process.argv[2] === 'check' ? 'check' : 'save';
const out = mode === 'save' ? DIR : `${DIR}/current`;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
for (const [name, path] of VIEWS) {
  for (const [w, h] of SIZES) {
    // Deterministic or it is not a guard: animations off (the app honours reduced motion), and the
    // pieces that move by themselves — the clock, the gain balloons, the highlight flashes — hidden.
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await page.goto(`${BASE}${path}?${QUERY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.classList.contains('sh-ready'), null, { timeout: 20000 }).catch(() => {});
    // the clock and the "atualizado às" line move on their own; the rest must not
    await page.addStyleTag({ content: `
      .pl-clock, .sh-upd, .pl-cap, .gain { visibility: hidden !important }
      *, *::before, *::after { animation: none !important; transition: none !important }
    ` });
    // let the data settle, then wait for two quiet frames in a row before shooting
    await page.waitForTimeout(6000);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    await page.screenshot({ path: `${out}/${name}-${w}x${h}.png` });
    await page.close();
  }
}
await browser.close();

if (mode === 'save') { console.log(`referência gravada em ${DIR}/`); process.exit(0); }

// compare: PIL is the only image library this project has at hand
/*
 * The chart antialiases its line differently between runs: about eight pixels out of two million.
 * A real change is orders of magnitude bigger — moving the brand's font by one pixel moves 0,13%,
 * three hundred times this — so anything under the threshold is reported but not treated as a
 * difference.
 */
const NOISE = 0.01;
const files = (await readdir(DIR)).filter(f => f.endsWith('.png'));
let worst = 0, report = [];
for (const f of files) {
  if (!existsSync(`${out}/${f}`)) { report.push([f, 'sem captura nova']); continue; }
  const { stdout } = await run('python3', ['-c', `
from PIL import Image, ImageChops
a = Image.open(${JSON.stringify(`${DIR}/${f}`)}).convert('RGB')
b = Image.open(${JSON.stringify(`${out}/${f}`)}).convert('RGB')
if a.size != b.size: print('tamanho', a.size, b.size); raise SystemExit
diff = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 8 else 0)
n = sum(diff.histogram()[255:])
print(f'{n} {n / (a.size[0] * a.size[1]) * 100:.4f}')
`]);
  const [pixels, pct] = stdout.trim().split(' ');
  const diff = Number(pct) || 0;
  if (diff > NOISE) worst = Math.max(worst, diff);
  report.push([f, !diff ? 'idêntico' : `${pixels} px diferentes (${pct}%)${diff <= NOISE ? ' — ruído' : ''}`]);
}
for (const [f, msg] of report) console.log(`  ${f.padEnd(28)} ${msg}`);
console.log(worst === 0 ? '\nnada mudou nos tamanhos de referência' : `\nMAIOR DIFERENÇA: ${worst}%`);
process.exit(worst > 0 ? 1 : 0);
