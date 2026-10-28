# v0.5.3, parte VS Code: limites configuráveis, janela, logo animada, aviso de versão nova, README curto e wiki

Data: 2026-10-16. Status: desenho aprovado em conversa, parte por parte. Esta spec aguarda a revisão do Sr. Garioli.

A v0.5.3 tem duas specs. Esta cobre tudo o que o usuário vê e configura. A outra, que ainda vai passar por brainstorming, cobre o roteamento de modelo, effort e agente e as otimizações de consumo. A v0.5.4 fica só com as verificações de segurança, estabilidade e compatibilidade.

Emenda de 2026-10-16: a janela ganha a aba Roteamento (§4.1), aprovada no desenho da spec de roteamento.

Emenda 2 de 2026-10-16: o pedido do Sr. Garioli foi "As aparências do hadouken podem ser algo bem '8 bits/vintage'". A logo, os segmentos e a janela passam a ter o estilo 8 bits descrito na §4.5.

Emenda 3 de 2026-10-28: o pedido do Sr. Garioli foi "o hadouken tá mto chato; trava tudo toda hora. Quero que, dentro dessa interface, o usuário possa mudar todas as configurações dele". Isso traz duas mudanças, descritas na §12:
- a correção do falso positivo do caminho na P4;
- quatro interruptores de proteção, mostrados na janela e no `/hadouken:limites`.

## 1. O que o Sr. Garioli pediu

Tudo o que está entre aspas abaixo são palavras dele.

1. **Limites configuráveis:** a guarda, as faixas da barra e os alertas. O escopo foi "Guarda + barra + alertas". O comando é `/hadouken:limites`. Afrouxar um limite "vale na hora, com aviso" e desfaz o aperto que o aprendizado tinha feito naquele item.
2. **Aviso de versão nova no VS Code**, com um botão para atualizar fácil.
3. **README curto:** "o que é o plugin e como eu instalo". O detalhe vai para a **wiki do GitHub**.
4. **Um lugar para configurar tudo do hadouken:** uma **tela no VS Code**.
5. Clicar no item da barra abre "uma janelinha" com as informações da dica e todas as opções de configuração. A janela usa o tema do hadouken, "com detalhes visuais que remetem ao poder hadouken".
6. **A logo animada** no início dos itens do hadouken na barra, "dando um hadouken" quando ele atua: a cada leitura de uso, quando a guarda barra ou avisa, quando um alerta dispara e quando o aprendizado ajusta. A cor do ícone acompanha a urgência dos alertas.
7. **O aprendizado ligado por padrão.**
8. **Os itens do hadouken na barra do VS Code com o tema do hadouken.** O tema fica só nesses itens. O resto da barra e as configurações do VS Code não mudam.

### Critérios de sucesso

- Um usuário com VS Code vê que existe versão nova e atualiza com um clique, sem abrir a documentação.
- Um usuário com VS Code configura a guarda, a barra, os alertas, o aprendizado e o painel sem editar JSON.
- Um usuário sem VS Code configura a guarda, a barra e os alertas pelo `/hadouken:limites`.
- O Claude continua sem conseguir afrouxar os próprios limites.
- O README cabe em uma tela e meia, e nenhuma explicação de hoje se perde: toda ela vai para a wiki.

### Suposições feitas, que o Sr. Garioli pode corrigir

- A consulta de versão nova olha as releases publicadas no GitHub, e não cada commit na `main`.
- O VS Code não tem janela flutuante solta. A "janelinha" é um painel (webview) que abre ao lado do editor e fecha no X.
- O item da barra de status não aceita um botão dentro dele. O "botão na barrinha" vira três coisas: a marca de versão nova no item, o clique que abre a janela com o botão Atualizar e o botão de uma notificação do VS Code.

## 2. Arquitetura

Segue o padrão de hoje: **a extensão é fina**. Ela só desenha e repassa cliques. A lógica fica no plugin e é carregada pelo shim `<dirDados>/bin/painel.mjs`, que o SessionStart mantém (`sincronizarShims`).

```
VS Code (vscode/extension.cjs + vscode/janela/*)
   │  import() do shim
   ▼
<dirDados>/bin/painel.mjs ──► src/uso/painel.js       (já existe: estadoPainel, talvezAtualizar)
                          ──► src/config/*            (novo: ler, validar, gravar)
                          ──► src/atualizacao/*       (novo: versão nova)
                          ──► src/eventos/*           (novo: o último "hadouken" a animar)
/hadouken:limites ──► src/hooks/limites.js ──► src/config/*
```

