# Performance e Core Web Vitals — referência operacional

Limiares, subpartes, árvores de decisão, orçamentos e táticas. Cada número carrega a fonte, porque é a fonte que sustenta a recomendação diante do cliente.

## Índice

- [1. Limiares](#1-limiares)
- [2. Diagnóstico por métrica](#2-diagnóstico-por-métrica) — [o achado que reordena a prioridade](#20-o-achado-que-reordena-a-prioridade-de-todo-mundo)
- [3. Árvore de decisão de correção](#3-árvore-de-decisão-de-correção)
- [4. Táticas modernas](#4-táticas-modernas)
- [5. Orçamentos de performance](#5-orçamentos-de-performance)
- [6. Perfil Brasil](#6-perfil-brasil)
- [7. Argumento de negócio](#7-argumento-de-negócio)
- [8. SEO — o que o Google literalmente diz](#8-seo--o-que-o-google-literalmente-diz)
- [9. Armadilhas](#9-armadilhas)
- [10. Datado — revisar a cada ciclo](#10-datado--revisar-a-cada-ciclo)

## 1. Limiares

Os três Core Web Vitals em 2026 continuam sendo LCP, INP e CLS. Avaliados no **p75 das visitas de página**, agregando desktop e mobile.

| Métrica | O que mede | Bom | Precisa melhorar | Ruim | Ambiente |
|---|---|---|---|---|---|
| **LCP** Largest Contentful Paint | Pintura do maior elemento de conteúdo visível | ≤ 2,5 s | > 2,5 s e ≤ 4,0 s | > 4,0 s | Campo e lab |
| **INP** Interaction to Next Paint | Latência da pior interação (descontados outliers) | ≤ 200 ms | > 200 ms e ≤ 500 ms | > 500 ms | **Só campo** |
| **CLS** Cumulative Layout Shift | Maior rajada de deslocamento inesperado | ≤ 0,1 | > 0,1 e ≤ 0,25 | > 0,25 | Campo e lab (parcial) |
| **TTFB** Time to First Byte | Navegação → primeiro byte | ≤ 0,8 s | 0,8–1,8 s | > 1,8 s | Campo e lab |
| **FCP** First Contentful Paint | Primeiro pixel de conteúdo | ≤ 1,8 s | 1,8–3,0 s | > 3,0 s | Campo e lab |
| **TBT** Total Blocking Time | Bloqueio da main thread após FCP | < 200 ms (hardware móvel) | 200–600 ms | > 600 ms | **Só lab** |
| **Speed Index** | Velocidade de preenchimento visual | ≤ 3,4 s | 3,4–5,8 s | > 5,8 s | **Só lab** |

Fonte: Google/web.dev — https://web.dev/articles/vitals • https://web.dev/articles/inp • https://web.dev/articles/cls • https://web.dev/articles/ttfb • https://web.dev/articles/fcp • https://web.dev/articles/tbt

**De onde vêm esses números** (para quando o stakeholder achar que são arbitrários): "bom" = valor que ao menos 10% das origens já atingem no p75; "ruim" = faixa dos 10–30% piores. LCP 2,5 s porque 42% das origens mobile o atingiam, contra 3,5% em 1 s. INP 200 ms porque acima disso a percepção de conexão com o input se rompe (causalidade de Michotte); 56% das origens atingiam 200 ms, contra 12% em 100 ms. CLS 0,1 porque ≤ 0,1 é "perceptível mas não excessivamente disruptivo" e ≥ 0,15 é "consistentemente percebido como disruptivo".
Fonte: Google/web.dev — https://web.dev/articles/defining-core-web-vitals-thresholds

**Barra competitiva de mercado (2025):** 48% dos sites mobile passam nos três CWV (56% desktop). LCP bom 62% mobile / 74% desktop; INP bom 77% / 97%; CLS bom 81% / 72%; FCP bom 55% / 70%; **TTFB bom apenas 44% / 55%** — a pior aprovação de toda a web, sinal de que infraestrutura, não front-end, é o gargalo mais disseminado. Fonte: Web Almanac 2025, Performance — https://almanac.httparchive.org/en/2025/performance

## 2. Diagnóstico por métrica

### 2.0 O achado que reordena a prioridade de todo mundo

> **Entre origens com LCP ruim, o tempo mediano no p75 se distribui assim:**
>
> | Subparte | Mediana (origens com LCP ruim) |
> |---|---|
> | **TTFB** | **2.270 ms** |
> | **Resource Load Delay** (esperando para *começar* a baixar) | **1.290 ms** |
> | **Resource Load Duration** (baixando de fato) | **350 ms** |
> | **Element Render Delay** | **360 ms** |
>
> **O site mediano com LCP ruim gasta ~3,7× mais tempo esperando para começar a baixar a imagem LCP do que efetivamente baixando-a.** Literalmente: *"the majority of origins with poor LCP spend less than 10% of their p75 LCP time downloading the LCP image."*
>
> **Consequência direta: comprimir imagem é a tática mais popular e uma das menos eficazes.** A correção que paga é tornar o recurso LCP **descobrível e prioritário** — e atacar o TTFB. O mito da rede móvel cai junto: *"the median p75 image load duration is only 20% slower on mobile than desktop."*
>
> Fonte: Google/web.dev — https://web.dev/blog/common-misconceptions-lcp

Dado que fecha o argumento: 73% das páginas mobile têm imagem como elemento LCP e, entre as de desempenho ruim, **35% dessas imagens tinham URL não descobrível no HTML inicial**. Apenas 33% dos documentos HTML eram servidos por CDN. Fonte: Google/web.dev — https://web.dev/articles/top-cwv

### 2.1 LCP — quatro subpartes

| Subparte | Definição | Alvo (% do LCP) | Tática correspondente |
|---|---|---|---|
| **TTFB** | Navegação → primeiro byte | **~40%** | CDN com edge; cache de HTML; reduzir redirecionamentos; corrigir backend lento |
| **Resource Load Delay** | Fim do TTFB → início do download do recurso LCP | **< 10%** | Recurso descobrível no HTML inicial (`<img src>`, não background-image nem injeção por JS); `<link rel=preload>`; `fetchpriority="high"`; remover `loading="lazy"` |
| **Resource Load Duration** | Duração do download do recurso LCP | **~40%** | Formatos modernos, `srcset`/`sizes`, image CDN, cache, evitar contenção de banda |
| **Element Render Delay** | Recurso baixado → pintura | **< 10%** | Reduzir CSS render-blocking; `defer` no JS não crítico; SSR; quebrar long tasks; **remover transições CSS na primeira seção**, que atrasam a detecção do elemento LCP pelo browser |

Fonte: Google/web.dev — https://web.dev/articles/optimize-lcp — princípio norteador citado pela fonte: *"The vast majority of the LCP time should be spent loading the HTML document and LCP source. Any time before LCP where one of these two resources is not loading is an opportunity to improve."*

### 2.2 INP — três subpartes

| Subparte | Definição | Tática correspondente |
|---|---|---|
| **Input Delay** | Espera antes de o handler começar a rodar | Quebrar long tasks; ceder a main thread com `scheduler.yield()`; reduzir JS de terceiros no carregamento |
| **Processing Duration** | Execução de todos os callbacks daquela interação | Rodar só o necessário para o próximo frame; adiar analytics, save, spell-check, contagem |
| **Presentation Delay** | Fim dos callbacks → pintura do próximo frame | Reduzir tamanho do DOM; `content-visibility`; evitar layout thrashing e `innerHTML` grande |

Fonte: Google/web.dev — https://web.dev/articles/inp • https://web.dev/articles/optimize-inp

**Como o INP é calculado:** reporta a interação mais longa observada **descartando uma interação mais alta a cada 50 interações**; depois aplica-se o p75 entre páginas. **Long task = qualquer tarefa acima de 50 ms**; a parte que excede 50 ms é o "blocking period". Fonte: Google/web.dev — https://web.dev/articles/inp • https://web.dev/articles/optimize-long-tasks

### 2.3 CLS — fontes e correção

**Fórmula:** `layout shift score = impact fraction × distance fraction`. **Session windows:** rajadas com até 1 s de intervalo entre shifts e 5 s de duração máxima; o CLS reportado é a **maior rajada, não a soma**. Shifts até **500 ms** após clique/toque/tecla recebem `hadRecentInput` e são excluídos — scroll e pinch **não** contam como input excludente. Fonte: Google/web.dev — https://web.dev/articles/cls

| Fonte do shift | Correção |
|---|---|
| Imagem sem dimensão | `width` + `height` no `<img>`, ou `aspect-ratio` no CSS |
| Ads, embeds, conteúdo tardio | Reservar espaço com `min-height`/`aspect-ratio`; posicionar mais abaixo; skeleton; não injetar conteúdo sem interação |
| Web fonts (FOIT/FOUT) | `font-display: optional`; fallback declarado; `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`; preload |
| Icon fonts | Trocar por SVG — o glyph de fallback é radicalmente diferente e causa CLS severo |
| Animações | Nunca animar `top`, `left`, `box-shadow`, `box-sizing`. Usar `transform` |
| Navegação back/forward | Garantir elegibilidade a bfcache — restaura instantaneamente e **elimina** os shifts |

Fonte: Google/web.dev — https://web.dev/articles/optimize-cls
**Prevalência:** 66% das páginas têm ao menos uma imagem sem dimensão. Páginas que animam propriedades de layout têm CLS ruim a quase o dobro da taxa média. O bfcache produziu a maior melhoria de CLS observada em 2022. Fonte: Google/web.dev — https://web.dev/articles/top-cwv

## 3. Árvore de decisão de correção

### LCP ruim (> 4,0 s) ou "precisa melhorar" (> 2,5 s)

```
LCP ruim
├─ TTFB > 0,8 s?  (subparte dominante: 2.270 ms medianos)
│   └─ SIM → é infraestrutura, não front-end. Nesta ordem: 1) CDN para o HTML
│            (só 33% dos HTML têm CDN); 2) cache de HTML / SSG ou ISR;
│            3) eliminar cadeia de redirecionamentos; 4) backend e queries.
│            Não toque em imagem enquanto o TTFB não estiver resolvido.
├─ Resource Load Delay > 10% do LCP?  (1.290 ms medianos — segunda maior perda)
│   └─ SIM → o recurso não é descoberto cedo. Checar nesta ordem:
│            1) está em `<img src>` no HTML inicial? (background-image em CSS
│               e injeção por JS matam a descoberta);
│            2) tem `loading="lazy"`? → remover;
│            3) tem `fetchpriority="high"`? → adicionar;
│            4) terceiro → `preconnect`; recurso tardio → `preload`;
│            5) transição/animação CSS na primeira seção atrasando a detecção → remover.
├─ Resource Load Duration alta?  (só 350 ms medianos — raramente é aqui)
│   └─ SIM → agora sim comprimir: AVIF/WebP via `<picture>`, `srcset`/`sizes`,
│            image CDN, cache longo; checar contenção de banda.
└─ Element Render Delay > 10%?
    └─ SIM → CSS render-blocking, JS síncrono, long task antes da pintura,
             hidratação bloqueante → inline do CSS crítico, `defer`, SSR, quebrar tarefas.

Transversal: bfcache + Speculation Rules levam a navegação repetida a LCP ~zero.
```

### INP ruim (> 500 ms) ou "precisa melhorar" (> 200 ms)

```
INP ruim  → não é medível em lab; o diagnóstico começa em campo (RUM/CrUX) + LoAF
├─ Input Delay domina? → main thread ocupada quando o usuário clicou
│      → quebrar long tasks com `scheduler.yield()`; adiar/remover JS de
│        terceiros no carregamento; code splitting
├─ Processing Duration domina? → o handler faz trabalho demais
│      → só o necessário para o próximo frame; empurrar analytics, persistência
│        e cálculo pesado para depois do `yield`
├─ Presentation Delay domina? → o render do frame é caro
│      → reduzir DOM; `content-visibility`; eliminar forced layout e layout
│        thrashing; evitar `innerHTML` grande
└─ INP ruim com TBT bom? → suspeite do atraso de toque de 300 ms em site sem
       viewport mobile-otimizado: conta para INP e não conta para TBT.
```

### CLS ruim (> 0,25) ou "precisa melhorar" (> 0,1)

```
CLS ruim
├─ O shift acontece no carregamento?
│    ├─ imagem sem width/height → dimensões explícitas ou aspect-ratio (66% das páginas falham)
│    ├─ fonte trocando → font-display: optional + overrides de métrica; icon font → SVG
│    └─ banner/ad/embed empurrando conteúdo → reservar caixa com min-height/aspect-ratio
├─ O shift acontece no scroll ou após interação?
│    → conteúdo injetado tarde: reservar espaço; nunca injetar acima do conteúdo já lido
│    → atenção: o Lighthouse não vê isso (§9); só campo revela
└─ O shift acontece no back/forward? → tornar a página elegível a bfcache (§4.7)
```

## 4. Táticas modernas

### 4.1 `fetchpriority` (Priority Hints)

Valores `high` | `low` | `auto`, em `<img>`, `<link>`, `<script>` e na propriedade `priority` do Fetch API. Suporte Chrome/Edge 102+, Firefox 132+, Safari 17.2+. É **dica, não comando**: *"the browser tries to respect the developer's preference, but it can also apply its resource priority preferences."* Resultados medidos: Google Flights, `fetchpriority="high"` na hero — **LCP 2,6 s → 1,9 s**. Oodle App, prioridade alta só na primeira imagem do carrossel e `low` nas demais — **−2 s no carregamento**.
Fonte: Google/web.dev — https://web.dev/articles/fetch-priority

### 4.2 Lazy loading — e por que nunca no LCP

`loading="lazy"` adia o download até a imagem chegar a **1250px do viewport em 4G rápido** e **2500px em 3G ou pior**. A razão mecânica de nunca aplicá-lo ao LCP: o browser não consegue decidir o lazy-load antes de saber onde a imagem ficará no layout, o que a faz carregar **mais devagar**. Números: a página WordPress mediana **sem** lazy loading tem p75 LCP de **3.495 ms**; **com** lazy loading, **3.768 ms** — ~**7,8% pior**. Em testes A/B de lab em páginas de arquivo, desativar lazy loading melhorou o LCP em **13–15%**. Regra literal: *"Don't lazy-load images that are likely to be in-viewport when the page loads, especially LCP images."*
Fonte: Google/web.dev — https://web.dev/articles/browser-level-image-lazy-loading • https://web.dev/articles/lcp-lazy-loading

### 4.3 Formatos de imagem e responsividade

- **AVIF vs. JPEG:** *"we and others have seen greater than 50% savings vs. JPEG"* — mas o ganho depende fortemente do conteúdo; a própria fonte mostra um caso com ~6% (18.769 B vs 20.036 B). AVIF desde Chrome M85.
- **AVIF vs. WebP:** o web.dev **não publica benchmark numérico**. Desconfie de qualquer fonte que cite porcentagem precisa aqui.
- Encoders melhoraram: libaom 2.0.0 → 3.1.0 trouxe **6,5× menos CPU** e **5× menos memória**.
Fonte: Google/web.dev — https://web.dev/articles/compress-images-avif

**Operação:** `<picture>` com AVIF → WebP → JPEG, e **medir o ganho no acervo real** em vez de assumir 50%. Sempre com `srcset` + `sizes` — servir uma imagem de 2000px para um viewport de 390px desperdiça banda independentemente do formato, e o `sizes` precisa refletir a largura CSS real do slot, ou o browser escolhe o candidato errado.

### 4.4 Fontes

| `font-display` | Block period | Swap period | Quando usar |
|---|---|---|---|
| `auto` | Depende do browser | Depende | Evitar |
| `block` | 2–3 s | Infinito | Só se a fonte é crítica para a marca |
| `swap` | 0 ms | Infinito | Equilíbrio marca/velocidade — gera FOUT |
| `fallback` | 100 ms | 3 s | Meio-termo |
| `optional` | 100 ms | Nenhum | **Melhor para performance e CLS zero** |

Fonte: Google/web.dev — https://web.dev/articles/font-best-practices
- **WOFF2 comprime 30% melhor que WOFF.** **Subsetting** por `unicode-range` é crítico para CJK (>10.000 glifos); para português, `latin` + `latin-ext` já cobre acentuação e cedilha.
- `@font-face` **inline no `<head>`**, não em CSS externo — o browser descobre a fonte sem esperar a folha de estilo. Para terceiros, `<link rel=preconnect crossorigin>` é obrigatório: fontes exigem conexão CORS.
- **`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`** alinham as métricas do fallback às da fonte final e zeram o CLS da troca. **Icon fonts causam CLS severo** (glyph de fallback radicalmente diferente) — trocar por SVG.
- **Self-host vs. Google Fonts:** sem veredito claro na fonte — o Web Almanac chegou a observar que *"sites using third-party fonts had a faster render than fonts that used first-party fonts"*. Self-hosting compensa claramente só com CDN e HTTP/2+. E preload de fonte consome recurso de outros conteúdos críticos: ajustar o CSS costuma ser mais eficaz.

### 4.5 Yielding: `scheduler.yield()` e o que não usar

| API | Suporte | Recomendação |
|---|---|---|
| **`scheduler.yield()`** | Chrome/Edge 129+, Firefox 142+; **Safari não** | **Preferencial.** *"the continuation of the current task will run before any other similar tasks are started"* — a continuação tem prioridade sobre tarefas de terceiros já enfileiradas |
| `scheduler.postTask()` | Chromium | Agendamento explícito com prioridade |
| `setTimeout(fn, 0)` | Universal | Fallback. Após 5 chamadas aninhadas o browser impõe **atraso mínimo de 5 ms**, e o código vai para o **fim** da fila |
| **`isInputPending()`** | Chrome/Edge 87+ | **Desaconselhado.** *"We no longer recommend using this API"* — pode retornar `false` incorretamente e ignora prioridades não-input, como animações |

Fonte: Google/web.dev — https://web.dev/articles/optimize-long-tasks

### 4.6 LoAF — Long Animation Frames

Chrome/Edge 123+ (origin trial 116–122); sem Firefox e Safari. Ocorre quando *"a rendering update is delayed beyond 50 milliseconds"*. Campos: `startTime`, `duration`, `renderStart`, `styleAndLayoutStart`, `firstUIEventTimestamp`, **`blockingDuration`** e **`scripts[]`** (atribuição por script, nome de função, posição de caractere, método de invocação). Substitui a Long Tasks API porque captura **várias tarefas pequenas que juntas atrasam o render** — invisíveis para Long Tasks — e dá atribuição por script com breakdown de render.
Fonte: Chrome for Developers — https://developer.chrome.com/docs/web-platform/long-animation-frames

### 4.7 Speculation Rules

| `eagerness` | Gatilho (desktop) | Limite prefetch | Limite prerender |
|---|---|---|---|
| `immediate` | Assim que as regras são lidas | 50 | 10 |
| `eager` | 10 ms de hover | 2 (FIFO) | 2 (FIFO) |
| `moderate` | **200 ms de hover** (recomendado) | 2 (FIFO) | 2 (FIFO) |
| `conservative` | Pointer/touch down | 2 (FIFO) | 2 (FIFO) |

Em mobile, heurísticas de viewport disparam ~50 ms após o link entrar em tela (`eager`). Suporte Chrome 109+ (eagerness 121+, `target_hint` 138+) e Edge equivalente. Efeito: prerender entrega *"near-instant page load"*, com **LCP próximo de zero**, e melhora também CLS e INP. Fonte: Chrome for Developers — https://developer.chrome.com/docs/web-platform/prerender-pages

### 4.8 bfcache

**1 em cada 10 navegações desktop e 1 em cada 5 mobile são back/forward** — volume grande demais para ignorar. Suporte: Chrome 96+, Firefox e Safari.

| Bloqueador | Correção |
|---|---|
| Handler `unload` | *"Never add an unload event listener!"* — usar `pagehide` |
| `Cache-Control: no-store` no documento | Remover; usar `no-cache` quando o objetivo é revalidar |
| Conexões abertas (IndexedDB, fetch/XHR em voo, WebSocket, WebRTC) | Fechar em `pagehide` |
| `window.opener` sem `rel="noopener"` | Adicionar `rel="noopener"` |

Verificação: DevTools → Application → Back/forward Cache; auditoria dedicada no Lighthouse 10+. Não persiga 100% de hit ratio — fechamento de aba, duplicação e pressão de memória impedem. Fonte: Google/web.dev — https://web.dev/articles/bfcache

### 4.9 Compressão, protocolo e CDN (2025)

| Item | Via CDN | Via origem |
|---|---|---|
| Brotli / Gzip | 46% / 42% | 39% / 61% |
| **Zstandard** | **12%** (era 3% em 2024) | ~0% |
| **HTTP/3** (HTML) | **29%** | **~0%** |
| HTTP/2 (HTML) / TLS 1.3 | 69% / 99% | 79% / menor |

Adoção de CDN: **35% do HTML**, 52% de recursos em subdomínios, 71% de conteúdo de terceiros. Cloudflare lidera HTTP/3 em documentos com 49,9% em mobile; os demais ficam abaixo de 6%. Fonte: Web Almanac 2025, CDN — https://almanac.httparchive.org/en/2025/cdn

Leitura: Brotli continua o padrão seguro para estático (melhor ratio no nível máximo); Zstd ganha em compressão dinâmica, onde a velocidade de compressão importa mais. E o dado mais acionável: **HTTP/3 em servidor de origem é praticamente 0% — sem CDN, não há HTTP/3.**

## 5. Orçamentos de performance

### 5.1 Linha de base do mercado — Web Almanac 2025

| Recurso | Mobile p50 | Mobile p75 | Mobile p90 | Desktop p50 |
|---|---|---|---|---|
| Peso total | **2.164 KB** | 4.119 KB | 8.337 KB | 2.412 KB |
| Requisições | **72** | 116 | 179 | 77 |
| JavaScript | **646 KB** | 1.233 KB | 1.910 KB | 708 KB |
| Imagens | **911 KB** | 2.617 KB | 6.288 KB | 1.058 KB |
| CSS | 79 KB | 156 KB | 268 KB | 83 KB |
| Fontes | 23 KB | 45 KB | 80 KB | 23 KB |
| HTML | 33 KB | 76 KB | 151 KB | 35 KB |

Variação anual: peso total mobile **+8,4%**, desktop +7,3%; requisições +9% mobile, +8% desktop.
Fonte: Web Almanac 2025, Page Weight — https://almanac.httparchive.org/en/2025/page-weight

> **Mediana não é meta.** É o ponto de partida do rebanho — e o rebanho engorda ~8% ao ano. A tabela acima serve para dizer "onde estamos em relação ao mercado", nunca para dizer "está bom".

### 5.2 Orçamento proposto

| Item | Agressivo | Realista | Teto absoluto (falha o build) |
|---|---|---|---|
| Peso total (mobile, comprimido) | ≤ 800 KB | ≤ 1.500 KB | 2.164 KB (mediana de mercado) |
| **JavaScript (comprimido)** | **≤ 170 KB** | **≤ 350 KB** | 646 KB (mediana) |
| Imagens | ≤ 400 KB | ≤ 900 KB | 911 KB (mediana) |
| CSS | ≤ 40 KB | ≤ 79 KB | 156 KB |
| Fontes | ≤ 100 KB (2 pesos WOFF2 subsetados) | ≤ 150 KB | 45 KB é o p75 de mercado |
| Requisições totais | ≤ 40 | ≤ 72 | 116 |
| TBT em lab (Moto G Power / slow 4G) | ≤ 200 ms | ≤ 350 ms | 600 ms |
| LCP em lab | ≤ 2,0 s | ≤ 2,5 s | 4,0 s |

Tetos derivados das medianas do Web Almanac 2025 (fonte na §5.1). **Orçamento que não quebra o CI é decoração**: teto absoluto amarrado a um passo de build que falha, orçamento realista a um alerta.

## 6. Perfil Brasil

### 6.1 Throttling representativo

| Parâmetro | **Padrão Lighthouse** (baseline obrigatório) | **Cenário pessimista BR** |
|---|---|---|
| Download | 1,6 Mbps (1.638 Kbps) | 1,6 Mbps |
| Upload | 750 Kbps | 750 Kbps |
| RTT | **150 ms** | **200–300 ms** |
| Perda de pacote | Nenhuma | Nenhuma |
| **CPU slowdown** | **4×** | **6×** |

O padrão do Lighthouse é o que o PageSpeed Insights usa — é o número que o cliente vai ver, então não se foge dele. O cenário pessimista representa Android de entrada (que domina a base instalada brasileira) e Norte/Nordeste e interior, distantes dos PoPs de CDN concentrados em São Paulo. O throttling **simulado** (padrão) é aplicado em nível de pacote e é recomendado *"for both quick evaluation and minimized variance"*; o do DevTools opera em nível de requisição e é menos fiel — *"in real mobile connectivity, latency affects things at the packet level rather than the request level."*
Fonte: Lighthouse throttling docs — https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md

Calibração por evidência em vez de palpite: CrUX no BigQuery filtrando `country_br` dá o p75 real do público brasileiro. Note que o CrUX **removeu a dimensão ECT (Effective Connection Type) em fevereiro de 2025** e passou a expor Round Trip Time — a segmentação por tipo de conexão não existe mais; usa-se RTT.
Fonte: Chrome for Developers — https://developer.chrome.com/docs/crux/bigquery • https://developer.chrome.com/blog/crux-2025-02

### 6.2 Por que CPU importa mais que banda aqui

**TBT mediano mobile: 1.916 ms. Desktop: 92 ms. Razão de ~21×.** E o TBT mobile **subiu 58%** em 2025, mesmo com o INP melhorando — o INP só não piorou porque hardware e yielding compensaram. É dívida técnica acumulando. Fonte: Web Almanac 2025, Performance — https://almanac.httparchive.org/en/2025/performance

Isso não é rede, é processamento: *"the median p75 image load duration is only 20% slower on mobile than desktop"*. A rede móvel melhorou muito; **a lacuna de CPU não**. Fonte: Google/web.dev — https://web.dev/blog/common-misconceptions-lcp

**Conclusão operacional para público majoritariamente mobile brasileiro: cortar JavaScript vale mais que cortar bytes de imagem.** O gap desktop-mobile de INP caiu de 23 para 20 pontos percentuais entre 2024 e 2025 — está fechando, devagar.

Erro comum a evitar: testar do escritório em São Paulo, em fibra, num MacBook, e concluir que o site está bom. Esse teste mede a rede do escritório, não o produto.

## 7. Argumento de negócio

### 7.1 Deloitte / 55 — "Milliseconds Make Millions"

37 marcas europeias e americanas, mais de 30 milhões de sessões, comissionado pelo Google. Testou **0,1 s** de melhoria.

| Setor | Resultado com 0,1 s de ganho |
|---|---|
| Varejo | **+8,4%** conversão; +9,2% ticket médio |
| Viagens | **+10,1%** conversão; +10% reservas; +2,2% conclusão de checkout |
| Luxo | **+40,1%** progressão PDP → carrinho; +20,6% progressão para "Fale conosco" |
| Geração de leads | **+21,6%** envio de formulário; +7% page views |

Progressões intermediárias no varejo: +3,2% listagem → detalhe; +9,1% detalhe → carrinho. Fonte: Google/web.dev — https://web.dev/case-studies/milliseconds-make-millions • Relatório: Think with Google / Deloitte — https://www.thinkwithgoogle.com/_qs/documents/9757/Milliseconds_Make_Millions_report_hQYAbZJ.pdf

### 7.2 O caso que serve para o Brasil: Nuvemshop

> **Nuvemshop (LatAm/Brasil, e-commerce).** LCP melhorou **68%** (aprovação de LCP 57% → 96%); CWV completos 48% → 72%. Resultado: **+8,9% na conversão sessão → pedido pago** e **+8,4% de engajamento no carrinho**, em mobile com tráfego orgânico do Google.
>
> **O detalhe técnico é o que torna o caso útil: a causa raiz não era peso de imagem nem latência de servidor.** Eram três coisas — transições CSS na primeira seção atrasando a detecção do elemento LCP, `loading="lazy"` acima da dobra, e ausência de `fetchpriority="high"`. Ou seja: exatamente o Resource Load Delay da §2.0, não o Resource Load Duration.
>
> É o benchmark de maior valor argumentativo para cliente brasileiro: mesmo mercado, mesmo perfil de dispositivo, mesmo tipo de e-commerce.
>
> Fonte: Google/web.dev — https://web.dev/case-studies/nuvemshop

### 7.3 Outros casos com CWV

| Empresa | Melhoria técnica | Resultado de negócio |
|---|---|---|
| Rakuten 24 | Investimento em CWV | +53,37% receita por visitante; +33,13% conversão |
| Vodafone | LCP +31% | +8% em vendas |
| Lazada | LCP 3× melhor | +16,9% conversão mobile |
| redBus | Otimização de INP / CLS + 3rd party | +7% em vendas / +80–100% conversão mobile |
| Tokopedia | LCP +55% | +23% duração média de sessão |
| GYAO | LCP 3,1× melhor | +108% CTR |
| The Economic Times | Aprovação nos limiares CWV | −43% bounce rate |
| iCook / Netzwelt | CLS +15% / otimização CWV | +10% / +18% receita de anúncios |
| BBC | — | Perde 10% dos usuários a cada segundo adicional de carregamento |

Fonte: Google/web.dev — https://web.dev/case-studies/vitals-business-impact • https://web.dev/learn/performance/why-speed-matters

### 7.4 O que não usar como evidência

> **Amazon "100 ms = 1% de receita" e Walmart "1 s = +2% de conversão" são folclore da indústria.** São números de 2006–2012, apresentados em conferências, **sem publicação primária verificável**. Citá-los como evidência enfraquece o argumento na primeira vez que alguém pedir a fonte.
>
> Substitutos com fonte publicada: Deloitte/55, Vodafone, Rakuten 24 e, para audiência brasileira, **Nuvemshop**.

## 8. SEO — o que o Google literalmente diz

Citações da documentação oficial:

- *"Google's core ranking systems look to reward content that provides a good page experience."*
- *"Google Search always seeks to show the most relevant content, even if the page experience is sub-par."*
- *"There is no single signal. Our core ranking systems look at a variety of signals that align with overall page experience."*
- *"Core Web Vitals are used by our ranking systems."*
- *"getting good results in reports like Search Console's Core Web Vitals report or third-party tools doesn't guarantee that your pages will rank at the top."*
- *"there's more to great page experience than Core Web Vitals scores alone."*

Fonte: Google Search Central — https://developers.google.com/search/docs/appearance/page-experience (atualizado em 10/12/2025) • https://developers.google.com/search/docs/appearance/core-web-vitals

**Conclusão operacional: CWV é desempate, não alavanca.** Entre duas páginas de relevância equivalente, a mais rápida ganha; nenhum ganho de CWV compensa conteúdo irrelevante. O Google **nunca publicou peso numérico** do sinal — quem cita "CWV vale X% do algoritmo" está inventando. **Performance não se vende como SEO:** o argumento honesto é conversão e receita (§7); o ganho de ranking é real, marginal e não quantificado pela fonte.

## 9. Armadilhas

### 9.1 Score 100 no Lighthouse ≠ site rápido

Pesos do score: **TBT 30%**, LCP 25%, CLS 25%, FCP 10%, Speed Index 10%. Faixas: 0–49 vermelho, 50–89 laranja, 90–100 verde. A curva é calibrada contra o HTTP Archive — *"the 25th percentile of HTTP Archive data becomes a score of 50"* e *"the 8th percentile becomes a score of 90."*
Fonte: Chrome for Developers — https://developer.chrome.com/docs/lighthouse/performance/performance-scoring

Cinco razões pelas quais o score engana:

1. **O maior peso do score (TBT, 30%) é um proxy.** O usuário sente INP, não TBT — e *"a page may have poor INP despite having very good TBT scores"*, pelo atraso de toque de 300 ms em sites não mobile-otimizados, que conta para INP e não para TBT.
2. **Lighthouse não mede INP.** *"Lab tests… cannot accurately predict when users will choose to interact with a page, and thus cannot accurately measure"* o INP. Um terço dos Core Web Vitals é estruturalmente invisível ao lab.
3. **O CLS do Lighthouse é parcial** — só shifts acima da dobra e durante o carregamento. Ads injetados no scroll, embeds tardios e conteúdo pós-interação não aparecem.
4. **Uma execução em uma máquina não é uma distribuição.** Ver §9.2.
5. **O score não é o que o Google usa para ranquear.** O Search usa **CrUX (campo)**, não Lighthouse.

Fonte: Google/web.dev — https://web.dev/articles/lab-and-field-data-differences • Google Search Central — https://developers.google.com/search/docs/appearance/page-experience
**Regra:** o Lighthouse é bom para dizer **por que** o site está lento. É péssimo para dizer **se** está lento. Para isso, CrUX e RUM.

### 9.2 Variabilidade

*"A lot of the variability in your overall Performance score and metric values is not due to Lighthouse. When your Performance score fluctuates it's usually because of changes in underlying conditions."* Causas listadas: testes A/B, roteamento de tráfego, variação de dispositivo, extensões de navegador, antivírus. Recomendação oficial: tratar o desempenho *"as a distribution of scores, rather than a single number."*
Fonte: Chrome for Developers — https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
Na prática: **no mínimo 5 execuções, e usa-se a mediana**. Um único número de Lighthouse não é evidência de nada.

### 9.3 Lab vs. campo

| Aspecto | Lab (Lighthouse, WebPageTest) | Campo (CrUX, RUM) |
|---|---|---|
| Amostra | 1 dispositivo, 1 rede, 1 geografia | Distribuição real |
| **INP** | **Não mensurável** | Mensurável |
| CLS | Só acima da dobra e durante o load | Ciclo de vida inteiro, incluindo scroll e pós-interação |
| Uso correto | Detectar regressão antes do deploy; debugar causa raiz | Julgar a experiência real e definir prioridade |

Fonte: Google/web.dev — https://web.dev/articles/lab-and-field-data-differences

**INP não é medível em laboratório.** O robô não sabe quando nem onde o usuário vai clicar — um número de INP apresentado como saída de Lighthouse é invenção. O proxy de lab é o **TBT**, com dois modos de erro: falso positivo (TBT alto sem interação do usuário no período de bloqueio) e falso negativo (INP ruim com TBT bom, caso clássico do atraso de toque de 300 ms). Fonte: Google/web.dev — https://web.dev/articles/tbt

**Por que um site pode não ter dado de campo:** o CrUX exige página publicamente descobrível (HTTP 200, sem `noindex`) e "suficientemente popular" (limiar não divulgado), e usuário com reporte de estatísticas ativado, histórico sincronizado e sem passphrase de sync. **Chrome no iOS, Android WebView e outros navegadores Chromium não contribuem dados.**
Fonte: Chrome for Developers — https://developer.chrome.com/docs/crux/methodology

**Erro correlato:** o PageSpeed Insights mostra CrUX (campo) no topo e Lighthouse (lab) na base. Tratar as duas metades como a mesma coisa é o erro mais frequente em relatório de performance — a de cima diz como está a experiência real, a de baixo diz o que investigar.

## 10. Datado — revisar a cada ciclo

<details>
<summary><strong>Mudanças de métrica por ano (2024–2026)</strong></summary>

| Data | Mudança | Fonte |
|---|---|---|
| 12/03/2024 | INP vira Core Web Vital oficial, substituindo o FID | https://web.dev/blog/inp-cwv-march-12 |
| 09–10/09/2024 | Chrome encerra suporte ao FID; PSI, PSI API e CrUX API param de reportar | https://web.dev/blog/fid |
| Out/2024 | Struct `first_input` removida do CrUX BigQuery (dataset 202409) | https://web.dev/blog/fid |
| Fev/2025 | CrUX ganha **subpartes de imagem LCP** e LCP resource types; dimensão **ECT é removida** | https://developer.chrome.com/blog/crux-2025-02 |
| Mai/2025 | web-vitals.js v5.0 remove `onFID()` (breaking change) | https://web.dev/blog/fid |
| 12/12/2025 | LCP e INP tornam-se **Baseline Newly available** com o Safari 26.2 | https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available |
| 20/04/2026 | Origin trial **final** da Soft Navigations API (Chrome 147–149) | https://developer.chrome.com/blog/final-soft-navigations-origin-trial |

**Veredito até agosto/2026: nenhuma métrica nova entrou nos Core Web Vitals e nenhum limiar numérico mudou desde 2024.** As mudanças foram de instrumentação e cobertura.

</details>

<details>
<summary><strong>Soft Navigations API — o que muda quando lançar</strong></summary>

Permitirá medir LCP (entradas `interaction-contentful-paint` e `soft-navigation`), CLS, INP e FCP em SPAs, que hoje só têm as métricas do primeiro carregamento. Escopo do trial, nas palavras do Chrome: *"This origin trial is to evaluate the new API and not how this data will be used in CrUX or tooling."* Ship previsto ainda em 2026. Até lá, num SPA as métricas cobrem só a navegação inicial — rotas internas não aparecem nem no CrUX nem no Lighthouse, então um SPA pode ter CWV excelentes e ser lento em uso real.
Fonte: Chrome for Developers — https://developer.chrome.com/blog/final-soft-navigations-origin-trial

</details>

<details>
<summary><strong>Status Baseline e cobertura por engine</strong></summary>

**LCP e INP: Baseline Newly available desde 12/12/2025** (Safari 26.2 completou os três engines). **CLS ainda é Chromium-only**, proposto para o Interop 2026. Fonte: Google/web.dev — https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available

**Consequência prática:** o RUM próprio passa a coletar LCP/INP também de Safari e Firefox, enquanto o CrUX continua só com Chrome elegível. Espere **divergência crescente entre RUM e CrUX** — é cobertura diferente, não bug.
Suporte das APIs de otimização: `scheduler.yield()` Chrome/Edge 129+, Firefox 142+, **sem Safari**; LoAF Chrome/Edge 123+, sem Firefox e Safari; Speculation Rules Chrome 109+/Edge, sem Firefox e Safari; `fetchpriority` Chrome/Edge 102+, Firefox 132+, Safari 17.2+ — este já é seguro em todos os engines.

</details>
