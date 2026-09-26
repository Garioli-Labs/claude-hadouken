# claude-hadouken v0.2.0 — barra bonita (design)

Data: 2026-09-26. Pedido do Sr. Garioli, já usando a v0.1.0: "as porcentagens em barrinhas" e "tudo mais bonitinho". Decisões tomadas na conversa de 2026-09-26 (seção 3). Base: spec da v0.1.0, `2026-09-25-leitor-de-consumo-design.md`, que continua valendo em tudo o que esta não muda.

## 1. Objetivo e critérios de sucesso

A barra de status e o `/consumo` em markdown ficam mais fáceis de ler de relance, sem ler dado novo nenhum e sem ficar mais lentos.

Pronto quando:

1. A barra mostra 5h, 7d, ctx e cache com quadradinhos de 8 casas, e a 7d com a marca do ritmo (seção 4).
2. ctx e cache ganham cor por faixa; 5h e 7d seguem com as faixas da v0.1.0 (seção 5).
3. O `/consumo` em markdown tem o painel de limites com barrinhas, números alinhados e legíveis, a coluna "parte do total" e nomes curtos (seção 6).
4. A saída `--json` do `/consumo` é idêntica byte a byte à da v0.1.0 para os mesmos dados (teste de referência).
5. As metas de p95 da v0.1.0 (spec v0.1.0 §9) seguem cumpridas, medidas de novo: Windows na máquina parada, Linux e macOS no job `bench` do CI.
6. Sessões simultâneas (seção 12): a barra mostra quantas sessões estão ativas e a previsão de estouro da janela, os avisos ao Claude levam a previsão em conta e o `/consumo` mostra a parte de cada sessão aberta na última hora.
7. A regressão inteira passa em Windows, Linux e macOS com Node 20 e 24; revisão final de qualidade e de segurança (Fable) sem achado aberto.

## 2. Fora de escopo

- Qualquer dado novo, leitura nova ou mudança no `--json`, exceto o que a seção 12 define (histórico curto das leituras de limite no estado e a tabela de sessões abertas, que entra no `--json` como chave nova).
- Mudança nas faixas de 5h e 7d, nos avisos ao Claude ou nos limiares de alerta.
- Descobrir a largura do terminal (a statusline recebe o stdout em pipe; a largura não chega) e cortar a linha para caber.
- Modo ASCII para terminais sem Unicode: a v0.1.0 já usa `│` e `↻`; a v0.2.0 não piora esse requisito.
- Temas ou glifos configuráveis.
- WhatsApp (v0.3.0) e os subprojetos B, C e D.

## 3. Decisões do Sr. Garioli (2026-09-26)

| Pergunta | Decisão |
|---|---|
| Estilo da barrinha | Quadradinhos `▰`/`▱`, 8 casas |
| Quais indicadores | Os quatro: 5h, 7d, ctx e cache |
| Marca do ritmo | Sim, na 7d: tracinho `┃` entre as casas |
| Cores | Como hoje: o trecho inteiro na cor da faixa; ctx e cache ganham faixas |
| `/consumo` | Painel com barrinhas, números alinhados e legíveis, coluna "parte do total", nomes curtos |
| "Parte do total" mede | Tokens totais do período (entrada + cache criado + cache lido + saída) |

## 4. A barrinha (`src/barrinha.js`, puro)

Uma casa só para a regra; a barra e o relatório a importam. Nenhum outro arquivo de `src/` define os glifos nem a conta (guarda em `test/casa-unica.test.js`).

```
barrinha(pct, { marca } = {}) -> string | null
```

- `CASAS = 8`; cada casa vale 12,5 pontos. `CHEIA = '▰'`, `VAZIA = '▱'`, `MARCA = '┃'`.
- `pct` fora de `[0, 100]` ou não finito: devolve `null` (quem chama mostra `—`, como hoje).
- Casas cheias: `Math.round(pct / 12.5)`, com duas travas:
  - `pct >= 1` e o arredondamento dá 0: 1 casa (uso visível nunca some);
  - `pct < 100` e o arredondamento dá 8: 7 casas (barra cheia só com 100%).
