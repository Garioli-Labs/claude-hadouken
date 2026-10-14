# Visual e design system — tipografia, cor, layout, motion e tokens
Dupla função: cada seção traz **os valores a usar** (criação) e **o sinal de que está errado** (auditoria). Todo número carrega fonte com URL. O que é convenção de indústria sem estudo controlado está marcado **[convenção]**.
## Índice
1. [Tipografia](#1-tipografia) · 2. [Cor](#2-cor) · 3. [Layout e espaçamento](#3-layout-e-espaçamento) · 4. [Ícones e imagem](#4-ícones-e-imagem) · 5. [Motion](#5-motion) · 6. [Design tokens](#6-design-tokens) · 7. [Sistemas de referência](#7-sistemas-de-referência) · 8. [Sinais de inconsistência numa auditoria](#8-sinais-de-inconsistência-numa-auditoria) · 9. [Por que design systems falham](#9-por-que-design-systems-falham)
## 1. Tipografia
### 1.1 Escalas modulares — qual razão usar
| Razão | Nome | Caráter | Usar quando |
|---|---|---|---|
| 1.125 | Segunda maior | Muito compacta | Dashboard, admin, tabela densa |
| **1.2** | Terça menor | Compacta | **Default mais seguro para UI de produto** |
| 1.25 | Terça maior | Equilibrada | Produto + marketing no mesmo sistema |
| 1.333 | Quarta perfeita | Dramática | Editorial, landing page |
| 1.5 | Quinta perfeita | Muito dramática | Só hero/títulos — 16→24→36→54 e acabou |
| 1.618 | Áurea | Extrema | Pôster, capa. Inviável como escala de UI |

Tamanhos a partir de base 16px:

| Degrau | −1 | 0 | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|---|---|
| **1.125** | 14.2 | 16 | 18 | 20.3 | 22.8 | 25.6 | 28.8 |
| **1.2** | 13.3 | 16 | 19.2 | 23.0 | 27.6 | 33.2 | 39.8 |
| **1.25** | 12.8 | 16 | 20 | 25 | 31.3 | 39.1 | 48.8 |
| **1.333** | 12.0 | 16 | 21.3 | 28.4 | 37.9 | 50.5 | 67.3 |
Regra: **razão menor em telas pequenas, maior em telas grandes** — é o que a escala fluida entrega. **[convenção]** — a escolha da razão é decisão estética disciplinada, não resultado de estudo comparativo.
**Sinal de erro:** tamanhos fora de qualquer progressão (17, 18, 19, 21, 22 na mesma página); mais de 8 tamanhos distintos numa página.
### 1.2 Tipografia fluida com `clamp()`
Interpola linearmente entre (viewport mín., tamanho mín.) e (viewport máx., tamanho máx.), eliminando saltos e a explosão de media queries. `slope = (tamMax − tamMin)/(vwMax − vwMin)`; `interseccao = tamMin − slope × vwMin`; `clamp(minRem, interseccaoRem + slopeVw, maxRem)`.
```css
:root {
  --step-0: clamp(1.125rem, 1.0714rem + 0.1429vw, 1.25rem);  /* 18px @600 → 20px @1200 */
  --step-1: clamp(1.406rem, 1.339rem  + 0.179vw,  1.563rem);  /* razão 1.25 */
  --step-2: clamp(1.758rem, 1.674rem  + 0.223vw,  1.953rem);
}
```
O padrão canônico (Utopia): definir **duas escalas completas** — uma no viewport mínimo com razão menor, outra no máximo com razão maior — e gerar o `clamp()` de cada degrau. Exemplo do próprio calculador: viewport 600→1200, base 18→20px, razão 1.2→1.25.
Fonte: Utopia — https://utopia.fyi/type/calculator/ · https://utopia.fyi/blog/clamp/
**Armadilha de acessibilidade (P0):** um `clamp()` com termo médio **puramente em `vw`** impede o zoom de texto e viola WCAG 1.4.4. O termo médio precisa sempre somar um componente em `rem`.
**Sinal de erro:** `font-size: 4vw`; `clamp(1rem, 2vw, 2rem)` (sem `rem` somado no meio).
### 1.3 Tamanho mínimo de corpo — a evidência
Não existe número validado por um estudo único; existe convergência de três origens independentes:

| Origem | Evidência | Força |
|---|---|---|
| GOV.UK | 19px desktop / 16px mobile como corpo, testado com o público mais amplo possível | Forte (produção, público não autosselecionado) |
| NN/g + MIT AgeLab | Tamanhos maiores superaram menores com significância (p<0.01); texto condensado exigiu **11,2% mais tempo** que largura regular | Média — decisão lexical, não leitura corrida |
| WCAG 1.4.8 / Baymard | Teto de 80 caracteres/linha; Baymard recomenda 50–75 | Normativa (AAA) + convenção |
Fonte: NN/g — https://www.nngroup.com/articles/glanceable-fonts/ · GOV.UK — https://designnotes.blog.gov.uk/2018/02/19/developing-new-typography-and-spacing-for-gov-uk-frontend/ · Baymard — https://baymard.com/blog/line-length-readability

| Papel | Corpo em produto | Corpo em conteúdo lido de fato | Metadados, legenda | Abaixo de 12px |
|---|---|---|---|---|
| Valor | **≥16px — piso absoluto** | **17–19px — alvo** | 14px, nunca corpo | Não usar |
**Sinal de erro:** corpo ≤15px; `font-size` em px que não responde ao zoom.
### 1.4 Altura de linha por tamanho
Relação **inversa** — quanto maior o texto, menor o multiplicador.

| Papel | Display | Headline | Title | **Corpo** | Legenda / meta | Corpo em coluna larga |
|---|---|---|---|---|---|---|
| Tamanho | 48–72px | 32–44px | 20–28px | 16–19px | 12–14px | 16–19px |
| `line-height` | 1.0–1.1 | 1.1–1.2 | 1.25–1.35 | **1.5–1.6** | 1.4–1.5 | 1.6–1.7 |
Racional: no display o espaço entre linhas já é grande em px absolutos; no corpo, WCAG 1.4.12 exige suportar 1.5× forçado; em coluna larga o multiplicador maior compensa o retorno de linha longo.
WCAG 1.4.12 (Text Spacing, AA) exige que o conteúdo **não quebre** com `line-height` 1.5×, parágrafo 2×, `letter-spacing` 0.12em e `word-spacing` 0.16em — é o teste que quebra praticamente todo componente de altura fixa.
**Sinal de erro:** `line-height: 1.2` no corpo; um `line-height` global de 12px a 64px; container com `height` fixa contendo texto.
### 1.5 Comprimento de linha e a origem honesta da regra 45–75
| Valor | Origem | Força |
|---|---|---|
| **50–75 caracteres** (alvo) | Baymard, citando Emil Ruder (tipógrafo suíço, anos 1960) | **Fraca como número exato** — convenção tipográfica consolidada, não experimento controlado **[convenção]** |
| **≤80 caracteres** (teto) | WCAG 1.4.8 Visual Presentation | Normativa, mas **AAA** — não exigível em conformidade AA |

O que **tem** suporte comportamental e é o achado que importa: usuários percebem linhas muito longas como *"intimidating and overwhelming"* e **abandonam a leitura por completo**, saindo da página. Não é falha de compreensão, é de disposição — esse efeito é mais defensável do que qualquer número específico de caracteres. Linha curta demais tem o defeito oposto: o olho retorna com frequência excessiva e induz a pular palavras.
Fonte: Baymard — Readability: The Optimal Line Length — https://baymard.com/blog/line-length-readability
Implementação: `max-inline-size: 65ch`. A unidade `ch` mede a largura do glifo "0" da fonte corrente e se auto-ajusta na troca de fonte, ao contrário de `max-width` em px. Em textos que misturam famílias é aproximação — ainda assim a melhor unidade disponível.
**Sinal de erro:** parágrafo ocupando 1440px inteiros (≈180 caracteres); `max-width` de texto em px; bloco de conteúdo sem limite de largura.
### 1.6 Hierarquia
Funciona por contraste em eixos independentes: tamanho, peso, cor/valor, caixa, espaçamento, família. **Regra: dois eixos, não cinco.** Um H2 maior, mais pesado, mais escuro, mais espaçado *e* de outra família não comunica cinco vezes mais — comunica ruído. **[convenção]**
Pareamento: uma família com boa gama de pesos resolve a maioria dos casos e é a escolha de menor risco; se parear, contraste **categoria** (serifada + sem serifa, ou display + texto) mas **combine métricas** (x-height e largura semelhantes); nunca pareie duas sem serifa geométricas nem duas humanistas — parece erro, não decisão.
**Sinal de erro:** 3+ famílias na mesma página; H1 e H2 com diferença de tamanho <20%; pesos 400 e 500 usados como níveis hierárquicos (a diferença é imperceptível na maioria das telas).
### 1.7 Fontes variáveis
Uma variable font substitui 6–18 arquivos estáticos, com **redução líquida de bytes a partir de ~3–4 pesos usados**, além de eliminar requisições. Eixos: `wght`, `wdth`, `opsz`, `slnt`, `ital` + customizados. O mais subestimado é **`opsz`**: reconfigura o desenho da letra conforme o tamanho — contraste maior e espaçamento apertado em títulos, hastes mais grossas e espaçamento aberto em corpo. É a diferença entre um título que parece "a fonte do corpo ampliada" e um título desenhado.
`@font-face { font-family:"Inter var"; src:url("inter.woff2") format("woff2-variations"); font-weight: 100 900; font-display: swap; }` — `font-weight` recebe o **range**, não um valor. Depois: `h1 { font-variation-settings: "wght" 720, "opsz" 48; }`.
Cuidado: `font-variation-settings` **não herda de forma composicional** — sobrescrever um eixo apaga os outros. Prefira `font-weight`, `font-optical-sizing` e `font-stretch` quando existirem.
### 1.8 Métricas de fonte — por que dois tipos no mesmo px parecem tamanhos diferentes
`font-size` **não** define o tamanho das letras: define o tamanho do **em square**, caixa abstrata herdada da tipografia metálica. Quanto dela o desenhista preenche é decisão dele.

| Métrica | O que é | Efeito percebido |
|---|---|---|
| **x-height** | Altura do "x" minúsculo | **Dominante** — é o que o olho lê como "tamanho do texto" |
| cap height | Altura das maiúsculas | Peso visual de títulos e all-caps |
| ascender / descender | Extensões acima/abaixo | Densidade percebida, colisão entre linhas |
| line gap | Folga sugerida pela fonte | Altura de linha default do navegador |

Verdana tem x-height ~0.545 do em; Garamond ~0.38. Ambas a 16px: **Verdana parece cerca de 40% maior**. Consequência: **nunca troque a família de um sistema sem reajustar a escala inteira** — trocar de fonte é mudar o token de família *e* todos os tamanhos.
**Sinal de erro:** fonte trocada com os tamanhos herdados da anterior; título e corpo de famílias diferentes no "mesmo" tamanho parecendo desalinhados.
### 1.9 `font-display` e fallback com `size-adjust`
| Valor | `auto` | `block` | **`swap`** | `fallback` | `optional` |
|---|---|---|---|---|---|
| Bloqueio / swap | ~3s / infinito | ~3s / infinito | ~0ms / infinito | ~100ms / ~3s | ~100ms / 0 |
| Uso | Não use | Ícones-fonte (legado) | **Corpo de texto** — evita FOIT | Compromisso | **CLS zero**; a fonte pode nunca aparecer |

O custo do `swap` é o layout shift na troca. Solução: fallback com métricas ajustadas.
```css
@font-face { font-family: poppins-fallback; src: local("Arial");
  size-adjust: 60.85099821%; ascent-override: 164.3358416%;
  descent-override: 57.51754455%; line-gap-override: 16.43358416%; }
body { font-family: Poppins, poppins-fallback, sans-serif; }
```
Fórmula documentada pelo Chrome: `size-adjust = avgCharacterWidth(webfont) / avgCharacterWidth(fallback)`, com a largura média aproximada pela média de `[a-z\s]` ou ponderada pela frequência de letras; os `*-override` alinham as métricas verticais. O fallback passa a ocupar **exatamente o mesmo espaço** que a webfont — CLS reduzido ou eliminado. Next.js, Nuxt e outros geram esses valores automaticamente.
Fonte: Chrome for Developers — https://developer.chrome.com/blog/font-fallbacks · https://developer.chrome.com/blog/framework-tools-font-fallback · **Sinal de erro:** webfont sem `font-display`; CLS mensurável no carregamento sem fallback ajustado; fonte de terceiro sem `preconnect`.
### 1.10 O que evitar
| Prática | Por quê | No lugar |
|---|---|---|
| **`text-align: justify`** | Navegador não faz hifenização nem ajuste fino de espaço: produz "rios" de branco vertical e vãos irregulares, especialmente prejudiciais a leitores com dislexia; severo em coluna estreita | `text-align: left` (ragged right). Se insistir: `hyphens: auto` + `text-wrap: pretty` + coluna ≥60 caracteres |
| **All-caps em frases/parágrafos** | Remove a variação de altura (ascendentes/descendentes) que dá forma reconhecível à palavra e amplia a área de varredura | All-caps só em rótulos de **1–3 palavras** (botão, tab, eyebrow, chip), com tracking positivo |
| **All-caps escrito no conteúdo** | Leitores de tela podem soletrar strings maiúsculas letra a letra | Sempre `text-transform: uppercase` |
| **`letter-spacing: 0` em título grande** | O espaçamento é desenhado para o tamanho de texto; ampliado, fica visualmente frouxo | Tabela abaixo |

Nuance honesta sobre all-caps: no experimento NN/g + MIT AgeLab de **decisão lexical com palavras isoladas**, minúsculas exigiram **26% mais tempo** que maiúsculas — porque maiúsculas são maiores no mesmo `font-size` (minúsculas têm ~¾ do tamanho das capitalizadas). Isso **não** revoga a recomendação prática: o estudo mediu palavras isoladas, não frases; em texto corrido all-caps continua mais lento.
Fonte: NN/g — https://www.nngroup.com/articles/glanceable-fonts/ · Adrian Roselli — https://adrianroselli.com/2010/01/all-caps-harder-to-read.html
`letter-spacing` **[convenção]** — tracking negativo cresce com o tamanho, positivo com a pequenez:

| Tamanho | 60px+ | 40–60px | 28–40px | 16–24px (corpo) | 12–14px (meta) | All-caps |
|---|---|---|---|---|---|---|
| Valor | −0.03 a −0.02em | −0.02 a −0.01em | −0.01em a 0 | 0 | +0.01 a +0.02em | +0.04 a +0.1em |

Fontes com eixo `opsz` fazem isso sozinhas. Complemento: `text-wrap: balance` em títulos (até ~6 linhas), `text-wrap: pretty` em parágrafos.
## 2. Cor
### 2.1 Espaços de cor
| Espaço | Gamut | Uniformidade perceptual | Uso em 2026 |
|---|---|---|---|
| sRGB (hex, rgb) | Padrão | Nenhuma | Legado, fallback |
| HSL | sRGB | **Falsa** — `L` não corresponde à luminosidade percebida | **Evitar para gerar escalas** |
| Display P3 | ~+30% sobre sRGB | Nenhuma | Cores mais vivas em telas modernas |
| Lab / LCH (CIE) | Ilimitado | Boa, com desvio de tom no azul | Legado científico |
| **OKLab / OKLCH** | Ilimitado | **Melhor disponível** | **Padrão para gerar rampas** |
| Rec2020 | Muito amplo | Nenhuma | HDR, vídeo |

**Por que OKLCH para rampas.** Em HSL, hues diferentes com o mesmo `L` têm luminosidades reais muito distintas — `hsl(60 100% 50%)` (amarelo) é dramaticamente mais claro que `hsl(240 100% 50%)` (azul). Consequência documentada: *"hue changes could lead to accessibility issues from low contrast"* — girar o hue de uma paleta quebra o contraste silenciosamente; `darken()` do Sass tem o mesmo defeito. OKLCH usa lightness **percebida**, consistente entre hues: variar `L` mantendo `C` e `H` produz degraus perceptualmente equidistantes e com contraste previsível. Sintaxe `oklch(L C H / alpha)`; suporte em todas as versões recentes de navegador desde 2025, sem polyfill.
Fonte: Evil Martians — OKLCH in CSS — https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl · **Sinal de erro:** rampa gerada com `darken()`/`lighten()`; tons "escuros" com contraste menor que os médios; paleta em HSL com `L` igual entre hues tratada como equivalente.
### 2.2 Receita concreta de rampa de 11 tons
Tailwind v4 define **todo o palette em OKLCH**, com 11 degraus por cor (50…950) expostos como variáveis CSS no namespace `--color-*`. Uso típico: 50–100 fundos, 200–300 bordas, 400–600 sólidos e ícones, 700–950 texto.
Fonte: Tailwind CSS — Colors — https://tailwindcss.com/docs/colors
Receita: (1) escolha o hue `H` da marca e o croma máximo viável `C` — o degrau 500 é o mais saturado; (2) fixe `H`, varie `L` conforme abaixo, **reduzindo `C` nos extremos** (croma alto em L muito alto ou baixo sai do gamut e vira outra cor); (3) meça o contraste dos degraus de texto contra os de fundo, não estime.

| Degrau | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `L` | .97 | .94 | .89 | .81 | .71 | .63 | .55 | .47 | .39 | .31 | .22 |
| `C` × | .15 | .30 | .50 | .70 | .90 | **1** | .95 | .85 | .70 | .55 | .40 |
| Papel | fundo | fundo sutil | borda sutil | borda | ícone | marca | hover/texto | texto | texto forte | texto máx. | superfície escura |

**Alternativa mais rigorosa — modelo Radix (12 degraus com função declarada).** Cada degrau tem papel fixo, igual em todas as cores e em claro/escuro, o que torna a rampa uma **API**, não uma paleta: 1 fundo da aplicação · 2 fundo sutil · 3 fundo de elemento normal · 4 hover · 5 ativo/selecionado · 6 bordas e separadores sutis não interativos · 7 borda de elemento e focus ring · 8 borda em hover / focus ring forte · 9 **fundo sólido** (maior croma, cor de marca) · 10 sólido em hover · 11 **texto de baixo contraste, garantido a Lc 60 (APCA)** sobre o degrau 2 · 12 **texto de alto contraste, garantido a Lc 90** sobre o degrau 2.
Atribuir função a cada degrau elimina a decisão ad hoc e faz o tema escuro funcionar por construção — no escuro, os mesmos números continuam significando as mesmas coisas.
Fonte: Radix Colors — https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
### 2.3 Cor semântica
Conjunto mínimo: `success`, `error` (ou `danger`/`critical`), `warning`, `info`, `neutral`. Cada um precisa de **pelo menos quatro tokens**: `surface`, `border`, `icon`/`accent`, `text`.
**Sinal de erro:** um único hex de vermelho servindo de fundo de alerta, borda e texto (um dos três vai falhar contraste); cor de erro definida no componente, não no sistema.
### 2.4 Contraste: WCAG vs APCA — status honesto
| Critério | Nível | Requisito |
|---|---|---|
| 1.4.3 Contrast (Minimum) | **AA** | **4.5:1** texto normal; **3:1** texto grande (≥18.66px bold ou ≥24px) |
| 1.4.6 Contrast (Enhanced) | AAA | 7:1 normal; 4.5:1 grande |
| 1.4.11 Non-text Contrast | **AA** | **3:1** para componentes de UI e gráficos essenciais |
| 1.4.8 Visual Presentation | AAA | ≤80 caracteres/linha; sem justificação; entrelinha ≥1.5 |
| 1.4.12 Text Spacing | **AA** | Suportar line-height 1.5×, ¶ 2×, letter 0.12em, word 0.16em |

**O que o APCA resolve.** A fórmula do WCAG 2.x é uma razão de luminância relativa que ignora tamanho e peso da fonte (só distingue "grande" e "normal"), ignora **polaridade** (claro sobre escuro se comporta diferente de escuro sobre claro) e não é perceptualmente uniforme. Daí pares que passam em 4.5:1 e são desconfortáveis, e pares que falham e são perfeitamente legíveis. APCA produz um valor **Lc** de −108 a +106, com limiares que variam por tamanho e peso.
**O status real, e isto muda a recomendação:** APCA **não está mais no WCAG 3** — foi marcado para remoção no início de 2023 e retirado formalmente do working draft de julho de 2023, por falta de apoio suficiente do working group para avançar além do status exploratório. Em abril de 2026 a posição documentada continua sendo *"The contrast algorithm used in WCAG 3 is yet to be determined."* A conclusão do WCAG 3 é projetada para **~2030 ou depois**.
Fonte: Adrian Roselli — https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html · W3C WAI Silver — https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup · APCA — https://git.apcacontrast.com/documentation/minimum_compliance.html

Posição para 2026: **conformidade legal e contratual em WCAG 2.2 AA** (é o que auditorias, EN 301 549, ADA e LBI/eMAG cobram); **APCA (Lc) como ferramenta de escolha de design** entre pares que já passam, porque acerta melhor a percepção — é o que o Radix faz, garantindo Lc 60/90 *e* passando em WCAG; e **dependência arquitetural em APCA: nenhuma**, porque se ele mudar ou não for adotado o sistema não pode precisar de refatoração.
### 2.5 Nunca só cor para transmitir informação
**WCAG 1.4.1 (Use of Color) é nível A** — o piso, não o topo: cor não pode ser o único meio visual de transmitir informação, indicar ação, solicitar resposta ou distinguir um elemento. A dupla vermelho/verde — base universal de erro/sucesso — é precisamente a que colapsa na deficiência de visão de cores mais comum (deuteranomalia). Prevalência clássica: **~8% dos homens e ~0,5% das mulheres** de ascendência norte-europeia — cerca de 1 em 12 homens.
Fonte: Colour Blind Awareness — https://www.colourblindawareness.org/colour-blindness/types-of-colour-blindness/ · Webvision — https://www.ncbi.nlm.nih.gov/books/NBK11538/table/ch28kallcolor.T1/

| Situação | Solução redundante |
|---|---|
| Campo com erro | Ícone + texto de erro abaixo + borda mais espessa + `aria-describedby` |
| Status em tabela | Ícone com forma distinta (✓ / ! / ✕) + rótulo textual |
| Séries em gráfico | Rótulo direto na série + padrão de traço/marcador diferente |
| Link em parágrafo | Sublinhado, ou 3:1 vs. texto ao redor **e** distinção no hover/focus |
| Toggle | Posição do knob + rótulo |
**Teste barato:** renderize a tela em escala de cinza; se a informação sumiu, 1.4.1 está violado. Escolha hues que se separem também em **luminosidade** — sucesso e erro com luminosidade semelhante ficam indistinguíveis em cinza mesmo com ícones diferentes.
### 2.6 Dark mode correto
| # | Regra | Valor / razão |
|---|---|---|
| 1 | **Não inverta** | Inversão produz sombras invertidas, imagens em negativo e hierarquia destruída. Dark mode é reatribuição da camada semântica de tokens |
| 2 | **Não use `#000` como superfície** | Padrão Material **`#121212`**. Preto puro maximiza contraste de borda e causa *halation* (brilho borrado ao redor do texto claro), severo em astigmatismo, e elimina a possibilidade de expressar elevação |
| 3 | **Elevação por luminosidade, não por sombra** | No escuro sombras são invisíveis — use overlay branco crescente (tabela abaixo) |
| 4 | **Não use `#FFF` puro em corpo** | ~87% de opacidade (alta ênfase), 60% (média), 38% (desabilitado). Branco puro sobre `#121212` dá ~18:1 — além do necessário e desconfortável em leitura longa |
| 5 | **Dessature os acentos** | Cores saturadas sobre fundo escuro vibram e são difíceis de focar. Material recomenda tons **200–50** em vez dos 500–700 do tema claro; em OKLCH, reduza `C` e aumente `L` |
| 6 | **Limite grandes superfícies brilhantes** | O header colorido que funciona no claro vira bloco ofuscante no escuro |
| 7 | **~15.8:1 como referência de conforto** | Para texto principal sobre a superfície base — folga para sobreviver aos overlays de elevação sem cair abaixo de 4.5:1 |

| Elevação (dp) | 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|
| Overlay branco | 0% | 5% | 7% | 8% | 9% | 11% | 12% | 14% | 15% | 16% |
Fonte: Material Design — Dark theme — https://m2.material.io/design/color/dark-theme.html
Implementação: `color-scheme: light dark` no `:root` (para que scrollbars e controles nativos acompanhem); tokens redefinidos sob `@media (prefers-color-scheme: dark)` **e** sob `[data-theme="dark"]`, para o toggle manual vencer nos dois sentidos.
**Sinais de erro:** `filter: invert()` como tema escuro; `#000` de fundo; `#FFF` em corpo; card escuro distinguindo-se do fundo só por `box-shadow`; acento com o mesmo croma nos dois temas; ilustração sem variante escura.
### 2.7 Psicologia da cor — o pior lastro empírico da disciplina
**Mito:** significados universais fixos por hue — "azul = confiança", "vermelho = urgência", "verde converte mais". O teste "botão vermelho vs. verde" que circula há 15 anos mede **contraste e isolamento visual** naquela página específica, não a cor: trocar as cores da página inverte o resultado.
**Real, com ressalva:** cor melhora reconhecimento e memória de marca — mas o efeito é de *consistência* e *distinção*, não do hue escolhido; **adequação percebida ao produto importa mais que a cor** (Labrecque & Milne; Bottomley & Doyle), de modo que a pergunta útil é "essa cor é apropriada para esta categoria?", não "essa cor causa confiança?"; associações são **culturalmente contingentes** (branco = luto em partes da Ásia Oriental; vermelho = sorte na China, perigo no Ocidente, casamento na Índia); cor quente/saturada aumenta arousal fisiológico com **efeito pequeno e sem direção semântica**. O único efeito robusto e replicável é o **de contraste** — o que se destaca do entorno recebe atenção —, e isso é hierarquia visual, não psicologia da cor.
Critério de escolha: **distinção da marca + viabilidade de contraste ao longo dos 11–12 degraus + desempenho em daltonismo.** Nunca narrativa emocional.
## 3. Layout e espaçamento
### 3.1 Grid de 12 colunas — e por quê
12 é o menor número prático com muitos divisores inteiros — **1, 2, 3, 4, 6, 12** — permitindo metades, terços, quartos e sextos sem frações. 10 colunas dão só metades e quintos; 16 dá metades, quartos e oitavos mas **não terços** (é por isso que o Carbon, com 16 colunas, sofre com layouts de três colunas iguais).
Grid 2x do IBM Carbon, a referência pública com números:

| Breakpoint | sm | md | lg | xlg | Max |
|---|---|---|---|---|---|
| Largura | 320px | 672px | 1056px | 1312px | 1584px |
| Colunas | 4 | 8 | 16 | 16 | 16 |
| Margem | 0px | 16px | 16px | 16px | 24px |
Padding constante 16px; gutters de 32px (ou zero para conteúdo intimamente relacionado). Unidade base: *"the basic unit of 2x Grid geometry is the 8-pixel square mini unit"*, com a regra elegante *"fluid grids are built by division, whereas fixed grids are built with multiplication"*. Proporções recomendadas: 1:1, 2:1, 2:3, 3:2, 4:3, 16:9.
Fonte: IBM Carbon — 2x Grid — https://carbondesignsystem.com/elements/2x-grid/overview/
Nota 2026: com CSS Grid e `repeat(auto-fit, minmax())`, o grid de 12 colunas é cada vez mais **convenção de comunicação com design** do que necessidade de implementação.
### 3.2 Escala base 4/8px
Por que 4 e 8: a maioria das densidades de tela são múltiplos ou frações limpas (1×, 1.5×, 2×, 3×, 4×) e 4/8 sobrevivem a essas multiplicações sem produzir meio-pixel.

| Token | `.025` | `.050` | `.100` | `.150` | `.200` | `.300` | `.400` | `.500` | `.600` | `.800` | `.1000` | `.1200` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| px | 2 | 4 | 8 | 12 | 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 |
| rem | .125 | .25 | .5 | .75 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 |
| Uso | ajuste óptico | ícone↔rótulo | interno de componente | padding de input | padding padrão, gap | entre campos | padding de card | — | entre seções | entre blocos | seções de marketing | hero |

A evidência de "consistência" **não é experimental — é operacional**: uma escala restrita elimina a decisão e portanto a divergência entre 12 telas feitas por 6 pessoas. GOV.UK encontrou *"a large amount of variation in how spacing had been applied to typography and layout"* justamente onde a escala não existia, e resolveu com escala responsiva (h2 com `margin-bottom` 30px em telas grandes, 20px em pequenas) e **margens unidirecionais**.
Fonte: GOV.UK — https://designnotes.blog.gov.uk/2018/02/19/developing-new-typography-and-spacing-for-gov-uk-frontend/
Duas regras que multiplicam o valor da escala: **espaço interno ≤ espaço externo** (se o padding do card é 16, o gap entre cards deve ser ≥16, senão o agrupamento inverte); e **margens unidirecionais** — espaçamento em uma direção só (`margin-block-end`) ou, melhor, `gap` no container e nenhuma margem nos filhos, o que elimina colapso de margem e espaçamento duplicado.
**Sinal de erro:** valores fora de múltiplos de 4 (13, 17, 22, 35px); `margin-top` e `margin-bottom` no mesmo elemento; padding do card maior que o gap entre cards.
### 3.3 Proximidade e agrupamento
O princípio de Gestalt mais forte e mais barato: elementos próximos são percebidos como relacionados, e a proximidade **vence** cor, borda e caixa. Um label a 4px do seu input e a 24px do próximo grupo é lido corretamente sem nenhuma caixa — bordas e fundos são caros em ruído visual e frequentemente resolvem o que espaçamento já resolveria. Falha clássica e a mais comum em formulários: label equidistante do campo acima e do de baixo, e o usuário associa ao errado.
**Sinal de erro:** distância label↔campo ≥ campo↔próximo label; grupos separados por borda com o mesmo espaçamento interno e externo.
### 3.4 Ritmo vertical
Ritmo estrito (todo texto assentando numa baseline grid) é caro e frágil na web — imagens, componentes de terceiros e conteúdo dinâmico quebram. Abordagem pragmática: escolha `line-height` que produza altura de linha **múltipla de 4px** nos degraus principais (16 × 1.5 = 24 ✓; 17 × 1.5 = 25.5 ✗); use espaçamento entre blocos da mesma escala 4/8; não persiga alinhamento de baseline entre colunas paralelas.
### 3.5 Hierarquia visual — as cinco alavancas
Ordem aproximada de força perceptual **[convenção]** — ordenação de composição consolidada, sem medição comparativa publicada:

| Alavanca | Força | Custo |
|---|---|---|
| **Posição** | Máxima | Zero — mas é o recurso mais escasso |
| **Tamanho** | Muito alta | Espaço |
| **Contraste (valor)** | Alta | Nenhum |
| **Peso** | Média-alta | Nenhum |
| **Cor (matiz)** | Média | **Falha em daltonismo e em escala de cinza** |
| (Espaço ao redor) | Alta | Espaço |
Regras: **dois eixos, não cinco**; e **um único elemento primário por tela** — se tudo é enfatizado, nada é.
O dado que sustenta hierarquia *agressiva*: o Google publicou o maior corpo de pesquisa já divulgado por um design system ao lançar o Material 3 Expressive — **46 estudos, mais de 18.000 participantes**. Em eye-tracking, elementos-chave foram localizados até **4× mais rápido** nos designs expressivos, e o atraso típico por idade em usuários **45+ desapareceu** (igualaram os jovens). Preferência entre 18–24 anos: até **87%**; percepção de "modernidade" +34%. A lição transferível, independente da estética: **hierarquia visual agressiva mede melhor que hierarquia sutil**, e o custo da "elegância discreta" recai desproporcionalmente sobre usuários mais velhos.
Fonte: Google Design — https://design.google/library/expressive-material-design-google-research · **Sinal de erro:** H1, H2 e corpo com contraste de tamanho <1.2×; dois botões com a mesma ênfase competindo na mesma dobra; página inteira no mesmo peso.
### 3.6 Whitespace e densidade
Whitespace faz duas coisas mensuráveis: **separa** (mecanismo primário de agrupamento) e **sinaliza importância** — o espaço em torno de um elemento é sinal mais forte de que ele importa do que o próprio tamanho. Distinção operacional: **macro-whitespace** (entre seções e blocos, controla a estrutura) e **micro-whitespace** (entrelinha, letras, padding, controla a leiturabilidade). Aumentar macro sem aumentar micro produz **páginas arejadas com texto apertado** — o erro mais comum em redesigns "minimalistas". Contraindicação honesta: whitespace excessivo em ferramenta de trabalho aumenta scroll e reduz a informação comparável simultaneamente, **piorando** tarefas de comparação. É recurso a gastar, não valor absoluto.

| Contexto | Marketing / conteúdo | Produto consumidor | Admin / ferramenta | Tabela de dados |
|---|---|---|---|---|
| Multiplicador de espaço | ×1.25–1.5 | ×1 | ×0.75 | ×0.5 |
| Corpo | 18–20px | 16–17px | 14–16px | 13–14px |

Implemente densidade como **tema** (multiplicador nos tokens de espaço), não como componentes paralelos. Contraindicação: se a densidade compacta produz alvos abaixo de **24×24px CSS** (WCAG 2.2 SC 2.5.8, AA) ou 44×44px (AAA / HIG da Apple), ela precisa ser desabilitada em touch.
### 3.7 Breakpoints e mobile-first
| Nome | xs / base | sm | md | lg | xl | 2xl |
|---|---|---|---|---|---|---|
| Largura | 0–479 | 480–767 | 768–1023 | 1024–1279 | 1280–1535 | 1536+ |
| Alvo | Telefone pequeno | Telefone | Tablet retrato | Tablet paisagem / laptop | Desktop | Desktop grande |

Carbon usa 320 / 672 / 1056 / 1312 / 1584 — mesmos patamares, ancorados no mini-unit de 8px.
**Mobile-first continua valendo em 2026**, mas pelas razões que mudaram — não é mais principalmente tráfego: (1) **`min-width` é aditivo, `max-width` é subtrativo** — CSS mobile-first cresce por adição de capacidade, desktop-first por acumulação de sobrescritas, que é como se produz especificidade insustentável; (2) **a restrição força priorização** — o que sobrevive à coluna única é o que importa; (3) a ordem do DOM mobile-first tende a ser a ordem de leitura correta, o que serve leitores de tela.
### 3.8 Container queries mudam o jogo
A mudança é conceitual, não sintática: media queries perguntam sobre o **viewport**; container queries perguntam sobre o **espaço disponível para este componente**. Isso torna o componente genuinamente portátil — o mesmo card se adapta na sidebar de 300px e na área principal de 900px sem que ninguém precise saber onde ele foi colocado.
```css
.card-area { container-type: inline-size; container-name: card; }
@container card (min-width: 420px) { .card { grid-template-columns: 160px 1fr; } }
```
Unidades: `cqi` (inline size), `cqb`, `cqw`, `cqh`, `cqmin`, `cqmax`. `cqi` é a mais útil — tipografia e espaçamento que escalam com o container, não com a janela.
Fonte: Modern CSS Daily — https://modern-css.davecross.co.uk/2026/06/28/container-query-units/
Consequência: **um componente que usa media query carrega uma suposição sobre seu contexto.** Em 2026, componentes de biblioteca usam container queries; media queries pertencem às camadas de página e layout.
### 3.9 Layouts intrínsecos
Em vez de o designer ditar quebras em larguras arbitrárias, o layout se reconfigura com base no próprio conteúdo e espaço disponível. Axioma: *"the algorithm is the layout"* — o CSS descreve intenção e restrição, o navegador resolve; produz layouts que funcionam em larguras que ninguém testou.
Os primitivos: **Stack** (espaçamento vertical consistente entre irmãos, `> * + *`) · **Box** (padding + borda, unidade de contenção) · **Center** (centraliza com `max-width` em `ch`) · **Cluster** (grupo que quebra naturalmente, `flex-wrap` + `gap` — tags, botões) · **Sidebar** (duas colunas que viram uma quando a principal fica estreita, **sem media query**) · **Switcher** (N colunas → N linhas num limiar, via `flex-basis` calculado) · **Cover** (altura com item centralizado) · **Frame** (`aspect-ratio`) · **Reel** (rolagem horizontal) · **Imposter** (sobreposição centralizada) · **Grid** (`repeat(auto-fit, minmax(Xrem, 1fr))`) · **Icon** (dimensionado com `1em`, alinhado ao texto).
Fonte: Every Layout — https://every-layout.dev/
Modelo dominante de 2026: **media queries para a página, layouts intrínsecos + container queries para tudo dentro dela.**
### 3.10 Por que larguras fixas quebram
Largura fixa embute quatro suposições, e as quatro falham: que você conhece o tamanho da tela, que conhece o comprimento do conteúdo, que o usuário não vai dar zoom, e que o componente não será reutilizado em outro contexto. O que quebra na prática: **traduções** (alemão é ~30% mais longo que inglês; um botão dimensionado para "Save" quebra em "Speichern unter" — em pt-BR, "Salvar alterações"); nomes, URLs e IDs longos sem espaço; **zoom de texto a 200%** (WCAG 1.4.4) e **reflow a 320px** (WCAG 1.4.10); text spacing forçado (WCAG 1.4.12).
```css
*, *::before, *::after { box-sizing: border-box; }
.container { max-inline-size: 100%; min-inline-size: 0; overflow-wrap: break-word; hyphens: auto; }
.truncate  { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
`min-inline-size: 0` é o consertador de bug mais subestimado do CSS moderno: itens de flex e grid têm `min-width: auto` por padrão, o que os impede de encolher abaixo do conteúdo e causa a maioria dos overflows horizontais inexplicáveis. Substituições: `max-width` em `ch` (texto) ou `rem` (containers); `min()`/`max()`/`clamp()` para restrições; `minmax()` + `auto-fit` em grid; `aspect-ratio` em vez de altura fixa; `gap` em vez de margens calculadas.
**Sinal de erro:** scroll horizontal em 360px; texto cortado ou sobreposto a 200% de zoom; `width: 1200px` sem `max-width: 100%`; altura fixa em container de texto.
## 4. Ícones e imagem
### 4.1 Grade e peso de traço
Um conjunto de ícones é um **sistema tipográfico**, não uma coleção de desenhos.

| Parâmetro | Valor típico |
|---|---|
| Grade (artboard) | 24×24 (padrão) ou 20×20 / 16×16 |
| Keyline / área ativa | ~20×20 dentro de 24×24 (padding de 2px) |
| **Peso do traço** | 1.5px ou 2px em 24px — **constante em todo o set** |
| Terminações e junções | Todas round **ou** todas square — nunca misturado |
| Raio de canto | Um valor (ex.: 2px) |
| Formas-chave | Círculo 20ø / quadrado 18 / retângulo vertical 16×20 / horizontal 20×16 |

As formas-chave têm tamanhos diferentes por **compensação óptica** — um círculo de 20px e um quadrado de 20px não parecem do mesmo tamanho (círculos precisam de ~2–3% de overshoot). Ao escalar, o peso do traço escala junto, ou o ícone de 16px fica anêmico; fontes de ícones variáveis (Material Symbols, eixos `wght`, `FILL`, `GRAD`, `opsz`) resolvem pelo mesmo mecanismo do `opsz` tipográfico.
**Sinal de erro:** sets diferentes (outline + filled) na mesma tela; caps round e square misturados; ícone de 16px com o mesmo traço absoluto do de 24px.
### 4.2 Ícone com rótulo
A evidência é consistente e vem de décadas de testes: **ícones sozinhos são ambíguos**, com raríssimas exceções (busca, casa, fechar, imprimir, carrinho) — e mesmo essas falham em populações específicas.
1. **Ícone + rótulo textual visível** é o padrão para navegação e ações primárias. Tab bars sem rótulo reduzem descobribilidade — a NN/g listou isso entre os problemas do Liquid Glass no iOS 26.
2. **Ícone sozinho exige nome acessível** (`aria-label` ou texto visualmente oculto) e tooltip. WCAG 4.1.2 exige o nome; **2.5.3 (Label in Name)** exige que o nome acessível contenha o texto visível quando houver.
3. **Ícone decorativo** precisa de `aria-hidden="true"` e `focusable="false"` no SVG, ou vira ruído anunciado.
Fonte: NN/g — Liquid Glass Is Cracked — https://www.nngroup.com/articles/liquid-glass/
### 4.3 SVG vs. ícone-fonte
| Critério | SVG inline | SVG sprite | Ícone-fonte |
|---|---|---|---|
| Acessibilidade | Boa (`<title>`, role) | Boa | **Ruim** — leitores de tela podem ler o glifo PUA; falha se a fonte não carregar |
| Multicolor / animável | Sim / sim | Sim / limitado | Não / não |
| Cache | Não (inline) | Sim | Sim |
| Peso | Só os usados | Só os usados | Fonte inteira |
| Alinhamento com texto | Requer trabalho | Requer trabalho | Trivial |
| **FOIT / CLS** | Não | Não | **Sim** — quadrados vazios até carregar, e o reflow quando os glifos chegam gera layout shift que conta contra o CLS |
**Veredito 2026: SVG.** Ícone-fonte é legado. Sprite SVG (`<use href="#icon-x">`) para sets grandes com cache; SVG inline para ícones críticos acima da dobra ou que precisem de animação/multicolor. Se usar ícone-fonte por herança, no mínimo: `aria-hidden` no ícone, texto real ao lado e `font-display: block`.
### 4.4 Fotografia vs. stock genérica
Stock genérica ("pessoas de negócios apertando as mãos", "mulher sorrindo com laptop em fundo branco") tem quatro custos concretos: **credibilidade** (usuários reconhecem stock e descontam a confiabilidade da página — equivalente visual de linguagem corporativa vazia); **diferenciação** (a mesma imagem está em dezenas de concorrentes); **informação** (foto que não mostra produto, resultado ou pessoa real ocupa espaço sem informar); **performance** (hero images grandes são frequentemente o elemento LCP).
Ordem de preferência: (1) produto real em uso; (2) fotografia própria de pessoas reais da empresa/clientes; (3) ilustração sistematizada; (4) tipografia + cor como elemento visual; (5) stock fortemente direcionada e tratada com filtro/grade consistente que a torne parte do sistema. **Regra do diretor de arte: toda imagem deve dizer algo que o texto ao lado não diz** — se é decorativa, provavelmente pode sair, e sair melhora performance e foco.
Formato: **AVIF** para fotografia (~50% menor que JPEG), **WebP** como fallback amplo (~25–35%), JPEG como fallback final, **SVG** para ícones/logos/diagramas, PNG só com transparência sem alternativa. `width` e `height` **sempre** (reservam espaço, eliminam CLS); `loading="lazy"` abaixo da dobra e **nunca** no LCP; `fetchpriority="high"` no LCP; `srcset` + `sizes` corretos — servir 2000px para um slot de 400px é o desperdício mais comum.
**Sinal de erro:** `<img>` sem `width`/`height`; hero com `loading="lazy"`; ilustração sem variante para dark mode.
## 5. Motion
### 5.1 Durações por tipo de transição
| Transição | Duração | Easing |
|---|---|---|
| Hover / focus de botão | **70–120ms** | standard / ease-out |
| Toggle, checkbox, radio | **100–150ms** | standard |
| Tooltip, popover — entrada / saída | **100–150ms / 70–100ms** | decelerate / accelerate |
| Dropdown / menu | **150–200ms** | decelerate (entra) / accelerate (sai) |
| Expandir/colapsar (acordeão) | **200–300ms** | standard |
| Modal / dialog | **250–400ms** | emphasized decelerate |
| Bottom sheet | **300–450ms** | emphasized |
| Transição de página / rota | **300–500ms** | emphasized |
| Skeleton / loading loop | **1000–1500ms** | linear ou ease-in-out |
| Dimming de fundo | **400–700ms** | standard |

Escalas de origem — **IBM Carbon:** `fast-01` 70ms (micro-interações: botões, toggles) · `fast-02` 110ms (fades) · `moderate-01` 150ms (expansões pequenas) · `moderate-02` 240ms (toasts e notificações) · `slow-01` 400ms (expansões grandes, alertas) · `slow-02` 700ms (dimming de fundo). **Material 3:** short1 50 / short2 100 / short3 150 / short4 200; medium1 250 / medium2 300 / medium3 350 / medium4 400; long1 450 … long4 600; extraLong1 700 … extraLong4 1000.
Regra explícita do Carbon: *"Motion's duration should be dynamic based on the size of the animation; the larger the change in distance or size of the element, the longer the animation takes."* **Princípio assimétrico** (Carbon e Material): **entradas mais lentas que saídas** — entrar precisa ser compreendido (decelerate, ~250–400ms), sair precisa sair do caminho (accelerate, ~100–200ms).
Fonte: IBM Carbon — https://carbondesignsystem.com/elements/motion/overview/ · Material Components Android — https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md · **Sinal de erro:** 500ms+ em hover de botão; `transition: all 0.3s` global; entrada e saída com a mesma duração e curva.
### 5.2 Easing
| Material 3 | Valor | IBM Carbon | Productive | Expressive |
|---|---|---|---|---|
| Emphasized decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Standard | `cubic-bezier(0.2, 0, 0.38, 0.9)` | `cubic-bezier(0.4, 0.14, 0.3, 1)` |
| Emphasized accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Entrance | `cubic-bezier(0, 0, 0.38, 0.9)` | `cubic-bezier(0, 0, 0.3, 1)` |
| Standard | `cubic-bezier(0.2, 0, 0, 1)` | Exit | `cubic-bezier(0.2, 0, 1, 0.9)` | `cubic-bezier(0.4, 0.14, 1, 1)` |
| Standard decelerate / accelerate | `cubic-bezier(0,0,0,1)` / `cubic-bezier(0.3,0,1,1)` | | | |
Uso: **standard** para elementos visíveis durante todo o movimento; **entrance** para os que aparecem (modal, dropdown, toast); **exit** para os que desaparecem — mas standard se o elemento continua próximo. **Nunca use `linear` para movimento espacial**: nada no mundo físico parte e para instantaneamente na mesma velocidade; `linear` é para loops (spinner, progresso indeterminado) e mudanças puras de cor/opacidade. M3 Expressive adiciona motion baseado em **física de molas** (rigidez + amortecimento em vez de duração + curva) — vantagem real: gestos interrompidos se comportam corretamente porque a mola herda a velocidade, o que curvas de duração não conseguem.
### 5.3 O que animar e o que nunca
Pipeline de renderização: **Style → Layout → Paint → Composite.** Quanto mais tarde a propriedade entra, mais barata.

| Propriedade | Etapa | Custo | Veredito |
|---|---|---|---|
| `transform`, `opacity` | Composite | Baixíssimo | ✅ **Anime** |
| `filter` | Paint/Composite | Baixo-médio | ⚠️ Com cuidado |
| `background-color`, `color` | Paint | Médio | ⚠️ OK em áreas pequenas |
| `box-shadow` | Paint | Alto | ⚠️ Prefira animar `opacity` de pseudo-elemento |
| `border-radius` | Paint | Médio | ⚠️ |
| `width`, `height`, `top`/`left`/`right`/`bottom`, `margin`, `padding` | **Layout** | Alto | ❌ **Nunca** |
| `font-size` | **Layout** | Muito alto | ❌ **Nunca** |

**Razão técnica:** `transform` e `opacity` são aplicados pela GPU na etapa de composição, **fora da main thread** — rodam a 60/120fps mesmo com JavaScript ocupado. Propriedades de layout forçam reflow de toda a árvore afetada **a cada frame**.
Substituições: mover com `transform: translate3d(x, y, 0)` em vez de `left`/`top`; redimensionar com `transform: scale()` em vez de `width`/`height` (compense o texto com `scale` inverso no filho, ou use FLIP); aparecer/sumir com `opacity` (+ `visibility` ou `@starting-style` para o `display`); sombra com dois elementos, animando a `opacity` do de cima.
Custos a lembrar: cada camada composta consome memória de GPU — `will-change` indiscriminado pode **piorar** a performance em dispositivos modestos (remova após a animação); animações contribuem para o INP; entrance animations acima da dobra **atrasam o LCP por definição**; animação contínua mantém o compositor ativo e consome bateria (pause fora da viewport).
**Sinal de erro:** `transition: width`/`height`/`margin`; `will-change` em dezenas de elementos; hero com fade-in de entrada.
### 5.4 `prefers-reduced-motion`
Não é opcional. WCAG 2.3.3 (Animation from Interactions, AAA) e 2.2.2 (Pause, Stop, Hide, A) dependem disso. Movimento vestibular — paralaxe, zoom, movimento de grande amplitude, rotação — provoca náusea, tontura e enxaqueca em pessoas com transtornos vestibulares. **Reduzir não é remover:** remover toda animação elimina o feedback e pode piorar a compreensão. O padrão correto é **substituir movimento espacial por fade e encurtar durações** — resolvido no nível de token, nenhum componente precisa saber:
```css
:root { --motion-distance: 24px; --motion-duration: 300ms; }
@media (prefers-reduced-motion: reduce) {
  :root { --motion-distance: 0px; --motion-duration: 120ms; }
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
                           transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```
Complementos relevantes: `prefers-reduced-transparency` e `prefers-contrast`.
**Sinal de erro:** zero ocorrências de `prefers-reduced-motion` numa página com animação; parallax sem guarda.
### 5.5 View transitions e scroll-driven — com ressalva de suporte
| Recurso | Status |
|---|---|
| View Transitions **Level 1, same-document** (`document.startViewTransition()`) | **Baseline Newly Available desde outubro de 2025** — todos os motores principais |
| **Cross-document** (`@view-transition { navigation: auto }`) | Chrome, Edge e Safari implementaram; **Firefox não em stable** |
| `:active-view-transition` | **Baseline em janeiro de 2026** |
| **Scroll-driven** (`animation-timeline: scroll()` / `view()`) | Chromium sólido; **Safari e Firefox em progresso** — enhancement puro |

A ressalva, textual: *"If your plan depends on cross-document transitions being universally available, the plan is built on a claim the compatibility data does not support."*
Fonte: Brainstorms and Raves — The View Transitions API in 2026 — https://brainstormsandraves.com/css/view-transitions-2026/
Gotchas de view transitions: os dois documentos precisam declarar `@view-transition { navigation: auto; }`; só navegações same-origin iniciadas pelo usuário disparam; há timeout de 4 segundos para prontidão do documento; imagens distorcem sem `object-fit` explícito; `pageswap` e `pagereveal` disparam independentemente de haver transição. Scroll-driven roda **fora da main thread**, o que resolve o jank histórico de parallax por listener de scroll — envolva em `@supports (animation-timeline: view())` e garanta que **o estado final seja o default sem a feature**. Nenhuma das duas APIs respeita `prefers-reduced-motion` por você:
`@media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }`
## 6. Design tokens
### 6.1 Arquitetura de 3 camadas
Convergência de praticamente todos os sistemas de referência — Fluent 2 chama de *global* e *alias*; Atlassian de *foundation/property/modifier*; Material de *ref/sys/comp*.

| Camada | Nomes comuns | Exemplo | Regra |
|---|---|---|---|
| 1. **Primitivo** | global, ref, core, option | `blue.600 = oklch(55% 0.19 255)` | Sem significado. **Nunca consumido por componente** |
| 2. **Semântico** | alias, sys, decision | `color.text.brand → {blue.600}` | Onde vive o tema. É a camada que o produto consome |
| 3. **Componente** | comp, component | `button.primary.background → {color.text.brand}` | Só existe quando o componente precisa desviar do semântico |
Regra operacional mais importante: **temas trocam a camada 2, nunca a 1** — ir de claro para escuro é reapontar `color.text.brand` para `blue.400` em vez de `blue.600`; os primitivos são os mesmos. A advertência mais afiada da indústria, da Atlassian: *"Choose tokens based on meaning where applicable, not specific values"* — escolher um token porque a cor "bate" com o mockup, e não porque o significado corresponde, quebra o produto em outros temas. É o erro nº 1 de adoção.
Anatomia de nomes (Atlassian): **foundation** (color, elevation, space) + **property** (border, background, shadow) + **modifier** (papel, ênfase, estado) — `color.icon.success`, `color.background.accent.blue.subtle.hovered`.
Cinco regras de nomenclatura que sobrevivem: (1) **do genérico ao específico** — `color.background.danger.hovered`, nunca `hovered.danger.background.color`; (2) **nunca nomeie pelo valor** — `color.brand.primary`, não `color.blue.primary` (dívida no dia em que a marca virar roxa); (3) **nunca nomeie pelo componente na camada semântica** — `color.surface.raised`, não `color.card.background` (obrigaria um token por componente novo); (4) **estados como sufixo** — `.hovered`, `.pressed`, `.disabled`, não um token separado por estado; (5) **escala numérica para primitivo, palavra para semântico** — `gray.100…gray.900` e `surface.subtle`, nunca `gray.subtle` nem `surface.500`.
Fonte: Atlassian — https://atlassian.design/foundations/tokens/design-tokens · Fluent 2 — https://fluent2.microsoft.design/design-tokens
### 6.2 Formato W3C DTCG — com o aviso honesto
**O DTCG não é um padrão W3C.** O documento mais recente é o **Design Tokens Format Module 2025.10**, publicado como *Draft Community Group Report*, com o aviso explícito *"This is not a W3C Standard nor is it on the W3C Standards Track"*. Em 2026 é **consenso de indústria com forte adoção de ferramentas, não recomendação normativa** — não construa dependência que exija estabilidade normativa.

| Módulo | **Format** (estrutura JSON) | **Color** (espaços, gamut) | **Resolver** (referências, temas, modos) |
|---|---|---|---|
| Status 2026 | Draft CG Report 2025.10 | Draft, separado do Format | Draft |

Arquivos `.tokens` / `.tokens.json`, MIME `application/design-tokens+json`. Propriedades: `$value` (obrigatório), `$type` (obrigatório se não herdado de grupo pai), `$description`, `$extensions`, `$deprecated`. Tipos **atômicos**: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`; **compostos**: `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography`. Aliases em duas sintaxes — chaves `{grupo.token}` (resolve para o `$value` do alvo) e JSON Pointer `$ref: "#/caminho"` (RFC 6901, acessa propriedades internas); ambas aceitam encadeamento e exigem detecção de referência circular. Novidades da 2025.10: token reservado `$root` e herança de grupo via `$extends` com deep merge.
Fonte: Design Tokens Format Module 2025.10 — https://www.designtokens.org/tr/drafts/format/ · https://www.designtokens.org/tr/drafts/
### 6.3 Temas
Fluent 2 sustenta explicitamente *"light, dark, high-contrast, and branded elements"*, com contraste garantido no nível do token. A Atlassian generaliza: *"A theme is a collection of token values designed to achieve a certain look or style"* — e nota que **temas não são só cor: movimento reduzido e visão compacta também são temas.** Ideia subestimada: `prefers-reduced-motion` e densidade resolvidos na camada de token, em vez de espalhados em CSS condicional.
### 6.4 Como viram CSS custom properties
Caminho canônico: `tokens.json (DTCG)` → Style Dictionary (transform + format) → `:root { --color-text-brand: oklch(55% .19 255); }` → `[data-theme="dark"] { --color-text-brand: oklch(72% .15 255); }`.
**Por que custom properties e não variáveis Sass:** são resolvidas em **runtime** e cascateiam. É isso que faz tema escuro, alto contraste e densidade funcionarem sem rebuild, e o que faz um componente dentro de um `[data-theme="dark"]` local herdar corretamente; variáveis Sass são compiladas e perdem essa capacidade. **Regra: componentes consomem apenas `var()` de tokens semânticos** — se um componente referencia `--blue-600` diretamente, o tema quebra.
### 6.5 Ferramentas
| Ferramenta | Detalhe relevante |
|---|---|
| **Style Dictionary** (build: tokens → CSS/JS/iOS/Android) | Suporte de primeira classe a DTCG desde a **v4**; v5 persegue a 2025.10. Converte propriedades legadas (`value` → `$value` etc.) e redistribui `$type` de grupos pais. **Limitação:** não refatora os valores de tipo — `"size"` não vira `"dimension"` automaticamente |
| **Tokens Studio** (plugin de Figma; ponte design→código) | Mantém dois formatos (legado e W3C DTCG) com migração explícita. Padrão de mercado: Tokens Studio escreve num repositório Git, Style Dictionary consome em CI |
Fonte: Style Dictionary — https://styledictionary.com/info/dtcg/ · Tokens Studio — https://docs.tokens.studio/manage-settings/token-format
## 7. Sistemas de referência — o que cada um ensina de melhor
| Sistema | O que ensina melhor | Fonte |
|---|---|---|
| **Material 3 / M3 Expressive** | Que **hierarquia visual agressiva mede melhor que sutil** — 46 estudos, 18.000+ participantes, até 4× mais rápido para localizar elementos-chave e o atraso por idade em 45+ desaparecendo. Melhor referência pública de tokens de motion e forma | https://design.google/library/expressive-material-design-google-research |
| **Apple HIG** | Pelo contraexemplo: **material translúcido torna o contraste não determinístico** — o mesmo texto passa ou falha conforme o que rola por baixo. A NN/g classificou o Liquid Glass como *"prioritizing spectacle over usability"*; a Apple respondeu com aparência "tinted" no iOS 26.1. Se adotar vidro/blur, garanta contraste com scrim opaco calculado, não com esperança | https://www.nngroup.com/articles/liquid-glass/ |
| **Fluent 2 (Microsoft)** | **Duas camadas de token com disciplina e alto contraste como cidadão de primeira classe** — globais context-agnostic; alias *"add semantic meaning to the stored values"* | https://fluent2.microsoft.design/design-tokens |
| **IBM Carbon** | **Grid e motion melhor que qualquer outro sistema público, porque publica os números** — 2x Grid (320/672/1056/1312/1584), mini-unit de 8px, escala de duração com o uso declarado de cada token | https://carbondesignsystem.com/elements/2x-grid/overview/ |
| **Shopify Polaris** | **Densidade e economia de espaço para ferramentas de trabalho**, e tratar voz/tom de conteúdo como parte do sistema, não como afterthought | https://polaris-react.shopify.com/tokens/motion |
| **Atlassian** | **Taxonomia de tokens** (foundation + property + modifier) e a ideia de que **tema ≠ cor** — movimento reduzido e densidade também são temas | https://atlassian.design/foundations/tokens/design-tokens |
| **GOV.UK** | **Padrões testados com usuários reais** — ver abaixo | https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/ |

**O valor especial do GOV.UK.** É o único design system relevante cujas decisões vêm de pesquisa com **usuários reais em situação de necessidade real** — pessoas requerendo benefícios, renovando licenças — e não de usuários de produtos digitais autosselecionados. Isso torna suas conclusões sobre formulários as mais confiáveis disponíveis publicamente.
- **"One thing per page"** — uma pergunta por página. Razões documentadas: usuários de baixa confiança digital acham mais fácil; funciona bem em mobile; simplifica radicalmente erros, ramificações, loops e salvar progresso. **Contraponto honesto do próprio post:** falta evidência quantitativa fácil de compartilhar, e pesquisa pode identificar oportunidades de mesclar perguntas — é um default, não dogma.
- **Corpo de texto grande** — 19px desktop / 16px mobile na escala clássica, muito acima da média da web, com revisão pública da escala para torná-la mais acessível.
- **Escala responsiva de espaçamento + margens unidirecionais**, validadas recriando páginas reais de serviços ao cidadão.
Fonte: GOV.UK — https://designnotes.blog.gov.uk/2018/02/19/developing-new-typography-and-spacing-for-gov-uk-frontend/ · Government Transformation — https://www.government-transformation.com/en/citizen-experience/gov.uk-typography-scale-to-be-made-more-accessible
## 8. Sinais de inconsistência numa auditoria
Esta seção transforma "parece inconsistente" em achado auditável: **conte, não opine.** "17 valores de cinza para 4 papéis semânticos" é achado; "parece inconsistente" não é.
**Ressalva de honestidade:** os limiares abaixo são **operacionais, não empíricos** — derivados da aritmética das arquiteturas de referência (rampa de 11–12 degraus × N cores; escala 4/8; escala modular de 6–8 degraus), não de estudo que meça o efeito de ultrapassá-los. O que é defensável é o **método**: um número muito acima do que o sistema declarado comporta indica decisão ad hoc, não intenção.

| O que contar | Numa página | Num produto | Interpretação do excesso |
|---|---|---|---|
| **Cinzas distintos** (croma ≈0) | ≤6 | ≤12 | Rampa neutra de 11 degraus é o teto. Acima disso, valores escolhidos no olho |
| **Cores distintas no total** | ≤20 | ≤60 (5 famílias × 11 + neutros) | Acima disso não há rampa, há acúmulo |
| **Tamanhos de fonte** | ≤8 | ≤10 | Escala modular usável tem 6–8 degraus; 12+ = escala inexistente |
| **Famílias tipográficas** | ≤2 (3 com fonte de código) | ≤3 | 4+ é herança não consolidada |
| **Pesos de fonte** | ≤4 | ≤5 | 400+500+600 juntos indica peso escolhido por tentativa |
| **Raios de borda** | ≤3 | ≤5 | 4/8/16/full cobre quase tudo; 8 raios distintos = nenhum sistema |
| **Espaçamentos fora da escala 4/8** | **0** | **0** | Qualquer 13, 17, 22, 35px é achado direto |
| **Sombras distintas** | ≤4 | ≤6 | Escala de elevação tem 4–6 níveis; mais é sombra improvisada |
| **Durações de transição** | ≤5 | ≤8 | Carbon inteiro tem 6. O oposto também é achado: `transition: all .3s` repetido em tudo |
| **Larguras fixas em px em containers** | **0** | **0** | Ver §3.10 |
| **`!important` em CSS de produto** | ≤2 | — | Sistema rígido demais sendo contornado |
| **Componentes "shadow"** (locais que duplicam um do DS) | — | → **0** | Sintoma de sistema construído sem os consumidores |
| **Detachment rate no Figma** (destacadas/total) | — | **<5%** | Cobertura de design system |
| **% de cor/espaço via `var(--)`** vs. literal | — | **>90%** | Lint de CSS. Abaixo disso, os tokens existem mas ninguém usa |
| **% de componentes de UI vindos do DS** | — | **>70%** | Análise estática (AST) do repositório |

Fonte dos alvos de cobertura: Sparkbox — The 2022 Design Systems Survey — https://designsystemssurvey.sparkbox.com/2022/
Achados qualitativos que também contam: ícones de mais de um set (outline + filled, ou traços de peso diferente) na mesma tela; **espaço interno > espaço externo** em qualquer agrupamento (padding do card maior que o gap entre cards — o agrupamento está invertido); mais de um botão com a mesma ênfase competindo na mesma dobra; componentes interativos sem `:focus-visible`, sem `disabled` ou sem estado de carregamento; **o mesmo papel semântico com dois valores diferentes** em telas distintas (o botão primário em dois azuis).
## 9. Por que design systems falham
| # | Causa | Evidência (Sparkbox 2022) |
|---|---|---|
| 1 | **Tratado como projeto, não como produto** — lançado, celebrado e desfinanciado; sem roadmap, owner e orçamento recorrente decai a partir do lançamento | — |
| 2 | **Construído sem os consumidores** — o time central desenha em isolamento e todo mundo faz o seu por fora. Sintoma: proliferação de componentes "shadow" | — |
| 3 | **Documentação insuficiente** — a queixa nº 1 | **39%** citaram documentação ruim como problema principal; **35%** não conseguiam identificar componentes desatualizados ou quebrados |
| 4 | **Sem processo de contribuição** — o backlog do time central vira o gargalo da empresa | **36%** dos mantenedores não têm processo; entre sistemas bem-sucedidos, **92%** aceitam contribuições de código |
| 5 | **Adoção mandatória sem qualidade** — obrigar esconde o problema e vira imposto percebido | **84%** eram obrigados a usar; só **65%** disseram que suas necessidades eram atendidas. A métrica que importa é adoção **voluntária** |
| 6 | **Rígido demais** — sem escape hatches, os times contornam com `!important` e CSS paralelo, e você perde a visibilidade que tinha | — |
| 7 | **Flexível demais** — props livres e `className` irrestrito: o sistema não garante nada e não vale o custo de manutenção | — |
| 8 | **Paridade design-código quebrada** — Figma e código divergem, ninguém sabe qual é a verdade | **37%** dos mantenedores relatam |
| 9 | **Débito acumulado sem plano** — sem deprecação executada, o sistema fica maior e mais confuso a cada release | **43%** lutam com débito técnico/criativo |
| 10 | **Métricas ausentes** — sem dados, o DS não defende o orçamento na primeira reestruturação e não sobrevive à segunda | Apenas **16%** rastreavam métricas de uso e satisfação |

Contraponto: entre sistemas bem-sucedidos, **84%** têm onboarding formal, **78%** têm governança para decisões de feature e **76%** têm treinamento estabelecido — contra apenas **30%** de todos os respondentes oferecendo onboarding e treinamento. A diferença entre um DS que sobrevive e um que vira arqueologia está mais no processo do que nos componentes.
Fonte: Sparkbox — The 2022 Design Systems Survey — https://designsystemssurvey.sparkbox.com/2022/

---

*Números revisados em 31/08/2026. Sensível a data nesta referência: status do DTCG (§6.2); status do APCA e do WCAG 3 (§2.4); suporte de view transitions e scroll-driven (§5.5); palette e versão do Tailwind (§2.2); versão do Style Dictionary (§6.5).*
