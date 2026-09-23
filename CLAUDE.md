# Pulso Eleitoral — o que é preciso saber antes de mexer

Acompanhamento da apuração do TSE em três telas: **TV** (`/`), **Corrida** (`/corrida.html`) e
**Território** (`/territorio.html`). Um servidor Node que lê os arquivos públicos do TSE, grava
cada leitura aceita e sabe reproduzir a apuração de qualquer instante.

## Calendário — isto tem data marcada

| quando | o quê |
|---|---|
| 23 e 24/09/2026, 9h–12h e 14h–17h | últimas janelas de simulado do TSE |
| **4/10/2026, a partir das 16h** | 1º turno |
| **25/10/2026, a partir das 16h** | 2º turno |

**O que não for coletado na hora não se recupera.** O TSE substitui o arquivo a cada atualização;
não há histórico do lado deles (o único publicado é o da presidência de 2022, em
`data/Historico_Totalizacao_Presidente_BR_1T_2022.csv`). Se o servidor estiver fora do ar durante
uma janela, aquele trecho da apuração deixa de existir para sempre.

Antes de cada janela, confirmar: servidor no ar (`npm run dev`), `curl /api/health` e
`curl /api/diagnostico` respondendo, e o TSE alcançável.

## As três regras que não se negociam

1. **100 requisições por segundo por IP** é o limite do TSE, e quem passa é bloqueado no meio da
   apuração, sem aviso. O teto está preso em `server/transport.ts` (`TSE_CEILING`), o padrão é 80,
   e a conta do pior caso (73,9 req/s) está em `tests/gravacao.test.ts`. Toda requisição do
   runtime passa pelo balde de fichas — os únicos `fetch()` crus são os dois scripts manuais de
   importação. **Não abrir caminho novo fora do balde.**
2. **Nada na tela afirma resultado que o TSE não publicou.** Quem senta numa cadeira é quem ele
   elege; a projeção de bancada (`src/lenses/tv/bancadas.ts`) existe só enquanto não há eleito, é
   marcada com til e some quando a situação publicada chega.
3. **Gravação é sagrada.** `data/recordings/` é o que o replay reproduz e não se refaz.

## Onde as coisas estão

```
src/lenses/tv/         a TV: main, style, fita (player de replay), bancadas (projeção)
src/lenses/corrida/    grafico (a tela), estilo, cores, fichas (as folhas), escala, som
src/lenses/territorio/ main, geo (malha), data (municipal), cores, busca, styles
src/shell/             dados (de qual apuração falamos + API), shell (cabeçalho), player,
                       row, tabela, escala
src/domain/            derive (ranking e situação), format (texto e números), seats
server/                collector, transport, tse, archive, municipal, recorder, compress, index
shared/                types (o contrato do fio) e windows (o calendário do TSE)
```

## Convenções

- **Comentários explicam por quê, não o quê**, e em português. Os que valem são os que contam a
  decisão e o que aconteceu quando era diferente. Se um comentário só reescreve a linha, ele sai.
- **CSS mora em template literal** (`estilo.ts`, `style.ts`, `styles.ts`). **Crase dentro de
  comentário de CSS quebra o literal** — esse erro derrubou o build umas cinco vezes numa sessão.
  Escreva o comentário sem crase.
- **Sem `any`.** `npx tsc --noEmit` tem de passar.
- Testes em português, nomeando o comportamento: `test('quem não alcança o quociente fica de fora')`.

## O ritual de verificação

```bash
npx tsc --noEmit
npm test               # 160 testes de conta, sem rede nem navegador
npm run test:telas     # 29 verificações nas três telas (precisa do npm run dev no ar)
npm run build
npm run baseline -- check   # só o relógio pode mudar; o resto é regressão
```

Mudou layout de propósito? `npm run baseline` regrava a referência. As imagens ficam fora do
versionamento — são artefato da máquina que as gerou.

## Armadilhas que já custaram caro

- **Não derrube o servidor com `pkill -f "bin/vite"`**: há outro projeto (`/data/Documents/bussola`)
  rodando vite na mesma máquina, e ele morre junto. Mate por PID, ou por caminho completo.
- **`.gitignore` com `data/` sem barra inicial** também casava com `public/data/` e deixava a malha
  de municípios fora do clone. As regras são ancoradas na raiz.
- **Verificar orientação de mapa pela geometria construída**, não pelas coordenadas cruas: o
  `rotateX(-90°)` inverte o sinal, e "conferi e está certo" olhando o dado de entrada já resultou
  em Minas de cabeça para baixo.
- **`all: unset` depois de `position`** zera a posição. Vem primeiro.
- **Um `padding` curto declarado depois de um `padding-top` longo** apaga o recuo do cabeçalho
  fixo, e a tela desliza para debaixo da barra.

## Pendências conhecidas

- **O TSE está bloqueando este IP** (23/09): `resultados.tse.jus.br` não abre nem a porta 443;
  `www` e `dadosabertos` devolvem 403 do Akamai. É o que faz as fotos dos candidatos sumirem das
  telas. Provável causa: ~14 GB baixados do CDN deles no mesmo dia, não a taxa de requisição.
  **Testar antes de 4/10** e, se persistir, trocar de rede. `GET /api/diagnostico` responde o pico
  real de req/s desde que o processo subiu.
- **As gravações de 17 e 22/09 têm só Minas.** `RECORD_UFS=ALL` entrou depois delas; a partir de
  23/09 as janelas gravam os 27 estados.
- **Não existe série de 2022 para governador, senado e deputados**, e não dá para reconstruir: os
  boletins de urna trazem o relógio do *fechamento* (74% das seções fecham até 17h05), não o da
  totalização. Há um arquivo de terceiro com a série da **presidência em Minas**
  (github.com/wcota/br_eleicoes_2022_1T, 93 instantes com `date_totalizacao`, e o total final bate
  com o nosso) — importável se quiserem, marcando a procedência.
- **`mapColors` (Território) não cumpre a promessa a partir de 4 partidos**: a restrição de cores
  vizinhas fica insatisfatível e ele aceita um par próximo. Está documentado no código como
  preferência declarada, não como bug silencioso.
- **`grafico.ts` (819 linhas) e `territorio/main.ts` (747)** ainda têm uma função `main` longa
  demais. O que dava para extrair com segurança já saiu; o resto mexe em código que desenha pixel
  e pede a baseline aberta ao lado.