- Exemplos: 0 → `▱▱▱▱▱▱▱▱`; 0,5 → `▱▱▱▱▱▱▱▱`; 1 → `▰▱▱▱▱▱▱▱`; 42 → `▰▰▰▱▱▱▱▱`; 59 → `▰▰▰▰▰▱▱▱`; 92 → `▰▰▰▰▰▰▰▱`; 99 → `▰▰▰▰▰▰▰▱`; 100 → `▰▰▰▰▰▰▰▰`.
- `marca` (opcional, o esperado do ritmo, 0–100): o `┃` entra na fronteira `k = Math.round(marca / 12.5)` (0 a 8), isto é, depois das `k` primeiras casas. A barrinha com marca tem 9 colunas. `marca` inválida: sai sem marca.
- Exemplos com marca 61 (`k = 5`): usado 59 → `▰▰▰▰▰┃▱▱▱`; usado 40 → `▰▰▰▱▱┃▱▱▱`; usado 80 → `▰▰▰▰▰┃▰▰▱`. Marca 0 → `┃▱▱▱▱▱▱▱▱`; marca 100 → `▰▰▰▰▰▰▰▰┃` com usado 100.
- Os três glifos são de largura 1 (East Asian Width neutra, bloco Geometric Shapes e Box Drawing), como `│` e `↻` já usados.

## 5. Barra de status (`src/formato.js`)

Formato da linha (com cor desligada; exemplo real de largura):

```
Opus 5.5·high │ 5h ▰▰▰▱▱▱▱▱ 42% ↻15:30 │ 7d ▰▰▰▰▰┃▱▱▱ 59%/61% ↻seg 22:00 │ ctx ▰▰▰▱▱▱▱▱ 37% │ cache ▰▰▰▰▰▰▰▱ 92%
```

- Cada indicador: `rótulo barrinha número`, e o resto do trecho como na v0.1.0 (reset, `usado/esperado`, rótulo de modo da 7d: ` folga`, ` econ`, ` só leitura`).
- A barrinha usa o mesmo valor que o número mostra antes do piso (5h, 7d e ctx em pontos; cache = `hit_ratio × 100`).
- 7d: `marca` = `esperado` de `faixa7d`. 5h não tem marca (a janela de 5 h não tem ritmo).
- Indicador inválido: sem barrinha, `5h —` como hoje.
- Cores: como na v0.1.0, o trecho inteiro na cor da faixa (barrinha incluída). As faixas de 5h e 7d não mudam. Faixas novas, só visuais (não geram aviso nem mudam `alerta.js`):

| Indicador | verde | amarelo | vermelho |
|---|---|---|---|
| ctx | abaixo de 70% | 70% a 84% | 85% ou mais |
| cache | 80% ou mais | 50% a 79% | abaixo de 50% |

  Os limites comparam o valor exibido (piso inteiro), para a cor nunca contradizer o número. As faixas ficam em constantes de `formato.js` (casa única).
- `NO_COLOR`: barrinhas ficam, cores saem.
- Largura: a linha passa de cerca de 75 para cerca de 100 colunas (nome de modelo de até 40 pode passar disso). Risco aceito na decisão; registrado no README.
- Separadores e modelo: `GLIFOS_BARRA` passa a incluir `▰`, `▱` e `┃`, para um nome de modelo não forjar barrinhas nem marcas (seção 7).

## 6. `/consumo` em markdown (`src/relatorio.js`)

O `--json` não muda. Tudo abaixo é só a renderização markdown.

### 6.1 Painel de limites

A seção "Limites e ritmo" vira um bloco de código com as barrinhas (bloco de código porque o markdown não alinha espaços fora dele):

```
5h  ▰▱▱▱▱▱▱▱  11%        reset 17:50      normal
7d  ▰▰▰▰▰┃▱▱▱  62% / 66%  reset seg 22:00  normal
```

As colunas são alinhadas por preenchimento com espaços; a linha "Leitura de N min atrás." e o caso sem leitura ficam como na v0.1.0. Todos os valores do bloco são números validados e rótulos do código: nenhum dado externo entra nele.

### 6.2 Números

- Colunas numéricas alinhadas à direita (`---:`).
- Inteiros com milhar separado por espaço: `19 628`.
- Tokens: até 999 → inteiro; k sem casa (`13k`); M com uma casa (`1,1M`); a partir de 999,95M → G com duas casas (`2,98G`). Vírgula decimal.
- Porcentagens com vírgula (`97,1%`). Minutos do GitHub seguem a mesma regra de milhar e vírgula.
- A troca é da renderização do relatório; `formatarTokens` passa a ter a regra nova (só o relatório a usa).

