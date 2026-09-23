# Pulso Eleitoral

**Acompanhe a eleição de 2026 pelo Pulso** — a apuração do TSE em três telas: **TV**, **Corrida** e
**Território**. Os dados vêm dos arquivos públicos do TSE, chegam segundo a segundo e ficam
gravados no seu disco: dá para voltar a apuração e assistir de novo. Nada aqui é projeção.

![TV](docs/img/tv.png)

## Rodar

Precisa de **Node 22.12+**.

```bash
git clone https://github.com/bruno-baeta/pulso-eleitoral.git
cd pulso-eleitoral
npm install
npm run dev
```

Abra **http://127.0.0.1:5173**. Isso sobe duas coisas: a API em `127.0.0.1:3001` e as telas em `5173`.

> O servidor de desenvolvimento escuta em `0.0.0.0`, de propósito: é o que permite abrir a tela TV
> na televisão da sala pelo IP da máquina. Numa rede que você não controla, troque o script `dev`
> para `vite` sem `--host`. A API já escuta só em `127.0.0.1`.

Para escolher o que ver, use o cabeçalho — ou a URL:

```
http://127.0.0.1:5173/?mode=historico&uf=MG&turn=1
```

| parâmetro | valores |
|---|---|
| `mode` | `historico` (resultado final de 2022), `simulado` (testes do TSE), `official` (eleição de 2026) |
| `uf` | sigla do estado (`MG`, `SP`, …) |
| `turn` | `1` ou `2` |

Produção:

```bash
npm run build     # typecheck + bundle + brotli/gzip
npm start         # serve a API e as telas já construídas
```

## As telas

### TV — as cinco disputas de uma vez

Presidente, governador e senado como lista de quem está na frente; deputados federais e estaduais
como bancadas e os mais votados. O rodapé passa o fio da noite: viradas, eleitos, marcos de
apuração. O botão **TV** joga na tela cheia, sem a barra do aplicativo.

![TV em tela cheia](docs/img/tv-cheia.png)

Clicar no título de uma disputa abre a tabela inteira, com busca; clicar num nome abre as cidades
onde aquela candidatura foi votada.

![Tabela da disputa](docs/img/tabela.png)

Na lateral direita fica o player: início, tocar, pausar, a velocidade (1×, 60×, 100×) e o ao vivo.
Ele reproduz a apuração gravada no disco, minuto a minuto.

### Corrida — como cada disputa chegou até aqui

![Corrida](docs/img/corrida.png)

### Território — onde cada candidatura ganhou

![Território](docs/img/territorio.png)

## Como os dados chegam

- O coletor lê os arquivos do TSE e guarda cada atualização aceita em `data/recordings/`
  (um NDJSON por disputa e sessão). É isso que o player reproduz.
- Nas janelas do TSE — os testes de setembro e as noites de 4 e 25 de outubro de 2026 — ele coleta
  e grava **os 27 estados** sozinho, mesmo sem navegador aberto. O que não for buscado na hora não
  se recupera depois: a apuração já passou.
- O TSE permite **100 requisições por segundo por IP**, e o código trava nesse teto. A conta de uma
  noite de eleição, com os 27 estados sendo gravados e o mapa municipal varrendo o país:

  | de onde vem | req/s |
  |---|---|
  | 26 estados gravados (5 cargos a cada 15 s) | 8,7 |
  | o estado que está na tela (5 cargos a cada 1 s) | 5,0 |
  | arquivo de andamento | 0,2 |
  | municípios, em fila de baixa prioridade | 60,0 |
  | **total** | **73,9 de 100** |

  A fila municipal só usa a folga deixada pelas disputas, e um 404 dela — município que ainda não
  publicou — não pausa a coleta. Rodar duas instâncias atrás do mesmo IP dobra a conta.
- Fora das janelas, o simulado não é consultado: a tela abre a última sessão gravada, em replay.

Configuração opcional em `.env` — veja `.env.example`.

## Desenvolvimento

```bash
npm test          # testes unitários (node:test)
npm run typecheck # tsc --noEmit
npm run baseline  # compara as telas com as imagens de referência
```

Estrutura:

```
src/lenses/tv/        a tela TV
src/lenses/territorio/ o mapa municipal
src/raias/            a tela Corrida
src/shell/            cabeçalho, player, tabela — o que as três compartilham
src/domain/           ranking, situação do candidato, formatação
server/               coletor do TSE, gravação, replay e a API
shared/               o contrato entre os dois lados
```

## Licença

MIT.
