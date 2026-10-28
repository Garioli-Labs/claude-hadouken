# hadouken v0.5.6: plano da conta, agentes ociosos e tokens mínimos

**Status:** RASCUNHO. Escrito durante o fechamento da v0.5.5, sem código. As decisões marcadas "decisão minha" seguem a ordem do Sr. Garioli ("decida e registre"); ele revisa antes do plano.

**Princípio, nas palavras dele:** "O hadouken não pode atrapalhar, a função dele é o Claude não fazer doideras e comer a cota a toa." Tudo aqui é aviso ou sugestão; nada novo bloqueia prompt.

## 1. Escopo

Vem do pedido de 2026-10-16 (renumerado de 0.5.5 para 0.5.6) e das queixas da sessão do Metrô SP (21–22/10):

| # | Item | Origem |
|---|------|--------|
| A | Plano da conta (Pro, Max 5x, Max 20x) nas estimativas e no ritmo | pedido 2026-10-16, item 1 |
| B | Agentes ociosos: sessão `claude` aberta e parada gastando RAM/CPU | pedido 2026-10-16, item 2 |
| C | Máximo de avanço com mínimo de tokens (roteamento da v0.5.3) | pedido 2026-10-16, item 3 |
| D | Trava noturna: sessão parada a noite toda e vigia repetindo "nada mudou" | Metrô SP, item 5 |
| E | Caminho do `.vsix` para instalar o painel em outro PC | Metrô SP, item 7 |

Fora: os itens 4 e 6 do Metrô SP (hooks nos settings do projeto e `claude plugin install` via ssh) saíram na v0.5.4, com o liga/desliga das quatro travas fixas na janela do VS Code.

## 2. Não-objetivos e anti-objetivos

- Nunca ler `~/.claude/.credentials.json` nem outro arquivo com token de conta, nem para descobrir o plano.
- Nunca encerrar sessão `claude` do usuário. A v0.5.5 só encerra processo do próprio hadouken; isso não muda.
- Nenhum aviso repetido: cada aviso novo é por episódio, como os da saúde (v0.5.5 §6.B).
- Nada de chamada de rede nova.
- Anti-objetivo: uma estimativa "por plano" que piore a previsão de quem não informou o plano. Sem plano conhecido, tudo funciona como na v0.5.5.

## 3. A. Plano da conta

**Problema.** As porcentagens de 5 h e 7 d já são da conta inteira, então a previsão de estouro não depende do plano. O que depende: quanto um despacho custa em pontos percentuais (um subagente Opus de 200 mil tokens é ~1% num Max 20x e muito mais num Pro), o "~X mil tokens poupados" do resumo da semana e a folga que o roteamento deve exigir antes de aceitar modelo caro.

**Decisão minha: item de config `conta.plano` com `auto` (padrão), `pro`, `max5`, `max20`.**
- `auto` infere o plano pela razão tokens por ponto percentual: o hadouken já tem os tokens das respostas (índice dos transcripts) e o histórico das porcentagens (`estado.json`). Com ao menos 3 janelas de 5 h com variação ≥ 10 pontos, a mediana de tokens/ponto cai numa faixa por plano. As faixas são calibradas com dado real antes do plano de implementação (ver §8).
- Inferência incerta (faixas sobrepostas, poucos pontos): `desconhecido`, e vale o comportamento da v0.5.5.
- O plano aparece no `/hadouken:limites`, no `/hadouken:saude` (seção Economia) e na janela do VS Code, com "(inferido)" quando veio do `auto`. Um clique na janela fixa o valor.

**Usos:**
1. Custo de um despacho em pontos: a guarda e o roteamento passam a dizer "este despacho custa ~3% da semana" em vez de só tokens.
2. Tokens poupados no resumo da semana passam a vir também em % da semana.
3. Folga do roteamento: no Pro, o limiar que pergunta antes de modelo caro sobe a mesma conta em pontos (o mesmo despacho pesa mais).

## 4. B. Agentes ociosos