### 2.1 Módulos novos no plugin

**`src/config/`: a configuração inteira, um só dono**
- `lerConfiguracao(dir)` devolve, para cada item, o valor atual, o padrão, o mínimo, o máximo, a unidade, o rótulo e o aperto do aprendizado, quando houver. Ela junta o `config.json` com os padrões e o aperto (`src/guarda/aperto.js`).
- `validar(mudancas, atual)` confere cada item:
  - **inteiro dentro da faixa;**
  - **coerência:** barra `ctx.amarelo < ctx.vermelho` e `cache.amarelo < cache.verde`; alertas: o limite de 5 h "30 min" menor que o de "60 min"; guarda: `liberacao.padraoH ≤ liberacao.maxH`;
  - **afrouxamento:** marca os itens que ficam mais frouxos que o valor efetivo de hoje.

  Ela devolve `{ ok, erros[], afrouxa[] }`. Os textos são fixos, e o nome de cada campo vem da tabela, nunca do arquivo.
- `gravarConfiguracao(dir, mudancas)` valida de novo, porque a validação que vale é a de quem grava. Depois grava o `config.json` de forma atômica (arquivo temporário e `rename`), guarda um backup `config.json.bak-<data>` (os 3 mais novos) e, para cada item que afrouxa, desfaz o aperto daquele item. Ela também devolve um **token de desfazer**, com os valores anteriores, que vale enquanto a janela estiver aberta.
- `voltarAoPadrao(dir, itens)` remove os itens do arquivo, que voltam ao valor de fábrica, e também devolve o token de desfazer.

Chaves novas do `config.json`, ao lado da `guarda` de hoje, com os padrões iguais aos valores de hoje:
```json
{
  "barra":       { "ctx": { "amarelo": 70, "vermelho": 85 }, "cache": { "amarelo": 50, "verde": 80 } },
  "alertas":     { "projecao5hMin": [60, 30], "projecao7dH": 24 },
  "painel":      { "avisarVersaoNova": true, "animarLogo": true },
  "aprendizado": { "ligado": true }
}
```
- `src/formato.js` lê `barra`, e `src/alerta.js` lê `alertas`. Uma chave inválida faz o mesmo que a `guarda` faz hoje: usa o padrão e gera um aviso de texto fixo. O hadouken nunca quebra por causa de config.
- As faixas internas do ritmo **não** são configuráveis (decisão já tomada).
- `aprendizado.ligado` só registra a intenção. Quem liga e desliga de fato continua sendo `src/aprendizado/ligar.js` e o desligar de hoje. A janela chama essas funções.

**`src/atualizacao/`: versão nova**
- `talvezConsultarVersao({ forcar })` faz `GET https://api.github.com/repos/Garioli-Labs/claude-hadouken/releases/latest`, sem login.
  - Ela respeita o limite de 5 s, roda no máximo uma vez a cada 6 h e só uma entre todas as janelas, com a trava no mesmo padrão de `talvezAtualizar`.
  - Ela ignora `draft` e `prerelease` e só aceita `tag_name` no formato `vN.N.N`.
  - Ela compara essa versão com a versão do plugin carregado (`.claude-plugin/plugin.json`) e grava `<dirDados>/versao-nova.json` = `{ versao, consultadaEm }`.
  - Falhas (sem rede, limite do GitHub estourado, resposta estranha) não mudam nada: vale a última resposta boa, e ela nunca lança.
- `estadoVersao()` só lê o arquivo e devolve `{ nova: 'N.N.N' | null }`. Ela devolve `null` quando a versão gravada não é maior que a instalada, de modo que, depois de atualizar, a marca some sozinha.
- `comandoAtualizar(plataforma)` devolve o comando único **fixo no código**: `irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex` no Windows, e `curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash` no Mac e no Linux. Nada do que vem do GitHub entra nesse texto.

**`src/eventos/`: o "hadouken" a animar**
- `registrarEvento(dir, tipo, urgencia)` grava `<dirDados>/ultimo-evento.json` = `{ tipo, urgencia, em }`, sem trava e de forma atômica. Ela nunca lança e nunca atrasa o hook, porque é uma gravação pequena.
  - `tipo` ∈ `leitura | guarda | alerta | aprendizado`.
  - `urgencia` ∈ `calma | atencao | urgente`.
