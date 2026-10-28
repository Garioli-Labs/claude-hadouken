# Problemas comuns

[English](Troubleshooting)

## Onde ficam os dados

Em `~/.claude/hadouken/` (ou em `HADOUKEN_HOME`), fora de qualquer repositório:

| Arquivo | Para quê |
|---|---|
| `estado.json` | Última leitura dos limites, gravada pela barra, os dados de cada sessão ativa e o histórico curto das leituras que alimenta a projeção dos avisos (até 90 pontos, um a cada 2 minutos, 3 horas). |
| `uso-oficial.json` | A última leitura do `/usage` feita pelo painel (5 h, semana e Fable, com a hora da leitura), o estado dela e, se houver, o bloqueio de 24 h por custo. |
| `uso-oficial.lock` | A trava de leitura do painel: existe só durante uma leitura, para duas janelas do VS Code não lerem ao mesmo tempo. |
| `uso-cwd/` | Pasta vazia onde o `claude` da leitura do painel roda. |
| `painel/` | A extensão do painel montada (`.vsix`), o registro da versão instalada (`instalado.json`) e o da última tentativa (`tentativa.json`). |
| `alertas.json` | Última faixa anunciada por janela, para não repetir aviso. |
| `projecao.json` | Faixas de projeção já anunciadas em cada sessão, para o aviso de projeção não se repetir (até 256 sessões). Só é criado quando há o que guardar; conteúdo fora do formato vira memória vazia. |
| `historico.jsonl` | Uma linha por sessão encerrada, com a última leitura dela. |
| `config.json` | Opcional: repos do GitHub. Você cria e edita. |
| `indice-transcripts.json` | Índice incremental que acelera o relatório. |
| `github-cache.json` | Execuções do Actions já concluídas. |
| `ativas/` | Um arquivo por sessão que carregou o plugin (o registro de ativação); arquivos parados há mais de 30 dias são apagados sozinhos. |
| `bin/` | Scripts estáveis chamados pela barra, pelos comandos e pelo painel do VS Code (`painel.mjs`), reescritos a cada sessão nova. |
| `otel/` | Só com o aprendizado ligado: o Collector (`bin/`, com o hash dele em `bin/instalado.json`), a configuração gerada (`config.yaml`), a telemetria filtrada (`telemetria.jsonl`, com rotação), o PID, o log da subida, a trava de subida (`subindo.lock`) e o registro do que o `ligar` pôs no `settings.json` (`ligado.json`). |
| `aprendizado.json`, `ajustes.json`, `sugestoes.json` | Só com o aprendizado ligado: os agregados (26 semanas), os ajustes em vigor com o registro de cada um e as sugestões. |
| `aprendizado-cursor.json`, `aprendizado-eventos.json`, `aprendizado.lock` | Só com o aprendizado ligado: até onde a telemetria foi lida, os últimos eventos (porta ocupada, pouca memória…) e a trava de um passo por vez. |
| `guarda.json` | A guarda (v0.4.0): as travas disparadas, cada uma com o gatilho e o reset da janela. |
| `liberacao.json` | A liberação ativa, gravada só pelo `/hadouken:liberar` digitado. |
| `guarda-eventos.json` | Os 200 eventos mais novos da guarda (disparos, negações, liberações, mudanças de config bloqueadas, erros), só com rótulos fixos e números. Alimenta "Guarda (7 dias)". |
| `despachos-fable.json` | Os instantes dos despachos Fable das últimas 24 h, para o G7 (até 200). |
| `limites-atingidos.json` | O último limite atingido do Fable e o geral. |
| `modelos.json` | O modelo de cada sessão (até 50), para a P2 e a P3. |
| `guarda-sessoes/` | Uma marca vazia por sessão que roda os hooks da guarda; sem ela, a barra diz "sem guarda nesta sessão". |
| `config-base.json` | A foto da P5 de config: hashes de `disableAllHooks`, `enabledPlugins` e `hooks` por sessão e arquivo de settings, nunca o conteúdo. Até 600 entradas e 512 KiB. |
| `indice-hooks.json` | O índice do custo dos hooks: só números e hashes de comando, até 6 MiB. Pode ser apagado; o próximo `/consumo` o refaz. |

