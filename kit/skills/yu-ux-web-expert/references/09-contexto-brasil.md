# 09 — Contexto Brasil

O que muda na recomendação quando o site é brasileiro: Android de entrada em rede móvel, LGPD, Lei Brasileira de
Inclusão, WhatsApp como canal e confiança que é geográfica antes de ser digital.

## Índice

1. [Dispositivo e rede — o gargalo é CPU](#1-dispositivo-e-rede--o-gargalo-é-cpu)
2. [Perfil de throttling para teste](#2-perfil-de-throttling-para-teste)
3. [LGPD e cookies — os 6 requisitos da ANPD](#3-lgpd-e-cookies--os-6-requisitos-da-anpd)
4. [Acessibilidade legal no Brasil](#4-acessibilidade-legal-no-brasil)
5. [WhatsApp como CTA](#5-whatsapp-como-cta)
6. [Clique-para-ligar em mobile](#6-clique-para-ligar-em-mobile)
7. [Sinais de confiança locais](#7-sinais-de-confiança-locais)
8. [Benchmark de mesmo mercado — Nuvemshop](#8-benchmark-de-mesmo-mercado--nuvemshop)
9. [Varejo automotivo brasileiro](#9-varejo-automotivo-brasileiro)

## 1. Dispositivo e rede — o gargalo é CPU

O perfil dominante é **celular Android de entrada em rede móvel**, e a consequência técnica inverte a ordem de
prioridade que a maioria das agências usa.

| Fato medido | Valor | Fonte |
|---|---|---|
| TBT mediano mobile vs. desktop | **1.916 ms vs. 92 ms** (~21×) | Web Almanac 2025 — https://almanac.httparchive.org/en/2025/performance |
| p75 de carregamento de imagem, mobile vs. desktop | mobile só **~20% mais lento** | web.dev — https://web.dev/blog/common-misconceptions-lcp |

A rede móvel melhorou muito; **a lacuna de CPU não**. Se a imagem carrega 20% mais devagar mas o bloqueio da thread
principal é 21× maior, o que mata a página não é peso de imagem — é JavaScript sendo baixado, parseado, compilado e
executado num processador fraco.

> **Regra: cortar JavaScript vale mais que comprimir imagem** em site com público majoritariamente
> mobile. Comprimir imagem continua valendo; só não é onde está o maior ganho.
> Fonte: web.dev, The most effective ways to improve Core Web Vitals — https://web.dev/articles/top-cwv

**Linha de base do mercado (Web Almanac 2025, mobile p50):** peso total **2.164 KB**, **72** requisições, **646 KB de
JS**, **911 KB de imagens**, 79 KB de CSS. Fonte: https://almanac.httparchive.org/en/2025/page-weight

Isso é a mediana do rebanho, não meta. Orçamento praticável: **JS ≤ 170 KB comprimido (agressivo) / ≤ 350 KB
(realista)**, peso total ≤ 800 KB / ≤ 1.500 KB, TBT em lab ≤ 200 ms / ≤ 350 ms.

## 2. Perfil de throttling para teste

**a) Baseline obrigatório — padrão do Lighthouse** (é o que o PageSpeed Insights usa e o número que o cliente vai
ver): download **1,6 Mbps**, upload **750 Kbps**, RTT **150 ms**, sem perda de pacote, **CPU slowdown 4×**. Fonte:
https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md

**b) Cenário pessimista Brasil** — o mesmo perfil com dois ajustes:
- **CPU 6×** — Android de entrada, que domina a base instalada brasileira. É onde o dispositivo mediano mais penaliza
  e onde mora o TBT de 1.916 ms.
- **RTT 200–300 ms** — Norte, Nordeste e interior, longe dos PoPs de CDN concentrados em São Paulo.

**c) Dado real antes de adivinhar.** O **CrUX no BigQuery filtrando `country_br`** dá o p75 real do público brasileiro.
O CrUX **removeu a dimensão ECT em fevereiro de 2025**; use RTT como diagnóstico de rede.
Fonte: https://developer.chrome.com/docs/crux/bigquery · https://developer.chrome.com/blog/crux-2025-02

Duas advertências que evitam relatório errado:
- **Lighthouse não mede INP** — testes de lab não preveem quando o usuário vai interagir. Um terço dos CWV é invisível
  em laboratório; não invente o valor. Fonte: https://web.dev/articles/lab-and-field-data-differences
- **Score 100 ≠ site rápido.** O maior peso do score é TBT (30%), que é proxy, e o Google ranqueia com CrUX (campo);
  rode no mínimo 5 execuções e use a mediana. Fonte:
  https://developer.chrome.com/docs/lighthouse/performance/performance-scoring

**Erro a nomear no relatório:** testar do escritório em São Paulo, em fibra, num MacBook. Isso mede a rede da agência,
não o produto do cliente.

## 3. LGPD e cookies — os 6 requisitos da ANPD

Do Guia Orientativo *Cookies e Proteção de Dados Pessoais* da ANPD:

1. **Base legal correta** — consentimento para cookies não necessários; legítimo interesse admissível para necessários
   e medição de audiência, **após teste de balanceamento** documentado.
2. **Granularidade por categoria** (necessários, desempenho, publicidade) — nem tudo-ou-nada, nem tão granular que
   cause fadiga de decisão.
3. **Opt-in prévio** — cookies de consentimento **desativados por padrão**, nada pré-marcado, nenhum cookie
   não-essencial gravado antes da decisão.
4. **Simetria visual** — o botão de **recusar** tão destacado quanto o de aceitar: mesma tela, mesmo tamanho, mesmo
   peso, mesmo contraste, mesma hierarquia. "Aceitar tudo" verde gigante ao lado de "Gerenciar" em link cinza **é dark
   pattern e é exatamente o que a ANPD aponta**, junto com banner de botão único e aceitação pré-selecionada.
5. **Revogação simples e gratuita**, por caminho equivalente ao da coleta, com link permanentemente acessível e o
   mesmo número de cliques do aceite.
6. **Informar** — finalidade por categoria, prazo de retenção, compartilhamento com terceiros, direitos do titular e
   como bloquear cookies no navegador.

Fonte: ANPD —
https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf

**Também vedado:** **cookie wall** (condicionar acesso à aceitação). Fechar no "X" ou ignorar o banner equivale a
**recusar**. Reexibir a cada página após recusa é *nagging*.

**O número que prova a intenção por trás da assimetria.** Nouwens et al. (CHI 2020), 680 sites do top 10.000 do Reino
Unido e as cinco maiores CMPs: **apenas 11,8% atendiam ao mínimo legal**; **remover o botão de recusar da primeira
tela aumenta o consentimento em 22–23 pontos percentuais**; oferecer controles granulares na primeira tela reduz o
consentimento em 8–20 pp. Fonte: https://arxiv.org/abs/2001.02479

O desenho manipulador vale ~22 pp de "consentimento" — é por isso que a não-conformidade é a norma. Isso não a torna
legal; torna-a um risco documentado.

**Teste de sanidade em auditoria:** meça a taxa de aceite. Acima de ~50–60%, provavelmente há assimetria no desenho.

**Some o CDC.** Arts. 6º, 30, 31 e 37 da Lei 8.078/90 vedam publicidade enganosa e informação insuficiente, e vinculam
a oferta — alcança selo falso, escassez fabricada e depoimento inventado independentemente da LGPD.

## 4. Acessibilidade legal no Brasil

**LBI — Lei 13.146/2015, art. 63.** "É obrigatória a acessibilidade nos sítios da internet mantidos por empresas com
sede ou representação comercial no País ou por órgãos de governo […] conforme as melhores práticas e diretrizes de
acessibilidade adotadas internacionalmente." Alcança **empresa privada**, não só governo. O §1º exige símbolo de
acessibilidade em destaque. Fonte: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm

**ABNT NBR 17225:2025 — o que mudou o jogo.** Primeira edição em **11 de março de 2025**. Adota formalmente a **WCAG
2.2** com seus três níveis, em **16 seções temáticas**, divididas em Requisitos (≈ A e AA) e Recomendações (≈ AAA).
Define **Conformidade Regular** (todos os requisitos ≈ WCAG 2.2 AA) e **Conformidade Plena**. Antes dela, "melhores
práticas internacionais" era cláusula aberta e discutível; hoje há norma ABNT que a preenche — o que **eleva o risco
de quem não cumpre** e dá porto seguro documentável a quem cumpre. Fonte:
https://www2.camara.leg.br/a-camara/estruturaadm/gestao-na-camara-dos-deputados/responsabilidade-social-e-ambiental/acessibilidade/pdfs/ABNTNBR17225AcessibilidadeDigitalparaWeb.pdf

**Decreto 5.296/2004, arts. 47–48.** Obriga acessibilidade em portais da **administração pública** (prazo de 12 meses)
e a torna requisito para financiamento público em sítios de interesse público. Não alcança o site comercial privado —
essa obrigação vem do art. 63 da LBI. Fonte: https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/decreto/d5296.htm

**eMAG 3.1 (abril/2014).** Obrigatório para a Administração Pública Federal (Portaria nº 3 de 07/05/2007): **45
recomendações** em 6 seções, **sem níveis A/AA/AAA**, validador oficial ASES. Ancorado na WCAG 2.0, é defasado (não
cobre reflow, espaçamento de texto, alvo de 24 px, autenticação acessível) — use WCAG 2.2 AA / NBR 17225 como alvo
técnico e o eMAG como requisito formal adicional **quando o cliente for governo**. Fonte: https://emag.governoeletronico.gov.br/

**Se houver app móvel**, some a **ABNT NBR 17060:2022** (26/10/2022, **54 requisitos** em 4 categorias), que cobre app
nativo, WebApp, híbrido e site acessado por dispositivo móvel — https://cta.ifrs.edu.br/abnt-nbr-17060-2022-acessibilidade-em-aplicativos-de-dispositivos-moveis-requisitos/

**O que obriga na prática um site comercial brasileiro:** alvo técnico **WCAG 2.2 nível AA**, materializado como
Conformidade Regular da NBR 17225:2025.

**Qual é o risco real.** A LBI **não** cria multa administrativa específica para site inacessível. A exposição vem por
três vias: (a) **art. 88 da LBI** — discriminação por deficiência é crime, reclusão de 1 a 3 anos e multa, **aumentada
para 2 a 5 anos** quando praticada por meio de comunicação social ou publicação de qualquer natureza; (b) **ação civil
pública** do MP ou de associações, com obrigação de fazer e astreintes — é a via mais provável e a mais cara; (c)
**ação individual de dano moral** com base no CDC combinado com a LBI. Para fornecedor de governo, some inabilitação e
descumprimento contratual. Se a empresa vende para a UE, o **European Accessibility Act** se aplica desde
**28/06/2025** independentemente de ela ser brasileira — o que importa é o mercado atendido. Fonte:
https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm

## 5. WhatsApp como CTA

**Por que é legítimo aqui.** Opinion Box, junho/2025, 1.126 usuários de WhatsApp 18+, margem de erro 2,9 p.p.: **97%**
acessam ao menos uma vez por dia · **82%** se comunicam com marcas pelo app · 75% tiram dúvidas · 69% consideram
excelente canal com empresas · 60% já compraram por ali · **59% não gostam de resposta automática** · 51% não se
incomodam com anúncios se forneceram o número. Fonte: https://blog.opinionbox.com/pesquisa-whatsapp-no-brasil/

**Quando funciona melhor que formulário:** serviço local cuja decisão exige negociação, orçamento ou agendamento — o
formulário obriga o usuário a formular tudo antes e esperar sem prazo. **Quando o formulário ainda ganha:** quando você
precisa de dado estruturado para roteamento, quando o volume exige triagem, ou quando não há quem responda.

**Implementação:**
- Link `https://wa.me/55DDNNNNNNNNN?text=<mensagem>` — número internacional, sem símbolos.
- **Mensagem pré-preenchida contextual e por página:** `?text=Olá! Vim pela página de Pneu Aro 15 e quero saber o
  preço para meu Onix 2019`. É message match dentro do WhatsApp e dá contexto imediato ao vendedor. Mensagem genérica
  joga fora o único dado gratuito que a página tinha.
- Botão flutuante **e** CTA inline em cada seção de decisão; alvo de toque ≥ 48×48 px.
- **Horário de atendimento declarado perto do botão** — reduz ansiedade e evita lead frustrado.
- Informe na página a finalidade do tratamento do número (LGPD).

**A armadilha.** O clique em `wa.me` sai do site e **some do funil**: o lead não entra no CRM, não tem origem de
campanha, não tem atribuição. Você conclui que "a página não converteu" quando ela converteu e o dado evaporou.
Instrumente: evento GA4 no clique (`generate_lead` ou customizado) disparado antes da navegação; origem embutida no
próprio texto pré-preenchido; um número por campanha quando o volume justificar; e reconciliação periódica entre
cliques medidos e conversas registradas — a diferença é a perda.

**Duas ressalvas.** (1) **O bot mata o ganho** — 59% não gostam de resposta automática; um fluxo de 6 etapas anula a
vantagem do canal. (2) **O gargalo real está fora da página** — a conversão depende do tempo de resposta do vendedor,
não do design do botão.

⚠️ **Evidência a não citar:** "WhatsApp converte 6x mais que e-commerce" (Chat Commerce Report 2025) é dado de
fornecedor de plataforma, sem metodologia publicada, sem intervalo de confiança e com incentivo comercial evidente.
Fonte (do que **não** citar):
https://www.ecommercebrasil.com.br/noticias/whatsapp-converte-6x-mais-que-e-commerce-aponta-chat-commerce-report-2025

## 6. Clique-para-ligar em mobile

Para varejo local — oficina, autocenter, revenda, loja de bairro — a ligação é canal de alta intenção e frequentemente
de maior ticket.

| Achado (setor automotivo) | Fonte primária |
|---|---|
| Quem liga converte **30% mais rápido** que lead web | Forrester |
| Retenção de quem liga **28% maior** | Forrester |

| **61% dos compradores** de veículo contatam a concessionária **ligando** após a busca | LSA |
| **60%** dos que buscam veículo em mobile ligariam por extensão de chamada | Google |

| **23,5%** dos leads sem follow-up em 24 h; **13,3% nunca entram no CRM** | LLCBuddy |

Fonte da compilação: Invoca — https://www.invoca.com/blog/automotive-marketing-statistics

⚠️ **Ressalva:** compilação de fornecedor de rastreamento de chamadas — empresa cuja receita depende de convencer o
mercado de que ligações importam. As fontes primárias são credíveis, mas os números são **americanos e de anos
variados**. Direcional, não meta brasileira.

**A implicação mais acionável:** 23,5% sem follow-up em 24 h + 13,3% que nunca chegam ao CRM significam que, na média
do setor, **cerca de um terço do investimento em lead é desperdiçado depois da página**. Nenhuma otimização de
interface compensa isso, e é o maior ROI disponível a custo zero de desenvolvimento.

**Implementação:** `<a href="tel:+5511999999999">` com alvo ≥ 48×48 px; telefone **visível e fixo no header em
mobile**, não escondido no rodapé; clique rastreado como evento GA4; número de call tracking quando houver mídia paga
relevante; horário de atendimento junto ao número.

## 7. Sinais de confiança locais

- **CNPJ, razão social e endereço completo no rodapé** — além do efeito de credibilidade, é exigência do **Decreto
  7.962/2013** para comércio eletrônico.
- **Endereço + mapa incorporado + referência de bairro** ("ao lado do posto X"): responde a pergunta que o visitante
  realmente tem — dá para ir hoje?
- **Avaliações do Google Business Profile embutidas.** A NN/g mediu que usuários **insistem em recomendações
  externas**; depoimento hospedado pela própria empresa é tratado com ceticismo. Um review real do Google vale mais
  que dez depoimentos que a agência escreveu.
- **Nota do Reclame Aqui** e link ao perfil, quando favorável. Pesquisa da plataforma com ~2.300 usuários
  (19–20/02/2025): **81,54%** leem reviews antes de comprar, 53% confiam na opinião de outros, 72,29% deixariam de
  comprar de marca que não valoriza sua opinião. Fonte:
  https://blog.reclameaqui.com.br/varejo-consumidores-leem-reviews-antes-de-comprar/
⚠️ A amostra são **usuários do Reclame Aqui** — o público mais propenso do país a consultar reputação. O número da
população geral é quase certamente menor: indicativo, não estatística nacional.
- **Política de troca, garantia e prazo acessíveis antes do formulário**, não no rodapé; **preço e prazo de execução
  claros**; **responsável técnico** quando aplicável.
- **Foto real da fachada, da oficina e da equipe**, com nomes e tempo de casa; **marcas trabalhadas** (Michelin,
  Bosch, Pirelli) como autoridade emprestada legítima.

**Por que foto de banco genérica destrói confiança em negócio local.** A NN/g é explícita: imagem genérica de banco é
**descartada como enchimento** — o usuário aprendeu a ignorá-la, então ela consome o espaço mais valioso da página sem
entregar informação. Em negócio local o dano vai além da neutralidade: o visitante está tentando responder "essa
empresa existe de verdade e fica perto de mim?", e uma foto de mecânico sorridente que ele já viu em outro site
responde o contrário. **Foto ruim da loja real vence foto boa de loja genérica.**

**Sobre selos.** Em estudos quantitativos da Baymard (2013–2023), **selos de confiança** (legitimidade do negócio)
superaram **selos de SSL** (criptografia), com o Norton dominando o reconhecimento; e um **selo caseiro inventado teve
desempenho significativamente melhor que selos SSL de fornecedores estabelecidos**, exceto o Norton — o efeito é de
reconhecimento de marca e robustez visual, não de verificação real. Fonte: https://baymard.com/blog/perceived-security-of-payment-form

⚠️ Isso **não autoriza** usar selo falso: é publicidade enganosa (CDC art. 37, §1º). Use os selos que a empresa de
fato possui e maximize a legibilidade visual deles.

**Prova social real × fabricada.** Real: avaliação verificável em plataforma de terceiro, vídeo com nome e rosto, foto
de serviço executado na própria oficina. Fabricada: depoimento com foto de banco, contador de "37 pessoas vendo agora"
que é `Math.random()`, "10.000 clientes satisfeitos" sem base — review falso é publicidade enganosa (CDC art. 37) e
concorrência desleal, com atuação do CONAR sobre conteúdo comercial (https://www.conar.org.br/).

## 8. Benchmark de mesmo mercado — Nuvemshop

O caso mais forte para audiência brasileira: **mesmo mercado, mesmo perfil de dispositivo, mesmo tipo de e-commerce**.

| Métrica | Resultado |
|---|---|
| LCP | **+68%** (aprovação **57% → 96%**) |
| Aprovação em todos os CWV | **48% → 72%** |
| Conversão sessão → pedido pago | **+8,9%** |
| Engajamento no carrinho | **+8,4%** (mobile, orgânico Google) |

Fonte: web.dev, Nuvemshop case study — https://web.dev/case-studies/nuvemshop

**A causa raiz técnica não era peso de imagem** nem latência de servidor. Eram três coisas:
1. **Transições CSS na primeira seção** atrasando a detecção do elemento LCP pelo navegador.
2. **`loading="lazy"` acima da dobra** — atributo certo no lugar errado.
3. **Ausência de `fetchpriority="high"`** no recurso LCP.

O achado transferível: em site brasileiro lento, verifique **descoberta e prioridade do recurso LCP** antes de partir
para compressão de imagem. O ganho de 68% veio de três correções que não mudam um único byte de imagem.

**Para calibrar:** Vodafone, LCP 31% melhor → **+8% em vendas** (teste A/B controlado, ~100 mil cliques/dia por versão,
sem mudança visual — a evidência causal mais forte disponível): https://web.dev/case-studies/vodafone. Deloitte/Google,
37 marcas e 30+ milhões de sessões: **0,1 s** → **+8,4%** em conversão de varejo e **+21,6%** em envio de formulário em
geração de leads — ⚠️ **observacional**, não A/B: https://web.dev/case-studies/milliseconds-make-millions

⚠️ **Não cite** Amazon "100 ms = 1% de receita" nem Walmart "1 s = +2% conversão" — 2006–2012, apresentados em
conferência, sem publicação primária verificável: folclore da indústria.

## 9. Varejo automotivo brasileiro

> **Nota de evidência:** os benchmarks abaixo têm fonte. As listas de §9.3 e §9.4 são **julgamento
> aplicado, sem estudo específico** — derivadas dos princípios acima e do padrão do nicho, não de
> pesquisa publicada sobre autocenters brasileiros. Apresente como recomendação fundamentada, não
> como achado medido.

**Os números que existem.** E-commerce, setor "Cars and Motorcycling": **1,82%** de conversão contra média geral de
**2,26%** (julho/2026) — o setor converte **abaixo** da média (ciclo mais longo, ticket maior, mais comparação); um
cliente de autopeças a 1,5% não está falhando, está na faixa. ⚠️ Amostra predominantemente UK/EU: ordem de grandeza,
não meta brasileira. Fonte: https://www.irpcommerce.com/ecommercemarketdata.aspx

Em landing pages, a categoria automotiva **não aparece** no recorte da Unbounce (41.000+ páginas); a referência mais
próxima é **Serviços Profissionais — mediana 6,1%, p75 14,1%**, mesma mecânica de serviço local com lead. Use como
aproximação **declarada**. ⚠️ LPs Unbounce são majoritariamente de tráfego pago segmentado — comparar com site
institucional de tráfego orgânico frio é comparar coisas diferentes.
Fonte: https://unbounce.com/landing-pages/whats-a-good-conversion-rate/

**Mobile é onde a batalha acontece:** 75% das visitas são mobile e a conversão mobile (2,8%) é menor que a desktop
(3,2%) — otimize primeiro em mobile, com o polegar, em 4G.
Fonte: https://www.smartinsights.com/ecommerce/ecommerce-analytics/ecommerce-conversion-rates/

**Message match — o argumento que independe de estudo de conversão.** O Google declara que landing page experience é um
dos três componentes do Índice de Qualidade e lista "consistência de mensagem" entre os fatores: message match ruim
degrada a landing page experience → degrada o Índice de Qualidade → **aumenta o CPC e reduz a posição do anúncio**. É o
mecanismo declarado do leilão, não hipótese de CRO. Fonte: https://support.google.com/google-ads/answer/6167130
⚠️ A literatura de CRO sobre "scent" é **conceitual e ilustrativa, não empírica** — a peça de referência da CXL mostra
11 exemplos sem uma métrica de lift publicada (https://cxl.com/blog/give-your-advertising-roi-a-serious-boost-by-maintaining-scent/);
não diga "quebra de message match destrói conversão em X%". Na prática, ao nível da literalidade: anúncio "Pneu Aro 15
a partir de R$ 289 — Autocenter X, Campinas" → hero "Pneu Aro 15 a partir de R$ 289". **Uma LP por grupo de anúncios.**

### 9.3 O que a página de um autocenter, autopeças ou revenda de pneu precisa ter

*(julgamento aplicado, sem estudo específico)*

- **Serviço e preço-âncora no hero, com cidade ou bairro** — "Alinhamento e balanceamento a partir de R$ X — Santa
  Bárbara d'Oeste", não "Excelência em serviços automotivos".
- **Seletor por veículo (marca/modelo/ano)** em vez de pedir a medida do pneu ou o código da peça. O usuário no
  semáforo não tem o chassi à mão; ele tem o carro.
- **Prazo de execução e disponibilidade** — "fica pronto no mesmo dia", "peça em estoque", "agenda para amanhã às 8h".
  É o dado que decide, e quase nenhuma página traz.
- **Endereço, mapa, referência de bairro e horário**, incluindo sábado.
- **WhatsApp com mensagem pré-preenchida daquele serviço** e telefone clicável fixo no header mobile.
- **Marcas e linhas trabalhadas com o nível** (premium × entrada) — o cliente compara marca de peça antes de comparar
  loja.
- **Garantia declarada em número:** "90 dias de garantia no serviço", "3 anos na bateria".
- **Formas de pagamento e parcelamento**, inclusive Pix e o teto de parcelas sem juros.
- **Fotos reais da oficina, dos equipamentos e da equipe**; avaliações do Google embutidas; CNPJ e endereço no rodapé.
- **Formulário mínimo viável: nome + WhatsApp.** Some um campo por vez, e só quando ele melhora o atendimento
  (modelo/ano, serviço desejado) — nunca por curiosidade do CRM. Não peça CPF, endereço completo, "como conheceu a
  gente" ou data de nascimento: puro atrito e exposição LGPD.
⚠️ **Ressalva que muda a decisão:** menos campos gera **mais leads e leads piores**. A métrica que importa para um
autocenter não é lead — é **agendamento comparecido**; otimizar formulário sem medir isso pode piorar o negócio do
cliente enquanto melhora o gráfico. A evidência também não é unânime: HubSpot (40.000 LPs) e Eloqua (1.500 LPs)
mostram correlação negativa clara, mas a Unbounce encontrou pico com 1 campo, queda entre 3 e 7 e **volta a subir**
depois — 10 campos às vezes superando 3. Fonte:
https://www.cobloom.com/blog/form-fields-and-conversion-rates-is-less-really-more

### 9.4 O que costuma faltar

*(julgamento aplicado, sem estudo específico)*

1. **Preço.** A página fala de qualidade e não diz quanto custa nem "a partir de". O usuário sai para pedir preço no
   WhatsApp do concorrente que publicou.
2. **Prazo.** Nenhuma indicação de duração do serviço ou vaga na agenda.
3. **Endereço no lugar certo.** Só no rodapé, quando é o segundo dado mais decisivo depois do preço em negócio de raio
   geográfico.
4. **Uma página por serviço.** Home genérica recebendo o tráfego de três campanhas e quebrando o message match de
   todas.
5. **Foto real.** Banco de imagem no lugar da fachada que o cliente vai procurar na rua.
6. **Rastreio do clique de WhatsApp.** O canal principal de conversão fora do funil.
7. **Prova externa.** Depoimentos escritos pela agência em vez das avaliações reais do Google.
8. **Mobile de verdade.** Página desenhada, testada e aprovada no desktop para um público 3 em 4 mobile.
9. **Peso.** Carrossel de hero, biblioteca de ícones inteira e três scripts de terceiro num público de Android de
   entrada.
10. **Continuidade depois do clique.** O lead chega e ninguém responde em 24 h — e nenhuma correção de interface
    conserta isso.

*Números verificados em agosto de 2026. Normas (NBR 17225, NBR 17060), guias da ANPD, edições do Web Almanac e casos
do web.dev mudam — reverifique antes de citar se tiverem passado mais de seis meses.*