- Quem chama:
  - `talvezAtualizar`, ao terminar uma leitura de uso;
  - os hooks da guarda, quando negam ou pedem confirmação (`guarda-despacho`, `guarda-filha`, `guarda-arquivos`, `guarda-modelo`, `guarda-agenda`, `guarda-config`);
  - `alertas-gravados.js`, quando um alerta sai;
  - `src/aprendizado/ajustar.js` e o `/hadouken:aprender`, quando aplicam um ajuste.
- A urgência atual da barra vem do `estadoPainel` de hoje (o `nivel`). O evento só diz *quando* animar.

### 2.2 O shim `painel.mjs` passa a expor

`estadoPainel`, `talvezAtualizar` (como hoje), `lerConfiguracao`, `validar`, `gravarConfiguracao`, `voltarAoPadrao`, `desfazer`, `talvezConsultarVersao`, `estadoVersao`, `comandoAtualizar`, `ultimoEvento` e `ligarAprendizado`/`desligarAprendizado`.

A extensão confere os nomes como faz hoje. Se faltar algum dos novos, a extensão mostra os números de sempre e esconde só o que falta. Isso acontece quando a extensão é nova e o plugin ainda é velho. Uma extensão velha com um plugin novo também continua funcionando, porque os nomes antigos não mudam.

## 3. A barra de status do VS Code

**Dois itens**, lado a lado, à direita, com prioridades seguidas:

1. **Logo:** um ícone de uma fonte própria da extensão (`contributes.icons` com um `.woff` gerado a partir de `assets/icone.svg`).
   - **Quadros:** parado, carga, disparo, bola saindo e bola longe. São 5 glifos: `$(hadouken-0)` … `$(hadouken-4)`.
   - **Animação:** quando o `ultimoEvento().em` muda, a extensão troca os quadros a cada ~120 ms, cerca de 0,6 s, e para no quadro parado. Um evento que chega durante uma animação não começa outra.
   - **Cor (`item.color`) pela urgência:** `charts.blue` na calma, `charts.yellow` na atenção, `charts.red` na urgência. São cores do tema do VS Code, que continuam legíveis em tema claro e escuro.
   - **Movimento reduzido:** com `workbench.reduceMotion` = `on`, ou `auto` com o sistema pedindo movimento reduzido, não há animação, só a cor.
   - Com `painel.animarLogo` = `false`, também não há animação.
2. **Números com o tema:** as barrinhas de 5 h, semana e Fable viram **segmentos de energia**, glifos da mesma fonte (`$(hadouken-seg-cheio)`, `$(hadouken-seg-meio)`, `$(hadouken-seg-vazio)`) no lugar dos caracteres de hoje. O texto e as porcentagens não mudam. O fundo de aviso e de erro de hoje (`statusBarItem.warningBackground` e `errorBackground`) continua, para a urgência não depender só da cor.
   - Com versão nova, o item ganha no fim a marca `$(hadouken-seta) 0.5.x`.

**A dica (tooltip)** continua igual.

**O clique** em qualquer um dos dois itens abre a janela do hadouken. O comando de hoje, "Claude Hadouken: atualizar uso agora", continua na paleta de comandos.

**O resto da barra** do VS Code e o `workbench.colorCustomizations` do usuário não são tocados.

## 4. A janela do hadouken

Um webview (`vscode.window.createWebviewPanel`) aberto em `ViewColumn.Beside`. Ele é único: um segundo clique mostra a mesma janela.

### 4.1 Conteúdo, de cima para baixo

1. **Cabeçalho "poder hadouken":** a bola de energia de `assets/icone.svg` com as linhas de velocidade, sobre o azul-marinho `#111A2E`, e o nome hadouken com a versão instalada.
2. **Uso:** 5 h, semana e Fable como **feixes de energia**.
   - O preenchimento vai do azul `#2563EB` ao ciano `#38BDF8` e passa para amarelo e depois vermelho conforme a urgência.
   - Embaixo de cada feixe vêm a porcentagem, o ritmo e o horário do reset, em texto.
   - Ao lado, o botão **Atualizar uso agora**.
3. **Versão nova**, só quando houver: a faixa "hadouken 0.5.x disponível", com o botão **Atualizar**.
4. **Configuração**, com as abas abaixo. O rótulo de cada campo é em português, com a unidade, e dele saem o valor padrão e a faixa.
   - **Guarda:** os 12 campos de `PADRAO_GUARDA`, incluindo `ligada`.
   - **Barra:** ctx amarelo e vermelho, cache amarelo e verde.
   - **Alertas:** projeção de 5 h (dois limites, em minutos) e projeção de 7 dias (horas).
   - **Aprendizado:** ligado ou desligado, e a lista dos apertos atuais, com o item e o valor.
   - **Painel:** avisar de versão nova e animar a logo.
   - **Roteamento:** as chaves de `roteamento` (negar N1, negar N2, avisos e sugerir troca de modelo/effort da sessão), definidas em `2026-10-16-v053-roteamento-design.md` §6.3, mais um resumo da tabela Roteamento dos últimos 7 dias.

   Embaixo ficam **Voltar ao padrão** (da aba) e **Salvar**.