Pode apagar a pasta a qualquer momento; ela é recriada na próxima sessão, sem histórico.

---

## Privacidade e segurança

**Resumo:**

- **Sem telemetria.** Nada é enviado a nenhum serviço, nem ao autor do plugin. O plugin não chama a API do Claude. O aprendizado local, opcional e desligado por padrão, recebe o OpenTelemetry do Claude Code só em 127.0.0.1 e o guarda na pasta de dados, filtrado.
- **Rede: `gh api`, só leitura, e o `/usage` do Claude Code.** O relatório roda `gh api <endpoint>` (sempre GET) para os repos configurados ou para o `origin`. O painel do VS Code roda o comando oficial `claude -p /usage`: quem consulta a Anthropic é o próprio Claude Code, com a sua sessão, sem chamar o modelo. O plugin não abre conexão própria. Com o aprendizado ligado, a única exceção é o download único do Collector, do GitHub, com o SHA-256 conferido.
- **Nenhum token.** O plugin não lê, não pede e não guarda token ou credencial. O login do GitHub é do `gh`. Os "tokens" do relatório são contagens de uso.
- **Transcripts: só números.** Dos transcripts, o índice guarda caminhos relativos, ids de sessão e de requisição, números, datas, modelo, effort e o nome do projeto. Nenhum conteúdo de conversa. O índice do custo dos hooks (v0.4.0) guarda só números e o hash do comando de cada hook, nunca o texto que um hook de qualquer plugin imprimiu.
- **Onde grava:** só na pasta de dados. As exceções são a chave `statusLine` do seu `settings.json`, pelo instalador, com confirmação e backup, e a extensão do painel, que o CLI do VS Code instala na pasta de extensões dele (desligável com `HADOUKEN_SEM_PAINEL=1`). O `ligar` e o `desligar` do aprendizado mudam só as chaves de telemetria do `env` do `settings.json`, com o mesmo gravador e a mesma cópia de segurança.

**A garantia:** nada que o plugin lê (arquivos de estado, transcripts, a entrada da barra, respostas do GitHub, argumentos de comando) vira código executado, comando de shell, caminho arbitrário, sequência de terminal ou instrução com a autoridade do plugin no contexto do Claude. Cada ameaça do modelo (S1 a S9: arquivo adulterado, texto malicioso, sequências de terminal, injeção pelos argumentos, repo malicioso, script adulterado, instalador acionado sem você saber, cadeia de suprimentos, arquivo gigante; e, do painel, S26 a S28: o painel executa o `claude`, o instalador executa o CLI do VS Code, `uso-oficial.json` adulterado; e, da v0.4.0, S29 e S30: texto de outros plugins no relatório, leitura repetida da barra; e, do aprendizado, L1 a L8: OTLP forjado, binário trocado, vazamento de identidade, porta exposta, `settings.json` corrompido, `ajustes.json` apagado, o download e os processos do Collector) tem uma defesa e um teste com entrada maliciosa sintética.

**O limite honesto:** nenhum plugin impede código que **já roda como o seu usuário do sistema**. Uma skill maliciosa que chegou a esse ponto pode alterar qualquer arquivo seu, inclusive o `settings.json` e o próprio plugin. O que o `hadouken` garante é não ampliar esse poder e restaurar os próprios scripts a cada sessão nova.

O modelo de ameaças completo, as variáveis de ambiente e como relatar uma vulnerabilidade de forma privada estão no [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md). Não abra issue pública para vulnerabilidades.

---

## Performance

Nenhuma falha ou lentidão do plugin pode travar o Claude. As metas são medidas, não presumidas, com os benchmarks de `bench/` (`node bench/rodar-todos.mjs`):

