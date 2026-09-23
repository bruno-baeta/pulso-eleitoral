/**
 * A leitura dos dados municipais, do fio para a tela.
 *
 * O arquivo que o servidor manda é compacto de propósito — são 5.570 municípios, e cada um vira
 * uma linha de tuplas, não um objeto nomeado. Essa economia é o que faz o mapa caber na rede, e é
 * também onde um deslocamento de índice passa despercebido: trocar `pairs[0]` por `pairs[1]`
 * pinta o mapa inteiro com o segundo colocado e ninguém percebe olhando.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * O módulo lê a seleção da URL e do armazenamento do navegador — é assim que as três telas
 * concordam sobre de qual apuração estão falando. Fora do navegador, isso precisa existir antes
 * do import, que é o que estas duas linhas fazem.
 */
const alvo = globalThis as unknown as { location: { search: string }; localStorage: Storage };
alvo.location = { search: '?mode=historico&uf=MG&turn=1' };
alvo.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };

const { fold, munName, prepare, empty } = await import('../src/lenses/territorio/data.ts');
type Payload = Parameters<typeof prepare>[0];

const carga = (over: Partial<Payload> = {}): Payload => ({
  office: 'governor', area: 'MG', status: 'ready', message: '', loaded: 853, total: 853, version: 7,
  sourceAt: '2022-10-02T20:00:00-03:00',
  c: [['30', 6_094_136], ['13', 3_805_182], ['22', 783_800]],
  m: [
    ['3106200', 'BELO HORIZONTE', 'MG', 1_500_000, [0, 800_000, 1, 500_000, 2, 200_000], 'h1'],
    ['3143302', 'OURO PRETO', 'MG', 40_000, [1, 22_000, 0, 15_000], 'h2'],
    ['3170206', "SANT'ANA DO LIVRAMENTO", 'MG', 5_000, [0, 3_000, 1, 2_000]],
    ['3100104', 'ABADIA DOS DOURADOS', 'MG', 3_000, []],
  ],
  n: { '30': ['ZEMA', 'NOVO'], '13': ['KALIL', 'PSD'], '22': ['CARLOS VIANA', 'PL'] },
  ...over,
});

test('o nome do município vem em caixa alta e sai em nome próprio, apóstrofo incluído', () => {
  assert.equal(munName('BELO HORIZONTE'), 'Belo Horizonte');
  assert.equal(munName('SAO JOAO DEL REI'), 'Sao Joao del Rei');
  // o apóstrofo é o caso que o titleCase sozinho erra: "Sant'ana" em vez de "Sant'Ana"
  assert.equal(munName("SANT'ANA DO LIVRAMENTO"), "Sant'Ana do Livramento");
  assert.equal(munName("OLHO D'AGUA"), "Olho d'Agua", 'o D solto é preposição e fica minúsculo');
  assert.equal(munName("SANTA BARBARA D'OESTE"), "Santa Barbara d'Oeste");
});

test('a busca de cidade ignora acento, caixa e pontuação', () => {
  // quem digita "santana" tem de achar Sant'Ana; quem digita "sao joao" tem de achar São João
  assert.equal(fold("Sant'Ana do Livramento"), 'sant ana do livramento');
  assert.equal(fold('SÃO JOÃO DEL REI'), 'sao joao del rei');
  assert.equal(fold('  Belo   Horizonte  '), 'belo horizonte');
  assert.equal(fold('Águas Vermelhas'), 'aguas vermelhas');
});

test('preparar traduz as tuplas do fio sem perder nem inventar município', () => {
  const d = prepare(carga());
  assert.equal(d.cities.length, 4);
  assert.equal(d.byCdi.get('3106200')!.name, 'Belo Horizonte');
  assert.equal(d.byCdi.get('3106200')!.vv, 1_500_000);
  assert.deepEqual([...d.byCdi.get('3143302')!.pairs], [1, 22_000, 0, 15_000]);
  assert.deepEqual(d.nums, ['30', '13', '22']);
  assert.deepEqual(d.totals, [6_094_136, 3_805_182, 783_800]);
  assert.deepEqual(d.names.get('30'), ['ZEMA', 'NOVO']);
});

test('quem lidera cada cidade é o primeiro par, e é assim que o mapa é pintado', () => {
  /*
   * `wins` conta em quantas cidades cada candidatura vem na frente, e é o que dá a cor de cada
   * município. Os pares chegam ordenados por voto: o primeiro é o líder. Ler o índice errado
   * pintaria o estado inteiro com o segundo colocado, sem nenhum sinal de erro na tela.
   */
  const d = prepare(carga());
  assert.equal(d.wins.get(0), 2, 'a candidatura 0 lidera Belo Horizonte e Sant\'Ana');
  assert.equal(d.wins.get(1), 1, 'a candidatura 1 lidera Ouro Preto');
  assert.equal(d.wins.get(2), undefined, 'quem não lidera lugar nenhum não entra na conta');
  assert.equal([...d.wins.values()].reduce((a, b) => a + b, 0), 3, 'a cidade sem voto publicado não conta');
});

test('cidade sem voto publicado sobrevive à preparação', () => {
  // acontece a noite inteira: o município existe no mapa antes de ter resultado
  const d = prepare(carga());
  const semVoto = d.byCdi.get('3100104')!;
  assert.equal(semVoto.pairs.length, 0);
  assert.equal(semVoto.name, 'Abadia dos Dourados');
});

test('o estado de espera é um conjunto vazio coerente, não um buraco', () => {
  const d = empty('federal', 'loading', 'Buscando os resultados por município.', 120, 853);
  assert.equal(d.office, 'federal');
  assert.equal(d.area, 'MG', 'disputa estadual é contada no estado');
  assert.equal(empty('president', 'waiting', '').area, 'BR', 'a presidência é nacional');
  assert.equal(d.version, -1, 'versão −1 é o que faz a próxima leitura ser aceita');
  assert.deepEqual(d.cities, []);
  assert.equal(d.byCdi.size, 0);
  assert.equal(d.loaded, 120);
  assert.equal(d.total, 853);
});
