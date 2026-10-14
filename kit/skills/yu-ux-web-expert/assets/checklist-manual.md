# Checklist manual — o que os scripts não pegam

Rode **depois** dos scripts, com os artefatos em `ART/` abertos. Isto cobre os ~43% de problemas de acessibilidade por volume que a automação não detecta (Deque), mais tudo que é julgamento e não medição.

**Quem executa:** o agente, com `ART/*-full.png`, `ART/*-fold.png`, `ART/*-dom.html`, `ART/kb-*.png`, `ART/states-*.png` e os JSONs em mãos. Nenhum item aqui pode depender de leitor de tela real ou de usuário real — o que depende está na última seção.

**Regras.** Não repita o que o script já mediu: axe, contraste, percurso de Tab, estados, CWV, tokens, overflow, mídia sem dimensão, console e rede já estão nos JSONs — cite o valor de lá, não estime. Item sem evidência no artefato vira "não verificado", nunca vira achado. Severidade conforme `SKILL.md` § Severidade.

Convenção: `<vp>` = `360x800`, `768x1024` ou `1440x900`.

---

## 1. Acessibilidade que o axe não pega

- [ ] **Nome acessível é significativo, não só presente** — o nome anunciado identifica a ação/destino fora de contexto?
  - Como: `keyboard.json → results[].stops[].name` + `grep -oE '<a [^>]*>[^<]{0,60}' ART/<vp>-dom.html`. Liste os nomes e leia a lista isolada, como um usuário de leitor de tela lista links.
  - Falha: "clique aqui", "saiba mais", "leia mais", "→", "aqui", nome = URL, `alt="imagem123.jpg"`, dois ou mais controles com nome idêntico e destinos diferentes. **P1 · WCAG 2.4.4 (A) / 4.1.2 (A)**

- [ ] **`aria-label` não contradiz o rótulo visível** — quem fala o rótulo (comando de voz) consegue ativar o controle?
  - Como: no DOM, para cada `aria-label`, compare com o texto visível do mesmo nó.
  - Falha: `aria-label="Enviar formulário"` num botão escrito "Quero meu orçamento" — a string visível não está contida no nome acessível. **P1 · WCAG 2.5.3 Label in Name (A)**

- [ ] **Alt correto vs decorativo vs redundante** — cada `<img>` está na categoria certa?
  - Como: `grep -oE '<img[^>]*>' ART/<vp>-dom.html`; para cada uma, olhe a imagem no `-full.png` e classifique: informativa, decorativa, funcional (dentro de link/botão) ou texto-em-imagem.
  - Falha: informativa com `alt=""`; decorativa com alt descritivo que duplica a legenda ao lado; `alt="imagem"`, `alt="logo"`, `alt="foto"`, nome de arquivo; funcional descrevendo a figura em vez da ação. **P1 · WCAG 1.1.1 (A)**

- [ ] **Texto essencial dentro de imagem** — há conteúdo que só existe como pixel?
  - Como: compare o texto visível nos `-full.png` com o texto extraível do DOM (`sed -e 's/<[^>]*>//g'`). O que aparece na imagem e não no DOM é texto-em-imagem.
  - Falha: headline, preço, tabela de planos ou selo com informação renderizados como imagem. **P1 · WCAG 1.4.5 (AA)**

- [ ] **Ordem de leitura do DOM = ordem visual** — ler o DOM linear conta a mesma história que olhar a tela?
  - Como: extraia o texto do DOM na ordem do documento e compare com o `-full.png` de 360 e de 1440. Procure no CSS/DOM por `order:`, `flex-direction: row-reverse|column-reverse`, `grid-row/column` explícitos, `position:absolute` movendo blocos.
  - Falha: sidebar/aside lido antes do conteúdo principal; CTA que aparece antes do preço na tela mas depois no DOM; ordem que se inverte entre 360 e 1440. **P1 · WCAG 1.3.2 (A)** — complementa o `visual_order_violations` do `keyboard.json`, que só olha eixo Y do foco.

- [ ] **Hierarquia de headings é semântica, não só sequencial** — a lista de headings sozinha explica a página?
  - Como: `grep -oE '<h[1-6][^>]*>[^<]{0,80}' ART/<vp>-dom.html`. Leia só essa lista.
  - Falha: h1 genérico ("Bem-vindo"); h2 usado por tamanho de fonte e não por estrutura; seção visualmente titulada com `<div class="titulo">`; a lista não permite achar nada. axe só valida ordem numérica. **P1 · WCAG 1.3.1 (A) / 2.4.6 (AA)**