| Operação | Meta | Medido |
|---|---|---|
| Barra de status (processo inteiro), Windows | p95 ≤ 250 ms | 170 ms |
| Barra de status (processo inteiro), Linux/macOS | p95 ≤ 150 ms | Linux 49 ms · macOS 48 ms |
| Hook antes de cada prompt, Windows | p95 ≤ 250 ms | 188 ms |
| Hook antes de cada prompt, Linux/macOS | p95 ≤ 150 ms | Linux 56 ms · macOS 50 ms |
| Hook de início de sessão, Windows | p95 ≤ 250 ms | 176 ms |
| Hook de início de sessão, Linux/macOS | p95 ≤ 150 ms | Linux 57 ms · macOS 51 ms |
| Hook de fim de sessão, Windows | p95 ≤ 250 ms | 151 ms |
| Hook de fim de sessão, Linux/macOS | p95 ≤ 150 ms | Linux 46 ms · macOS 44 ms |
| Guarda antes de despachar um subagente (P1), Windows | p95 ≤ 250 ms | 161 ms |
| Guarda antes de trocar de modelo (P3), Windows | p95 ≤ 250 ms | 162 ms |
| Guarda de arquivos do plugin (P5), Windows | p95 ≤ 250 ms | 146 ms |
| `/hadouken:liberar`, Windows | p95 ≤ 250 ms | 171 ms |
| Hooks da guarda, Linux/macOS | p95 ≤ 150 ms | a medir no CI |
| `/hadouken:consumo`, índice já montado | ≤ 2 s | Windows 548 ms · Linux 207 ms · macOS 169 ms |
| `/hadouken:consumo`, índice do zero | ≤ 15 s | Windows 2,60 s · Linux 834 ms · macOS 623 ms |