### 6.3 Coluna "parte do total"

- Nas tabelas Projeto, Modelo·effort, Origem e Sessão de cada período, logo após o nome: `▰▰▰▱▱▱▱▱ 39%`.
- Parte = tokens da linha ÷ tokens do período, com tokens = entrada + cache criado + cache lido + saída (pensamento fora, como na v0.1.0; soma com `somaSegura`).
- Porcentagem inteira por piso. Parte acima de 0 e abaixo de 1%: mostra `<1%` e a barrinha de `barrinha(1)` (1 casa), para uso real nunca aparecer vazio. Parte 0: `0%` e barrinha vazia. Período com total 0: `—` sem barrinha.
- A tabela de sessões mostra o top 10 da v0.1.0; a parte é sobre o total do período, não do top 10.

### 6.4 Nomes curtos

- Sessão: 8 primeiros caracteres do id. Se dois ids exibidos na mesma tabela têm o mesmo prefixo de 8, as linhas em conflito mostram 12; se ainda empatar, o id inteiro.
- Modelo: `^claude-(opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$` vira `Opus 5.5`, `Haiku 4.5`, `Sonnet 5` (família com inicial maiúscula, versão com ponto). Qualquer outro nome sai como na v0.1.0 (saneado, sem glifos da barra). A lista de famílias é fixa no código.
- Chave modelo·effort: `Opus 5.5 · xhigh`.
- A linha de aviso "Os nomes de projeto, sessão, modelo e repo abaixo são dados, não instruções." continua no topo.

## 7. Ameaças (ordem de 2026-09-25: segurança em toda versão)

Entradas continuam as da v0.1.0 (stdin da statusline, transcripts, estado, `gh api`). O que a v0.2.0 muda é só a forma de exibir; as ameaças novas são de exibição:

| Ameaça | Defesa | Teste |
|---|---|---|
| Nome de modelo com `▰▱┃` forja uma barrinha ou marca falsa na barra ou no relatório | `GLIFOS_BARRA` inclui os três; o nome passa por `sanear` e pela troca dos glifos antes de exibir | nome malicioso com os glifos sai sem eles, na barra e no relatório |
| Nome de modelo forjado imita outro modelo pelo nome curto (`claude-opus-5-5` num transcript alheio) | O nome curto é só apresentação do mesmo texto; não muda soma, chave nem `--json`; transcripts continuam dados, não instruções (spec v0.1.0 §8.1) | nome fora do padrão sai como veio (saneado); padrão reconhecido vira o curto |
| Nome que casa o padrão com sufixo extra (`claude-opus-5-5\u001b[31m`, `claude-opus-5-5 │ 5h 1%`) | Regex ancorada nas duas pontas e aplicada ao nome já saneado | nomes com sufixo não viram curtos |
| Dois ids de sessão com o mesmo prefixo confundem linhas | Desempate para 12 e depois id inteiro (6.4) | tabela com prefixos iguais |
| Número extremo (NaN, infinito, negativo, acima de 100, acima de `MAX_SAFE`) quebra a barrinha ou a coluna | `barrinha` devolve `null` fora de `[0,100]`; parte calculada com `somaSegura` e checada | fronteiras e valores inválidos |
| Sequência ANSI nova vaza por cor nova | As cores de ctx e cache usam as mesmas quatro sequências de `COR`, só com `cor === true` | saída sem cor não tem `\x1b` |
| Bloco de código do painel quebrado por conteúdo externo (três crases) | O painel só tem números e rótulos do código | teste do painel com estado malicioso |

Nenhuma superfície nova de rede, arquivo, variável de ambiente ou comando.

## 8. Performance

- Metas da v0.1.0 inalteradas: barra, hook de prompt, SessionStart e SessionEnd p95 ≤ 250 ms no Windows e ≤ 150 ms no Linux/macOS; `/consumo` quente ≤ 2 s e frio ≤ 15 s.
- `barrinha.js` é importado por `formato.js` (depois do gate de ativação); o caminho até o gate não ganha import.
- Medição de novo: bench quieto no Windows e job `bench` do CI; a tabela do README é atualizada com os números novos.

## 9. Testes