- [ ] **Label associado ao campo certo** — o `for` aponta para o `id` do campo que está ao lado?
  - Como: no DOM, cruze cada `label[for]` com o `id` correspondente e confirme pela posição no `-full.png`.
  - Falha: `for` apontando para id inexistente ou para outro campo; placeholder usado como único rótulo; rótulo visualmente sobre o campo A e ligado ao campo B. **P0 · WCAG 1.3.1 (A) / 3.3.2 (A)**

- [ ] **Obrigatoriedade e formato antes do erro** — o usuário sabe o que é exigido sem tentar enviar?
  - Como: no DOM, procure `required`/`aria-required` e o texto de apoio de cada campo.
  - Falha: obrigatoriedade só por asterisco visual sem legenda; formato esperado (CPF, CEP, data) só revelado no erro. **P1 · WCAG 3.3.2 (A)**

- [ ] **Mensagem de erro programaticamente vinculada** — o erro chega a quem não vê a borda vermelha?
  - Como: dispare o envio inválido no navegador (ou inspecione o markup do estado de erro no DOM/JS); procure `aria-describedby` apontando para o nó da mensagem, `aria-invalid="true"` e uma região `role="alert"`/`aria-live`.
  - Falha: mensagem em `<span class="erro">` solta, sem `aria-describedby`; resumo de erros no topo sem foco nem live region; erro só como cor de borda. **P0 · WCAG 3.3.1 (A) / 4.1.3 (AA)**

- [ ] **Conteúdo só-visual sem equivalente textual** — gráfico, mapa, infográfico, `<canvas>`, vídeo têm alternativa?
  - Como: procure no DOM por `<canvas>`, `<svg>`, `<video>`, `<iframe>` de mapa/player e veja o que existe de texto próximo.
  - Falha: `<canvas>` sem `role="img"`+nome nem tabela equivalente; `<svg>` informativo sem `<title>`; vídeo sem `<track kind="captions">`; player de terceiro sem transcrição. **P1 · WCAG 1.1.1 (A) / 1.2.2 (A)**

- [ ] **Informação transmitida só por cor** — remover a cor destrói alguma distinção?
  - Como: converta os `-fold.png` e `-full.png` para escala de cinza (`python3 -c "from PIL import Image;Image.open('ART/1440x900-full.png').convert('L').save('ART/gray.png')"`) e olhe.
  - Falha: link dentro de parágrafo indistinguível do texto; item ativo da nav só colorido; campo com erro só pela borda; legenda de gráfico só por cor; status ("pago"/"pendente") só por bolinha. **P1 · WCAG 1.4.1 (A)**

- [ ] **Instrução dependente de característica sensorial** — o texto manda usar forma, cor, tamanho ou posição?
  - Como: `grep -inE "botão (verde|vermelho|azul)|ao lado|à direita|abaixo|acima|o ícone redondo|clique no quadrado" ART/<vp>-dom.html`.
  - Falha: "clique no botão verde à direita". **P2 · WCAG 1.3.3 (A)**

- [ ] **Movimento sem controle** — algo se move, pisca ou avança sozinho por mais de 5s?
  - Como: procure no DOM/CSS por `animation`, `@keyframes`, `autoplay`, `marquee`, bibliotecas de carrossel; compare dois `-full.png` da mesma viewport tirados em momentos diferentes; verifique se existe `@media (prefers-reduced-motion: reduce)`.
  - Falha: carrossel automático sem botão de pausa; vídeo com `autoplay` sem controles; nenhuma regra de `prefers-reduced-motion` no CSS. **P1 · WCAG 2.2.2 (A)**

- [ ] **Reflow em 320 CSS px** — o conteúdo cabe em uma coluna sem rolagem horizontal?
  - Como: `python3 scripts/capture.py --url URL --viewports 320x800 --out ART/` e olhe `320x800-full.png` + o campo de overflow horizontal do `capture.json`.
  - Falha: rolagem em dois eixos; tabela larga sem container rolável; menu ou CTA que desaparece sem alternativa no breakpoint. **P1 · WCAG 1.4.10 (AA)**

- [ ] **Zoom 200%** — a página funciona com texto ampliado 2×?
  - Como: capture em `720x450` (equivale a 200% de zoom sobre 1440x900) e compare com `1440x900-full.png`.
  - Falha: texto cortado por altura fixa, botão fora da tela, blocos sobrepostos, conteúdo que some. **P1 · WCAG 1.4.4 (AA)**