- p95 do pior cenário de cada linha. Windows medido em 01/10/2026, num Intel Core i7-7700HQ (8 núcleos lógicos, Node 24) com o VS Code aberto e uns 22% de CPU em segundo plano (os números podem estar um pouco altos); Linux e macOS nos runners do GitHub Actions (`ubuntu-latest` e `macos-latest`, Node 24), job `bench` do CI.
- A barra e os hooks são medidos em 100 execuções, do início ao fim do processo, com o disco no pior caso: 1 000 sessões registradas, o estado no teto de 50 sessões e o histórico de leituras cheio (90 pontos); nos hooks, também as duas memórias de avisos cheias (`alertas.json` e `projecao.json`, esta com as projeções de 256 sessões). O pior caso é refeito antes de cada rodada, para valer a medição inteira.
- O relatório é medido sobre 500 MB de transcripts sintéticos (216 arquivos), com o mesmo estado cheio, e um repo respondido pelo `gh` falso, sem rede.
- Nos hooks da guarda, a previsão de 7 dias do pior caso dispara a guarda: a P1 nega o despacho de um subagente Fable, a P3 nega a troca para o Fable, a P5 nega uma gravação na pasta de dados e o `/liberar 2h` grava a liberação e os dois eventos. A P1 e a P3 começam cada rodada sem liberação e sem `guarda.json` (o preparo não deixa a trava gravada), então medem a avaliação que grava a trava, não a que só a lê.
- A meta do Windows é maior porque só a partida do Node, sem script nenhum, já leva 76 ms (p50) e 86 ms (p95) na mesma máquina Windows. A barra roda em segundo plano e não trava a digitação.
- A v0.2.0 custa um pouco mais que a v0.1.0 nos caminhos de sessão registrada: +5,0 a +6,8 ms no p50 da barra e do hook de prompt, em A/B pareado de 200 pares com as duas versões na mesma pasta (`bench/ab-raizes.mjs`). É o trabalho das várias sessões ao mesmo tempo (histórico, previsão, contagem de sessões ativas e aviso de projeção). Nos caminhos de sessão não registrada ficou igual ou até 3 ms mais rápida. Os p95 continuam bem dentro da meta.
- A v0.4.0 contra a v0.3.0, no mesmo A/B pareado: +25,2 ms na barra e +18,2 ms no hook de prompt de sessão registrada (mediana das diferenças pareadas); nas sessões não registradas, +0,9 ms na barra e +0,1 ms no prompt, dentro do ruído. O custo vem da guarda (trava, liberação e eventos lidos a cada despacho e prompt) e da leitura-piso nos avisos.
- Os hooks de início e fim de sessão rodam uma vez por sessão e têm a mesma meta da barra e do hook de prompt. Além da meta, cada hook tem um teto no `hooks.json`: 10 s no hook de prompt e nos hooks da guarda (PreToolUse, `/liberar`, a P3 e a P5 de config, no `ConfigChange`) e 5 s nos de início e fim de sessão e nos dois que só registram (troca de modelo feita e limite atingido).
- Os números da tabela foram medidos na v0.4.0, com a guarda ligada nos hooks. As colunas de Linux e macOS das linhas que já existiam ainda são as da v0.2.0, medidas em 27/09/2026, até o job `bench` rodar a v0.4.0.
- O `/consumo` agora também monta o índice do custo dos hooks (`indice-hooks.json`), incremental como o dos transcripts. Com dados reais, numa máquina com cerca de 48 mil execuções de hook por semana, o `/consumo` com os dois índices do zero levou 7,4 s no Windows, dentro da meta de 15 s; os 2,60 s da tabela são dos transcripts sintéticos.
- O painel do VS Code não entra nessas metas: ele roda fora do Claude Code, e a instalação dele sai do início de sessão em segundo plano, sem o hook esperar. O custo dele é o da leitura enxuta do `/usage`, medido à parte: 5 s e 270 MB de pico por leitura, a cada 30 s e só com sessão ativa (veja [Sem gastar tokens, com pouca RAM](Painel-e-janela-do-VS-Code#sem-gastar-tokens-com-pouca-ram)).

Por que o relatório é rápido na segunda vez: o índice dos transcripts é incremental e só relê o que mudou; execuções do GitHub já concluídas ficam em cache.

---

## Limitações conhecidas

- **Sem coluna de pensamento (thinking).** A API cobra o pensamento dentro dos tokens de saída, mas o campo que o separa não vem em todas as respostas dos transcripts do Claude Code: numa amostra local, veio em quase todas as respostas das sessões principais e em só 13 % das de subagentes, e às vezes maior que a própria saída. Somar a ausência como zero mostraria um piso como se fosse o total. Fica para uma versão seguinte, com a mesma regra do cache criado ("sem detalhe", nunca deduzido).
- **Minutos do GitHub são estimativa** a preço de tabela, não o valor faturado. A API de faturamento exige o escopo `admin:org` e está fora desta versão.
- **Só github.com.** O `origin` só é reconhecido nas formas `https://github.com/…`, `git@github.com:…` e `ssh://git@github.com/…`.
- **Pastas com caracteres fora da lista do instalador.** O comando da barra leva o caminho da pasta de dados, e esse caminho passa por um shell (sh; no Windows, Git Bash ou, sem ele, PowerShell). Para nenhum shell ler um caractere de outro jeito, o instalador só aceita nele letras de A a Z, as letras latinas de U+00C0 a U+024F (como é, ç, ñ, ğ e ß; fora os sinais de multiplicação e divisão), algarismos, espaço e `/ : . _ - ( ) + , @ ~`. Com uma pasta pessoal em outro alfabeto (cirílico, CJK) ou com `'`, `&`, `$` ou `%`, o instalador recusa (`caminho-inseguro`), não altera nada e mostra a chave para acrescentar à mão:

  ```json
  "statusLine": { "type": "command", "command": "node \"<pasta de dados>/bin/statusline.mjs\"", "padding": 0, "refreshInterval": 60 }
  ```

  Troque `<pasta de dados>` pelo caminho completo, com barras `/`, e confira que o seu shell lê esse caminho entre aspas duplas sem interpretar nada.
- **Windows e PowerShell.** Os comandos das skills são os mesmos em sh, bash, zsh e PowerShell (todos expandem `$HOME`). O `git` e o `gh` só são usados como `.exe` achado numa entrada absoluta do `PATH`, nunca na pasta atual; `.cmd` e `.bat` não servem.
- **Node sem ICU.** Num Node compilado sem ICU (`--with-intl=none`), o plugin continua funcionando com uma limpeza de texto mais estrita: nomes em alfabetos não latinos (e emoji) somem da barra e saem escapados na saída JSON.
- **`HADOUKEN_HOME` e as skills.** As skills chamam sempre `node "$HOME/.claude/hadouken/bin/cli.mjs"`. Com `HADOUKEN_HOME`, o comando fica em `$HADOUKEN_HOME/bin/cli.mjs` e as skills não o acham; rode-o direto, por exemplo `node "$HADOUKEN_HOME/bin/cli.mjs" consumo`.
- **A barra não se ajusta à largura do terminal.** O Claude Code entrega a saída da barra por um pipe, sem dizer a largura, então a barra não sabe quanto cabe e não corta nada. Na v0.3.0 a linha ficou curta, 53 colunas no exemplo (mais, com nome de modelo longo); num terminal mais estreito que isso, o fim some ou quebra, conforme o terminal. Os glifos `▰`, `▱` e `│` ocupam uma coluna; em terminais ou fontes que desenham caracteres de largura ambígua em duas colunas (comum com configuração CJK), a linha fica mais larga.
- **Sessões abertas antes da instalação não entram nas sessões ativas.** Elas não passam pelo registro do plugin, então ficam fora do `Sessões ativas` do painel e do número do aviso de projeção. O consumo delas está nas porcentagens da conta, e por isso na projeção e na previsão, e a seção "Sessões abertas (última hora)" do relatório as mostra, porque lê os transcripts.
- **A projeção dos avisos é uma reta.** Ela projeta o ritmo dos últimos minutos (20 na janela de 5 horas, 3 horas na de 7 dias) como se ele continuasse igual: uma pausa ou uma rajada muda a projeção na leitura seguinte. Ela precisa de pelo menos 3 leituras cobrindo 6 minutos, então não sai logo no começo de uma janela nem com a barra parada. A previsão do painel usa outra conta, o ritmo médio da janela inteira, e por isso reage devagar a uma rajada.
- **Uma conta por vez.** As leituras não são separadas por conta: com duas contas no mesmo usuário do sistema, o painel, os avisos e o relatório usam a leitura mais recente, de qualquer uma, e o `/usage` do painel lê a conta em que o `claude` está logado. O histórico da projeção também é um só; como as duas contas têm resets diferentes, alternar entre elas recomeça o histórico a cada troca, e a projeção some até juntar pontos de novo.
- **O Fable depende do texto do `/usage`.** O painel lê as linhas em inglês do `/usage` (`Current session`, `Current week (all models)`, `Current week (Fable)`) com regras fixas. Se uma versão do Claude Code mudar esse texto, o Fable fica em `—` ou a dica mostra `Última leitura falhou (formato).`; 5 h e semana continuam vindo da statusline.
- **O painel precisa do `code` e do `claude`.** Sem o comando `code` no `PATH` (no Mac, sem o app em `/Applications` ou `~/Applications`), a extensão não se instala sozinha, e o início de sessão diz isso numa linha. Sem o `claude` em `~/.local/bin` ou no `PATH` (no Windows, só `claude.exe`, nunca `.cmd`), o Fable fica sem leitura e a dica diz `claude não encontrado em ~/.local/bin nem no PATH.`
- **Worktrees** do mesmo projeto aparecem como projetos distintos (o projeto é o nome da pasta).
- **O plugin não troca modelo nem effort.** A documentação oficial não permite trocar de modelo no meio de uma sessão por fora, e trocar no meio desperdiça o cache. O plugin mede e avisa; a decisão é sua.

---

## Desinstalação

**1. Tire a barra, antes de desinstalar o plugin.** No terminal (ou dentro do Claude Code, com `!` na frente):

```bash
node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover
```

Ele tira **só** a barra do hadouken, com backup. Se a `statusLine` do arquivo for outra, ele não mexe em nada. Esse comando depende do plugin instalado, por isso vem primeiro; o `/hadouken:instalar` também o lembra ao terminar. Se você instalou a barra à mão (caso `caminho-inseguro`), apague a chave `statusLine` à mão.

**2. Tire o painel do VS Code.** No terminal:

```bash
code --uninstall-extension gariolilabs.claude-hadouken-painel
```

Depois recarregue cada janela aberta do VS Code (`Developer: Reload Window`): o item continua nelas até a recarga.

**3. Desinstale o plugin e, se quiser, remova o marketplace:**

```text
/plugin uninstall hadouken@claude-hadouken
/plugin marketplace remove claude-hadouken
```

No terminal: `claude plugin uninstall hadouken@claude-hadouken` e `claude plugin marketplace remove claude-hadouken`.

**4. Apague os dados, se quiser:**

```bash
rm -rf ~/.claude/hadouken
```

No PowerShell: `Remove-Item -Recurse -Force "$HOME\.claude\hadouken"`. Os backups `settings.json.bak-hadouken-*` ficam ao lado do seu `settings.json`; apague-os também, se não precisar mais deles.

Pulou o passo 1? Sem o plugin, a barra só fica vazia, sem mensagens de erro. Tire a chave `statusLine` do `settings.json` à mão. Pulou o passo 2? Sem o plugin, o item do VS Code fica em `Hadouken: abra uma sessão do Claude Code` e não lê mais nada; rode o comando do passo 2 quando quiser.

---

## Perguntas frequentes

**Atualizei e a barra sumiu, ou apareceu `claude-hadouken not found`.**
Na v0.5.2 o plugin mudou de nome, de `claude-hadouken` para `hadouken`, e precisa ser instalado uma vez com o nome novo. No terminal, rode `claude plugin install hadouken@claude-hadouken` e abra uma sessão nova. Rodar o comando único de instalação de novo também resolve (veja [Um comando](Home#um-comando)).

**O hadouken está bloqueando comandos demais.**
Primeiro, atualize: antes da v0.5.4, qualquer comando que citasse a pasta de um projeto chamado `claude-algo` (como `claude-hadouken`) com `node`, `bash` ou outro lançador era tomado por uma sessão `claude` filha e negado. Se ainda bloquear, a resposta do bloqueio diz qual proteção agiu; desligue só ela na aba Proteções da janela do VS Code ou com `/hadouken:limites protecoes.<item> desliga` (veja [Proteções](Limites#proteções), com o risco de cada uma). Para a guarda de consumo, mude os tetos na aba Guarda ou libere por um tempo com `/hadouken:liberar`.

**O que quer dizer "sem leitura"?**
Que o plugin não tem um número confiável agora e prefere dizer isso a mostrar um valor velho como atual. Acontece quando a última leitura tem mais de 1 hora, quando o reset já passou sem leitura nova, quando o arquivo de estado está fora do formato, ou antes da primeira resposta da API. A barra recebe os limites junto com as respostas da API, e o painel também lê o `/usage` a cada 30 s com uma sessão ativa: basta seguir trabalhando, ou clicar no item do painel.

**Por que o painel mostra `Hadouken: sem leitura` o tempo todo?**
Sua conta não envia limites à statusline (chave de API, ou plano sem limites), e o `/usage` não traz as linhas de uso. O resto (barra, relatório de tokens) funciona normalmente, e o relatório diz "Limites indisponíveis nesta conta". Se só o Fable fica em `—`, a dica diz por quê: ainda não houve leitura oficial, o `claude` não foi achado, ou a leitura está pausada ou bloqueada.

**Onde foram parar o 5h e o 7d da barra?**
Para o painel do VS Code, desde a v0.3.0. Eles são da conta, iguais em todas as sessões, e a barra ficou só com o que é de cada sessão. Veja [O painel no VS Code](Painel-e-janela-do-VS-Code#o-painel-no-vs-code).

**Minha sessão aberta não mostra a barra. Está quebrado?**
Não, é de propósito: só sessões iniciadas depois da instalação usam o plugin. Numa sessão antiga, o comando da barra não imprime nada e os hooks ficam mudos, para não mudar o comportamento de um trabalho que já estava em andamento. Abra uma sessão nova. (Barra vazia é isso; `—` num segmento é outra coisa: a sessão é do plugin, mas aquele dado ainda não chegou.)

**Por que os números podem ser diferentes do `/usage` ou do console da Anthropic?**

- **Limites:** o painel usa a leitura mais nova entre a statusline e o `/usage` (lido a cada 30 s), arredondada para baixo, então deve bater com a aba Uso do claude.ai, com até uns 30 s de atraso. Os avisos e o relatório usam a leitura da statusline, a última que chegou (até 1 hora de idade).
- **Tokens:** o relatório só enxerga os transcripts do Claude Code **desta máquina**. Uso no claude.ai, no app, em outra máquina ou direto pela API não aparece nas tabelas, mas conta nos limites da conta. Transcripts que o próprio Claude Code já apagou também saem da conta.
- **Console da Anthropic:** ele mostra o uso de chaves de API da organização, que é outra coisa: nos planos Pro e Max, o uso da assinatura não passa por ele.
- **Minutos do GitHub:** são estimativa a preço de tabela, não o valor faturado.

**Que dados saem da minha máquina?**
Nenhum, exceto as consultas `gh api` (sempre GET, só leitura) que o relatório faz aos repos configurados, ou ao `origin`, usando o login do seu `gh`, e a consulta de uso que o próprio Claude Code faz quando o painel roda `claude -p /usage`. Sem telemetria, sem chamadas à API do Claude. Detalhes em [Privacidade e segurança](#privacidade-e-segurança).

**Como desinstalar?**
Em quatro passos: tire a barra (`node "$HOME/.claude/hadouken/bin/cli.mjs" instalar --remover`), tire o painel (`code --uninstall-extension gariolilabs.claude-hadouken-painel`), desinstale o plugin (`/plugin uninstall hadouken@claude-hadouken`) e, se quiser, apague `~/.claude/hadouken`. O passo a passo completo está em [Desinstalação](#desinstalação).

**O relatório diz "plugin files not found - open a new session".**
O plugin foi atualizado e a versão antiga saiu do disco. A próxima sessão reaponta os scripts para a versão em uso.

**Funciona no Windows? E no terminal do VS Code?**
Sim. A barra é um comando que o Claude Code roda onde quer que ele esteja aberto, inclusive no terminal integrado do VS Code. O painel é uma extensão do VS Code; no Windows, ela precisa do `code.cmd` no `PATH` para se instalar e do `claude.exe` para ler o Fable. A CI roda os testes em Linux, Windows e macOS, com Node 20 e 24 (o robô do kit, com 20, 22 e 24), e caminhos com espaços e acentos são cobertos por teste.

**Tenho várias sessões abertas no VS Code. O plugin considera todas?**
Sim, de dois jeitos. As porcentagens de 5 h, semana e Fable já são da conta inteira, somando todas as sessões (do VS Code, de outro terminal ou de outra máquina), e o painel as mostra uma vez só, com a previsão e a projeção saindo delas. A dica do painel também mostra quantas sessões do plugin estão ativas agora (`Sessões ativas: 3`), e o aviso de projeção leva esse número ao Claude, que pode reduzir o paralelismo. O plugin não distingue sessões do VS Code das de outro terminal: conta todas as sessões do Claude Code desta máquina que começaram depois da instalação. Veja [Projeção e várias sessões](Avisos-e-alertas#projeção-e-várias-sessões).

**Quanto custa?**
O plugin é gratuito e de código aberto (MIT). Ele não chama a API do Claude; o custo em tokens são as linhas curtas injetadas no contexto: a do início de sessão e as dos avisos, só quando uma faixa ou modo muda ou quando a projeção entra numa faixa. O painel não gasta tokens: o `/usage` é comando local, e cada leitura confere `num_turns` 0 e custo 0. As chamadas ao GitHub são leituras da API e não gastam minutos do Actions.

---
