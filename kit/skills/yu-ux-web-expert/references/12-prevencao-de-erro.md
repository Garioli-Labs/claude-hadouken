# 12 — Prevenção de erro: poka-yoke aplicado a interface

Como projetar uma tela em que o erro não cabe, em vez de uma tela que avisa depois. Serve ao modo AUDITAR (achar as ações irreversíveis mal defendidas) e ao modo CRIAR (enumerar os erros possíveis antes de desenhar o primeiro campo).

## Índice

1. [Atribuição e origem](#1-atribuição-e-origem)
2. [A reformulação central](#2-a-reformulação-central)
3. [A escada de defesa — níveis 0 a 3](#3-a-escada-de-defesa--níveis-0-a-3)
4. [Desfazer vence confirmar](#4-desfazer-vence-confirmar)
5. [Ações destrutivas por consequência](#5-ações-destrutivas-por-consequência)
6. [As três forcing functions de Norman](#6-as-três-forcing-functions-de-norman)
7. [Diálogo de confirmação que funciona](#7-diálogo-de-confirmação-que-funciona)
8. [Enumerar os erros antes de desenhar a tela](#8-enumerar-os-erros-antes-de-desenhar-a-tela)
9. [Catálogo de dispositivos](#9-catálogo-de-dispositivos)
10. [Perigos de formulário — perigo, dispositivo, nível](#10-perigos-de-formulário--perigo-dispositivo-nível)
11. [Padrões para ação irreversível](#11-padrões-para-ação-irreversível)
12. [Ações em lote](#12-ações-em-lote)
13. [Padrões e adjacência destrutiva](#13-padrões-e-adjacência-destrutiva)
14. [Permissão: esconder não é impedir](#14-permissão-esconder-não-é-impedir)
15. [Onde prevenção de erro encontra acessibilidade](#15-onde-prevenção-de-erro-encontra-acessibilidade)
16. [Contenção — a seção que evita o excesso](#16-contenção--a-seção-que-evita-o-excesso)
17. [Aplicação no contexto brasileiro de agência](#17-aplicação-no-contexto-brasileiro-de-agência)

## 1. Atribuição e origem

O método é **poka-yoke** ("à prova de engano"), formalizado por **Shigeo Shingo** no Sistema Toyota de Produção: dispositivos físicos — gabaritos, encaixes assimétricos, sensores — que tornam o erro de montagem impossível em vez de detectá-lo na inspeção final. Fonte: Shigeo Shingo, *Zero Quality Control: Source Inspection and the Poka-Yoke System* — https://shingo.org/shingo-model/

A tradição de design chegou ao mesmo lugar por outro caminho: as **forcing functions** de **Don Norman** e a **heurística nº 5 de Jakob Nielsen — Error Prevention**, que diz literalmente que evitar o problema é melhor que uma boa mensagem de erro. Fontes: NN/g, *The Design of Everyday Things* — https://www.nngroup.com/books/design-everyday-things-revised/ · NN/g, *10 Usability Heuristics* — https://www.nngroup.com/articles/ten-usability-heuristics/

Esta adaptação para interface web — a escada de níveis, o catálogo de dispositivos e as tabelas de mapeamento — vem do repositório de licença MIT **`rainmanjam/poka-yoke`** (`plugins/poka-yoke/skills/ux/SKILL.md` e `plugins/poka-yoke/references/ux-patterns.md`), traduzida, adaptada e ampliada. Fonte: https://github.com/rainmanjam/poka-yoke

Onde o texto diz `[julgamento aplicado]`, a afirmação é nossa: não está na fonte e não tem estudo por trás.

## 2. A reformulação central

**Uma mensagem de erro é uma falha do design, não um recurso dele.**

Se a interface consegue dizer à pessoa que ela errou, quase sempre ela também conseguiria ter impedido o erro. A informação necessária para escrever a mensagem já existia — só chegou tarde. Validação que dispara depois do envio é o nível mais fraco de defesa; um campo que não consegue conter o valor errado é o mais forte. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

Isso muda a **ordem do trabalho**, e é aí que está o valor prático:

- Em auditoria, cada mensagem de erro vira uma pergunta: *este erro precisava ser possível?* A lista de mensagens de erro de um produto é um mapa dos lugares onde o design desistiu. `[julgamento aplicado]`
- Em criação, a enumeração dos erros vem **antes** do wireframe, porque a forma do controle é a defesa. Escolher "campo de texto livre" e depois escrever seis regras de validação é ter aceitado o nível fraco por omissão.
- Em revisão de código, o handler de mutação é mais informativo que o screenshot: é ali que se vê se a ação é recuperável, idempotente e realmente autorizada.

Consequência incômoda: boa parte do polimento de microcopy de erro é otimização de sintoma. Escrever melhor a mensagem tem valor, mas é o último recurso, não o primeiro. `[julgamento aplicado]`

## 3. A escada de defesa — níveis 0 a 3

Quatro níveis, do mais forte ao mais fraco. Adaptado de `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

| Nível | Nome | Significado | Exemplos em web |
|---|---|---|---|
| **1** | **Controle** | A ação errada **não pode ser tomada**; o estado inválido não é representável | Date picker que não oferece datas indisponíveis · quantidade limitada pelo estoque no próprio `max` · `<select>` de UF em vez de campo livre · botão de exclusão **ausente** para quem não tem permissão · soft delete, em que o erro não tem consequência permanente |
| **2** | **Aviso** | Continua possível, mas é sinalizado **no momento em que acontece** | Validação inline no `blur` do campo recém-deixado · contador de caracteres que fica vermelho ao estourar · banner "isto vai afetar 4.312 usuários" · alerta de conflito ao escolher o horário |
| **3** | **Detecção** | O erro é pego **depois do envio** | Resumo de erros no topo após o submit · rejeição pelo servidor · e-mail de "não conseguimos processar" · chamado de suporte |
| **0** | **Depende de leitura** | Só funciona se a pessoa ler, entender e lembrar | Texto de apoio sob o campo · tooltip no ícone de interrogação · aviso num modal que todo mundo fecha · FAQ · a frase "esta ação não pode ser desfeita" solta |

**Este eixo é diferente da severidade, e confundir os dois é o erro de leitura mais comum.** A **severidade (P0–P3)** mede o quanto dói quando o problema acontece; o **nível (1–3, 0)** mede a força da defesa que existe hoje.

Os dois se combinam. Um problema **P1 defendido no nível 0 é pior** que o mesmo P1 defendido no nível 1: mesma dor, proteção incomparavelmente menor. Ao classificar um achado, registre os dois — "P1 · defesa atual nível 0 · dispositivo proposto leva a nível 1". O nível é observável no código, o que torna a recomendação verificável depois em vez de ser uma opinião sobre gravidade. `[julgamento aplicado]`

Regra de subida: sempre que um achado estiver em nível 3 ou 0, pergunte o que faria dele nível 1. Se o custo for de backend (soft delete, lixeira, idempotência), diga isso — é justamente por ser mudança de backend que o dispositivo mais forte é o menos usado. Fonte: `rainmanjam/poka-yoke`.

## 4. Desfazer vence confirmar

**Cegueira por repetição.** Um diálogo visto cinquenta vezes por dia deixa de ser ponto de decisão e vira reflexo motor: a pessoa aperta "Confirmar" com o mesmo automatismo com que aperta "OK". O diálogo então não protege ninguém e cobra atrito de **toda** ação legítima — é o equivalente, em interface, de um comentário no código dizendo "cuidado aqui": presente, visível e inerte. Fontes: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke · Aza Raskin, *Never Use a Warning When You Mean Undo* — https://alistapart.com/article/neveruseawarning/

Um aviso pergunta **antes** de a pessoa saber se errou. Desfazer age **depois**, quando o erro já é conhecido: custa zero atrito no caminho feliz e cobre erros que a confirmação jamais detectaria (item certo, projeto errado). Fonte: Aza Raskin — https://alistapart.com/article/neveruseawarning/

**Ordem de preferência para ação destrutiva, do mais forte ao mais fraco:**

**1. Torne reversível.** Soft delete, lixeira com retenção, histórico de versões. O erro deixa de ter consequência permanente e não precisa de portão nenhum. É a resposta real e a mais subutilizada, porque é mudança de backend e não de UI. Nível 1.

**2. Desfazer com janela de carência.** Execute imediatamente e mostre "Removido. Desfazer" por alguns segundos. Variante para o que é irreversível uma vez executado: **commit adiado** — segure a ação por N segundos e descarte-a se a pessoa desfizer, que é o mecanismo do *undo send* do Gmail. Nível 1 na prática, porque o estado final errado nunca chega a existir. Fonte: Google — *Undo sending your mail* — https://support.google.com/mail/answer/2819488

**3. Exija ação proporcional à consequência.** Digitar o nome do recurso (exclusão de repositório no GitHub) funciona porque **não pode ser feito por reflexo**. Reserve para o irreversível de raio de dano alto; usado em tudo vira teatro e as pessoas copiam e colam para atravessar. Fonte: GitHub Docs — *Deleting a repository* — https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository

**4. Diálogo que declara a consequência específica.** "Excluir 3 projetos e 1.204 arquivos permanentemente?" é uma verificação real — nomeia objeto e escala, e é o equivalente em interface da **inspeção de valor fixo** do chão de fábrica. "Tem certeza?" não é: pergunta sobre a determinação da pessoa, e a determinação dela não é o que está em dúvida — os fatos é que estão. "Esta ação não pode ser desfeita", sozinha, não diz o que se perde nem quanto. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

## 5. Ações destrutivas por consequência

Adaptado de `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

| Consequência | Dispositivo adequado | Nível |
|---|---|---|
| Recuperável e trivial (rascunho, filtro, ordenação) | Nenhum — apenas execute | — |
| Recuperável com esforço (arquivar, despublicar) | Ação imediata + toast "Desfazer", 5–10 s | Controle |
| Perda de dado, recuperável no servidor | Soft delete + lixeira com retenção; **sem diálogo nenhum** | Controle |
| Irreversível, valor baixo (um item) | Diálogo que **nomeia o item específico** | Aviso |
| Irreversível, valor alto (lote, conta, repositório) | Digitar o nome do recurso para confirmar | Aviso |
| Irreversível **e externo** (enviar, publicar, cobrar) | Prévia exata do que vai acontecer + janela de atraso | Controle |

A linha que mais muda projeto é a terceira: onde existe lixeira com retenção, o diálogo de confirmação vira ruído puro e deve ser **removido**, não melhorado.

## 6. As três forcing functions de Norman

Fonte: Don Norman, *The Design of Everyday Things* — https://www.nngroup.com/books/design-everyday-things-revised/ · adaptação web de `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

| Função | Definição | Exemplo web |
|---|---|---|
| **Interlock** | A **ordem** é imposta: o passo seguinte só existe depois do anterior | Checkout que só libera pagamento após endereço válido · "Publicar" indisponível antes de o upload terminar · 2FA que só aparece após senha correta |
| **Lock-in** | Não dá para **sair** sem reconhecer o estado atual | `beforeunload` em formulário com alterações não salvas · aviso ao fechar a aba com upload em curso · sair do editor com rascunho pendente |
| **Lockout** | A ação fica **indisponível** até as pré-condições existirem | "Finalizar compra" ausente com carrinho vazio · "Convidar time" bloqueado até o plano permitir · exportar relatório indisponível antes de haver dado |

Cuidado com lock-in: `beforeunload` é a forcing function mais fácil de abusar. Em página sem alteração real, ou em formulário de newsletter, vira retenção coerciva e não prevenção de erro. Use só quando há trabalho da pessoa em risco de fato. `[julgamento aplicado]`

## 7. Diálogo de confirmação que funciona

Se o diálogo for mesmo necessário, ele precisa dos **quatro** requisitos, não de três. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

1. **Nomeia o objeto específico.** "Excluir `production-api`?" — não "Excluir item?".
2. **Declara a escala.** "3 projetos e 1.204 arquivos."
3. **Declara a reversibilidade com honestidade.** Se há lixeira de 30 dias, diga; alegar permanência que não existe treina a pessoa a desconfiar dos seus avisos, inclusive dos verdadeiros.
4. **Rotula o botão com o verbo da ação.** "Excluir para sempre" / "Cancelar" — nunca "OK" / "Cancelar", que obriga a reconstruir qual palavra corresponde a qual consequência.

**O que torna um diálogo inútil:** aparecer em toda ação · cobrir ação reversível · perguntar "Tem certeza?" · dizer só "esta ação não pode ser desfeita" sem dizer o que se perde · colocar o **foco padrão no botão destrutivo** · dar o mesmo peso visual às duas opções · usar `window.confirm()`, que não permite nomear objeto nem escala.

## 8. Enumerar os erros antes de desenhar a tela

Ritual do modo CRIAR: seis perguntas respondidas por escrito antes do wireframe. Cada resposta gera um dispositivo, e o dispositivo determina a forma do controle. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

```
[ ] 1. O que a pessoa consegue INSERIR de errado — e ela consegue mesmo inserir?
       Texto livre onde existe escolha restrita é perigo. Todo campo livre é um lugar para errar.
[ ] 2. O que aqui é IRREVERSÍVEL?
       Excluir, enviar, publicar, pagar, cancelar assinatura, rotacionar chave.
       Cada um pede dispositivo dimensionado ao raio de dano.
[ ] 3. O que está ADJACENTE a algo perigoso?
       "Salvar" ao lado de "Excluir" produz clique errado para sempre.
[ ] 4. O que a pessoa precisa LEMBRAR ou CARREGAR entre passos?
       Tudo que ela tiver de manter na cabeça atravessando uma página será perdido.
[ ] 5. O que acontece com DUPLO CLIQUE, refresh no meio do envio, ou botão voltar?
       Envio duplo é a versão de interface do retry não idempotente — e cobra a pessoa duas vezes.
[ ] 6. Qual é o ESTADO deste controle quando o dado falta, é enorme ou está lento?
       Vazio, carregando, erro e overflow são onde a interface improvisa.
```

Fechamento obrigatório: três ou quatro linhas dizendo **quais usos errados a forma escolhida torna impossíveis e em que nível**, e **o que ficou possível de propósito e por quê**. Essa nota é o que impede o dispositivo de ser removido em seis meses por alguém que não enxerga a razão dele. Fonte: `rainmanjam/poka-yoke`.

## 9. Catálogo de dispositivos

### 9.1 Restringir a entrada em vez de validar

Picker em vez de campo de texto; stepper em vez de campo numérico; `<select>` em vez de digitação; máscara que só aceita a forma válida; `type` e `inputmode` corretos para o teclado móvel oferecer as teclas certas; `min`/`max`/ `maxlength` que o controle realmente aplica. **Todo valor que o campo não consegue conter é uma regra de validação que você nunca precisa escrever e um erro que a pessoa nunca vê.** Nível 1. Fonte: `rainmanjam/poka-yoke`.

### 9.2 Desabilitar a ação até ela poder dar certo — e sempre dizer por quê

Botão cinza sem explicação é um beco sem saída. Emparelhe sempre com o requisito não cumprido, específico. E escolha deliberadamente entre as duas formas técnicas, que **não** são equivalentes:

```html
<!-- `disabled` nativo: retira o botão do tab order.
     O leitor de tela nunca chega nele, então o motivo tem de morar em texto adjacente alcançável. -->
<button type="submit" disabled>Enviar pedido</button>
<p class="form-hint">Falta escolher a forma de pagamento.</p>

<!-- `aria-disabled`: mantém o botão focável e anuncia o motivo NO PRÓPRIO controle.
     O handler é quem recusa o envio — o atributo sozinho não bloqueia nada. -->
<button type="submit" aria-disabled="true" aria-describedby="motivo-envio">Enviar pedido</button>
<p id="motivo-envio">Falta escolher a forma de pagamento.</p>
```

```js
form.addEventListener('submit', (e) => {
  if (botao.getAttribute('aria-disabled') === 'true') {
    e.preventDefault();
    document.getElementById('motivo-envio').focus(); // leve a pessoa ao motivo
  }
});
```

Amarração normativa: o botão precisa ter nome, papel e valor programáticos com o estado exposto — **WCAG 4.1.2 Name, Role, Value (A)**; o motivo anunciado dinamicamente é mensagem de status — **4.1.3 Status Messages (AA)**; e dizer como resolver é **3.3.3 Error Suggestion (AA)**. Fonte: W3C — *WCAG 2.2* — https://www.w3.org/TR/WCAG22/ · MDN — *aria-disabled* — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-disabled

Escolha: `disabled` nativo quando o motivo já está claramente visível ao lado; `aria-disabled` quando o motivo é a única informação que resolve o impasse e precisa ser alcançável por teclado. `[julgamento aplicado]`

### 9.3 Validar no momento certo

No `blur` do campo recém-deixado — **nunca a cada tecla enquanto a pessoa ainda digita**. Marcar um e-mail meio digitado como inválido treina a pessoa a ignorar toda a sua validação. Revalide no submit, mova o **foco para o primeiro campo com erro** e limpe o erro assim que ele for corrigido ("recompense cedo, puna tarde"). Fontes: `rainmanjam/poka-yoke` · Luke Wroblewski / Etre, *Inline Validation in Web Forms* — https://alistapart.com/article/inline-validation-in-web-forms/

WCAG: **3.3.1 Error Identification (A)** — erro em texto, associado ao campo por `aria-describedby` + `aria-invalid="true"`; **3.3.3 Error Suggestion (AA)** — dizer como corrigir. Fonte: https://www.w3.org/TR/WCAG22/

### 9.4 Preservar o trabalho da pessoa

Perder dado digitado para um erro de validação, expiração de sessão ou botão voltar é um dos erros mais comuns e mais irritantes que uma interface permite. Autosave de rascunho, restauração ao voltar e **jamais limpar o formulário num envio que falhou**. Fonte: `rainmanjam/poka-yoke`.

WCAG: **3.3.7 Redundant Entry (A)** — não pedir de novo o que já foi informado no mesmo processo; **2.2.1 Timing Adjustable (A)** — limite de tempo que expira no meio da tarefa precisa ser ajustável ou extensível. Fonte: https://www.w3.org/TR/WCAG22/

### 9.5 Padrão seguro em vez de padrão conveniente

A opção pré-selecionada deve ser aquela cuja **consequência é menor se escolhida sem atenção**: menor privilégio, menor escopo, privado em vez de público, opt-in em vez de opt-out. Muita gente nunca muda um padrão — então um padrão é uma decisão que você toma pela maioria dos seus usuários. Fonte: `rainmanjam/poka-yoke`.

### 9.6 Impedir envio duplo estruturalmente

Desabilitar o botão no submit **e** carregar uma chave de idempotência na requisição. A UI sozinha não resolve, porque o botão não é o único caminho: refresh, botão voltar e rede instável também reenviam. Fonte: `rainmanjam/poka-yoke` · padrão de chave de idempotência: Stripe — https://docs.stripe.com/api/idempotent_requests

```js
// Uma chave por tentativa de negócio, não por requisição:
// gerada quando o formulário é montado, reusada em todo retry.
form.dataset.idempotencyKey ||= crypto.randomUUID();

botao.disabled = true;                      // impede o segundo clique
await fetch('/api/orcamento', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': form.dataset.idempotencyKey,   // impede o refresh e o retry de rede
  },
  body: JSON.stringify(payload),
});
```

O servidor guarda o resultado por chave e devolve a mesma resposta em repetição, sem criar segundo registro. Sem isso, "desabilitei o botão" é nível 2 se disfarçando de nível 1. `[julgamento aplicado]`

### 9.7 Mostrar a escala antes de ação em lote

"Isto vai enviar e-mail para 12.400 pessoas" é inspeção de valor fixo e interrompe o erro que um diálogo genérico não interrompe — porque a pessoa reconhece que o **número** está errado mesmo quando não reconhece que a ação está errada. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

## 10. Perigos de formulário — perigo, dispositivo, nível

Adaptado de `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

| Perigo | Dispositivo | Nível |
|---|---|---|
| Valor errado digitado | Controle restrito: picker, stepper, `<select>`, máscara | Controle |
| Formato errado | `type` + `inputmode` + `pattern`; parse no `blur` | Aviso |
| Fora da faixa | `min`/`max` aplicados pelo próprio controle | Controle |
| Campo obrigatório esquecido | Submit desabilitado + motivo específico visível | Controle |
| Opção errada escolhida sem atenção | Opção mais segura como padrão | Controle |
| Trabalho perdido | Autosave de rascunho; nunca limpar em submit falho | Controle |
| Envio duplo | Desabilitar no submit **e** chave de idempotência | Controle |
| Erro não compreendido | Mensagem diz **como corrigir**; foco vai para o campo | Aviso |
| Linha errada acionada numa tabela | Exibir o valor identificador dentro da confirmação da ação | Aviso |

## 11. Padrões para ação irreversível

Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

**Desfazer com janela de carência.** Execute na UI imediatamente, segure o efeito por N segundos, ofereça retirada.

```js
function removerItem(id) {
  ocultarNaUI(id);                                   // efeito imediato, caminho feliz sem atrito
  const timer = setTimeout(() => confirmarRemocao(id), 7000);
  mostrarToast('Item removido.', {
    role: 'status',                                  // anunciado sem roubar o foco
    duracaoMs: 7000,                                 // não pode sumir enquanto tiver foco
    acao: { rotulo: 'Desfazer', onClick: () => { clearTimeout(timer); restaurarNaUI(id); } },
  });
}
```

Regra que quase todo mundo quebra: se "Desfazer" só existe dentro do toast, ele precisa ser alcançável por teclado e o toast **não pode desaparecer enquanto tiver foco** — senão a única saída do erro é inacessível. WCAG **2.2.1 Timing Adjustable (A)** e **4.1.3 Status Messages (AA)**. Fonte: https://www.w3.org/TR/WCAG22/

**Digitar o nome para confirmar.** Eleva o custo da ação reflexa exigindo reprodução do nome do objeto. Só para raio de dano alto.

**Dupla aprovação (two-key / segundo aprovador).** Para decisões que não deveriam ser de uma pessoa só: exclusão de conta corporativa, disparo para toda a base, alteração de preço em produção.

**Agendado com janela de cancelamento.** "Isto será executado em 15 minutos" para operações em lote — dá tempo ao arrependimento, que costuma levar mais que os 5 segundos de um toast.

**Prever o diff.** Mostrar exatamente o que vai mudar antes de aplicar: quais registros, de que valor para que valor. É o dispositivo mais forte para importação de planilha e edição em massa. `[julgamento aplicado]`

## 12. Ações em lote

O perigo específico do lote é a **invisibilidade da escala**: a pessoa vê 50 linhas na tela e age achando que são 50. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

- Mostre a contagem afetada **antes** da ação, com o número exato.
- Distinga com clareza **"selecionar os 50 desta tela"** de **"selecionar todos os 40.000 que casam com o filtro"**: são duas ações diferentes e nunca podem compartilhar o mesmo checkbox. A segunda pede confirmação própria, com o total escrito por extenso na frase.
- Acima de um limite, exija passo adicional ou limite a seleção.
- Rode contra uma prévia antes de aplicar.
- Torne o resultado desfazível **em uma única ação** — desfazer que exige refazer 40.000 operações à mão não é desfazer.

## 13. Padrões e adjacência destrutiva

O padrão é o que a maioria desatenta recebe: escolha a opção de menor consequência se escolhida sem cuidado. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

- **Nunca** coloque ação destrutiva colada a uma ação benigna frequente. "Salvar" ao lado de "Excluir" gera clique errado para sempre, e nenhuma quantidade de confirmação conserta erro de mira.
- **Nunca** dê às duas o mesmo peso visual. Destrutivo não é botão primário.
- **Nunca** faça do destrutivo o foco padrão de um diálogo, nem o alvo do `Enter`.
- Mantenha ação destrutiva fora do fluxo principal: menu de contexto, configurações, abaixo da dobra.
- Separe espacialmente. O alvo mínimo normativo é **24×24 CSS px** (WCAG **2.5.8 Target Size (Minimum)**, AA), e a exceção de *spacing* desse critério é literalmente sobre distância entre alvos — projetar com folga resolve o critério e o erro de mira de uma vez. Fonte: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## 14. Permissão: esconder não é impedir

**Esconder um botão é apresentação, não autorização.** O endpoint continua lá: quem sabe a URL, quem inspeciona o bundle e qualquer script continuam podendo executar a ação. O servidor precisa **recusar**. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

A regra é **esconder E recusar**: esconder porque expor ação impossível é mau design, e recusar na API porque é ali que a autorização acontece. Um dos dois sozinho é falha — só recusar frustra, só esconder é falso.

É o achado que mais aparece em site feito por agência, sobretudo em painel administrativo com níveis de acesso implementados no front-end: `if (user.role === 'admin')` controlando renderização, com a rota da API aberta atrás. Vale checar sempre que houver qualquer noção de papel de usuário. `[julgamento aplicado]`

## 15. Onde prevenção de erro encontra acessibilidade

Vários dispositivos servem aos dois objetivos ao mesmo tempo, o que os torna os mais fáceis de aprovar com o cliente: resolvem conformidade e usabilidade com o mesmo orçamento. `[julgamento aplicado]` Lista-base: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke · critérios: W3C — https://www.w3.org/TR/WCAG22/

| Dispositivo | Critério WCAG |
|---|---|
| `<label for>` real, associado ao `id` do campo (placeholder não é rótulo) | **3.3.2 Labels or Instructions (A)** |
| Foco movido para o primeiro erro num envio que falhou | **2.4.3 Focus Order (A)** + **3.3.1 Error Identification (A)** |
| Erro identificado por mais que cor — ícone e texto além da borda vermelha | **1.4.1 Use of Color (A)** |
| Mensagem que diz como corrigir, não só o que está errado | **3.3.3 Error Suggestion (AA)** |
| Alvos grandes o bastante para não errar o toque | **2.5.8 Target Size (Minimum) (AA)** — 24×24 CSS px |
| Sem limite de tempo que expire no meio do preenchimento | **2.2.1 Timing Adjustable (A)** — estender ≥10×, avisar com ≥20 s |
| Não pedir de novo o dado já informado no mesmo fluxo | **3.3.7 Redundant Entry (A)** |
| `autocomplete` com token correto (`name`, `email`, `tel`, `postal-code`) | **1.3.5 Identify Input Purpose (AA)** |
| Reversibilidade, verificação ou confirmação em transação jurídica, financeira ou que altera dado | **3.3.4 Error Prevention (Legal, Financial, Data) (AA)** |
| Estado do botão bloqueado exposto programaticamente, com motivo anunciado | **4.1.2 Name, Role, Value (A)** + **4.1.3 Status Messages (AA)** |

O critério **3.3.4** merece destaque: é a única exigência normativa direta desta referência. Compra, contrato, cancelamento de assinatura e alteração de dado precisam ser **reversíveis, verificados ou confirmados** — e "verificado" ali significa checagem dos dados com oportunidade de corrigir, não um "tem certeza?". Fonte: https://www.w3.org/TR/WCAG22/

## 16. Contenção — a seção que evita o excesso

Esta é a seção mais importante do arquivo, e a que mais se ignora depois de ler as anteriores.

**Atrito é um custo pago por todo usuário em toda utilização legítima. O erro acontece raramente.** A conta quase sempre é desfavorável: um diálogo de dois segundos visto mil vezes por semana gasta mais tempo humano do que o erro que evitaria — e ainda por cima não evita o erro, porque a repetição o tornou invisível. Fonte: `rainmanjam/poka-yoke` — https://github.com/rainmanjam/poka-yoke

Confirmação em ação reversível, validação em campo opcional e "tem certeza?" em salvamento comum tornam a interface exaustiva **sem prevenir nada**, e treinam a pessoa a fechar automaticamente justamente os diálogos que importam. O excesso de proteção destrói a proteção que existia. Fonte: `rainmanjam/poka-yoke`.

Mire os dispositivos no que é **irreversível e consequente**; deixe todo o resto rápido e reversível. Na dúvida entre adicionar um portão e adicionar um desfazer, adicione o desfazer.

Teste de sanidade antes de propor qualquer dispositivo novo: `[julgamento aplicado]`

1. Esta ação é reversível? Se sim, o dispositivo correto é tornar a reversão visível, não impedir a ação.
2. Quantas vezes por semana uma pessoa comum encontra este portão? Acima de umas poucas, ele já é reflexo.
3. O portão inspeciona um **fato** (objeto, contagem, valor) ou apenas a determinação da pessoa? Se for o segundo, ele não faz nada.

## 17. Aplicação no contexto brasileiro de agência

Onde isto aparece de verdade em landing page e site de varejo local. Todo este bloco é `[julgamento aplicado]`: adaptação nossa ao tipo de trabalho que a skill mais atende, não achado de estudo.

**Envio duplo do formulário de orçamento.** O caso mais frequente e o mais caro. A pessoa clica em "Enviar", nada visível acontece por três segundos numa rede móvel ruim, ela clica de novo — chegam dois leads idênticos no CRM e duas notificações no WhatsApp do vendedor, que liga duas vezes e passa impressão de bagunça. Dispositivo: desabilitar o botão no submit **e** chave de idempotência (§ 9.6). Só desabilitar o botão não cobre refresh nem botão voltar.

**Botão de enviar sem estado de carregamento.** É a causa raiz do item acima. O botão precisa mudar visivelmente no clique — rótulo "Enviando…", `aria-busy="true"` — porque ausência de resposta é lida como falha, e a reação natural à falha é repetir a ação.

**Formulário que limpa tudo no erro.** Comum em submit tradicional que recarrega a página sem repopular os campos. A pessoa preenche oito campos, erra o formato do telefone e recebe um formulário em branco: é a forma mais eficiente de perder um lead. Preserve sempre o que foi digitado (§ 9.4).

**Máscara de telefone e CEP.** Telefone brasileiro tem 8 e 9 dígitos e a máscara precisa aceitar os dois; máscara na exibição, valor limpo no envio, e **nunca** impedir colagem — normalize o colado. CEP com `inputmode="numeric"` e `autocomplete="postal-code"`, preenchendo logradouro, bairro, cidade e UF, sempre com preenchimento manual como alternativa quando a consulta falhar. Isso é nível 1 substituindo seis regras de validação.

**Campo de CPF que aceita qualquer coisa.** Campo livre engole "não tenho", "123.456.789-00" e o CPF do vizinho. CPF tem dígito verificador: validar o DV no `blur` é uma linha de lógica e converte um lead inútil — descoberto semanas depois na emissão da nota — em correção de dois segundos. Restrinja o teclado, aplique máscara e valide o DV; se o campo não for indispensável à tarefa, a defesa mais forte é removê-lo.

**"Remover item" no carrinho sem desfazer.** Em loja pequena, o clique errado no ícone de lixeira no mobile — alvo pequeno, colado ao seletor de quantidade — obriga a reencontrar o produto na navegação. Dispositivos: separação e tamanho de alvo (§ 13) e toast "Item removido. Desfazer" com janela de carência (§ 11). É o melhor retorno por esforço em carrinho de baixo volume.

**Cancelamento de assinatura e contratação online.** Quando o site vende plano, assinatura ou contrato recorrente, o fluxo entra em **WCAG 3.3.4 (Legal, Financial, Data)**: reversível, verificado ou confirmado. Verificação aqui é uma tela de revisão com os dados e a possibilidade de corrigir, não um "tem certeza?". Fonte: https://www.w3.org/TR/WCAG22/
