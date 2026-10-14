# 11 — E-commerce: produto, listagem, busca, carrinho e checkout

**Referência condicional.** Só é relevante quando a página tem carrinho, checkout, listagem de produtos ou página de
produto. Site institucional, landing page de lead e app sem transação não precisam dela.

**Aviso de transferência de evidência:** quase toda a pesquisa quantitativa de UX de e-commerce disponível — Baymard
incluído — é conduzida com **populações dos EUA e da Europa**. Os mecanismos (surpresa de custo, atrito de formulário,
desconfiança de pagamento) são plausivelmente universais; os **percentuais não são transferíveis** para o Brasil, onde
meios de pagamento, endereçamento e comportamento de parcelamento são diferentes. Cada bloco abaixo marca onde isso
pesa.

## Índice

1. [Os números de abandono e o que eles dizem](#1-os-números-de-abandono-e-o-que-eles-dizem)
2. [Página de produto (PDP)](#2-página-de-produto-pdp)
3. [Listagem e filtros (PLP)](#3-listagem-e-filtros-plp)
4. [Busca no site](#4-busca-no-site)
5. [Carrinho](#5-carrinho)
6. [Checkout — estrutura e campos](#6-checkout--estrutura-e-campos)
7. [Endereço e CEP no Brasil](#7-endereço-e-cep-no-brasil)
8. [Pagamento brasileiro: Pix, boleto e parcelamento](#8-pagamento-brasileiro-pix-boleto-e-parcelamento)
9. [Confiança, prova social e escassez](#9-confiança-prova-social-e-escassez)
10. [Benchmarks de conversão](#10-benchmarks-de-conversão)

## 1. Os números de abandono e o que eles dizem

**Taxa média documentada de abandono de carrinho: 70,22%**, agregando 50 estudos (2006–2025).
Fonte: Baymard Institute — https://baymard.com/lists/cart-abandonment-rate

Razões declaradas, **excluídos os 42%** que responderam "só estava olhando / não estava pronto para comprar" — esses
42% são abandono inevitável, não problema de design:

| Razão declarada | % |
|---|---|
| **Custos extras altos (frete, taxas, impostos)** | **40%** |
| Prazo de entrega muito longo | 20% |
| Não confiou no site com os dados do cartão | 19% |
| Site exigiu criar conta | 18% |
| Checkout longo ou complicado demais | 17% |
| Erros ou travamentos no site | 17% |
| Política de devolução insatisfatória | 13% |
| Não conseguiu ver o custo total antecipadamente | 12% |
| Cartão recusado | 10% |
| Poucas opções de pagamento | 9% |
| Outros / desconhecido | 7% |

Fonte: Baymard Institute — https://baymard.com/lists/cart-abandonment-rate
⚠️ **Amostra americana** (1.026 respondentes adultos usuários de internet nos EUA, 2025). Use a **ordem** das causas
como mapa de prioridade; não prometa ao cliente que 40% do abandono dele é custo extra.

**A leitura que muda a ordem de trabalho:** custos extras (40%) + custo total invisível (12%) + política de devolução
(13%) somam mais que qualquer questão de interface. A maior causa isolada de abandono é **surpresa de preço e falta de
transparência** — não é design, é honestidade de preço. Nenhuma otimização de botão compensa frete-surpresa no último
passo.

## 2. Página de produto (PDP)

**Preço, disponibilidade e prazo/custo de entrega acima da dobra.** Calcule o frete pelo CEP **na página de produto**,
não só no checkout — é o que ataca diretamente os 12% que abandonam por não conseguir ver o custo total
antecipadamente. **Imagens: mínimo 5–8**, incluindo contexto de uso e escala, com zoom de alta resolução, e variações
que refletem a opção selecionada. **Especificações completas.** A ausência de um dado é motivo recorrente de abandono
e de devolução — em autopeça e pneu, isso significa medida, aplicação por modelo/ano, garantia e origem. **Política de
devolução, garantia e prazo visíveis na página**, não apenas no rodapé. **Variantes indisponíveis aparecem como
esgotadas, não somem.** O usuário precisa saber que a variação existe para decidir se espera ou substitui.
Fonte: Baymard, *Ecommerce Product Page UX* — https://baymard.com/learn/ecommerce-product-page-ux
Fonte (frete e custo total): https://baymard.com/lists/cart-abandonment-rate

## 3. Listagem e filtros (PLP)

**A base do problema, medida:** avaliando 170+ sites nos EUA e Europa, com mais de 21.000 parâmetros avaliados
manualmente, a Baymard encontrou **58% dos sites desktop** com desempenho "ruim" a "medíocre" em UX de lista de
produtos — e **78% dos sites mobile**. O desempenho mobile é dramaticamente pior.
Fonte: Baymard, *Product List UX* — https://baymard.com/blog/current-state-product-list-and-filtering
⚠️ Amostra EUA/Europa; a magnitude do problema no Brasil é plausivelmente igual ou pior, mas não foi medida por esse
estudo.

**Regras que a evidência sustenta:**
- **Contagem de resultados por opção de filtro** — o usuário precisa saber se filtrar leva a zero.
- **Múltiplos valores no mesmo filtro** (OR dentro do filtro, AND entre filtros diferentes).
- **Aplicar sem recarregar a página**, com filtros ativos visíveis como chips removíveis.
- **Filtros específicos por categoria.** Voltagem em eletro, aro e medida em pneu, aplicação por veículo em autopeça.
  Filtro genérico ("preço", "marca") sozinho é inútil em catálogo técnico.
- **Ordenação e filtro são coisas diferentes** — não misture no mesmo controle.
- **Página de "nenhum resultado" com saída**: correção sugerida, busca relaxada e alternativas.

## 4. Busca no site

A busca precisa aceitar o vocabulário do usuário, não o do catálogo: **nome, categoria, atributo, código do fabricante
e erro de digitação** (busca fonética ou fuzzy). Em catálogo técnico brasileiro isso significa tolerar "pneu 195 65
15", "195/65R15" e "aro 15" como a mesma intenção. **Se a busca falha, a listagem não salva** — o usuário que buscou
já declarou intenção alta e sai quando não encontra. **Instrumente os termos buscados sem resultado.** É a lista mais
barata de oportunidades de catálogo e de sinônimo que existe, e não depende de pesquisa com usuário.
**Evidência:** as regras de tolerância a erro e vocabulário do usuário derivam das diretrizes de listagem e busca da
Baymard (https://baymard.com/learn/ecommerce-search-ux); a aplicação a catálogo automotivo brasileiro é **julgamento
aplicado, sem estudo específico**.

## 5. Carrinho

**O carrinho é a última tela antes do compromisso** e precisa responder a três perguntas sem clique: o que eu estou
comprando, quanto custa **no total**, e quando chega.
- **Custo total (produto + frete + impostos) visível no carrinho**, não revelado no último passo.
- **Prazo de entrega estimado por CEP** no próprio carrinho — o prazo é a segunda razão declarada de abandono (20%).
- **Edição de quantidade e remoção sem recarregar**, com desfazer.
- **Persistência do carrinho** entre sessões e dispositivos para usuário identificado.
- **Nada de upsell que empurre o botão de finalizar para fora da tela** em mobile.
- **Cupom atrás de link, não campo visível.** Campo de cupom visível cria FOMO, manda o usuário para o Google atrás de
  código e ele frequentemente não volta. Adoção da tática entre sites medidos: **65%**. Fonte:
  https://baymard.com/blog/checkout-flow-average-form-fields

## 6. Checkout — estrutura e campos

**A média medida:** **11,3 campos** e **5,1 passos**, contra um alvo alcançável de **8 campos** — redução de 3,3
campos sem perda funcional. Progressão histórica: 12,7 campos (2019) → 11,8 (2021) → 11,3 (2024).
Fonte: Baymard — https://baymard.com/blog/checkout-flow-average-form-fields

**A Baymard é explícita: reduzir campos visíveis importa mais do que reduzir o número de passos.** Um checkout de 4
passos com 8 campos supera um de 1 passo com 14.

**As cinco táticas de redução, com a adoção medida de cada uma:**

| Tática | Adoção |
|---|---|
| Campo único "Nome completo" em vez de nome + sobrenome | 11% |
| Esconder "Complemento" atrás de link | 25% |
| Esconder o campo de cupom | 65% |
| Assumir cobrança = entrega por padrão | 76% |
| Adiar a criação de conta para depois da compra | 16% |

Fonte: Baymard — https://baymard.com/blog/checkout-flow-average-form-fields

**Checkout como convidado por padrão.** A exigência de criar conta é a razão declarada de **18%** dos abandonos.
Ofereça a criação de conta **após** a confirmação do pedido, reaproveitando os dados já digitados — nesse ponto só
falta a senha, e o usuário já teve o benefício.
Fonte: https://baymard.com/lists/cart-abandonment-rate

**Estrutura do formulário:**
- **Coluna única.** Exceção legítima: campos logicamente atômicos e curtos na mesma linha (CEP + número, validade +
  CVV, cidade + UF).
- **Label acima do campo, peso normal**, sempre visível, com `<label for>` real. No eye-tracking de Matteo Penzo,
  label acima produziu sacada média de **~50 ms** (label e campo capturados num único movimento ocular) contra
  **170–240 ms** alinhado à direita e **~500 ms** alinhado à esquerda — e colocar o label **em negrito** piorou o
  desempenho de 50 para **80 ms (+60%)**, por confundi-lo com a borda do campo. Fonte:
  https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php
- **Placeholder nunca como label** — some ao digitar, tem contraste baixo por definição, quebra autofill e tradução, e
  tem suporte inconsistente como nome acessível. Use só para exemplo de formato ("ex.: 01310-100").
- **Marque os campos opcionais** com "(opcional)" em vez de marcar os obrigatórios com asterisco, quando a maioria é
  obrigatória. Nunca indique obrigatoriedade só por cor.
- **Indicador de progresso com passos nomeados**, permitindo voltar e editar sem perder dados.
- **Reduza distrações no checkout, mas não remova a navegação inteira** — o usuário precisa poder voltar ao produto
  sem perder o carrinho.

**Validação:** valide no `blur` e limpe o erro em tempo real durante a correção — "recompense cedo, puna tarde". O
estudo clássico de Wroblewski/Etre mediu **+22% de sucesso, −22% de erros, +31% de satisfação, −42% de tempo e −47% de
fixações oculares** com validação inline. ⚠️ **n=22** — amostra pequena —, e o próprio estudo concluiu que o ganho se
concentra em campos cuja resposta correta o usuário **não consegue prever** (usuário, senha, disponibilidade), não em
nome e endereço. Validação a cada tecla, antes de o usuário terminar, **aumenta** erros.
Fonte: https://alistapart.com/article/inline-validation-in-web-forms/

**Mensagens de erro:** adjacentes ao campo, com ícone + texto (nunca só cor), `aria-describedby` ligando campo e
mensagem e `aria-invalid="true"`; resumo no topo com links âncora no submit falho; e **nunca apague o que foi
digitado**. Diga o que houve e como resolver: "CEP deve ter 8 dígitos" vence "Campo inválido".

**Teclado mobile — onde o mercado falha:** **54%** dos sites móveis não invocam teclado otimizado para telefone, CEP
ou cartão; **79%** não desabilitam autocorreção onde deveriam; **27%** erram a capitalização; **85%** violam ao menos
uma das cinco diretrizes de teclado. Implementações perfeitas subiram de 2% para apenas **15%** entre 2013 e 2015.
Fonte: Baymard — https://baymard.com/blog/mobile-touch-keyboards

```html
<input type="email"   autocomplete="email"       inputmode="email">
<input type="tel"     autocomplete="tel"         inputmode="tel">
<input name="cep"     autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}-?[0-9]{3}" maxlength="9">
<input name="cpf"     inputmode="numeric"        autocomplete="off"  maxlength="14">
<input name="cardnum" autocomplete="cc-number"   inputmode="numeric" autocorrect="off" spellcheck="false">
<input name="nome"    autocomplete="name"        autocapitalize="words">
```

Use `inputmode="numeric"` em vez de `type="number"` para CEP, CPF e cartão: evita spinner, scroll acidental alterando
o valor e perda de zeros à esquerda.

**CAPTCHA:** custo de conversão real e desproporcional, e penaliza mais quem tem deficiência visual, cognitiva ou
motora. Prefira, nesta ordem: honeypot → rate limiting → análise comportamental server-side → CAPTCHA
invisível/risk-based → só então desafio visível. Nunca em fluxo de compra.

## 7. Endereço e CEP no Brasil

Este é o bloco onde a evidência americana **não** transfere: o endereçamento brasileiro tem estrutura própria e uma
base pública consultável, o que muda o desenho do formulário.

- **CEP é o primeiro campo do bloco de endereço.** Ao completar 8 dígitos, consulte ViaCEP (https://viacep.com.br/) ou
  BrasilAPI (https://brasilapi.com.br/docs) e preencha logradouro, bairro, cidade e UF. Derivar em vez de perguntar é
  a redução de campos mais eficiente disponível aqui.
- **Mantenha os campos preenchidos visíveis e editáveis.** Não esconda: bases de CEP têm lacunas (zonas rurais, CEP
  único de município, loteamento novo) e o usuário precisa corrigir.
- **Foco automático em "Número"** logo após o autopreenchimento; **"Complemento" atrás de link**.
- **UF como `<select>` com as 27 unidades**, ou derivada do CEP.
- **Sempre ofereça fallback manual se a API falhar.** Nunca bloqueie a compra por indisponibilidade de serviço de CEP
  — a dependência é de terceiro e vai cair.
- **Máscaras:** aplique na exibição e **envie o valor limpo** ao backend; não impeça colagem; normalize o que for
  colado. Telefone brasileiro precisa aceitar 8 e 9 dígitos.
- **Não peça CPF quando não for necessário** para emitir a nota ou processar o pagamento: é campo de atrito e de
  exposição LGPD.
**Evidência:** as práticas de máscara, autofill e derivação por CEP são adaptação das diretrizes de formulário da
Baymard ao endereçamento brasileiro — **julgamento aplicado quanto ao contexto BR, sem estudo específico** medindo o
efeito no Brasil.

## 8. Pagamento brasileiro: Pix, boleto e parcelamento

A razão "poucas opções de pagamento" responde por **9%** dos abandonos declarados no estudo americano — mas ali o
leque de meios é outro. No Brasil, os três meios abaixo mudam o desenho da página, não só a integração.
Fonte (os 9%): https://baymard.com/lists/cart-abandonment-rate

**Pix.** Pagamento imediato e sem parcelamento. Consequências de desenho: confirmação em segundos permite **liberar o
pedido na hora** e dizer isso na página; o QR code precisa de alternativa "copiar código" para quem paga no mesmo
aparelho; e o prazo de expiração do código deve ser explícito. Desconto no Pix, quando existir, aparece **no preço do
produto**, não como surpresa no último passo — senão vira a mesma classe de problema dos custos extras.

**Boleto.** Não é pagamento, é **promessa de pagamento**: o pedido só anda depois da compensação. Consequências: diga
o prazo de compensação **antes** da escolha; não prometa entrega contada da compra, e sim do pagamento; reserve
estoque ou avise que não reserva; e envie o boleto por um canal que o usuário recupera depois (e-mail e WhatsApp).

**Parcelamento no cartão.** É um argumento de preço, não um detalhe de checkout. Consequências: mostre **"em até Nx de
R$ Y"** já na página de produto e no carrinho, com juros ou "sem juros" declarado; se o número de parcelas muda com o
valor do carrinho, mostre a simulação antes do preenchimento do cartão. Esconder o parcelamento até a última tela
desperdiça o argumento onde ele decide.

**O que a evidência americana não cobre e você não deve extrapolar:** participação de cada meio, efeito do desconto de
Pix na conversão e sensibilidade a juros de parcelamento no Brasil. Nenhum estudo com metodologia publicada foi
localizado nesta pesquisa — **julgamento aplicado, sem estudo específico**. Meça na própria loja com dados de pedido,
que é a única fonte confiável aqui.

## 9. Confiança, prova social e escassez

**Desconfiança de pagamento é a terceira razão declarada de abandono: 19%.** Ponha os sinais de segurança **perto do
campo do cartão**, onde a ansiedade acontece.
Fonte: https://baymard.com/lists/cart-abandonment-rate

**Sobre selos:** em estudos quantitativos da Baymard entre 2013 e 2023, **selos de confiança** (legitimidade do
negócio) superaram **selos de SSL** (criptografia), com o Norton dominando o reconhecimento; e um **selo caseiro
inventado teve desempenho melhor que selos SSL de fornecedores estabelecidos**, exceto o Norton — o efeito é de
reconhecimento e robustez visual, não de verificação real. Fonte:
https://baymard.com/blog/perceived-security-of-payment-form
⚠️ Isso **não autoriza** inventar selo: no Brasil é publicidade enganosa (CDC, art. 37, §1º). Use os que a loja possui
e maximize a legibilidade deles.

**Avaliações:** funcionam quando são específicas e verificáveis — número real de avaliações, **distribuição das
notas** e não só a média, avaliações negativas visíveis, fotos de clientes. **Avaliações negativas aumentam a
confiança**: 100% de cinco estrelas lê como fraude, e crítica moderada com resposta da marca é o sinal mais forte.
Depoimento sem nome, foto ou empresa vale perto de zero e custa espaço.

**Escassez ética × manipuladora** — o teste decisivo é **o que acontece se o usuário esperar**:

| Ética | Manipuladora |
|---|---|
| "3 unidades em estoque" — e são 3 | "Restam apenas 2!" gerado aleatoriamente |
| "Promoção até 31/08" — e o preço sobe em 31/08 | Contador que reinicia ao recarregar |
| "12 pessoas compraram nas últimas 24h" — dado real | Notificações de atividade fabricadas |
| Reserva de estoque que de fato expira | Cronômetro decorativo sem consequência |

Se a resposta for "nada muda", a escassez é falsa — e cai nos tipos *Fake Urgency* e *Fake Scarcity* da taxonomia de
padrões enganosos, com exposição sob o CDC brasileiro (art. 37, publicidade enganosa) além do DSA e da FTC lá fora.
Fonte: https://www.deceptive.design/types

## 10. Benchmarks de conversão

| Referência | Valor | Fonte |
|---|---|---|
| Abandono de carrinho (média de 50 estudos) | **70,22%** | https://baymard.com/lists/cart-abandonment-rate |
| Abandono de carrinho (dados de plataforma, 2025) | **76,2%** | https://www.smartinsights.com/ecommerce/ecommerce-analytics/ecommerce-conversion-rates/ |
| Conversão mobile × desktop | **2,8% × 3,2%** (média 2,9%) | idem |
| Distribuição de uso | **75% mobile / 25% desktop** | idem |
| Add-to-cart geral | **6,8%** | idem |
| E-commerce, mercado geral (jul/2026) | **2,26%** | https://www.irpcommerce.com/ecommercemarketdata.aspx |
| E-commerce, "Cars and Motorcycling" | **1,82%** | idem |

⚠️ **Todos com amostra predominantemente EUA/UK/EU.** Servem como ordem de grandeza e para calibrar expectativa de
cliente ("1,5% não é fracasso neste setor"), nunca como meta contratual brasileira. Desktop converte ~1,7× melhor que
mobile, mas o gap estreitou — historicamente passava de 2×; e como 3 de cada 4 visitas são mobile, é lá que a
otimização precisa começar.

**O elo com velocidade:** no estudo Deloitte/Google com 37 marcas e 30+ milhões de sessões, **0,1 s** de melhoria
correspondeu a **+8,4%** na conversão de varejo, **+9,2%** no ticket médio e **+9,1%** na progressão página de produto
→ carrinho. ⚠️ Estudo **observacional**, não A/B. A evidência causal disponível é o teste A/B da Vodafone: LCP 31%
melhor → **+8% em vendas**, sem nenhuma mudança visual.
Fonte: https://web.dev/case-studies/milliseconds-make-millions · https://web.dev/case-studies/vodafone

*Números verificados em agosto de 2026. As pesquisas da Baymard e os benchmarks de plataforma são
atualizados periodicamente — reverifique a edição antes de citar percentuais a um cliente.*
