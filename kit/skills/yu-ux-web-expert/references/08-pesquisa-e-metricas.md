# Pesquisa e Métricas — referência operacional

Como escolher um método de pesquisa, com que amostra, a que custo — e como medir o que foi entregue. Cada número carrega fonte. Onde a evidência é fraca ou contestada há ⚠️ e a razão.

## Índice

1. [Mapa de métodos como tabela de decisão](#1-mapa-de-métodos-como-tabela-de-decisão)
2. [Os métodos, um a um](#2-os-métodos-um-a-um)
3. [A nuance do "5 usuários bastam"](#3-a-nuance-do-5-usuários-bastam)
4. [Instrumentos validados: SUS, UMUX-Lite, SEQ, NPS](#4-instrumentos-validados-sus-umux-lite-seq-nps)
5. [HEART — framework de métrica de produto](#5-heart--framework-de-métrica-de-produto)
6. [Analytics comportamental: mapas de calor e gravações](#6-analytics-comportamental-mapas-de-calor-e-gravações)
7. [O que instrumentar no GA4](#7-o-que-instrumentar-no-ga4)
8. [A escada de métodos para quem não tem verba nem tráfego](#8-a-escada-de-métodos-para-quem-não-tem-verba-nem-tráfego)

---

## 1. Mapa de métodos como tabela de decisão

A NN/g organiza métodos em três eixos: **atitudinal × comportamental** ("o que as pessoas dizem" vs. "o que as pessoas fazem" — a NN/g é explícita em que "muito frequentemente os dois são bastante diferentes"), **qualitativo × quantitativo** (observação direta com possibilidade de perguntar "por quê" vs. dado numérico coletado indiretamente por instrumento) e **contexto de uso** (natural, roteirizado, limitado/abstraído, descontextualizado).

| Quadrante | Métodos |
|---|---|
| Comportamental + Qualitativo | Teste de usabilidade moderado, estudo de campo, contextual inquiry, eye-tracking |
| Comportamental + Quantitativo | Benchmark de usabilidade, teste A/B, analytics de clickstream, teste não-moderado |
| Atitudinal + Qualitativo | Entrevistas, focus groups, design participativo, pesquisa de diário |
| Atitudinal + Quantitativo | Surveys, estudos de desejabilidade, card sorting, tree testing |

Fonte: NN/g, *When to Use Which User-Experience Research Methods* — https://www.nngroup.com/articles/which-ux-research-methods/

**Tabela de decisão — quero saber X → método Y → amostra Z → custo/tempo W:**

| Quero saber… | Método | Amostra | Custo / tempo |
|---|---|---|---|
| Onde as pessoas travam ao usar a página | Teste de usabilidade moderado | 5–10 (3–5 por rodada em ciclos iterativos) | Baixo; 1–2 semanas com recrutamento |
| O mesmo, mas em escala e sem agenda | Teste de usabilidade não-moderado | ~10 com protótipo de média/alta fidelidade; 20+ para produto ao vivo ou comparação | Baixo-médio; dias, mas análise mais lenta |
| Se a primeira dobra comunica o que deveria | Teste de 5 segundos | 5–10 | Muito baixo; horas |
| Se o rótulo e a navegação levam ao lugar certo | First-click testing | 15–30 direcional; 50–100 para redesenho grande | Muito baixo; uma tarde |
| Como o usuário agrupa mentalmente o conteúdo | Card sorting | **15** (correlação 0,90 com o resultado verdadeiro) | Baixo; 1 semana |
| Se a hierarquia proposta é navegável | Tree testing | ~50 quantitativo; 15–30 direcional; ~30 por variante em comparação | Baixo; 1–2 semanas |
| Por que a pessoa comprou / o que a fez decidir | Entrevistas (JTBD, discovery) | 5–8 rodada focada; 10–20 exploratório; 20–30 público heterogêneo. Critério real é **saturação temática** | Médio; 2–4 semanas |
| Como o comportamento evolui ao longo do tempo | Pesquisa de diário | 5–12 projeto pequeno; 12–30 amplo | Alto; 1–3 semanas de campo |
| Quanto/quantos — proporções com margem declarada | Survey | 20 pulso; 50 direcional; 100–200+ estratégico; 300–400+ com margem de erro declarada | Baixo por resposta; risco de viés alto |
| Qual das duas versões converte mais | Teste A/B | Milhares a dezenas de milhares **por variante** | Alto; ver limite de viabilidade |
| Qual de dois designs as pessoas preferem | Teste de preferência | 30+ | Baixo — ⚠️ mede preferência declarada, não desempenho |
| Onde o olhar vai e o que é ignorado | Eye-tracking | 30+ para mapa agregado confiável | Alto; equipamento e laboratório |
| Onde as pessoas clicam e até onde rolam | Heatmap / gravação de sessão | Tráfego existente | Baixo — ⚠️ gera hipótese, não prova |

Fontes das amostras: NN/g, *Card Sorting: How Many Users to Test* — https://www.nngroup.com/articles/card-sorting-how-many-users-to-test/ · NN/g, *Tree Testing* — https://www.nngroup.com/articles/tree-testing/ · NN/g, *Diary Studies* — https://www.nngroup.com/articles/diary-studies/ · Maze, *How Many User Testers Do You Need per Method* — https://maze.co/blog/user-testing-how-many-users/

**Regra de leitura do mapa:** quase toda decisão de página é **comportamental**. Perguntar ao dono do negócio "o que o cliente quer ver" é dado atitudinal de terceiro grau — o pior insumo disponível. Gravação de sessão, first-click e teste de usabilidade vencem opinião interna.

---

## 2. Os métodos, um a um

### 2.1 Teste moderado × não-moderado

| Dimensão | Moderado | Não-moderado |
|---|---|---|
| O que entrega | O "porquê" — dá para perguntar no momento em que a pessoa hesita | O "o quê" em volume — comportamento sem interferência do facilitador |
| Amostra típica | 5–10 | ~10 com protótipo; 20+ para produto ao vivo ou comparação |
| Custo por sessão | Alto (tempo do facilitador) | Baixo |
| Risco principal | Viés do facilitador; perguntas indutoras | Tarefa mal escrita não tem conserto no meio do teste |
| Quando escolher | Fluxo novo, problema mal compreendido, protótipo cru | Validação de fluxo conhecido, comparação, orçamento apertado |

Fonte das faixas: Maze — https://maze.co/blog/user-testing-how-many-users/

### 2.2 Teste de 5 segundos

Mostre a tela por 5 segundos, retire e pergunte sem consulta: o que a empresa oferece, para quem, o que a pessoa faria a seguir, que sensação a página passou. É teste de **recall e clareza**, não de preferência. Divergência sobre o que a empresa faz é falha de proposta de valor; divergência sobre o próximo passo é falha de hierarquia do CTA.
Fonte: NN/g, *Testing Visual Design* — https://www.nngroup.com/articles/testing-visual-design/

### 2.3 First-click testing — e a evidência de que o primeiro clique prevê sucesso

Um dos poucos casos em que existe evidência quantitativa replicada.

| Estudo | Primeiro clique correto | Primeiro clique errado |
|---|---|---|
| Bailey & Wolfson (2009), 12 testes baseados em cenário | **87%** de conclusão do cenário | **46%** |
| Optimal Workshop (2015), milhões de respostas de tree testing | **70%** de sucesso | **24%** |

Fonte: Optimal Workshop — https://www.optimalworkshop.com/blog/correct-first-click-lead-to-3x-higher-task-success

⚠️ Note a divergência de magnitude (87/46 vs. 70/24). A **direção** é robusta e replicada em dois estudos independentes; a **magnitude** é sensível ao contexto. Em proposta comercial, cite a direção, não o número.

Por que é o método mais subestimado: 15–30 pessoas, uma tarde, custo próximo de zero, e responde a pergunta que mais destrói conversão — "o usuário sabe onde clicar para o que ele veio fazer?".

### 2.4 Card sorting

Método **generativo** (mapeia o modelo mental), não avaliativo — por isso exige mais gente que teste de usabilidade. Correlação com o "resultado verdadeiro" por amostra: 5 usuários = **0,75**; **15 = 0,90 (recomendação oficial da NN/g)**; 20 = ~0,93; 30 = 0,95; 60 = 0,98 (retorno decrescente, não recomendado).
Fonte: NN/g — https://www.nngroup.com/articles/card-sorting-how-many-users-to-test/

Aberto (o participante nomeia os grupos) revela vocabulário; fechado (categorias dadas) valida uma estrutura já proposta.

### 2.5 Tree testing

Valida se a hierarquia resultante é navegável, sem interferência de layout ou visual. ~50 participantes como padrão quantitativo; 15–30 para leitura direcional; ~30 por variante ou segmento em comparações. A NN/g recomenda um piloto qualitativo pequeno antes do quantitativo.
Fonte: NN/g — https://www.nngroup.com/articles/tree-testing/

Sequência natural: **card sorting (15) define o agrupamento → tree testing (~50) valida a hierarquia → first-click (15–30) valida o rótulo no ponto de decisão.**

### 2.6 Eye-tracking — o que ele já ensinou

O valor do eye-tracking hoje está menos em rodar estudos novos (caro, laboratório, 30+ participantes) e mais nos achados já estabelecidos.

**Padrão F (2006).** A NN/g atualizou publicamente a interpretação e é enfática em dois pontos que a indústria ignora: (1) o padrão F **não é o único** padrão de varredura; (2) o padrão F **é ruim para o usuário e para o negócio** — significa que o usuário está pulando conteúdo importante. Não é algo para o qual projetar; é algo a **combater**.

Outros padrões documentados: **layer-cake** (varre subtítulos, pula corpo), **spotted** (caça um elemento específico), **marking** (olho fixo enquanto o conteúdo rola — comum em mobile), **bypassing** (pula palavras iniciais repetidas em listas) e **commitment** (lê quase tudo — só com motivação alta).

**Layer-cake é o padrão desejável.** A NN/g afirma que é "de longe a maneira mais eficaz de varrer páginas", superando o padrão F na recuperação de informação. Ele aparece quando subtítulos são visualmente distintos, a hierarquia é clara, os rótulos são descritivos e o espaçamento agrupa corretamente.

**Banner blindness.** Documentado em eyetracking em 1997, 2007 e 2018: "tendência das pessoas de ignorar elementos de página que elas percebem (corretamente ou não) como anúncios". Três gatilhos: **posição** (topo, coluna direita), **tratamento visual** (animação, fundo colorido, formatação destoante) e **proximidade de anúncios**. O achado mais importante é o efeito "batata quente": **conteúdo legítimo é ignorado só por parecer anúncio ou por estar perto de um** — um bloco promocional com fundo destoante e badge no canto superior direito é, funcionalmente, um anúncio, e será ignorado.

Fontes: NN/g, *F-Shaped Pattern of Reading* — https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/ · NN/g, *The Layer-Cake Pattern* — https://www.nngroup.com/articles/layer-cake-pattern-scanning/ · NN/g, *Banner Blindness: Old and New Findings* — https://www.nngroup.com/articles/banner-blindness-old-and-new-findings/

### 2.7 Entrevistas

Duas escolas úteis: **discovery contínuo** (Teresa Torres), com a *opportunity solution tree* ligando resultado desejado → oportunidades → soluções → experimentos, e cadência semanal de conversas; e a **switch interview** de JTBD (Bob Moesta), que reconstrói a linha do tempo da decisão — primeiro pensamento passivo → evento de gatilho → busca ativa → decisão → consumo — mapeando quatro forças: push (dor atual), pull (atração do novo), ansiedade (medo do novo) e hábito.

O ponto metodológico que mais importa: **pergunte por histórias específicas, não por opiniões**. "Me conta da última vez que você precisou de X" é dado; "o que você acha importante numa loja de X?" é ruído atitudinal.
Fonte: Lenny's Newsletter com Teresa Torres — https://www.lennysnewsletter.com/p/teresa-torres-on-how-to-interview

⚠️ JTBD e discovery contínuo são **frameworks de prática profissional com forte suporte de caso**, não teorias com validação experimental controlada. Funcionam porque estruturam a coleta de evidência qualitativa, não porque foram provados em ensaio controlado.

---

## 3. A nuance do "5 usuários bastam"

**De onde vem.** Nielsen & Landauer, "A mathematical model of the finding of usability problems", *Proc. ACM INTERCHI'93*, pp. 206–213. Modelo: `N(1 − (1 − L)ⁿ)`, com **L = 31%** ("averaged across a large number of projects we studied"). Com n=5, o modelo prevê ~**85%** dos problemas. A formulação de Nielsen: "os melhores resultados vêm de testar não mais que 5 usuários e rodar quantos testes pequenos você puder pagar".
Caveats do próprio Nielsen: com grupos de usuários distintos, 3–4 por categoria (2 grupos) ou 3 por categoria (3+ grupos); "a fórmula só vale para usuários comparáveis que usarão o site de formas razoavelmente semelhantes".
Fonte: NN/g — https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/

**⚠️ A refutação empírica decisiva.** Faulkner, L. (2003), "Beyond the five-user assumption", *Behavior Research Methods, Instruments, & Computers*, 35(3), 379–383. Pool de **60 usuários**, com reamostragem aleatória de conjuntos:

| Tamanho do conjunto | Pior conjunto encontrou | Melhor conjunto encontrou |
|---|---|---|
| 5 usuários | **55%** dos problemas | 99% |
| 10 usuários | **80%** | — |
| 20 usuários | **95%** | — |

Fonte: https://link.springer.com/article/10.3758/BF03195514

O ponto que mata o uso ingênuo da regra: a média de ~85% é real, mas a **variância é enorme e você não sabe em qual conjunto caiu**. Cinco usuários entregam entre 55% e 99%, sem meio de saber qual.

Críticas complementares: Jared Spool & Will Schroeder (UIE) argumentam que em sites complexos 5 usuários encontraram bem menos que 85%; Rohrer e Laubheimer (NN/g) distinguem testes **qualitativos** (5 basta para achar problemas) de **quantitativos/benchmark** (precisa de ~20+ para intervalos de confiança úteis).
Fonte: NN/g, *How Many Test Users* — https://www.nngroup.com/articles/how-many-test-users/

**Regra prática — quando subir a amostra:**

| Situação | Amostra |
|---|---|
| Achar problemas, um perfil homogêneo, uma tarefa, rodadas iterativas | 5 (e rode mais rodadas em vez de mais gente numa rodada) |
| Público com 2 perfis distintos | 3–4 por perfil |
| Público com 3+ perfis distintos | 3 por perfil |
| Sistema complexo, muitos caminhos possíveis | 10+ |
| **Medir** taxa de sucesso, tempo ou erro com intervalo de confiança | 20+ |
| Comparar duas versões e afirmar qual é melhor | 20+ por versão, e ainda assim declare o intervalo |

⚠️ Usar 5 usuários para afirmar "78% dos usuários preferem B" é fraude estatística — 5 é método de descoberta, não de medição.

---

## 4. Instrumentos validados: SUS, UMUX-Lite, SEQ, NPS

| Instrumento | O que mede | Quando usar | Como interpretar o número |
|---|---|---|---|
| **SUS** | Usabilidade percebida do sistema como um todo | Fim da sessão de teste; benchmark entre versões ou concorrentes | 0–100, **não é porcentagem**. 68 = média (percentil ~50); ~74 = B−; acima de ~80,3 = top 10%; abaixo de ~51 = bottom 15% |
| **UMUX-Lite** | Utilidade percebida + facilidade percebida (2 itens) | Quando não há tempo/espaço para 10 itens; dentro de survey maior | Converta para escala SUS pela regressão e interprete pela mesma curva |
| **SEQ** | Dificuldade percebida de **uma tarefa** | Imediatamente após cada tarefa, dentro do teste | 1–7; média de referência **~5,3–5,6**. Abaixo disso, a tarefa é candidata a redesenho |
| **NPS** | Disposição declarada a recomendar a marca | Relacionamento com a marca — ⚠️ não para usabilidade | −100 a +100. Trate como termômetro de relacionamento, não como preditor de crescimento |

**SUS.** John Brooke (1986/1996). **10 itens**, Likert de 5 pontos, com polaridade alternada; score final 0–100. Benchmark **68**, derivado de análise de **mais de 5.000 usuários em ~500 avaliações**. Curva de percentil (Sauro-Lewis Curved Grading Scale): A+/A acima de ~80,3 (top 10%); B− ~74 (percentil 70); C = 68 (média, percentil ~50); F abaixo de ~51 (bottom 15%).
Ponto crítico: **68 é o percentil 50, não "68%"** — a distribuição não é linear, e 80,3 já é top decil.
Fonte: Jeff Sauro, MeasuringU — https://measuringu.com/sus/

**UMUX-Lite.** Dois itens: "as capacidades do sistema atendem aos meus requisitos" e "o sistema é fácil de usar". Equivalência com SUS pela regressão:

```
SUS = 0,65 × ((Item1 + Item2 − 2) × (100/12)) + 22,9
```

Correlação com SUS **r = 0,83**; alpha do UMUX-Lite = 0,86 (SUS = 0,91). Lewis, Utesch & Maher, "UMUX-LITE: When there's no time for the SUS", CHI 2013.
Fonte: https://measuringu.com/umux-lite/

**SEQ.** Pergunta única — "no geral, quão difícil ou fácil foi completar a tarefa?" — em escala de **7 pontos**, com âncoras só nos extremos, aplicada **imediatamente após cada tarefa**. Média de referência **~5,3–5,6**, sobre **mais de 400 tarefas e 10.000 usuários**; correlação com conclusão e tempo de tarefa r ≈ 0,5. Em comparação direta, o SEQ "teve desempenho igual ou melhor que medidas mais complicadas" como o SMEQ, apesar de ter 1 item contra dezenas.
Fonte: https://measuringu.com/seq10/

**NPS e suas críticas.** Pergunta única de recomendação 0–10; %Promotores (9–10) − %Detratores (0–6).
⚠️ **Crítica acadêmica central:** Keiningham, Cooil, Andreassen & Aksoy, "A Longitudinal Examination of Net Promoter and Firm Revenue Growth", *Journal of Marketing*, 71(3), jul 2007, 39–51 — o estudo **falha em replicar** a alegação de que o NPS é o melhor preditor de crescimento e não encontra superioridade sobre ACSI/satisfação convencional. Críticas subsequentes de validade de construto em *International Journal of Market Research* (2023).
Fontes: https://link.springer.com/article/10.1057/dbm.2008.4 · https://journals.sagepub.com/doi/10.1177/14707853231213274
A NN/g recomenda, para usabilidade percebida, preferir SUS, NASA-TLX ou SEQ ao NPS — https://www.nngroup.com/articles/measuring-perceived-usability/

**Ordem de escolha prática:** SEQ por tarefa (mais barato e mais acionável) → SUS ao fim da sessão (comparável entre versões) → UMUX-Lite quando não couber o SUS → NPS só se o cliente já o usa como métrica de negócio, e com a ressalva declarada.

---

## 5. HEART — framework de métrica de produto

Rodden, K., Hutchinson, H. & Fu, X., "Measuring the User Experience on a Large Scale: User-Centered Metrics for Web Applications", **CHI 2010**.

| Categoria | Definição | Exemplo de sinal |
|---|---|---|
| **Happiness** | Atitudinal: satisfação, apelo visual, facilidade percebida | SUS, SEQ, survey de satisfação |
| **Engagement** | "A frequência, intensidade ou profundidade da interação em um período" | Sessões por usuário, profundidade de rolagem, uso de recurso-chave |
| **Adoption** | "Quantos novos usuários começam a usar o produto em um período" | Primeiro cadastro, primeira conversão |
| **Retention** | "Quantos usuários de um período ainda estão presentes num período posterior" | Retorno em 30 dias, recompra |
| **Task Success** | Eficiência (tempo), eficácia (% de conclusão) e taxa de erro | Conclusão de formulário, erro de validação |

**Processo Goals → Signals → Metrics:** articule o objetivo; identifique os sinais comportamentais ou atitudinais de sucesso e de falha; traduza cada sinal em uma métrica rastreável. É o passo que impede a lista de métricas de virar dashboard sem decisão.

⚠️ **Caveat dos próprios autores:** "nem sempre é apropriado empregar métricas de todas as categorias". Engagement não faz sentido em produto de uso obrigatório; retention não faz sentido em página de captação de lead com compra única.
Fonte: https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/36299.pdf

Para uma página de captação, o recorte que sobrevive é **Task Success** (conclusão do formulário, erro de validação) + **Happiness** (SEQ pós-tarefa em teste) + **Adoption** (leads novos). Forçar as cinco categorias produz métrica decorativa.

---

## 6. Analytics comportamental: mapas de calor e gravações

São métodos **comportamentais e observacionais**, não experimentais. Servem para **gerar hipóteses** — nunca para provar causalidade.
Fonte (tema): NN/g, *Heatmaps and Visual Analytics for Website Optimization* — https://www.nngroup.com/courses/heatmaps-visual-analytics/

| Armadilha | O que acontece | Como mitigar |
|---|---|---|
| Mapa de clique agrega intenções diferentes | 400 cliques num elemento podem ser 400 pessoas tentando clicar em algo que não é clicável — o que parece engajamento é frustração | Cruze com rage clicks e com gravações daquele elemento |
| Scroll map depende do tamanho da página | Comparar scroll depth entre uma página de 3.000px e uma de 9.000px é comparar coisas diferentes | Compare a mesma página antes/depois, nunca páginas de alturas distintas |
| Viés de amostra | Ferramentas amostram tráfego, e bloqueio por adblock/ITP distorce quem entra na amostra | Trate como direcional; não extrapole proporções |
| Média esconde segmento | Um heatmap agregado de mobile + desktop não descreve nenhum usuário real | Segmente sempre por dispositivo e, quando possível, por origem |
| Gravação não escala e induz confirmação | Assistir 8 sessões e concluir "os usuários não entendem o formulário" é anedota | Assista até formular a hipótese, depois **valide quantitativamente** |
| Privacidade / LGPD | Gravação captura entrada de dados pessoais | Mascaramento de campos sensíveis é obrigatório, não opcional |

**Uso correto, em uma frase:** heatmap e gravação dizem **onde olhar**; teste de usabilidade e first-click dizem **por quê**; analytics diz **quanto**.

---

## 7. O que instrumentar no GA4

Em 2024 o Google renomeou "Conversions" para **"Key Events"** no GA4. Não há diferença funcional, mas "Conversions" continua existindo no Google Ads como métrica de interação pós-anúncio — os dois termos passaram a significar coisas diferentes em ferramentas diferentes.

Três formas de configurar um key event: (1) marcar um evento existente com a estrela — aparece em "Recent events" tipicamente em até 24h; (2) criar evento em Admin → Exibição de dados → Criar evento, baseado em condições; (3) enviar via Tag Manager e marcar depois.

**Limitações críticas:** mudanças valem **apenas para dados futuros** — não há reprocessamento retroativo. E o método de contagem — "uma vez por evento" (padrão, adequado para compra) ou **"uma vez por sessão" (preferível para formulários, para evitar inflação)** — é o erro de configuração mais comum em conta de agência.
Fonte: Analytics Mania — https://www.analyticsmania.com/post/track-key-events-with-google-analytics-4/

**Plano mínimo para uma landing page de captação:**

| Evento | Disparo | Contagem | Por que existe |
|---|---|---|---|
| `generate_lead` | Envio de formulário **confirmado pela resposta do servidor**, não pelo clique no botão | Uma vez por sessão | É o resultado; disparar no clique infla com envios que falharam |
| `form_start` | Primeiro campo focado | Uma vez por sessão | O par com `generate_lead` é o que revela **abandono de formulário** |
| `whatsapp_click` | Clique no CTA de mensagem, com parâmetro de página e seção de origem | Uma vez por sessão | Sem isso, o lead que sai pelo canal de mensagem é invisível |
| `phone_click` | Clique em link `tel:` | Uma vez por sessão | Mesmo motivo |
| `view_offer` | Seção de preço/oferta visível no viewport | Uma vez por sessão | Separa "não viu a oferta" de "viu e não quis" |
| `scroll` (90%) | Profundidade de rolagem | Padrão | Distingue rejeição imediata de leitura sem conversão |

⚠️ O par `form_start` / `generate_lead` é o dado mais barato e mais ignorado: sem ele não se sabe se o problema é a página ou o formulário.

**Governança no Tag Manager** — sem isto, nada agrega entre projetos: nomenclatura de eventos padronizada entre todos os clientes; **Consent Mode v2** (adequação LGPD e preservação de dados de conversão); ambiente de preview antes de publicar; `dataLayer` definido no início do projeto, não improvisado.

**O que só o Search Console entrega:** as consultas reais que geraram impressão e clique (fonte primária de vocabulário do usuário para rotulagem); CTR por consulta — CTR baixa com posição boa é problema de title/description, não de ranking; cobertura e indexação; e **Core Web Vitals de campo**, dados reais de usuário e não de laboratório.

**RUM.** Dado de laboratório ≠ dado de campo. O CrUX (Chrome UX Report) é gratuito e alimenta o relatório de Core Web Vitals; a biblioteca oficial `web-vitals` envia LCP, INP e CLS reais como eventos GA4. Métricas atuais: **LCP** (carregamento), **INP** (interatividade — substituiu o FID em março de 2024) e **CLS** (estabilidade visual). Enviar CWV ao GA4 permite a análise que fecha o argumento: **segmentar conversão por faixa de LCP**. Se sessões com LCP > 4s convertem metade das sessões com LCP < 2,5s, a evidência é **do próprio cliente** — mais persuasiva que qualquer benchmark externo e imune à ressalva de que o dado é de outro mercado.

**Fechando o loop.** O erro estrutural mais comum é medir **lead** e parar ali. Lead não é o resultado do cliente; agendamento comparecido e venda são. Loop completo: hipótese com evidência declarada → instrumentação definida **antes** do código → medição de proxy no GA4 → **retorno do cliente sobre quantos leads viraram atendimento e venda** (pode ser uma planilha semanal) → atribuição por página via UTM e parâmetro na mensagem pré-preenchida → realimentação em novas hipóteses.
⚠️ Sem o passo do retorno do cliente, tudo o que se entrega é otimização de proxy. É perfeitamente possível dobrar leads e reduzir o faturamento do cliente — basta reduzir campos, atrair curioso e afogar o vendedor.

---

## 8. A escada de métodos para quem não tem verba nem tráfego

Ordem do mais barato ao mais caro. A regra de escolha é subir só até onde a decisão exige — e parar assim que a dúvida foi resolvida.

| # | Método | Custo | Prazo | Amostra | O que resolve | O que **não** resolve |
|---|---|---|---|---|---|---|
| 1 | Avaliação heurística / revisão de especialista | Quase zero | Horas | 1–3 avaliadores | Encontra os problemas grandes e óbvios | Não descobre o que o usuário quer |
| 2 | Teste de 5 segundos | Quase zero | Horas | 5–10 | Clareza da proposta de valor e do CTA | Nada além da primeira dobra |
| 3 | First-click testing | Muito baixo | 1 dia | 15–30 | Rótulo e navegação; preditivo de sucesso da tarefa | Não explica o porquê do erro |
| 4 | Teste de usabilidade moderado | Baixo | 1–2 semanas | 5–8 | O "porquê" dos travamentos | Não mede taxa nem generaliza |
| 5 | Heatmap + gravação de sessão | Baixo (ferramenta) | Contínuo | Tráfego existente | Gera hipótese sobre onde olhar | Não prova causalidade |
| 6 | Card sorting + tree testing | Baixo-médio | 2–3 semanas | 15 / ~50 | Arquitetura de informação e rotulagem | Nada sobre visual ou oferta |
| 7 | Survey com instrumento validado (SUS/SEQ) | Baixo | 1–2 semanas | 20+ | Número comparável entre versões | Autorrelato, não comportamento |
| 8 | Benchmark de usabilidade quantitativo | Médio-alto | 3–4 semanas | 20+ | Taxa de sucesso e tempo com intervalo de confiança | Caro para a maioria dos projetos pequenos |
| 9 | Teste A/B | Alto | Meses | Milhares por variante | Causalidade | ⚠️ Inviável em baixo tráfego — ver abaixo |

**Por que o degrau 9 costuma estar fora de alcance.** Os quatro parâmetros que determinam a amostra são taxa de conversão base, MDE (menor efeito detectável), poder (convenção 80%) e significância (convenção α=5%). Com 80% de poder e α=5%, sair de 14% para 19% de conversão exige **681 visitantes por variação**; aumentar o MDE de 10% para 25% reduz a amostra de **mais de 8.000 para 1.356 por variação** — "mas alcançar melhorias de 25% é irrealista para a maioria dos testes". Duração mínima recomendada: **2 a 4 semanas**, para cobrir um ciclo de negócio completo.
Fonte: CXL, *Statistical Power* — https://cxl.com/blog/statistical-power/

Uma página com 1.500 visitas/mês e conversão base de 3%, buscando detectar um ganho relativo de 15%, precisa de **muito acima de 20.000 visitas por variação** — mais de dois anos por teste. Nesse cenário, vender teste A/B é teatro estatístico; o caminho honesto são os degraus 1 a 7, mais message match rigoroso e medição até o resultado real do cliente.

⚠️ E mesmo com tráfego suficiente: a taxa de sucesso de experimentos é de **33% na Microsoft**, **15% no Bing** e **8–10% em Booking.com, Google Ads, Netflix e Airbnb** — a maioria das ideias não melhora as métricas. Com taxa de sucesso base de 10%, p<0,05 e poder de 80%, a taxa real de falso positivo chega a **22%**; com poder baixo, "mais da metade dos resultados estatisticamente significativos serão falsos positivos". E **peeking** — parar o teste quando ficou significativo — infla substancialmente o erro Tipo I.
Fonte: Kohavi, Deng & Vermeer, *A/B Testing Intuition Busters*, KDD '22 — https://www.researchgate.net/publication/361226478_AB_Testing_Intuition_Busters_Common_Misunderstandings_in_Online_Controlled_Experiments

**Quando não há tráfego nem verba, o que ainda é legítimo dizer ao cliente:** aplicar best practices com evidência acumulada externa (velocidade, clareza de preço, redução de campos, sinais de confiança) é defensável **desde que declarado como best practice, não como "testado neste site"**. E, para uma agência com muitos projetos parecidos, agregar o mesmo padrão entre clientes gera poder estatístico que nenhum cliente isolado possui — é o único caminho para transformar prática em evidência própria.
