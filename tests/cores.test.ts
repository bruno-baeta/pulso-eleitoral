import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, COLOR_OTHER, distinctColors, partyColor, partySlot } from '../shared/types.ts';
import { ease, hexToRgb, lerp, mapColors, mute as muteMapa, rgba } from '../src/lenses/territorio/cores.ts';

// `src/lenses/corrida/cores.ts` puxa `shell/dados`, que lê a URL da tela ao ser carregado.
// Em Node não há `location`, então o stub entra antes do import dinâmico do módulo.
Object.defineProperty(globalThis, 'location', { value: { search: '' }, configurable: true });
const { colorOf, mute: muteCorrida } = await import('../src/lenses/corrida/cores.ts');

/** Pares de casas que falham os limites de separação no fundo escuro do painel. */
const BRIGAM = new Set(['0-6', '1-3', '1-4', '1-5', '1-7', '2-4', '2-5', '3-7', '4-7']);
const brigam = (a: number, b: number) => BRIGAM.has(a < b ? `${a}-${b}` : `${b}-${a}`);
const casas = (cores: string[]) => cores.map(c => COLORS.indexOf(c));

const HEX = /^#[0-9a-f]{6}$/;
/** Luminância relativa aproximada e saturação HSL, para comparar uma cor com a sua versão contida. */
function hsl(hex: string): { l: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  return { l, s: d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min) };
}

// ---------------------------------------------------------------- shared/types

test('partySlot reserva o vermelho para o PT e o azul para o PL', () => {
  // São as duas únicas cores de partido que o leitor brasileiro já tem atribuídas.
  assert.equal(partySlot('PT'), 7);
  assert.equal(partySlot('PL'), 0);
  assert.equal(partyColor('PT'), COLORS[7]);
  assert.equal(partyColor('PL'), COLORS[0]);
});

test('partySlot normaliza caixa, espaço e pontuação da sigla', () => {
  assert.equal(partySlot(' pt '), partySlot('PT'));
  assert.equal(partySlot('psdb'), partySlot('PSDB'));
});

test('partySlot mantém os demais partidos fora das casas reservadas', () => {
  for (const sigla of ['PSDB', 'MDB', 'PSB', 'PP', 'PSD', 'NOVO', 'PV', 'REDE', 'PDT', 'PSOL']) {
    const casa = partySlot(sigla);
    assert.ok(casa >= 1 && casa <= 6, `${sigla} caiu na casa reservada ${casa}`);
  }
});

test('COLORS e COLOR_OTHER expõem oito casas e um neutro para a cauda', () => {
  assert.equal(COLORS.length, 8);
  for (const c of COLORS) assert.match(c, HEX);
  assert.match(COLOR_OTHER, HEX);
  assert.ok(!COLORS.includes(COLOR_OTHER));
});

test('distinctColors não repete cor nem aproxima cores que brigam entre marcas vizinhas', () => {
  const itens = [{ sigla: 'PT' }, { sigla: 'PL' }, { sigla: 'PSDB' }, { sigla: 'MDB' }, { sigla: 'PSB' }, { sigla: 'PP' }];
  const cores = distinctColors(itens, i => i.sigla);
  assert.equal(new Set(cores).size, cores.length);
  const slots = casas(cores);
  for (let i = 1; i < slots.length; i++) {
    assert.ok(!brigam(slots[i - 1], slots[i]), `casas ${slots[i - 1]} e ${slots[i]} brigam em marcas vizinhas`);
  }
});

test('distinctColors preserva as casas reservadas do PT e do PL dentro da lista', () => {
  const itens = [{ sigla: 'MDB' }, { sigla: 'PSB' }, { sigla: 'PT' }, { sigla: 'PL' }];
  const cores = distinctColors(itens, i => i.sigla);
  assert.equal(cores[2], COLORS[7]);
  assert.equal(cores[3], COLORS[0]);
});

test('distinctColors é estável: a mesma lista devolve sempre as mesmas cores', () => {
  // Se a cor mudasse entre dois quadros, a linha do gráfico piscaria a cada atualização do feed.
  const itens = [{ sigla: 'PSDB' }, { sigla: 'PT' }, { sigla: 'MDB' }, { sigla: 'PDT' }];
  assert.deepEqual(distinctColors(itens, i => i.sigla), distinctColors(itens, i => i.sigla));
});