- [ ] **Text spacing** — o layout sobrevive a espaçamento forçado?
  - Como: reinjete via CSS `line-height:1.5; letter-spacing:.12em; word-spacing:.16em; p{margin-bottom:2em}` e recapture; ou procure no DOM por `height` fixo em cartões e botões com texto.
  - Falha: rótulo truncado, card estourando, texto cortado em contêiner de altura fixa. **P2 · WCAG 1.4.12 (AA)**

- [ ] **Foco obscurecido por header fixo ou banner** — chegando por Tab de baixo, o elemento focado fica visível inteiro?
  - Como: abra os `ART/kb-*.png` das paradas logo abaixo do header e confirme visualmente o que `keyboard.json → stops[].obscured_by` marcou (e o que ele não marcou: o script testa só o ponto central).
  - Falha: elemento focado parcialmente atrás de header sticky, cookie banner ou widget de chat no PNG. **P1 · WCAG 2.4.11 (AA)**

- [ ] **Tabela de dados sem cabeçalho semântico** — a tabela dá para ler célula a célula?
  - Como: `grep -c "<table" ART/<vp>-dom.html` e inspecione cada uma: `<th>`, `scope`, `<caption>`.
  - Falha: `<table>` de dados só com `<td>`; `scope` ausente em tabela de dupla entrada; tabela usada para layout. **P1 · WCAG 1.3.1 (A)**

- [ ] **Iframe sem título** — cada `<iframe>` se identifica na lista de frames?
  - Como: `grep -oE '<iframe[^>]*>' ART/<vp>-dom.html`.
  - Falha: `<iframe>` sem `title`, ou com `title="iframe"`/`"conteúdo"`. **P2 · WCAG 4.1.2 (A)**

- [ ] **Idioma da página e de trechos** — o sintetizador vai pronunciar certo?
  - Como: `grep -oE '<html[^>]*lang="[^"]*"' ART/<vp>-dom.html`; depois procure blocos em outro idioma no texto e verifique `lang` local.
  - Falha: `lang` ausente, `lang="en"` em página em português, seção em inglês sem `lang="en"`. **P1 · WCAG 3.1.1 (A) / 3.1.2 (AA)**

- [ ] **Autenticação e entrada redundante** — o funil exige memória ou repetição?
  - Como: inspecione campos de senha/OTP no DOM (`onpaste`, `autocomplete`) e liste os campos pedidos em cada etapa do fluxo.
  - Falha: `paste` bloqueado na senha; CAPTCHA de imagem sem alternativa; e-mail/CEP/telefone pedidos duas vezes no mesmo processo sem autopreenchimento. **P1 · WCAG 3.3.7 / 3.3.8 (AA)**

## 2. Hierarquia visual e julgamento estético

- [ ] **O CTA primário é o elemento mais proeminente da dobra?**
  - Como: olhe `<vp>-fold.png` nos três viewports. Ranqueie os três elementos que puxam o olho primeiro (contraste, tamanho, cor, isolamento).
  - Falha: o CTA não está entre os dois primeiros; ou nem aparece na dobra de 360. **P1**

- [ ] **Existe mais de um "primário" competindo?**
  - Como: no `-fold.png`, conte botões com peso visual equivalente; confirme no `tokens.json` se compartilham a mesma cor/estilo de ação.
  - Falha: dois ou mais botões com o mesmo tratamento visual e intenções diferentes na mesma dobra. **P1**

- [ ] **A ordem de leitura visual bate com a prioridade de negócio?**
  - Como: liste as seções na ordem em que aparecem no `-full.png` e compare com o objetivo declarado da página.
  - Falha: prova social e preço antes de o usuário saber o que é o produto; formulário antes da proposta de valor. **P2**

- [ ] **Densidade e ritmo** — o espaçamento agrupa o que é relacionado?
  - Como: `-full.png` + escala de espaçamento no `tokens.json`.
  - Falha: rótulo mais perto do campo seguinte que do próprio campo; blocos distintos com o mesmo respiro entre e dentro; parede de texto sem intervalo. **P2** (Gestalt — proximidade)

- [ ] **Alinhamento** — há uma grade, e ela é respeitada?
  - Como: olhe as bordas esquerdas dos blocos no `-full.png` de 1440.
  - Falha: três ou mais eixos de alinhamento diferentes na mesma seção; ícone desalinhado do texto; card com padding desigual. **P3** (P2 se ocorrer na dobra)

