// Screenshot helper: node scripts/shoot.mjs [query] [width] [height] [out] ; STEPS="key:Escape,click:.selector,wait:800"
import { chromium } from '@playwright/test';
const [query = 'mode=demo&uf=MG', width = '3440', height = '1440', out = '/tmp/arena.png'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: +width, height: +height } });
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await page.goto(query.startsWith("/") ? `http://127.0.0.1:5173${query}` : `http://127.0.0.1:5173/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(+(process.env.WAIT || 4000));
  for (const step of (process.env.STEPS || '').split(',').filter(Boolean)) {
    if (step.startsWith('key:')) await page.keyboard.press(step.slice(4));
    if (step.startsWith('type:')) await page.keyboard.type(step.slice(5));
    if (step.startsWith('click:')) await page.click(step.slice(6));
    if (step.startsWith('hover:')) { const [x, y] = step.slice(6).split('x').map(Number); await page.mouse.move(x, y); }
    if (step.startsWith('wait:')) await page.waitForTimeout(+step.slice(5));
  }
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
  console.log(JSON.stringify(overflow), errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'sem erros de página', logs.length ? '\nCONSOLE: ' + [...new Set(logs)].slice(0, 8).join('\n') : '');
  await page.screenshot({ path: out, timeout: 60000, animations: 'disabled' });
} finally { await browser.close(); }