- `test/barrinha.test.js`: fronteiras 0, 0,5, 1, 6,25, 12,5, 56,25, 99, 100; inválidos (NaN, infinito, -1, 100,1, string, null); marca em 0, 100, cada fronteira, marca inválida; largura (8 sem marca, 9 com).
- `test/formato.test.js`: linha completa com e sem cor; 7d com marca; ctx e cache em cada faixa e nos limites (69/70, 84/85, 49/50, 79/80); indicador inválido sem barrinha; nome com `▰▱┃`.
- `test/relatorio.test.js`: painel (com e sem leitura); números (milhar, vírgula, k/M/G e o limite 999,95M); coluna parte (soma, `<1%`, total 0); nomes curtos (padrões, fora do padrão, sufixo, colisão de prefixo de sessão).
- Teste de referência do `--json`: mesmos dados de entrada, saída igual à da v0.1.0 (fixture gerada com a v0.1.0 e versionada).
- `test/casa-unica.test.js`: glifos e conta da barrinha só em `barrinha.js`; faixas de ctx e cache só em `formato.js`.
- CI: a matriz e os gates da v0.1.0, sem mudança.

## 10. Entrega

- `package.json` e `.claude-plugin/*.json` em 0.2.0.
- README (PT e EN): exemplo da barra novo, faixas de ctx e cache, largura, tabela de desempenho remedida. Registro de mudanças na release.
- Tag `v0.2.0` e release no GitHub. Quem tem a v0.1.0 instalada atualiza pelo `/plugin`. O gate de ativação não muda: sessão que não passou pelo SessionStart do plugin continua sem barra. Se uma sessão já registrada passa a mostrar o visual novo logo após a atualização (a `statusLine` aponta para o shim, que aponta para o cache do plugin) é verificado no teste de ponta a ponta da release e registrado no README; a mudança é só visual e não altera dados nem estado.

## 12. Sessões simultâneas (adendo de 2026-09-26)

Pedido do Sr. Garioli: "O plugin precisa considerar todas as sessões em aberto naquele momento no VS Code pra calcular melhor as estimativas." Ele escolheu as quatro partes abaixo.

Fato que orienta o desenho: as porcentagens de 5h e 7d que o Claude Code entrega já são da conta inteira, somando todas as sessões (VS Code ou qualquer outro lugar), e o estado do plugin já guarda a leitura mais recente de qualquer sessão. O que não olha as outras sessões hoje é a estimativa: o "esperado" de 7d é uma régua de tempo, não uma previsão pelo ritmo real. O plugin não distingue sessões do VS Code das de outro terminal; conta todas as sessões do Claude Code da máquina que passaram pelo gate de ativação.

### 12.1 Sessão ativa

- Ativa = sessão registrada (gate de ativação, spec v0.1.0 §8.2) cujo registro em `estado.sessoes` tem `at` nos últimos 5 minutos. O `at` é renovado pela barra a cada atualização, isto é, sempre que a sessão trabalha; sessão parada sai da conta em 5 minutos.
- Limite: sessões abertas antes da instalação não passam pelo gate e não entram na contagem (o consumo delas continua dentro das porcentagens da conta, e a previsão, que vem das porcentagens, as inclui). O README diz isso.
- A contagem nunca passa de 50 (o teto de `estado.sessoes`).

### 12.2 Histórico curto das leituras

- `estado.json` ganha `historico`: lista de `{ at, h5, d7 }` (instante ISO, `used_percentage` de 5h e de 7d, cada um número válido ou null) com no máximo 1 ponto a cada 2 minutos e no máximo 90 pontos (3 horas). Ponto novo só entra com leitura válida de agora; ponto com `at` no futuro (mais de 5 min) ou mais velho que 3 h é descartado na validação.
- Troca de janela (o `resets_at` da janela mudou ou a porcentagem caiu mais de 1 ponto) zera o histórico daquela janela: a previsão nunca mistura duas janelas.
- Schema validado na leitura como o resto do estado (spec v0.1.0 §6.2); histórico inválido vira lista vazia, sem erro.

### 12.3 Previsão de estouro

- Velocidade de consumo = inclinação por mínimos quadrados da porcentagem contra o tempo:
  - 5h: pontos dos últimos 20 minutos;
  - 7d: pontos das últimas 3 horas.