- [ ] **Consistência de componentes iguais entre páginas/seções**
  - Como: compare os exemplares em `states.json → results[].targets[]` e os PNGs de estado; cruze com `tokens.json` (contagem de valores por papel).
  - Falha: o mesmo botão com raio, altura ou cor diferentes em duas seções; dois estilos de card para o mesmo tipo de conteúdo. **P2** (H4 Nielsen)

## 3. Conteúdo e microcopy

- [ ] **A headline diz o que o negócio faz e para quem?**
  - Como: leia o primeiro `<h1>` do DOM isolado, sem o resto da página.
  - Falha: "Transformando o futuro", "Soluções inovadoras", "Bem-vindo" — frases que servem para qualquer empresa. Teste: troque o nome da marca por um concorrente; se continua verdadeira, é genérica. **P1**

- [ ] **Texto de botão é verbo + objeto?**
  - Como: liste os textos de `<button>` e de links-botão no DOM.
  - Falha: "Enviar", "Clique aqui", "Saiba mais", "Continuar" sem objeto; texto que não diz o que acontece depois. **P2**

- [ ] **Estados vazios, de erro e de carregamento existem e dizem algo útil?**
  - Como: procure no DOM/JS os textos de estado (`empty`, `no-results`, `error`, `loading`, `skeleton`); veja `console.json` para erros que só aparecem no console.
  - Falha: busca sem resultado que mostra tela em branco; erro genérico "Algo deu errado"; nenhum indicador para operação assíncrona. **P1 · H1/H9 Nielsen**

- [ ] **Jargão e linguagem interna**
  - Como: leia o texto extraído do DOM procurando termos que só a empresa usa.
  - Falha: nome de produto interno como rótulo de menu; sigla não expandida na primeira ocorrência; "onboarding", "solução end-to-end" para público leigo. **P2 · H2 Nielsen**

- [ ] **Promessa sem prova**
  - Como: liste cada afirmação quantitativa ou superlativa do texto e procure a fonte/evidência na mesma página.
  - Falha: "líder de mercado", "+10.000 clientes", "aumente 300% suas vendas" sem número datado, fonte ou caso verificável. **P2**

## 4. Fluxo e tarefa

- [ ] **Dá para completar a ação principal sem sair da página?**
  - Como: siga o caminho da ação no DOM (`<form action>`, `href` do CTA) e conte as navegações até a conclusão.
  - Falha: CTA que leva a uma página intermediária só para exibir outro CTA; formulário que redireciona para outro domínio sem aviso. **P1**

- [ ] **Quantos passos e quantos campos?**
  - Como: conte `input`/`select`/`textarea` visíveis por etapa no DOM.
  - Falha: campos que não são usados na resposta ao usuário; dados pedidos antes de a proposta de valor estar clara. Cada campo extra custa conversão — nomeie quais remover. **P1**

- [ ] **O usuário sabe onde está?**
  - Como: `-fold.png` + DOM: estado ativo na nav (`aria-current`), breadcrumb, indicador de passo do wizard, título da página no `<title>`.
  - Falha: nav sem página ativa marcada; wizard sem "passo 2 de 4"; `<title>` igual em todas as páginas. **P2 · H1 Nielsen / WCAG 2.4.2 (A)**

- [ ] **O usuário sabe o que acontece depois de clicar?**
  - Como: leia o texto ao redor do CTA e o destino real.
  - Falha: botão de envio sem dizer se abre WhatsApp, cobra, agenda ou cadastra; link que abre nova aba sem aviso; download sem formato/tamanho. **P2**

- [ ] **Existe saída de emergência de todo estado?**
  - Como: para cada modal, drawer, overlay e etapa do fluxo no DOM, procure botão de fechar, `Esc` (handler de `keydown`), voltar de etapa e desfazer.
  - Falha: modal sem botão de fechar visível; sem tratamento de `Esc`; wizard sem voltar; ação destrutiva sem confirmação ou desfazer. **P0 se bloqueia a tarefa, senão P1 · H3 Nielsen / WCAG 2.1.2 (A)**

## 5. Confiança

- [ ] **Sinais de credibilidade presentes e verificáveis**
  - Como: procure no DOM/rodapé por CNPJ, razão social, endereço, política de privacidade, termos, selos.
  - Falha: nenhum dado de empresa identificável; selo como imagem sem link de verificação; política de privacidade inexistente ou link quebrado (cheque `network.json` por 404). **P1** (no Brasil, LGPD)

