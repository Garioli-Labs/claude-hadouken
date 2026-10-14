# Heurísticas, Leis e Limiares — rubrica operacional

Destilação operacional da literatura fundacional de usabilidade. Cada afirmação numérica traz a fonte. Onde a evidência é fraca, contestada ou não verificada em fonte primária, isso está marcado — a marca faz parte da informação.

## Índice

- [1. Escala de severidade 0–4 de Nielsen](#1-escala-de-severidade-04-de-nielsen)
- [2. As 10 heurísticas de Nielsen como rubrica pontuável](#2-as-10-heurísticas-de-nielsen-como-rubrica-pontuável)
- [3. As 8 regras de ouro de Shneiderman](#3-as-8-regras-de-ouro-de-shneiderman)
- [4. Norman — os conceitos que mudam decisão](#4-norman--os-conceitos-que-mudam-decisão)
- [5. Leis de UX — fórmula e limite de aplicação](#5-leis-de-ux--fórmula-e-limite-de-aplicação)
- [6. Limiares de tempo de resposta](#6-limiares-de-tempo-de-resposta)
- [7. Carga cognitiva de Sweller em formulário e navegação](#7-carga-cognitiva-de-sweller-em-formulário-e-navegação)
- [8. O que a literatura desencoraja — com evidência](#8-o-que-a-literatura-desencoraja--com-evidência)
- [9. Erratas — cinco afirmações populares que a fonte não sustenta](#9-erratas--cinco-afirmações-populares-que-a-fonte-não-sustenta)

---

## 1. Escala de severidade 0–4 de Nielsen

A escala do próprio Nielsen para avaliação heurística. É ordinal e serve para priorizar esforço de correção, não para virar nota de prova.

| Grau | Nome | Significado operacional |
|---|---|---|
| **0** | Não é problema | Discordo que isto seja problema de usabilidade |
| **1** | Cosmético | Só corrigir se sobrar tempo no projeto |
| **2** | Menor | Prioridade baixa de correção |
| **3** | Maior | Importante corrigir; prioridade alta |
| **4** | Catástrofe | Imperativo corrigir antes de publicar |

Três fatores determinam o grau, e os três precisam ser declarados junto do achado:

1. **Frequência** — o problema é comum ou raro no uso real?
2. **Impacto** — o usuário supera facilmente ou trava?
3. **Persistência** — é um obstáculo de uma vez só (o usuário aprende e contorna) ou incomoda repetidamente?

Nielsen acrescenta **impacto de mercado**: um problema cosmético que afeta a percepção de qualidade do produto pode merecer grau maior do que a mecânica sugere.

Fonte: Jakob Nielsen, "Severity Ratings for Usability Problems", NN/g, 1994 — https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/

**Nota de confiabilidade:** avaliação heurística é subjetiva por construção. As heurísticas de 1994 vieram de análise fatorial de **249 problemas de usabilidade** — são uma redução estatística de problemas reais, não axiomas. Um único avaliador encontra uma fração dos problemas; a recomendação clássica é de 3 a 5 avaliadores independentes cujos achados são consolidados depois.
Fonte: Jakob Nielsen, "10 Usability Heuristics for User Interface Design", NN/g, 1994/2020 — https://www.nngroup.com/articles/ten-usability-heuristics/

---

## 2. As 10 heurísticas de Nielsen como rubrica pontuável

Formulação atual da NN/g (artigo revisado em 2020; a linguagem mudou, as heurísticas não).
Fonte: NN/g, 1994/2020 — https://www.nngroup.com/articles/ten-usability-heuristics/

### H1 — Visibility of System Status

**O que verificar na página:** todo clique produz reação perceptível em ≤100 ms; operações acima de 1 s têm indicador; operações acima de 10 s têm barra determinada com percentual; o estado atual (página ativa na nav, item selecionado, filtro aplicado, passo do wizard, itens no carrinho) é visível sem interação; envio de formulário mostra progresso e resultado.

**Violações típicas:** botão que não muda de estado ao ser clicado e permite duplo-submit; upload sem barra; filtro aplicado sem chip removível visível; nav sem indicação da página atual; salvamento automático sem confirmação alguma.

**Severidade típica:** 3–4 quando o usuário não sabe se a ação aconteceu (leva a duplo-pagamento, duplo-cadastro); 2 quando é só desconforto.

### H2 — Match Between the System and the Real World

**O que verificar:** rótulos usam o vocabulário do usuário, não o do organograma ou do banco de dados; ordem dos passos segue a lógica do mundo real; ícones e metáforas fazem sentido no contexto cultural pt-BR; formatos (data, moeda, CEP, telefone) são os locais.

**Violações típicas:** "Soluções", "Nosso ecossistema", "Módulo de gestão" como rótulo de menu; erro exibindo `ERR_VALIDATION_402`; data em MM/DD/AAAA; jargão interno na interface pública.

**Severidade típica:** 3 quando o rótulo faz o usuário não encontrar a seção; 2 quando só atrasa.

### H3 — User Control and Freedom

**O que verificar:** existe "saída de emergência" claramente marcada em todo fluxo; ações reversíveis têm undo; ações irreversíveis têm confirmação; o botão voltar do navegador funciona (não quebra estado); modal fecha com Esc e com botão visível; o usuário pode cancelar operação longa.

**Violações típicas:** wizard sem "voltar"; modal sem X; scroll infinito que perde a posição ao voltar; auto-play sem pausa; formulário que apaga tudo no erro.

**Severidade típica:** 4 quando o usuário fica preso ou perde trabalho; 3 quando precisa recomeçar o fluxo.

### H4 — Consistency and Standards

**O que verificar:** o mesmo componente se comporta igual em todas as telas; ordem dos botões de diálogo é a mesma em todo o produto; convenções de plataforma respeitadas (logo no topo à esquerda leva à home, lupa é busca, carrinho no topo à direita); um só nome para cada conceito.

**Violações típicas:** "Cadastro" numa tela e "Registro" em outra para a mesma coisa; três tons de azul primário; botão primário à direita num diálogo e à esquerda em outro; link que parece botão e botão que parece link.

**Severidade típica:** 2–3. Sobe para 3 quando a inconsistência muda o significado de uma ação.

### H5 — Error Prevention

**O que verificar:** restrições impedem o erro antes de ele acontecer (máscara, `inputmode`, seletor de data em vez de digitação livre, limite de intervalo); ações destrutivas exigem gesto deliberado; defaults seguros; campos com formato ambíguo trazem exemplo.

**Violações típicas:** campo de data livre sem máscara nem exemplo; "Excluir" adjacente a "Salvar" com o mesmo peso visual; envio permitido com dados obviamente inválidos.

**Severidade típica:** 4 quando previne perda de dados ou cobrança indevida; 3 no restante.

### H6 — Recognition Rather than Recall

**O que verificar:** as opções estão visíveis no momento da decisão; o usuário não precisa lembrar de informação de outra tela; instruções ficam visíveis enquanto são necessárias; termos de busca recentes e itens vistos são recuperáveis.

**Violações típicas:** navegação escondida atrás de hambúrguer em desktop; placeholder usado como rótulo (some ao digitar); passo 4 do checkout exige lembrar o que foi escolhido no passo 1; ícone sem rótulo.

**Severidade típica:** 3, e sobe para 4 quando o dado esquecido bloqueia a conclusão da tarefa.

### H7 — Flexibility and Efficiency of Use

**O que verificar:** atalhos existem para o usuário frequente sem atrapalhar o novato (autofill, "repetir pedido", teclado, filtros salvos, endereço padrão); o caminho longo continua disponível.

**Violações típicas:** obrigar a redigitar endereço a cada compra; ausência de `autocomplete` nos campos; nenhum atalho de teclado em ferramenta de uso diário.

**Severidade típica:** 1–2 para novato, 3 para uso profissional repetido.

### H8 — Aesthetic and Minimalist Design

Formulação literal: "Every extra unit of information in an interface competes with the relevant units of information and diminishes their relative visibility."

**O que verificar:** cada elemento da dobra tem função; há **um** CTA primário por região; não há texto decorativo; a hierarquia tipográfica separa três níveis no máximo por tela; espaço em branco agrupa em vez de só sobrar.

**Violações típicas:** hero com três CTAs concorrentes; banners promocionais empilhados; parágrafo institucional acima da informação que o usuário veio buscar.

**Severidade típica:** 2–3. Atenção: minimalismo não é remover signifier — ver §4.

### H9 — Help Users Recognize, Diagnose, and Recover from Errors

**O que verificar:** a mensagem diz **o que aconteceu + por quê + o que fazer agora**, em linguagem humana, adjacente ao campo, com ícone além da cor, e sem apagar o que foi digitado.

**Violações típicas:** "Erro ao processar sua solicitação"; erro só em vermelho, sem ícone nem texto (invisível para daltônicos); erro no topo sem link para o campo; código técnico como texto principal.

**Severidade típica:** 4 quando o usuário não consegue se recuperar; 3 quando consegue com esforço.

### H10 — Help and Documentation

**O que verificar:** a ajuda existe no ponto de uso (dica ao lado do campo, não em FAQ separado); é pesquisável; descreve passos concretos; a interface funciona sem ela.

**Violações típicas:** documentação como desculpa para fluxo confuso; ajuda só em página separada; tooltip acionável apenas por hover (inexistente em toque).

**Severidade típica:** 1–2, salvo em produto complexo onde vira 3.

---

## 3. As 8 regras de ouro de Shneiderman

Da 6ª edição de *Designing the User Interface* (Pearson, 2016), seção 3.3.4. Úteis como checklist de projeto de fluxo — mais próximas de engenharia de interação que as heurísticas de Nielsen.

| # | Regra | Verificação concreta |
|---|---|---|
| 1 | Strive for consistency | Mesma sequência de ações em situações similares; terminologia idêntica em menus, telas e ajuda |
| 2 | Seek universal usability | Novato e especialista, com e sem deficiência, atendidos no mesmo fluxo (explicações para o novato, atalhos para o experiente) |
| 3 | Offer informative feedback | Toda ação tem resposta; ações frequentes e menores, resposta modesta; ações raras e maiores, resposta substancial |
| 4 | Design dialogs to yield closure | Sequências têm início, meio e fim explícitos, com confirmação de conclusão que libera a mente do usuário |
| 5 | Prevent errors | O sistema impede o erro; quando ele ocorre, oferece instrução específica de recuperação |
| 6 | Permit easy reversal of actions | Undo em unidade coerente (ação, entrada de dado ou bloco completo) |
| 7 | Keep users in control | Usuário é o iniciador da ação, não o respondente; evitar mudanças de estado não solicitadas |
| 8 | Reduce short-term memory load | Não exigir que o usuário carregue informação entre telas — ver §7 |

Nota histórica com consequência prática: a regra 2 ("universal usability") substituiu, em edições recentes, a antiga "enable frequent users to use shortcuts"; a regra 7 aparece em várias edições como "support internal locus of control". Ao citar, use a 6ª edição.

Fonte: Ben Shneiderman, *Designing the User Interface*, 6ª ed., 2016 — https://www.cs.umd.edu/users/ben/goldenrules.html

---

## 4. Norman — os conceitos que mudam decisão

Fonte: Don Norman, *The Design of Everyday Things: Revised and Expanded Edition*, 2013 — https://jnd.org/books/the-design-of-everyday-things-revised-and-expanded-edition/

### Affordance ≠ signifier

**Affordance** (termo de J. J. Gibson) é uma *relação*: as ações possíveis entre um agente e um ambiente. Affordances **não precisam ser perceptíveis** — elas simplesmente existem. **Signifier** é "some sort of indicator, some signal in the physical or social world that can be interpreted meaningfully" e é **necessariamente perceptível**.

Norman é explícito de que o termo foi corrompido no design: "what people need, and what design must provide, are signifiers".

**Consequência operacional:** quando alguém diz "este botão tem affordance de clique", o que ele quer dizer é *signifier*. Um `<div>` com `onclick` tem a affordance de ser clicado e **zero signifier** — não parece clicável, não recebe foco, não é anunciado. É este o defeito real do flat design extremo e do ghost button: remove signifier sem remover affordance, e o usuário passa a testar a interface por tentativa.

Fonte: Don Norman, "Signifiers, not affordances", *ACM Interactions* 15(6), 2008 — https://jnd.org/signifiers-not-affordances/

### Mapeamento (mapping)

Correspondência espacial ou natural entre controle e efeito. Verificação: o controle está próximo/análogo ao que ele altera? Setas do carrossel apontam para onde o conteúdo vai; slider vertical controla algo vertical; a ordem dos passos na barra de progresso é a ordem real do fluxo.

### Feedback

Informação de retorno imediata e informativa sobre o resultado da ação. Insuficiente é ruim; excessivo é pior — feedback constante e irrelevante é ignorado, e junto vai o feedback que importava. Ligue ao limiar de 0,1 s da §6.

### Restrições (constraints) — quatro tipos

| Tipo | Definição | Uso em web |
|---|---|---|
| **Físico** | A geometria impede a ação errada | `maxlength`, campo dimensionado ao dado, `min`/`max` |
| **Cultural** | Convenção aprendida socialmente | Vermelho = erro/destrutivo; logo no topo esquerdo leva à home |
| **Semântico** | O significado da situação limita as opções | Botão "Pagar" só faz sentido depois do endereço |
| **Lógico** | Dedução elimina alternativas | Se sobrou um campo e um valor, eles se correspondem |

Restrição bem projetada torna a heurística H5 (prevenção de erro) automática: o erro deixa de ser possível em vez de ser avisado.

### Golfo de execução e golfo de avaliação

- **Golfo de execução** — distância entre a intenção do usuário e os meios de agir. Perguntas: *o que eu faço? como eu faço? isto é possível aqui?* Fecha-se com signifiers, restrições e mapeamento.
- **Golfo de avaliação** — distância entre o estado do sistema e a compreensão dele. Perguntas: *o que aconteceu? isto é o que eu queria?* Fecha-se com feedback e visibilidade do status (H1).

**Uso em auditoria:** ao descrever um achado, diga qual golfo está aberto. "O usuário não sabe como filtrar" (execução) e "o usuário não sabe se o filtro foi aplicado" (avaliação) exigem correções diferentes — a primeira é signifier, a segunda é feedback.

---

## 5. Leis de UX — fórmula e limite de aplicação

A coluna "limite" é a parte que importa. Lei citada fora do seu domínio de validade é argumento de autoridade, não evidência.

### 5.1 Lei de Fitts

Use a **formulação de Shannon** (MacKenzie, 1989), não a original de 1954:

```
MT = a + b · log₂((A + W) / W)
ID = log₂((A + W) / W)          [bits]
```
MT = tempo de movimento; A = distância ao alvo; W = largura do alvo na direção do movimento.

MacKenzie mostra que a equação original de Fitts partia da aproximação de Goldman ao teorema de Shannon, válida só "if the transmitted power is large in comparison with the noise" — e em boa parte dos experimentos de Fitts o sinal (amplitude) era pequeno frente ao ruído (largura). A variante de Shannon dá correlações mais altas nos próprios dados de Fitts e nunca produz ID negativo.

Fonte: I. Scott MacKenzie, "A Note on the Information-Theoretic Basis for Fitts' Law", *Journal of Motor Behavior*, 1989 — https://www.yorku.ca/mack/JMB89.html
Extensão 2D (largura efetiva W'): MacKenzie & Buxton, CHI '92 — https://www.yorku.ca/mack/p219-mackenzie.pdf

**Decisões que a fórmula muda:**
- O tempo cai com o **log** da largura e cresce com o **log** da distância → **aumentar o alvo compensa mais que aproximá-lo**. Entre engordar um botão e movê-lo 100px para perto, engorde.
- Bordas e cantos de tela têm largura efetivamente infinita (o ponteiro trava). São os alvos mais rápidos de qualquer display — daí barra fixa no topo/rodapé, e daí a regra de **não** colocar ação destrutiva no canto.
- A área de toque pode exceder a área pintada (padding, pseudo-elemento): o que conta na fórmula é W efetivo, não o visual.

**Limite:** vale para movimento apontado até um alvo. Não descreve escolha, leitura, busca visual nem digitação. Em toque, W é limitado pela precisão do dedo (~10 mm), não pelo pixel.

### 5.2 Lei de Hick-Hyman — e por que ela quase nunca se aplica

```
RT = a + b · log₂(n + 1)
```
Fontes originais: Hick (1952), *QJEP* 4:11–26; Hyman (1953), *J. Exp. Psychol.* 45:188–196.

**⚠️ Crítica decisiva — não use Hick para justificar menu curto.** Liu, Gori, Rioul, Beaudouin-Lafon & Guiard, "How Relevant is Hick's Law for HCI?", CHI 2020, concluem literalmente que "Hick's law is of little relevance to most HCI applications"; que crescimento logarítmico observado "is not necessarily interpretable in terms of Hick's law"; e — o ponto que encerra o debate — que Hick, aplicado corretamente, "actually suggests displaying **as many items as possible**", o oposto do que se costuma alegar. Busca em menu hierárquico é **busca visual**, não reação de escolha.

Fonte: Liu et al., CHI 2020 — https://perso.telecom-paristech.fr/rioul/publis/202001liugoririoulbeaudouinlafonguiard.pdf

Condições de contorno adicionais: com alta compatibilidade estímulo-resposta não há diferença de RT entre 2, 4 e 8 alternativas; com prática extensa o RT pode ficar independente do tamanho do conjunto; tarefas espaciais/sacádicas mostram função plana ou invertida.
Fonte: Proctor & Schneider, *QJEP*, 2018 — https://web.ics.purdue.edu/~dws/pubs/ProctorSchneider_2018_QJEP.pdf

**Quando Hick vale:** reação de escolha genuína — estímulo imprevisível, resposta mapeada, sem busca. Praticamente nunca em web.
**O que usar no lugar para defender simplificação:** carga de leitura, escaneabilidade, custo de manutenção e a heurística H8 — não Hick.

### 5.3 Miller (7±2) vs Cowan (4±1)

**Miller 1956 mediu julgamento absoluto de estímulos unidimensionais** — capacidade de canal de 1,6 a 3,9 bits, média 2,6 bits (~6–7 categorias). Isso é transmissão de informação, não capacidade de memória; Miller distingue explicitamente "bits" de "chunks". Sobre o próprio número sete ele escreveu: "I suspect that it is only a pernicious, Pythagorean coincidence."
Fonte: Miller, *Psychological Review* 63(2), 1956 — https://psychclassics.yorku.ca/Miller/

**Cowan 2001 é o limite utilizável: 3 a 5 chunks**, média populacional ~4, faixa individual 2–6 — observável apenas quando se bloqueiam os mecanismos de recodificação (supressão articulatória, exigência de ordem serial, material não-ensaiável).
Fonte: Cowan, *Behavioral and Brain Sciences* 24(1), 2001 — https://doi.org/10.1017/S0140525X01003922

**Regra de decisão:** não conte itens **visíveis** — eles estão na tela, são reconhecimento, custo de memória ~zero. Conte o que o usuário precisa **carregar na cabeça entre telas**. Um menu de 12 itens visíveis não viola nada; um wizard de 5 passos que exige lembrar no passo 4 uma decisão do passo 1 viola 4±1 e é um achado real.
**Corolário de chunking:** agrupar 16 dígitos de cartão em 4 blocos de 4 não reduz informação, reduz chunks. Aplique a CPF, CNPJ, CEP, telefone e código de confirmação.

### 5.4 Demais leis, com limite

| Lei | Formulação | Decisão que muda | Limite / ressalva |
|---|---|---|---|
| **Jakob** | "Users spend most of their time on *other* sites... they prefer your site to work the same way as all the other sites they already know" — Nielsen, NN/g, 2000 — https://www.nngroup.com/articles/end-of-web-design/ | Não reinvente carrinho, busca, login, posição do logo, ícone de menu. Inovação gasta orçamento de aprendizado — gaste no diferencial, não na plumbing | É argumento a favor da convenção, não contra toda inovação. Convenção ruim (carrossel de hero) não fica boa por ser comum |
| **Tesler (conservação da complexidade)** | "Every application has an inherent amount of irreducible complexity. The only question is: Who will have to deal with it — the user, the application developer, or the platform developer?" — https://www.nomodes.com/larry-tesler-consulting/complexity-law | Ao remover um campo, pergunte para onde a complexidade foi. Autopreencher CEP move o trabalho do usuário para o sistema; esconder um campo obrigatório só adia o trabalho | Tesler **não** prescreve quem absorve. Não use a lei para justificar interface simplista que empurra o trabalho de volta ao usuário |
| **Von Restorff (isolamento)** | von Restorff, 1933, *Psychologische Forschung* 18:299–342: acerto de recall é maior na constelação isolada "regardless of type of material" | **Um** elemento destoante por região visual. Dois CTAs primários competindo anulam o efeito — o isolamento só existe contra um fundo homogêneo | O efeito depende de haver maioria homogênea. Página inteira "em destaque" = nada em destaque |
| **Posição serial** | Primazia e recência: primeiro e último item de uma lista são mais lembrados | Coloque o item mais importante no início da nav e o segundo mais importante no fim; o meio é a zona morta | ⚠️ **não verificado em fonte primária** neste dossiê (base clássica em Ebbinghaus, Murdock 1962, Glanzer & Cunitz 1966) — https://www.simplypsychology.org/primacy-recency.html |
| **Doherty** | Resposta **abaixo de 400 ms** produz aumento dramático na taxa de interação, em todos os níveis de habilidade — Doherty & Thadani, IBM, 1982 (GE20-0752-0) — https://daverupert.com/2015/06/doherty-threshold/ | 400 ms é o alvo prático de resposta de interação em produto | ⚠️ **evidência fraca:** relatório técnico interno da IBM, não peer-reviewed, com hardware e tarefas de 1982 |
| **Postel (robustez)** | "be conservative in what you do, be liberal in what you accept from others" — RFC 761, 1980 | Aceite telefone com ou sem hífen, CEP com ou sem traço, cartão com espaços, e-mail com espaço colado. Nunca rejeite por formatação | ⚠️ **contestado na origem:** RFC 9413 (Thomson & Schinazi, 2023) mostra que ser liberal entrincheira defeitos como padrão de fato. Em UX a regra sobrevive **com emenda**: normalize e **mostre ao usuário o que você entendeu** — não silencie a ambiguidade |
| **Zeigarnik** | Tarefas interrompidas seriam mais lembradas (IR/CR ≈ 2,0 no original de 1927) | — | ⚠️ **não use como base de decisão.** MacLeod (2020): van Bergen obteve IR/CR = **0,88**; **menos de 1/3 de 44 replicações** sustentaram o efeito — https://uwaterloo.ca/memory-attention-cognition-lab/sites/default/files/uploads/files/zeigarnik2020.pdf |
| **Pareto (80/20)** | Minoria de features concentra a maioria do uso | Instrumente e priorize pelo uso medido | ⚠️ heurística de priorização, **não lei empírica de interface**; cunhada por Juran a partir de dados de renda de Pareto (1896) |

### 5.5 Gestalt — ordem de força prática

Wertheimer (1923), *Psychologische Forschung* 4:301–350: proximidade, similaridade, fechamento, continuidade, destino comum. **Região comum** e **conectividade** são adições de Palmer (1992) e Palmer & Rock (1994), não estão em Wertheimer.
Fonte: http://www.scholarpedia.org/article/Gestalt_principles

**Ordem de força em UI: proximidade > região comum > similaridade.**

Consequências diretas:
- **Espaçamento agrupa mais forte que cor ou borda.** O erro clássico de formulário é o label equidistante de dois campos — o olho o associa ao campo errado, e nenhuma cor conserta isso. Regra: o espaço entre label e seu campo deve ser visivelmente menor que o espaço entre grupos (proporção prática ≥ 1:2).
- Card com borda (região comum) agrupa, mas perde para itens simplesmente aproximados sem borda.
- Repetir a cor de um estado em elementos não relacionados cria agrupamento falso.

---

## 6. Limiares de tempo de resposta

Os três limites de Nielsen (1993), creditando Miller, R. B. (1968) e Card, Robertson & Mackinlay (1991):

| Limite | Efeito percebido | Ação de design |
|---|---|---|
| **0,1 s** | Resposta instantânea; causalidade direta | Nenhum feedback especial além de exibir o resultado |
| **1,0 s** | Atraso perceptível; fluxo de pensamento preservado | Sem indicador; o usuário perde a sensação de operar diretamente sobre o dado |
| **10 s** | Limite da atenção focada | Acima disso o usuário vai fazer outra coisa — exige **percent-done indicator** |

Fonte: Jakob Nielsen, "Response Times: The 3 Important Limits", NN/g, 1993 — https://www.nngroup.com/articles/response-times-3-important-limits/

Complementos compatíveis, para calibrar o alvo prático:
- **50 ms** — reconhecimento da ação do usuário (mais estrito que os 100 ms de Nielsen); **15 s** — ponto que exige sinal auditivo ou visual proeminente. Fonte: Bruce Tognazzini, "First Principles of Interaction Design", AskTog, 2014 — https://asktog.com/atc/principles-of-interaction-design/
- **400 ms** — inflexão de produtividade/engajamento (Doherty, com a ressalva de §5.4).

**Escada operacional consolidada:** ≤100 ms nenhum indicador · 100–300 ms nenhum indicador (spinner que pisca é pior que nada) · 300 ms–1 s mudança sutil ou spinner local · 1–10 s indicador com rótulo do que está acontecendo · >10 s barra determinada com percentual, estimativa e opção de cancelar.

---

## 7. Carga cognitiva de Sweller em formulário e navegação

Três tipos, na Cognitive Load Theory:

- **Intrínseca (ICL)** — complexidade inerente da tarefa, determinada por **element interactivity** (elementos que precisam ser processados simultaneamente) e pelo conhecimento prévio. Não se reduz sem mudar a tarefa ou o repertório do usuário.
- **Extrínseca (ECL)** — produzida por design ruim: "when the learner must invest mental resources into processes that are not relevant for the task itself". **É a única que o designer elimina diretamente.**
- **Germane (GCL)** — ⚠️ **nuance que muda a citação:** na reconceitualização de Sweller (2010) a carga germane deixou de ser uma terceira fonte *aditiva* e passou a ser "the working memory resources available to deal with the element interactivity associated with ICL" — capacidade alocada, não carga adicional. Citar "os três tipos aditivos de carga" é a formulação de 1998, superada.

Fonte: revisão em Frontiers in Psychology, 2017 — https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01997/full (citações-chave: Sweller 1988, *Cognitive Science* 12(2); Sweller, van Merriënboer & Paas 1998, *Educational Psychology Review* 10(3); Sweller 2010)

**Aplicação a formulário:**
1. Cada campo é uma unidade de element interactivity. Campo que só existe "para o CRM" é ECL pura — corte.
2. Campo que exige dado de outra tela ou de outro app viola o limite de 4±1 de Cowan. Se o dado é indispensável, traga-o para a tela (resumo do pedido visível durante o pagamento).
3. Baymard mede **11,3 campos** no checkout médio (2024) contra **8 suficientes** — 3,3 campos de ECL por checkout, em média. Fonte: Baymard — https://baymard.com/blog/checkout-flow-average-form-fields
4. Chunking reduz carga sem reduzir informação: 4 blocos de 4 dígitos no cartão, CEP em dois blocos, CPF em quatro.
5. Validação que só aparece no submit obriga o usuário a manter na memória o que digitou linhas atrás — ECL evitável.

**Aplicação a navegação:**
1. Menu visível é *recognition* (H6): custo de memória ~zero, independentemente do número de itens.
2. Navegação oculta transfere o custo para *recall*, e o efeito é medido: descoberta cai **mais de 20%** e as tarefas ficam **≥39% mais lentas no desktop**. Fonte: NN/g, 2016 — https://www.nngroup.com/articles/hamburger-menus/
3. Hierarquias **rasas e largas** custam menos que profundas e estreitas: cada nível é uma decisão a manter em memória enquanto se desce.
4. Breadcrumb e estado ativo existem para tirar da memória do usuário a resposta a "onde eu estou".

---

## 8. O que a literatura desencoraja — com evidência

| Prática | Evidência | Fonte |
|---|---|---|
| **Carrossel/slider em hero** | ~**1%** dos visitantes clicam em qualquer slide; **84%** dos cliques vão para o slide 1; demais posições ~4% cada. Carrosséis estáticos: CTR 1,7–2,3%, primeira posição 48–62%. Com auto-avanço: CTR 8,8%, slide 1 = 40%, último = 11%. Base: 28.928 cliques e 315.665 rotações, out/2012–jan/2013 | Erik Runyon — https://erikrunyon.com/2013/01/carousel-interaction-stats/ |
| **Navegação oculta em desktop** | Uso da nav: oculta **27%** vs visível **48%** vs combo **50%**. Tarefas **≥39% mais lentas**; 5–7 s a mais até o primeiro uso; descoberta cai **>20%**; dificuldade percebida **+21%**. Mobile: oculta 57% vs combo **86%**. n=179, 6 sites | NN/g, Pernice & Budiu, 2016 — https://www.nngroup.com/articles/hamburger-menus/ |
| **Scroll infinito** | Falha quando o usuário precisa achar algo específico, comparar itens distantes ou alcançar o rodapé; botão voltar reseta a posição; teclado e leitor de tela não disparam o carregamento. Alternativa: botão "Carregar mais" | NN/g, 2022 — https://www.nngroup.com/articles/infinite-scrolling-tips/ |
| **Ícone sem rótulo** | "A text label must be present alongside an icon", visível o tempo todo, não em hover. Caso documentado: ícone de relógio para "histórico" recebeu **zero cliques**. Exceções universais: casa, impressora, lupa | NN/g, Harley, 2014 — https://www.nngroup.com/articles/icon-usability/ |
| **Texto justificado** | "Many people with cognitive disabilities have a great deal of trouble with blocks of text that are justified" — os espaços criam "rivers of white". Técnica G169, ligada ao SC 1.4.8 (AAA). Alinhe a um só lado | W3C — https://www.w3.org/TR/WCAG20-TECHS/G169.html |
| **Texto sobre imagem sem overlay** | O contraste varia por pixel da foto, violando o SC 1.4.3 (4,5:1 normal, 3:1 grande). Corrija com overlay sólido, gradiente, scrim ou faixa de cor | W3C — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html |
| **Pop-up/modal de captura** | Ranking de rejeição (n=605): aparece na frente da janela **95%**; sem botão de fechar **93%**; cobre o que você tenta ver **93%**; não indica seu propósito **92%**. As quatro primeiras posições descrevem um modal de captura de e-mail | NN/g, 2004 — https://www.nngroup.com/articles/most-hated-advertising-techniques-2004/ |
| **Intersticial intrusivo em mobile** | Sinal negativo de ranqueamento no Google desde **10/01/2017**. Isentos: obrigação legal (cookies, verificação de idade), login para conteúdo privado, e banners que usam parcela razoável da tela e são facilmente dispensáveis | Search Engine Land — https://searchengineland.com/interstitialgeddon-google-warns-will-crack-intrusive-interstitials-next-january-257252 |
| **Interromper o usuário** | Tempo médio em uma esfera de trabalho antes de troca/interrupção: **11 min 4 s**; **57,1%** dos segmentos foram interrompidos; tempo até retomar no mesmo dia: **25 min 26 s** (n=24, 700+ h de observação). Interrupção não deixa o trabalho mais lento — deixa mais estressante: estresse 6,92 → ~9,3 (p<.001), frustração 4,73 → ~6,6, esforço 9,50 → ~11,3 (n=48) | Mark, Gonzalez & Harris, CHI 2005 — https://ics.uci.edu/~gmark/CHI2005.pdf · Mark, Gudith & Klocke, CHI 2008 — https://ics.uci.edu/~gmark/chi08-mark.pdf |
| **Banner blindness** | A maioria dos usuários ignora informação em banners **mesmo quando é exatamente o que procuram**. Nuance: por eye-tracking (Hervet et al., 2011) a maioria **fixa** o anúncio ao menos uma vez — a cegueira é de processamento, não de fixação. Consequência: **parecer** anúncio já basta para ser descartado, inclusive promoção legítima e conteúdo próprio | Benway & Lane, Rice University, 1998 — https://en.wikipedia.org/wiki/Banner_blindness |
| **Splash screen em web** | Atraso puro sem valor para o usuário. ⚠️ **evidência fraca:** consenso profissional sem estudo quantitativo canônico localizado — recomende com essa ressalva | — |

### O mito da dobra — a leitura correta

- **57%** do tempo de visualização acontece acima da dobra; **74%** nos dois primeiros screenfuls (até 2160px); **>65%** do tempo acima da dobra se concentra na **metade superior** do viewport. n=120, 130.000+ fixações. Fonte: NN/g, Fessenden, 2018 — https://www.nngroup.com/articles/scrolling-and-attention/
- Profundidade mediana de rolagem ~**50%** do artigo (Slate) e ~**60%** na base do Chartbeat; apenas **25%** dos leitores passam do pixel 1.600; **5%** dos leitores engajados nunca rolam. Mas **86,2%** do tempo de engajamento ocorre **abaixo** da dobra inicial. Fonte: Chartbeat/Slate, 2013 — https://slate.com/technology/2013/06/how-people-read-online-why-you-wont-finish-this-article.html

**Síntese defensável:** "tudo tem que caber acima da dobra" é falso — rolar é comportamento normal e a maior parte do tempo é gasta abaixo. "A dobra não existe" também é falso — a atenção decai fortemente com a profundidade. A regra útil: **hierarquia importa mais que a linha da dobra, e o topo do viewport é o recurso mais escasso da página.**

---

## 9. Erratas — cinco afirmações populares que a fonte não sustenta

| Afirmação corrente | O que a fonte primária diz |
|---|---|
| "Hick: menos opções = decisão mais rápida, logo simplifique o menu" | Liu et al., CHI 2020: Hick é irrelevante para a maior parte de HCI; aplicado corretamente "suggests displaying as many items as possible"; menu é busca visual, não reação de escolha |
| "Miller: no máximo 7±2 itens na interface" | Miller 1956 mediu julgamento absoluto unidimensional (2,6 bits), explicitamente distinto de span de memória; ele mesmo chamou o sete de "pernicious, Pythagorean coincidence". Use Cowan (4±1), e só para o que é carregado *entre* telas |
| "Leva 23 min 15 s para retomar após uma interrupção" | Mark, Gonzalez & Harris, CHI 2005: **25 min 26 s**, e é tempo até *retornar à esfera de trabalho*, não tempo de refoco |
| "5 usuários encontram 85% dos problemas" | Faulkner 2003 (pool de 60 usuários, reamostragem): a **média** é ~85%, mas conjuntos de 5 variaram de **55% a 99%** — e não há como saber onde o seu caiu. 10 usuários elevam o pior caso a 80%; 20 a 95% — https://link.springer.com/article/10.3758/BF03195514 |
| "Efeito Zeigarnik é lei estabelecida" | MacLeod 2020: van Bergen obteve IR/CR = 0,88; menos de 1/3 de 44 replicações sustentaram o efeito |
