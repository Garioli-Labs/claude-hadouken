# Catálogo de Padrões e Antipadrões de UI

Um bloco por padrão, sempre com a mesma estrutura: **Quando usar** · **Quando não usar** · **Evidência** · **Alternativa** · **Implementação**. Números sem fonte não entram. Onde a evidência é fraca, contestada ou de amostra pequena, a marca ⚠️ acompanha a recomendação e deve ser repassada ao cliente junto com ela.

## Índice

- [1. Modais, dialogs e overlays](#1-modais-dialogs-e-overlays)
- [2. Carrosséis e sliders](#2-carrosséis-e-sliders)
- [3. Formulários](#3-formulários)
- [4. Navegação e arquitetura da informação](#4-navegação-e-arquitetura-da-informação)
- [5. Botões e CTA](#5-botões-e-cta)
- [6. Conteúdo e leitura](#6-conteúdo-e-leitura)
- [7. Feedback e estados](#7-feedback-e-estados)
- [8. Deceptive patterns (dark patterns)](#8-deceptive-patterns-dark-patterns)
- [9. Mobile e toque](#9-mobile-e-toque)
- [10. Os números que mais mudam decisão](#10-os-números-que-mais-mudam-decisão)

---

## 1. Modais, dialogs e overlays

### Taxonomia — antes de discutir se pode, defina o que é

| Tipo | Bloqueia interação? | Foco preso? | Fecha com Esc? | Uso correto |
|---|---|---|---|---|
| **Modal** | Sim | Sim (focus trap) | Sim | Decisão bloqueante curta |
| **Não-modal (dialog)** | Não | Não | Sim | Ferramenta paralela (localizar/substituir) |
| **Popover** | Não | Não (mas devolve ao gatilho) | Sim | Menu, seletor, dica ancorada a um elemento |
| **Drawer / painel lateral** | Depende | Só se modal | Sim | Detalhe ou edição mantendo o contexto da lista |
| **Toast / snackbar** | Não | **Nunca** | N/A | Confirmação passageira + undo |

Metade das discussões sobre "posso usar modal?" morre aqui: o que o time queria era popover ou drawer.

### Quando usar

**Confirmação de ação destrutiva e irreversível** (exclusão sem backup, transferência financeira, encerramento de conta) · **ação bloqueante curta** em que continuar sem decidir é logicamente impossível (escolher a conta ao pagar, resolver conflito) · **interrupção iniciada pelo usuário** — ele clicou, o modal é a resposta ao clique dele e não uma emboscada · **requisito legal genuíno** (verificação de idade, consentimento onde a lei exige) · **fragmentação de fluxo complexo** em passos digeríveis, quando página dedicada não é viável.

### Quando não usar

Captura de e-mail/newsletter em `load` ou por scroll · formulários longos ou multi-passo (perdem deep-link, botão voltar, histórico e recuperação de estado) · conteúdo que precisa ser compartilhável, indexável ou linkável · qualquer coisa em mobile que ocupe a dobra inteira · **modais empilhados**, que são sintoma de arquitetura errada e não de UI · confirmação de ação **reversível** (undo vence confirmar — ver §7) · processos de alto risco em andamento, como checkout · decisões que exigem informação externa que o usuário não tem à mão.

### Evidência

**Rejeição medida.** No estudo da NN/g com **452 adultos americanos** (excluídos profissionais de TI e marketing), anúncios modais ficaram no topo dos formatos mais odiados em desktop **e** em mobile; média geral de rejeição **5,23/7**, com mobile pior que desktop (**5,45 vs 5,09**). O único formato considerado "completamente seguro em mobile" foram links relacionados.
Fonte: NN/g, *The Most Hated Online Advertising Techniques* — https://www.nngroup.com/articles/most-hated-advertising-techniques/

**O ranking que descreve, item a item, um modal de captura de e-mail** (n=605): aparece na frente da sua janela **95%** · carrega devagar 94% · tenta enganar para clicar 94% · **não tem botão de fechar 93%** · **cobre o que você tenta ver 93%** · não indica seu propósito 92% · move o conteúdo 92% · ocupa a maior parte da página 90%.
Fonte: NN/g, 2004 — https://www.nngroup.com/articles/most-hated-advertising-techniques-2004/

**Penalidade de busca.** Desde **10 de janeiro de 2017** o Google trata intersticiais intrusivos em mobile como sinal negativo de ranqueamento. Penalizados: pop-up que cobre o conteúdo na chegada da busca ou durante o scroll; intersticial standalone que precisa ser descartado; layout cuja dobra imita um intersticial. **Isentos:** obrigação legal (cookies, verificação de idade), diálogo de login para conteúdo privado não indexável, e banners que usam parcela razoável da tela e são facilmente dispensáveis. Orientação prática de implementação: manter o banner em **≤15% da tela**, inclusive em landscape.
Fonte: Search Engine Land — https://searchengineland.com/interstitialgeddon-google-warns-will-crack-intrusive-interstitials-next-january-257252 · Smashing Magazine — https://www.smashingmagazine.com/2017/05/intrusive-interstitials-guidelines-avoid-google-penalty/

**Overlay overload.** A NN/g documenta o efeito cumulativo de múltiplos overlays concorrentes na mesma sessão (cookie + newsletter + chat + app install). Ninguém mede esse efeito porque **cada overlay é aprovado isoladamente por um dono diferente** — em auditoria, conte os overlays de uma sessão inteira, não de uma página.
Fonte: NN/g, *Overlay Overload* — https://www.nngroup.com/articles/overlay-overload/ · NN/g, *Popups: 10 Problematic Trends and Alternatives* — https://www.nngroup.com/articles/popups/

**Custo da interrupção.** Tempo médio em uma esfera de trabalho antes de troca ou interrupção: **11 min 4 s**; **57,1%** dos segmentos de trabalho foram interrompidos; tempo até retomar a tarefa no mesmo dia: **25 min 26 s** (n=24, 700+ horas de observação). Interrupção não torna o trabalho mais lento — torna mais caro: estresse 6,92 → ~9,3 (p<.001), frustração 4,73 → ~6,6 (p<.007), esforço 9,50 → ~11,3 (p<.001), n=48.
Fonte: Mark, Gonzalez & Harris, CHI 2005 — https://ics.uci.edu/~gmark/CHI2005.pdf · Mark, Gudith & Klocke, CHI 2008 — https://ics.uci.edu/~gmark/chi08-mark.pdf

**Argumento estrutural.** Cooper chama de "stopping the proceedings with idiocy" o diálogo que interrompe para comunicar algo que o sistema poderia resolver ou apresentar sem bloquear; a prescrição dele é **modeless feedback**. Complemento técnico do MIT 6.831: o modal impede mover ou rolar a janela principal para trazer à vista a informação necessária, forçando o usuário a **memorizar** o que está atrás em vez de ver os dois lado a lado.
Fonte: MIT 6.831, lec09 — https://ocw.mit.edu/courses/6-831-user-interface-design-and-implementation-spring-2011/d2a0ed39477927d9e585a9115c68d2ff_MIT6_831S11_lec09.pdf · NN/g, *Modal & Nonmodal Dialogs* — https://www.nngroup.com/articles/modal-nonmodal-dialog/

### Alternativa — árvore de decisão, em ordem de preferência

1. **Nada.** A informação é necessária *agora*? Se a resposta é "queremos que vejam" e não "não podem prosseguir sem", não é modal.
2. **Inline / disclosure progressivo no lugar** — erros de formulário, detalhes contextuais, edição de item em lista. Custo de contexto zero.
3. **Painel não-modal / sidebar** — quando o usuário precisa consultar o fundo enquanto age; elimina o problema de memorização do MIT 6.831.
4. **Página dedicada com URL própria** — obrigatória para qualquer fluxo com mais de um passo: ganha voltar, refresh, compartilhamento, histórico, acessibilidade e analytics decente.
5. **Toast com undo** — substitui confirmação em ações reversíveis.
6. **Banner inline ou barra fixa ≤15% da tela** — consentimento e avisos persistentes.
7. **Modal** — último recurso, restrito aos casos de "Quando usar".

### Implementação

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` apontando para o título. Prefira `<dialog>` nativo com `showModal()`: entrega focus trap, `inert` de fundo e Esc de graça.
- **Focus trap obrigatório.** Foco inicial no primeiro elemento interativo, ou no título se o conteúdo for longo; ao fechar, **devolver o foco ao elemento que abriu**. Esc fecha sempre; clique no backdrop fecha **apenas** se não houver dados não salvos. `inert` (ou `aria-hidden="true"`) no conteúdo de fundo enquanto aberto.
- Travar o scroll do body compensando a largura da scrollbar, para não causar "jump".
- **Máximo 1 modal por vez. Zero modais empilhados.** Botão de fechar sempre visível — a ausência dele tem **93%** de rejeição medida (NN/g 2004, acima).
- Botão destrutivo **nunca** é o foco padrão; rotule com o verbo real ("Excluir 3 arquivos"), nunca "OK".
- Viewport < 768px: full-screen com header e "Voltar" explícito, ou substitua por página.
- Nunca dispare em `load`, em `scroll`, nem antes de **30 segundos** ou 2 páginas de sessão. Nunca em checkout; nunca no carregamento vindo de busca em mobile (penalidade Google 2017).

---

## 2. Carrosséis e sliders

### Quando usar

**Galeria de imagens de um único produto** — o usuário já quer ver mais ângulos do mesmo objeto, a intenção é clara · **lista horizontal rolável de itens equivalentes** ("Continue assistindo", "Mais vendidos"), que funciona porque é lista e não rotator que esconde conteúdo · espaço genuinamente escasso com conteúdo **secundário**.

### Quando não usar

Hero de homepage rotativo com mensagens institucionais concorrentes · onde os slides representam **prioridades disputadas por áreas internas** (aí o carrossel é móvel político, não solução de design) · auto-rotação sem controle de pausa · conteúdo crítico de conversão ou navegação primária.

### Evidência

Instrumentação de carrosséis reais (Notre Dame e outros sites), out/2012–jan/2013, sobre **315.665 rotações e 28.928 cliques**: no **nd.edu**, ~**1% dos visitantes** clicava em qualquer feature, e desses cliques **84% foram no primeiro slide**, ~4% em cada posição restante. Nos **carrosséis estáticos (3 sites)**, CTR de **1,7%–2,3%**, com a primeira posição concentrando **48–62%** dos cliques — e a distribuição mais equilibrada foi a do site com **menos slides (3)**. No de **auto-avanço**, CTR de **8,8%** com slide 1 = **40%**, slide 2 = 18% e último = **11%**.

O engajamento cai à medida que o número de slides cresce, e o slide 1 domina em todas as configurações. Slides 3+ são conteúdo invisível com custo de manutenção, performance e acessibilidade.
Fonte: Erik Runyon, *Carousel Interaction Stats* — https://erikrunyon.com/2013/01/carousel-interaction-stats/ · atualização jun/2013 — https://erikrunyon.com/2013/07/carousel-interaction-stats/ · Smashing Magazine, *Carousel Usage on Mobile E-Commerce* — https://www.smashingmagazine.com/2015/02/carousel-usage-exploration-on-mobile-e-commerce-websites/

### Alternativa

**Hero único** com a mensagem prioritária e um CTA — se há 5 mensagens, o problema é de estratégia, não de UI · **grid de 2–3 cards** visíveis ao mesmo tempo, tudo escaneável e indexável · **lista com scroll horizontal nativo** (`scroll-snap`) para catálogos · **tabs** quando o conteúdo é categórico e a escolha é do usuário.

### Implementação (padrão APG)

- Container: `role="region"` (ou `group`) + `aria-roledescription="carousel"` + `aria-label`. Cada slide: `role="group"` + `aria-roledescription="slide"` + `aria-label="3 de 7"`.
- Se auto-rotacionar: botão pausar/reproduzir como **primeiro elemento focável**; pausar em `hover`, em `focus-within` e ao entrar em qualquer slide; desativar a rotação sob `prefers-reduced-motion: reduce`. Intervalo mínimo de **5 s** — a WCAG 2.2.2 exige mecanismo de pausa para movimento acima de 5 s.
- Slides fora de vista com `inert`/`hidden`, para não capturarem foco nem leitura de tela.
- Controles com alvo ≥ **44×44 px**; indicadores clicáveis mostrando posição e total.
- **Máximo 3–5 slides.** Slide 1 no HTML inicial; demais com `loading="lazy"`.

---

## 3. Formulários

### Quando usar / quando não usar

Formulário é meio, não fim. A pergunta correta não é "como desenhar este campo" e sim **"este campo precisa existir?"**. Cada campo é uma unidade de atrito com custo de conversão mensurável; campo que alimenta o CRM mas não completa a tarefa do usuário sai.

### Evidência

**Número de campos.** Checkout médio: **11,3 campos e 5,1 passos**, contra alvo alcançável de **8 campos** — 3,3 campos removíveis sem perda funcional. Adoção das cinco táticas de redução: campo único "Nome completo" **11%** dos sites · esconder "Complemento" atrás de link **25%** · esconder cupom **65%** · assumir cobrança = entrega **76%** · adiar criação de conta para o pós-compra **16%**.
Fonte: Baymard — https://baymard.com/blog/checkout-flow-average-form-fields

**Posição do label — eye-tracking (Penzo):**

| Posição do label | Sacada média | Efeito |
|---|---|---|
| **Acima do campo** | **~50 ms** | Label e campo em um único movimento ocular; menor tempo total |
| À esquerda, alinhado à direita | 170 ms (experts) / 240 ms (novatos) | ~50% menos fixações que alinhado à esquerda |
| À esquerda, alinhado à esquerda | ~**500 ms** | Carga cognitiva alta; máximo de fixações |
| Acima, em **negrito** | 50 → **80 ms (+60%)** | **Piora** o desempenho — confunde-se com a borda do campo |

O achado mais ignorado é o último: aumentar o peso visual do label **degradou** a performance.
Fonte: Matteo Penzo, *Label Placement in Forms*, UXmatters — https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php

**Validação inline:** **+22% na taxa de sucesso**, **−22% em erros**, **+31% em satisfação**, **−42% no tempo**, **−47% em fixações oculares**.
⚠️ **Evidência de amostra pequena: n=22.** O próprio estudo concluiu que o ganho se concentra em campos cuja resposta correta o usuário **não consegue prever** (usuário, senha, disponibilidade) — não em nome e endereço. Evidência posterior mostra que validação **prematura** (a cada tecla) *aumenta* erros. Padrão correto: **"recompense cedo, puna tarde"** — validar no `blur`, remover o erro em tempo real assim que corrigido.
Fonte: Luke Wroblewski / Etre, A List Apart — https://alistapart.com/article/inline-validation-in-web-forms/

**Teclado mobile:** **54%** dos sites móveis falham em invocar teclado otimizado para telefone, CEP ou cartão · **79%** não desabilitam autocorreção onde deveriam · **27%** erram a capitalização · **85%** violam ao menos uma das cinco diretrizes. Implementações perfeitas foram de **2% para 15%** entre 2013 e 2015.
Fonte: Baymard — https://baymard.com/blog/mobile-touch-keyboards

### Alternativa

**Derivar em vez de perguntar** (CEP → logradouro/bairro/cidade/UF; BIN do cartão → bandeira) · **checkout como convidado** por padrão, com criação de conta depois da compra (só a senha, reaproveitando o já digitado) · **autofill do navegador** em vez de digitação · **multi-step com URL própria por passo** em vez de formulário-monólito.

### Implementação

**Estrutura.** Coluna única; largura do campo **proporcional ao dado esperado** (CEP curto, endereço longo) — isso é signifier, não decoração. Exceção legítima: campos atômicos e curtos na mesma linha (CEP + número; validade + CVV; cidade + UF). Label **acima**, peso normal, sempre visível, com `<label for>` real. Marque **os opcionais** com "(opcional)" em vez dos obrigatórios com asterisco, e nunca indique obrigatoriedade só por cor. O espaço entre label e seu campo deve ser visivelmente menor que entre grupos — proximidade agrupa mais forte que cor ou borda.

**Placeholder não é label.** Some ao digitar, justo quando o usuário revisa · contraste baixo por definição (e se aumentar, parece campo preenchido) · quebra autofill e tradução automática · suporte inconsistente como nome acessível · aumenta erro de revisão. Use apenas como **exemplo de formato** ("ex.: 01310-100").

**Teclado e autofill (pt-BR)**
```html
<input type="email"   autocomplete="email"       inputmode="email">
<input type="tel"     autocomplete="tel"         inputmode="tel">
<input name="cep"     autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}-?[0-9]{3}" maxlength="9">
<input name="cpf"     inputmode="numeric" autocomplete="off" maxlength="14">
<input name="cardnum" autocomplete="cc-number"   inputmode="numeric" autocorrect="off" spellcheck="false">
<input name="nome"    autocomplete="name"        autocapitalize="words">
```
Use `inputmode="numeric"` em vez de `type="number"` para CEP/CPF/cartão: evita spinner, scroll acidental alterando valor e perda de zeros à esquerda. Desative `autocorrect` e `spellcheck` em e-mail, CPF, cartão e cupom.

**Endereço e CEP no Brasil.** CEP como **primeiro** campo do bloco; ao completar 8 dígitos, consultar ViaCEP/BrasilAPI e preencher logradouro, bairro, cidade e UF. **Mantenha os campos preenchidos visíveis e editáveis** — bases de CEP têm lacunas (zona rural, CEP único de município). Foco automático em **Número** após o autopreenchimento; "Complemento" atrás de link; UF como `<select>` de 27 itens ou derivada do CEP. Sempre com fallback manual — **nunca** bloqueie a compra por indisponibilidade da API.

**Máscaras.** Máscara na exibição, **valor limpo** no envio. Não impedir colagem; normalizar o colado. Telefone brasileiro aceita 8 e 9 dígitos; cartão aceita espaços e formata em grupos de 4.

**Validação e erros.** Validar no `blur` e limpar o erro durante a correção · erro **adjacente ao campo**, com ícone + texto (não só cor), `aria-describedby` e `aria-invalid="true"` · resumo no topo com links âncora e foco movido para ele no submit falho · microcopy diz **o que houve + como resolver** ("CEP deve ter 8 dígitos" > "Campo inválido") e nunca culpa o usuário · **nunca apague o que foi digitado**.

**CAPTCHA.** Custo de conversão real e desproporcional, pior para usuários com deficiência visual, cognitiva e motora. Ordem de preferência: **honeypot** → **rate limiting** por IP/sessão → análise comportamental server-side → CAPTCHA invisível/risk-based → só então desafio visível. Se inevitável, jamais em compra ou login recorrente, e sempre com alternativa acessível.

---

## 4. Navegação e arquitetura da informação

### Quando usar cada elemento

**Nav horizontal visível:** desktop, até ~7 itens de topo · **mega-menu:** catálogo amplo com 2–3 níveis e categorias visualmente agrupadas · **breadcrumb:** hierarquias com 3+ níveis, essencial quando há tráfego de busca chegando em páginas profundas · **busca no site:** essencial acima de ~100 itens, em qualquer catálogo ou base de conhecimento, e quando o vocabulário do usuário diverge do institucional · **footer:** rede de segurança (institucional, jurídico, contato, atendimento, mapa do site).

### Quando não usar

**Hambúrguer em desktop** onde há espaço horizontal — é a troca de descobribilidade por estética mais cara do catálogo · mega-menu em site com poucas seções · breadcrumb como substituto de navegação primária · busca como desculpa para não organizar a informação.

### Evidência

n=179, 6 sites reais, comparando navegação escondida, visível e combo:

| Métrica | Desktop | Mobile |
|---|---|---|
| Uso da nav — escondida | **27%** | 57% |
| Uso — visível | **48%** | — |
| Uso — combo | **50%** | **86%** |
| Tempo até o primeiro uso (escondida) | **+5–7 s** | ~+2 s |
| Tempo de tarefa (escondida) | **≥39% mais lento** | 15% mais lento |

A navegação escondida produziu **queda de mais de 20% na taxa de sucesso** em ambas as plataformas e **+21%** de dificuldade percebida vs visível (+11% vs combo).

Leitura correta: em **desktop o hambúrguer é indefensável** quando há espaço; em **mobile, o combo** (itens prioritários visíveis + resto no menu) supera o hambúrguer puro por larga margem — **86% vs 57%**.
Fonte: NN/g, *Hamburger Menus and Hidden Navigation Hurt UX Metrics* — https://www.nngroup.com/articles/hamburger-menus/ · NN/g, *Beyond the Hamburger* — https://www.nngroup.com/articles/find-navigation-desktop-not-hamburger/ · NN/g, *Menu-Design Checklist* — https://www.nngroup.com/articles/menu-design/

### Alternativa

Desktop: nav horizontal completa, com mega-menu se o catálogo exigir. Mobile: **combo** — 3–5 itens prioritários visíveis (bottom nav) + "Mais". Rótulos derivados de **card sorting** com usuários, não do organograma.

### Implementação

- **Profundidade × amplitude:** prefira hierarquias **rasas e largas**. Alvo: **máximo 3 cliques** até qualquer conteúdo relevante; profundidade ≤ 3–4 níveis; amplitude de **5–9 itens** por nível é confortável — acima disso, agrupe visualmente. Mega-menu resolve amplitude alta, não profundidade alta.
- **Card sorting** (aberto para descobrir o modelo mental, fechado para validar rótulos) com **15–30 participantes** — retorno decrescente acima disso. **Tree testing** valida a estrutura **sem** interface, com alvo prático de **>70% de sucesso** e **>60% de diretividade** por tarefa.
- Rotulagem com substantivos concretos do vocabulário do usuário. Evite "Soluções", "Recursos", "Nosso ecossistema".
- Mega-menu: abrir por clique ou por hover com **delay de 200–300 ms** (evita abertura acidental na diagonal); navegável por setas; `aria-expanded`; fecha com Esc.
- Breadcrumb: `<nav aria-label="Trilha de navegação">` + `<ol>`; item atual com `aria-current="page"` e sem link. Não substitui o botão voltar.
- Busca: campo visível (não ícone) em telas ≥768px, com **mínimo 27 caracteres** de largura visível; autocomplete com sugestões; página de "nenhum resultado" **nunca** vazia — ofereça correção de digitação, busca relaxada e categorias populares.
- Estado ativo explícito no item correspondente à página atual.

---

## 5. Botões e CTA

### Quando usar

**Primário** (preenchido, alto contraste): a ação que o usuário mais provavelmente quer — **um por região visual** · **secundário** (outline/tonal): alternativa legítima e frequente ("Salvar rascunho") · **terciário** (link/texto): ações de escape de baixa consequência ("Cancelar", "Pular").

### Quando não usar

Dois primários competindo na mesma dobra (anula a hierarquia e aumenta o tempo de decisão) · ghost button como CTA principal · `disabled` como mecanismo de validação de formulário · botão para navegação pura — se navega, é `<a>`.

### Evidência

Interfaces com **signifiers fracos** (flat design extremo, ghost buttons, elementos sem borda nem fundo) fazem o usuário **gastar mais tempo olhando a página** para completar tarefas simples de findability. O custo aparece em tempo e incerteza, não necessariamente em falha total, e é maior para usuários mais velhos, menos experientes e em telas pequenas.
Fonte: NN/g, *Long-Term Exposure to Flat Design* — https://www.nngroup.com/articles/flat-design-long-exposure/

Tamanho de alvo, por norma:

| Referência | Valor | Nível |
|---|---|---|
| WCAG 2.2 SC 2.5.8 Target Size (Minimum) | **24×24 px CSS** | AA (com exceções de espaçamento, inline e essencial) |
| WCAG 2.1 SC 2.5.5 Target Size (Enhanced) | **44×44 px CSS** | AAA |
| Apple HIG | **44×44 pt** | — |
| Material Design | **48×48 dp**, com **8 dp** entre alvos | — |

**24 px é o piso legal; 44–48 px é o alvo de design.**
Fonte: W3C / WCAG.com, 2.5.8 — https://www.wcag.com/developers/2-5-8-target-size-minimum-level-aa/ · CSS-Tricks, WCAG 2.5.5 — https://css-tricks.com/looking-at-wcag-2-5-5-for-better-target-sizes/

### Alternativa

Em vez de **ghost button** como CTA principal, botão preenchido — reserve o ghost para ação secundária sobre imagem/hero. Em vez de **`disabled`**, botão sempre habilitado: ao clicar com erros, valide, mostre o resumo e **mova o foco** para o primeiro campo problemático. Botão desabilitado (i) não recebe foco, (ii) não é anunciado por leitor de tela, (iii) não explica **por que** está bloqueado, (iv) tem contraste baixo por convenção. Se for mesmo necessário bloquear, use `aria-disabled="true"` mantendo-o focável e explicando o motivo.

### Implementação

- **Microcopy: verbo + objeto.** "Criar conta", "Baixar relatório", "Agendar demonstração" — nunca "Enviar", "OK", "Clique aqui". Primeira pessoa ("Quero meu orçamento") funciona em landing page e destoa em produto; escolha uma convenção e mantenha.
- **Máximo 1 CTA primário por seção**; 2 apenas se forem caminhos genuinamente equivalentes.
- Alvo mínimo **24×24 px**, recomendado **44×44 px**, espaçamento **≥8 px** entre alvos adjacentes. A área de toque pode exceder a visual via padding ou pseudo-elemento — o alvo não precisa ser todo pintado.
- **Cinco estados obrigatórios:** default, hover, **focus-visible**, active, disabled/`aria-disabled`. Foco com outline **≥2 px** e contraste **≥3:1** contra o fundo adjacente; nunca `outline: none` sem substituto.
- Contraste de texto **≥4,5:1**; borda ou fundo do controle **≥3:1** (SC 1.4.11).
- Botão destrutivo: cor de alerta e confirmação **apenas se irreversível**; caso contrário execute e ofereça undo.
- Carregamento no próprio botão, **preservando a largura** (evita layout shift), com `aria-busy="true"` e bloqueio de duplo-submit. Ordem dos botões consistente em todo o produto.

---

## 6. Conteúdo e leitura

### Quando usar / quando não usar

Texto longo é legítimo quando a motivação é alta (documentação, comparativo, política). O erro não é escrever muito: é escrever muito **sem estrutura de escaneamento**, porque a leitura integral é a exceção, não a regra.

### Evidência

**As pessoas escaneiam, não leem.** Reanálise de **45.237 visualizações de página** (limpas de 59.573), em páginas de 30 a 1.250 palavras: o usuário tem tempo de ler **no máximo 28%** das palavras numa visita média, sendo **20% o mais provável** · ao adicionar texto novo a uma página, apenas **~18%** do texto adicional é lido · página média de **593 palavras**, com tempo-base fixo de **~25 s** mais **4,4 s por 100 palavras** adicionais · em páginas de **111 palavras ou menos**, o usuário lê ~**50%** do conteúdo.
Fonte: NN/g, *How Little Do Users Read?* — https://www.nngroup.com/articles/how-little-do-users-read/

**Quatro padrões de escaneamento** (eye-tracking NN/g) — não apenas o F: **F-pattern**, fixações no início das linhas e no topo, que é **sintoma de conteúdo mal estruturado** e não objetivo de design · **spotted**, caça a palavras que se destacam (negrito, links, números) · **layer-cake**, fixações em títulos e subtítulos pulando o corpo até achar a seção certa, descrito pela NN/g como "de longe a forma mais eficaz de escanear uma página" · **commitment**, leitura integral quando a motivação é alta.

O objetivo de design é **provocar o layer-cake**: se o usuário cai no F-pattern, faltam subtítulos.
Fonte: NN/g, *Text Scanning Patterns* — https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/ · NN/g, *The Layer-Cake Pattern* — https://www.nngroup.com/articles/layer-cake-pattern-scanning/

**⚠️ A regra dos 45–75 caracteres é contestada.** A origem é tipográfica (Bringhurst), baseada em prática de impressão, não em experimento com tela. Estudo da Wichita State (2005) testou **35, 55, 75 e 95 cpl** em leitura de notícias na tela: a **velocidade de leitura foi maior a 95 cpl e menor a 35 cpl**, e o comprimento de linha **não teve impacto na compreensão**. A recomendação honesta é **~60–90 cpl** para conforto — e o erro mais frequente em layouts de coluna estreita é a linha **curta demais** (<45), não a longa.
Fonte: Viget, *The Line Length Misconception* — https://www.viget.com/articles/the-line-length-misconception

### Alternativa

**Pirâmide invertida:** conclusão primeiro, depois o essencial, depois o detalhe. Como só 20–28% é lido, o que fica de fora precisa ser a parte menos importante — e isso só acontece se a mais importante vier antes.

### Implementação

- **Corpo: mínimo 16px (1rem).** Três motivos concretos: é o default do navegador (respeita a escolha do usuário); **iOS Safari dá zoom automático em `<input>` com fonte < 16px**, quebrando o layout no foco; abaixo disso a legibilidade cai para présbitas e baixa visão. Em texto longo, 17–20px é melhor. **Nunca desative o zoom** (`user-scalable=no`, `maximum-scale=1`) — viola WCAG 1.4.4.
- **Comprimento de linha 60–90 caracteres** (`max-width: 65ch`–`80ch`); evite < 45 cpl.
- **Altura de linha (WCAG 1.4.12):** corpo **≥1,5**; espaçamento entre parágrafos ≥2× o tamanho da fonte; `letter-spacing` ≥0,12em e `word-spacing` ≥0,16em suportados sem perda de conteúdo. Títulos podem usar 1,1–1,3.
- Um subtítulo a cada **~150–200 palavras**, **descritivo** e não criativo — quem escaneia em layer-cake decide por ele. Parágrafos de **2–4 linhas**, uma ideia cada.
- **Front-load:** as 2 primeiras palavras de título, subtítulo, item de lista e link carregam a informação. Links com texto significativo; nunca "clique aqui" isolado.
- **Nível de leitura:** alvo de 6º–8º ano para público geral; em pt-BR, frases de **15–20 palavras**, voz ativa, sem nominalizações ("realizar a efetivação do pagamento" → "pagar").
- Alinhe a **um só lado** — texto justificado cria "rivers of white" e prejudica leitores com deficiência cognitiva (W3C, técnica G169 — https://www.w3.org/TR/WCAG20-TECHS/G169.html).
- Contraste de texto **≥4,5:1**; **≥3:1** para texto grande (18,66px bold ou 24px regular).

---

## 7. Feedback e estados

### Quando usar

Todo estado que o usuário pode inferir errado precisa ser explicitado: carregando, vazio, erro, sucesso, parcial, sem permissão, offline.

### Quando não usar

Indicador para operação abaixo de 300 ms (spinner que pisca é pior que nada) · toast para informação que o usuário vai precisar depois, que é log ou estado na página · confirmação ("Tem certeza?") para ação reversível.

### Evidência

**Limiares de resposta** (Nielsen, *Usability Engineering*, 1993): **0,1 s** sensação de instantaneidade, nenhum feedback necessário · **1,0 s** o usuário nota mas mantém o fluxo de pensamento · **10 s** limite da atenção; acima disso é obrigatório indicador **determinado**, com percentual ou ETA.
Fonte: NN/g — https://www.nngroup.com/articles/response-times-3-important-limits/ · Nielsen / UX Tigers, *Progress Indicators Ease the Wait* — https://www.uxtigers.com/post/progress-indicators

**⚠️ Skeleton screens vs spinners — evidência conflitante, e isso importa:**
- Chung (Vancouver, **n=80**): skeletons produziram o **menor tempo percebido** de carregamento, e o *shimmer* animado superou spinners em **60–68%**. — https://www.researchgate.net/publication/326858669
- Viget (**n=136**, mobile): skeletons foram percebidos como **os mais lentos — 2,82 s vs 2,41 s** do spinner; apenas **59%** dos que viram skeleton concordaram que o conteúdo carregou rápido, contra **74%** no spinner.

Leitura defensável: skeletons funcionam quando **prevêem honestamente um layout familiar que resolve em ~3 segundos**; fracassam quando o placeholder não corresponde ao conteúdo final ou quando a espera é longa. **Não é vitória universal — não venda como se fosse.**

**Undo vence confirmar.** Um aviso pergunta *antes* de o usuário saber se errou e é ignorado por hábito depois da terceira exposição — a caixa "Tem certeza?" treina o clique automático em "Sim" e portanto **não protege de nada**. Undo age *depois*, quando o erro já é conhecido, custa zero atrito no caminho feliz (o caso de 99%) e cobre erros que a confirmação jamais detectaria.
Fonte: Aza Raskin, *Never Use a Warning When you Mean Undo*, A List Apart — https://alistapart.com/article/neveruseawarning/

### Alternativa

**Undo** para tudo que é reversível; confirmação só para o irreversível. **Loading otimista:** aplique a mudança na UI imediatamente, envie ao servidor em segundo plano e reverta com mensagem clara se falhar — adequado a ações de alta taxa de sucesso e baixa consequência (curtir, marcar concluído, reordenar), **inadequado** a pagamento, transferência e qualquer efeito externo irreversível. **Estados vazios como onboarding**, não como erro.

### Implementação

**Loading (escada de decisão)**
| Duração | O que mostrar |
|---|---|
| < 300 ms | Nada |
| 300 ms – 1 s | Mudança sutil ou spinner local |
| 1 – 10 s | Skeleton (se o layout for previsível) ou spinner com rótulo do que está acontecendo |
| > 10 s | Barra **determinada** com percentual, estimativa e opção de cancelar |

- Skeleton deve **espelhar o layout real** (mesmas dimensões e posições) para não causar layout shift; respeitar `prefers-reduced-motion` desligando o shimmer.
- Nunca aplique skeleton a conteúdo de tamanho desconhecido.

**Estados vazios** — quatro elementos: (1) o que é este espaço, (2) por que está vazio, (3) **uma** ação primária para preenchê-lo, (4) opcionalmente um dado de exemplo. E são **quatro telas diferentes**, não uma: vazio inicial ≠ zero resultados de busca ≠ erro de carregamento ≠ sem permissão.

**Mensagens de erro** — fórmula: **o que aconteceu + por quê + o que fazer agora**. Linguagem humana; código técnico só como texto secundário para suporte. Nunca culpe o usuário ("Você digitou errado" → "Não encontramos este CPF"). Preserve os dados digitados, sempre. Ofereça saída: tentar de novo, contatar suporte, voltar.

**Toasts / snackbars — onde quebram acessibilidade.** Um toast é efêmero, sem foco e frequentemente **invisível** para quem usa leitor de tela ou ampliação (aparece fora da área ampliada). Regras: `role="status"` + `aria-live="polite"` para confirmações e `role="alert"` + `aria-live="assertive"` **apenas** para erros urgentes · **nunca coloque a única forma de executar uma ação dentro de um toast** (se há "Desfazer", ele precisa ser alcançável por teclado e o toast **não pode desaparecer enquanto tiver foco**) · duração mínima **5 s**, **+1 s a cada 10 palavras** adicionais, porque a WCAG 2.2.1 exige mecanismo de ajustar ou dispensar conteúdo temporizado · sempre com botão fechar · nunca empilhe mais de 3.

---

## 8. Deceptive patterns (dark patterns)

O termo oficial hoje é **deceptive patterns**, não "dark patterns".

### Quando usar

Nunca. Este bloco existe para **identificar e remover**, e para dar o argumento de negócio a quem pediu o padrão.

### Quando não usar — a taxonomia dos 18 tipos

| Grupo | Padrões |
|---|---|
| **Coagir** | **Forced Action** (para conseguir X, é obrigado a fazer Y) · **Obstruction** (barreira artificial à tarefa) · **Hard to Cancel** (assinar é fácil, cancelar é labirinto) · **Nagging** (mesmo pedido repetido) |
| **Esconder** | **Sneaking** (informação relevante escondida ou revelada tarde) · **Hidden Costs** (taxas surpresa no checkout) · **Hidden Subscription** (recorrência sem divulgação clara) · **Comparison Prevention** (dificultar comparar preço/recursos) |
| **Enganar visualmente** | **Visual Interference** (informação obscurecida) · **Disguised Ads** (publicidade imitando conteúdo ou controle) · **Preselection** (opção já marcada) · **Trick Wording** (redação que inverte o sentido da ação) |
| **Fabricar pressão** | **Fake Urgency** (contador que não significa nada) · **Fake Scarcity** ("só restam 2!" sem lastro) · **Fake Social Proof** (avaliações e atividade inventadas) · **Confirmshaming** ("Não, prefiro pagar caro") |
| **Explorar** | **Addictive Design** (uso compulsivo por vulnerabilidade psicológica) · **Currency Confusion** (moeda virtual que obscurece o gasto real) |

Fonte: Harry Brignull, *Types of deceptive pattern* — https://www.deceptive.design/types

### Evidência

**Escala.** Rastreamento de **~11.000 sites** de e-commerce e **~53.000 páginas de produto**: **1.818 instâncias** de deceptive patterns, em 15 tipos e 7 categorias; **183 sites** com práticas explicitamente enganosas (contadores falsos, atividade fabricada); e **22 empresas terceirizadas** vendendo esses padrões como **solução turnkey** — é produto comercializado, não acidente de design. Fonte: Mathur et al., *Dark Patterns at Scale*, Princeton, 2019 — https://arxiv.org/abs/1907.07032

**Consent banners — a prova quantitativa da intenção.** Análise de **680 sites** (top 10.000 do Reino Unido, cinco maiores CMPs) mais experimento de campo com 40 participantes: **apenas 11,8% atendiam aos requisitos mínimos** da legislação europeia; **remover o botão de recusa da primeira tela aumenta o consentimento em 22–23 pontos percentuais**; **oferecer controles granulares na primeira tela reduz o consentimento em 8–20 pp**. A assimetria vale ~22 pp de "consentimento" — é por isso que a não-conformidade é a norma.
Fonte: Nouwens et al., *Dark Patterns after the GDPR*, CHI 2020 — https://arxiv.org/abs/2001.02479

**Regulação aplicável.** **LGPD + Guia Orientativo da ANPD sobre Cookies (out/2022)** exige consentimento livre, informado e inequívoco; **botão de recusar todos os cookies não-necessários com visualização fácil e proeminência equivalente ao aceitar**; não-necessários **desativados por padrão**; **proibição de cookie wall**; mecanismo de revogação. Listadas como problemáticas: banner de botão único, aceitação pré-selecionada e botão de recusa mais difícil de achar. O **CDC (Lei 8.078/90)**, arts. 6º, 30, 31 e 37, já veda publicidade enganosa e informação insuficiente, e vincula a oferta.
Fonte: ANPD — https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf

Fora do Brasil: o **GDPR** exige que recusar seja tão fácil quanto aceitar e invalida caixas pré-marcadas (*Planet49*, TJUE C-673/17); o **DSA art. 25** proíbe interfaces que distorçam materialmente a decisão do usuário; o **CPRA** (Califórnia) estabelece que consentimento obtido por deceptive pattern **não é consentimento válido**; e a **FTC** aplicou US$ 520 milhões à Epic Games, **US$ 245 milhões especificamente por dark patterns** (2022/2023) — https://www.ftc.gov/business-guidance/blog/2022/12/245-million-ftc-settlement-alleges-fortnite-owner-epic-games-used-digital-dark-patterns-charge
⚠️ **Atenção ao citar:** a regra **Click-to-Cancel** foi **anulada pelo Oitavo Circuito em julho de 2025 por vício processual (APA), não por mérito**, e a FTC abriu ANPRM em março de 2026 para reeditá-la — citá-la como vigente é erro. A Seção 5 e a ROSCA seguem aplicadas (acordos de US$ 2,5 bi com a Amazon e US$ 8,5 mi com a Care.com).

### Alternativa — o argumento de negócio, para quem não se move por ética

1. **Otimizam a métrica errada:** ganham conversão de primeira ordem e perdem LTV — assinatura arrancada por obstrução vira chargeback, cancelamento hostil e review negativa.
2. **Custo de suporte:** cobrança-surpresa gera ticket, e o ticket custa mais que a margem da conversão forçada.
3. **Erosão de confiança é assimétrica** — cara de construir, barata de destruir, e contamina o que é honesto: depois de uma escassez falsa detectada, o usuário deixa de acreditar no estoque **verdadeiro**.
4. **Risco regulatório** na casa de centenas de milhões, e **envenenamento de dados** — consentimento coagido produz base de e-mails que não abre, inflando custo e derrubando reputação de domínio.

### Implementação — conformidade real em consent banner

- **Simetria estrita:** "Aceitar todos" e "Recusar todos" na **mesma tela, mesmo tamanho, mesmo peso, mesmo contraste, mesma hierarquia visual**. Botão colorido contra link cinza é não-conformidade.
- **Nada pré-marcado** além do estritamente necessário.
- **Sem cookie wall** — recusar não pode bloquear o acesso.
- Nenhum cookie não-essencial gravado **antes** da decisão.
- Revogação permanentemente acessível (link fixo no rodapé), com o mesmo número de cliques do aceite.
- Finalidades em linguagem simples, com lista de terceiros acessível.
- **Fechar no "X" = recusar**, nunca aceitar. Ignorar o banner = recusar.
- Sem confirmshaming na recusa; sem re-exibir o banner a cada página após a recusa (isso é *nagging*).
- **Teste de sanidade:** meça a taxa de aceite. Acima de ~50–60%, provavelmente há assimetria no desenho.

---

## 9. Mobile e toque

### Quando usar cada zona

**Verde (fácil):** terço inferior e centro → navegação principal, CTAs primários, ações frequentes · **amarela (esticar):** meio e laterais superiores → conteúdo, ações secundárias · **vermelha (reposicionar a mão):** topo e cantos superiores → ações raras e **destrutivas** (deliberadamente difíceis), título, status. Com telas acima de 6" a zona verde encolheu proporcionalmente: **o topo é hoje território hostil.**

### Quando não usar

Ação crítica apenas no canto inferior **direito**, porque a mão dominante varia · gesto oculto como única forma de executar uma ação · qualquer informação ou ação exclusiva de `:hover` · `100vh` em layout que precisa sobreviver à barra de endereço dinâmica.

### Evidência

Observação de **1.333 pessoas** usando celular em ambiente público (2 meses, até 08/01/2013), das quais **780 tocavam a tela**:

| Forma de segurar | % |
|---|---|
| **Uma mão** | **49%** |
| **Berço** (uma segura, outra toca) | **36%** |
| **Duas mãos** | **15%** |

Detalhamento: uma mão = **67% polegar direito**, 33% esquerdo · berço = **79%** seguram com a esquerda e **72%** tocam com o polegar · duas mãos = **90% em retrato** · e **mais de 40%** das interações observadas não exigiam toque algum (22% chamadas de voz, 18,9% consumo passivo).

Dois corolários que quase todo mundo ignora: (1) **quase metade usa uma mão, mas mais da metade não** — projetar *exclusivamente* para o polegar é tão errado quanto ignorá-lo; (2) a mão dominante varia, então não concentre ações críticas no canto inferior direito.
Fonte: Steven Hoober, *How Do Users Really Hold Mobile Devices?*, UXmatters — https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php · Smashing Magazine, *The Thumb Zone* — https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/

### Alternativa

Ações destrutivas **deliberadamente** na zona vermelha e ações frequentes na verde · todo gesto com **equivalente visível** (botão, item de menu), porque swipe-para-excluir sem alternativa é funcionalidade inexistente para quem não descobriu e inacessível para tecnologia assistiva · tooltip de hover substituído por texto sempre visível, ou por popover acionado por toque/clique com `aria-describedby`.

### Implementação

**Alvos.** Mínimo **44×44 px** (Apple) / **48×48 dp** (Material); piso legal **24×24** (WCAG 2.5.8, AA). **Espaçamento ≥8 px** entre alvos — o erro de precisão do polegar é ~10 mm. Alvos na borda inferior podem precisar ser maiores: competem com o gesto de home.

**Bottom navigation.** **3–5 itens** (com 6+, use outro padrão) · ícone **+ rótulo de texto** sempre, porque ícone sozinho é adivinhação · persistente entre seções de topo, só para navegação e nunca para ações · `padding-bottom: env(safe-area-inset-bottom)`.

**Gestos.** Evite conflito com os do sistema (swipe da borda = voltar no iOS; swipe de baixo = home). Gestos de múltiplos dedos ou de traçado exigem alternativa de ponteiro único (WCAG 2.5.1).

**Teclado virtual e viewport.** Use `dvh`/`svh` em vez de `vh`. O teclado reduz a área visível em **~40%**: garanta que o campo em foco e o botão de submit continuem visíveis (`scroll-margin-bottom`). **Fonte de input ≥16px** para impedir o zoom automático do iOS, e nunca desabilite o zoom da página. Para controle fino, `VirtualKeyboard API` / `interactive-widget=resizes-content`.

**Safe areas.** `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);` com `viewport-fit=cover`. Atenção a notch, Dynamic Island e indicador de home.

**Hover não existe.** Estilos de hover só dentro de `@media (hover: hover) and (pointer: fine)`. O primeiro toque em elemento com `:hover` pode ser consumido como hover ("double-tap problem") — não construa lógica que dependa disso.

---

## 10. Os números que mais mudam decisão

| Número | Decisão que ele muda |
|---|---|
| **~1% de CTR, 84% dos cliques no slide 1** (Runyon) | Slides 3+ são conteúdo morto — hero único |
| **39% mais lento e >20% de queda no sucesso** com nav escondida em desktop (NN/g, n=179) | Hambúrguer em desktop é indefensável; mobile usa combo (86% vs 57%) |
| **11,3 → 8 campos** no checkout (Baymard) | Corte 3 campos antes de otimizar qualquer outra coisa |
| **~50 ms vs ~500 ms** de sacada, label acima vs à esquerda alinhado à esquerda (Penzo) | Label acima, peso normal — negrito piora em 60% |
| **+22% sucesso / −22% erros** com validação inline ⚠️ n=22 | Validar no `blur`, limpar em tempo real; ganho concentrado em campos imprevisíveis |
| **20–28%** do texto lido numa visita (NN/g, 45.237 páginas) | Pirâmide invertida e subtítulo a cada 150–200 palavras |
| **95% / 93% / 93%** de rejeição a pop-up, ausência de botão fechar e cobrir o conteúdo (NN/g, n=605) | Modal de captura é o formato mais odiado que existe |
| **11,8%** dos consent banners são conformes; remover "recusar" da 1ª tela vale **+22–23 pp** (CHI 2020) | A assimetria é intenção, não descuido — simetria estrita ou nada |
| **49% uma mão / 36% berço / 15% duas mãos** (Hoober, n=1.333) | Ações frequentes no terço inferior; destrutivas no topo |
| **24 px (WCAG AA) → 44–48 px (design)** | 24 é o piso legal, não a meta |

**Três "verdades" de UX que a pesquisa não sustenta** — repasse sempre com a ressalva: a regra dos **45–75 cpl** é de origem tipográfica e o estudo da Wichita State encontrou leitura *mais rápida* a 95 cpl; **skeleton screens** têm evidência conflitante (Chung n=80 a favor, Viget n=136 contra, 2,82 s vs 2,41 s); a **validação inline de Wroblewski** tem números corretos mas **n=22**, com ganho concentrado em campos imprevisíveis.
