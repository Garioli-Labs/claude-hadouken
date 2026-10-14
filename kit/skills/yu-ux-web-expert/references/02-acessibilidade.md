# Acessibilidade — WCAG 2.2 AA operacional, ARIA, teste manual e Brasil

Referência de consulta durante auditoria. Alvo técnico: **WCAG 2.2 nível AA** — 55 critérios (31 A + 24 AA), cumulativos.
Fonte: W3C — *WCAG 2.2* — https://www.w3.org/TR/WCAG22/

## Índice

- [Como usar este arquivo numa auditoria](#como-usar-este-arquivo-numa-auditoria)
- [Checklist WCAG 2.2 nível AA — os 55 critérios](#checklist-wcag-22-nível-aa--os-55-critérios)
  - [Princípio 1 — Perceivable](#princípio-1--perceivable)
  - [Princípio 2 — Operable](#princípio-2--operable)
  - [Princípio 3 — Understandable](#princípio-3--understandable)
  - [Princípio 4 — Robust](#princípio-4--robust)
  - [O que mudou na 2.2](#o-que-mudou-na-22)
- [Valores numéricos de bolso](#valores-numéricos-de-bolso)
- [ARIA](#aria)
- [Protocolo de teste manual mínimo](#protocolo-de-teste-manual-mínimo)
- [Cobertura das ferramentas automatizadas](#cobertura-das-ferramentas-automatizadas)
- [Brasil — o que realmente obriga](#brasil--o-que-realmente-obriga)
- [Internacional — só o que muda decisão de risco](#internacional--só-o-que-muda-decisão-de-risco)
- [Overlays de acessibilidade](#overlays-de-acessibilidade)
- [WCAG 3.0 — status real](#wcag-30--status-real)

---

## Como usar este arquivo numa auditoria

Verifique na ordem da prevalência real, não na ordem numérica dos critérios — assim o primeiro terço do tempo já cobre a maior parte dos usuários afetados. A ordem é: **1) contraste** (1.4.3 / 1.4.11), porque falha em **83,9%** das home pages; **2) alt text** (1.1.1), **53,1%**; **3) rótulos de formulário** (3.3.2 / 4.1.2), **51,0%**; **4) links e botões vazios** (2.4.4 / 4.1.2), **46,3%** e **30,6%**; **5) hierarquia de headings** (1.3.1 / 2.4.6), **41,8%** das páginas pulam níveis; **6) idioma do documento** (3.1.1), **13,5%**.
Fonte: WebAIM — *The WebAIM Million 2026* — https://webaim.org/projects/million/

Depois dos seis, vá para o que nenhuma ferramenta pega: teclado, foco visível e não obscurecido, ordem de leitura, zoom 200%/400%, leitor de tela. Por último, os critérios novos da 2.2 (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) — são raros nos relatórios automatizados porque as ferramentas quase não os testam, não porque as páginas passem.

---

## Checklist WCAG 2.2 nível AA — os 55 critérios

Legenda: **A** / **AA** = nível · 🆕 = novo na WCAG 2.2 · Nomes em inglês são os canônicos e são como aparecem em axe-core, Lighthouse, WAVE e no texto da norma.
Fonte de todos os critérios e valores desta seção: W3C — *WCAG 2.2* — https://www.w3.org/TR/WCAG22/

### Princípio 1 — Perceivable

| Nº | Nome canônico | Nível | O que verificar | Valor | Como testar |
|---|---|---|---|---|---|
| 1.1.1 | Non-text Content | A | Toda imagem, ícone, gráfico e `<canvas>` tem alternativa textual equivalente; decorativa usa `alt=""` presente e vazio | — | Script (axe: `image-alt`, `input-image-alt`, `area-alt`) + manual: alt presente mas errado só o humano pega |
| 1.2.1 | Audio-only and Video-only (Prerecorded) | A | Áudio-só tem transcrição; vídeo-só tem transcrição ou faixa de áudio | — | Manual |
| 1.2.2 | Captions (Prerecorded) | A | Todo vídeo com áudio tem legenda sincronizada e revisada | — | Manual — legenda automática do YouTube sem revisão não cumpre |
| 1.2.3 | Audio Description or Media Alternative (Prerecorded) | A | Vídeo pré-gravado tem audiodescrição **ou** alternativa em texto | — | Manual |
| 1.2.4 | Captions (Live) | AA | Transmissão ao vivo com áudio tem legenda em tempo real | — | Manual |
| 1.2.5 | Audio Description (Prerecorded) | AA | Vídeo pré-gravado tem audiodescrição (aqui a alternativa textual não basta) | — | Manual |
| 1.3.1 | Info and Relationships | A | Estrutura visual existe programaticamente: headings reais, listas reais, `<th scope>`, `<fieldset>/<legend>`, `<label for>` | — | Script parcial (axe: `heading-order`, `list`, `label`) + manual: heading semanticamente errado passa no script |
| 1.3.2 | Meaningful Sequence | A | Ordem do DOM = ordem de leitura correta; `order`/`row-reverse` do Flex/Grid não pode reordenar conteúdo com sequência semântica | — | Manual — desligar CSS ou ler o DOM linear |
| 1.3.3 | Sensory Characteristics | A | Instrução não depende só de forma, cor, tamanho ou posição ("clique no botão redondo à direita") | — | Manual (busca por texto) |
| 1.3.4 | Orientation | AA | Conteúdo funciona em retrato e paisagem; sem trava de orientação | — | Manual: girar o dispositivo/emulador |
| 1.3.5 | Identify Input Purpose | AA | Campos sobre o próprio usuário têm `autocomplete` com token da spec HTML (`name`, `email`, `tel`, `street-address`, `cc-number`, `one-time-code`) | — | Script (axe: `autocomplete-valid`) |
| 1.4.1 | Use of Color | A | Cor nunca é o único meio: link dentro de texto, campo com erro, estado ativo, série de gráfico | — | Manual: converter a captura para escala de cinza |
| 1.4.2 | Audio Control | A | Áudio que toca sozinho por mais de 3s tem controle de pausa/volume | 3 s | Manual |
| 1.4.3 | Contrast (Minimum) | AA | Contraste de texto contra o fundo computado, em todos os estados e nos dois temas | **4,5:1** normal · **3:1** para ≥18pt ou ≥14pt bold (≈24px / 18,66px) | Script de contraste — **nunca estimar no olho** |
| 1.4.4 | Resize Text | AA | Zoom do navegador até 200% sem perda de conteúdo ou função | **200%** | Manual: Ctrl/Cmd + até 200% |
| 1.4.5 | Images of Text | AA | Texto é texto real, não imagem — exceto logotipo e texto essencialmente gráfico | — | Manual + inspeção de `<img>` na hero |
| 1.4.10 | Reflow | AA | Sem rolagem em dois eixos: conteúdo vertical cabe em 320 CSS px de largura | **320 CSS px** (largura) · **256 CSS px** (altura) | Manual: zoom 400% em viewport 1280 = 320px; ou capturar em 360px |
| 1.4.11 | Non-text Contrast | AA | Bordas de input, ícones funcionais, indicadores de foco, limites de componente contra a cor adjacente | **3:1** | Script de contraste + manual nos estados |
| 1.4.12 | Text Spacing | AA | Sem perda de conteúdo ao forçar espaçamentos | linha **1,5×** · parágrafo **2×** · letra **0,12×** · palavra **0,16×** | Manual: bookmarklet de Text Spacing |
| 1.4.13 | Content on Hover or Focus | AA | Tooltip/popover é dispensável (Esc), hoverable (mouse pode entrar) e persistente (não some sozinho) | — | Manual |

### Princípio 2 — Operable

| Nº | Nome canônico | Nível | O que verificar | Valor | Como testar |
|---|---|---|---|---|---|
| 2.1.1 | Keyboard | A | Toda função operável por teclado, sem exigir temporização de teclas; `div` com `onclick` sem `tabindex`/role é a falha típica | — | Script parcial + percurso manual por Tab |
| 2.1.2 | No Keyboard Trap | A | Foco entra e sai de todo componente (modal, iframe, player, mapa) | — | Manual: Tab e Shift+Tab pelo widget |
| 2.1.4 | Character Key Shortcuts | A | Atalho de tecla única pode ser desligado, remapeado ou só vale com foco no componente | — | Manual: digitar letras fora de campo |
| 2.2.1 | Timing Adjustable | A | Limite de tempo desligável, ajustável ou extensível; aviso antes de expirar | estender **≥10×** · avisar com **≥20 s** | Manual: sessão, carrinho, OTP |
| 2.2.2 | Pause, Stop, Hide | A | Movimento, piscar ou rolagem automática com duração > 5s tem controle de pausa (carrossel automático é a falha clássica) | **> 5 s** | Manual |
| 2.3.1 | Three Flashes or Below Threshold | A | Nada pisca acima do limiar | **máx. 3 flashes/s** | Manual / inspeção de vídeo e animação |
| 2.4.1 | Bypass Blocks | A | Skip link como primeiro elemento focável, visível ao foco, com alvo que recebe foco (`tabindex="-1"`), ou landmarks equivalentes | — | Script parcial (axe: `bypass`) + manual: 1 em cada 10 skip links está quebrado |
| 2.4.2 | Page Titled | A | `<title>` único e descritivo, específico primeiro | — | Script (axe: `document-title`) |
| 2.4.3 | Focus Order | A | A ordem de tabulação preserva significado e operabilidade | — | Manual: percurso por Tab com captura de cada parada |
| 2.4.4 | Link Purpose (In Context) | A | Texto de link descreve o destino no contexto; sem "clique aqui", "saiba mais" repetido, sem link vazio | — | Script parcial (axe: `link-name`) + manual: listar links no leitor de tela |
| 2.4.5 | Multiple Ways | AA | Há mais de um caminho até cada página: menu, busca, mapa do site, breadcrumb (exceto etapa de processo) | ≥ 2 caminhos | Manual |
| 2.4.6 | Headings and Labels | AA | Headings e rótulos descrevem tópico ou propósito de fato | — | Manual |
| 2.4.7 | Focus Visible | AA | Indicador de foco visível em toda parada; `outline: none` sem substituto é falha | — | Manual: percurso por Tab + `:focus-visible` no CSS |
| 2.4.11 🆕 | Focus Not Obscured (Minimum) | AA | O elemento focado não pode ficar **inteiramente** oculto por conteúdo do autor: header sticky, cookie banner, chat widget, barra de CTA fixa | — | Manual: Tab com header fixo e banner aberto |
| 2.5.1 | Pointer Gestures | A | Gesto multiponto ou baseado em trajetória tem alternativa de ponteiro único (swipe de carrossel precisa de setas) | — | Manual |
| 2.5.2 | Pointer Cancellation | A | Ação dispara no `up`, não no `down`; é possível abortar arrastando para fora | — | Manual |
| 2.5.3 | Label in Name | A | O nome acessível contém o texto visível do controle — `aria-label` que contradiz o rótulo visível quebra comando de voz | — | Script parcial (axe: `label-content-name-mismatch`) + manual |
| 2.5.4 | Motion Actuation | A | Função acionada por movimento do dispositivo (chacoalhar, inclinar) tem alternativa em componente de interface e pode ser desligada | — | Manual |
| 2.5.7 🆕 | Dragging Movements | AA | Toda função que usa arrastar tem alternativa por ponteiro único sem arrastar: slider com +/−, kanban com "mover para", carrossel com setas | — | Manual |
| 2.5.8 🆕 | Target Size (Minimum) | AA | Alvo de ponteiro mínimo; ver as 5 exceções abaixo | **24×24 CSS px** | Script parcial (axe: `target-size`) + medição no DevTools |
| — | *Exceções do 2.5.8* | — | 1) **Spacing**: círculo de 24px centrado na bounding box não intercepta outro alvo · 2) **Equivalent**: existe outro controle conforme com a mesma função · 3) **Inline**: alvo dentro de frase ou limitado pelo `line-height` · 4) **User Agent Control**: tamanho não modificado pelo autor · 5) **Essential**: apresentação essencial ou exigida por lei | 24 px de diâmetro | Fonte: W3C WAI — *Understanding SC 2.5.8* — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |

### Princípio 3 — Understandable

| Nº | Nome canônico | Nível | O que verificar | Valor | Como testar |
|---|---|---|---|---|---|
| 3.1.1 | Language of Page | A | `<html lang="pt-BR">` presente e correto | — | Script (axe: `html-has-lang`, `html-lang-valid`) |
| 3.1.2 | Language of Parts | AA | Trecho em outro idioma marcado com `lang` (nome de produto em inglês, citação) | — | Script parcial (axe: `valid-lang`) + manual |
| 3.2.1 | On Focus | A | Receber foco não muda contexto (não abre modal, não submete, não navega) | — | Manual: percurso por Tab |
| 3.2.2 | On Input | A | Alterar um campo não muda contexto sem aviso prévio (`<select>` que navega ao mudar é a falha clássica) | — | Manual |
| 3.2.3 | Consistent Navigation | AA | Navegação repetida aparece na mesma ordem relativa em todas as páginas | — | Manual: comparar 3 páginas |
| 3.2.4 | Consistent Identification | AA | Mesma função = mesmo rótulo/ícone em todo o site ("Buscar" vs "Pesquisar" na mesma marca) | — | Manual |
| 3.2.6 🆕 | Consistent Help | A | Mecanismos de ajuda (telefone, WhatsApp, chat, FAQ, formulário de contato) repetidos em várias páginas aparecem na **mesma ordem relativa** | — | Manual: comparar posição em 3 páginas |
| 3.3.1 | Error Identification | A | Erro descrito **em texto**, não só por borda vermelha; associado ao campo via `aria-describedby` + `aria-invalid="true"` | — | Manual: submeter formulário inválido |
| 3.3.2 | Labels or Instructions | A | Todo campo tem `<label for>` associado a `id`; `placeholder` **não é rótulo** | — | Script (axe: `label`) + manual |
| 3.3.3 | Error Suggestion | AA | Quando a correção é conhecida, ela é sugerida ("Use o formato 00000-000") | — | Manual |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | Transação jurídica, financeira ou que altera dado é reversível, verificada ou confirmada antes de efetivar | — | Manual: checkout, exclusão de conta, envio de proposta |
| 3.3.7 🆕 | Redundant Entry | A | Informação já dada no mesmo processo é auto-preenchida ou oferecida para seleção — não pedir CEP/e-mail duas vezes no checkout | — | Manual: percorrer o funil inteiro |
| 3.3.8 🆕 | Accessible Authentication (Minimum) | AA | Nenhum teste de função cognitiva sem alternativa: **colar senha deve funcionar**, gerenciador de senha deve funcionar, CAPTCHA de reconhecimento precisa de alternativa | — | Manual: tentar colar no campo de senha; testar o CAPTCHA |
| 4.1.2 | Name, Role, Value | A | Todo componente tem nome, papel e valor programáticos; estado (`aria-expanded`, `aria-checked`) atualizado | — | Script (axe: `button-name`, `link-name`, `aria-*`) + manual |
| 4.1.3 | Status Messages | AA | Mensagens de status anunciadas sem receber foco (`role="status"`, `role="alert"`, `aria-live`); a região precisa existir no DOM **antes** de receber conteúdo | — | Manual com leitor de tela |

> 4.1.2 e 4.1.3 pertencem ao **Princípio 4 — Robust**; estão aqui em sequência apenas para manter a tabela contígua.

### Princípio 4 — Robust

**4.1.1 Parsing (A) foi OBSOLETADO e removido na WCAG 2.2.** O W3C registra: *"4.1.1 Parsing is obsolete and removed from WCAG 2.2."* Motivo: os problemas que ele endereçava (ID duplicado, tag mal aninhada) foram resolvidos pelos parsers HTML modernos e o critério gerava falso positivo em massa. Em WCAG 2.0/2.1 deve ser considerado sempre satisfeito. **Ferramenta que ainda reporta "duplicate ID" como falha WCAG está desatualizada** — não conte esse achado como violação de conformidade.
Fonte: W3C — *WCAG 2.2*, §4.1.1 — https://www.w3.org/TR/WCAG22/

### O que mudou na 2.2

**9 critérios novos** (6 exigidos para AA, 3 apenas AAA) e **1 removido**. A 2.2 é W3C Recommendation desde **5 de outubro de 2023**.

| Nº | Nome | Nível | Entra na conformidade AA? |
|---|---|---|---|
| 2.4.11 | Focus Not Obscured (Minimum) | AA | Sim |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA | Não |
| 2.4.13 | Focus Appearance | AAA | Não — pede perímetro de **2 CSS px** e **3:1** entre estados |
| 2.5.7 | Dragging Movements | AA | Sim |
| 2.5.8 | Target Size (Minimum) | AA | Sim — **24×24 CSS px** |
| 3.2.6 | Consistent Help | A | Sim |
| 3.3.7 | Redundant Entry | A | Sim |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Sim |
| 3.3.9 | Accessible Authentication (Enhanced) | AAA | Não |

A WCAG 2.2 tem **86 critérios** no total (31 A + 24 AA + 31 AAA). AAA não é exigível para um site inteiro — o próprio W3C afirma que não é possível satisfazer todos os critérios AAA para todo tipo de conteúdo.
Fonte: W3C WAI — *What's New in WCAG 2.2* — https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/

---

## Valores numéricos de bolso

| Item | Valor | Critério | Fonte |
|---|---|---|---|
| Contraste de texto normal | **4,5:1** | 1.4.3 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Contraste de texto grande (≥18pt ou ≥14pt bold ≈ 24px / 18,66px) | **3:1** | 1.4.3 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Contraste de texto — reforçado | **7:1** (grande: 4,5:1) | 1.4.6 (AAA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Contraste de componentes de UI e gráficos essenciais | **3:1** | 1.4.11 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Alvo de ponteiro — mínimo normativo | **24×24 CSS px** | 2.5.8 (AA) | W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| Alvo de ponteiro — reforçado WCAG | **44×44 CSS px** | 2.5.5 (AAA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Alvo de toque — Apple HIG | **44×44 pt** | recomendação de plataforma, não WCAG | Apple — *Human Interface Guidelines* — https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Alvo de toque — Material Design | **48×48 dp** | recomendação de plataforma, não WCAG | Google — *Material Design 3, Accessibility* — https://m3.material.io/foundations/designing/structure |
| Zoom de texto sem perda | **200%** | 1.4.4 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Reflow — largura / altura | **320 CSS px** / **256 CSS px** | 1.4.10 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Equivalência de teste do reflow | zoom **400%** em viewport de **1280 px** = 320 px | 1.4.10 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Text spacing: linha / parágrafo / letra / palavra | **1,5×** / **2×** / **0,12×** / **0,16×** | 1.4.12 (AA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Limite de tempo: extensão e aviso | estender **≥10×**, avisar com **≥20 s** | 2.2.1 (A) | W3C — https://www.w3.org/TR/WCAG22/ |
| Movimento automático sem controle de pausa | **máx. 5 s** | 2.2.2 (A) | W3C — https://www.w3.org/TR/WCAG22/ |
| Flashes | **máx. 3 por segundo** | 2.3.1 (A) | W3C — https://www.w3.org/TR/WCAG22/ |
| Áudio automático sem controle | **máx. 3 s** | 1.4.2 (A) | W3C — https://www.w3.org/TR/WCAG22/ |
| Indicador de foco: espessura / contraste entre estados | perímetro **2 CSS px** / **3:1** | 2.4.13 (AAA) | W3C — https://www.w3.org/TR/WCAG22/ |
| Total de critérios / exigidos para AA / novos na 2.2 / removidos | **86** / **55** / **9** / **1** | — | W3C — https://www.w3.org/TR/WCAG22/ |

**Nota sobre 24 vs 44 vs 48.** Só **24×24** é normativo em nível AA. 44×44 (Apple) e 48dp (Material) são diretrizes de plataforma e servem como alvo de projeto — projetar em 44/48 dá margem e resolve 2.5.8 por construção; auditar contra 24 é o que decide conformidade.

**Nota sobre APCA.** O algoritmo da WCAG 2.x ignora tamanho e peso da fonte e **superestima gravemente o contraste em cores escuras** — 4,5:1 pode ser funcionalmente ilegível perto do preto, o que torna a WCAG 2 um guia ruim para desenhar dark mode. APCA usa valores **Lc** perceptualmente uniformes (Lc 90 preferencial para corpo; Lc 75 mínimo para corpo; Lc 60 texto geral; Lc 45 títulos; Lc 30 mínimo absoluto). **APCA não é normativo em lugar nenhum** — audite por WCAG 2.2 e use APCA como informação secundária de design.
Fonte: Myndex/APCA — *Why APCA as a New Contrast Method?* — https://git.apcacontrast.com/documentation/WhyAPCA.html

---

## ARIA

### As 5 regras de uso

1. **Se existe elemento ou atributo HTML nativo com a semântica e o comportamento necessários, use-o** em vez de reaproveitar outro elemento e adicionar role/state/property.
2. **Não mude a semântica nativa sem necessidade real.** Em vez de `<h2 role="tab">`, use `<h2><button role="tab">`.
3. **Todo controle ARIA interativo precisa ser operável por teclado**, com as teclas esperadas do padrão (Enter, Espaço, setas).
4. **Nunca use `role="presentation"` nem `aria-hidden="true"` em elemento focável** — cria elemento fantasma: focável e não anunciado.
5. **Todo elemento interativo precisa de nome acessível.**

Fonte: W3C — *Using ARIA* — https://www.w3.org/TR/using-aria/

**"A role is a promise."** Declarar `role="button"` é prometer que o JavaScript entrega as interações de teclado de um botão. ARIA não fornece comportamento nem estilo — só muda o que a tecnologia assistiva anuncia. Por isso ARIA incorreta deturpa a experiência não visual em vez de melhorá-la.
Fonte: W3C WAI — *ARIA APG: Read Me First* — https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/

### Padrões do APG mais frequentes

Fonte de todos os padrões abaixo: W3C WAI — *ARIA Authoring Practices Guide — Patterns* — https://www.w3.org/WAI/ARIA/apg/patterns/

| Padrão | Marcação mínima | Teclado esperado |
|---|---|---|
| **Dialog (Modal)** | `role="dialog"` + `aria-modal="true"` + nome via `aria-labelledby`; ou `<dialog>` nativo com `showModal()`; `inert` no conteúdo de fundo | Foco entra no diálogo ao abrir · Tab preso dentro · **Esc fecha** · foco **retorna ao elemento que abriu** |
| **Disclosure** | `<button aria-expanded="true\|false" aria-controls="id">` + região controlada | Enter e Espaço alternam · nada mais |
| **Tabs** | `role="tablist"` / `role="tab"` (com `aria-selected`, `aria-controls`) / `role="tabpanel"` (com `aria-labelledby`); roving `tabindex` | Setas ←→ movem entre tabs · Home/End vão ao primeiro/último · Tab sai da tablist para o painel |
| **Combobox** | `role="combobox"` + `aria-expanded` + `aria-controls` para o listbox + `aria-activedescendant` (ou foco real) + `aria-autocomplete` | ↓ abre e move · ↑ move · Enter seleciona · Esc fecha sem selecionar · digitar filtra |
| **Accordion** | Cada cabeçalho é `<h3><button aria-expanded aria-controls>`; o painel referencia o botão por `aria-labelledby` | Enter/Espaço alternam · Tab percorre os cabeçalhos · setas ↑↓ entre cabeçalhos são opcionais |
| **Tooltip** | `role="tooltip"` referenciado por `aria-describedby` no gatilho; **sem conteúdo interativo dentro** | Aparece no foco e no hover · **Esc dispensa** · permanece enquanto o ponteiro estiver sobre ele (1.4.13) |
| **Carousel** | `role="group"` ou `role="region"` com `aria-roledescription="carousel"` e rótulo; slides como `role="group"` `aria-roledescription="slide"`; botão de pausa quando roda sozinho | Botões anterior/próximo focáveis · controle de pausa acessível (2.2.2) · alternativa sem arrastar (2.5.7) |

**Três avisos que mudam decisão:**
- **Disclosure resolve 80% do que os times constroem mal como "accordion" ou "dropdown".** Antes de propor um padrão complexo, verifique se disclosure basta.
- **`role="menu"` não é para navegação de site.** É para menu de aplicação estilo desktop. Navegação usa `<nav>` + `<ul>` + `<a>`.
- **Combobox é o padrão mais difícil do APG** e foi reescrito na versão 1.2 do ARIA. Quase toda implementação caseira está errada — prefira `<datalist>` ou uma biblioteca headless testada.
- **`<dialog>` sem `showModal()` não é modal.** `show()` não fornece backdrop, inércia nem trap. E não há resposta universal sobre onde o foco deve pousar ao abrir: JAWS, NVDA e VoiceOver anunciam de formas inconsistentes — teste com pelo menos dois leitores.
Fonte: Adrian Roselli — *Dialog Focus in Screen Readers* — https://adrianroselli.com/2020/10/dialog-focus-in-screen-readers.html

### Os erros de ARIA mais comuns

- `aria-label` sobrescrevendo o texto visível do controle → quebra 2.5.3 Label in Name e comando de voz.
- `role` aplicado sem o comportamento de teclado correspondente → a promessa não cumprida.
- `aria-hidden="true"` em conteúdo focável → elemento invisível para o leitor mas alcançável por Tab.
- `aria-labelledby` / `aria-describedby` apontando para `id` inexistente → nome acessível vazio.
- Região `aria-live` inserida no DOM junto com o conteúdo → o anúncio nunca dispara; a região precisa preexistir.
- `aria-expanded` que não é atualizado quando o estado muda.

### O achado que reorienta a recomendação

**Páginas com ARIA presente tiveram, em média, 59,1 erros; páginas sem ARIA, 42 erros — cerca de 41% a mais.** 82,7% das páginas usam ARIA; foram detectados 133.589.803 atributos ARIA (mais de 133 por página), com crescimento de **27% em um ano**.
Fonte: WebAIM — *The WebAIM Million 2026* — https://webaim.org/projects/million/

**O que isso implica na prática.** Não é que ARIA cause erro por si — é correlação: quem usa ARIA constrói interfaces mais complexas e ARIA costuma ser aplicada como remendo sobre marcação já ruim. A consequência operacional é direta: **ARIA adicionada não conta como melhoria até ser testada com leitor de tela.** Numa auditoria, tratar volume de ARIA como sinal de risco, não de maturidade. E, ao propor correção, a primeira alternativa é sempre remover ARIA e usar HTML nativo — `<button>`, `<details>`, `<dialog>`, `<label for>` — porque isso reduz superfície de erro em vez de aumentá-la. "No ARIA is better than bad ARIA."

---

## Protocolo de teste manual mínimo

Rode em cada **fluxo crítico** (login, busca, formulário de orçamento, carrinho, checkout, contato). Isto é o que os scripts não pegam — e é onde mora a maior parte das barreiras que impedem a tarefa.

| # | Verificação | Critério | Como | Sinal concreto de falha |
|---|---|---|---|---|
| 1 | **Navegação só por teclado** | 2.1.1, 2.1.2, 2.4.3 | Tab e Shift+Tab pelo fluxo inteiro, sem tocar no mouse (~15 min) | Um controle não é alcançável; o foco entra num widget e não sai; Enter/Espaço não ativam; `div` clicável é pulado |
| 2 | **Foco visível** | 2.4.7 | Capturar cada parada do percurso | Uma parada sem indicador visível; `outline: none` sem substituto; indicador com menos de 3:1 (1.4.11) |
| 3 | **Foco não obscurecido** | 2.4.11 🆕 | Tab com header sticky, cookie banner e chat widget ativos | O elemento focado fica inteiramente atrás do header fixo ao chegar por Tab vindo de baixo |
| 4 | **Skip link** | 2.4.1 | Tab uma vez na página recém-carregada | Não existe; existe mas não fica visível ao foco; aponta para alvo sem `tabindex="-1"` e o foco não vai para lá |
| 5 | **Zoom 200%** | 1.4.4 | Ctrl/Cmd + até 200% | Texto cortado, botão fora da tela, sobreposição, conteúdo que some |
| 6 | **Zoom 400% / reflow 320px** | 1.4.10 | 400% em viewport 1280 px, ou capturar em 360 px | Rolagem horizontal; tabela larga sem container rolável; menu que desaparece sem alternativa |
| 7 | **Text spacing** | 1.4.12 | Bookmarklet forçando 1,5 / 2 / 0,12 / 0,16 | Texto cortado em altura fixa; card que estoura; botão com rótulo truncado |
| 8 | **Ordem de leitura** | 1.3.2, 2.4.3 | Desligar CSS ou ler o DOM linear; comparar com a ordem visual | Grid/Flex com `order` ou `row-reverse` invertendo a ordem visual em relação ao DOM; sidebar lida antes do conteúdo principal |
| 9 | **Leitor de tela — estrutura** | 1.3.1, 2.4.6 | NVDA + Chrome; navegar por headings (tecla H) | A sequência de headings, sozinha, não explica a página; nível pulado; `<div class="titulo">` que não é heading |
| 10 | **Leitor de tela — links** | 2.4.4 | Listar links (Insert+F7 no NVDA) | Vários "Saiba mais" idênticos; link cujo texto é a URL; link vazio (ícone sem nome) |
| 11 | **Nome acessível significativo** | 4.1.2, 2.5.3, 1.1.1 | Percorrer os controles no leitor e comparar com o rótulo visível | Botão anunciado como "botão"; `alt="imagem"` / `alt="logo"` / nome do arquivo; `aria-label` que não contém o texto visível |
| 12 | **Formulário no leitor** | 3.3.1, 3.3.2, 3.3.3, 4.1.3 | Percorrer campo a campo e submeter inválido | Campo anunciado sem rótulo; obrigatoriedade só sinalizada por asterisco visual; erro só em vermelho, não anunciado, não associado ao campo |
| 13 | **Modal no leitor** | 4.1.2, 2.1.2, 2.4.3 | Abrir, tabular, fechar com Esc | O nome do diálogo não é anunciado; o foco continua atrás; o fundo continua tabulável (falta `inert`); ao fechar, o foco volta para o topo da página em vez do gatilho |
| 14 | **Sem cor** | 1.4.1 | Converter a captura para escala de cinza | Link dentro de parágrafo indistinguível; campo com erro identificado só pela borda vermelha; legenda de gráfico só por cor |
| 15 | **Movimento** | 2.2.2, 2.3.1 | Ativar "reduzir movimento" no SO | Animações continuam; carrossel automático sem botão de pausa; algo pisca mais de 3×/s |
| 16 | **Autenticação** | 3.3.8 🆕 | Tentar colar a senha; testar o CAPTCHA | Campo de senha bloqueia `paste`; CAPTCHA de reconhecimento de imagem sem alternativa |
| 17 | **Entrada redundante** | 3.3.7 🆕 | Percorrer o funil inteiro de ponta a ponta | O mesmo e-mail, CEP ou telefone é pedido duas vezes no mesmo processo, sem preenchimento nem seleção |

**Com qual leitor testar.** JAWS 40,5% · NVDA 37,7% · VoiceOver 9,7% dos usuários. As combinações reais mais usadas: JAWS+Chrome 24,7%, NVDA+Chrome 21,3%. **Testar apenas com VoiceOver no Mac — hábito comum em times de produto — cobre ~7% do uso real e produz falsa confiança**, porque VoiceOver é mais tolerante a marcação ruim que JAWS. Mínimo aceitável: **NVDA + Chrome** (gratuito). Em mobile, VoiceOver/iOS é obrigatório.
Fonte: WebAIM — *Screen Reader User Survey #10* — https://webaim.org/projects/screenreadersurvey10/

**Onde investir primeiro na estrutura.** 71,6% dos usuários de leitor de tela encontram informação em página longa navegando por **cabeçalhos**; apenas 3,7% usam landmarks. Hierarquia de headings correta vale mais que landmarks bem rotulados.
Fonte: WebAIM — *Screen Reader User Survey #10* — https://webaim.org/projects/screenreadersurvey10/

---

## Cobertura das ferramentas automatizadas

Duas cifras circulam e **as duas estão certas — medem coisas diferentes**.

| Métrica | Valor | O que responde |
|---|---|---|
| Cobertura por **critérios WCAG** testáveis por automação | **~20–30%** | Se você pode afirmar conformidade — não pode |
| Cobertura por **volume de instâncias de erro** | **57,38%** | Quanto trabalho de remediação a automação economiza |

O número de 57,38% vem da análise de quase **300.000 problemas em mais de 13.000 páginas**; ele é alto porque poucos tipos de erro (contraste, alt, label) concentram volume desproporcional — os **5 principais tipos respondem por mais de 78%** de todos os problemas.
Fonte: Deque — *The Automated Accessibility Coverage Report* — https://www.deque.com/automated-accessibility-coverage-report/
Fonte: Deque — *Automated Testing Study Identifies 57% of Digital Accessibility Issues* — https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/

**Score 100 de acessibilidade no Lighthouse não significa site acessível** — significa que nenhuma das ~40 checagens automatizadas falhou. axe-core é projetado para zero falso positivo, o que o torna confiável no que aponta e silencioso no que não sabe testar.

**O que declarar explicitamente como "não medido"** quando só houve automação: ordem de foco lógica (2.4.3), ordem de leitura (1.3.2), alt text presente mas incorreto (1.1.1), heading semanticamente errado (1.3.1), texto de link sem sentido fora de contexto (2.4.4), focus trap (2.1.2), foco obscurecido (2.4.11), reflow e zoom (1.4.10, 1.4.4), text spacing (1.4.12), legendas corretas (1.2.2), autenticação acessível (3.3.8), entrada redundante (3.3.7), ajuda consistente (3.2.6), alternativa a arrastar (2.5.7), e todo comportamento de leitor de tela. **Automação nunca é suficiente para afirmar conformidade.**

---

## Brasil — o que realmente obriga

### Lei Brasileira de Inclusão — Lei 13.146/2015, art. 63

> *"É obrigatória a acessibilidade nos sítios da internet mantidos por empresas com sede ou representação comercial no País ou por órgãos de governo, para uso da pessoa com deficiência, garantindo-lhe acesso às informações disponíveis, conforme as melhores práticas e diretrizes de acessibilidade adotadas internacionalmente."*

- **Alcança empresa privada**, não só governo — basta sede ou representação comercial no Brasil. Inclui e-commerce, concessionária, SaaS, portal de conteúdo, landing page comercial.
- A expressão *"melhores práticas e diretrizes adotadas internacionalmente"* é a porta de entrada da **WCAG** no direito brasileiro.
- **§1º** — símbolo de acessibilidade em destaque no sítio.
- **Sanção:** a LBI não traz multa administrativa específica para site inacessível. A exposição real vem por três vias: **art. 88** (discriminação por deficiência é crime — reclusão de 1 a 3 anos e multa, aumentada para 2 a 5 anos quando praticada por meio de comunicação social ou publicação de qualquer natureza); **ação civil pública** do MP ou de associação, com obrigação de fazer e astreintes; e **ação individual de dano moral** com base no CDC combinado com a LBI.
Fonte: Planalto — *Lei nº 13.146/2015*, arts. 63 e 88 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm

### ABNT NBR 17225:2025 — Acessibilidade digital para web

- **Primeira edição: 11 de março de 2025.** É o desenvolvimento normativo brasileiro mais relevante do período.
- **Adota formalmente a WCAG 2.2**, com seus critérios de sucesso e os três níveis.
- Estrutura em **16 seções temáticas** (teclado, imagens, cabeçalhos, regiões, listas, tabelas, links, botões, formulários, apresentação, cores, conteúdo textual, codificação semântica, áudio/vídeo, animação, tempo).
- Divide-se em **Requisitos** (obrigatórios, equivalentes a A + AA) e **Recomendações** (boas práticas, AAA).
- **Dois graus:** **Conformidade Regular** = todos os requisitos (≈ WCAG 2.2 AA) · **Conformidade Plena** = requisitos + recomendações, admitindo justificativa aceitável.
Fonte: ABNT NBR 17225:2025 (apresentação — Câmara dos Deputados) — https://www2.camara.leg.br/a-camara/estruturaadm/gestao-na-camara-dos-deputados/responsabilidade-social-e-ambiental/acessibilidade/pdfs/ABNTNBR17225AcessibilidadeDigitalparaWeb.pdf

### Decreto 5.296/2004

- **Art. 47** — acessibilidade obrigatória em portais e sítios da administração pública, prazo de 12 meses da publicação, prorrogável por igual período em caso de inviabilidade técnica comprovada em portal de grande porte.
- **Art. 48** — passados 12 meses, acessibilidade em sítios de interesse público torna-se **requisito para obtenção de financiamento público**.
Fonte: Planalto — *Decreto nº 5.296/2004*, arts. 47–48 — https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/decreto/d5296.htm

### eMAG 3.1

- **Versão 3.1, de abril de 2014**; obrigatório para a Administração Pública Federal desde a **Portaria nº 3, de 7 de maio de 2007** (SISP).
- **45 recomendações** em **6 seções**: Marcação, Comportamento (DOM), Conteúdo/Informação, Apresentação/Design, Multimídia, Formulários.
- Baseado na **WCAG 2.0** e **sem níveis A/AA/AAA** — todas as recomendações se aplicam igualmente.
- Validador oficial: **ASES**.
- **Limitação:** ancorado em 2014 e na WCAG 2.0, não cobre reflow, text spacing, alvo de 24px nem autenticação acessível. Em projeto novo, use WCAG 2.2 AA / NBR 17225 como referência técnica e trate o eMAG como requisito formal adicional quando o cliente for governo.
Fonte: eMAG — *Modelo de Acessibilidade em Governo Eletrônico 3.1* — https://emag.governoeletronico.gov.br/

### ABNT NBR 17060:2022 — aplicativos móveis

Publicada em **26 de outubro de 2022**; **54 requisitos** em 4 categorias (Percepção e entendimento, Controle e interação, Mídia, Codificação). Escopo: apps nativos, WebApps, híbridos e sites acessados por dispositivo móvel.
Fonte: ABNT NBR 17060:2022 (CTA/IFRS) — https://cta.ifrs.edu.br/abnt-nbr-17060-2022-acessibilidade-em-aplicativos-de-dispositivos-moveis-requisitos/

### Resumo: o que obriga na prática um site comercial brasileiro

1. **A obrigação é legal, não voluntária** — art. 63 da LBI alcança qualquer empresa com sede ou representação comercial no país.
2. **O alvo técnico é objetivo: WCAG 2.2 nível AA**, materializado como "Conformidade Regular" na NBR 17225:2025. Antes de março de 2025 a cláusula "melhores práticas internacionais" era discutível; hoje há norma ABNT que a preenche — isso **eleva o risco de quem não cumpre** e dá porto seguro documentável a quem cumpre.
3. **Se há app móvel**, some a NBR 17060:2022.
4. **Se é fornecedor de governo**, some eMAG 3.1 e validação por ASES.
5. **Exposição real:** ACP com obrigação de fazer e multa diária, ação individual de dano moral, e inabilitação/descumprimento em contrato público.
6. **Se vende para a UE** (e-commerce, e-book, serviço bancário), o EAA se aplica independentemente de a empresa ser brasileira — o que importa é o mercado atendido.

---

## Internacional — só o que muda decisão de risco

<details>
<summary>Prazos e datas — conteúdo sensível a data (verificado em agosto de 2026)</summary>

### European Accessibility Act — Diretiva (UE) 2019/882

- **Aplicável desde 28 de junho de 2025**, a produtos colocados no mercado e serviços prestados após essa data.
- **Escopo que importa aqui:** e-commerce, e-books, serviços bancários, telefonia, transporte de passageiros, comunicação audiovisual.
- **Isenção de microempresa:** empresas **de serviços** com **< 10 funcionários E faturamento/balanço anual ≤ €2 milhões**. Não vale para fabricantes de produtos.
- **Ônus desproporcional (art. 14):** alegável mediante documentação de evidência, reavaliada a cada 5 anos. É um dossiê defensável, não uma saída fácil.
- **Transição:** contratos de serviço firmados antes de 28/06/2025 podem seguir até **28 de junho de 2030**; terminais de autoatendimento em uso antes dessa data, por até 20 anos de vida útil.
- **Penalidades (art. 30):** definidas por cada Estado-Membro, "efetivas, proporcionais e dissuasivas". Não há valor único europeu — checar a transposição nacional de cada país onde se opera.
Fonte: Comissão Europeia — *European Accessibility Act* — https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en
Fonte: Diretiva (UE) 2019/882 — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng

### EN 301 549

Padrão harmonizado europeu de acessibilidade em TIC e base da presunção de conformidade do EAA. A versão **V3.2.1 (2021)** incorpora o texto integral da **WCAG 2.1**. Um **draft V4.1.0 (novembro de 2025)** foi publicado pelo ETSI, com a V4.1.1 alinhando-se à **WCAG 2.2 AA**. Cláusulas: 9 (web), 10 (documentos), 11 (software e apps), 12 (documentação e suporte), 13 (retransmissão).
Fonte: ETSI — *Draft EN 301 549 V4.1.0 (2025-11)* — https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.00_20/en_301549v040100ev.pdf

### ADA Title II — EUA

Regra publicada no Federal Register em **24 de abril de 2024**: governos estaduais e locais devem cumprir **WCAG 2.1 AA**, incluindo conteúdo operado por terceiros sob contrato. **Interim Final Rule de 20 de abril de 2026 prorrogou todos os prazos em 1 ano.**

| Entidade | Prazo original | Prazo novo |
|---|---|---|
| População ≥ 50.000 | 24/04/2026 | **26 de abril de 2027** |
| População < 50.000 e distritos especiais | 26/04/2027 | **26 de abril de 2028** |

Fonte: Federal Register — *Extension of Compliance Dates…*, 20/04/2026 — https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web
Fonte: ADA.gov — *Fact Sheet: New Rule on the Accessibility of Web Content and Mobile Apps* — https://www.ada.gov/resources/2024-03-08-web-rule/

### Section 508

Obriga **agências federais dos EUA**. Os *Revised 508 Standards* (2017, vigentes desde 2018) incorporam por referência a **WCAG 2.0 AA** e foram harmonizados com a EN 301 549.
Fonte: Section508.gov — *Laws and Policies* — https://www.section508.gov/manage/laws-and-policies/

### Litígio nos EUA — o que muda a leitura de risco

**Mais de 5.000 ações de acessibilidade digital até o fim de 2025.** Distribuição: **e-commerce ~70%**, food service ~21%, saúde 2–3%. Mais de 3.100 casos federais; quase 2.000 nas cortes estaduais de NY e CA. **45% dos casos federais são contra reincidentes** — 1.427 empresas processadas já haviam enfrentado ação anterior. Ser processado uma vez aumenta drasticamente o risco futuro.
Fonte: UsableNet — *ADA Web Lawsuit Trends for 2026* — https://blog.usablenet.com/ada-web-lawsuit-trends-2026

</details>

---

## Overlays de acessibilidade

Scripts de terceiros aplicados sobre um site pronto, em duas formas: **widgets** com controles ao usuário (aumentar fonte, alto contraste, "modo dislexia") e **reparo automatizado** em tempo de execução. Vendidos como conformidade instantânea por uma linha de código.

**Por que não funcionam tecnicamente.** Alternativa textual gerada por IA descreve aparência, não função nem contexto. Reparo de rótulo e de tratamento de erro é inconsistente. Ordem de foco e focus trap não são consertáveis por script externo. Interface dirigida por JavaScript (React, Angular, Vue) não pode ser reparada após o carregamento, porque o DOM muda continuamente. Overlays não alcançam PDF, Canvas, SVG nem mídia. E os widgets duplicam funções que já existem no navegador e na tecnologia assistiva do usuário — frequentemente conflitando com elas. O *Overlay Fact Sheet* é assinado por **mais de 1.031 profissionais**, incluindo contribuidores da própria WCAG e especialistas de Google, Microsoft e Apple, e lista mais de **40 produtos**.
Fonte: *Overlay Fact Sheet* — https://overlayfactsheet.com/en/

**Por que adicionam risco de privacidade.** Overlays detectam uso de tecnologia assistiva **sem consentimento informado**, expondo a condição de deficiência — que no Brasil é **dado pessoal sensível (LGPD, art. 5º, II, e art. 11)**. Alguns rastreiam entre sites via cookies.

**Por que não conferem defesa jurídica.** A **FTC multou a accessiBe em US$ 1 milhão** (ação de janeiro de 2025, ordem final aprovada em 21 de abril de 2025) por alegar enganosamente que o produto tornaria sites *"compliant with WCAG"* e por apresentar endossantes pagos como usuários neutros; a ordem proíbe a empresa de afirmar que overlays garantem conformidade WCAG. **Mais de 1.000 empresas que usavam widgets de acessibilidade foram processadas em 2024**, e os dados de 2026 confirmam que **não houve redução significativa de processos contra usuários de overlay**.
Fonte: Lainey Feingold (LFLegal) — *Beware of AI Accessibility Promises: US Federal Agency Fines an Overlay Company* — https://www.lflegal.com/2025/01/ftc-accessibe-million-dollar-fine/
Fonte: UsableNet — *ADA Web Lawsuit Trends for 2026* — https://blog.usablenet.com/ada-web-lawsuit-trends-2026

**O que fazer no lugar:** auditar (automatizado + manual), corrigir na origem do código, incorporar axe-core no CI, treinar o time, e publicar uma **declaração de acessibilidade honesta** — estado atual, problemas conhecidos, canal de contato e cronograma de correção. É esse tipo de evidência de boa-fé que reduz risco jurídico real. No Brasil, promessa de "conformidade LBI com uma linha de código" tem exposição adicional sob o **CDC, arts. 36–38 (publicidade enganosa)**.

---

## WCAG 3.0 — status real

<details>
<summary>Conteúdo datado — status verificado em agosto de 2026</summary>

**Não é aplicável. Não use para conformidade. Não cite em contrato.**

O último rascunho público é um **W3C Working Draft de 3 de março de 2026**, com o aviso normativo: *"It is inappropriate to cite this document as other than a work in progress."* A seção de diretrizes está em status **"Developing"**. O W3C afirma que a WCAG 3 não é esperada como padrão completo por mais alguns anos, e que a WCAG 2 permanecerá ativa e não será depreciada por vários anos após a finalização da 3.0. O grupo de trabalho planejava definir cronograma detalhado apenas em abril de 2026.

**Modelo estrutural proposto:** *Guidelines* (resultados em linguagem simples, agnósticos de tecnologia) → *Requirements*, divididos em **Core** (obrigatórios) e **Supplemental** (opcionais) → *Methods* (informativos, por tecnologia) → *Assertions* (declarações formais e atribuíveis sobre processos não verificáveis por terceiros — treinamento, teste com usuários de tecnologia assistiva, avaliação heurística; exigem data, contato do responsável e o requisito suportado). Formato condicional *"applies when" / "except when"*.

**Scoring proposto:** três níveis — **Bronze**, **Silver**, **Gold**. O grupo ainda explora se os níveis superiores serão medidos por pontos, percentuais ou conjuntos predefinidos; o Working Draft de março/2026 não detalha o esquema numérico.

**Implicação prática:** o salto conceitual é sair do binário passa/falha por critério para avaliação graduada que incorpora processo organizacional. Interessante — e significa que **nada em WCAG 3 é auditável hoje**. Planeje para WCAG 2.2 AA.

Fonte: W3C — *W3C Accessibility Guidelines (WCAG) 3.0*, Working Draft 03/03/2026 — https://www.w3.org/TR/wcag-3.0/
Fonte: W3C — *Explainer for WCAG 3.0* — https://www.w3.org/TR/wcag-3.0-explainer/
Fonte: W3C WAI — *WCAG 3 Introduction* — https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/

</details>

---

*Números desta referência verificados em agosto de 2026. Reverificar semestralmente: edição do WebAIM Million, status do WCAG 3.0, prazos do EAA e do ADA Title II, edição da EN 301 549.*