**Problema.** Sessões `claude` antigas ficam abertas (terminal esquecido, VS Code de outro projeto), cada uma com 300–600 MB de RAM.

**Decisão minha.** O coletor da v0.5.5 já classifica processo `claude` (`processos.js`, classe `claude`). Acrescenta:
- **Ociosa** = processo `claude` com CPU < 1% em 3 coletas seguidas e o transcript da sessão dele sem linha nova há ≥ 30 min. A ligação processo ↔ transcript vem do `cwd` e da data de modificação; sem ligação segura, não conta como ociosa (falso negativo é melhor que falso positivo).
- **Aviso ao usuário,** uma vez por episódio: "hadouken: 2 sessões do Claude paradas há mais de 30 min ocupam 1,1 GB. Fechar libera memória para esta." O aviso traz o projeto de cada uma, nunca o conteúdo.
- **Ao Claude da sessão ativa,** só com RAM amarela ou pior: uma linha com o número liberável, para ele saber que há folga se o usuário fechar. Ele não recebe pid nem caminho.
- Janela do VS Code, aba Saúde: lista das ociosas com o projeto e o tempo parado. O botão só copia o comando de fechar; não executa nada.

## 5. C. Tokens mínimos

**Decisão minha:** nada de regra nova de roteamento; a v0.5.3/0.5.4 já decide modelo, effort e agente. O ganho vem de medir e mostrar:
- O resumo da semana (v0.5.5 §6.J) ganha "despachos que o roteamento rebaixou e quanto isso valeu em % da semana" (depende de A).
- Nova contagem: **leitura repetida**, quando o mesmo arquivo grande (≥ 2 mil linhas) é lido por inteiro 3 vezes na mesma sessão. Ela vira uma linha ao Claude ("o arquivo X já foi lido 3 vezes; use offset/limit ou Grep"), uma vez por arquivo e sessão. Vem do PostToolUse do Read, que já existe para a P5.

## 6. D. Noite sem desperdício

**Problema (Metrô SP).** A trava de projeção disparou às 01h50 e a sessão ficou parada a noite toda. Um vigia de 30 min (`/loop`) repetia "nada mudou" e gastava cota a cada acordada.

**Decisão minha:**
1. **Aviso único no lugar do repetido.** Quando o mesmo prompt de loop volta com a guarda travada e nada mudou, a guarda responde uma vez com o texto completo e, nas repetições seguintes do mesmo episódio, com uma linha curta. A linha diz que a guarda segue travada até HH:MM e que o loop pode esperar até lá. Isso corta tokens sem bloquear nada novo.
2. **Liberação noturna combinada.** `/hadouken:liberar noite` (ou o botão na janela) libera a trava de projeção até as 07h00 locais, só ela, com o teto de gasto que o usuário confirmar (padrão: até 90% da semana). As outras travas seguem. Conta como liberação explícita do usuário, como as da v0.5.3.

## 7. E. Painel em outro PC

O instalador e a wiki (`Painel-e-janela-do-VS-Code.md` e par) passam a mostrar onde fica o `.vsix` e o comando `code --install-extension <caminho>`. É só documentação e uma linha no fim do instalador.

## 8. A decidir antes do plano (pesquisa barata)

1. Faixas de tokens por ponto percentual por plano, a calibrar com dado real (as sessões do Sr. Garioli num Max e, se houver, uma conta Pro). Sem calibração confiável, A sai só com o valor manual e `auto` fica para depois.
2. Como ligar processo `claude` ↔ transcript com segurança no Windows, onde o `cwd` de outro processo não é legível sem privilégio. Alternativa: a data do transcript mais recente por projeto aberto.
3. Se o PostToolUse do Read cabe no orçamento de tempo dos hooks (40 ms das partes opcionais) com a contagem por sessão.

## 9. Ordem sugerida

E (barato, só docs) → D.1 (aviso único, corta gasto já) → B → A (depende da calibração) → C (depende de A) → D.2.
