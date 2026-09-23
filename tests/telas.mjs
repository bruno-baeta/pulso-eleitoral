/**
 * As três telas, abertas num navegador de verdade.
 *
 * Os testes de `npm test` cobrem as contas — ranking, situação, escala, gravação, limites do TSE.
 * O que eles não pegam é a tela não abrir: um import errado, um seletor que sumiu, um erro de
 * JavaScript no primeiro quadro. Isso só aparece carregando a página, e é o que este roteiro faz.
 *
 * Ele exige o servidor no ar (`npm run dev`) porque é isso que está sendo testado: o aplicativo
 * como ele é servido, não uma montagem de laboratório.
 *
 *   npm run test:telas
 *   TEST_URL=http://127.0.0.1:5173 npm run test:telas
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://127.0.0.1:5173';
const QUERY = 'mode=historico&uf=MG&turn=1';
const falhas = [];
const ok = [];

const checar = (condicao, oque) => condicao ? ok.push(oque) : falhas.push(oque);

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1920, height: 1080 } });
const erros = [];
pagina.on('pageerror', e => erros.push(e.message));

const abrir = async (caminho, espera = 6000) => {
  const sep = caminho.includes('?') ? '&' : '?';
  await pagina.goto(`${BASE}${caminho}${sep}${QUERY}`, { waitUntil: 'load' });
  await pagina.waitForTimeout(espera);
};
const conta = sel => pagina.$$eval(sel, e => e.length);

try {
  // ── TV ──────────────────────────────────────────────────────────────────────────────────────
  await abrir('/');
  checar(await pagina.title() === 'Pulso Eleitoral', 'TV: a aba se chama Pulso Eleitoral');
  checar(await conta('.corridas section') === 3, 'TV: três disputas majoritárias');
  checar(await conta('.cadeiras section') === 2, 'TV: duas proporcionais');
  checar(await conta('.nomes li') >= 6, 'TV: os painéis têm nomes');
  checar(await conta('.eleitos li') > 0, 'TV: as colunas dos mais votados aparecem');
  checar((await pagina.$eval('.fio .tira', e => e.textContent))?.length > 0, 'TV: o fio da noite tem frases');

  // a tabela do cargo, com a lista inteira vinda de /api/race
  await pagina.click('.cadeiras section[data-c="federal"] h2 .tudo');
  await pagina.waitForTimeout(2500);
  const candidaturas = Number((await pagina.$eval('.tbl-folha .s', e => e.textContent)).match(/([\d.]+) candidaturas/)?.[1].replace(/\./g, ''));
  checar(candidaturas > 300, `TV: a tabela busca a lista inteira (${candidaturas} candidaturas)`);
  await pagina.keyboard.press('Escape');
  checar(await conta('.tbl-fundo') === 0, 'TV: Esc fecha a tabela');

  // o transporte de replay
  await pagina.click('.fita .toca');
  await pagina.waitForTimeout(500);
  checar(await conta('.fita .vel') === 3, 'TV: tocando, as velocidades aparecem');
  await pagina.click('.fita .vivo');
  await pagina.waitForTimeout(800);
  checar(await pagina.$eval('.fita .quando', e => e.textContent) === 'ao vivo', 'TV: a bolinha verde volta ao vivo');

  // ── Corrida ─────────────────────────────────────────────────────────────────────────────────
  await abrir('/corrida.html?cargo=governor', 8000);
  checar(await conta('.cr-head') === 1, 'Corrida: o cabeçalho monta');
  checar(await conta('svg .lines path') > 0, 'Corrida: as curvas são desenhadas');
  await pagina.locator('.mtog', { hasText: 'ver tabela' }).locator('visible=true').first().click();
  await pagina.waitForTimeout(1500);
  checar(await conta('.sheet tbody tr') > 0, 'Corrida: a tabela da disputa abre');
  await pagina.keyboard.press('Escape');

  // ── Território ──────────────────────────────────────────────────────────────────────────────
  await abrir('/territorio.html', 10000);
  checar(await conta('canvas') >= 1, 'Território: o mapa monta');
  checar(await conta('.list .crow, .list button') > 0, 'Território: o ranking tem linhas');
  await pagina.fill('input[placeholder*="Buscar"]', 'belo horizonte');
  await pagina.waitForTimeout(1200);
  checar(await conta('.sres') > 0, 'Território: a busca encontra o município');

  // ── o seletor, igual nas três ────────────────────────────────────────────────────────────────
  const anos = await pagina.$$eval('select[data-k="year"] option', o => o.map(x => x.textContent));
  checar(anos.length === 4 && anos.includes('2026 · Simulação'), 'Seletor: só as apurações que existem');
  const telas = await pagina.$$eval('select[data-k="lens"] option', o => o.map(x => x.textContent));
  checar(telas.join() === 'TV,Corrida,Território', 'Seletor: as três telas, nesta ordem');

  checar(erros.length === 0, `Nenhum erro de JavaScript${erros.length ? `: ${erros[0]}` : ''}`);
} finally {
  await navegador.close();
}

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of falhas) console.log(`  FALHOU  ${f}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam`);
process.exit(falhas.length ? 1 : 0);