- Só calcula com pelo menos 3 pontos cobrindo pelo menos 6 minutos; inclinação ≤ 0 ou não finita → sem previsão.
- Previsão = agora + (100 − porcentagem atual) ÷ inclinação. Só aparece se cair antes do reset da janela (senão o reset chega primeiro e não há o que avisar).
- Na barra, dentro do trecho da janela, depois do reset: `→100% 14:40` (hora local), na cor vermelha da faixa. Exemplo: `5h ▰▰▰▰▰▰▱▱ 74% ↻15:30 →100% 14:40`. O glifo `→` tem largura 1; `⚠` foi descartado porque alguns terminais do Windows o desenham com largura 2.
- A previsão usa as porcentagens da conta, então já inclui o consumo de todas as sessões, registradas ou não.

### 12.4 Número de sessões ativas na barra

- Trecho novo logo depois do modelo: `3 sessões` (ou `2 sessões`). Com 1 sessão ativa (a própria) o trecho não aparece, para não gastar largura com o óbvio.
- Sem cor. O número vem da contagem da 12.1, nunca de dado externo.

### 12.5 Avisos ao Claude

- Aviso novo, `projecao`, na mesma linha fixa dos avisos da v0.1.0 (só números e texto do código):
  - dispara quando a previsão de 5h fica a 60 minutos ou menos e antes do reset; de novo quando fica a 30 minutos ou menos;
  - texto: `hadouken: no ritmo atual (3 sessões ativas), 5h chega a 100% às 14:40, antes do reset das 15:30. Reduza o paralelismo ou serialize.`; com 1 sessão, sem o parêntese;
  - para 7d: dispara quando a previsão cai antes do reset e a 24 horas ou menos, com o mesmo texto para 7d.
- Deduplicação como os avisos existentes: cada faixa (60, 30, 7d) dispara uma vez por janela e sessão; a previsão sair de faixa e voltar não repete o mesmo aviso na mesma janela.
- Os avisos de faixa da v0.1.0 (70/80/90 e ±10 pontos) não mudam.

### 12.6 Parte de cada sessão no `/consumo`

- Seção nova, "Sessões abertas (última hora)", antes dos períodos: cada sessão com resposta nos últimos 60 minutos (transcripts já indexados; subagentes somados à sessão mãe), com id curto (6.4), projeto, modelos, tokens da última hora e a parte do total com barrinha (6.3).
- No `--json`, chave nova `sessoesAbertas` (lista com id completo, projeto, modelos, tokens, parte); as chaves da v0.1.0 continuam idênticas, e o teste de referência passa a comparar só elas.

### 12.7 Ameaças da seção 12

| Ameaça | Defesa | Teste |
|---|---|---|
| `estado.json` adulterado com histórico falso (pontos demais, datas no futuro, porcentagens fora de 0–100) para forjar uma previsão ou travar a barra | Validação na leitura: no máximo 90 pontos, `at` dentro de [agora − 3 h, agora + 5 min], porcentagens em [0, 100]; o resto é descartado | histórico malicioso vira lista vazia ou é podado |
| Sessões falsas em `estado.sessoes` inflando a contagem | Mesma validação de id e teto de 50 da v0.1.0; o número só aparece como inteiro | contagem nunca passa de 50; id inválido não conta |
| Inclinação absurda (divisão por quase zero, relógio andando para trás) mostra hora sem sentido | Mínimo de 3 pontos em 6 minutos; inclinação ≤ 0 ou não finita descartada; previsão só se antes do reset | casos de borda |
| Texto do aviso levando dado externo ao Claude | Aviso montado só com números validados e texto fixo | aviso com estado malicioso só tem números |
| Nome de projeto ou modelo na tabela de sessões abertas | Mesma limpeza das outras tabelas (sanear, glifos da barra, nomes curtos) | nome malicioso sai limpo |

### 12.8 Performance

- A barra passa a gravar o histórico no mesmo `estado.json` que já grava a cada atualização; o arquivo cresce em cerca de 5 KB. O cálculo da previsão é linear em no máximo 90 pontos.
- As metas de p95 da seção 8 valem com o histórico cheio (90 pontos) e 50 sessões no estado; o bench passa a medir esse pior caso.

## 11. Estrutura

```
src/barrinha.js          novo, puro
src/formato.js           barrinhas, faixas de ctx e cache
src/util.js              GLIFOS_BARRA ampliado, formatarTokens com a regra nova
src/relatorio.js         painel, números, parte do total, nomes curtos, sessões abertas
src/estado.js            histórico curto das leituras
src/previsao.js          novo, puro: inclinação e previsão de estouro
src/alerta.js            aviso projecao
test/barrinha.test.js    novo
test/fixtures/consumo-v0.1.0.json   referência do --json
```
