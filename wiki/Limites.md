# Limites (/hadouken:limites) e configuração

[English](Limits)

## Configuração

Nada é obrigatório. Sem configuração, o plugin funciona com os padrões abaixo.

### Repos do GitHub: `config.json`

Crie `~/.claude/hadouken/config.json`:

```json
{ "repos": ["sua-org/seu-app", "sua-org/site"] }
```

- **Formato:** cada item é `dono/repo` (letras, números e `-` no dono; letras, números, `.`, `_` e `-` no repo; sem `..`). Até 20 itens. Qualquer item fora do formato, ou o arquivo inválido, faz o plugin ignorar o arquivo inteiro, avisar no relatório e usar o `origin`:

  ```text
  Aviso: config.json ignorado: o formato aceito é {"repos": ["dono/repo"]}, com até 20 repos; usando o origin do repositório atual.
  ```

- **Sem `config.json`** (ou sem a chave `repos`): o relatório usa o `origin` do repositório git do diretório atual, se ele estiver no github.com.
- **Por chamada do relatório**, só os **3 primeiros repos distintos** são consultados; os outros aparecem como "fora do limite de repos por coleta".
- **Por repo:** até 2 páginas de 100 execuções dentro de 30 dias, um orçamento de 60 consultas de jobs por coleta (o que sobrar é lido nas próximas, e o repo aparece como "resumo parcial") e um prazo de **10 s** para toda a coleta do GitHub.
- **Cache:** execuções concluídas não mudam, então ficam guardadas; o resto é reaproveitado por 15 minutos.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `CLAUDE_CONFIG_DIR` | Quando é um caminho absoluto, o plugin lê os transcripts em `<CLAUDE_CONFIG_DIR>/projects` e o instalador edita `<CLAUDE_CONFIG_DIR>/settings.json`, como o Claude Code. |
| `HADOUKEN_HOME` | Troca a pasta de dados (padrão `~/.claude/hadouken`). Só vale um caminho absoluto completo (no Windows, com letra de unidade ou UNC). Com qualquer outro valor, o plugin fica **sem** pasta de dados: não grava nada, o instalador recusa, e a pasta padrão nunca é usada no lugar. O painel do VS Code só a enxerga se ela estiver no ambiente do próprio VS Code. |
| `HADOUKEN_SETTINGS` | Troca o `settings.json` que o instalador edita. Mesma regra: só caminho absoluto completo; qualquer outro valor faz o instalador recusar. |
| `HADOUKEN_SEM_PAINEL` | Com o valor exato `1`, o início de sessão não instala nem atualiza a extensão do painel no VS Code. Para uma extensão já instalada parar de ler o `/usage`, a variável precisa estar no ambiente do próprio VS Code (veja [Instalar, desligar e remover](Painel-e-janela-do-VS-Code#instalar-desligar-e-remover)). |
| `NO_COLOR` | Definida e não vazia, tira as cores da barra. |

O instalador mostra para qual pasta de dados a barra vai apontar e de onde veio essa escolha; quando ela vem de `HADOUKEN_HOME`, avisa que isso fica gravado no `settings.json` e vale para todos os projetos.

## O comando /hadouken:limites

O mesmo que a janela do VS Code, pelo terminal. Só o senhor usa, digitando; o Claude não o chama, e uma sessão `claude -p` ou do SDK é recusada. Como o `/hadouken:liberar`, é um hook que responde antes do modelo: não gasta tokens.

| Comando | O que faz |
|---|---|
| `/hadouken:limites` | Mostra a tabela: cada item, o valor em vigor, o padrão e a faixa aceita. |
| `/hadouken:limites <item> <valor>` | Grava um valor. Fora da faixa, nada muda e a resposta diz a faixa. |
| `/hadouken:limites <item> padrao` | Volta um item ao padrão. |
| `/hadouken:limites padrao` | Volta todos os itens da tabela ao padrão. |

Os itens são os da tabela; os liga-desliga aceitam `liga` e `desliga` (por exemplo `barra.ctx.amarelo 75` ou `protecoes.hooks desliga`). Se a configuração mudou entre a leitura e a gravação, nada é gravado e a resposta pede para tentar de novo. Tudo fica em `~/.claude/hadouken/config.json`, com cópia de segurança.

## Proteções

Desde a v0.5.4, os quatro bloqueios abaixo podem ser desligados, na aba Proteções da janela ou com `/hadouken:limites protecoes.<item> desliga`. Todos vêm ligados. Desligar não pede confirmação, mas a janela mostra o que passa a valer, e a mudança pode ser desfeita.

| Item | Ligado (padrão) | Desligado: o risco |
|---|---|---|
| `protecoes.sessaoFilha` | Bloqueia o Claude de abrir outra sessão `claude` (`claude -p`, `claude plugin install`) quando a guarda disparou. | O Claude pode contornar a guarda abrindo uma sessão nova. |
| `protecoes.arquivos` | Bloqueia o Claude de editar a configuração do hadouken e os `settings.json` do Claude Code. | O Claude pode afrouxar a guarda ou mudar os seus settings sozinho. |
| `protecoes.hooks` | Segura, na sessão em curso, mudanças em hooks, plugins e `disableAllHooks` feitas nos settings por fora (pelo shell, por exemplo); a próxima sessão lê o arquivo novo. | Uma mudança desse tipo vale na hora, inclusive a que desliga o próprio hadouken. |
| `protecoes.agenda` | Nega tarefa agendada, `/loop` ou rotina que peça o liberar ou o aprender. | Uma tarefa sem o senhor presente pode pedi-los (o liberar ainda recusa o que não foi digitado). |

Nenhuma proteção bloqueia comandos só por citarem a pasta do projeto: um comando com o caminho do repositório (por exemplo `node` ou `grep` dentro de `claude-hadouken`) passa, e um caminho absoluto entre aspas com uma pasta `Claude …` no meio (`"C:/Projetos DEV/Claude Hadouken/x"`) também passa, mesmo fora da pasta da sessão. Antes da v0.5.4, isso era bloqueado por engano.

---