### 4.2 Efeitos de "poder"

Os efeitos só aparecem quando algo **muda de estado**:
- a bola dispara ao abrir a janela e quando o salvamento dá certo;
- o botão Salvar "carrega" enquanto grava;
- o feixe acende quando o número muda.

Não há animação de entrada em cada elemento nem brilho permanente. Com movimento reduzido (`prefers-reduced-motion` ou `workbench.reduceMotion`), nada anima.

### 4.3 Regras de UX (skill yu-ux-web-expert)

- **Restringir em vez de validar (nível 1):**
  - cada número é um `<input type="number">` com `min`, `max` e `step=1` vindos da tabela, ou um stepper;
  - a coerência também vem no controle: o `min` do "vermelho" acompanha o "amarelo";
  - ligado e desligado são switches.

  A validação de verdade é a de `gravarConfiguracao`. A janela só avisa.
- **Validar na hora certa:** no `blur`, nunca a cada tecla. O erro aparece em texto no próprio campo, com `aria-invalid` e `aria-describedby`.
- **Salvar fica desligado** enquanto nada mudou ou algo está fora da faixa, e o motivo vem escrito ao lado ("Nada mudou", "Teto da semana fora da faixa 50–100").
- **Afrouxar** mostra, antes de salvar, um aviso na própria linha: "Mais frouxo que o atual. Vale na hora e desfaz o aperto do aprendizado neste item." Nenhum diálogo "tem certeza?".
- **Desfazer vence confirmar:** depois de Salvar e de Voltar ao padrão, uma barra "Salvo. Desfazer" fica 15 s e é anunciada por `aria-live="polite"`.
- **Preservar a edição:** o rascunho não salvo sobrevive a esconder a janela e voltar (`vscode.setState` ou `getState`).
- **Gravações concorrentes:** se o `config.json` mudou desde que a janela leu (outra janela, ou o `/hadouken:limites`), o Salvar recusa e mostra os valores novos, mantendo o rascunho.
- **Contraste:** texto com pelo menos 4,5:1 sobre o fundo.
  - O texto principal é `#E6F7FF`, o destaque é `#38BDF8` e o fundo é `#111A2E`.
  - O `#2563EB` só aparece em preenchimentos e bordas, nunca em texto.
  - O texto secundário ganha hierarquia por tamanho e peso, e não por cinza claro.
- **Ícones:** SVG inline com `aria-hidden="true"`, sempre ao lado de um rótulo em texto. Nada de emoji.
- **Teclado:**
  - as abas usam `role="tablist"`, as setas trocam de aba e Home/End vão à primeira e à última;
  - o foco é visível, com um contorno ciano de 2 px;
  - a ordem de tabulação segue a ordem visual.
- **Alto contraste:** com o corpo em `vscode-high-contrast` ou `vscode-high-contrast-light`, a janela deixa o tema próprio e usa as variáveis `--vscode-*`.
- **O que não construir agora:** busca nos campos, importar e exportar config, gráficos de histórico.

### 4.5 Estilo 8 bits / vintage (emenda 2)

- **Paleta:** continua a mesma, com a paleta do hadouken.
- **Ícones da barra** (logo e segmentos):
  - em pixel art numa grade de 16×16, feitos só de quadrados, sem curvas nem antisserrilhado;
  - a bola de energia vira um sprite;
  - os segmentos de energia viram blocos, como a barra de vida de um jogo de luta.
- **Animação:** em degraus (`steps()`), sem suavização, como um sprite trocando de quadro.
- **Janela:**
  - bordas em degraus (pixel), sombras duras sem desfoque e os feixes de energia em blocos;
  - na bola do cabeçalho, `image-rendering: pixelated`.
- **Fonte pixel só nos títulos, nos botões e nos números grandes.** A fonte é a "Press Start 2P" (licença OFL), embutida na extensão (`janela/pixel.woff2`) e nunca carregada da internet. O corpo, os rótulos e as mensagens de erro ficam na fonte do VS Code (`--vscode-font-family`), porque uma fonte pixel em texto corrido e pequeno atrapalha a leitura (regra de legibilidade da skill yu-ux-web-expert).
- **Opcional e leve:** um efeito de linhas de varredura (CRT) só no cabeçalho, com no máximo 6% de opacidade. Ele some com movimento reduzido e com alto contraste.
- **As regras da §4.3 não mudam:** contraste de 4,5:1, foco visível e movimento reduzido valem do mesmo jeito.

