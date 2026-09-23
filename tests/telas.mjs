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


  // ── a folha de cidades de uma candidatura ───────────────────────────────────────────────────
  await abrir('/');
  await pagina.click('.corridas section[data-c="governor"] .nomes li:first-child .abre');
  await pagina.waitForTimeout(3000);
  const cidades = await conta('.tbl-folha tbody tr');
  checar(cidades > 100, `TV: o nome abre as cidades da candidatura (${cidades} linhas)`);
  checar((await pagina.$eval('.tbl-folha .t', e => e.textContent)).length > 2, 'TV: a folha de cidades tem o nome no cabeçalho');
  await pagina.keyboard.press('Escape');

  // ── o presidente contado no Brasil e dentro do estado ────────────────────────────────────────
  const votosBR = await pagina.$eval('.corridas section[data-c="president"] .nomes li u', e => e.textContent);
  await pagina.click('.corridas section[data-c="president"] .escopo button[data-e="UF"]');
  await pagina.waitForTimeout(2500);
  const votosUF = await pagina.$eval('.corridas section[data-c="president"] .nomes li u', e => e.textContent);
  const soNumero = t => Number(t.replace(/\D/g, ''));
  checar(soNumero(votosUF) > 0 && soNumero(votosUF) < soNumero(votosBR),
    `TV: o presidente no estado conta menos que no país (${votosUF} contra ${votosBR})`);
  await pagina.click('.corridas section[data-c="president"] .escopo button[data-e="BR"]');
  await pagina.waitForTimeout(1500);

  // ── tela cheia esconde a barra do aplicativo ────────────────────────────────────────────────
  await pagina.evaluate(() => document.documentElement.classList.add('sem-barra'));
  await pagina.waitForTimeout(600);
  checar(await pagina.$eval('.sh-head', e => getComputedStyle(e).display) === 'none', 'TV: em tela cheia a barra some');
  await pagina.evaluate(() => document.documentElement.classList.remove('sem-barra'));

  // ── trocar de estado troca os números ───────────────────────────────────────────────────────
  const antesMG = await pagina.$eval('.corridas section[data-c="governor"] .nomes li span', e => e.textContent);
  await pagina.selectOption('select[data-k="uf"]', 'SP');
  await pagina.waitForTimeout(6000);
  const depoisSP = await pagina.$eval('.corridas section[data-c="governor"] .nomes li span', e => e.textContent);
  checar(antesMG !== depoisSP, `TV: trocar de estado troca a disputa (${antesMG.trim()} → ${depoisSP.trim()})`);
  checar(await conta('.vazio') === 0, 'TV: depois da troca não sobra painel vazio');

  // ── as etiquetas de situação vêm do TSE ─────────────────────────────────────────────────────
  await abrir('/');
  const etiquetas = await pagina.$$eval('.tag', t => t.map(x => x.textContent));
  checar(etiquetas.includes('eleito'), 'TV: quem o TSE elegeu aparece marcado como eleito');
  checar(etiquetas.every(t => ['eleito', '2º turno', 'suplente', 'não eleito'].includes(t)),
    'TV: nenhuma etiqueta fora das que a fonte publica');

  // ── a bancada dos deputados ─────────────────────────────────────────────────────────────────
  const bancadas = await pagina.$eval('.cadeiras section[data-c="federal"] .bancadas', e => e.textContent);
  checar(/\d/.test(bancadas), `Deputados: a linha de bancadas tem números (${bancadas.slice(0, 40)}…)`);
  const soma = await pagina.$$eval('.cadeiras section[data-c="federal"] .bancadas b', b => b.map(x => Number(x.textContent.replace('~', ''))).reduce((a, c) => a + c, 0));
  checar(soma > 0 && soma <= 53, `Deputados: as cadeiras somadas cabem nas 53 vagas de Minas (${soma})`);

  checar(erros.length === 0, `Nenhum erro de JavaScript${erros.length ? `: ${erros[0]}` : ''}`);
} finally {
  await navegador.close();
}

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of falhas) console.log(`  FALHOU  ${f}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam`);
process.exit(falhas.length ? 1 : 0);
