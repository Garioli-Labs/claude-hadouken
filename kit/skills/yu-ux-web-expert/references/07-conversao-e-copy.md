# Conversão e Copy — referência operacional

Destilação de evidência para decisões de conversão, oferta e texto. Cada número carrega fonte. Onde a evidência é fraca ou contestada há ⚠️ e a razão — a marca viaja junto com o número em vez de ser apagada para a recomendação soar mais firme.

## Índice

1. [Estrutura de página de venda](#1-estrutura-de-página-de-venda)
2. [Níveis de consciência (Schwartz)](#2-níveis-de-consciência-eugene-schwartz)
3. [Correspondência de mensagem (message match)](#3-correspondência-de-mensagem-message-match)
4. [Proposta de valor e teste de 5 segundos](#4-proposta-de-valor-e-teste-de-5-segundos)
5. [Microcopy e UX writing](#5-microcopy-e-ux-writing)
6. [Cialdini — 7 princípios, uso ético e uso manipulador](#6-cialdini--7-princípios-uso-ético-e-uso-manipulador)
7. [Kahneman & Tversky aplicados a preço e oferta](#7-kahneman--tversky-aplicados-a-preço-e-oferta)
8. [Paradoxo da escolha — o que a evidência realmente sustenta](#8-paradoxo-da-escolha--o-que-a-evidência-realmente-sustenta)
9. [Confiança e credibilidade](#9-confiança-e-credibilidade)
10. [Priorização de hipóteses: PIE, ICE, PXL](#10-priorização-de-hipóteses-pie-ice-pxl)
11. [Benchmarks de conversão](#11-benchmarks-de-conversão)
12. [A matemática honesta do teste A/B](#12-a-matemática-honesta-do-teste-ab)
13. [Achados de CRO que circulam como fato e têm evidência fraca](#13-achados-de-cro-que-circulam-como-fato-e-têm-evidência-fraca)

---

## 1. Estrutura de página de venda

**Status epistêmico: best practice composta, não experimento controlado.** Cada seção existe porque resolve uma objeção ou atende a uma diretriz com fonte; a ordem nunca foi testada como unidade.

| # | Seção | Função (o que ela resolve) | Base |
|---|---|---|---|
| 1 | Hero | Confirma que o usuário chegou ao lugar certo (message match literal), enuncia a proposta de valor e oferece o CTA sem exigir rolagem | Google Ads, landing page experience — https://support.google.com/google-ads/answer/6167130 |
| 2 | Prova imediata | Reduz risco percebido antes que o ceticismo se instale: nota de plataforma externa, nº de clientes, selo de fabricante | NN/g, *Trustworthiness in Web Design* — https://www.nngroup.com/articles/trustworthy-design/ |
| 3 | Problema nomeado | Ancora a página no vocabulário do cliente, não no do técnico; ativa reconhecimento em vez de exigir tradução | NN/g, *Mental Models* — https://www.nngroup.com/articles/mental-models/ |
| 4 | Oferta específica com preço ou faixa | Divulgação antecipada (*upfront disclosure*): a ausência de preço é lida como falta de transparência | NN/g, *Trustworthiness in Web Design* (mesma URL acima) |
| 5 | Como funciona em 3 passos | Reduz a percepção de esforço — a dimensão *Ability* do B=MAP | BJ Fogg, Behavior Model — https://www.behaviormodel.org/ |
| 6 | Prova social externa e verificável | Depoimento hospedado pela própria empresa é recebido com ceticismo; validação de terceiro pesa mais | NN/g, *Trustworthiness in Web Design* (mesma URL acima) |
| 7 | Tratamento de objeções | Garantia, prazo, o que está e o que não está incluso — remove o risco residual antes do CTA final | Baymard, razões de abandono — https://baymard.com/lists/cart-abandonment-rate |
| 8 | Prova local / prova de existência física | Mostra que existe organização real por trás do site (diretriz 2 de Fogg) | Stanford Web Credibility — https://credibility.stanford.edu/guidelines/index.html |
| 9 | CTA repetido em cada ponto natural de decisão | O usuário decide em momentos diferentes; exigir rolagem de volta é fricção gratuita | — (decorrência de 1) |
| 10 | Formulário curto ou canal direto | O ponto de conversão. Cada campo é custo — mas ver §13 sobre a nuance de qualidade de lead | Baymard, campos de formulário — https://baymard.com/blog/checkout-flow-average-form-fields |
| 11 | Rodapé com razão social, CNPJ, endereço e telefone | Credibilidade (diretrizes 2 e 5 de Fogg) e exigência do Decreto 7.962/2013 para comércio eletrônico | Stanford Web Credibility (mesma URL acima) |

**Regra de granularidade:** uma página por grupo de anúncios/intenção. Três serviços anunciados = três páginas, não uma com três seções — pelo motivo de §3.

---

## 2. Níveis de consciência (Eugene Schwartz)

De *Breakthrough Advertising* (1966). O nível de consciência é determinado pela **origem do tráfego**, e é ele que define onde a página começa.

| Nível | Estado do prospect | Abertura correta da página | Abertura que destrói conversão |
|---|---|---|---|
| **Inconsciente** | Não sabe que tem um problema | Sintoma ou situação reconhecível ("Seu pneu tem mais de 5 anos?") | Nome do produto, preço, oferta |
| **Consciente do problema** | Sente a dor, não sabe que existe solução | Nomear o problema na linguagem dele e apresentar a categoria de solução | Comparação de marcas, tabela de preço |
| **Consciente da solução** | Sabe que existe solução, não conhece você | Diferenciar o **mecanismo**: por que a sua forma resolve melhor | Repetir a dor que ele já conhece |
| **Consciente do produto** | Conhece você, não está convencido | Prova, garantia, comparação, remoção de risco | Educação sobre o problema |
| **Mais consciente** | Já quer, precisa do gatilho | Preço, disponibilidade, prazo, CTA direto | Storytelling e construção longa |

Fonte (referência acessível): Optimum7, *5 Levels of Customer Awareness* — https://www.optimum7.com/blog/5-levels-of-customer-awareness-and-how-to-target-them.html

**Como o tráfego mapeia para o nível:**

| Origem do tráfego | Nível provável | Consequência para a abertura |
|---|---|---|
| Busca por produto + medida + "preço" | Mais consciente | Preço e disponibilidade na primeira dobra |
| Busca por sintoma | Consciente do problema | Diagnosticar antes de vender |
| Busca por categoria de solução | Consciente da solução | Diferencial de mecanismo e prova |
| Display / prospecção fria | Inconsciente a consciente do problema | Construção mais longa; CTA direto converte mal |
| Remarketing | Consciente do produto | Objeção e remoção de risco |

⚠️ **Força da evidência: fraca-a-média.** Schwartz é framework de copywriting com sessenta anos de uso profissional, não teoria validada experimentalmente. Não existe estudo controlado publicado medindo lift por alinhamento de nível de consciência. A força dele é estrutural: é essencialmente uma reformulação do message match (§3), que tem mecanismo econômico documentado.

---

## 3. Correspondência de mensagem (message match)

**O que acontece quando quebra — a parte com evidência real.** O Google declara *landing page experience* como um dos três componentes do Índice de Qualidade, e lista consistência de mensagem entre anúncio e página como fator explícito: "mantenha a mensagem consistente do anúncio até a landing page. Garanta que a página cumpre a oferta ou o call to action do anúncio".
Fonte: Google Ads Help, *About landing page experience* — https://support.google.com/google-ads/answer/6167130

Consequência econômica: message match ruim → *landing page experience* pior → Índice de Qualidade menor → **CPC maior e posição pior**. Não é hipótese de CRO, é o mecanismo declarado do leilão — e independe de qualquer estudo de conversão.

⚠️ **O que NÃO se pode afirmar:** não existe estudo publicado quantificando o impacto de message match sobre taxa de conversão. A peça de referência do setor é conceitual e ilustrativa — mostra exemplos de páginas, sem uma única métrica de lift.
Fonte: CXL, *Give Your Advertising ROI a Boost by Maintaining Scent* — https://cxl.com/blog/give-your-advertising-roi-a-serious-boost-by-maintaining-scent/

Formulação defensável: (a) o Google penaliza economicamente, com mecanismo documentado; (b) a teoria de *information scent* (Pirolli & Card) fundamenta o princípio; (c) é best practice de custo de implementação praticamente zero. Indefensável: "quebrar message match derruba conversão em X%".

**Nível de literalidade exigido:** mesma palavra, mesmo número, mesma cidade, mesma oferta.

| Anúncio | Hero correto | Hero que quebra |
|---|---|---|
| "Pneu Aro 15 a partir de R$ 289 — Campinas" | "Pneu Aro 15 a partir de R$ 289 em Campinas" | "Qualidade e confiança para o seu carro" |
| "Troca de óleo em 30 minutos" | "Troca de óleo em 30 minutos, com agendamento" | Home institucional do autocenter |

---

## 4. Proposta de valor e teste de 5 segundos

**Como avaliar se existe uma.** No espaço visível sem rolagem, a página responde a três perguntas — se qualquer uma fica sem resposta, não existe proposta de valor, existe slogan: (1) **o que é isto?** (categoria em substantivo concreto); (2) **para quem, e qual resultado específico entrega?** (benefício, não adjetivo); (3) **por que aqui e não no concorrente?** (diferencial verificável, não superlativo).
Fonte do enquadramento: CXL, *Value Proposition* — https://cxl.com/blog/value-proposition-examples-how-to-create/ · ⚠️ framework de prática profissional, não instrumento validado: revela ausência com confiabilidade, mas não prevê magnitude de ganho.

**Teste de reprovação rápido:** se a headline pode ser colada no site de um concorrente sem ficar falsa, ela não é uma proposta de valor. "Transforme seu negócio", "Qualidade e confiança", "Soluções sob medida" reprovam sempre.

**Teste de 5 segundos.** Mostre a primeira dobra por 5 segundos, retire da tela e pergunte, sem consultar: (a) o que essa empresa oferece; (b) para quem; (c) o que você faria a seguir; (d) que sensação a página passa. Amostra útil: 5 a 10 pessoas fora do projeto — é teste de recall, não de preferência. Aprovação: a maioria acerta (a) e (c); divergência em (a) é falha de clareza, em (c) é falha de hierarquia do CTA.
Fonte: NN/g, *Testing Visual Design* — https://www.nngroup.com/articles/testing-visual-design/

Por que 5 segundos bastam: a impressão estética se forma em torno de 50 ms (§9), e primeiras impressões melhores vêm de **baixa complexidade visual + alta prototipicalidade** — a página parecer o que se espera daquela categoria. Fonte: Google Research — https://research.google.com/pubs/archive/38315.pdf

---

## 5. Microcopy e UX writing

**Princípios operacionais.** Status: consenso profissional forte, sem validação experimental controlada.

| Princípio | Regra | Por quê |
|---|---|---|
| Claro > esperto | O texto informa antes de encantar | Fluência de processamento eleva confiança percebida — https://en.wikipedia.org/wiki/Processing_fluency |
| Voz ativa | Sujeito age sobre objeto | Menos palavras e menos ambiguidade de agente |
| *Frontload* | A palavra que carrega o significado vem primeiro | Varredura em padrão layer-cake lê o início da linha — https://www.nngroup.com/articles/layer-cake-pattern-scanning/ |
| Verbo + objeto no botão | O rótulo descreve o **resultado**, não a ação mecânica | Reduz ambiguidade sobre o que acontece no clique |
| Ansiedade no ponto de fricção | A garantia aparece ao lado do campo que assusta, não no rodapé | O medo é local, a resposta precisa ser local |
| Sem jargão interno | Vocabulário do usuário vence vocabulário do catálogo | https://www.nngroup.com/articles/mental-models/ |

**Antes e depois:**

| Antes | Depois | Princípio |
|---|---|---|
| "Clique aqui para agendar" | "Agendar troca de óleo" | Frontload + verbo/objeto |
| "Enviar" | "Receber meu orçamento" | Rótulo descreve o resultado |
| "Saiba mais" | "Ver preços e prazos" | Elimina ambiguidade do destino |
| "Seus dados serão utilizados conforme nossa política" | "Usamos seu telefone só para responder este orçamento" | Ansiedade tratada no ponto de fricção |
| "Preencha os campos obrigatórios" | "Falta o WhatsApp para a gente te responder" | Erro específico + motivo |
| "Não foi possível processar sua solicitação" | "Não conseguimos enviar. Tente de novo ou chame no WhatsApp (11) 9xxxx-xxxx" | Erro com saída |
| "Nossa empresa oferece soluções em manutenção automotiva" | "Trocamos o óleo do seu carro em 30 minutos, sem agendamento" | Voz ativa + benefício concreto |
| "Cadastre-se agora e aproveite" | "Ver disponibilidade para amanhã" | Promessa que o botão cumpre |

⚠️ **Força da evidência sobre impacto de microcopy — leia antes de vender.** Os cases publicados medem quase sempre **proxy de etapa** (clique, avanço), misturam mudanças simultâneas e não reportam amostra nem significância.

- Link "Ver pacote" acima do CTA: **+17,18%** relatado — sem amostra, duração ou significância publicadas.
- Checkout com "(não haverá custos adicionais)" + indicador de progresso: **+11,30%** — ⚠️ a própria fonte diz que "o microcopy sozinho não pode levar o crédito".
- Botão "Continue" → "Review Order": **+39,4%** — ⚠️ mediu clique para a etapa seguinte, não conversão nem receita.
- Checkbox de confirmação no início do formulário: **+11%** de formulários completos — parte de um ganho maior, atribuição por elemento não é clara.

Fonte dos quatro: CXL, *Microcopy* — https://cxl.com/blog/microcopy/

**Veredito:** microcopy move métricas de etapa com plausibilidade alta. Impacto em receita é hipótese, não achado. Venda como redução de fricção, não como multiplicador de faturamento.

---

## 6. Cialdini — 7 princípios, uso ético e uso manipulador

Definições do próprio autor, com o experimento original. Fonte: Influence at Work — https://www.influenceatwork.com/7-principles-of-persuasion/

| Princípio | Definição | Experimento original | Aplicação ética | Aplicação manipuladora |
|---|---|---|---|---|
| **Reciprocidade** | "As pessoas se sentem obrigadas a devolver aquilo que receberam primeiro." | Restaurante: 1 bala = +3% gorjeta; 2 = +14%; 1 entregue de forma personalizada e inesperada = **+23%** | Diagnóstico gratuito real, guia útil, orçamento sem compromisso | "Presente" que cria dívida com obrigação escondida no contrato |
| **Escassez** | "As pessoas querem mais daquilo que podem ter menos." | Descontinuação do Concorde (British Airways, 2003): vendas subiram sem mudança no serviço | Estoque real declarado; prazo de campanha que de fato termina | Contador que reinicia ao recarregar a página; "últimas unidades" perene. No Brasil, publicidade enganosa — CDC art. 37 |
| **Autoridade** | "As pessoas seguem a liderança de especialistas críveis e conhecedores." | Imobiliária apresentando credenciais dos corretores: **+20%** em avaliações, **+15%** em contratos | Certificação que a empresa tem, responsável técnico nomeado, marca de fabricante que ela representa | Selo inventado, diploma vago, "recomendado por especialistas" sem especialista |
| **Consistência** | "As pessoas gostam de ser consistentes com o que já disseram ou fizeram." | Cartão-postal "Dirija com segurança" antes do pedido grande: **75%** de adesão (aumento de 400% sobre o controle) | Micro-compromisso útil ao usuário (escolher o carro antes de ver preço) | Formulário multi-etapas que só revela custo depois do investimento de tempo |
| **Afinidade** | "As pessoas preferem dizer sim a quem elas gostam." | Negociação com MBAs: trocar informação pessoal elevou acordo de **55% para 90%**, com resultados **18%** mais valiosos | Equipe real com nome e rosto, linguagem do cliente | Falsa intimidade automatizada; foto de banco de imagens como "nosso time" |
| **Prova social** | "Especialmente quando incertas, as pessoas olham para as ações dos outros." | Placa informando que **75%** dos hóspedes reutilizam toalhas: **+33%** de adesão | Avaliação verificável em plataforma de terceiro, nº documentado de atendimentos | "37 pessoas vendo agora" gerado por `Math.random()`; review comprado |
| **Unidade** | Identidade compartilhada — o senso de "somos do mesmo grupo" | A fonte primária não traz experimento numerado para este princípio | "Somos daqui desde 1998" quando é verdade | Fabricar pertencimento local que a empresa não tem |

⚠️ **Ressalva séria e obrigatória:** vários experimentos clássicos de psicologia social sofreram na crise de replicação. Os efeitos de Cialdini são amplamente replicados **em direção**; as **magnitudes** originais (anos 70–90, amostras pequenas, contexto americano) não devem ser tratadas como previsão de resultado em um site brasileiro em 2026. Cite o princípio, não o percentual, quando prometer resultado.

**Teste operacional de fronteira ética** (mais defensável que o autoaplicado "teste do arrependimento" de Nir Eyal, que é feito por quem tem incentivo financeiro no resultado — https://www.nirandfar.com/regret-test/): **a técnica sobreviveria à publicação?** Se você não colocaria a explicação da técnica na própria página, não use.

---

## 7. Kahneman & Tversky aplicados a preço e oferta

**Teoria da perspectiva e aversão à perda.** Resultados são avaliados em relação a um **ponto de referência**, não em valor absoluto; a curva de valor é em S — côncava para ganhos, convexa para perdas e **mais íngreme para perdas**, ou seja, perdas pesam mais que ganhos equivalentes. Fonte: https://en.wikipedia.org/wiki/Prospect_theory
⚠️ Um estudo em *Nature Human Behaviour* (2020) concluiu que "os fundamentos empíricos da teoria da perspectiva replicam além de qualquer limiar razoável" — isso é forte. **Mas** a crítica de Gal & Rucker argumenta que a aversão à perda é frequentemente superestimada e que muitos efeitos atribuídos a ela se explicam por inércia ou saliência. Trate como real e **menos poderosa do que o marketing afirma**. Copy inteiramente construída sobre medo tem retorno decrescente e custo de marca.

**Enquadramento.** "A forma como o agente enquadra subjetivamente um resultado afeta a utilidade que ele espera ou recebe."

| Enquadramento | Formulação | Quando usar |
|---|---|---|
| Ganho | "Economize R$ 200 no kit completo" | Oferta positiva, público sem urgência instalada |
| Perda | "Rodar com pneu careca custa R$ X em consumo extra por mês" | Só quando a perda é real, quantificável e verificável |
| Custo unitarizado | "R$ 3,20 por dia" em vez de "R$ 96 por mês" | Ticket alto com pagamento recorrente |

**Ancoragem.** Tversky & Kahneman (1974): roda da fortuna viciada para parar em 10 ou 65, seguida da pergunta sobre o percentual de países africanos na ONU. Âncora 10 → média **25%**; âncora 65 → média **45%**.
Fonte: https://en.wikipedia.org/wiki/Anchoring_effect
⚠️ **Replicação mista:** os esforços *Many Labs* mostraram que versões com a aleatoriedade explicitamente visível (gerador do Excel, dado) **falharam em replicar**. A ancoragem é real, mas **condicional a o número parecer relevante**. Âncora obviamente arbitrária não ancora.

**Aplicação em preço e oferta:**
- Apresentar o pacote completo antes do item avulso ancora o valor percebido do avulso.
- Preço "de/por" funciona — e **só é legal se o preço "de" foi efetivamente praticado**; caso contrário é infração do CDC.
- Ordem de exibição de planos importa mais que a existência de um plano "âncora" caro que ninguém compra.
- Efeito decoy (dominância assimétrica): ⚠️ real, mas **modesto e sensível à apresentação visual**; a replicação publicada não está acessível para confirmação. Use como técnica de estruturação com plausibilidade, não como certeza — https://pmc.ncbi.nlm.nih.gov/articles/PMC8657019/
- Efeito de dotação (test drive, "leve para experimentar", garantia de devolução): ⚠️ contestado. Plott & Zeiler argumentam que as disparidades observadas decorrem de falhas de desenho experimental, e a replicação com bens substituíveis encontrou pouco efeito — https://en.wikipedia.org/wiki/Endowment_effect

**Default e viés de status quo.** Samuelson & Zeckhauser (1988), seguros em New Jersey/Pensilvânia: com a apólice barata como padrão em NJ apenas **20%** migraram para a cara; com a cara como padrão na PA apenas **25%** migraram para a barata — apólices idênticas disponíveis nos dois estados. Apenas revelar que existe um default **não** reduz o viés. Fronteira ética: default que beneficia o usuário é aceitável; default pré-marcado que só beneficia a empresa é dark pattern e, no Brasil, potencial venda casada (CDC art. 39, I). Fonte: https://en.wikipedia.org/wiki/Status_quo_bias

---

## 8. Paradoxo da escolha — o que a evidência realmente sustenta

**Estudo original.** Iyengar & Lepper (2000), estande de geleias com 6 ou 24 sabores: **60%** dos passantes pararam no estande grande contra **40%** no pequeno, mas apenas **3%** dos que pararam no de 24 compraram, contra quase **30%** no de 6.

⚠️⚠️ **A evidência contrária é substancial:**
- **Scheibehenne, Greifeneder & Todd (2010)**, meta-análise: o tamanho de efeito médio de mudar o número de opções, ao longo dos estudos, foi **efetivamente zero**.
- Replicações do estudo das geleias em supermercado alemão: **sem efeito**. Experimentos com chocolates e jujubas: **falharam em replicar**.
- **Chernev, Böckenholt & Goodman (2015)**, meta-análise posterior: o efeito é **condicional** a moderadores — complexidade do conjunto, dificuldade da decisão, incerteza de preferência e objetivo da decisão.

Fontes: Jason Collins, *Not the jam study again* — https://blog.jcx.au/posts/not-the-jam-study-again · Chernev et al., *Choice Overload* — https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf

**O que dizer e o que não dizer:**

| Não diga | Diga |
|---|---|
| "A ciência prova que menos opções vendem mais" | "Quando a escolha é difícil e o cliente não sabe o que quer, reduzir e estruturar as opções ajuda; quando ele sabe exatamente o que quer, variedade ajuda" |
| "Corte o catálogo" | "Reduza o **conjunto de decisão**: filtro primeiro, variedade completa depois dentro do conjunto relevante" |

A operação correta é **redução de complexidade de decisão**, não de catálogo: um filtro que leva 40.000 SKUs a 6 opções relevantes é a aplicação legítima.

---

## 9. Confiança e credibilidade

**Diretrizes da Stanford Web Credibility** — baseadas em três anos de pesquisa com mais de **4.500 participantes**:

1. Facilite a verificação da acurácia da informação do site.
2. Mostre que existe uma organização real por trás do site.
3. Destaque a expertise da organização e do conteúdo/serviços oferecidos.
4. Mostre que pessoas honestas e confiáveis estão por trás do site.
5. Facilite o contato.
6. Projete o site para parecer profissional (ou apropriado ao propósito).
7. Faça o site fácil de usar — e útil.
8. Atualize o conteúdo com frequência, ou ao menos mostre que foi revisado recentemente.
9. Use contenção com conteúdo promocional.
10. Evite erros de todo tipo, por menores que pareçam.

Fonte: Stanford Web Credibility Project — https://credibility.stanford.edu/guidelines/index.html

**O que as pessoas de fato usam para julgar.** Fogg, Soohoo, Danielson, Marable, Stanford & Tauber (2002), **2.684 participantes**, **2.440 comentários** codificados:

| Fator mencionado | % dos comentários |
|---|---|
| **Aparência do design** | **46,1%** |
| Design/estrutura da informação | 28,5% |
| Foco da informação | 25,1% |
| Motivação da empresa | 15,5% |
| Utilidade da informação | 14,8% |
| Acurácia da informação | 14,3% |
| Reconhecimento de nome / reputação | 14,1% |
| Publicidade | 13,8% |

Fonte: Fogg et al. (2002) — http://credibility.stanford.edu/pdf/How_Do_People_Evaluate_a_Web_Site's_Credibility_v37.pdf (cópia acessível: https://dejanmarketing.com/media/pdf/credibility-online.pdf)

Houve descompasso significativo entre o que as pessoas **dizem** valorizar (política de privacidade, divulgação de identidade) e o que de fato usam — que é, em quase metade dos casos, a aparência visual. É comportamento codificado, não autorrelato: por isso é o dado mais forte que existe para defender orçamento de design.

**Julgamento em ~50 ms.** Lindgaard, Fernandes, Dudek & Brown (2006), *Attention web designers: You have 50 milliseconds to make a good first impression!*, *Behaviour & Information Technology*, 25(2), 115–126: julgamentos de apelo visual formados em exposições de 50 ms correlacionam fortemente com julgamentos após exposições muito mais longas.
Fonte: https://www.semanticscholar.org/paper/f9715b117c57d4e7064afe1c1cb95d5bf4cc1831
⚠️ **Corrija o mito:** o estudo mede formação de **impressão estética** em 50 ms — **não** que o usuário decide comprar em 50 ms. A decisão de compra é subsequente e depende de conteúdo, preço e risco.

**Os 4 fatores de confiabilidade da NN/g:** (1) qualidade de design; (2) divulgação antecipada de contato, preço, taxas e política; (3) conteúdo completo, correto e atual — **imagem genérica de banco foi descartada pelos participantes como enchimento**; (4) conectado ao resto da web, com presença em sites de avaliação e imprensa pesando **mais que depoimentos hospedados pela própria empresa**.
Fonte: NN/g — https://www.nngroup.com/articles/trustworthy-design/

**Selos.** **19%** dos usuários abandonaram o checkout por não confiar no site com os dados do cartão (n=1.026, adultos americanos, 2025). Selos de confiança (legitimidade do negócio) superaram selos de SSL (criptografia), e um **selo caseiro inventado superou selos SSL de fornecedores estabelecidos**, exceto o Norton — o efeito é de reconhecimento e robustez visual, não de verificação real. ⚠️ Que um selo falso "funcione" não autoriza usá-lo: é publicidade enganosa (CDC art. 37, §1º). Use os selos que a empresa de fato possui e maximize sua legibilidade. Fonte: https://baymard.com/blog/perceived-security-of-payment-form

**Sinais de confiança concretos, em ordem de custo/benefício:**
- Razão social, CNPJ e endereço completo no rodapé
- Telefone e canal de mensagem reais, atendidos no horário anunciado
- Foto real da fachada, da operação e da equipe (não banco de imagens)
- Avaliações de plataforma externa embutidas, com link para o perfil
- Política de troca, garantia e prazo acessíveis **antes** do formulário
- Selos de fabricante/parceria que a empresa efetivamente tem
- Preços e prazos explícitos, incluindo prazo de execução
- Zero erro de digitação e zero link quebrado — a NN/g registra que erros corroem confiança rapidamente

---

## 10. Priorização de hipóteses: PIE, ICE, PXL

| Modelo | Fórmula | Escala | Fragilidade |
|---|---|---|---|
| **PIE** | `(Potential + Importance + Ease) / 3` | 1–10 por critério | "Se soubéssemos de antemão quanto potencial uma ideia tem, não precisaríamos de modelos de priorização" |
| **ICE** | `(Impact + Confidence + Ease) / 3` | 1–10 por critério | **Duas das três métricas dependem de intuição.** "Se eu pudesse adivinhar o impacto, por que eu testaria?" |
| **PXL** | `Σ(respostas binárias, com peso 2 nas variáveis mais importantes) + faixa de facilidade` | 0/1 (e 0/2 nas de maior peso) | Mais trabalhoso de preencher; exige que exista pesquisa |

Fonte das três: CXL, *PXL: A Better Way to Prioritize Your A/B Tests* — https://cxl.com/blog/better-way-prioritize-ab-tests/

**PXL — os critérios, que é o que o torna superior:**

- *Impacto:* está acima da dobra? é perceptível em 5 segundos *(peso 2 ou 0)*? adiciona ou remove elementos? roda em página de alto tráfego?
- *Embasamento:* saiu de teste com usuário? de feedback qualitativo (survey, entrevista)? é sustentada por heatmap/eye-tracking? é baseada em insight de analytics?
- *Facilidade:* estimada por **faixas de tempo de implementação**, não por nota subjetiva.

**Por que adotar PXL:** ele força, na frente do cliente, a pergunta "essa hipótese tem alguma evidência por trás?". Substitui especulação por critérios observáveis e legitima o orçamento de pesquisa.

---

## 11. Benchmarks de conversão

⚠️ **Ressalva que vale para a seção inteira:** benchmark de setor tem variância enorme. Duas empresas do mesmo setor com origens de tráfego, ticket e ciclo de decisão diferentes não são comparáveis. Um benchmark serve para responder "estou em outra ordem de grandeza?" — nunca para definir meta.

**E-commerce por setor.** Benchmark geral de mercado: **2,26%** (julho de 2026; alta de 16,47% sobre julho de 2025, que foi 1,94%).

| Setor | Taxa |
|---|---|
| Arts and Crafts | 5,23% |
| Health and Wellbeing | 3,57% |
| Kitchen & Home Appliances | 3,34% |
| Pet Care | 2,95% |
| Sports and Recreation | 2,12% |
| Cars and Motorcycling | 1,82% |
| Fashion Clothing & Accessories | 1,81% |
| Food & Drink | 1,47% |
| Baby & Child | 0,55% |

Fonte: IRP Commerce — https://www.irpcommerce.com/ecommercemarketdata.aspx · ⚠️ amostra predominantemente UK/EU: ordem de grandeza, não meta para o Brasil.

**Landing pages por indústria.** 41.000+ páginas, 464 milhões de pageviews, 57M+ conversões. **Mediana geral: 6,6%** — a fonte usa mediana, não média, justamente por causa dos outliers.

| Indústria | Mediana | "Bom" (p75) |
|---|---|---|
| E-commerce | 4,2% | 11,4% |
| SaaS | 3,8% | 11,6% |
| Viagem/Hospitalidade | 4,8% | 15,6% |
| Serviços profissionais | 6,1% | 14,1% |
| Jurídico | 6,3% | 13,1% |
| Serviços financeiros | 8,3% | 26,1% |
| Educação | 8,4% | 20,0% |
| Entretenimento | 12,3% | 40,8% |

Fonte: Unbounce — https://unbounce.com/landing-pages/whats-a-good-conversion-rate/
⚠️ **Ressalva metodológica que muda a leitura:** essas páginas recebem majoritariamente **tráfego pago segmentado**. Comparar com um site institucional que recebe orgânico frio é comparar coisas diferentes. Um cliente que ouviu "a média é 6,6%" e vê 2% no site inteiro está comparando peras com maçãs.

**Abandono de carrinho (contexto para páginas transacionais).** Agregação de **50 estudos**: **70,22%** de abandono médio documentado. Razões declaradas, em ordem: custos extras altos **40%**, entrega lenta **20%**, desconfiança dos dados do cartão **19%**, exigência de criar conta **18%**, checkout longo **17%**, erros do site **17%**, política de devolução **13%**, custo total invisível **12%**. Somando custo extra (40%) + custo total invisível (12%) + devolução (13%), a maior causa isolada é **surpresa de custo e falta de transparência** — não é design, é honestidade de preço. Adicionalmente, **42%** já abandonaram porque "só estavam olhando": abandono inevitável, não problema de design.
Fonte: Baymard Institute — https://baymard.com/lists/cart-abandonment-rate

**Mobile × desktop.** Mobile **2,8%**, desktop **3,2%**, combinado 2,9%, com distribuição de uso de **75% mobile / 25% desktop**. Desktop converte ~1,7x melhor, e o gap estreitou (historicamente acima de 2x) — ou seja, três de cada quatro visitas chegam pelo canal que converte pior.
Fonte: Smart Insights — https://www.smartinsights.com/ecommerce/ecommerce-analytics/ecommerce-conversion-rates/

---

## 12. A matemática honesta do teste A/B

**Os quatro parâmetros que determinam tudo:**

| Parâmetro | Convenção | Efeito sobre a amostra |
|---|---|---|
| Taxa de conversão base | — | Quanto menor, maior a amostra necessária |
| **MDE** (menor efeito detectável) | Definido antes | Quanto menor o MDE, muito maior a amostra |
| **Poder estatístico (1−β)** | 80% | Probabilidade de detectar um efeito real que existe |
| **Significância (α)** | 5% | Probabilidade de falso positivo por teste |

Números concretos: com 80% de poder e α=5%, ir de 14% para 19% de conversão exige **681 visitantes por variação**. Aumentar o MDE de 10% para 25% reduz a amostra de **mais de 8.000 para 1.356 por variação** — "mas alcançar melhorias de 25% é irrealista para a maioria dos testes". Duração mínima recomendada: **2 a 4 semanas**, para cobrir um ciclo de negócio completo.
Fonte: CXL, *Statistical Power* — https://cxl.com/blog/statistical-power/

**Peeking.** Rodar o teste até aparecer significância e então parar infla substancialmente o erro Tipo I. Defina amostra e horizonte **antes** de iniciar, ou use um método sequencial desenhado para monitoramento contínuo.

**O que a experimentação em escala mostra** (Kohavi, Deng & Vermeer, *A/B Testing Intuition Busters*, KDD '22):
- Taxa de sucesso de experimentos: Microsoft **33%**; Bing **15%**; Booking.com, Google Ads, Netflix, Airbnb **8–10%**. A maioria das ideias não melhora as métricas.
- P-valor **não** é "a probabilidade de o resultado ser por acaso" — é a probabilidade de obter resultado igual ou mais extremo **assumindo a hipótese nula verdadeira**. Fornecedores erram isso rotineiramente.
- Com taxa de sucesso base de 10%, p<0,05 e poder de 80%, a taxa de falso positivo real chega a **22%**; com poder baixo, "mais da metade dos seus resultados estatisticamente significativos serão falsos positivos".
- Lei de Twyman: "qualquer número que pareça interessante ou diferente geralmente está errado". Lift de 337% exige evidência extraordinária.

Fonte: https://www.researchgate.net/publication/361226478_AB_Testing_Intuition_Busters_Common_Misunderstandings_in_Online_Controlled_Experiments

### A conclusão que quase nenhuma agência diz ao cliente

Conta para uma página típica de negócio local: 1.500 visitas/mês, conversão base 3% (45 conversões/mês), MDE realista de 15% relativo (3% → 3,45%). Amostra necessária: **muito acima de 20.000 por variação** com 80% de poder e α=5%. Tempo necessário: **mais de 2 anos por teste**.

**Teste A/B não é viável para a maioria dos sites de baixo tráfego. Vendê-lo nesse contexto é teatro estatístico.** As saídas usuais são fracas: aumentar o MDE (só detecta mudanças enormes) ou baixar a confiança para 90% (aceitando o dobro de risco de falso positivo). Nenhuma resolve um problema de ordem de magnitude.

**O que fazer no lugar, em ordem de valor:**

| # | Alternativa | Custo/prazo | O que entrega |
|---|---|---|---|
| 1 | Teste de usabilidade moderado, 5–8 pessoas | Baixo, 1–2 semanas | Encontra os problemas grandes — que em site pequeno costumam ser grandes mesmo |
| 2 | First-click testing, 15–30 pessoas | Muito baixo, dias | Valida navegação e rótulo de CTA; método barato e preditivo |
| 3 | Best practices com evidência forte | Custo de implementação apenas | Velocidade, message match, clareza de preço, sinais de confiança — **declaradas como best practice, não como "testado"** |
| 4 | Mudanças grandes, não incrementos | Médio | Se só dá para detectar efeitos de 30%+, teste redesenho de página inteira, não cor de botão |
| 5 | Análise antes/depois com cautela declarada | Baixo | **Não é experimento** — sazonalidade e mix de canal contaminam. Reporte como observação, marcada como tal |
| 6 | Agregar entre clientes do mesmo nicho | Organizacional | 30 páginas parecidas têm poder estatístico que nenhuma tem sozinha — o ativo mais valioso de uma agência de nicho |
| 7 | Otimizar a fonte, não a página | Baixo | Com tráfego baixo, o ganho maior costuma estar em qualidade de tráfego e message match |

---

## 13. Achados de CRO que circulam como fato e têm evidência fraca

Esta tabela existe para o que **não** se deve afirmar.

| Afirmação que circula | Status real | Por quê |
|---|---|---|
| "Microcopy aumentou a conversão em X%" | ⚠️ Fraca | Cases sem amostra, sem significância, com várias mudanças simultâneas; a maioria mede clique para a etapa seguinte, não receita — https://cxl.com/blog/microcopy/ |
| "Quebrar message match derruba conversão em X%" | ⚠️ Sem estudo | Nenhum estudo quantificado localizado; a literatura do setor é conceitual. O que existe é o mecanismo econômico do Google — https://support.google.com/google-ads/answer/6167130 |
| "Menos campos sempre converte mais" | ⚠️ Verdade em média, falso em contexto | HubSpot e Eloqua mostram correlação negativa; a Unbounce encontrou pico com 1 campo, queda entre 3 e 7 e **nova alta** depois, com 10 campos às vezes superando 3. E menos campos aumenta quantidade e **reduz qualidade** do lead — https://www.cobloom.com/blog/form-fields-and-conversion-rates-is-less-really-more |
| "O usuário decide se compra em 50 ms" | ⚠️ Mito derivado | Lindgaard mede formação de impressão **estética**, não decisão de compra — https://www.semanticscholar.org/paper/f9715b117c57d4e7064afe1c1cb95d5bf4cc1831 |
| "A ciência prova que menos opções vendem mais" | ⚠️ Contestada | Meta-análise de Scheibehenne: efeito médio **efetivamente zero**; efeito só sobrevive sob moderadores — https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf |
| "Aversão à perda dobra o efeito de qualquer copy" | ⚠️ Magnitude superestimada | Crítica de Gal & Rucker: muitos efeitos se explicam por inércia ou saliência — https://en.wikipedia.org/wiki/Prospect_theory |
| "Ancoragem funciona sempre" | ⚠️ Replicação mista | Falhou em replicar quando a aleatoriedade da âncora era explícita (Many Labs) — https://en.wikipedia.org/wiki/Anchoring_effect |
| "Efeito de dotação: as pessoas valorizam 2x o que possuem" | ⚠️ Contestada | Plott & Zeiler atribuem a artefato experimental; pouco efeito em bens substituíveis — https://en.wikipedia.org/wiki/Endowment_effect |
| "O decoy garante que o plano do meio venda" | ⚠️ Real mas modesto | Sensível à apresentação visual; replicação não verificável — https://pmc.ncbi.nlm.nih.gov/articles/PMC8657019/ |
| "Canal de mensagem converte 6x mais que e-commerce" | ⚠️ Dado de fornecedor | Sem metodologia publicada, sem intervalo de confiança, com incentivo comercial evidente na fonte |
| "Padrão F é como as pessoas leem — projete para ele" | ⚠️ Interpretação invertida | O padrão F significa que o usuário está **pulando** conteúdo; é para combater, não para projetar — https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/ |
| "O selo de segurança aumenta a conversão" | ⚠️ Efeito é de reconhecimento visual | Um selo caseiro inventado superou selos SSL reais — o efeito não vem da verificação. Usar selo que não se tem é publicidade enganosa — https://baymard.com/blog/perceived-security-of-payment-form |
| "Nosso setor converte a X%, então sua meta é X%" | ⚠️ Uso indevido de benchmark | Variância enorme por origem de tráfego, ticket e ciclo. Benchmark responde ordem de grandeza, não define meta |
| "Rodamos o teste até dar significativo" | ⚠️ Erro estatístico | Peeking infla o erro Tipo I muito acima dos 5% nominais — https://cxl.com/blog/statistical-power/ |
| "Escassez aumenta vendas" (com contador na página) | ⚠️ Válido só se verdadeiro | Escassez fabricada é publicidade enganosa (CDC art. 37) e destrói confiança quando descoberta |