### 4.4 Segurança da janela

- **CSP:** `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-<aleatório>'; font-src ${webview.cspSource}`. Nada é carregado da internet.
- `localResourceRoots` aponta só para a pasta `janela/` da extensão.
- **Mensagens da janela para a extensão:** só uma lista fixa (`salvar`, `voltarPadrao`, `desfazer`, `atualizarUso`, `atualizarHadouken`, `ligarAprendizado`, `desligarAprendizado`, `pronto`).
  - A extensão confere o tipo e a forma de cada mensagem. O que não conhece, ela ignora.
  - As chaves de `salvar` só podem ser as da tabela de `src/config/`.
- `atualizarHadouken` não leva parâmetro: o comando vem de `comandoAtualizar(process.platform)`.
- Nada que vem do `config.json` ou do GitHub entra na página como HTML. Tudo entra como `textContent`.

## 5. O aviso de versão nova

- A extensão chama `talvezConsultarVersao({})` junto do tique de hoje. A função mesma decide se consulta (6 h e trava). Com `painel.avisarVersaoNova` = `false`, não consulta.
- Quando `estadoVersao().nova` aparece:
  - **a marca no item**;
  - **a faixa na janela**;
  - **uma notificação do VS Code**, `showInformationMessage("hadouken 0.5.x disponível", "Atualizar", "Depois")`, **uma vez por versão**. A versão já avisada fica em `ctx.globalState`. "Depois" só cala a notificação: a marca e a faixa continuam.
- **Atualizar:** abre um terminal chamado "hadouken" (`createTerminal`) e manda o `comandoAtualizar`. No Windows, o terminal é o PowerShell (`shellPath: 'powershell.exe'`). No Mac e no Linux, é o shell padrão com o comando do bash. Um clique durante uma atualização em curso só mostra o terminal que já existe.
- No fim, o próprio comando único pede para abrir uma sessão nova do Claude Code. Na consulta seguinte, a versão instalada é igual e a marca some.
- **Quem não usa VS Code** não recebe o aviso. Para ele, o caminho continua sendo o comando único.

## 6. `/hadouken:limites`

Para quem não usa VS Code, e para quem prefere o terminal.

- Um hook `UserPromptExpansion` com o matcher `hadouken:limites` (`src/hooks/limites.js`), no mesmo modelo de `liberar.js`:
  - sempre bloqueia a expansão, então o modelo não é chamado e não gasta tokens;
  - recusa `-p` e SDK (`CLAUDE_CODE_ENTRYPOINT`);
  - aceita só o comando digitado (`command_source` = `plugin`, `expansion_type` = `slash_command`);
  - é `disable-model-invocation: true` na skill.

  Assim o Claude não consegue afrouxar os próprios limites. A guarda já protege `~/.claude/hadouken/**` contra Write e Edit, e `node`/`bash` são vigiados por `guarda-filha`.
- **Gramática (fechada):**
  - `/hadouken:limites`: tabela com o item, o atual, o padrão, a faixa e o "apertado pelo aprendizado";
  - `/hadouken:limites <item> <valor>`: grava;
  - `/hadouken:limites <item> padrao`: volta o item ao padrão;
  - `/hadouken:limites padrao`: volta tudo.

  O `<item>` usa os nomes da tabela de `src/config/`, como `guarda.teto7d`, `barra.ctx.amarelo` e `alertas.projecao7dH`. Abrange guarda, barra e alertas. Aprendizado e painel ficam só na janela.
- **Resposta:** texto fixo de mensagens. Ao afrouxar: "Afrouxado: vale agora e desfaz o aperto do aprendizado neste item." O argumento digitado nunca volta no texto, só o item da tabela.
- A gravação usa `gravarConfiguracao`, igual à janela.

## 7. Aprendizado ligado por padrão

- **O comando único** (`install.sh` e `install.ps1`) liga o aprendizado na instalação e na atualização, quando ele nunca foi ligado nem desligado pelo usuário. Ligar significa baixar o OpenTelemetry Collector, gravar `otel/ligado.json` e as variáveis no `settings.json`, pelas funções de `src/aprendizado/ligar.js`.
  - O resumo final mostra uma linha a mais: "aprendizado: ligado (desligue na janela ou com --sem-aprender)".
