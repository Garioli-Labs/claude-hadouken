# Front-end: implementação e patch por stack

Este arquivo responde a pergunta "como corrijo isto **nesta** stack". As duas stacks com profundidade são **HTML/CSS/JS puro** e **React/Next.js + Tailwind**. Fora delas, o princípio continua valendo e o patch precisa ser traduzido.

## Índice

1. [Detecção de stack em 30 segundos](#1-detecção-de-stack-em-30-segundos)
2. [HTML que muda resultado](#2-html-que-muda-resultado)
3. [Elementos modernos com snippet pronto](#3-elementos-modernos-com-snippet-pronto)
4. [Suporte do CSS moderno](#4-suporte-do-css-moderno)
5. [Arquitetura CSS](#5-arquitetura-css)
6. [Correções por sintoma, nas duas stacks](#6-correções-por-sintoma-nas-duas-stacks)
7. [Escolha de framework](#7-escolha-de-framework)
8. [Renderização: SSG, SSR, ISR, CSR, edge](#8-renderização-ssg-ssr-isr-csr-edge)
9. [Imagens e mídia](#9-imagens-e-mídia)
10. [Quality gate de CI](#10-quality-gate-de-ci)
11. [SEO técnico e AEO](#11-seo-técnico-e-aeo)
12. [Segurança e LGPD no front-end](#12-segurança-e-lgpd-no-front-end)

---

## 1. Detecção de stack em 30 segundos

Ordem de checagem: (a) `view-source:` da URL — HTML renderizado ou casca vazia; (b) headers de resposta; (c) nomes de arquivo nos `<script>`/`<link>`; (d) se houver repositório, `package.json`.

| Sinal observado | Stack provável | Onde ficam estilos e componentes |
|---|---|---|
| `<div id="__next">` ou `<script id="__NEXT_DATA__">`; `/_next/static/...` | Next.js (Pages Router antigo se houver `__NEXT_DATA__`) | `app/` ou `pages/`, `components/`, `styles/globals.css` |
| `self.__next_f.push(` no HTML; `/_next/static/chunks/app/` | Next.js App Router (RSC) | `app/**/page.tsx`, `app/layout.tsx`, `app/globals.css` |
| Header `x-powered-by: Next.js`, `x-nextjs-cache: HIT/STALE` | Next.js com ISR/Cache Components | mesma árvore `app/` |
| `<div id="root">` vazio + um bundle `assets/index-<hash>.js` | Vite + React SPA (CSR puro) | `src/`, `src/index.css`, `src/components/` |
| Classes utilitárias empilhadas (`flex items-center gap-4 rounded-xl`) | Tailwind | `globals.css`/`app.css` com `@import "tailwindcss"` (v4) ou `tailwind.config.js` (v3) |
| CSS com `@theme { --color-... }` | Tailwind **v4** (CSS-first) | o próprio arquivo CSS de entrada é a configuração |
| Classe com hash `Button_root__x1f2z` | CSS Modules | `Button.module.css` ao lado do componente |
| Classe `sc-abc123` / `css-1x2y3z` | CSS-in-JS runtime (styled-components / Emotion) | dentro do arquivo do componente |
| `astro-` prefixado em classes; `<astro-island>` no HTML | Astro | `src/pages/*.astro`, `src/components/`, estilo `<style>` no `.astro` |
| `wp-content/themes/...`, `wp-includes/` | WordPress | `style.css` do tema, `functions.php`, page builder |
| `cdn.shopify.com`, `Shopify.theme` | Shopify | `assets/*.css`, `sections/*.liquid`, `snippets/` |
| `data-hx-*` / `hx-get` | HTMX sobre backend server-rendered | templates do backend (ERB, Blade, Jinja, Razor) |
| Nada além de `<link rel="stylesheet" href="style.css">` e um `script.js` | HTML/CSS/JS puro | os próprios arquivos na raiz ou em `/assets` |

Dois testes que valem mais que a lista: **desligar o JavaScript** (se o conteúdo some, é CSR e isso já é um achado) e **`Ctrl+U`** para comparar o HTML bruto com o DOM renderizado (divergência de `canonical`, `title` e conteúdo principal é achado de SEO).

Erros de acessibilidade variam brutalmente por stack, o que ajuda a calibrar a expectativa: Astro 9,0 erros por página, WordPress 52,8, jQuery 64,9, Shopify 75,1, Prestashop 143,2 — contra média de 56,1. Fonte: WebAIM Million 2026 — https://webaim.org/projects/million/

---

## 2. HTML que muda resultado

Só paga a semântica que altera a **árvore de acessibilidade** ou o **comportamento nativo**. O resto é cosmético.

### Landmarks e estrutura

- `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<search>` dão navegação por regiões no leitor de tela. **Um `<main>` por página.**
- `<search>` é *Widely available* desde abril de 2026 e já carrega a role `search` implícita — dispensa `role="search"` num `<div>`. Fonte: MDN — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/search
- Ordem de heading: `h1` → `h2` → `h3` sem pular nível, **um `h1` por página**. Navegação por heading é o caminho principal de leitura em leitores de tela.
- Listas reais: `<ul>`/`<ol>` anunciam contagem ("lista com 6 itens"); `<div>` empilhado não anuncia nada.

### `<button>` vs `<div>` vs `<a>` — a consequência exata de cada troca

| Troca feita | O que se perde, concretamente |
|---|---|
| `<button>` → `<div onclick>` | Deixa de receber foco por Tab; deixa de ativar por Enter **e** Espaço; perde a role `button` (leitor de tela anuncia como texto solto); perde `disabled`; deixa de submeter `<form>`. Recriar tudo exige `tabindex="0"` + `role="button"` + handler de `keydown` para Enter e Espaço + `aria-disabled` — e quase ninguém recria completo |
| `<a href>` → `<a>` sem `href` | Deixa de ser focável e some da lista de links do leitor de tela; vira um `<span>` com sublinhado |
| `<a href>` usado como ação na página | O usuário ganha "abrir em nova aba", copiar link e histórico para algo que não é navegação; leitor de tela anuncia "link", criando expectativa de ir a outro lugar |
| `<button>` usado como navegação | Perde abrir em nova aba, `Ctrl+clique`, arrastar para favoritos, e o crawler não segue |

Regra: **`<a href>` muda de URL; `<button>` age na página.** Se muda a URL, é link, ainda que pareça botão.

### Metadados: o mínimo não negociável

```html
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b0c" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="https://exemplo.com.br/pagina">
<meta property="og:title" content="…">
<meta property="og:image" content="https://exemplo.com.br/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
```

Nunca use `maximum-scale=1` nem `user-scalable=no` — viola WCAG 1.4.4 (Resize Text). `theme-color` com `media` permite valor distinto para claro e escuro. `canonical` precisa estar no HTML inicial, não injetado por JS.

### Os erros de HTML mais comuns em produção

<details>
<summary>Prevalência em home pages — WebAIM Million 2026 (dado de fev/2026, verificado em 31/08/2026)</summary>

| Falha | % das home pages |
|---|---|
| Texto com contraste baixo | **83,9%** |
| Imagem sem texto alternativo | 53,1% |
| Input de formulário sem label | 51,0% |
| Link vazio (só ícone, sem nome acessível) | 46,3% |
| Botão vazio | 30,6% |
| Documento sem `lang` | 13,5% |

95,9% das home pages têm falhas WCAG detectáveis (era 94,8%), com média de 56,1 erros por página (+10,1% em um ano). Complexidade média subiu 22,5%, para 1.437 elementos. Uso de ARIA cresceu 27% — e páginas **com** ARIA têm **59,1** erros contra **42** nas sem ARIA: ARIA mal usado piora o resultado.

Fonte: WebAIM Million 2026 — https://webaim.org/projects/million/
</details>

---

## 3. Elementos modernos com snippet pronto

### `<dialog>` + `showModal()` + `::backdrop`

```html
<button id="abrir">Solicitar proposta</button>

<dialog id="dlg" aria-labelledby="dlg-titulo">
  <h2 id="dlg-titulo">Solicitar proposta</h2>
  <form method="dialog">
    <button value="cancelar" autofocus>Fechar</button>
  </form>
</dialog>

<style>
  #dlg::backdrop { background: rgb(0 0 0 / .5); }
</style>

<script>
  const dlg = document.getElementById('dlg');
  document.getElementById('abrir').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', () => { /* dlg.returnValue tem o value do botão */ });
</script>
```

Teclado, de graça com `showModal()`: **Esc fecha**, o foco fica **preso dentro do dialog**, o resto da página vira inerte, e o foco **volta ao elemento que abriu** no fechamento. Com `dlg.show()` (não-modal) você perde tudo isso — use `showModal()` para modal de verdade. `autofocus` define onde o foco pousa; sem ele o navegador foca o primeiro elemento focável.

### Popover API

```html
<button popovertarget="menu-conta">Minha conta</button>
<div id="menu-conta" popover>
  <a href="/perfil">Perfil</a>
  <a href="/sair">Sair</a>
</div>
```

`popover` (auto, o padrão) dá top-layer nativo, **light-dismiss** (clique fora fecha), **Esc fecha** e foco que retorna ao invocador. `popover="manual"` desliga o light-dismiss e exige `showPopover()`/`hidePopover()`. Baseline *newly available* desde janeiro de 2025. Fonte: MDN — https://developer.mozilla.org/en-US/docs/Web/API/Popover_API

### Anchor positioning

```css
#gatilho { anchor-name: --gatilho; }

#menu-conta {
  position-anchor: --gatilho;
  position-area: block-end span-inline-end;   /* abaixo, alinhado à direita */
  position-try-fallbacks: flip-block;          /* vira para cima se não couber */
  margin: 0;                                   /* zera o margin:auto do UA para [popover] */
}
```

Substitui Floating UI/Popper (~10 KB). Baseline *newly available* desde janeiro de 2026 — maior crescimento de uso do ano (+15%). Fonte: MDN — https://developer.mozilla.org/en-US/docs/Web/CSS/anchor-name

### `<details>` / `<summary>` — acordeão nativo

```html
<details name="faq">
  <summary>Vocês atendem em todo o Brasil?</summary>
  <p>Sim, com entrega em até 5 dias úteis.</p>
</details>
<details name="faq">
  <summary>Qual a forma de pagamento?</summary>
  <p>Pix, boleto e cartão em até 12×.</p>
</details>
```

`name` igual em vários `<details>` cria acordeão **exclusivo** (abrir um fecha o outro) sem JS. Teclado: `<summary>` é focável por Tab e alterna com Enter **e** Espaço nativamente. Animar a abertura exige `interpolate-size: allow-keywords` + `::details-content` — trate como progressive enhancement.

### `inert`

```html
<main id="conteudo" inert>…</main>   <!-- enquanto o drawer está aberto -->
<aside id="drawer">…</aside>
```

```js
conteudo.inert = drawer.classList.contains('aberto');
```

`inert` remove a subárvore inteira do foco, do clique e da árvore de acessibilidade — é o que faz um overlay feito à mão se comportar como modal. Com `<dialog>.showModal()` isso já é automático; `inert` é para drawers, off-canvas e menus mobile em tela cheia.

### `<search>`

```html
<search>
  <form action="/busca" method="get" role="none">
    <label for="q">Buscar no site</label>
    <input id="q" name="q" type="search" autocomplete="off">
    <button type="submit">Buscar</button>
  </form>
</search>
```

Landmark de busca sem `role="search"` manual. O `<label>` visível (ou `<label class="sr-only">`) é obrigatório: `placeholder` não é nome acessível.

---

## 4. Suporte do CSS moderno

<details>
<summary>Tabela de status Baseline — dados do dossiê (ago/2026), com verificação pontual em 31/08/2026</summary>

| Recurso | Status Baseline | Para que serve na prática |
|---|---|---|
| `:is()` / `:where()` | Widely available | `:where()` zera especificidade — base de reset e design system |
| `clamp()` / `min()` / `max()` | Widely available | Tipografia e espaçamento fluidos sem media query |
| `aspect-ratio` | Widely available (81,3% de uso) | Reserva de espaço → mata CLS de mídia |
| `gap` em flexbox | Widely available | Fim do hack de margin negativa |
| Logical properties | Widely available | `inline-start`/`block-end`: i18n e RTL sem CSS duplicado |
| Custom properties + `@property` | Widely available | `@property` permite **animar** gradiente e cor |
| `color-mix()` / cores relativas | Widely available | Escalas de cor no próprio CSS, sem Sass |
| `oklch()` | Widely available | Espaço perceptualmente uniforme; contraste previsível; gamut P3 |
| `light-dark()` | Baseline 2024 (mai/2024) | `color: light-dark(#111, #eee)` — um valor, dois temas |
| `accent-color` | Widely available | Cor de marca em checkbox/radio/range nativos |
| Container queries (`@container`, `cqi`) | Widely available | Componente responde ao container, não à viewport |
| `:has()` | Widely available (jun/2026) — 83,7% de uso | `form:has(:invalid)`, `.card:has(img)` |
| Nesting nativo | Widely available (70,6% de uso) | Aninhamento sem pré-processador |
| Cascade layers (`@layer`) | Widely available | Ordem de cascata explícita — fim da guerra de especificidade |
| `@scope` | Newly available (dez/2025) | Escopo com limite, sem CSS Modules |
| Subgrid | Widely available (mar/2026) | Alinhar filhos de cards diferentes na mesma grade |
| `scroll-snap` | Widely available | Carrossel sem JS |
| `@starting-style` + `transition-behavior: allow-discrete` | Baseline 2024 (ago/2024) | Animar entrada/saída de `display:none`, dialog e popover |
| `text-wrap: balance` / `pretty` | Baseline 2024 (out/2024) | Título equilibrado; sem órfã no corpo. `balance` limitado a 6 linhas (Chromium) / 10 (Firefox) |
| `field-sizing` | Newly available (jun/2026) | `textarea` que cresce com o conteúdo, sem JS |
| `contrast-color()` | Newly available (abr/2026) | Preto ou branco escolhido automaticamente sobre qualquer fundo |
| `shape()` | Newly available (fev/2026) | Formas com sintaxe CSS em vez de comandos SVG |
| Container **style** queries | Newly available (mai/2026) | `@container style(--tema: escuro)` |
| View transitions **same-document** | Newly available (out/2025) | Transição SPA nativa |
| View transitions **cross-document** (`@view-transition`) | ⚠️ **Limited availability** | MPA com transição. Foco do Interop 2026 |
| Scroll-driven animations (`animation-timeline`) | ⚠️ **Limited availability** | Barra de progresso, reveal on scroll |
| `popover="hint"` | ⚠️ **Limited availability** | Tooltip nativa com pilha própria de hint |
| `@custom-media` | ❌ Não implementado | Continua sendo PostCSS |

**Checagem pontual em 31/08/2026** (os três itens marcados como *Limited* no dossiê continuam *Limited*, com os detalhes abaixo):

- **Cross-document view transitions (`@view-transition`)** — segue **Limited availability**: "não é Baseline porque não funciona em alguns dos navegadores mais usados". Fonte: MDN — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition
- **Scroll-driven animations (`animation-timeline`)** — segue **Limited availability**. Chrome/Edge 115 (jul/2023), Safari 26 (set/2025); **Firefox não implementou** e é o bloqueio desde set/2025. Fonte: Web Platform Features Explorer — https://web-platform-dx.github.io/web-features-explorer/features/scroll-driven-animations/
- **`popover="hint"`** — segue **Limited availability**, mas **mudou desde o dossiê**: Firefox 153 (21/07/2026) e Chrome/Edge 151 (28–31/07/2026) já suportam; agora o bloqueio é o **Safari**. Em navegador sem suporte, `popover="hint"` faz fallback para `popover="manual"` (sem light-dismiss). Fontes: Web Platform Features Explorer — https://web-platform-dx.github.io/web-features-explorer/features/popover-hint/ · MDN — https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using

Fontes da tabela: web.dev Baseline digests — https://web.dev/blog/baseline-digest-jun-2026 · https://web.dev/blog/baseline-digest-may-2026 · web.dev — https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
</details>

### Regra de adoção: enhancement, não dependência

Tudo que está como *Limited availability* entra sob `@supports`, com a página funcionando sem o recurso:

```css
@supports (animation-timeline: scroll()) {
  .progresso { animation: crescer linear both; animation-timeline: scroll(root); }
}
```

Curiosidade útil em diagnóstico: no State of CSS 2026, container size queries e Grid **ainda aparecem na lista de dores de compatibilidade**, mesmo sendo *Widely available*. O gargalo virou percepção do time, não navegador. Fonte: https://2026.stateofcss.com/en-US/usage/

---

## 5. Arquitetura CSS

| Abordagem | Quando faz sentido | Custo real |
|---|---|---|
| **BEM / semântico** | Site de conteúdo, time pequeno, HTML gerado por CMS | Nomear é caro; CSS morto acumula; escala mal sem disciplina |
| **Utility-first (Tailwind v4)** | App com componentes, time grande, design system fechado | HTML verboso; curva de onboarding; markup acoplado ao estilo |
| **CSS Modules** | Vite/Next sem runtime; quer escopo com CSS "normal" | Precisa de bundler; composição de tema mais manual |
| **CSS-in-JS runtime** | Praticamente nunca em 2026 | Custo de runtime no INP, serialização em SSR, incompatível com RSC |
| **Zero-runtime (vanilla-extract, Panda, StyleX)** | Type-safety com extração em build | Complexidade de build |

**Como escolher:** site estático/marketing → CSS moderno puro com `@layer` + custom properties + `@scope`, e Tailwind só se o time já domina. App com design system → Tailwind v4 **ou** CSS Modules + tokens, decidido por operação de time. Biblioteca publicada → CSS Modules ou zero-runtime; nunca force Tailwind no consumidor.

### Cascade layers resolvem especificidade de verdade

```css
@layer reset, base, componentes, utilitarios;

@layer componentes { .card__titulo { color: var(--cor-titulo); } }
@layer utilitarios  { .text-danger  { color: var(--cor-erro); } }
/* utilitarios vence sempre, sem !important e sem contar seletores */
```

A ordem de declaração das camadas decide o vencedor **antes** da especificidade. É isso que dissolve o falso dilema "utility vs semantic": classes semânticas na camada de componente, utilitários numa camada acima. Quando encontrar `!important` espalhado, a correção estrutural é `@layer`, não mais `!important`.

### Por que CSS-in-JS de runtime caiu

Três motivos, nessa ordem: (1) custo de runtime — serializar e injetar estilo a cada render aparece direto no INP; (2) incompatibilidade com React Server Components, que não têm contexto de runtime no servidor; (3) a plataforma resolveu o problema original — escopo (`@scope`, CSS Modules), variáveis (custom properties) e especificidade (`@layer`) são nativos. `styled-components` entrou em modo de manutenção. Fonte: OpenReplay — https://blog.openreplay.com/state-css-in-js-2026/

### Tailwind v4 CSS-first

```css
@import "tailwindcss";

@theme {
  --color-marca-500: oklch(0.72 0.15 250);
  --color-marca-600: oklch(0.62 0.15 250);
  --font-display: "Inter Variable", system-ui, sans-serif;
  --breakpoint-3xl: 1920px;
  --spacing: 0.25rem;
}
```

Sem `tailwind.config.js`: o arquivo CSS de entrada **é** a configuração, e cada token vira utilitário (`bg-marca-500`, `3xl:grid-cols-4`) e custom property consultável em runtime. A engine Oxide levou o build completo de 378ms para **100ms** e o rebuild incremental sem CSS novo de 35ms para **192µs** (182×). Container queries são nativas (`@container` + `@sm:`), sem plugin; variantes novas incluem `@starting-style`, `not-*`, `inert`, `in-*`, `:popover-open` e `field-sizing`. Como v4 usa cascade layers, `@property`, `color-mix()`, `oklch` e logical properties internamente, ele exige navegadores recentes. Fonte: Tailwind Labs — https://tailwindcss.com/blog/tailwindcss-v4

---

## 6. Correções por sintoma, nas duas stacks

Esta é a tabela de patch. Coluna do meio = HTML/CSS/JS puro; coluna da direita = React/Next.js + Tailwind.

| Sintoma medido | HTML / CSS / JS puro | React / Next.js + Tailwind |
|---|---|---|
| **CLS de imagem** (imagem sem dimensão; 62% das páginas mobile têm ao menos uma) | `width` e `height` reais no `<img>` (o navegador deriva o `aspect-ratio`); em imagem fluida, `img { height: auto }` para não distorcer; container com `aspect-ratio` quando o crop é fixo | `next/image` com `width`/`height` ou `fill` + wrapper `relative aspect-video`; classe `h-auto w-full`; para imagem remota, declarar `images.remotePatterns` |
| **CLS de fonte** (texto salta quando a webfont carrega) | `font-display: swap` **mais** métricas de fallback: `size-adjust`, `ascent-override`, `descent-override` num `@font-face` local; `<link rel="preload" as="font" crossorigin>` só na fonte do texto acima da dobra | `next/font/local` ou `next/font/google` — gera fallback com métricas ajustadas e auto-hospeda o arquivo (sem request a terceiro); aplicar a variável da fonte no `<html>` e referenciá-la em `@theme { --font-sans: ... }` |
| **LCP lento** | Identificar o elemento LCP; `fetchpriority="high"` nele; **remover** `loading="lazy"` dele; `preconnect` para a origem da imagem; CSS crítico inline e o resto com `media="print" onload`; nunca esconder o herói atrás de JS | Mesmo diagnóstico + `priority` no `next/image` do herói; render no servidor (Server Component) em vez de `useEffect`; evitar `next/dynamic` com `ssr:false` no bloco do herói; evitar CSS-in-JS runtime, que atrasa a primeira pintura |
| **INP alto** | Quebrar tarefa longa com `await scheduler.yield()`; `passive: true` em listeners de scroll/touch; delegar evento no lugar de centenas de listeners; tirar terceiros do caminho crítico com `async`/`defer` | Reduzir JS do cliente: mover lógica para Server Component; `startTransition` para atualização não urgente; `useDeferredValue` em filtro/busca; memoizar lista pesada (ou React Compiler); nunca fazer trabalho pesado dentro de `onChange` de input controlado |
| **Foco invisível** | Nunca `outline: none` sem substituto. `:focus-visible { outline: 2px solid; outline-offset: 2px; }` — precisa de contraste 3:1 contra o fundo adjacente (WCAG 2.4.11) | O reset do Tailwind já remove o outline padrão: aplicar `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--cor-foco]` no componente base de botão/link; garantir que o estilo não seja sobrescrito por `focus:outline-none` copiado de exemplo |
| **Contraste insuficiente** (83,9% das home pages) | Corrigir o token, não a instância: recalcular a rampa em `oklch()` mantendo o matiz e reduzindo a luminância; `contrast-color()` sob `@supports` para texto sobre cor variável | Ajustar o valor em `@theme` — muda todas as ocorrências de uma vez; evitar `text-gray-400` sobre branco (falha em corpo de texto); classe utilitária arbitrária só como exceção documentada |
| **Target pequeno** (< 24×24 CSS px, WCAG 2.5.8) | Aumentar a área clicável sem inchar o visual: `padding` no `<a>`/`<button>`, ou pseudo-elemento `::after { position:absolute; inset:-8px }` no botão com `position:relative`; espaçar itens vizinhos | Utilitários `min-h-11 min-w-11` (44px, alvo confortável em mobile) ou `p-3` no botão de ícone; em ícone dentro de card, usar overlay com `after:absolute after:inset-0` para o link cobrir o card |
| **Modal inacessível** (sem foco preso, Esc não fecha, foco não volta) | Trocar `<div class="modal">` por `<dialog>` + `showModal()` — resolve foco preso, Esc, inércia do fundo e retorno do foco. Se o markup não puder mudar, `inert` no `<main>` + gerência manual de foco | `<dialog>` num Client Component com `useRef` chamando `showModal()`/`close()`; ou Radix/Headless UI, que já implementam foco preso e `aria-modal`; evitar modal caseiro com `z-index` e `onClick` no backdrop |
| **Form sem label** (51,0% das home pages) | `<label for="id">` visível, ou `aria-label` quando o rótulo é claramente visual; `placeholder` **não** é rótulo (some ao digitar e falha em contraste); agrupar radio/checkbox em `<fieldset><legend>`; `autocomplete` correto (`name`, `email`, `tel`, `postal-code`) | `useId()` para gerar id estável entre servidor e cliente e ligar `htmlFor`/`id`; em React Hook Form, o `register` não cria label — o `<label>` continua sendo responsabilidade do markup; erro ligado ao campo por `aria-describedby` e anunciado em região `aria-live="polite"` |
| **Animação sem `prefers-reduced-motion`** | Envolver transições e parallax em `@media (prefers-reduced-motion: no-preference)`, ou neutralizar em bloco: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important } }` | Variante `motion-safe:` para o que anima e `motion-reduce:` para o que neutraliza; em Framer Motion, `useReducedMotion()` para desligar o movimento em vez de só encurtar |
| **Hidratação desnecessária** (JS carregado para página sem estado) | Não existe: sem framework não há hidratação. Manter o padrão — `<details>`, `<dialog>`, `popover`, `scroll-snap` e validação nativa cobrem menu, accordion, modal, carrossel e formulário | Manter Server Components por padrão e empurrar `"use client"` para as folhas da árvore; `next/dynamic` com `ssr:false` só em widget realmente interativo abaixo da dobra; se a rota inteira é conteúdo estático, avaliar Astro em vez de Next |

Números de apoio: 62% das páginas mobile têm ao menos uma imagem sem dimensão declarada — causa nº 1 de CLS; mediana de TBT mobile em **1.916 ms**, alta de 58% em um ano. Fonte: Web Almanac 2025 (Performance) — https://almanac.httparchive.org/en/2025/performance · WebAIM Million 2026 — https://webaim.org/projects/million/

---

## 7. Escolha de framework

**O teste de 4 perguntas. Se todas as respostas forem "não", o site de marketing não deve usar framework:**

1. Existe estado compartilhado entre rotas que precisa sobreviver à navegação?
2. Existe área autenticada com dados por usuário?
3. Existem mais de 10 componentes com interação real (não só accordion e menu)?
4. O time já opera esse framework em produção?

Um site de marketing típico precisa de menu mobile, accordion, carrossel, formulário e modal. Em 2026 os cinco são nativos: `popover`, `<details>`, `scroll-snap`, validação de formulário nativa e `<dialog>`. O JS restante cabe em **3–5 KB**.

**O custo real da hidratação, com número:** a mediana de **TBT mobile é 1.916 ms, alta de 58% em um ano**. Hidratação é pagar duas vezes pelo mesmo HTML — baixar o bundle, parsear, executar, reconstruir a árvore e anexar listeners sobre markup que o servidor já entregou pronto. Em página sem estado isso é 100% desperdício e sai direto no INP. Fonte: Web Almanac 2025 — https://almanac.httparchive.org/en/2025/performance

Evidência lateral que reforça a escolha por menos JS: sites Astro têm **9,0 erros de acessibilidade por página contra média de 56,1**, porque geram menos DOM. Fonte: WebAIM Million 2026 — https://webaim.org/projects/million/

<details>
<summary>Panorama do ecossistema — State of JS 2025, publicado mar/2026 (dado datado)</summary>

| Item | Dado |
|---|---|
| TypeScript exclusivo | 40% (era 34% em 2024); JS puro exclusivo: 6% |
| React | 83,6% de uso, com insatisfação crescente |
| Next.js | 59% de uso, perdendo satisfação |
| Astro | Lidera satisfação em meta-frameworks, **+39 pontos** sobre Next |
| Vite vs Webpack | Uso 84% vs 87%; satisfação **98% vs 26%** |
| Satisfação geral com o ecossistema | 3,8/5 — estável há 5 anos |

Versões correntes no momento da pesquisa: React 19.x com React Compiler v1.0 (out/2025, estável mas não ligado por padrão no Next 16); Next.js 16 com Cache Components (`"use cache"`), Turbopack por padrão, `middleware.ts` → `proxy.ts`, `next lint` removido, alvos Chrome/Edge/Firefox 111+ e Safari 16.4+; Vite 8 sobre Rolldown; Biome v2.5 (jun/2026, >500 regras). Nota de segurança operacional: RSC teve vulnerabilidade crítica de RCE não autenticado em dez/2025, corrigida em 19.0.1 / 19.1.2 / 19.2.1 — servidor de renderização é superfície de ataque.

Fontes: State of JS 2025 — https://2025.stateofjs.com/en-US/libraries/meta-frameworks/ · Next.js 16 — https://nextjs.org/blog/next-16 · React — https://react.dev/blog · Vite 8 — https://vite.dev/blog/announcing-vite8 · Biome — https://biomejs.dev/blog/
</details>

---

## 8. Renderização: SSG, SSR, ISR, CSR, edge

| Estratégia | SEO | Performance | Custo | Complexidade | Use quando |
|---|---|---|---|---|---|
| **SSG** | Ótimo | Ótimo (TTFB de CDN) | Mínimo | Baixa | Marketing, docs, blog, catálogo estável |
| **ISR / revalidação** | Ótimo | Ótimo | Baixo | Média | E-commerce com muitos SKUs, conteúdo editorial |
| **SSR** | Ótimo | Bom (TTFB depende do servidor) | Alto | Média | Dado por usuário, preço e estoque em tempo real |
| **CSR puro** | ⚠️ Ruim para IA, aceitável para Google | Ruim (LCP e INP) | Baixo | Baixa | App atrás de login |
| **Edge** | Ótimo | Ótimo (latência global) | Médio | **Alta** | Personalização geográfica, A/B, i18n |
| **Streaming + PPR** | Ótimo | Ótimo (shell estático + partes dinâmicas) | Médio | Alta | App híbrido com shell reaproveitável |

**Streaming** manda o shell HTML imediatamente e preenche os slots conforme os dados chegam (`<Suspense>`): ganha em LCP percebido, mas não reduz o trabalho total. **Partial Prerendering / Cache Components** entrega shell estático do CDN com buracos dinâmicos por streaming — boa resposta técnica, que cobra em complexidade de invalidação (`cacheLife`, `updateTag`, `revalidateTag`).

**Heurística honesta:** comece em SSG; suba para ISR quando o conteúdo mudar; vá para SSR **só nas rotas** que exigem; edge apenas quando latência global for gargalo **medido**.

---

## 9. Imagens e mídia

```html
<img
  src="hero-800.jpg"
  srcset="hero-400.avif 400w, hero-800.avif 800w, hero-1600.avif 1600w"
  sizes="(min-width: 64rem) 50vw, 100vw"
  width="1600" height="900"
  alt="Descrição real do que a imagem mostra"
  fetchpriority="high" decoding="async">
```

Regras que decidem o resultado:

- **`width`/`height` sempre** (ou `aspect-ratio`). 62% das páginas mobile têm ao menos uma imagem sem dimensão — causa nº 1 de CLS.
- **Nunca `loading="lazy"` no elemento LCP.** Use `fetchpriority="high"`. `loading="lazy"` só abaixo da dobra.
- **`sizes` errado invalida o `srcset` inteiro** — o navegador escolhe a maior variante. `sizes` descreve o espaço que a imagem ocupa no layout, não o tamanho do arquivo.
- **AVIF** comprime tipicamente 20–50% melhor que WebP em fotos, com WebP como fallback seguro; encoding é mais lento. JPEG XL ainda é *investigação* no Interop 2026 — não é opção de produção.
- `<picture>` só para **art direction** real (recorte diferente por breakpoint) ou fallback de formato; para densidade, `srcset`/`sizes` no `<img>`.
- `alt=""` (vazio, presente) para imagem puramente decorativa; omitir o atributo é erro.
- Ganho fácil parado na mesa: entre elementos LCP que são imagem, **JPG 57%, PNG 26%, WebP 11%** — AVIF ainda é minoria.

**Vídeo:** `poster` sempre (sem ele o vídeo é um buraco no layout e prejudica o LCP); `preload="metadata"` por padrão — `preload="auto"` acima da dobra rouba banda do LCP; autoplay silencioso (`autoplay muted playsinline loop`) custa CPU contínuo e bateria, precisa respeitar `prefers-reduced-motion` e costuma ser o pior trade-off de performance por unidade de impacto de marca em hero.

Fonte: Web Almanac 2025 (Performance) — https://almanac.httparchive.org/en/2025/performance

---

## 10. Quality gate de CI

```yaml
# 1. tsc --noEmit              → tipos
# 2. biome ci .                → lint + format
# 3. vitest run --coverage     → unidade e integração
# 4. playwright test           → E2E + axe-core + screenshots de regressão
# 5. size-limit / bundlesize   → falha se o bundle crescer acima do orçamento
# 6. lhci autorun              → Lighthouse CI com budget.json
```

**Configure orçamento de bytes, não nota de Lighthouse.** A razão é operacional: a nota é um índice composto e ponderado, calculado sobre métricas de laboratório sujeitas a variação de máquina, rede e concorrência do runner — o mesmo commit oscila entre builds, o time perde confiança no gate e passa a ignorá-lo. Orçamento de bytes por rota é determinístico: ou o JS passou de 170 KB, ou não passou. Coloque no `budget.json` limite de bytes de JS por rota mais teto de LCP e CLS, e trate a nota como diagnóstico, nunca como gate.

Complemento indispensável: **Lighthouse é laboratório, CrUX é campo** — decida por campo. E o teto honesto da automação: o estudo da Deque (2.000+ auditorias, ~13.000 páginas, ~300.000 problemas) encontrou que teste automatizado detecta **57% dos problemas de acessibilidade**, medido por volume de ocorrências. Os outros 43% (ordem de leitura, nome acessível significativo, foco, leitor de tela) exigem auditoria manual — e só 21% dos times testam com leitor de tela. Fontes: Deque — https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/ · State of CSS 2026 — https://2026.stateofcss.com/en-US/usage/

---

## 11. SEO técnico e AEO

Só o que encosta em front-end.

- **Canonical no HTML inicial**, não injetado por JS. Divergência entre HTML bruto e renderizado afeta 2–3% das páginas e cresce.
- **Sitemap.xml** com `lastmod` verdadeiro; **robots.txt** que não bloqueia CSS nem JS.
- **hreflang** recíproco + `x-default` — crítico para separar pt-BR de pt-PT.
- **Core Web Vitals**: LCP ≤ 2,5s, INP ≤ 200ms, CLS ≤ 0,1. Apenas **48% dos sites mobile** passam nos três. É sinal de ranking, mas de desempate — não substitui conteúdo.
- **Limites reais do Googlebot**: HTML analisado até **2 MB** (o excedente é ignorado); recursos individuais acima de **2 MB** são ignorados; página com status ≠ 200 pode nunca ser renderizada; URL com `#/rota` não é resolvida — use History API. Fonte: Google Search Central — https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics

### Os dois achados que economizam trabalho inútil

**Crawlers de IA não executam JavaScript.** Pesquisa da Vercel testando ChatGPT, Claude e outros: nenhum renderiza conteúdo client-side. Um SPA em CSR puro é **invisível para motores de resposta**, mesmo sendo indexável pelo Google. HTML-first deixou de ser preferência estética e virou requisito de distribuição — é o argumento mais forte contra CSR em página pública.

**`llms.txt` é empiricamente inútil.** Estudo da Ahrefs com 137 mil domínios: 28% publicam o arquivo; **97% deles receberam zero tráfego** em maio de 2026; 96% das requisições que chegaram vieram de bots genéricos, e bots de IA foram apenas **19,5%**. O achado decisivo: **zero requisições de bots de IA para `llms.txt` inexistentes** — nenhum sistema de IA procura o arquivo. O Google diz o mesmo oficialmente: não há requisitos adicionais nem otimização especial para AI Overviews, e explicitamente pede para não criar "novos arquivos legíveis por máquina, arquivos de texto para IA ou marcação" especial. Fontes: Ahrefs — https://ahrefs.com/blog/llmstxt-study/ · Google Search Central — https://developers.google.com/search/docs/appearance/ai-features

**O que resta e é acionável:** HTML renderizado no servidor com o conteúdo no primeiro byte; afirmações autocontidas com número, data e fonte (sobrevivem fora do parágrafo); entidade clara (`Organization` com `sameAs`, página "Sobre" densa, autoria real, NAP consistente); E-E-A-T com autor verificável e data de atualização; headings que são perguntas reais com a resposta nos dois primeiros parágrafos.

<details>
<summary>Dados estruturados — o que o Google ainda usa (verificado em ago/2026)</summary>

| Tipo | Status |
|---|---|
| Article, Breadcrumb, Product, Review snippet | ✅ Ativos |
| Organization, LocalBusiness, Event, JobPosting | ✅ Ativos |
| Video, Q&A, Discussion Forum, Profile Page | ✅ Ativos |
| Course, Dataset, Software App, Vacation Rental, Speakable | ✅ Ativos |
| Carrosséis (receita, curso, restaurante, filme) | ✅ Ativos |
| **FAQPage** | ❌ **Rich result descontinuado (2026)** |
| **HowTo** | ❌ **Descontinuado** |

Continue marcando Organization, BreadcrumbList, Product e Article. FAQ schema não gera mais rich result, mas conteúdo em pergunta/resposta segue útil para trecho e para resposta de IA — só não prometa estrela no SERP.

Fonte: Google Search Central — https://developers.google.com/search/docs/appearance/structured-data/search-gallery
</details>

---

## 12. Segurança e LGPD no front-end

### CSP: nonce + `strict-dynamic`

```
Content-Security-Policy: default-src 'self'; script-src 'nonce-{RANDOM}' 'strict-dynamic'; object-src 'none'; base-uri 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

O nonce é gerado por requisição (aleatório, imprevisível, nunca cacheado junto com o HTML) e repetido em cada `<script nonce="…">`. `strict-dynamic` faz os scripts carregados por um script confiável herdarem a confiança — é o que permite conviver com tags de terceiros sem manter allowlist infinita de domínios.

**Por que `unsafe-inline` é teatro:** ele autoriza qualquer script inline, que é exatamente o vetor do XSS refletido e armazenado que o CSP deveria bloquear. Um CSP com `unsafe-inline` aparece no relatório de segurança como "tem CSP" e não impede nada. Os números mostram o tamanho do problema: **CSP em 21,9%** das páginas, mas **`unsafe-inline` presente em 92% delas**; nonce em 20% e `strict-dynamic` em 10%. Fonte: Web Almanac 2025 (Security) — https://almanac.httparchive.org/en/2025/security

### SRI e baseline de headers

`integrity` + `crossorigin` em **todo script servido de CDN de terceiros** — sem isso, comprometer o CDN é comprometer o site. Adoção de SRI: **23,6%**; X-Frame-Options ~35%; Permissions-Policy 3,7%; HTTPS em 97,3% das home pages mobile. **Trusted Types** virou Baseline em fev/2026 e vale ativar em app que manipula HTML dinâmico.

**Terceiros:** mais de 90% das páginas carregam pelo menos um terceiro, com profundidade mediana de cadeia igual a **3** (terceiro que carrega terceiro). Cada tag é bytes, main thread (INP), superfície de XSS e exposição de dado. Regras: inventário por rota, `async`/`defer` sempre, carregar só após consentimento, Partytown ou tag server-side para o que for pesado, e um teto explícito de quantas tags podem existir. Fonte: Web Almanac 2025 (Third Parties) — https://almanac.httparchive.org/en/2025/third-parties

### Os 6 requisitos práticos da ANPD para banner de cookies

1. **Base legal correta:** consentimento para cookies não necessários; legítimo interesse admissível para os necessários e para medição de audiência, **após teste de balanceamento** documentado.
2. **Granularidade por categoria** (necessários, desempenho, publicidade) — nem tudo-ou-nada, nem lista tão granular que cause fadiga.
3. **Opt-in prévio:** cookies baseados em consentimento **desativados por padrão**, **nada pré-marcado**, e nenhum disparo antes da escolha.
4. **Simetria visual:** recusar precisa ter o mesmo destaque que aceitar. "Aceitar tudo" em botão verde grande ao lado de "Gerenciar" em link cinza é dark pattern e é exatamente o que a ANPD aponta.
5. **Revogação simples e gratuita**, por caminho equivalente ao da coleta, com link permanentemente acessível no site.
6. **Informar:** finalidade por categoria, prazo de retenção, compartilhamento com terceiros, direitos do titular e como bloquear cookies no navegador.

Fonte: ANPD, Guia Orientativo Cookies e Proteção de Dados Pessoais — https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf
