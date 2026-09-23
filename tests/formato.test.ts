import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, fmtInt, fmtPercent, fmtPoints, fmtShortTime, fmtSigned, fold, initials, shortVotes, titleCase } from '../src/domain/format.ts';

const MENOS = '−'; // sinal de menos tipográfico, não o hífen do teclado

test('fmtInt separa o milhar com ponto, no padrão brasileiro', () => {
  assert.equal(fmtInt(1243877), '1.243.877');
  assert.equal(fmtInt(318432), '318.432');
  assert.equal(fmtInt(0), '0');
});

test('fmtInt arredonda a fração antes de formatar', () => {
  assert.equal(fmtInt(1234.6), '1.235');
  assert.equal(fmtInt(1234.4), '1.234');
});

test('fmtInt devolve travessão para ausência de número', () => {
  // A apuração começa sem números: a tela precisa de um lugar-nenhum visível, não de "0" nem de "NaN".
  assert.equal(fmtInt(null), '—');
  assert.equal(fmtInt(undefined), '—');
  assert.equal(fmtInt(NaN), '—');
  assert.equal(fmtInt(Infinity), '—');
});

test('shortVotes abrevia o milhão com duas casas e vírgula decimal', () => {
  assert.equal(shortVotes(1243877), '1,24 mi');
  assert.equal(shortVotes(2500000), '2,5 mi');
  assert.equal(shortVotes(1e6), '1 mi');
});

test('shortVotes abrevia a partir de dez mil, em milhares inteiros', () => {
  assert.equal(shortVotes(318432), '318 mil');
  assert.equal(shortVotes(10000), '10 mil');
});

test('shortVotes mantém o número inteiro abaixo de dez mil', () => {
  // Abaixo do corte, "9 mil" esconderia a diferença de algumas centenas de votos
  // que decide uma vaga proporcional; aí o número vai inteiro mesmo que ocupe espaço.
  assert.equal(shortVotes(9999), '9.999');
  assert.equal(shortVotes(9412), '9.412');
  assert.equal(shortVotes(0), '0');
});

test('shortVotes não deixa a faixa perto do milhão virar "1000 mil"', () => {
  // o arredondamento dos milhares acontece antes da comparação, senão 999.999 saía como "1000 mil"
  assert.equal(shortVotes(999_999), '1 mi');
  assert.equal(shortVotes(999_499), '999 mil');
  assert.equal(shortVotes(1_000_000), '1 mi');
});

test('fmtPercent usa vírgula decimal e leva o sinal de porcentagem', () => {
  assert.equal(fmtPercent(45.678), '45,68%');
  assert.equal(fmtPercent(50), '50,00%');
});

test('fmtPercent respeita o número de casas pedido', () => {
  assert.equal(fmtPercent(45.678, 1), '45,7%');
  assert.equal(fmtPercent(50, 0), '50%');
  assert.equal(fmtPercent(45.678, 4), '45,6780%');
});

test('fmtPercent devolve travessão para ausência de número', () => {
  assert.equal(fmtPercent(null), '—');
  assert.equal(fmtPercent(undefined), '—');
  assert.equal(fmtPercent(NaN), '—');
});

test('fmtPoints nunca escreve "%", porque ponto percentual não é porcentagem', () => {
  // A diferença entre 45% e 42% é de 3 p.p., não de 3% — escrever "%" aqui seria erro de leitura.
  assert.equal(fmtPoints(3.456), '3,46 p.p.');
  assert.ok(!fmtPoints(3.456).includes('%'));
  assert.equal(fmtPoints(-1.24, 1), `${MENOS}1,2 p.p.`, 'o menos é o mesmo em toda a tela');
  assert.equal(fmtPoints(null), '—');
});

test('fmtSigned marca o ganho com "+" e a perda com o menos tipográfico', () => {
  assert.equal(fmtSigned(2.5), '+2,50');
  assert.equal(fmtSigned(-2.5), `${MENOS}2,50`);
  // Não é o hífen do teclado: na fonte condensada do painel o hífen quase some ao lado do dígito.
  assert.ok(!fmtSigned(-2.5).includes('-'));
});

test('fmtSigned deixa o zero sem sinal', () => {
  assert.equal(fmtSigned(0), '0,00');
  assert.equal(fmtSigned(0, 1), '0,0');
});

test('fmtSigned não inventa um menos zero', () => {
  // o sinal sai do número já arredondado: −0,04 com uma casa é zero, e zero não tem sinal
  assert.equal(fmtSigned(-0.04, 1), '0,0');
  assert.equal(fmtSigned(-0.06, 1), `${MENOS}0,1`);
  assert.equal(fmtSigned(0), '0,00');
});

test('titleCase converte o nome de urna em caixa alta para caixa de título', () => {
  assert.equal(titleCase('ANA MARIA'), 'Ana Maria');
  assert.equal(titleCase('  ANA   MARIA '), 'Ana Maria');
});

test('titleCase deixa as partículas minúsculas no meio do nome', () => {
  assert.equal(titleCase('JOAO DA SILVA DOS SANTOS'), 'Joao da Silva dos Santos');
  assert.equal(titleCase('MARIA DE SOUZA E LIMA'), 'Maria de Souza e Lima');
});