- **Respeitar a escolha:** quem desligou continua desligado. É a mesma regra do REA: um marcador `<dirDados>/aprendizado-desligado-pelo-usuario` impede religar.
- **`--sem-aprender`** (`-SemAprender` no PowerShell) pula esse passo.
- **Falha ao ligar:** o download falhou, a plataforma não tem binário ou faltou espaço. O instalador segue, a linha do resumo diz o motivo e como tentar de novo, e o código de saída não muda.
- Os textos que dizem "(opcional)" passam a dizer "ligado por padrão".

## 8. README curto e wiki

- **README.md e README.en.md**, com no máximo ~60 linhas cada:
  1. o aviso `[!IMPORTANT]` da troca de nome, que continua;
  2. uma ou duas frases sobre o que é o hadouken;
  3. uma imagem da barra e da janela;
  4. **Instalar:** o comando único das duas plataformas e os requisitos (Node 20 ou mais novo, Claude Code 2.1.251 ou mais novo);
  5. **Atualizar:** o botão no VS Code ou o mesmo comando;
  6. **Saiba mais:** links para a wiki;
  7. a licença.
- **Fonte da wiki no repositório:** uma pasta `wiki/` com páginas em português e em inglês (`Barra-de-status.md`, `Status-bar.md` …):
  - Barra de status
  - Painel e janela do VS Code
  - Avisos e alertas
  - Guarda de consumo
  - Relatório `/hadouken:consumo`
  - Aprendizado
  - Limites (`/hadouken:limites`)
  - Kit
  - REA
  - Comandos
  - Problemas comuns, incluindo "atualizei e o plugin sumiu"
  - `Home.md` e `_Sidebar.md`

  O conteúdo vem do README de hoje, atualizado com o que esta spec muda.
- **Publicar:** `scripts/publicar-wiki.sh` clona `https://github.com/Garioli-Labs/claude-hadouken.wiki.git`, copia `wiki/`, faz o commit e o push.
  - Publicar é uma ação externa: **roda só com a autorização do Sr. Garioli, a cada vez**.
  - **Pré-requisito manual dele:** ligar a wiki no repositório e criar a primeira página pelo site. Hoje o `.wiki.git` responde "not found".
- **Testes:** os testes que leem o README (`kit-readme`, `kit-atualizar`, `renome`, `guarda-caminho`, `guarda-caminho-extra`, `guarda-p5-extra`, `kit-robo-simulado`) passam a ler a página correspondente em `wiki/`, e um teste novo confere:
  - (a) todo link do README para a wiki aponta para um arquivo em `wiki/`;
  - (b) toda página de `wiki/` em português tem a irmã em inglês;
  - (c) o README tem o aviso do topo, os dois comandos de instalação e no máximo 60 linhas.

## 9. Ordem de execução

1. `src/config/` e as chaves novas lidas por `formato.js` e `alerta.js`.
2. `/hadouken:limites`.
3. `src/eventos/` e as chamadas nos hooks.
4. `src/atualizacao/`.
5. Extensão: os dois itens, a fonte de ícones, a animação e a cor.
6. Extensão: a janela.
7. Extensão: o aviso de versão nova.
8. O aprendizado ligado por padrão nos instaladores.
9. README e `wiki/`, por último, para descrever o que já existe.

## 10. Testes

- **`src/config/`:**
  - faixas, coerência e afrouxamento;
  - gravação atômica, backup e rotação dos 3 mais novos;
  - desfazer o aperto só no item afrouxado;
  - desfazer, e recusa de gravação concorrente;
  - chave desconhecida recusada;
  - `__proto__` ignorado;
  - arquivo ilegível dá os padrões e nunca desliga a guarda.
- **`formato.js` e `alerta.js`:** usam as faixas configuradas, e com uma config inválida usam os padrões de hoje (os testes atuais continuam verdes sem mudança).
- **`/hadouken:limites`:**
  - a gramática;
  - recusa de `-p`, SDK, outra origem e outro tipo de expansão;
  - o argumento nunca volta no texto;
  - o modelo não é chamado (decision: block).
- **`src/eventos/`:** gravação e leitura; um hook não fica mais lento (gravação falha sem lançar).
- **`src/atualizacao/`:**
  - `fetch` falso: release normal, `draft`, `prerelease`, tag inválida, falha de rede, 403 de limite e JSON estranho;
  - intervalo de 6 h e trava entre processos;
  - comparação de versões;
  - `comandoAtualizar` por plataforma, igual ao texto do README.