- [ ] **Prova social real vs genérica**
  - Como: leia depoimentos e logos no `-full.png`.
  - Falha: depoimento sem nome, empresa ou foto; "João S., cliente satisfeito"; logos de clientes sem caso associado; números redondos sem data. **P2**

- [ ] **Informação de contato**
  - Como: procure telefone, e-mail, WhatsApp, endereço e horário no DOM.
  - Falha: só formulário; WhatsApp sem número visível; nenhum canal humano em página que pede pagamento ou dado pessoal. **P1**

- [ ] **O que um comprador desconfiado procuraria e não acha**
  - Como: liste as três objeções óbvias do público (preço, prazo, garantia, cancelamento, quem somos) e procure cada resposta na página.
  - Falha: preço ausente sem explicar por quê; nenhuma menção a prazo, garantia ou política de reembolso; "sobre nós" sem pessoas. **P1** (numere as objeções não respondidas)

## 6. Mobile real

- [ ] **Alvos de toque na prática, não só o valor de CSS**
  - Como: no `360x800-full.png`, olhe os grupos de alvos vizinhos; no DOM, meça as caixas e o espaço entre elas.
  - Falha: dois alvos adjacentes com menos de 24 px de espaçamento efetivo entre centros; ícones de rede social encostados; link inline dentro de parágrafo com alvo de altura de linha. **P1 · WCAG 2.5.8 (AA)** — o axe não avalia proximidade nem sobreposição.

- [ ] **Teclado virtual cobrindo o campo**
  - Como: no fluxo de formulário, compare a posição `y` de cada campo (DOM) com a altura visível restante com teclado aberto (~50% em 360x800); confira campos no terço inferior.
  - Falha: campo ou botão de envio na metade inferior sem scroll automático ao focar; `position:fixed` no rodapé cobrindo o campo ativo. **P1**

- [ ] **Gesto sem alternativa**
  - Como: procure no JS/DOM por `touchstart`/`touchmove`, swipe, pinch, drag-and-drop, carrossel só por arrasto.
  - Falha: carrossel navegável só por swipe (sem setas); reordenar lista só por arrastar; caminho só por pinch. **P1 · WCAG 2.5.1 (A) / 2.5.7 (AA)**

- [ ] **Conteúdo dependente de hover**
  - Como: cruze `states.json` (o que só muda no hover) com o `360x800-full.png`: no toque, hover não existe de forma confiável.
  - Falha: submenu que só abre no hover; tooltip com informação essencial; preço/detalhe revelado só ao passar o mouse; conteúdo em hover que não é dispensável por `Esc` nem "hoverable". **P1 · WCAG 1.4.13 (AA)**

- [ ] **Orientação e área segura**
  - Como: capture `800x360` (paisagem) e compare.
  - Falha: trava de orientação; conteúdo cortado em paisagem; barra fixa sobre a área de gestos do sistema. **P2 · WCAG 1.3.4 (AA)**

---

## O que continua não coberto nem aqui

Copie esta lista para a seção **"O que não pôde ser medido"** do relatório, mantendo só o que se aplica. Declarar o limite é parte da entrega.

- [ ] **Leitor de tela real** — NVDA+Chrome (mínimo aceitável), JAWS+Chrome (24,7% do uso real) e VoiceOver/iOS. Nada nesta bateria reproduz o que é de fato anunciado: ordem de anúncio, verbosidade, comportamento de live region, modo de navegação por formulário, nome computado pela árvore de acessibilidade do navegador. Inspecionar DOM é aproximação, não substituto.
- [ ] **Teste com usuário real** — 5 participantes do público-alvo em teste moderado revelam problemas de compreensão, expectativa e confiança que nenhuma heurística prevê. Avaliação heurística por um único avaliador encontra uma fração dos problemas.
- [ ] **Dado de campo (CrUX / RUM)** — o que os scripts medem é laboratório, com throttling simulado. Distribuição real de LCP/CLS por dispositivo, rede e geografia só vem de campo (p75 de 28 dias).
- [ ] **INP real** — depende de interação humana com o produto em uso; o laboratório mede TBT como proxy, o que não é a mesma coisa.
- [ ] **Dispositivo físico de baixo desempenho** — Android de entrada, rede 3G/4G instável, navegador desatualizado. Emulação de CPU não reproduz térmica, memória limitada nem GPU fraca.
- [ ] **Fluxos atrás de autenticação, pagamento ou dados reais** — se não foram percorridos, diga quais e por quê.
- [ ] **Conformidade legal** — esta auditoria é evidência técnica, não parecer jurídico sobre LBI/LGPD ou eMAG.