test('titleCase mantém a partícula maiúscula quando ela abre o nome', () => {
  assert.equal(titleCase('DA SILVA'), 'Da Silva');
  assert.equal(titleCase('DOS SANTOS NETO'), 'Dos Santos Neto');
});

test('titleCase preserva o hífen e capitaliza os dois lados', () => {
  assert.equal(titleCase('MARIA-JOSE DE SOUZA'), 'Maria-Jose de Souza');
});

test('titleCase decodifica entidades HTML vindas do TSE', () => {
  // O nome chega já escapado na fonte; sem decodificar, a tela mostraria "D&apos;AVILA".
  assert.equal(titleCase('D&apos;AVILA'), "D'avila");
  assert.equal(titleCase('SOUZA &amp; LIMA'), 'Souza & Lima');
});

test('titleCase mantém qualquer algarismo romano em maiúsculas', () => {
  assert.equal(titleCase('PAPA JOAO XII'), 'Papa Joao XII');
  assert.equal(titleCase('LUIZ IV'), 'Luiz IV');
  // a lista antiga era enumerada à mão e tinha buracos: XXIII e XX saíam como "Xxiii" e "Xx"
  assert.equal(titleCase('JOAO XXIII'), 'Joao XXIII');
  assert.equal(titleCase('PIO XX'), 'Pio XX');
  assert.equal(titleCase('LUIZ X'), 'Luiz X');
  // e um nome que por acaso se parece com romano continua sendo nome
  assert.equal(titleCase('IVO LIVI'), 'Ivo Livi');
});

test('fold tira acento, caixa e espaço das pontas', () => {
  // É o texto que toda busca compara: quem digita "acao" tem de achar "AÇÃO".
  assert.equal(fold('  JOÃO Ação  '), 'joao acao');
  assert.equal(fold('SÃO GONÇALO'), 'sao goncalo');
  assert.equal(fold('São Gonçalo'), fold('SAO GONCALO'));
  assert.equal(fold('Brasília'), 'brasilia');
});

test('esc escapa os cinco caracteres perigosos do HTML', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('esc escapa a aspa simples dentro de um atributo', () => {
  // Enquanto havia três cópias divergentes desta função, uma delas não escapava a aspa simples:
  // um nome como O'Brien fechava o atributo do template e quebrava a marcação.
  assert.equal(esc("O'Brien"), 'O&#39;Brien');
  assert.equal(esc(`<a title='x'>Tom & Jerry's</a>`), '&lt;a title=&#39;x&#39;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('esc não mexe em texto sem caractere especial', () => {
  assert.equal(esc('Ana Maria'), 'Ana Maria');
});

test('initials devolve as duas primeiras iniciais do nome', () => {
  assert.equal(initials('ANA MARIA SOUZA'), 'AM');
  assert.equal(initials('joao silva'), 'JS');
});

test('initials ignora partículas curtas ao escolher as iniciais', () => {
  // Sem o filtro, "JOAO DA SILVA" viraria "JD" — a inicial de uma preposição.
  assert.equal(initials('JOAO DA SILVA'), 'JS');
  assert.equal(initials('MARIA DE LIMA'), 'ML');
  assert.equal(initials('MARIA DO CARMO'), 'MC');
});

test('initials descarta partículas de qualquer tamanho', () => {
  // "dos" e "das" passavam pelo filtro de tamanho, e "MARIA DOS SANTOS" virava "MD" — a inicial
  // de uma preposição. Agora o corte é pela caixa: o que titleCase deixou minúsculo não é nome.
  assert.equal(initials('MARIA DOS SANTOS'), 'MS');
  assert.equal(initials('JOAO DAS NEVES'), 'JN');
  assert.equal(initials('JOAO DA SILVA'), 'JS');
});

test('initials aceita nome de uma palavra só', () => {
  assert.equal(initials('LULA'), 'L');
});

test('initials ignora o número de urna que vem colado no nome', () => {
  // "JOAO 10 SILVA" é como o nome de urna chega; "J1" não identificaria ninguém
  assert.equal(initials('JOAO 10 SILVA'), 'JS');
  assert.equal(initials('DR RAY 22'), 'DR');
  assert.equal(initials('22 DE MAIO'), 'M', 'sobrando uma palavra só, uma inicial basta');
});

test('initials devolve algo mesmo para um nome de duas letras', () => {
  assert.equal(initials('AL'), 'A');
  assert.equal(initials('DE DA'), 'D', 'só partículas: a primeira serve de marca');
  assert.equal(initials(''), '');
});

test('fmtShortTime mostra a hora no fuso de Brasília', () => {
  // O servidor carimba em UTC; a tela é lida no horário de Brasília (America/Sao_Paulo, UTC−3).
  assert.equal(fmtShortTime('2024-10-06T23:30:00Z'), '20:30');
  assert.equal(fmtShortTime(Date.UTC(2024, 9, 6, 3, 5)), '00:05');
  assert.equal(fmtShortTime('2024-10-06T17:00:00Z'), '14:00');
});

test('fmtShortTime devolve travessão quando não há instante — mas zero é um instante', () => {
  assert.equal(fmtShortTime(null), '—');
  assert.equal(fmtShortTime(undefined), '—');
  assert.equal(fmtShortTime(''), '—');
  assert.equal(fmtShortTime(0), '21:00', 'o epoch em Brasília é 31/12/1969, 21h — não é ausência');
});
