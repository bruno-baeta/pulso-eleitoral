/**
 * A projeção de bancadas — a conta mais consequente do painel.
 *
 * Dizer que um partido fez sete cadeiras quando fez cinco é afirmar um resultado errado sobre uma
 * eleição, e a projeção aparece na tela durante quase toda a noite: o TSE só marca eleitos quando
 * a proporcional fecha. Estes testes fixam as três regras que decidem o número e, principalmente,
 * a fronteira entre relatar e estimar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancadasDe, porPartido, projetarBancadas, quocienteEleitoral, type Candidatura } from '../src/lenses/tv/bancadas.ts';

const cand = (party: string, votes: number, elected = false): Candidatura =>
  ({ party, votes, elected, color: '#fff' });

test('quociente eleitoral é o preço de uma cadeira: válidos divididos pelas vagas', () => {
  // Minas em 2022: 11,18 milhões de válidos para 53 vagas federais
  assert.equal(Math.round(quocienteEleitoral(11_180_101, 53)), 210_945);
  assert.equal(quocienteEleitoral(1000, 4), 250);
  // vaga nenhuma não pode virar divisão por zero no meio de uma apuração
  assert.equal(quocienteEleitoral(1000, 0), 1000);
});

test('quem não alcança o quociente fica de fora da distribuição', () => {
  // 1.000 válidos, 4 vagas: o quociente é 250, e o partido C tem 90
  const bancadas = porPartido([cand('A', 500), cand('B', 410), cand('C', 90)]);
  const projetadas = projetarBancadas(bancadas, 4, 1000);
  assert.deepEqual(projetadas.map(b => b.partido), ['A', 'B']);
  assert.equal(projetadas.find(b => b.partido === 'C'), undefined, 'a cláusula de partido não é opcional');
});

test('as vagas vão às maiores médias, uma a uma', () => {
  /*
   * A x B com 700 e 300 em 4 vagas (quociente 250, os dois passam). As médias, a cada rodada:
   *   1ª: A 700, B 300 → A       2ª: A 350, B 300 → A
   *   3ª: A 233, B 300 → B       4ª: A 233, B 150 → A
   * Resultado: A 3, B 1 — que é a diferença entre "o dobro dos votos" e "o dobro das cadeiras".
   */
  const projetadas = projetarBancadas(porPartido([cand('A', 700), cand('B', 300)]), 4, 1000);
  const mapa = Object.fromEntries(projetadas.map(b => [b.partido, b.cadeiras]));
  assert.deepEqual(mapa, { A: 3, B: 1 });
});

test('toda vaga é distribuída, e nenhuma a mais', () => {
  const votos = [480_000, 310_000, 260_000, 190_000, 95_000, 12_000];
  const validos = votos.reduce((a, b) => a + b, 0);
  for (const vagas of [1, 3, 8, 21, 53, 77]) {
    const projetadas = projetarBancadas(porPartido(votos.map((v, i) => cand(`P${i}`, v))), vagas, validos);
    const total = projetadas.reduce((t, b) => t + b.cadeiras, 0);
    assert.equal(total, vagas, `com ${vagas} vagas, foram distribuídas ${total}`);
  }
});

test('partido sem cadeira nenhuma não vira linha de bancada', () => {
  const projetadas = projetarBancadas(porPartido([cand('A', 900), cand('B', 100)]), 1, 1000);
  assert.deepEqual(projetadas.map(b => b.partido), ['A']);
  assert.ok(projetadas.every(b => b.cadeiras > 0));
});

test('ninguém alcançando o quociente, todos disputam as vagas (art. 109, §2º)', () => {
  /*
   * Acontece no primeiro arquivo de uma proporcional — votos espalhados, quociente calculado sobre
   * o total de válidos já apurados — e sempre numa disputa de vaga única, onde o quociente é o
   * total. A lei manda eleger os mais votados; devolver bancada vazia deixaria o painel mudo.
   */
  const bancadas = porPartido([cand('A', 10), cand('B', 8), cand('C', 6)]);
  const projetadas = projetarBancadas(bancadas, 3, 1_000_000);
  assert.equal(projetadas.reduce((t, b) => t + b.cadeiras, 0), 3);
  assert.equal(projetadas[0].partido, 'A');
});

test('sem partido nenhum, não há o que projetar', () => {
  assert.deepEqual(projetarBancadas([], 53, 1_000_000), []);
});

test('publicado o primeiro eleito, a contagem substitui a projeção', () => {
  const candidatos = [
    cand('PL', 1_492_047, true), cand('PL', 120_000), cand('PT', 238_967, true), cand('PT', 90_000),
    cand('NOVO', 208_332), cand('NOVO', 100_000),
  ];
  const { bancadas, projetada } = bancadasDe(candidatos, 3, 2_249_346);
  assert.equal(projetada, false, 'com eleito publicado, nada é estimado');
  assert.deepEqual(bancadas.map(b => [b.partido, b.cadeiras]), [['PL', 1], ['PT', 1]]);
  assert.equal(bancadas.find(b => b.partido === 'NOVO'), undefined, 'quem o TSE não elegeu não senta');
  // a votação somada continua sendo a do partido inteiro, não só a do eleito
  assert.equal(bancadas.find(b => b.partido === 'PL')!.votos, 1_492_047, 'só os eleitos entram na soma quando há eleitos');
});

test('sem eleito publicado, a bancada é projetada e se diz projetada', () => {
  const candidatos = [cand('A', 600_000), cand('A', 100_000), cand('B', 250_000), cand('C', 50_000)];
  const { bancadas, projetada } = bancadasDe(candidatos, 4, 1_000_000);
  assert.equal(projetada, true);
  assert.equal(bancadas.reduce((t, b) => t + b.cadeiras, 0), 4);
  assert.equal(bancadas[0].partido, 'A', 'a maior bancada vem primeiro');
});

test('sem válidos publicados, a soma das candidaturas serve de base', () => {
  // acontece no primeiro arquivo de uma disputa: o total de válidos ainda vem zerado
  const candidatos = [cand('A', 700), cand('B', 300)];
  const { bancadas } = bancadasDe(candidatos, 2, 0);
  assert.equal(bancadas.reduce((t, b) => t + b.cadeiras, 0), 2);
});

test('a ordem é por cadeiras, e votos desempatam', () => {
  const candidatos = [
    cand('A', 300_000, true), cand('B', 400_000, true), cand('C', 500_000, true), cand('C', 10, true),
  ];
  const { bancadas } = bancadasDe(candidatos, 4, 1_200_010);
  assert.deepEqual(bancadas.map(b => b.partido), ['C', 'B', 'A'], 'C tem duas cadeiras; B ganha de A nos votos');
});

test('disputa vazia não quebra o painel', () => {
  const { bancadas, projetada } = bancadasDe([], 53, 0);
  assert.deepEqual(bancadas, []);
  assert.equal(projetada, true);
});
