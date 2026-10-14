# 10 — Antipadrões de design gerado por IA

Lista nomeada dos sinais visuais e de conteúdo que denunciam uma página gerada por IA. O objetivo é reconhecê-los para
não produzi-los: nenhum item aqui é errado em si — cada um é a **escolha default** que o modelo faz quando não tem
informação real sobre o negócio, e é a acumulação deles que faz a página parecer template.

## Índice

- [Por que isto importa](#por-que-isto-importa) · [Como ler cada item](#como-ler-cada-item)
- **Visual e cor (1–5):** paleta creme + serifada + terracota · gradiente roxo-azul · glassmorphism sem razão · blob
  desfocado no hero · raio e sombra uniformes
- **Layout e ritmo (6–10):** três cards SaaS idênticos · três benefícios simétricos · espaçamento uniformemente
  generoso · hero centralizado padrão · fade-up em todo elemento
- **Tipografia e microdetalhe (11–15):** eyebrow ALL-CAPS · seta "→" colada no botão · emoji como ícone · ícone de
  linha genérico · cinza claro como texto secundário
- **Conteúdo (16–23):** headline genérica · texto de preenchimento · tríade de adjetivos · ilustração isométrica de
  stock · depoimento sintético · números redondos de vaidade · FAQ que ninguém perguntou · CTA sem destino
- [O teste do específico](#o-teste-do-específico)

## Por que isto importa

**Aparência visual responde por 46,1% dos comentários de credibilidade.** No estudo de Fogg et al. (2002), com 2.684
participantes e 2.440 comentários codificados, "design look" foi o fator mais citado — acima de estrutura da
informação (28,5%), foco (25,1%) e acurácia (14,3%). E houve descompasso entre o que as pessoas dizem usar (política
de privacidade, identidade) e o que de fato usam: a aparência.
Fonte: Fogg et al., *How Do People Evaluate a Web Site's Credibility?* —
https://credibility.stanford.edu/pdf/How_Do_People_Evaluate_a_Web_Site's_Credibility_v37.pdf

Uma página que "parece IA" não é só feia — ela lê como **página que qualquer um poderia ter feito**, e portanto como
empresa que qualquer um poderia ser. Em negócio local e de alto risco percebido, isso é caro.

**A geração assistida também piora a plataforma medida.** Complexidade média de home page subiu **22,5% em um ano**,
para **1.437 elementos**; erros de acessibilidade detectados subiram **10,1%** (56,1 por página); uso de ARIA cresceu
**27%**, e páginas **com** ARIA têm **59,1 erros** contra **42** nas sem. Mais DOM, mais ARIA e mais JS são exatamente
os vetores que degradam INP e acessibilidade.
Fonte: WebAIM Million 2026 — https://webaim.org/projects/million/ Fonte: HTTP Archive Web Almanac 2025 —
https://almanac.httparchive.org/en/2025/performance

**E os próprios desenvolvedores dizem que a IA ainda erra aqui:** no State of CSS 2026, só **26%** escrevem CSS
totalmente sem IA, mas a **mediana de código gerado por IA é 13%** — a adoção é ampla e rasa, e o comentário
recorrente é que a IA "ainda não é boa em CSS".
Fonte: State of CSS 2026 — https://2026.stateofcss.com/en-US/usage/

## Como ler cada item

Cada entrada traz: **como aparece**, **por que denuncia IA** e a **alternativa concreta**. A linha *Evidência* diz de
onde vem a afirmação. Onde não existe estudo, está escrito **"julgamento aplicado, sem estudo específico"** — quatro
dos itens (1, 6, 11 e 12) vêm de um catálogo de *tells* publicado; o restante é padrão observado, e deve ser
apresentado como tal.

### 1. Paleta creme + serifada + acento terracota

**Como aparece:** fundo creme quente (na faixa de `#F4F1EA`), título em serifada elegante, um único acento
terracota/salmão (na faixa de `#D97757`), tudo com cara de estúdio de branding.
**Por que denuncia IA:** é o *default* estético mais reproduzido por modelos de geração hoje. A combinação não sai de
uma marca — sai de um centroide de "bom gosto" aprendido, e por isso aparece idêntica em páginas de nichos que não têm
nada em comum.
**Alternativa:** derive a paleta da marca real (logo, fachada, uniforme, embalagem do produto que a loja vende) ou de
uma decisão declarada de contraste, e justifique o acento por função — o que ele marca, e por que só ele. Se a marca
não tem cor, escolha uma e diga por quê; não herde a do modelo.
**Evidência:** catálogo de *tells* de design gerado por IA da skill `frontend-design` —
https://github.com/anthropics/skills

### 2. Gradiente roxo-azul genérico

**Como aparece:** `linear-gradient(135deg, #6366F1, #8B5CF6)` no hero, no botão, no ícone e no card de preço.
Frequentemente com um segundo gradiente violeta-rosa no rodapé.
**Por que denuncia IA:** é a cor default de "tecnologia" desde 2019, e o modelo a aplica em oficina mecânica, clínica
e escritório de advocacia com a mesma convicção. Também costuma vir com contraste insuficiente do texto branco sobre a
parte clara do gradiente.
**Alternativa:** cor sólida da marca. Se quiser profundidade, use variação de luminosidade da mesma matiz (uma rampa
em OKLCH), não uma segunda matiz emprestada. Gradiente vale quando comunica alguma coisa — progresso, faixa, estado —
não como textura de fundo.
**Evidência:** julgamento aplicado, sem estudo específico.

### 3. Glassmorphism aplicado sem razão

**Como aparece:** `backdrop-filter: blur()` com fundo semitransparente e borda branca de 1px em cards, header e modais
— sobre um fundo que não tem nada atrás para ser desfocado.
**Por que denuncia IA:** o efeito só faz sentido quando há profundidade real (camada sobre conteúdo que continua
visível e em movimento). Aplicado sobre cor chapada, produz apenas contraste pior e custo de composição em GPU fraca —
que é exatamente o dispositivo do público brasileiro.
**Alternativa:** hierarquia por elevação simples (fundo, borda sutil, sombra curta) ou por espaço. Se usar vidro, use
onde há sobreposição real e verifique o contraste do texto **sobre a pior parte** do fundo, não sobre a média.
**Evidência:** julgamento aplicado, sem estudo específico.

### 4. Blob desfocado atrás do hero

**Como aparece:** duas ou três manchas coloridas com `filter: blur(120px)` posicionadas em absoluto atrás do título,
às vezes animadas em loop lento.
**Por que denuncia IA:** decoração pura, sem relação com o conteúdo, presente em toda página SaaS de template desde
2021. Custa pintura e composição em cada frame e é a primeira coisa a engasgar em Android de entrada.
**Alternativa:** se o hero precisa de interesse visual, use a **foto real** do produto, da loja, da equipe ou do
serviço sendo executado. Ela informa e decora ao mesmo tempo — o blob só decora.
**Evidência:** julgamento aplicado, sem estudo específico.

### 5. Raio e sombra uniformes em tudo

**Como aparece:** `border-radius: 16px` e a mesma sombra suave em card, botão, input, imagem, badge e seção inteira.
**Por que denuncia IA:** elevação é linguagem — quando tudo está elevado igual, nada está elevado. O modelo aplica o
token de decoração indiscriminadamente porque não tem um mapa de qual elemento está em qual camada.
**Alternativa:** defina 3 níveis de elevação com papel declarado (base, elevado, sobreposto) e um raio por classe de
componente (controle pequeno, card, container). Elementos na mesma camada compartilham raio e sombra; elementos em
camadas diferentes, não.
**Evidência:** julgamento aplicado, sem estudo específico.

### 6. Três cards SaaS idênticos, sem conteúdo real

**Como aparece:** grade de três cards com ícone no topo, título de duas palavras, dois parágrafos de tamanho idêntico
e um link "Saiba mais" — e os três descrevem a mesma coisa em palavras diferentes.
**Por que denuncia IA:** o número três e a simetria perfeita são o resultado de preencher um layout, não de organizar
conteúdo. Conteúdo real quase nunca vem em três blocos de tamanho igual.
**Alternativa:** escreva o conteúdo primeiro e deixe o layout ser assimétrico. Se há quatro serviços com pesos
diferentes, mostre quatro com pesos diferentes — o principal maior, com foto e preço; os outros como lista. A
desigualdade é a informação.
**Evidência:** catálogo de *tells* da skill `frontend-design` — https://github.com/anthropics/skills

### 7. Três benefícios simétricos sem hierarquia

**Como aparece:** "Rapidez · Qualidade · Confiança", três colunas, mesmo peso tipográfico, mesmo ícone genérico, mesma
altura.
**Por que denuncia IA:** é a versão textual do item 6. Nenhum negócio real tem três benefícios de importância
exatamente igual; há sempre um que fecha a venda.
**Alternativa:** identifique **o** benefício decisivo e dê a ele o dobro do espaço, com prova junto (número, foto,
garantia, prazo). Os demais viram apoio. Hierarquia funciona por contraste em eixos independentes — tamanho, peso,
cor, espaço —, e a regra é usar **dois eixos, não cinco**: um bloco maior, mais pesado, mais escuro, mais espaçado *e*
em outra família não comunica cinco vezes mais, comunica ruído.
**Evidência:** julgamento aplicado quanto à assimetria; a regra dos dois eixos é prática consolidada de tipografia
editorial, sem estudo controlado citável.

### 8. Espaçamento uniformemente generoso, sem ritmo

**Como aparece:** `py-24` (ou 96–120px) entre todas as seções, `gap` idêntico dentro e fora dos grupos, tudo
respirando igual do topo ao rodapé.
**Por que denuncia IA:** **tudo respirando igual = nada tem ênfase.** Espaço é o instrumento mais barato de
hierarquia, e usá-lo de forma constante equivale a falar tudo no mesmo tom de voz. Também quebra o agrupamento: o
princípio de Gestalt da proximidade é o mais forte e **vence cor, borda e caixa** — quando o espaço interno de um
bloco é igual ao externo, o usuário agrupa errado. A falha clássica é o rótulo equidistante do campo de cima e do de
baixo.
**Alternativa:** escala de espaçamento restrita (base 4/8) com uma regra explícita: **espaço interno ≤ espaço
externo**. Se o padding do card é 16, o gap entre cards é ≥ 16. Varie o espaço **entre** seções conforme a importância
— a seção que fecha a venda pode ter mais respiro que a de rodapé, e duas seções muito relacionadas podem ter menos.
**Evidência:** proximidade como princípio de agrupamento é consolidado na literatura de Gestalt aplicada a interface;
a aplicação a "ritmo de página" aqui é julgamento aplicado, sem estudo específico.

### 9. Hero centralizado padrão

**Como aparece:** eyebrow, título centralizado em 3 linhas, subtítulo centralizado em 2, dois botões lado a lado (um
sólido, um fantasma), tudo em coluna única no meio da tela.
**Por que denuncia IA:** é a composição de menor risco e de menor informação. Não erra e não diz nada; e centralizar
texto longo piora a leitura porque cada linha começa numa posição diferente.
**Alternativa:** alinhe à esquerda quando houver mais de duas linhas, e ponha ao lado do texto a prova visual concreta
— foto do serviço, do produto ou da loja. Um CTA primário, não dois com peso parecido. O segundo botão vira link de
texto.
**Evidência:** julgamento aplicado, sem estudo específico.

### 10. Animação de entrada em todo elemento

**Como aparece:** cada seção com `fade-up` ao entrar na viewport, 600 ms, stagger de 100 ms, via biblioteca de scroll.
**Por que denuncia IA:** movimento sem significado. Atrasa a leitura do conteúdo que já está na tela, custa JS de
observação e frequentemente atrasa a detecção do elemento LCP — o mesmo mecanismo que transições CSS no topo da página
têm de arruinar o LCP.
**Alternativa:** anime **mudança de estado** (abriu, fechou, selecionou, carregou), não a chegada do conteúdo. Se
quiser entrada, use uma só, na primeira dobra, curta, e respeite `prefers-reduced-motion`.
**Evidência:** julgamento aplicado quanto ao excesso; o efeito de transições CSS no topo sobre a detecção do LCP está
documentado no estudo de caso da Nuvemshop — https://web.dev/case-studies/nuvemshop

### 11. Eyebrow em ALL-CAPS acima de todo título

**Como aparece:** `NOSSOS SERVIÇOS`, `POR QUE NOS ESCOLHER`, `DEPOIMENTOS` — pequeno, espaçado, colorido, acima de
cada `<h2>` da página.
**Por que denuncia IA:** vira maneirismo quando é sistemático. O eyebrow existe para categorizar um conteúdo dentro de
um contexto ambíguo; repetido em toda seção, ele só adiciona uma linha de ruído que ninguém lê. Caixa alta também
reduz a velocidade de leitura por eliminar a silhueta da palavra.
**Alternativa:** deixe o `<h2>` fazer o trabalho. Se a seção precisa de contexto, ponha-o **dentro** do título ou numa
linha de apoio abaixo, em caixa normal. Use eyebrow no máximo uma vez por página, e só quando ele carrega informação
real (categoria, etapa, data).
**Evidência:** catálogo de *tells* da skill `frontend-design` — https://github.com/anthropics/skills

### 12. Seta "→" colada no texto do botão

**Como aparece:** `Comece agora →`, `Saiba mais →`, `Fale conosco →` — a seta como caractere dentro do rótulo, em
todos os botões e links da página.
**Por que denuncia IA:** é o tique de escrita de interface mais reproduzido por modelos. A seta como glifo textual
entra no nome acessível do botão (o leitor de tela anuncia o símbolo ou o ignora de forma inconsistente), não se
alinha opticamente com a linha de base e não sobrevive a tradução.
**Alternativa:** o rótulo diz a ação com verbo específico ("Pedir orçamento no WhatsApp", "Ver preços de pneu aro
15"). Se a direção importa visualmente, use um ícone SVG com `aria-hidden="true"`, separado do texto, e só em links de
navegação sequencial — não em todo botão.
**Evidência:** catálogo de *tells* da skill `frontend-design` — https://github.com/anthropics/skills

### 13. Emoji como ícone de seção

**Como aparece:** 🚀 em "Velocidade", 🔒 em "Segurança", ✅ nos itens de lista, 💡 na caixa de dica. **Por que denuncia
IA:** emoji é o ícone de quem não tem biblioteca de ícones nem tempo de escolher um. Além do registro informal
indesejado em contexto comercial, o leitor de tela lê o nome completo do emoji no meio da frase ("foguete"), e o
desenho muda entre sistemas — o mesmo item aparece diferente para cada visitante.
**Alternativa:** conjunto de ícones SVG coerente (um só peso de traço), com `aria-hidden="true"` quando decorativo e
rótulo textual sempre presente. Em lista de benefícios, um marcador simples funciona melhor que um emoji por item.
**Evidência:** julgamento aplicado quanto ao sinal de IA; o comportamento de leitor de tela e a variação de
renderização entre plataformas são propriedades conhecidas do padrão Unicode.

### 14. Ícone de linha genérico para tudo

**Como aparece:** o mesmo ícone de "engrenagem", "escudo" e "relógio" da mesma biblioteca, um por card, sem relação
com o serviço descrito.
**Por que denuncia IA:** o ícone foi escolhido pela palavra do título, não pelo conteúdo. Em página de autocenter,
"engrenagem" para alinhamento e "escudo" para garantia não informam nada que o texto já não diga.
**Alternativa:** foto do serviço real no lugar do ícone, ou nenhum ícone. Ícone se justifica quando precisa ser
reconhecido rapidamente e repetidamente (navegação, status, ação em tabela), não quando enfeita um parágrafo que já
tem título.
**Evidência:** julgamento aplicado, sem estudo específico.

### 15. Cinza claro como cor de texto secundário

**Como aparece:** `#9AA0A6` ou `text-gray-400` em subtítulos, legendas, rótulos de formulário e rodapé, porque "fica
mais elegante".
**Por que denuncia IA:** o modelo otimiza a aparência na tela em que renderiza, não o contraste medido. É o achado
mais comum de auditoria e um dos erros mais prevalentes da web medida.
**Alternativa:** meça. Texto normal precisa de **4,5:1** e texto grande de **3:1** contra o fundo real; hierarquia
secundária se faz com **tamanho e peso**, não rebaixando o contraste. Em página brasileira acessada sob sol direto, o
custo do cinza claro é maior que a elegância que ele compra.
**Evidência:** limiares de contraste da WCAG 2.2 — https://www.w3.org/WAI/WCAG22/quickref/ · prevalência medida em
WebAIM Million 2026 — https://webaim.org/projects/million/

### 16. Headline genérica

**Como aparece:** "Transforme seu negócio", "Soluções inteligentes para o seu dia a dia", "Excelência em cada
detalhe", "A parceria que você precisa".
**Por que denuncia IA:** a frase cabe em qualquer empresa de qualquer setor. É o que um modelo escreve quando não sabe
o que a empresa vende — e é exatamente a informação que o visitante veio buscar. Some a isso que só **20–28% das
palavras** de uma página são lidas numa visita média: se a headline não diz o que é, a chance de o resto salvar é
pequena.
**Alternativa:** a headline nomeia o produto, o serviço, o preço-âncora, o prazo ou o lugar — de preferência mais de
um. "Pneu aro 15 a partir de R$ 289, montado no mesmo dia — Campinas" é uma headline que nenhum concorrente pode
copiar sem mentir.
**Evidência:** proporção de texto lido — NN/g, *How Little Do Users Read?* (reanálise de 45.237 visualizações de
página) — https://www.nngroup.com/articles/how-little-do-users-read/ · a classificação como *tell* de IA é julgamento
aplicado.

### 17. Texto de preenchimento que não diz nada do negócio

**Como aparece:** "Combinamos tecnologia de ponta e atendimento humanizado para entregar resultados que superam
expectativas, com foco total na sua satisfação."
**Por que denuncia IA:** parágrafo estruturalmente correto e informacionalmente vazio — nenhum número, nenhum nome,
nenhum prazo, nenhuma restrição. É o preenchimento que sobra quando o briefing não trouxe fato nenhum.
**Alternativa:** escreva em pirâmide invertida (conclusão primeiro) e substitua cada adjetivo por um fato verificável:
"Atendemos de segunda a sábado; alinhamento fica pronto em 40 minutos; garantia de 90 dias". Se você não tem o fato,
pergunte ao cliente em vez de preencher.
**Evidência:** a pirâmide invertida é recomendação da NN/g para conteúdo web escaneado —
https://www.nngroup.com/articles/how-little-do-users-read/ · a classificação como *tell* é julgamento aplicado.

### 18. Tríade de adjetivos

**Como aparece:** "Rápido, seguro e confiável." "Simples, moderno e eficiente." Sempre três, sempre no mesmo ritmo,
muitas vezes três vezes na mesma página.
**Por que denuncia IA:** a cadência tripla é um tique de geração de texto. Três adjetivos abstratos somam menos que um
substantivo concreto, e o leitor não consegue distinguir a empresa da concorrente que usa os mesmos três.
**Alternativa:** um atributo, com prova. "Fica pronto no mesmo dia" vale mais que "rápido, ágil e pontual".
**Evidência:** julgamento aplicado, sem estudo específico.

### 19. Ilustração isométrica genérica de stock

**Como aparece:** cena isométrica de pessoas roxas e azuis mexendo em telas gigantes, ou a foto de banco do
profissional sorridente de braços cruzados.
**Por que denuncia IA:** o usuário já viu essa imagem em dezenas de sites e aprendeu a ignorá-la. A NN/g mediu
diretamente: **imagens genéricas de banco são descartadas como enchimento**, não tratadas como evidência. Em negócio
local o dano é maior, porque o visitante está tentando confirmar que a empresa existe fisicamente.
**Alternativa:** foto real, mesmo imperfeita — fachada, oficina, equipe com nome, serviço sendo executado, produto que
a loja realmente vende. Foto ruim do lugar real vence foto boa de lugar genérico.
**Evidência:** NN/g, *Trustworthiness in Web Design: 4 Credibility Factors* —
https://www.nngroup.com/articles/trustworthy-design/

### 20. Depoimento sintético

**Como aparece:** "Maria S., CEO" com foto de banco, cinco estrelas, texto de duas linhas elogiando "o
profissionalismo e a atenção aos detalhes".
**Por que denuncia IA:** depoimento sem nome completo, sem rosto real e sem plataforma verificável tem valor próximo
de zero e consome espaço nobre. A NN/g registra que usuários **insistem em recomendações externas** — depoimento
hospedado pela própria empresa é recebido com ceticismo.
**Alternativa:** avaliações reais do Google Business Profile embutidas, ou vídeo curto com nome e rosto, ou nada. Uma
avaliação externa verificável vale mais que dez depoimentos escritos internamente.
**Evidência:** NN/g, *Trustworthiness in Web Design: 4 Credibility Factors* —
https://www.nngroup.com/articles/trustworthy-design/ · no Brasil, depoimento fabricado é publicidade enganosa (CDC,
art. 37).

### 21. Números redondos de vaidade

**Como aparece:** faixa de estatísticas com "+500 clientes", "10 anos de mercado", "99% de satisfação", "24/7". **Por
que denuncia IA:** números redondos sem fonte são preenchimento de layout. "99% de satisfação" sem base medida é a
versão numérica do adjetivo vazio — e, se for inventado, é publicidade enganosa.
**Alternativa:** número verdadeiro, ímpar, datado e verificável ("1.284 alinhamentos feitos em 2025", "nota 4,7 no
Google com 213 avaliações", "aberto desde 2009"). Se não há número real, corte a seção — ela não está sustentando
nada.
**Evidência:** julgamento aplicado quanto ao *tell*; a vedação a alegação sem lastro é do CDC, art. 37.

### 22. FAQ que ninguém perguntou

**Como aparece:** acordeão com "O que vocês fazem?", "Como funciona o processo?", "Vocês são confiáveis?". **Por que
denuncia IA:** as perguntas foram inferidas da estrutura de uma página, não da caixa de entrada do cliente. Ocupam a
seção que poderia responder às objeções reais que travam a venda.
**Alternativa:** peça ao cliente as cinco perguntas que mais chegam no WhatsApp e responda essas, com número: preço,
prazo, garantia, formas de pagamento, se precisa agendar, se atende o modelo do carro dele. Uma FAQ boa é a
transcrição do atendimento, não uma invenção.
**Evidência:** julgamento aplicado, sem estudo específico.

### 23. CTA sem destino real

**Como aparece:** "Começar agora", "Saiba mais", "Descubra" — repetidos, com `href="#"` ou apontando para a mesma
âncora.
**Por que denuncia IA:** o botão foi escrito para preencher o slot de botão. O rótulo não diz o que acontece depois do
clique, e o usuário paga o custo de descobrir.
**Alternativa:** um CTA primário por página, com verbo e objeto ("Pedir orçamento no WhatsApp", "Agendar troca de
óleo", "Ver preço para o meu carro"), e destino que cumpre exatamente o que o rótulo prometeu.
**Evidência:** julgamento aplicado, sem estudo específico.

## O teste do específico

O teste mais rápido, e o que resume todos os itens acima:

> **Uma página boa contém informação que só aquele negócio poderia ter escrito. Uma página gerada por
> IA contém apenas informação que serviria para qualquer negócio.**

**Como aplicar em 30 segundos:** leia a página inteira e conte quantas afirmações continuam verdadeiras se você trocar
o nome da empresa pelo nome do concorrente. Se a maioria continua verdadeira, a página não é do cliente — é de um
template com o logo dele.

**O que conta como específico** (informação que o concorrente não pode copiar sem mentir):

| Categoria | Exemplo específico | Equivalente genérico a eliminar |
|---|---|---|
| Lugar | "Na Av. Santa Bárbara, ao lado do posto Ipiranga" | "Bem localizados" |
| Preço | "Alinhamento a partir de R$ 89" | "Preço justo" |
| Prazo | "Fica pronto em 40 minutos" | "Agilidade no atendimento" |
| Produto | "Pirelli Cinturato P1 aro 15" | "Trabalhamos com as melhores marcas" |
| Pessoa | "Seu Antônio, mecânico há 22 anos na casa" | "Equipe altamente qualificada" |
| Prova | "4,7 no Google, 213 avaliações" | "Clientes satisfeitos" |
| Garantia | "90 dias de garantia no serviço" | "Compromisso com a qualidade" |
| Restrição | "Não atendemos veículos a diesel" | *(ausente — genérico nunca declara limite)* |

O último item é o mais revelador: **texto genérico nunca diz o que o negócio não faz.** Declarar uma restrição exige
conhecer a operação, e por isso é um dos sinais mais fortes de que a página foi escrita com informação real.

**Se o teste falhar, a correção não é de design.** Não adianta trocar a paleta ou o layout: falta informação. O
caminho é voltar ao cliente com perguntas concretas — preço-âncora, prazo, garantia, bairro, marcas, nomes da equipe,
as cinco perguntas mais frequentes — e reescrever a página sobre os fatos que voltarem. Design bom sobre conteúdo
vazio continua parecendo IA; conteúdo específico salva até um layout medíocre.

*Números verificados em agosto de 2026. WebAIM Million, Web Almanac e as pesquisas State of CSS/JS mudam de edição
anualmente — reverifique antes de citar.*