- **Extensão,** com um `vscode` falso, no mesmo estilo dos testes do painel de hoje:
  - o clique abre uma janela só;
  - a animação dispara uma vez por evento e não com o mesmo `em`;
  - a cor pela urgência;
  - movimento reduzido sem animação;
  - a notificação uma vez por versão;
  - o terminal recebe o comando fixo;
  - a mensagem desconhecida da janela é ignorada;
  - nomes do shim faltando não quebram o item.
- **Janela:**
  - a CSP presente com o nonce;
  - nenhuma URL externa no HTML;
  - os campos com `min` e `max` da tabela;
  - Salvar desligado com o motivo;
  - abas por teclado;
  - checagem de contraste dos tokens (4,5:1).
- **Instaladores:**
  - aprendizado ligado na primeira instalação;
  - não religado depois de desligado;
  - `--sem-aprender`;
  - falha ao ligar sem mudar o código de saída;
  - a linha no resumo.
- **README e wiki:** a seção 8.
- **Suíte inteira verde** no Windows, e o robô roda no Linux e no macOS.

## 11. Fora desta spec

- O roteamento de modelo, effort e agente e as otimizações de consumo: outra spec da v0.5.3.
- O tema da barra inteira do VS Code (`workbench.colorCustomizations`): recusado.
- A revisão de segurança, estabilidade e compatibilidade: v0.5.4.
- Os minors adiados da v0.5.2 (7, 8, 10, 11 e 12) não estão aqui. O 8, a linha do painel repetida para quem não tem VS Code, encosta na parte 3 desta spec, e o plano pode absorvê-lo se for barato.

## 12. Emenda 3 (2026-10-28): menos travas falsas, e cada proteção com um interruptor

### 12.1 O falso positivo do caminho na P4

A P4 confunde o caminho deste repositório com uma chamada ao claude. O `chamaClaude` (`src/guarda/caminho.js`) procura `claude` como nome de comando. O caminho `C:/Projetos DEV/Claude Hadouken/...` tem um segmento `Claude` logo depois de um espaço, e o teste o toma por comando. Com a guarda disparada, a P4 negava qualquer `node`, `bash` ou outro lançador que citasse um arquivo do projeto.

O `claudeComLiberar` negava mesmo com a guarda calma. O culpado é o teste (b), que dispara com três coisas juntas: a palavra claude, o texto `hadouken` e um `$` ou `*`.

