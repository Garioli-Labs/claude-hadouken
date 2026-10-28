# Guarda de consumo

[English](Usage-guard)

## A guarda de consumo

Desde a v0.4.0, o hadouken trava o gasto onde ele começa: no despacho de subagente, no uso do Fable e no despacho caro. A trava fica até **você** liberar com `/hadouken:liberar` ou até o reset da janela que a disparou; desde a v0.5.4, com ela ativa, o hadouken pergunta antes de negar o que é decisão sua (veja [Perguntar em vez de bloquear](#perguntar-em-vez-de-bloquear-padrão-desde-a-v054)). A liberação só vale digitada por você na conversa: uma sessão `claude` filha, uma tarefa agendada, um `/loop` ou uma rotina não liberam. O Claude não se libera sozinho sem forjar os arquivos do hadouken ou mexer no próprio plugin; a guarda é um freio contra o descuido, não uma barreira contra um modelo decidido a contorná-la (veja R1 no [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md)).

### O que trava

| Gatilho ou proteção | Quando | O que bloqueia |
|---|---|---|
| G1 | a janela de 5h projeta 100% em até 90 min, com o reset a pelo menos 15 min | todo despacho de subagente, a troca para o Fable e, numa sessão Fable, o prompt |
| G2 | a semana projeta 100% em até 24 h, com pelo menos 2 h de leituras | o mesmo |
| G3 | a janela de 5h em 90% ou mais, com o reset a pelo menos 15 min | o mesmo |
| G4 | a semana em 85% ou mais | o mesmo |
| G5 | despacho caro: effort `max` em qualquer modelo, ou Fable em `xhigh` ou `max` | aquele despacho |
| G6 | o limite do Fable foi atingido (aviso de limite do Claude Code, ou a leitura oficial da semana do Fable em 100%, com até 15 min) | despacho Fable, a troca para o Fable e o prompt numa sessão Fable |
| G7 | o quinto despacho Fable em 5 h, ou qualquer despacho Fable com a semana do Fable em 90% ou mais (leitura oficial com até 15 min) | o mesmo |
| P4 | qualquer trava ativa | abrir uma sessão `claude` filha pelo Bash ou pelo PowerShell (direto ou por `npx`, `node`, `bash`, `sh`, `cmd`, `pwsh`, `powershell` e, no PowerShell, `Start-Process`) |
| P5 | sempre, mesmo com a guarda desligada | editar a pasta de dados do hadouken (`~/.claude/hadouken`) com Write, Edit, MultiEdit ou NotebookEdit |
| P5 (settings e plugin) | sempre, mesmo com a guarda desligada | editar com essas ferramentas os `settings.json` e `settings.local.json` do usuário (em `~/.claude` e no `CLAUDE_CONFIG_DIR`) e o próprio plugin (a raiz e o `claude-hadouken` em `plugins/`); nos settings de projeto, só a edição que muda o valor de `disableAllHooks`, `enabledPlugins` ou `hooks` (a P5 a aplica ao arquivo atual e compara) ou que traz ou apaga uma dessas palavras ou `claude-hadouken` e, num arquivo que já tem uma delas, o Write e a troca de um trecho curto (menos de 40 caracteres). Acima de 1 MiB, a edição que cita `settings` ou `hadouken` é negada sem ser lida; a que não cita passa (SECURITY.md, R2). A mudança, se for preciso, você aplica à mão |
| P5 (config) | sempre, numa sessão registrada, mesmo com a guarda desligada | uma mudança em `disableAllHooks`, `enabledPlugins` ou `hooks` no `settings.json` do usuário ou nos `.claude/settings.json` e `.claude/settings.local.json` do projeto, venha de onde vier (a P5 comum cobre as ferramentas de edição antes; o Bash, o PowerShell, você ou outro programa caem aqui). Ela é segurada só na sessão em curso: o arquivo no disco fica mudado, e a próxima sessão o lê. Medido ao vivo só nos settings de projeto; os do usuário e o local são cobertos pelo código, sem medição ao vivo |
| liberação | sempre, mesmo com a guarda desligada | uma sessão `claude` filha com `/hadouken:liberar` no texto; uma tarefa agendada, um `/loop` ou uma rotina (CronCreate, ScheduleWakeup, RemoteTrigger e os schedulers MCP com `cron`, `schedule`, `trigger` ou `task` no nome) com `/hadouken:liberar` ou, desde o aprendizado local, `/hadouken:aprender` no texto |

Os números são ajustáveis na chave `guarda` do `config.json` (o 90% do Fable é `guarda.fable.tetoPct`). Afrouxar a configuração não solta uma trava que já disparou.

Quando o reset oficial do Fable não se lê, a trava do G7 não tem fim marcado: fica até `/hadouken:liberar fable`.

**A P5 de config (hook `ConfigChange`).** No primeiro início de cada sessão, o hadouken tira uma foto dos três campos (`disableAllHooks`, `enabledPlugins` e `hooks`) daqueles três arquivos: só hashes, em `config-base.json`. Quando o Claude Code avisa que um deles mudou, o hook compara o arquivo com a foto da própria sessão e, se um dos três campos mudou, segura a mudança nesta sessão; os outros campos (`model`, `permissions` e o resto) passam. O Claude recebe:

```text
hadouken: bloqueado: uma mudança em disableAllHooks, enabledPlugins ou hooks nos settings não vale nesta sessão. Se foi o usuário, ela passa a valer na próxima sessão; o Claude não deve repetir a mudança.
```

- É uma trava da sessão, não uma proteção do arquivo: nada é desfeito no disco. Quem muda esses campos de propósito abre uma sessão nova. A guarda fica desligada a partir da próxima sessão se a mudança desligou os hooks ou o plugin.
- Um compact mantém a foto do início, porque mantém o id da sessão. Não medido: se o `/clear` e o `resume` num processo novo mantêm o id. Se o `/clear` trocar o id, uma mudança segurada antes dele passa na gravação seguinte. Uma sessão aberta depois da mudança tira a foto do arquivo novo e a aceita.
- Um settings ilegível (JSON inválido, inclusive com comentários ou vírgula sobrando, acima de 1 MiB, ou que não é arquivo comum) tem toda mudança segurada até a próxima sessão. Escrever o arquivo como JSON comum acaba com isso.
- Não medido: se o Claude Code dispara o mesmo aviso nas gravações dele mesmo. Se disparar, ligar ou desligar um plugin pelo `/plugin`, editar um hook pelo `/hooks` ou mudar um desses campos pelo `/config` no meio da sessão também fica segurado até a próxima sessão.
- Ficam de fora a política gerenciada (`policy_settings`) e as mudanças em skills. Os limites estão no R1 do [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md).
- Os eventos vão para `guarda-eventos.json`, com o tipo `config-bloqueada` e o primeiro campo que mudou (`disableAllHooks`, `enabledPlugins` ou `hooks`), ou `ilegivel`, `sem-caminho` (settings de projeto sem caminho) ou `sem-sessao` (settings de projeto sem id de sessão válido). As falhas do próprio hook ficam no evento `erro`, com `config-foto`, `P5:config` ou `P5:config-sessao`.

**Contagem dobrada da P5 nos settings do usuário.** Duas regras do filtro `if` casam o `settings.json` do usuário, então o hook roda duas vezes na mesma edição e grava dois eventos `arquivo-negado`. A negação é a mesma; só a contagem em "Guarda (7 dias)" dobra.

### Perguntar em vez de bloquear (padrão desde a v0.5.4)

Com a trava dos G1 a G7 ativa, o hadouken **pergunta** em vez de parar o turno, porque gastar mais é uma decisão sua:

- Despacho de subagente pela conversa principal (G1 a G4, G6, G7) e despacho caro (G5): o Claude Code mostra o pedido de aprovação com o motivo. Aprovado, aquele despacho segue; recusado, a trava continua. O turno não para.
- Troca para o Fable com `/model`: o seletor pede a confirmação.
- Prompt numa sessão Fable: passa, e o Claude avisa numa linha que `/model sonnet` gasta menos.
- Dentro de um subagente não há a quem perguntar: o despacho novo segue negado, sem parar o turno.
- Nos modos de permissão que aprovam sozinhos (por exemplo `bypassPermissions`), o Claude Code pode aceitar o pedido sem mostrar. Não medido.

A P4, a P5 e as regras da liberação não mudam: elas não perguntam. Cada pergunta vira o evento `perguntado` (`P1:…`, `G5`, `P2:…`, `P3:…`). Para voltar ao bloqueio de antes, desligue **Perguntar em vez de bloquear** na aba Guarda da janela, ou `/hadouken:limites guarda.perguntar desliga`.

### Como liberar

Aprovar uma pergunta solta só aquele pedido. Para soltar a trava inteira:

- `/hadouken:liberar`: libera por 2 h.
- `/hadouken:liberar 8h`: de 1 a 24 h.
- `/hadouken:liberar janela`: até o reset da janela que travou, no máximo 24 h.
- Acrescente `fable` para soltar também o limite do Fable. Depois do limite, o Fable pode consumir créditos de uso.
- Acrescente `caro` para soltar o despacho caro, por exemplo antes da revisão final de um bloco.

Toda liberação acaba antes do prazo se a semana subir 10 pontos. Ela vale para todas as sessões, porque o limite é da conta. A barra mostra "liberada até …" enquanto ela vale, também ao lado de uma trava que ela não cobre.

### O que a barra diz

- `guarda: 7d`: disparada, com a janela ou `Fable`.
- `liberada até hoje 16:40`: liberação ativa. Com uma trava que ela não cobre, aparecem as duas: `guarda: Fable · liberada até hoje 16:40`.
- `liberação sem origem`: há uma liberação ativa sem o registro de quem a deu, sinal de arquivo gravado à mão (veja R1 no [SECURITY.md](https://github.com/Garioli-Labs/claude-hadouken/blob/main/SECURITY.md)).
- `guarda com erro`: a avaliação da guarda falhou, ou um hook da guarda registrou um erro nos últimos 15 min. A chamada passou (a guarda falha aberta, mas à vista).
- `guarda desligada`: `"ligada": false` no `config.json`.
- `guarda sem leitura`: sem leitura de limite; só G5, G6 e G7 valem.
- `sem guarda nesta sessão`: a sessão foi aberta antes da atualização.
- `Fable 3/4 em 5h · semana Fable 57%`: numa sessão Fable, a contagem de despachos e a semana do Fable pela leitura oficial (o mesmo `/usage` do painel no VS Code), com até 15 min.
- `semana Fable ≥ 57% (leitura de 40 min)`: a leitura oficial está mais velha que 15 min; o número é um piso, e a guarda não o usa.
- `sem leitura oficial`: não há leitura válida do Fable (o painel ainda não leu, pausou por pouca RAM ou o arquivo está fora do schema), ou ela é de antes do reset do Fable.

**Sessões abertas só ganham a guarda depois de `/reload-plugins` ou de reiniciar.**

### Proteções que o senhor liga e desliga

Além da guarda, o hadouken tem quatro bloqueios fixos: sessão `claude` filha, arquivos do hadouken, mudança de hooks e liberar pedido por tarefa agendada. Desde a v0.5.4, cada um pode ser desligado na aba Proteções da janela do VS Code ou pelo `/hadouken:limites`. A tabela com o risco de cada um está em [Proteções](Limites#proteções).

## Roteamento de modelo e effort

O hadouken confere cada agente lançado pelo Claude e a sessão principal, sem chamar modelo nenhum:

- **Nega (N1):** agente de busca (`Explore`, `hadouken:busca`) em Opus ou Fable, ou com effort `xhigh` ou `max`.
- **Nega (N2):** `hadouken:busca` ou `hadouken:mecanico` com o modelo trocado para Opus ou Fable no despacho.
- **Avisa (A1 a A3):** agente em Fable ou effort `max` sem o arquivo do agente pedir isso; agente caro com descrição de busca; mais de 5 despachos curtos em 10 minutos.
- **Sugere para a sessão:** `/effort medium` ou `/model sonnet` quando quase tudo foi trabalho simples, `/effort high` quando há sinais de dificuldade; no máximo uma vez a cada 30 minutos.
- **Otimizações:** arquivo lido inteiro várias vezes, comando com saída enorme, servidores MCP parados, contexto fixo caro e sugerir `/compact` quando o contexto incha e o cache cai.

Cada regra tem o seu liga-desliga na aba Roteamento da janela (`roteamento.negarN1`, `roteamento.negarN2`, `roteamento.avisos`, `roteamento.sugerirSessao` e `roteamento.otimizacoes.*` no `config.json`). Uma liberação pelo `/hadouken:liberar` também solta N1 e N2 enquanto durar.

---
