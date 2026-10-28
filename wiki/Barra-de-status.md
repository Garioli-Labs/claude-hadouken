# Barra de status

[English](Status-bar)

## A barra de status, segmento por segmento

A barra mostra só o que é **desta sessão**, numa linha dividida em três pedaços separados por `│`:

```text
Opus 5.5·high │ ctx ▰▰▰▱▱▱▱▱ 37% │ cache ▰▰▰▰▰▰▰▱ 92%
└─────┬─────┘   └──────┬───────┘   └───────┬────────┘
      1                2                   3
```

| # | Segmento | O que quer dizer | De onde vem o número | Cor | O que fazer |
|---|---|---|---|---|---|
| 1 | `Opus 5.5·high` | Modelo e nível de effort **desta sessão**. | O Claude Code manda para a barra a cada atualização. | Sem cor. | Confira antes de uma tarefa grande: é o modelo e o effort que você queria? |
| 2 | `ctx ▰▰▰▱▱▱▱▱ 37%` | **37 %** da janela de contexto desta sessão está ocupada (3 de 8 quadradinhos). | O Claude Code manda para a barra. | Verde abaixo de 70 %, amarelo de 70 % a 84 %, vermelho de 85 % em diante. | Amarelo ou vermelho e vai mudar de assunto? Uma sessão nova (ou `/compact`) começa mais leve. |
| 3 | `cache ▰▰▰▰▰▰▰▱ 92%` | **92 %** do que foi enviado ao modelo nesta sessão veio do cache de prompt. | O Claude Code manda para a barra. | Verde de 80 % em diante, amarelo de 50 % a 79 %, vermelho abaixo de 50 %. | Alto é bom: você reaproveita contexto em vez de pagar por ele de novo. Baixo logo no começo da sessão é normal. |

Os limites da conta (5 horas, semana e Fable) não ficam na barra: são os mesmos em todas as sessões e aparecem uma vez só, no [painel do VS Code](Painel-e-janela-do-VS-Code#o-painel-no-vs-code). A barra continua gravando, a cada atualização, a leitura de 5 horas e 7 dias que o Claude Code manda junto: é dela que saem o painel, os avisos ao Claude e o relatório.

### As barrinhas

Os dois percentuais vêm também numa barrinha de 8 quadradinhos: `▰` é uma casa cheia, `▱` uma vazia, e cada casa vale 12,5 pontos.

- A conta arredonda para a casa mais perto, com duas travas: uso de 1 % ou mais nunca aparece vazio (fica pelo menos uma casa), e a barrinha só enche de todo com 100 %.
- A barrinha é o mesmo número em outra forma: o percentual continua escrito ao lado, e a cor sai do número, nunca da barrinha.
- Indicador sem dado confiável mostra `—`, sem barrinha.

### 1. Modelo·effort

- O nome é o que o Claude Code mostra para o modelo (até 40 caracteres).
- O effort aparece depois do `·` só quando é um dos cinco níveis conhecidos: `low`, `medium`, `high`, `xhigh` ou `max`. Sem effort reconhecido, a barra mostra só o nome do modelo.
- Modelo, effort, contexto e cache são sempre **da sessão onde a barra aparece**. Duas sessões abertas podem mostrar modelos diferentes.

### 2. Contexto (`ctx`)

A janela de contexto é quanto de conversa, arquivos e resultados de ferramentas o modelo consegue considerar de uma vez. `ctx 37%` quer dizer que 37 % dela está ocupada nesta sessão. O número vem do próprio Claude Code. Quanto mais cheio, mais cada resposta carrega; ao mudar de assunto, uma sessão nova costuma sair mais barata.

A cor avisa quando o contexto enche (as faixas de ctx e cache são só visuais: não mandam aviso ao Claude):

| Uso | Cor |
|---|---|
| abaixo de 70 % | verde |
| 70 % a 84 % | amarelo |
| 85 % ou mais | vermelho |

### 3. Cache (`cache`)

A cada resposta, o Claude Code reenvia a conversa inteira ao modelo. O **cache de prompt** guarda o começo dessa conversa por um tempo, e as respostas seguintes o reaproveitam em vez de processar tudo de novo. Ler do cache custa uma fração do preço normal de entrada.

`cache 92%` é a taxa de acerto do cache nesta sessão, como o Claude Code a informa: quanto mais alto, mais contexto foi reaproveitado. Em sessões longas, 90 % ou mais é comum. O número cai no começo de uma sessão, depois de uma pausa maior que a validade do cache e depois de trocar de modelo (o cache é de cada modelo). O relatório mostra o mesmo indicador por projeto, modelo e sessão; veja [Cache de 1 h e de 5 min](Relatorio-de-consumo#cache-de-1-h-e-de-5-min-o-que-é-ttl).

A cor segue o acerto:

| Acerto de cache | Cor |
|---|---|
| 80 % ou mais | verde |
| 50 % a 79 % | amarelo |
| abaixo de 50 % | vermelho |

Vermelho no começo de uma sessão, ou logo depois de trocar de modelo, é normal: o cache ainda está sendo criado.

### A barra em outras situações

![Seis estados da barra: ctx 76% em amarelo; ctx 88% em vermelho; cache 64% em amarelo; cache 31% em vermelho, com ctx 4%, no começo de uma sessão; um effort desconhecido, com só o nome do modelo; e uma sessão sem dado ainda, com travessões e sem barrinha](https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/docs/imagens/barra-estados.svg)

### Quando aparece `—`, e quando a barra fica vazia

**`—` quer dizer "sem dado confiável agora", nunca zero.** Na barra, ele aparece em `ctx` ou em `cache` quando:

- o Claude Code ainda não mandou o número, como numa sessão nova antes da primeira resposta;
- o valor recebido está fora do formato esperado (por exemplo, um percentual fora de 0 a 100).

**Barra vazia é outra coisa.** Numa sessão aberta **antes** da instalação do plugin, o comando da barra não imprime nada, de propósito: o plugin só age em sessões que começaram depois dele. Abra uma sessão nova. Veja [Instalação](Home#instalação).

### Regras que valem para a barra toda

- **Só a sessão.** Modelo, effort, contexto e cache são de cada sessão: duas sessões abertas mostram, cada uma, os seus. O que é da conta fica no [painel do VS Code](Painel-e-janela-do-VS-Code#o-painel-no-vs-code).
- **Percentuais arredondados para baixo.** 89,6 % aparece como `89%`, e a cor sai desse mesmo inteiro, então o número e a cor nunca discordam.
- **Cores só em `ctx` e `cache`**, e só estas: verde, amarelo e vermelho. A cor vale para o segmento inteiro, barrinha incluída; o modelo fica sem cor. A variável [`NO_COLOR`](https://no-color.org/) (definida e não vazia) desliga as cores; as barrinhas continuam.
- **Largura.** A linha do exemplo tem 53 colunas; um nome de modelo longo (até 40 caracteres) a deixa maior. A barra não se corta para caber: veja [Limitações conhecidas](Problemas-comuns#limitações-conhecidas).

---