test('distinctColors degrada sem quebrar quando a lista passa da paleta', () => {
  // Deputado estadual traz dezenas de partidos: repetir tom é aceitável (toda marca leva nome e
  // sigla), travar ou devolver undefined não é.
  const siglas = ['PT', 'PL', 'PSDB', 'MDB', 'PSB', 'PP', 'PSD', 'NOVO', 'PV', 'REDE', 'PDT', 'PSOL'];
  const itens = siglas.map(sigla => ({ sigla }));
  const cores = distinctColors(itens, i => i.sigla);
  assert.equal(cores.length, siglas.length);
  for (const c of cores) assert.ok(COLORS.includes(c), `cor fora da paleta: ${c}`);
  assert.equal(new Set(cores.slice(0, 8)).size, 8); // as oito primeiras ainda são todas distintas
  for (let i = 1; i < cores.length; i++) assert.notEqual(cores[i], cores[i - 1]);
});

// ------------------------------------------------------- src/lenses/corrida/cores

test('colorOf devolve a cor do próprio partido para PT, PL e PSDB', () => {
  // A tabela é a cor que o partido usa; inventar um tom para o PT seria gratuitamente estranho.
  assert.equal(colorOf('PT'), muteCorrida('#c8102e'));
  assert.equal(colorOf('PL'), muteCorrida('#1b3a6b'));
  assert.equal(colorOf('PSDB'), muteCorrida('#0f7dc2'));
});

test('colorOf é estável entre chamadas, inclusive com o cache preenchido', () => {
  assert.equal(colorOf('MDB'), colorOf('MDB'));
  assert.equal(colorOf('PARTIDO_INEXISTENTE'), colorOf('PARTIDO_INEXISTENTE'));
});

test('colorOf reconhece sigla com acento e coligação da tabela', () => {
  assert.equal(colorOf('UNIÃO'), muteCorrida('#0b4ea2'));
  assert.equal(colorOf('PT+PV+PC DO B'), muteCorrida('#c8102e')); // a coligação herda o vermelho do PT
  assert.equal(colorOf('PSDB+CIDADANIA'), muteCorrida('#0f7dc2'));
});

test('colorOf ignora o asterisco de candidatura do demo e aceita caixa baixa', () => {
  assert.equal(colorOf('PT*'), colorOf('PT'));
  assert.equal(colorOf('pt'), colorOf('PT'));
});

test('colorOf cai na paleta de reserva para sigla fora da tabela, sempre em hex válido', () => {
  const cor = colorOf('SIGLA_QUE_NAO_EXISTE');
  assert.match(cor, HEX);
  assert.ok(![colorOf('PT'), colorOf('PL')].includes(cor));
});

test('mute da corrida devolve hex de sete caracteres', () => {
  for (const hex of ['#ff0000', '#c8102e', '#ffffff', '#000000', '#0f7dc2']) {
    const saida = muteCorrida(hex);
    assert.equal(saida.length, 7);
    assert.match(saida, HEX);
  }
});

test('mute da corrida escurece e dessatura uma cor berrante', () => {
  // A cor de bandeira é feita para papel branco; no fundo quase preto do painel ela estoura.
  const entrada = hsl('#ff0000'), saida = hsl(muteCorrida('#ff0000'));
  assert.ok(saida.l < entrada.l, `luminância não caiu: ${entrada.l} -> ${saida.l}`);
  assert.ok(saida.s < entrada.s, `saturação não caiu: ${entrada.s} -> ${saida.s}`);
});

test('mute da corrida contém o branco e preserva o preto', () => {
  assert.ok(hsl(muteCorrida('#ffffff')).l < 1);
  assert.equal(muteCorrida('#000000'), '#000000');
});

// ---------------------------------------------------- src/lenses/territorio/cores

test('mapColors reserva o vermelho do PT e o azul do PL no mapa', () => {
  const cores = mapColors(['PT', 'PL', 'PSDB']);
  assert.equal(cores[0], COLORS[7]);
  assert.equal(cores[1], COLORS[0]);
  assert.notEqual(cores[2], COLORS[7]);
  assert.notEqual(cores[2], COLORS[0]);
});