**A correção.** Os dois testes recebem o `cwd` do stdin do hook. Antes de procurar, trocam por `.` cada ocorrência do `cwd` no comando:
- sem diferenciar maiúsculas;
- com `/` ou com `\` como separador;
- também na forma `/c/...` do bash do Git.

A troca obedece a três limites:
- só vale quando o `cwd` vem seguido de separador, aspa, espaço ou fim;
- nunca vale quando o último segmento do `cwd` é `claude` (com `.exe`, `.cmd` ou `.ps1` opcionais), porque aí o próprio `cwd` poderia ser o executável;
- um `cwd` que não é absoluto, ou que é só a raiz, não troca nada.

O resto do comando continua conferido. Por exemplo, `C:/x/claude.exe -p` com `cwd` `C:/x` vira `./claude.exe -p`, que continua contando como claude.

### 12.2 Os interruptores

Os quatro itens são booleanos do grupo `protecoes`, com padrão `true` e `frouxo: 'desligar'`.

| id | rótulo | quem obedece |
|---|---|---|
| `protecoes.sessaoFilha` | Bloquear sessão claude filha | `guarda-filha.js` (P4), inclusive a regra fixa do texto do liberar |
| `protecoes.arquivos` | Proteger os arquivos do hadouken | `guarda-arquivos.js` (P5) |
| `protecoes.hooks` | Segurar mudança de hooks | `guarda-config.js` (ConfigChange) |
| `protecoes.agenda` | Bloquear liberar por tarefa agendada | `guarda-agenda.js` |

Cada hook lê o seu item com `protecaoLigada(id)`, em `src/guarda/protecoes.js`.
- **Item desligado:** o hook passa sem saída e sem evento.
- **Leitura com erro:** o item conta como ligado. É falha fechada, porque desligar é afrouxar.

O Claude não consegue desligar um item editando o `config.json`, porque a P5 ligada protege esse arquivo. O usuário desliga por um destes dois caminhos:
- na janela, na aba **Proteções**;
- com `/hadouken:limites protecoes.<x> desliga`. Para isso, o grupo `protecoes` entra em `GRUPOS_LIMITES`.

Na aba, cada interruptor tem embaixo uma linha dizendo o que se perde ao desligá-lo. Não há diálogo de confirmação: a mudança é reversível, tem Desfazer por 15 s e mostra o aviso de afrouxar.

O risco fica declarado no SECURITY.md e no README (Task 13):
- com a P5 desligada, o Claude pode editar a configuração e os settings;
- com a P4 desligada, uma sessão filha pode tentar o liberar, mas o `liberar.js` ainda recusa qualquer origem que não seja o comando digitado.

## 13. Emenda 4 (2026-10-28): perguntar em vez de bloquear

Pedido do Sr. Garioli: "Ele trava até aquilo que é decisão minha." Com a trava do 7d ativa, a P1 negou um despacho de revisão que ele tinha pedido e parou o turno.

Item novo `guarda.perguntar` (booleano, padrão `true`, aba Guarda, "Perguntar em vez de bloquear"). Com ele ligado e uma trava dos G1 a G7 ativa:

- P1 e G5 na conversa principal: `permissionDecision: 'ask'`, sem `continue: false`. O usuário aprova ou recusa na tela do Claude Code. Evento `perguntado` com `P1:<travas>` ou `G5`.
- P1 dentro de subagente: o deny sem stop de antes (não há a quem perguntar).
- P3 (PreModelSwitch para o Fable): `ask`. Evento `perguntado` `P3:<travas>`.
- P2 (prompt numa sessão Fable): passa, com uma linha em additionalContext pedindo ao Claude que avise que `/model sonnet` gasta menos. Evento `perguntado` `P2:<travas>`.
- P4, P5, a retenção do ConfigChange e as regras do liberar não mudam.

Aprovar não grava liberação: a próxima chamada pergunta de novo. Desligar o item volta ao deny com `continue: false`. O item não conta como afrouxar (`frouxo: null`): ele não muda teto nenhum, e o aperto do aprendizado continua.

Risco declarado no SECURITY.md: nos modos de permissão que aprovam sozinhos, o `ask` pode passar sem ser mostrado (não medido).

## 14. Emenda 5 (2026-10-28): a trava de projeção cai sozinha

Pedido do Sr. Garioli: "O hadouken não pode atrapalhar, a função dele é o Claude não fazer doideras e comer a cota à toa." Os eventos dele mostravam G2 disparando com o 7d em 37% (6 vezes desde 21/10) e a trava presa até o reset semanal, dias depois, mesmo com a projeção desfeita.

Em `avaliarGuarda`, antes de unir as travas: uma trava gravada por G1 (five_hour) ou G2 (seven_day) é limpa (`limparTravas`) quando, ao mesmo tempo, o gatilho da janela não dispara agora, a leitura da janela é fresca e a previsão é nula ou passa de 1,5 × o horizonte (folga contra o pisca-pisca na borda). Evento `projecao-solta` com a janela. Leitura velha ou guarda.json ilegível: a trava fica (fail-closed). G3 e G4 ficam até o reset, porque o uso só sobe dentro da janela. Falha ao gravar mantém a trava; a avaliação seguinte tenta de novo.

## 15. Emenda 6 (2026-10-28): acrescentar ganchos ao settings de projeto pergunta

Pedido da sessão Metrô SP, decidido pelo Sr. Garioli ("perguntar com o diff"): toda trava mecânica nova de um projeto dependia de o usuário editar o JSON à mão, e um erro de cópia deixava o gancho mudo.

Na P5, ramo settings-projeto, depois de `mexeNaGuarda`: se `soAcrescentaGanchos` (src/guarda/caminho.js) e `guarda.perguntar` e `protecoes.arquivos` estão ligados, a P5 responde `ask` com P5_GANCHOS_PERGUNTA, e o usuário decide vendo o diff do Claude Code. Evento `perguntado` `P5:ganchos`.

Só acrescenta quando: o arquivo atual (ou ausente) e o resultado simulado são JSON de objeto; disableAllHooks e enabledPlugins não mudam; os ganchos mudam; nenhum evento some; cada grupo de antes tem um grupo no mesmo evento com todos os ganchos dele (iguais) e um matcher igual ou mais largo (as alternativas por | contêm as de antes; sem matcher, '' e '*' casam tudo); e nenhum gancho novo cita o hadouken. Qualquer outra mudança nos ganchos, ou dúvida, nega como antes. A P5 do ConfigChange segura a mudança na sessão em curso: o gancho novo vale a partir da próxima sessão. Settings do usuário e o plugin seguem negados sempre.