test('mapColors mantém a reserva mesmo quando o PT não abre a lista', () => {
  const cores = mapColors(['MDB', 'PSB', 'PT', 'PL']);
  assert.equal(cores[2], COLORS[7]);
  assert.equal(cores[3], COLORS[0]);
});

test('mapColors não dá cores que brigam a partidos vizinhos na lista', () => {
  // Municípios vizinhos se tocam no mapa: duas cores próximas demais viram uma mancha só.
  const slots = casas(mapColors(['PL', 'PSDB', 'MDB', 'PSB']));
  for (let i = 1; i < slots.length; i++) {
    assert.ok(!brigam(slots[i - 1], slots[i]), `casas ${slots[i - 1]} e ${slots[i]} brigam no mapa`);
  }
  assert.equal(new Set(slots).size, slots.length);
});

test('mapColors evita brigar com qualquer cor já no mapa, não só com a anterior', () => {
  // Vencedores não ficam lado a lado numa lista ordenada, ficam lado a lado no território.
  const slots = casas(mapColors(['MDB', 'PSB', 'PP']));
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      assert.ok(!brigam(slots[i], slots[j]), `casas ${slots[i]} e ${slots[j]} brigam no mesmo mapa`);
    }
  }
});

test('mapColors prefere repetir tom a deixar um partido sem cor quando não há casa livre sem briga', () => {
  // Com quatro partidos a restrição já é insatisfatível (ex.: MDB/PSB/PP/PSD fecha as casas 2, 3 e
  // 6 e todas as restantes brigam com alguma delas). O fallback então pega a primeira casa livre:
  // aceita o par próximo, mas não repete cor nem devolve undefined.
  const slots = casas(mapColors(['MDB', 'PSB', 'PP', 'PSD']));
  assert.equal(new Set(slots).size, slots.length);
  for (const s of slots) assert.ok(s >= 0 && s < COLORS.length);
  assert.ok(slots.some((s, i) => i > 0 && brigam(slots[i - 1], s)) || slots.some((a, i) => slots.slice(i + 1).some(b => brigam(a, b))));
});

test('mapColors é estável e degrada sem quebrar quando há mais partidos que casas', () => {
  const lista = ['PT', 'PL', 'PSDB', 'MDB', 'PSB', 'PP', 'PSD', 'NOVO', 'PV', 'REDE', 'PDT', 'PSOL'];
  const cores = mapColors(lista);
  assert.equal(cores.length, lista.length);
  for (const c of cores) assert.ok(COLORS.includes(c), `cor fora da paleta: ${c}`);
  assert.deepEqual(mapColors(lista), cores);
});

test('mapColors aceita sigla com acento, asterisco e caixa baixa', () => {
  assert.equal(mapColors(['pt'])[0], COLORS[7]);
  assert.equal(mapColors(['PT*'])[0], COLORS[7]);
  assert.equal(mapColors(['UNIÃO'])[0], mapColors(['UNIO'])[0]); // a sigla é reduzida a A-Z
});

test('hexToRgb lê o hex de três e de seis dígitos', () => {
  assert.deepEqual(hexToRgb('#f00'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('#2f7bf5'), [47, 123, 245]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('abc'), hexToRgb('#abc')); // a cerquilha é opcional
});

test('rgba arredonda os canais e corta a opacidade em três casas', () => {
  assert.equal(rgba([47, 123, 245], 1), 'rgba(47,123,245,1)');
  assert.equal(rgba([1.4, 255, 0], 0.12345), 'rgba(1,255,0,0.123)');
  assert.equal(rgba(hexToRgb('#f00'), 0), 'rgba(255,0,0,0)');
});

test('mute do mapa puxa a cor para o cinza, para ler como tinta e não como neon', () => {
  const [r, g, b] = muteMapa('#ff0000');
  assert.ok(r < 255 && g > 0 && b > 0, `não puxou para o cinza: ${[r, g, b]}`);
  assert.deepEqual(muteMapa('#ff0000', 0), [255, 0, 0]); // sem puxar, a cor passa intacta
  assert.deepEqual(muteMapa('#ff0000', 1), [85, 85, 85]); // puxada até o fim, vira o cinza médio
});

test('ease prende os extremos e passa pelo meio em 0,5', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  assert.equal(ease(0.5), 0.5);
});

test('lerp devolve as pontas exatas e o meio no meio', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 0, 0.25), 7.5);
});
