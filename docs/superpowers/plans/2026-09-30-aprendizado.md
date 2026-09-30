# claude-hadouken v0.4.0: aprendizado local (plano de implementação)

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

> **Ordem:** este plano roda **depois** da parte 2 da guarda (`2026-09-30-guardiao-parte2.md`). Ele só depende dos módulos da parte 1 que já estão no branch (`src/estado.js`, `src/guarda/arquivo.js`, `config.js`, `registros.js`, `mensagens.js`, `src/hooks/comum.js`, `liberar.js`, `src/uso/painel.js`, `oficial.js`, `ler-uso.js`, `src/previsao.js`, `src/configuracao.js`). Onde um arquivo que a parte 2 também muda é editado aqui (`hooks/hooks.json`, `test/guarda-ameacas.test.js`, `src/hooks/session-start.js`, `session-end.js`, `prompt-submit.js`, `src/uso/painel.js`), o passo diz **o trecho a achar**, não o número da linha.

**Objetivo:** o hadouken aprende, só nesta máquina e com 0 tokens, com o OpenTelemetry do Claude Code (filtrado por um Collector em 127.0.0.1) e com os dados que os hooks já gravam; ajusta sozinho o conforto dentro de limites fixos, só aperta a guarda sozinho e deixa afrouxamentos e trocas de modelo como sugestões que o Sr. Garioli aprova.

**Arquitetura:** módulos novos em `src/aprendizado/`: dois puros de privacidade (`otlp.js`, a segunda barreira, e `config-coletor.js`, a primeira), um agregador puro (`agregar.js`), um decisor puro com relógio por parâmetro (`ajustar.js`), a E/S dos arquivos novos (`arquivos.js`, `registro.js`), o único módulo com rede (`baixar.js`), o único com processo filho (`coletor.js`), a edição do `env` do `settings.json` sobre o gravador seguro que já existe (`settings-env.js`), a orquestração do `ligar`/`desligar` (`ligar.js`), o passo que roda depois da saída do SessionStart e do SessionEnd (`passo.js`), os textos fixos (`mensagens.js`) e o comando `/claude-hadouken:aprender` (`comando.js`, `src/hooks/aprender.js`, `skills/aprender/SKILL.md`). A guarda ganha só `src/guarda/aperto.js` (`min(config.json, aperto)`), sem carregar o aprendizado no caminho quente.

**Stack:** Node ≥ 20, ESM, zero dependências, `node --test`. Collector oficial `otelcol-contrib` (binário do release do GitHub, versão e SHA-256 fixados no código pelo spike A2).

**Spec:** `docs/superpowers/specs/2026-09-30-aprendizado-design.md` (autoridade; aprovada pelo Sr. Garioli), mais a emenda que a Task 1 acrescenta no fim dela com os fatos dos spikes A1–A3. Onde o corpo e a emenda divergem, **vale a emenda**. As decisões que este plano toma onde a spec é omissa estão em "Resoluções do plano", abaixo, e são citadas pelo número (R1…R14) nos comentários do código.

## Restrições globais

- Node `>=20`, ESM, **zero dependências**, testes com `node --test`.
- **Rede:** só `src/aprendizado/baixar.js` importa `node:http`/`node:https` (ou `fetch`), e só o `ligar` confirmado o chama. **Processo filho:** só `src/aprendizado/coletor.js` importa `node:child_process`. `src/guarda/**` continua sem nenhum dos dois, inclusive o `aperto.js` novo. Nenhum outro módulo novo ou modificado por este plano importa `node:net`, `dns`, `tls`, `dgram`. `test/aprendizado-fronteiras.test.js` (Task 2) barra pelo texto.
- **0 tokens e nada sai da máquina:** nenhuma chamada de modelo ou de API; nenhum exportador remoto, dashboard ou nuvem. A única rede é o download do Collector, uma vez, pelo `ligar` confirmado.
- **Collector (§5.1):** receptor `otlp` só `http` em `127.0.0.1:47318`, sem gRPC; processadores `memory_limiter` (64 MiB) → `resource` e `attributes` com `delete` em `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` e todo `vcs.*` (por padrão de chave) → `batch`; exportador `file` em `~/.claude/hadouken/otel/telemetria.jsonl` com rotação de 5 MB, 3 arquivos antigos e 30 dias; telemetria própria desligada; sem extensões nem outro exportador. Configuração gerada pelo hadouken e regravada a cada subida (não editável).
- **Conteúdo (§5.2):** `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` e `OTEL_LOG_RAW_API_BODIES` nunca são ligados; o `ligar` recusa se algum estiver ligado (no `env` do `settings.json` ou no ambiente) ou se já houver outro endpoint OTLP. Só métricas e eventos; traces fora.
- **Leitor (§5.3):** cada registro é montado do zero, só com os campos de §4.1; 1 MiB por linha, 20 MB no total, `lstat` antes de ler (link = inválido), cursor validado contra o tamanho do arquivo. `session.id` não é lido (R11).
- **Arquivos novos na pasta de dados:** gravação atômica (`gravarJsonAtomico` de `src/estado.js`), `lstat` antes de ler (`lerSemLink` de `src/guarda/arquivo.js`), teto de bytes, reconstrução só dos campos conhecidos; inválido é reconstruído vazio. Tetos: `aprendizado.json` 256 KiB, `ajustes.json` 64 KiB, `sugestoes.json` 16 KiB, `aprendizado-cursor.json` 4 KiB, e os novos do plano (R8) `aprendizado-eventos.json` 16 KiB, `otel/ligado.json` 4 KiB, `otel/bin/instalado.json` 4 KiB, `otel/coletor.pid` 1 KiB. **`estado.json`, `alertas.json` e `projecao.json` não ganham nenhuma chave nova.**
- **Limites de §4:** piso de 7 dias corridos com dados **e** 20 sessões; 20 amostras de cada lado numa sugestão de modelo; no máximo um ajuste por item a cada 24 h; passo máximo de 5 pontos ou dobro/metade do intervalo (peso da previsão: 0,1, R9); `desfazer` bloqueia o item por 7 dias; `ajustes.json` com teto de 64 KiB e os registros mais antigos saem primeiro.
- **Guarda (§4.4):** só aperta sozinha (−5, piso 70); afrouxar é sempre sugestão aprovada pelo usuário e só até o valor do `config.json`. A guarda lê `min(config.json, aperto)`; `ajustes.json` ausente, inválido ou link, ou aprendizado desligado → `config.json` puro. Sugestão de modelo **nunca** é aplicada.
- **Desligado é o padrão** e, desligado, o hadouken se comporta exatamente como a guarda sem aprendizado (nenhum arquivo novo é criado, nenhum ajuste é lido).
- **Desempenho (§7):** passo de aprendizado ≤ 300 ms com 20 MB novos e 26 semanas de agregados; ≤ 30 ms no caso comum; roda **depois** da saída do SessionStart e do SessionEnd; exceção vira o evento `erro` e o hook segue.
- **Vida do Collector (§3.3):** sobe no SessionStart (desanexado, sem janela, sem esperar); não sobe com menos de 1,5 GiB livres (`RAM_MIN_BYTES` de `src/uso/painel.js`); para no SessionEnd sem outra sessão ativa nos últimos 5 min (R2); órfão com mais de 30 min sem sessão é reiniciado; no Windows, `tar.exe`, `tasklist.exe` e `taskkill.exe` pelo caminho absoluto de `System32` (como `matarArvore` em `src/uso/oficial.js`); o PID é conferido pelo nome do processo antes de matar.
- **Textos:** só de modelos fixos em `src/aprendizado/mensagens.js`, preenchidos com números validados, rótulos do código e caminhos que o próprio hadouken calculou. Nada lido de telemetria, de arquivo, do stdin ou do ambiente é repetido. Única exceção, só no `status` (que só o usuário vê, pela `reason` do `decision:block`): nomes de modelo que casam `MODELO_VALIDO` e nomes de subagente que casam `^[A-Za-z0-9._-]{1,40}$`, validados na leitura e de novo no texto.
- **Testes:** todo teste usa `HADOUKEN_HOME` temporário dentro de `os.tmpdir()` (o `conferirHome` de `test/hooks.test.js`), `HADOUKEN_SETTINGS` e `CLAUDE_CONFIG_DIR` temporários, e todo hook filho recebe `HADOUKEN_SEM_PAINEL: '1'`. Nenhum teste toca `~/.claude/hadouken` nem o `~/.claude/settings.json` de verdade. O teste de download usa um servidor HTTP local, nunca a rede. Nenhum teste roda o `claude` nem o Collector de verdade (o Collector é um processo falso em Node).
- **Nunca** rodar `claude -p /usage` (ou qualquer `claude` com argumento que começa com `/`) pelo Git Bash: só por `execFile` do Node ou pelo PowerShell.
- Commit sempre com pathspec explícito (`git commit -m "…" -- <arquivos>`), e a mensagem termina com uma linha em branco e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No PowerShell, use here-string (`@'…'@`) para a mensagem.
- Texto acentuado só pelo Write/Edit ou por Python com utf-8 e LF; nada de código com barra invertida por heredoc do Bash.
- Comentários e mensagens em português, no estilo dos arquivos vizinhos: o comentário explica o porquê e cita a seção da spec (`§x.y`) ou a resolução do plano (`R?`).

## Resoluções do plano (onde a spec é omissa ou se contradiz)

- **R1 — Cópia do `settings.json`.** A spec fala em `settings.json.hadouken-bak`. O plugin já tem um gravador do `settings.json` com todas as garantias (sem link, teto, UTF-8, formato do original, conferência pelo `lstat` antes do rename) que faz a cópia em `<settings>.bak-hadouken-<agoraMs>` e guarda as 5 mais novas. O `env` usa esse mesmo gravador (Task 9); a cópia existe, com outro nome, e dois `ligar` nunca brigam pelo mesmo arquivo.
- **R2 — "Outra sessão ativa nos últimos 5 minutos".** O critério de 5 min do painel é o `at` das sessões em `estado.json` (`ATIVA_RECENTE_MS`), não `ativas.js` (que guarda 30 dias). O SessionEnd conta as sessões de `estado.json` com `at` de até 5 min, **fora a que está encerrando**.
- **R3 — "Tetos de despacho caro e de 7d".** O despacho caro (G5) não tem teto numérico na guarda da parte 1: sempre pede liberação. O aperto automático cobre só os dois tetos percentuais: `fableTetoPct` e `teto7d`.
- **R4 — Confirmação "no chat".** O comando é um hook `UserPromptExpansion` que bloqueia a expansão (sem modelo). A confirmação é em dois tempos: `ligar` mostra o plano e um código de 8 hex; `ligar <código>` executa. O código é o SHA-256 dos bytes do `settings.json` + o plano + a versão + a plataforma: se o arquivo mudou entre a prévia e a confirmação, o código não bate e o `ligar` recusa (§6, última linha).
- **R5 — Download dentro do hook.** O handler do `aprender` tem timeout de 600 s no `hooks.json` e o download tem prazo próprio de 300 s (ajustado pela Emenda A2), então o hook sempre termina antes do timeout.
- **R6 — Porta ocupada sem `node:net`.** Como só `baixar.js` pode ter rede, a porta não é sondada: o Collector tenta subir, e a mensagem de erro dele (stderr em `otel/coletor.log`) é classificada no próximo SessionStart como `porta-ocupada` (padrão confirmado pela Emenda A2).
- **R7 — Integridade do binário.** O SHA-256 fixado no código é o do `.tar.gz` do release; ele é conferido no download. O hash do binário extraído é gravado na instalação (`otel/bin/instalado.json`) e conferido de novo a cada subida em que o tamanho ou o mtime mudarem. Um `.tar.gz` fora do hash nunca é extraído.
- **R8 — Arquivos que a spec não lista.** `otel/ligado.json` (o que o `ligar` pôs no `env`, para o `desligar` tirar só isso), `otel/bin/instalado.json` (R7), `otel/coletor.log` (R6, truncado a cada subida), `aprendizado-eventos.json` (eventos `porta-ocupada`, `ajuste-fora`, `erro`…, 50 no máximo) e `aprendizado.lock` (um passo por vez).
- **R9 — Números que a spec não fixa.** Faixa vermelha: mediana de antecedência ≥ 15 min na 5h e ≥ 8 h na 7d (a amarela usa os 45 min e 24 h da spec). Passo do peso da previsão: 0,1 por 24 h, alvo 0,5 quando o ritmo por hora cobre ≥ 80% das horas ativas. O item `painel.intervaloS` (nome do exemplo de §4.7) é o intervalo **fora** das horas ativas: dobra de 30 até 120 s; nas horas ativas o painel usa 30 s.
- **R10 — Previsão.** A mistura com o ritmo por hora vale para as linhas de alerta (UserPromptSubmit). A guarda continua com a regressão pura: um perfil que atrasasse a previsão afrouxaria o G1/G2 sem aprovação.
- **R11 — Fontes.** Custo, tokens, latência e erros vêm do evento `api_request`/`api_error` (um por pedido, o que dá o "custo por pedido" de §4.5); as métricas `cost.usage`/`token.usage` não são lidas, para não somar duas vezes. Das métricas, só `active_time`. As sessões são contadas pelo SessionStart com `source: "startup"`, então `session.id` nunca é lido.
- **R12 — Extração.** Extrair com o `tar` do sistema é processo filho, então mora em `coletor.js`; `baixar.js` só baixa e confere o hash.
- **R13 — Onde o anúncio e os avisos aparecem.** A linha de §4.6 e os avisos do Collector (porta ocupada, pouca RAM, hash, falha) vão ao usuário pelo `systemMessage` do SessionStart, fora do contexto do Claude (0 tokens, §7). O `hookSpecificOutput.additionalContext` continua só com as linhas que a guarda já mandava.
- **R14 — Alcance das faixas aprendidas.** `painel.amarelo` e `painel.vermelho` mudam só o nível do painel do VS Code (`aviso`/`erro`). As linhas de alerta (`src/alerta.js`) e a guarda não mudam: os limiares delas são do `config.json` e da parte 1.

## Foco de revisão

1. **`settings.json` com `env` que não é objeto, com CRLF, BOM, tabulação ou chaves do usuário antes e depois das nossas:** o `ligar` recusa (`env-invalido`) ou grava preservando a ordem das chaves e o formato (quebra de linha, BOM, indentação); o `desligar` tira só as chaves com o valor que o `ligar` gravou. Testes na Task 9.
2. **Rotação do `telemetria.jsonl` entre dois passos** (o arquivo novo é menor que o cursor; o velho foi renomeado com linhas ainda não lidas): nada se perde nem é contado duas vezes. Teste na Task 2.
3. **Dois SessionStart ao mesmo tempo** (duas janelas abertas juntas): um só Collector sobe, e o segundo não gera um falso `porta-ocupada`; dois passos simultâneos não contam em dobro. Testes nas Tasks 4 e 8 (a trava e a subida) e 12 (dois processos rodando o passo inteiro).
4. **Relógio adiantado ou dados com instante no futuro** (OTLP forjado com `timeUnixNano` de 2099, bloqueio de `desfazer` de 1 ano): o registro é descartado, o bloqueio acima de 8 dias é inválido, nada trava para sempre. Testes nas Tasks 2 e 4.
5. **`/claude-hadouken:aprender aprovar s1` vindo de uma sessão `claude -p` filha** (`CLAUDE_CODE_ENTRYPOINT=sdk-cli`): recusado sem gravar nada, como o `liberar`. Teste na Task 11.

## Modelos por tarefa (ordem do Sr. Garioli: gastar bem)

- Implementador: `opus-high` por padrão; **`opus-xhigh`** nas Tasks 6 (min da guarda), 7 (`baixar.js`), 8 (`coletor.js`), 9 (`env` do `settings.json`) e 10 (orquestração do `ligar`, que baixa, extrai e grava o `settings.json`).
- Task 1 e o roteiro manual da Task 14 são passos do controlador com o Sr. Garioli (A1 e A3 gastam alguns centavos de Haiku; o controlador pede a autorização antes).
- Revisor por tarefa: Sonnet, só leitura do diff; o controlador roda `node --test` uma vez por tarefa.
- Task 14 (documentação): `opus-high`.
- **Task 15 (portão de segurança da v0.4.0):** um único `fable-xhigh` sobre o branch `v0.4.0-guarda` inteiro (guarda partes 1 e 2 e aprendizado) contra `8d1bff3`. Achados: correção por `opus-high`, re-revisão escopada por Sonnet. Sem tag, sem push.

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `docs/superpowers/specs/2026-09-30-aprendizado-design.md` (mod.) | emenda com os fatos de A1–A3 | 1 |
| `src/aprendizado/otlp.js` | leitor incremental do `telemetria.jsonl` (2ª barreira) | 2 |
| `src/aprendizado/config-coletor.js` | `config.yaml` do Collector (1ª barreira) | 2 |
| `src/aprendizado/agregar.js` | agregados por modelo·effort, hora e origem; janelas; perfil | 3 |
| `src/aprendizado/arquivos.js` | nomes e tetos dos arquivos; `ligadoExiste` (leve, para os caminhos quentes) | 4 |
| `src/aprendizado/registro.js` | leitura e gravação de `aprendizado.json`, `ajustes.json`, `sugestoes.json`, cursor, eventos, `ligado.json`, trava; leitores do painel e da previsão | 4 |
| `src/aprendizado/ajustar.js` | ajustes, apertos e sugestões (puro, relógio por parâmetro); `desfazer`, `aprovar`, `recusar` | 5 |
| `src/guarda/aperto.js`, `src/guarda/config.js` (mod.) | `min(config.json, aperto)` | 6 |
| `src/aprendizado/baixar.js` | download fixado e conferido | 7 |
| `src/aprendizado/coletor.js` | subir, conferir, parar, extrair; integridade; órfão | 8 |
| `src/configuracao.js` (mod.), `src/aprendizado/settings-env.js` | `env` do `settings.json` | 9 |
| `src/aprendizado/ligar.js` | prévia, `ligar`, `desligar`, apagar dados | 10 |
| `src/aprendizado/mensagens.js`, `src/aprendizado/comando.js`, `src/hooks/aprender.js`, `skills/aprender/SKILL.md`, `hooks/hooks.json` (mod.) | o comando `/claude-hadouken:aprender` | 11 |
| `src/aprendizado/passo.js`, `src/hooks/session-start.js` (mod.), `src/hooks/session-end.js` (mod.), `bench/aprendizado.mjs` | o passo, a vida do Collector nas sessões e o bench de §7 | 12 |
| `src/uso/painel.js` (mod.), `src/previsao.js` (mod.), `src/hooks/prompt-submit.js` (mod.) | consumidores dos ajustes | 13 |
| `SECURITY.md`, `README.md`, `README.en.md` (mod.) | documentação, ameaças de §10, roteiro manual | 14 |
| (nenhum arquivo novo; correções onde o revisor apontar) | portão de segurança `fable-xhigh` do branch inteiro | 15 |

---

### Task 1: Spikes A2, A1 e A3 (§9) e a emenda da spec

**Tipo:** passos do controlador, com o Sr. Garioli. **Nenhum código do repo muda aqui**; os scripts vão para uma pasta temporária fora do repo. A2 vem primeiro porque A1 e A3 usam o binário que ele baixa.

**Files:**
- Create (fora do repo): `$S\spike-a2-fixado.mjs`, `$S\a2\config.yaml`, `$S\a1\config.yaml`, `$S\spike-a1.mjs`, `$S\spike-nomes.mjs`, `$S\spike-a3.mjs`, com `$S = "$env:TEMP\hadouken-spike-aprendizado"`
- Modify: `docs/superpowers/specs/2026-09-30-aprendizado-design.md` (emenda no fim)

**Interfaces:**
- Produz (na emenda, usados pelas Tasks 2, 7, 8 e 9): o bloco `VERSAO_COLETOR`/`FIXADO`; `MEMBRO_TAR`; `HOSTS` de download; `TAMANHO_MAX` e `PRAZO_MS`; `NOME_BINARIO`; `PORTA_OCUPADA`; os nomes de `NOMES` e `ORIGENS_PRINCIPAIS` em `otlp.js`; as chaves `OTEL_METRICS_INCLUDE_*` e os intervalos de `CHAVES_LIGAR`; `A3_ATRAPALHA`.

**Portões:** RAM parado do Collector > 120 MiB (A2) → **pare** e leve os números ao Sr. Garioli antes de qualquer outra tarefa. `validate` falhando com a configuração de §5.1 (A2) → pare e corrija a Task 2 antes dela ser implementada. A3 "atrapalha" → as Tasks 8 e 10 usam `A3_ATRAPALHA = true` (sem outra mudança de código).

- [ ] **Step 1: Pasta do spike e o gerador do bloco fixado (A2)**

No PowerShell:

```powershell
$S = "$env:TEMP\hadouken-spike-aprendizado"; New-Item -ItemType Directory -Force "$S\a1", "$S\a2" | Out-Null; $S
```

Crie `$S\spike-a2-fixado.mjs` com o Write:

```js
// Uso: node spike-a2-fixado.mjs [versao]
// Lê o arquivo de checksums do release oficial do otelcol-contrib e imprime o
// bloco VERSAO_COLETOR/FIXADO de src/aprendizado/baixar.js, pronto para colar.
const repo = 'open-telemetry/opentelemetry-collector-releases';
const cabecalho = { headers: { 'user-agent': 'hadouken-spike' } };
let versao = process.argv[2];
if (!versao) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, cabecalho);
  const tag = (await r.json()).tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
    console.error(`release "latest" é ${tag}; passe a versão do otelcol-contrib como argumento (ex.: 0.137.0)`);
    process.exit(1);
  }
  versao = tag.slice(1);
}
const nomeSomas = 'opentelemetry-collector-releases_otelcol-contrib_checksums.txt';
const r = await fetch(`https://github.com/${repo}/releases/download/v${versao}/${nomeSomas}`, cabecalho);
if (!r.ok) {
  console.error(`sem ${nomeSomas} em v${versao}: HTTP ${r.status}. Confira o nome do arquivo de checksums na página do release.`);
  process.exit(1);
}
const linhas = (await r.text()).split('\n').map((l) => l.trim());
const alvos = {
  'win32-x64': 'windows_amd64', 'linux-x64': 'linux_amd64', 'linux-arm64': 'linux_arm64',
  'darwin-x64': 'darwin_amd64', 'darwin-arm64': 'darwin_arm64',
};
console.log(`export const VERSAO_COLETOR = '${versao}';`);
console.log('export const FIXADO = Object.freeze({');
for (const [chave, sufixo] of Object.entries(alvos)) {
  const arquivo = `otelcol-contrib_${versao}_${sufixo}.tar.gz`;
  const l = linhas.find((x) => x.endsWith(`  ${arquivo}`) || x.endsWith(` *${arquivo}`));
  if (!l || !/^[0-9a-f]{64}\s/.test(l)) {
    console.error(`faltou ${arquivo} no arquivo de checksums`);
    process.exit(1);
  }
  console.log(`  '${chave}': Object.freeze({ arquivo: '${arquivo}', sha256: '${l.slice(0, 64)}' }),`);
}
console.log('});');
```

Run: `node "$S\spike-a2-fixado.mjs" | Tee-Object "$S\fixado.js"`
Expected: 7 linhas de JS, com 5 SHA-256 de 64 hex. **Esse bloco é colado sem edição em `baixar.js` (Task 7).** Anote a versão em `$v`: `$v = (Select-String -Path "$S\fixado.js" -Pattern "VERSAO_COLETOR = '(.+)'").Matches[0].Groups[1].Value; $v`

- [ ] **Step 2: A2 — download, hash, tamanho, membro do tar e extração no Windows**

```powershell
$arq = "otelcol-contrib_${v}_windows_amd64.tar.gz"
$t = Measure-Command { Invoke-WebRequest -UseBasicParsing "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$v/$arq" -OutFile "$S\a2\$arq" }; "download: $([int]$t.TotalSeconds) s"
"tamanho: $([math]::Round((Get-Item "$S\a2\$arq").Length / 1MB, 1)) MiB"
(Get-FileHash "$S\a2\$arq" -Algorithm SHA256).Hash.ToLower()
& "$env:SystemRoot\System32\tar.exe" -tzf "$S\a2\$arq"
& "$env:SystemRoot\System32\tar.exe" -xzf "$S\a2\$arq" -C "$S\a2" otelcol-contrib.exe
"binário: $([math]::Round((Get-Item "$S\a2\otelcol-contrib.exe").Length / 1MB, 1)) MiB"
```

Expected: o hash impresso é igual ao `sha256` de `'win32-x64'` em `$S\fixado.js`; o `-tzf` lista o membro `otelcol-contrib.exe` na raiz (anote o nome exato: é o `MEMBRO_TAR`). Anote o tempo e o tamanho: `TAMANHO_MAX` = o maior tamanho entre as 5 plataformas × 2 arredondado para cima em MiB (padrão do plano: 200 MiB); `PRAZO_MS` = 3 × o tempo medido, no mínimo 300 000 (padrão: 300 000). Se o download passou por outro host além de `github.com`, `objects.githubusercontent.com` e `release-assets.githubusercontent.com`, anote-o para `HOSTS` (confira com `(Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -ErrorAction SilentlyContinue "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$v/$arq").Headers.Location`).

- [ ] **Step 3: A2 — `validate` com a configuração de §5.1, RAM, subida, rotação e mensagem de porta ocupada**

Crie `$S\a2\config.yaml` com o Write. É o texto que `configColetor` (Task 2) gera, com a porta e o caminho do spike (troque `<S>` pelo valor de `$S` com barras `/`, e `max_megabytes` fica 1 só aqui, para ver a rotação sem gerar 5 MB):

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:47318
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 64
    spike_limit_mib: 16
  resource/hadouken:
    attributes:
      - key: user.email
        action: delete
      - key: user.account_uuid
        action: delete
      - key: user.account_id
        action: delete
      - key: user.id
        action: delete
      - key: organization.id
        action: delete
      - key: workspace.host_paths
        action: delete
      - pattern: ^vcs\..*
        action: delete
  attributes/hadouken:
    actions:
      - key: user.email
        action: delete
      - key: user.account_uuid
        action: delete
      - key: user.account_id
        action: delete
      - key: user.id
        action: delete
      - key: organization.id
        action: delete
      - key: workspace.host_paths
        action: delete
      - pattern: ^vcs\..*
        action: delete
  batch: {}
exporters:
  file:
    path: '<S>/a2/otel/telemetria.jsonl'
    format: json
    rotation:
      max_megabytes: 1
      max_days: 30
      max_backups: 3
service:
  telemetry:
    metrics:
      level: none
    logs:
      level: error
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource/hadouken, attributes/hadouken, batch]
      exporters: [file]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource/hadouken, attributes/hadouken, batch]
      exporters: [file]
```

```powershell
New-Item -ItemType Directory -Force "$S\a2\otel" | Out-Null
& "$S\a2\otelcol-contrib.exe" validate --config "$S\a2\config.yaml"; "validate: $LASTEXITCODE"
$env:GOMEMLIMIT = '96MiB'
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process "$S\a2\otelcol-contrib.exe" -ArgumentList '--config', "$S\a2\config.yaml" -WindowStyle Hidden -PassThru -RedirectStandardError "$S\a2\err1.txt"
$corpo = '{"resourceLogs":[{"resource":{"attributes":[{"key":"user.email","value":{"stringValue":"segredo@x"}},{"key":"vcs.repository.url.full","value":{"stringValue":"segredo-repo"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"1759000000000000000","body":{"stringValue":"claude_code.api_request"},"attributes":[{"key":"event.name","value":{"stringValue":"api_request"}},{"key":"user.account_uuid","value":{"stringValue":"segredo-uuid"}},{"key":"model","value":{"stringValue":"claude-haiku"}}]}]}]}]}'
while ($true) { try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47318/v1/logs -ContentType 'application/json' -Body $corpo | Out-Null; break } catch { Start-Sleep -Milliseconds 100 } }
"subida: $($sw.ElapsedMilliseconds) ms"
Start-Sleep 15; "RAM parado: $([int]((Get-Process -Id $p.Id).WorkingSet64 / 1MB)) MiB"
1..3000 | ForEach-Object { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47318/v1/logs -ContentType 'application/json' -Body $corpo | Out-Null }
"RAM em uso: $([int]((Get-Process -Id $p.Id).PeakWorkingSet64 / 1MB)) MiB (pico)"
Start-Sleep 3; Get-ChildItem "$S\a2\otel" | Select-Object Name, Length
Select-String -Path "$S\a2\otel\*.jsonl" -Pattern 'segredo|user\.email|account_uuid|vcs\.' | Measure-Object | Select-Object Count
& "$env:SystemRoot\System32\tasklist.exe" /FI "PID eq $($p.Id)" /FO CSV /NH
$p2 = Start-Process "$S\a2\otelcol-contrib.exe" -ArgumentList '--config', "$S\a2\config.yaml" -WindowStyle Hidden -PassThru -RedirectStandardError "$S\a2\err2.txt" -Wait
Get-Content "$S\a2\err2.txt" | Select-String -Pattern 'bind|address|socket' | Select-Object -First 3
& "$env:SystemRoot\System32\taskkill.exe" /pid $p.Id /t /f
```

Expected e o que anotar:
- `validate: 0` (senão: portão, a configuração de §5.1 precisa de ajuste antes da Task 2).
- RAM parado ≤ 120 MiB (senão: **portão**, pare e leve ao Sr. Garioli). Anote parado, pico e subida.
- A pasta `otel` tem `telemetria.jsonl` e pelo menos um `telemetria-<data>.jsonl` rotacionado (confirma a rotação na versão fixada); anote o formato do nome rotacionado (o `ROTACIONADO` de `otlp.js` aceita `telemetria-[0-9A-Za-z._:-]{1,80}.jsonl`; se o nome não casar, anote o padrão real).
- `Count` = 0 (o filtro tirou `user.email`, `user.account_uuid` e `vcs.*`).
- O `tasklist` mostra `"otelcol-contrib.exe","<pid>",…` (o `NOME_BINARIO.win32`).
- `err2.txt` tem a mensagem de porta ocupada; anote a frase exata (padrão do plano: `/address already in use|only one usage of each socket address/i`).

- [ ] **Step 4: A1 — nomes reais numa sessão (gasta centavos de Haiku; peça a autorização do Sr. Garioli antes)**

Crie `$S\a1\config.yaml` (sem filtro, para ver todos os nomes; o arquivo bruto fica só na pasta temporária e é apagado no Step 7):

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:47318
exporters:
  file:
    path: '<S>/a1/bruto.jsonl'
    format: json
service:
  telemetry:
    metrics:
      level: none
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file]
    logs:
      receivers: [otlp]
      exporters: [file]
```

Crie `$S\spike-a1.mjs`:

```js
// Uso: node spike-a1.mjs <caminho do claude.exe> <on|morto|off> [padrao]
// Roda um `claude -p` curto (Haiku) com a telemetria apontada para
// 127.0.0.1:47318, por execFile (nunca pelo Git Bash). 'padrao' não passa os
// intervalos de exportação (para ver se uma sessão curta perde métricas).
import { execFile } from 'node:child_process';
const [exe, modo = 'on', intervalos = 'curtos'] = process.argv.slice(2);
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('OTEL_') || k === 'CLAUDE_CODE_ENABLE_TELEMETRY') delete env[k];
if (modo !== 'off') {
  Object.assign(env, {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:47318',
  });
  if (intervalos !== 'padrao') Object.assign(env, { OTEL_METRIC_EXPORT_INTERVAL: '10000', OTEL_LOGS_EXPORT_INTERVAL: '5000' });
}
const prompt = modo === 'on'
  ? 'Use a ferramenta Agent com o subagente general-purpose para responder apenas "ok". Depois responda "fim".'
  : 'Responda apenas "ok".';
const t0 = Date.now();
execFile(exe, ['-p', prompt, '--model', 'haiku', '--output-format', 'json'], { env, windowsHide: true, timeout: 180_000, maxBuffer: 1 << 20, encoding: 'utf8' }, (e, out, err) => {
  let custo = null;
  try { custo = JSON.parse(out).total_cost_usd; } catch { /* sem json */ }
  console.log(JSON.stringify({ modo, ms: Date.now() - t0, erro: e?.code ?? null, custo, stderr: String(err).slice(0, 400) }));
});
```

Crie `$S\spike-nomes.mjs` (imprime só nomes e os valores de quatro atributos que não são sensíveis):

```js
// Uso: node spike-nomes.mjs <arquivo.jsonl>
import fs from 'node:fs';
const metricas = {}; const eventos = new Set(); const recurso = new Set(); const atributos = new Set();
const valores = { query_source: new Set(), 'agent.name': new Set(), effort: new Set(), 'event.name': new Set() };
for (const linha of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!linha.trim()) continue;
  const o = JSON.parse(linha);
  for (const r of [...(o.resourceLogs ?? []), ...(o.resourceMetrics ?? [])]) {
    for (const a of r.resource?.attributes ?? []) recurso.add(a.key);
    for (const s of [...(r.scopeLogs ?? []), ...(r.scopeMetrics ?? [])]) {
      for (const m of s.metrics ?? []) {
        for (const tipo of ['sum', 'gauge', 'histogram']) {
          if (!m[tipo]) continue;
          metricas[m.name] = `${tipo} temporality=${m[tipo].aggregationTemporality ?? '-'}`;
          for (const dp of m[tipo].dataPoints ?? []) for (const a of dp.attributes ?? []) atributos.add(`${m.name} :: ${a.key}`);
        }
      }
      for (const l of s.logRecords ?? []) {
        eventos.add(l.body?.stringValue);
        for (const a of l.attributes ?? []) {
          atributos.add(`log :: ${a.key} (${Object.keys(a.value ?? {}).join(',')})`);
          if (valores[a.key]) valores[a.key].add(JSON.stringify(a.value));
        }
      }
    }
  }
}
console.log(JSON.stringify({ metricas, eventos: [...eventos], recurso: [...recurso], atributos: [...atributos].sort(), valores: Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, [...v]])) }, null, 2));
```

```powershell
$claude = (Get-Command claude).Source; $claude
$c = Start-Process "$S\a2\otelcol-contrib.exe" -ArgumentList '--config', "$S\a1\config.yaml" -WindowStyle Hidden -PassThru
Start-Sleep 2
node "$S\spike-a1.mjs" $claude on
Start-Sleep 15
node "$S\spike-nomes.mjs" "$S\a1\bruto.jsonl" | Tee-Object "$S\a1\nomes-curtos.json"
Remove-Item "$S\a1\bruto.jsonl"
node "$S\spike-a1.mjs" $claude on padrao
Start-Sleep 15
node "$S\spike-nomes.mjs" "$S\a1\bruto.jsonl" | Tee-Object "$S\a1\nomes-padrao.json"
& "$env:SystemRoot\System32\taskkill.exe" /pid $c.Id /t /f
```

Anote na emenda:
- o nome exato de cada evento (`api_request`, `api_error`, `tool_result`, como aparecem em `event.name` e no `body`), a métrica de tempo ativo (padrão `claude_code.active_time.total`) e a temporalidade dela;
- os atributos de `api_request` (padrões: `model`, `cost_usd`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `duration_ms`, `ttft_ms`, `effort`), de `tool_result` (`success`, e se traz `model`) e de `api_error`; e se os números vêm como `stringValue` ou `intValue`/`doubleValue`;
- os valores de `query_source` da sessão principal e do subagente, e o `agent.name` do subagente (padrão do plano: principal = `repl_main_thread` ou `main`; subagente = `agent.name` presente);
- se `effort` apareceu; se não apareceu no `-p`, o Sr. Garioli abre **uma** sessão interativa no PowerShell com as mesmas variáveis (`$env:CLAUDE_CODE_ENABLE_TELEMETRY='1'` etc.), roda `/effort high`, manda "oi" e sai; repita o `spike-nomes.mjs`;
- as chaves do recurso (confirma quais de §5.1 aparecem) e, pela página oficial de monitoramento do Claude Code, as `OTEL_METRICS_INCLUDE_*` que tiram a conta das métricas (padrão do plano: `OTEL_METRICS_INCLUDE_ACCOUNT_UUID=false`; `OTEL_METRICS_INCLUDE_SESSION_ID` fica no padrão);
- se a execução com intervalos padrão (`nomes-padrao.json`) perdeu a métrica de tempo ativo: se perdeu, os intervalos curtos entram no `env` (padrão do plano: `OTEL_METRIC_EXPORT_INTERVAL=10000`, `OTEL_LOGS_EXPORT_INTERVAL=5000`); anote também se `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` é preciso para a métrica vir em delta.

- [ ] **Step 5: A3 — endpoint fora do ar (gasta centavos de Haiku)**

Crie `$S\spike-a3.mjs`:

```js
// Uso: node spike-a3.mjs <claude.exe>. Três rodadas com a telemetria
// apontada para uma porta sem ninguém e três sem telemetria; compara o tempo
// e o stderr. Por execFile, nunca pelo Git Bash.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const rodar = promisify(execFile);
const exe = process.argv[2];
async function uma(modo) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('OTEL_') || k === 'CLAUDE_CODE_ENABLE_TELEMETRY') delete env[k];
  if (modo === 'morto') Object.assign(env, { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:47318', OTEL_METRIC_EXPORT_INTERVAL: '10000', OTEL_LOGS_EXPORT_INTERVAL: '5000' });
  const t0 = Date.now();
  let stderr = '';
  try { stderr = (await rodar(exe, ['-p', 'Responda apenas "ok".', '--model', 'haiku', '--output-format', 'json'], { env, windowsHide: true, timeout: 180_000, encoding: 'utf8' })).stderr; } catch (e) { stderr = `ERRO ${e.code} ${String(e.stderr).slice(0, 200)}`; }
  return { modo, ms: Date.now() - t0, stderr: stderr.slice(0, 300) };
}
for (const modo of ['off', 'morto', 'off', 'morto', 'off', 'morto']) console.log(JSON.stringify(await uma(modo)));
```

Run (com nenhum Collector vivo): `node "$S\spike-a3.mjs" (Get-Command claude).Source`

Critério: **atrapalha** se a mediana de `morto` passar a de `off` em mais de 1 000 ms, ou se algum `stderr` de `morto` tiver erro de exportação. Peça também ao Sr. Garioli uma sessão interativa curta com as variáveis de telemetria e nada escutando na 47318: aparece erro no terminal? há atraso visível? Se qualquer um disser "atrapalha", `A3_ATRAPALHA = true`.

- [ ] **Step 6: Escrever a emenda no fim da spec**

Acrescente com o Edit, no fim de `docs/superpowers/specs/2026-09-30-aprendizado-design.md`, trocando cada `…` pelo valor medido:

```markdown
## Emenda 2026-10-…: spikes A1–A3 (Claude Code …, Windows)

| Fato | Valor medido | Onde entra |
|---|---|---|
| Versão fixada e SHA-256 das 5 plataformas | bloco de `spike-a2-fixado.mjs` (colado abaixo) | `baixar.js`: `VERSAO_COLETOR`, `FIXADO` |
| Hosts do download (com redirecionamentos) | … | `baixar.js`: `HOSTS` |
| Download win-amd64 | … MiB em … s | `baixar.js`: `TAMANHO_MAX`, `PRAZO_MS` |
| Membro do binário no `.tar.gz` | … | `coletor.js`: `MEMBRO_TAR` |
| Binário extraído | … MiB | README |
| RAM parado / pico em uso / subida | … MiB / … MiB / … ms | portão de 120 MiB; README |
| `validate` com §5.1 (rotação, `pattern`, `level: none`) | ok | `config-coletor.js` |
| Nome do arquivo rotacionado | … | `otlp.js`: `ROTACIONADO` |
| Nome do processo (`tasklist`) | … | `coletor.js`: `NOME_BINARIO` |
| Mensagem de porta ocupada | … | `coletor.js`: `PORTA_OCUPADA` |
| Eventos e métrica de tempo ativo | … | `otlp.js`: `NOMES` |
| Atributos de `api_request`, `api_error`, `tool_result` | … | `otlp.js`: `NOMES` |
| `query_source` da principal / do subagente; `agent.name` | … | `otlp.js`: `ORIGENS_PRINCIPAIS` |
| `effort` nos eventos | … | `otlp.js` |
| `OTEL_METRICS_INCLUDE_*` que tiram a conta | … | `settings-env.js`: `CHAVES_LIGAR` |
| Intervalos e temporalidade | … | `settings-env.js`: `CHAVES_LIGAR` |
| A3: endpoint fora do ar | atrapalha? … (off … ms, morto … ms; stderr …) | `coletor.js`: `A3_ATRAPALHA` |

Bloco fixado:

(cole aqui o conteúdo de `$S\fixado.js`, num bloco de código js)
```

- [ ] **Step 7: Limpar e commitar a emenda**

```powershell
Remove-Item -Recurse -Force "$S\a1"
git add -- docs/superpowers/specs/2026-09-30-aprendizado-design.md
git commit -m @'
docs: aprendizado spikes A1-A3 amendment (collector pin, OTel names, endpoint-down behavior)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- docs/superpowers/specs/2026-09-30-aprendizado-design.md
```

Guarde `$S\a2\otelcol-contrib.exe` e `$S\fixado.js` até o fim da Task 14 (roteiro manual).

---

### Task 2: As duas barreiras de privacidade (`otlp.js`, `config-coletor.js`) e as fronteiras de rede e processo (§3.1, §5.1, §5.3, §8 "Filtro")

**Files:**
- Create: `src/aprendizado/otlp.js`, `src/aprendizado/config-coletor.js`
- Test: `test/aprendizado-otlp.test.js`, `test/aprendizado-fronteiras.test.js`

**Interfaces:**
- Consome: `MODELO_VALIDO` (`src/guarda/registros.js`), `effortValido` (`src/util.js`), `numeroFinito`, `fechar` (`src/base.js`), `caminhoAceito` (`src/configuracao.js`); os nomes da Emenda A1/A2.
- Produz:
  - `lerNovos({ pasta: string, cursor: { ino: string, pos: number } | null, agoraMs: number, maxBytes?: number }) → { registros: Registro[], cursor: { ino, pos } | null, corrompido: boolean }`
  - `registrosDaLinha(texto: string, agoraMs: number) → Registro[] | null` (null = a linha não é JSON de objeto)
  - `Registro` é um de: `{ t: 'req', em, modelo, effort, origem, custo, entrada, saida, cacheLeitura, cacheEscrita, duracaoMs: number|null, ttftMs: number|null }`, `{ t: 'erro', em, modelo, effort, origem }`, `{ t: 'ferramenta', em, modelo, effort, origem, ok: boolean }`, `{ t: 'ativo', em, segundos }`. `em` em ms; `effort` é um de `EFFORTS_VALIDOS` ou `'-'`; `origem` é `'principal'`, `'outro'`, `'sub'` ou `'sub:<nome>'`.
  - constantes `ARQ_TELEMETRIA`, `ROTACIONADO`, `LINHA_MAX_BYTES`, `LEITURA_MAX_BYTES`, `NOMES`, `ORIGENS_PRINCIPAIS`, `AGENTE_VALIDO`
  - `configColetor({ arquivoTelemetria: string }) → { ok: true, texto: string } | { ok: false, motivo: 'caminho-inseguro' }`; constantes `PORTA` (47318), `HOST` ('127.0.0.1'), `SENSIVEIS`, `PADRAO_VCS`, `ROTACAO`, `MEMORIA_MIB`

- [ ] **Step 1: Escrever o teste do leitor**

Crie `test/aprendizado-otlp.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerNovos, registrosDaLinha, ARQ_TELEMETRIA } from '../src/aprendizado/otlp.js';

// Segunda barreira (spec aprendizado §5.3 e §8 "Filtro"): o leitor monta cada
// registro do zero, então nenhum campo de §5.1 sai daqui, nem quando chega
// no arquivo. Todo arquivo fica numa pasta temporária.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprendizado ç '));
  dirs.push(d);
  return d;
}

const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const D = (v) => ({ doubleValue: v });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
const nano = (ms) => `${BigInt(ms) * 1_000_000n}`;
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const SENSIVEIS = {
  'user.email': S('segredo-email@x.com'), 'user.account_uuid': S('segredo-uuid'), 'user.account_id': S('segredo-conta'),
  'user.id': S('segredo-id'), 'organization.id': S('segredo-org'), 'workspace.host_paths': S('segredo-C:/Users/Fulano/proj'),
  'vcs.repository.url.full': S('segredo-repo'), 'vcs.ref.head.name': S('segredo-branch'),
};
const EXTRAS = { 'session.id': S('segredo-sessao'), prompt: S('segredo-prompt'), tool_input: S('segredo-args') };

function linhaLog(ms, evento, extra) {
  return JSON.stringify({
    resourceLogs: [{
      resource: { attributes: attrs(SENSIVEIS) },
      scopeLogs: [{ logRecords: [{ timeUnixNano: nano(ms), body: S(`claude_code.${evento}`), attributes: attrs({ 'event.name': S(evento), ...SENSIVEIS, ...EXTRAS, ...extra }) }] }],
    }],
  });
}
const PEDIDO = {
  model: S('claude-sonnet-5-5'), effort: S('high'), query_source: S('repl_main_thread'), cost_usd: D(0.012),
  input_tokens: I(1200), output_tokens: I(300), cache_read_tokens: I(5000), cache_creation_tokens: I(100), duration_ms: I(2500), ttft_ms: I(800),
};
const linhaPedido = (ms) => linhaLog(ms, 'api_request', PEDIDO);
function linhaAtivo(ms, segundos) {
  return JSON.stringify({
    resourceMetrics: [{
      resource: { attributes: attrs(SENSIVEIS) },
      scopeMetrics: [{ metrics: [{ name: 'claude_code.active_time.total', sum: { aggregationTemporality: 1, dataPoints: [{ timeUnixNano: nano(ms), asDouble: segundos, attributes: attrs(SENSIVEIS) }] } }] }],
    }],
  });
}
const esperadoPedido = (ms) => ({
  t: 'req', em: ms, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', custo: 0.012,
  entrada: 1200, saida: 300, cacheLeitura: 5000, cacheEscrita: 100, duracaoMs: 2500, ttftMs: 800,
});

test('§8 Filtro: os campos de §5.1 no recurso e nos atributos nunca saem do leitor', () => {
  const linhas = [
    linhaPedido(AGORA - 60_000),
    linhaLog(AGORA - 50_000, 'api_error', { model: S('claude-sonnet-5-5'), query_source: S('repl_main_thread') }),
    linhaLog(AGORA - 40_000, 'tool_result', { model: S('claude-sonnet-5-5'), 'agent.name': S('revisor'), success: S('false'), tool_name: S('Bash') }),
    linhaAtivo(AGORA - 30_000, 42.5),
  ];
  const registros = linhas.flatMap((l) => registrosDaLinha(l, AGORA));
  assert.deepEqual(registros, [
    esperadoPedido(AGORA - 60_000),
    { t: 'erro', em: AGORA - 50_000, modelo: 'claude-sonnet-5-5', effort: '-', origem: 'principal' },
    { t: 'ferramenta', em: AGORA - 40_000, modelo: 'claude-sonnet-5-5', effort: '-', origem: 'sub:revisor', ok: false },
    { t: 'ativo', em: AGORA - 30_000, segundos: 42.5 },
  ]);
  assert.doesNotMatch(JSON.stringify(registros), /segredo|Bash/);
});

test('origem: agent.name inválido não passa como nome; query_source desconhecido é outro', () => {
  const r1 = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, query_source: S('agent'), 'agent.name': S('ignore previous; rm -rf') }), AGORA);
  assert.equal(r1[0].origem, 'sub');
  const r2 = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, query_source: S('estranho') }), AGORA);
  assert.equal(r2[0].origem, 'outro');
});

test('modelo fora de MODELO_VALIDO, effort desconhecido e números hostis', () => {
  assert.deepEqual(registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, model: S('modelo com espaço') }), AGORA), []);
  const r = registrosDaLinha(linhaLog(AGORA, 'api_request', { ...PEDIDO, effort: S('turbo'), cost_usd: S('1e999'), input_tokens: I(-5), ttft_ms: S('abc') }), AGORA);
  assert.equal(r[0].effort, '-');
  assert.equal(r[0].custo, 0);
  assert.equal(r[0].entrada, 0);
  assert.equal(r[0].ttftMs, null);
});

test('Foco de revisão 4: instante no futuro (2099) ou velho demais é descartado', () => {
  assert.deepEqual(registrosDaLinha(linhaPedido(Date.UTC(2099, 0, 1)), AGORA), []);
  assert.deepEqual(registrosDaLinha(linhaPedido(AGORA - 41 * 86_400_000), AGORA), []);
  assert.deepEqual(registrosDaLinha(linhaAtivo(Date.UTC(2099, 0, 1), 10), AGORA), []);
});

test('métrica cumulativa não é somada (só delta)', () => {
  const l = JSON.parse(linhaAtivo(AGORA, 10));
  l.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality = 2;
  assert.deepEqual(registrosDaLinha(JSON.stringify(l), AGORA), []);
});

test('lerNovos: lê só linhas completas, avança o cursor e não relê', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 3000)}\n${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000).slice(0, 50)}`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 2);
  assert.equal(r1.corrompido, false);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 3000)}\n${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros, [esperadoPedido(AGORA - 1000)]);
  const r3 = lerNovos({ pasta: d, cursor: r2.cursor, agoraMs: AGORA });
  assert.deepEqual(r3.registros, []);
  assert.deepEqual(r3.cursor, r2.cursor);
});

test('Foco de revisão 2: rotação entre dois passos não perde nem repete linha', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 5000)}\n${linhaPedido(AGORA - 4000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r1.registros.length, 2);
  fs.appendFileSync(arq, `${linhaPedido(AGORA - 3000)}\n`);
  fs.renameSync(arq, path.join(d, 'telemetria-2026-10-08T14-59-00.000.jsonl'));
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 3000, AGORA - 2000]);
  const r3 = lerNovos({ pasta: d, cursor: r2.cursor, agoraMs: AGORA });
  assert.deepEqual(r3.registros, []);
});

test('arquivo truncado (menor que o cursor) é lido do começo', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 5000)}\n${linhaPedido(AGORA - 4000)}\n`);
  const r1 = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 1000)}\n`);
  const r2 = lerNovos({ pasta: d, cursor: r1.cursor, agoraMs: AGORA });
  assert.deepEqual(r2.registros.map((x) => x.em), [AGORA - 1000]);
});

test('§6: linha corrompida e linha acima de 1 MiB são ignoradas, o resto é lido e o cursor avança', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `{quebrado\n${'x'.repeat(1024 * 1024 + 10)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros.map((x) => x.em), [AGORA - 1000]);
  assert.equal(r.cursor.pos, fs.statSync(arq).size);
});

test('§6: bytes novos acima do teto: nada é lido e o cursor pula para o fim', () => {
  const d = novoDir();
  const arq = path.join(d, ARQ_TELEMETRIA);
  fs.writeFileSync(arq, `${linhaPedido(AGORA - 2000)}\n${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA, maxBytes: 100 });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros, []);
  assert.equal(r.cursor.pos, fs.statSync(arq).size);
});

test('arquivo ausente: nada lido, cursor igual; link no lugar: corrompido, nada seguido', (t) => {
  const d = novoDir();
  assert.deepEqual(lerNovos({ pasta: d, cursor: null, agoraMs: AGORA }), { registros: [], cursor: null, corrompido: false });
  const alvo = path.join(d, 'alvo.jsonl');
  fs.writeFileSync(alvo, `${linhaPedido(AGORA - 1000)}\n`);
  try {
    fs.symlinkSync(alvo, path.join(d, ARQ_TELEMETRIA));
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link neste Windows'); return; }
    throw e;
  }
  const r = lerNovos({ pasta: d, cursor: null, agoraMs: AGORA });
  assert.equal(r.corrompido, true);
  assert.deepEqual(r.registros, []);
});

test('cursor forjado (posição negativa, ino que não é número) é ignorado', () => {
  const d = novoDir();
  fs.writeFileSync(path.join(d, ARQ_TELEMETRIA), `${linhaPedido(AGORA - 1000)}\n`);
  const r = lerNovos({ pasta: d, cursor: { ino: '__proto__', pos: -5 }, agoraMs: AGORA });
  assert.equal(r.registros.length, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-otlp.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/otlp.js`.

- [ ] **Step 3: Escrever `src/aprendizado/otlp.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fechar, numeroFinito } from '../base.js';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { effortValido } from '../util.js';

// Leitor do telemetria.jsonl (spec aprendizado §3.1 e §5.3, a segunda
// barreira). Cada linha é um lote OTLP JSON do exportador `file` do
// Collector. Nada do lote é copiado: cada registro é montado do zero, só com
// os campos de §4.1, e nenhum atributo do recurso é lido. Um campo sensível
// que escapou do filtro do Collector (§5.1) morre aqui, junto com session.id
// (R11), prompt e argumentos de ferramenta.
// Sem rede e sem processo filho (test/aprendizado-fronteiras.test.js).
// Nunca lança.

export const ARQ_TELEMETRIA = 'telemetria.jsonl';
// Nome do arquivo que a rotação do exportador `file` deixa ao lado (Emenda
// A2). Só estes são procurados quando o arquivo atual mudou de inode.
export const ROTACIONADO = /^telemetria-[0-9A-Za-z._:-]{1,80}\.jsonl$/;
export const LINHA_MAX_BYTES = 1024 * 1024;
export const LEITURA_MAX_BYTES = 20 * 1024 * 1024;
const ROTACIONADOS_MAX = 16;
const PEDACO = 1024 * 1024;
const LISTA_MAX = 4096;
const ATRIBUTOS_MAX = 256;
const TEXTO_MAX = 200;
const PASSADO_MAX_MS = 40 * 86_400_000;
const FUTURO_MS = 5 * 60_000;
const TETO = Object.freeze({ custo: 1000, tokens: 1e9, ms: 3_600_000, ativoS: 86_400 });

// Nomes do OTel do Claude Code (Emenda A1). Só estes atributos são lidos.
export const NOMES = Object.freeze({
  nomeEvento: 'event.name',
  eventoPedido: 'api_request',
  eventoErro: 'api_error',
  eventoFerramenta: 'tool_result',
  metricaAtivo: 'claude_code.active_time.total',
  modelo: 'model',
  effort: 'effort',
  origem: 'query_source',
  agente: 'agent.name',
  custo: 'cost_usd',
  entrada: 'input_tokens',
  saida: 'output_tokens',
  cacheLeitura: 'cache_read_tokens',
  cacheEscrita: 'cache_creation_tokens',
  duracao: 'duration_ms',
  ttft: 'ttft_ms',
  sucesso: 'success',
});
// query_source da sessão principal (Emenda A1).
export const ORIGENS_PRINCIPAIS = Object.freeze(['repl_main_thread', 'main']);
export const AGENTE_VALIDO = /^[A-Za-z0-9._-]{1,40}$/;
const CHAVES_LOG = new Set([
  NOMES.nomeEvento, NOMES.modelo, NOMES.effort, NOMES.origem, NOMES.agente, NOMES.custo, NOMES.entrada,
  NOMES.saida, NOMES.cacheLeitura, NOMES.cacheEscrita, NOMES.duracao, NOMES.ttft, NOMES.sucesso,
]);
const EVENTOS = new Set([NOMES.eventoPedido, NOMES.eventoErro, NOMES.eventoFerramenta]);
const PREFIXO_EVENTO = 'claude_code.';

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lista = (v) => (Array.isArray(v) ? v.slice(0, LISTA_MAX) : []);

// Valor de um atributo OTLP JSON. intValue vem como texto (int64 no JSON).
function valorDe(v) {
  if (!ehObjeto(v)) return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue.length <= TEXTO_MAX ? v.stringValue : undefined;
  if (typeof v.intValue === 'string' || typeof v.intValue === 'number') return v.intValue;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  return undefined;
}

// Só as chaves pedidas, a primeira ocorrência de cada; o resto nem é lido.
function atributos(bruto, chaves) {
  const r = Object.create(null);
  for (const a of lista(bruto).slice(0, ATRIBUTOS_MAX)) {
    if (!ehObjeto(a) || typeof a.key !== 'string' || !chaves.has(a.key) || a.key in r) continue;
    const v = valorDe(a.value);
    if (v !== undefined) r[a.key] = v;
  }
  return r;
}

// Número finito de 0 até `max`; texto só com dígitos e ponto. Senão null.
function numero(v, max) {
  const n = typeof v === 'string' && /^\d{1,15}(?:\.\d{1,12})?$/.test(v) ? Number(v) : v;
  return numeroFinito(n) && n >= 0 && n <= max ? n : null;
}

// timeUnixNano (texto de dígitos ou número) em ms, de 40 dias para trás até
// 5 min para a frente (Foco de revisão 4).
function instanteNano(t, agoraMs) {
  let ms = null;
  if (typeof t === 'string' && /^\d{1,20}$/.test(t)) ms = Number(BigInt(t) / 1_000_000n);
  else if (numeroFinito(t) && t >= 0) ms = Math.floor(t / 1e6);
  return ms !== null && ms >= agoraMs - PASSADO_MAX_MS && ms <= agoraMs + FUTURO_MS ? ms : null;
}

function origemDe(a) {
  const agente = a[NOMES.agente];
  if (typeof agente === 'string' && AGENTE_VALIDO.test(agente)) return `sub:${agente}`;
  const q = a[NOMES.origem];
  if (typeof q === 'string' && ORIGENS_PRINCIPAIS.includes(q)) return 'principal';
  return agente === undefined ? 'outro' : 'sub';
}

function nomeEvento(n, body) {
  const bruto = typeof n === 'string' ? n : ehObjeto(body) && typeof body.stringValue === 'string' ? body.stringValue : null;
  if (bruto === null) return null;
  const curto = bruto.startsWith(PREFIXO_EVENTO) ? bruto.slice(PREFIXO_EVENTO.length) : bruto;
  return EVENTOS.has(curto) ? curto : null;
}

function registroDeLog(l, agoraMs) {
  if (!ehObjeto(l)) return null;
  const a = atributos(l.attributes, CHAVES_LOG);
  const nome = nomeEvento(a[NOMES.nomeEvento], l.body);
  if (nome === null) return null;
  const em = instanteNano(l.timeUnixNano ?? l.observedTimeUnixNano, agoraMs);
  const modelo = typeof a[NOMES.modelo] === 'string' && MODELO_VALIDO.test(a[NOMES.modelo]) ? a[NOMES.modelo] : null;
  if (em === null || modelo === null) return null;
  const base = { em, modelo, effort: effortValido(a[NOMES.effort]) ?? '-', origem: origemDe(a) };
  if (nome === NOMES.eventoPedido) {
    return {
      t: 'req', ...base,
      custo: numero(a[NOMES.custo], TETO.custo) ?? 0,
      entrada: numero(a[NOMES.entrada], TETO.tokens) ?? 0,
      saida: numero(a[NOMES.saida], TETO.tokens) ?? 0,
      cacheLeitura: numero(a[NOMES.cacheLeitura], TETO.tokens) ?? 0,
      cacheEscrita: numero(a[NOMES.cacheEscrita], TETO.tokens) ?? 0,
      duracaoMs: numero(a[NOMES.duracao], TETO.ms),
      ttftMs: numero(a[NOMES.ttft], TETO.ms),
    };
  }
  if (nome === NOMES.eventoErro) return { t: 'erro', ...base };
  const s = a[NOMES.sucesso];
  const ok = s === true || s === 'true' ? true : s === false || s === 'false' ? false : null;
  return ok === null ? null : { t: 'ferramenta', ...base, ok };
}

// Só a métrica de tempo ativo, só em delta: uma cumulativa somaria o mesmo
// tempo a cada exportação (R11).
function registrosDeMetrica(m, agoraMs, saida) {
  if (!ehObjeto(m) || m.name !== NOMES.metricaAtivo || !ehObjeto(m.sum)) return;
  const temp = m.sum.aggregationTemporality;
  if (temp !== 1 && temp !== 'AGGREGATION_TEMPORALITY_DELTA') return;
  for (const dp of lista(m.sum.dataPoints)) {
    if (!ehObjeto(dp)) continue;
    const em = instanteNano(dp.timeUnixNano, agoraMs);
    const v = numero(dp.asDouble ?? dp.asInt, TETO.ativoS);
    if (em !== null && v !== null && v > 0) saida.push({ t: 'ativo', em, segundos: v });
  }
}

export function registrosDaLinha(texto, agoraMs) {
  let o;
  try { o = JSON.parse(texto); } catch { return null; }
  if (!ehObjeto(o)) return null;
  const saida = [];
  try {
    for (const r of lista(o.resourceLogs)) {
      for (const s of lista(r?.scopeLogs)) {
        for (const l of lista(s?.logRecords)) {
          const x = registroDeLog(l, agoraMs);
          if (x !== null) saida.push(x);
        }
      }
    }
    for (const r of lista(o.resourceMetrics)) {
      for (const s of lista(r?.scopeMetrics)) {
        for (const m of lista(s?.metrics)) registrosDeMetrica(m, agoraMs, saida);
      }
    }
  } catch {
    return null;
  }
  return saida;
}

function processarLinha(buf, agoraMs, saida) {
  const texto = buf.toString('utf8').trim();
  if (texto.length === 0) return true;
  const r = registrosDaLinha(texto, agoraMs);
  if (r === null) return false;
  for (const x of r) saida.push(x);
  return true;
}

// Lê [desde, ate) do arquivo cujo inode é `ino`, linha a linha. Só linhas
// terminadas em \n contam, a não ser em `final` (arquivo rotacionado, que não
// cresce mais). Devolve a posição logo depois da última linha consumida.
function lerSegmento(arquivo, ino, desde, ate, final, agoraMs, saida) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
  } catch {
    return { pos: desde, corrompido: true };
  }
  try {
    const info = fs.fstatSync(fd, { bigint: true });
    if (!info.isFile() || info.ino !== ino) return { pos: desde, corrompido: true };
    const pedaco = Buffer.allocUnsafe(PEDACO);
    let pos = desde;
    let lido = desde;
    let resto = Buffer.alloc(0);
    let descartando = false;
    let corrompido = false;
    while (lido < ate) {
      const n = fs.readSync(fd, pedaco, 0, Math.min(PEDACO, ate - lido), lido);
      if (n === 0) break;
      let ini = 0;
      for (;;) {
        const nl = pedaco.indexOf(10, ini);
        if (nl === -1 || nl >= n) break;
        if (!descartando) {
          const linha = resto.length > 0 ? Buffer.concat([resto, pedaco.subarray(ini, nl)]) : pedaco.subarray(ini, nl);
          if (linha.length > LINHA_MAX_BYTES || !processarLinha(linha, agoraMs, saida)) corrompido = true;
        }
        resto = Buffer.alloc(0);
        descartando = false;
        pos = lido + nl + 1;
        ini = nl + 1;
      }
      if (!descartando) {
        const cauda = pedaco.subarray(ini, n);
        if (resto.length + cauda.length > LINHA_MAX_BYTES) {
          descartando = true;
          corrompido = true;
          resto = Buffer.alloc(0);
        } else {
          resto = Buffer.concat([resto, cauda]);
        }
      }
      lido += n;
    }
    if (final && pos < lido) {
      if (!descartando && resto.length > 0 && !processarLinha(resto, agoraMs, saida)) corrompido = true;
      pos = lido;
    }
    return { pos, corrompido };
  } catch {
    return { pos: desde, corrompido: true };
  } finally {
    fechar(fd);
  }
}

function cursorValido(c) {
  return ehObjeto(c) && typeof c.ino === 'string' && /^\d{1,40}$/.test(c.ino) && Number.isSafeInteger(c.pos) && c.pos >= 0
    ? { ino: c.ino, pos: c.pos }
    : null;
}

// O arquivo rotacionado que ainda tem o inode do cursor (a rotação renomeia,
// então o inode fica). Só nomes de ROTACIONADO, no máximo 16, sem link.
function acharRotacionado(pasta, ino) {
  try {
    const nomes = fs.readdirSync(pasta).filter((n) => ROTACIONADO.test(n)).slice(0, ROTACIONADOS_MAX);
    for (const n of nomes) {
      const arquivo = path.join(pasta, n);
      const info = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
      if (info && info.isFile() && String(info.ino) === ino) return { arquivo, info };
    }
  } catch { /* sem rotacionado legível */ }
  return null;
}

export function lerNovos(opcoes) {
  const { pasta, cursor, agoraMs, maxBytes = LEITURA_MAX_BYTES } = opcoes ?? {};
  const semNada = { registros: [], cursor: cursor ?? null, corrompido: false };
  try {
    if (typeof pasta !== 'string' || !numeroFinito(agoraMs)) return semNada;
    const arquivo = path.join(pasta, ARQ_TELEMETRIA);
    const atual = fs.lstatSync(arquivo, { bigint: true, throwIfNoEntry: false });
    if (!atual) return semNada;
    if (!atual.isFile()) return { ...semNada, corrompido: true };
    const tamanho = Number(atual.size);
    const ino = String(atual.ino);
    const cur = cursorValido(cursor);
    const segmentos = [];
    if (cur !== null && cur.ino === ino) {
      segmentos.push({ arquivo, ino: atual.ino, desde: cur.pos <= tamanho ? cur.pos : 0, ate: tamanho, final: false });
    } else {
      const rot = cur === null ? null : acharRotacionado(pasta, cur.ino);
      if (rot !== null && cur.pos <= Number(rot.info.size)) {
        segmentos.push({ arquivo: rot.arquivo, ino: rot.info.ino, desde: cur.pos, ate: Number(rot.info.size), final: true });
      }
      segmentos.push({ arquivo, ino: atual.ino, desde: 0, ate: tamanho, final: false });
    }
    const registros = [];
    let corrompido = false;
    let orcamento = maxBytes;
    let novoCursor = { ino, pos: segmentos[segmentos.length - 1].desde };
    for (const s of segmentos) {
      const n = s.ate - s.desde;
      const ehAtual = s.arquivo === arquivo;
      if (n > orcamento) {
        corrompido = true;
        if (ehAtual) novoCursor = { ino, pos: s.ate };
        continue;
      }
      orcamento -= n;
      const r = lerSegmento(s.arquivo, s.ino, s.desde, s.ate, s.final, agoraMs, registros);
      if (r.corrompido) corrompido = true;
      if (ehAtual) novoCursor = { ino, pos: r.pos };
    }
    return { registros, cursor: novoCursor, corrompido };
  } catch {
    return { ...semNada, corrompido: true };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/aprendizado-otlp.test.js`
Expected: PASS (o teste do link pode sair como `skip` num Windows sem permissão de criar link).

- [ ] **Step 5: Escrever o teste da configuração e das fronteiras**

Crie `test/aprendizado-fronteiras.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configColetor, SENSIVEIS, PORTA, HOST } from '../src/aprendizado/config-coletor.js';

// Fronteiras de §3.1 e a primeira barreira (§5.1, §8 "Filtro"). O teste das
// fronteiras lê o texto de src/, como o S24 de test/guarda-ameacas.test.js,
// e vale para todo arquivo novo de src/aprendizado das tasks seguintes.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function listarJs(dir) {
  const achados = [];
  if (!fs.existsSync(dir)) return achados;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...listarJs(p));
    else if (e.name.endsWith('.js')) achados.push(p);
  }
  return achados;
}

const REDE = /node:(?:http|https|net|dns|tls|dgram)\b|from ['"](?:http|https|net|dns|tls|dgram)['"]|\bfetch\s*\(|\bWebSocket\b/;
const FILHO = /node:child_process|from ['"]child_process['"]|process\.binding\s*\(/;

test('§3.1: só baixar.js tem rede e só coletor.js tem processo filho', () => {
  const arquivos = listarJs(path.join(repo, 'src', 'aprendizado'));
  assert.ok(arquivos.length > 0);
  for (const a of arquivos) {
    const nome = path.basename(a);
    const t = fs.readFileSync(a, 'utf8');
    if (nome !== 'baixar.js') assert.doesNotMatch(t, REDE, a);
    if (nome !== 'coletor.js') assert.doesNotMatch(t, FILHO, a);
  }
});

test('§3.1: src/guarda continua sem rede e sem processo filho, com o aperto', () => {
  for (const a of listarJs(path.join(repo, 'src', 'guarda'))) {
    const t = fs.readFileSync(a, 'utf8');
    assert.doesNotMatch(t, REDE, a);
    assert.doesNotMatch(t, FILHO, a);
  }
});

test('o hook do comando aprender, quando existir, não tem rede nem processo filho', () => {
  const a = path.join(repo, 'src', 'hooks', 'aprender.js');
  if (!fs.existsSync(a)) return;
  const t = fs.readFileSync(a, 'utf8');
  assert.doesNotMatch(t, REDE);
  assert.doesNotMatch(t, FILHO);
});

test('§8 Filtro: a configuração gerada tem cada delete, no recurso e nos atributos', () => {
  const r = configColetor({ arquivoTelemetria: 'C:/Users/José/.claude/hadouken/otel/telemetria.jsonl' });
  assert.equal(r.ok, true);
  const t = r.texto;
  for (const k of SENSIVEIS) {
    assert.equal(t.split(`- key: ${k}\n        action: delete`).length - 1, 2, k);
  }
  assert.equal(t.split('- pattern: ^vcs\\..*\n        action: delete').length - 1, 2);
  assert.ok(t.includes(`        endpoint: ${HOST}:${PORTA}\n`));
  assert.doesNotMatch(t, /grpc|extensions|otlphttp|debug|0\.0\.0\.0|localhost|traces:/);
  assert.equal(t.match(/^ {2}file:$/gm).length, 1);
  assert.match(t, /max_megabytes: 5\n\s+max_days: 30\n\s+max_backups: 3/);
  assert.match(t, /metrics:\n\s+level: none/);
  assert.equal(t.split('processors: [memory_limiter, resource/hadouken, attributes/hadouken, batch]').length - 1, 2);
  assert.ok(t.includes("path: 'C:/Users/José/.claude/hadouken/otel/telemetria.jsonl'"));
});

test('caminho com aspas, $, quebra de linha ou vazio é recusado', () => {
  for (const ruim of ["C:/a'b/t.jsonl", 'C:/a$b/t.jsonl', 'C:/a\nb/t.jsonl', '', null]) {
    assert.deepEqual(configColetor({ arquivoTelemetria: ruim }), { ok: false, motivo: 'caminho-inseguro' });
  }
});

test('barras invertidas viram barras normais', () => {
  const r = configColetor({ arquivoTelemetria: 'C:\\Users\\x\\otel\\telemetria.jsonl' });
  assert.ok(r.texto.includes("path: 'C:/Users/x/otel/telemetria.jsonl'"));
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/aprendizado-fronteiras.test.js`
Expected: FAIL com `Cannot find module` de `config-coletor.js`.

- [ ] **Step 7: Escrever `src/aprendizado/config-coletor.js`**

```js
import { caminhoAceito } from '../configuracao.js';

// Primeira barreira (spec aprendizado §5.1): a configuração do Collector,
// gerada aqui e regravada a cada subida (coletor.js), nunca editada pelo
// usuário. Receptor só http em 127.0.0.1 (sem gRPC); memory_limiter, depois
// os deletes em resource e attributes (as chaves de SENSIVEIS e todo vcs.*
// por padrão), depois batch; um único exportador `file` com rotação;
// telemetria própria desligada; sem extensões; sem pipeline de traces (§2).
// O caminho entra no YAML entre aspas simples, só depois de passar por
// caminhoAceito (a lista do comando da barra, sem aspas, $, barra invertida
// nem quebra de linha). Nunca lança.

export const PORTA = 47318;
export const HOST = '127.0.0.1';
export const SENSIVEIS = Object.freeze([
  'user.email', 'user.account_uuid', 'user.account_id', 'user.id', 'organization.id', 'workspace.host_paths',
]);
export const PADRAO_VCS = '^vcs\\..*';
export const ROTACAO = Object.freeze({ max_megabytes: 5, max_days: 30, max_backups: 3 });
export const MEMORIA_MIB = 64;
const PROCESSADORES = '[memory_limiter, resource/hadouken, attributes/hadouken, batch]';

function deletes(recuo) {
  const linhas = [];
  for (const k of SENSIVEIS) linhas.push(`${recuo}- key: ${k}`, `${recuo}  action: delete`);
  linhas.push(`${recuo}- pattern: ${PADRAO_VCS}`, `${recuo}  action: delete`);
  return linhas;
}

export function configColetor(opcoes) {
  try {
    const bruto = opcoes?.arquivoTelemetria;
    if (typeof bruto !== 'string') return { ok: false, motivo: 'caminho-inseguro' };
    const arquivo = bruto.replaceAll('\\', '/');
    if (!caminhoAceito(arquivo)) return { ok: false, motivo: 'caminho-inseguro' };
    const linhas = [
      'receivers:',
      '  otlp:',
      '    protocols:',
      '      http:',
      `        endpoint: ${HOST}:${PORTA}`,
      'processors:',
      '  memory_limiter:',
      '    check_interval: 1s',
      `    limit_mib: ${MEMORIA_MIB}`,
      '    spike_limit_mib: 16',
      '  resource/hadouken:',
      '    attributes:',
      ...deletes('      '),
      '  attributes/hadouken:',
      '    actions:',
      ...deletes('      '),
      '  batch: {}',
      'exporters:',
      '  file:',
      `    path: '${arquivo}'`,
      '    format: json',
      '    rotation:',
      `      max_megabytes: ${ROTACAO.max_megabytes}`,
      `      max_days: ${ROTACAO.max_days}`,
      `      max_backups: ${ROTACAO.max_backups}`,
      'service:',
      '  telemetry:',
      '    metrics:',
      '      level: none',
      '    logs:',
      '      level: error',
      '  pipelines:',
      '    metrics:',
      '      receivers: [otlp]',
      `      processors: ${PROCESSADORES}`,
      '      exporters: [file]',
      '    logs:',
      '      receivers: [otlp]',
      `      processors: ${PROCESSADORES}`,
      '      exporters: [file]',
      '',
    ];
    return { ok: true, texto: linhas.join('\n') };
  } catch {
    return { ok: false, motivo: 'caminho-inseguro' };
  }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `node --test test/aprendizado-otlp.test.js test/aprendizado-fronteiras.test.js test/casa-unica.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add -- src/aprendizado/otlp.js src/aprendizado/config-coletor.js test/aprendizado-otlp.test.js test/aprendizado-fronteiras.test.js
git commit -m @'
feat: learning privacy barriers, OTLP reader and generated collector config (spec aprendizado 5.1, 5.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/otlp.js src/aprendizado/config-coletor.js test/aprendizado-otlp.test.js test/aprendizado-fronteiras.test.js
```

---

### Task 3: Agregados (`agregar.js`) (§3.1, §4.1, §5.4)

**Files:**
- Create: `src/aprendizado/agregar.js`
- Test: `test/aprendizado-agregar.test.js`

**Interfaces:**
- Consome: `Registro` (Task 2), `numeroFinito` (`src/base.js`), `TOLERANCIA_JANELA_S` (`src/util.js`).
- Produz (todas sem E/S; as que recebem `ap` mudam o objeto recebido e o devolvem):
  - `Aprendizado = { v: 1, desde: ms, sessoes: int, semanas: Semana[], ritmo: { h5: [soma, n][24], d7: [soma, n][24] }, janelas: { h5: Janela[], d7: Janela[], fable: Janela[] } }`
  - `Semana = { inicio: 'AAAA-MM-DD' (segunda-feira local), modelos: { 'modelo|effort|origem': number[12] }, ativo: number[168] }` (minutos por dia da semana × hora, segunda 0h = índice 0)
  - `Janela = { reset: ms, max: 0–100, cruzou: { '60'…'95': ms }, esgotou: ms | null, disparou: boolean }`
  - `aprendizadoVazio(agoraMs) → Aprendizado`; `inicioSemana(ms) → string`; `slotDaSemana(ms) → 0–167`
  - `agregarRegistros(ap, registros) → ap`; `agregarHistorico(ap, pontos, desdeMs) → number` (o maior instante processado); `atualizarJanela(ap, tipo, { pct, resetMs, emMs }) → ap`; `marcarNaJanela(ap, tipo, emMs, 'esgotou' | 'disparou') → ap`; `marcarSessao(ap, agoraMs) → ap`; `perfilDe(ap) → { horasAtivas: int[7], ritmoHora: { h5: (number|null)[24], d7: (number|null)[24] } }`; `podar(ap, agoraMs) → ap`
  - constantes `CAMPOS_MODELO`, `CHAVE_MODELO`, `SEMANAS_MAX` (26), `MODELOS_SEMANA_MAX` (40), `JANELAS_MAX` ({h5: 60, d7: 12, fable: 12}), `DURACAO_JANELA_MS`, `LIMIARES` ([60…95]), `ATIVO_MIN` (5), `RITMO_N_MIN` (3)

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-agregar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aprendizadoVazio, inicioSemana, slotDaSemana, agregarRegistros, agregarHistorico, atualizarJanela, marcarNaJanela,
  marcarSessao, perfilDe, podar, CAMPOS_MODELO, SEMANAS_MAX, MODELOS_SEMANA_MAX, JANELAS_MAX,
} from '../src/aprendizado/agregar.js';

// Horário local: 5 de outubro de 2026 é uma segunda-feira.
const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const H = 3_600_000;
const req = (em, extra = {}) => ({
  t: 'req', em, modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', custo: 0.5, entrada: 100, saida: 10,
  cacheLeitura: 1000, cacheEscrita: 5, duracaoMs: 2000, ttftMs: 700, ...extra,
});

test('semana começa na segunda-feira local e o slot conta de segunda 0h', () => {
  assert.equal(inicioSemana(local(8, 15)), '2026-10-05');
  assert.equal(inicioSemana(local(11, 23)), '2026-10-05');
  assert.equal(inicioSemana(local(12, 0)), '2026-10-12');
  assert.equal(slotDaSemana(local(5, 0)), 0);
  assert.equal(slotDaSemana(local(11, 23)), 167);
  assert.equal(slotDaSemana(local(6, 10)), 34);
});

test('agregarRegistros soma por modelo·effort·origem e o tempo ativo por slot', () => {
  const ap = aprendizadoVazio(local(5, 0));
  agregarRegistros(ap, [
    req(local(6, 10)), req(local(6, 10, 5), { ttftMs: null, duracaoMs: null }),
    { t: 'erro', em: local(6, 10, 6), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal' },
    { t: 'ferramenta', em: local(6, 10, 7), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', ok: true },
    { t: 'ferramenta', em: local(6, 10, 8), modelo: 'claude-sonnet-5-5', effort: 'high', origem: 'principal', ok: false },
    { t: 'ativo', em: local(6, 10, 9), segundos: 90 },
  ]);
  assert.equal(ap.semanas.length, 1);
  const s = ap.semanas[0];
  assert.equal(CAMPOS_MODELO.length, 12);
  assert.deepEqual(s.modelos['claude-sonnet-5-5|high|principal'], [2, 1, 200, 20, 2000, 10, 2000, 700, 1, 1, 2, 1]);
  assert.equal(s.ativo[34], 1.5);
});

test('no máximo 40 chaves de modelo por semana', () => {
  const ap = aprendizadoVazio(local(5, 0));
  agregarRegistros(ap, Array.from({ length: 45 }, (_, i) => req(local(6, 10), { modelo: `modelo-${i}` })));
  assert.equal(Object.keys(ap.semanas[0].modelos).length, MODELOS_SEMANA_MAX);
});

test('agregarHistorico: ritmo por hora em pp/min, sem reset e sem buraco, e 2 min de atividade por ponto novo', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const t0 = local(6, 14);
  const pontos = [
    { at: new Date(t0).toISOString(), h5: 10, d7: 40 },
    { at: new Date(t0 + 2 * 60_000).toISOString(), h5: 12, d7: 40.5 },
    { at: new Date(t0 + 4 * 60_000).toISOString(), h5: 14, d7: 41 },
    { at: new Date(t0 + 6 * 60_000).toISOString(), h5: 1, d7: 41 },
    { at: new Date(t0 + 30 * 60_000).toISOString(), h5: 9, d7: 42 },
  ];
  const ate = agregarHistorico(ap, pontos, t0);
  assert.equal(ate, t0 + 30 * 60_000);
  assert.deepEqual(ap.ritmo.h5[14], [2, 2]);
  assert.deepEqual(ap.ritmo.d7[14], [0.5, 3]);
  assert.equal(ap.semanas[0].ativo[slotDaSemana(t0)], 8);
  assert.equal(agregarHistorico(ap, pontos, ate), ate);
  assert.deepEqual(ap.ritmo.h5[14], [2, 2]);
});

test('atualizarJanela: máximo, limiares cruzados, esgotou; outra janela pelo reset', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(6, 15);
  atualizarJanela(ap, 'h5', { pct: 55, resetMs: reset, emMs: reset - 4 * H });
  atualizarJanela(ap, 'h5', { pct: 62, resetMs: reset, emMs: reset - 3 * H });
  atualizarJanela(ap, 'h5', { pct: 81, resetMs: reset + 60_000, emMs: reset - 2 * H });
  atualizarJanela(ap, 'h5', { pct: 100, resetMs: reset, emMs: reset - H });
  assert.equal(ap.janelas.h5.length, 1);
  const j = ap.janelas.h5[0];
  assert.equal(j.max, 100);
  assert.equal(j.cruzou['60'], reset - 3 * H);
  assert.equal(j.cruzou['80'], reset - 2 * H);
  assert.equal(j.cruzou['95'], reset - H);
  assert.equal(j.esgotou, reset - H);
  atualizarJanela(ap, 'h5', { pct: 5, resetMs: reset + 5 * H, emMs: reset + H });
  assert.equal(ap.janelas.h5.length, 2);
  atualizarJanela(ap, 'h5', { pct: 50, resetMs: reset, emMs: reset + 1 });
  assert.equal(ap.janelas.h5.length, 2);
});

test('marcarNaJanela põe disparo e esgotamento na janela que contém o instante', () => {
  const ap = aprendizadoVazio(local(5, 0));
  const reset = local(12, 22);
  atualizarJanela(ap, 'fable', { pct: 40, resetMs: reset, emMs: reset - 3 * 24 * H });
  marcarNaJanela(ap, 'fable', reset - 2 * 24 * H, 'disparou');
  marcarNaJanela(ap, 'fable', reset - 24 * H, 'esgotou');
  marcarNaJanela(ap, 'fable', reset + H, 'disparou');
  // A janela recebeu 40%: nenhum limiar cruzado; o esgotamento põe o máximo em 100.
  assert.deepEqual(ap.janelas.fable[0], { reset, max: 100, cruzou: {}, esgotou: reset - 24 * H, disparou: true });
});

test('perfilDe: hora ativa em pelo menos metade das últimas 4 semanas; ritmo só com 3 amostras', () => {
  const ap = aprendizadoVazio(local(5, 0));
  for (const d of [5, 12, 19, 26]) agregarRegistros(ap, [{ t: 'ativo', em: local(d, 23, 59), segundos: 1 }]);
  agregarRegistros(ap, [{ t: 'ativo', em: local(5, 10), segundos: 600 }, { t: 'ativo', em: local(12, 10), segundos: 600 }]);
  agregarRegistros(ap, [{ t: 'ativo', em: local(19, 11), segundos: 600 }]);
  ap.ritmo.h5[10] = [3, 3];
  ap.ritmo.h5[11] = [2, 2];
  const p = perfilDe(ap);
  assert.equal(p.horasAtivas[0], 1 << 10);
  assert.deepEqual(p.horasAtivas.slice(1), [0, 0, 0, 0, 0, 0]);
  assert.equal(p.ritmoHora.h5[10], 1);
  assert.equal(p.ritmoHora.h5[11], null);
});

test('marcarSessao conta a sessão e 5 min de atividade', () => {
  const ap = aprendizadoVazio(local(5, 0));
  marcarSessao(ap, local(6, 10));
  marcarSessao(ap, local(6, 10, 30));
  assert.equal(ap.sessoes, 2);
  assert.equal(ap.semanas[0].ativo[34], 10);
});

test('podar: 26 semanas, tetos de janelas e janela com reset longe demais', () => {
  const ap = aprendizadoVazio(local(5, 0));
  for (let i = 0; i < 30; i++) agregarRegistros(ap, [req(local(5, 10) - i * 7 * 24 * H)]);
  for (let i = 0; i < 70; i++) atualizarJanela(ap, 'h5', { pct: 10, resetMs: local(5, 10) - i * 5 * H, emMs: local(5, 10) - i * 5 * H - H });
  ap.janelas.d7.push({ reset: local(5, 10) + 30 * 24 * H, max: 1, cruzou: {}, esgotou: null, disparou: false });
  podar(ap, local(5, 10));
  assert.equal(ap.semanas.length, SEMANAS_MAX);
  assert.equal(ap.semanas.at(-1).inicio, '2026-10-05');
  assert.equal(ap.janelas.h5.length, JANELAS_MAX.h5);
  assert.equal(ap.janelas.d7.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-agregar.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/agregar.js`.

- [ ] **Step 3: Escrever `src/aprendizado/agregar.js`**

```js
import { numeroFinito } from '../base.js';
import { TOLERANCIA_JANELA_S } from '../util.js';

// Agregados do aprendizado (spec aprendizado §3.1 e §4.1): nunca evento cru.
// Por semana (segunda-feira local), somas por modelo·effort·origem e minutos
// ativos por dia da semana × hora; ritmo das janelas por hora do dia; e um
// resumo de cada janela (5h, 7d, Fable) com o máximo, o instante em que
// cruzou cada limiar, o esgotamento e se a guarda disparou. Sem E/S: as
// funções mudam o objeto que recebem e o devolvem. Retenção de §5.4: 26
// semanas (podar).

const H = 3_600_000;
export const CAMPOS_MODELO = Object.freeze([
  'pedidos', 'custo', 'entrada', 'saida', 'cacheLeitura', 'cacheEscrita', 'duracaoMs', 'ttftMs', 'nTtft', 'erros', 'ferramentas', 'falhas',
]);
export const CHAVE_MODELO = /^[A-Za-z0-9._:[\]-]{1,80}\|(?:low|medium|high|xhigh|max|-)\|(?:principal|outro|sub|sub:[A-Za-z0-9._-]{1,40})$/;
export const SEMANAS_MAX = 26;
export const MODELOS_SEMANA_MAX = 40;
export const JANELAS_MAX = Object.freeze({ h5: 60, d7: 12, fable: 12 });
export const DURACAO_JANELA_MS = Object.freeze({ h5: 5 * H, d7: 7 * 24 * H, fable: 7 * 24 * H });
export const LIMIARES = Object.freeze([60, 65, 70, 75, 80, 85, 90, 95]);
// Minutos num slot (dia × hora) de uma semana para ele contar como ativo.
export const ATIVO_MIN = 5;
// Amostras mínimas de uma hora do dia para o ritmo dela valer.
export const RITMO_N_MIN = 3;
const MINUTOS_POR_SESSAO = 5;
const MINUTOS_POR_PONTO = 2;
const SLOT_MAX_MIN = 60;
const RITMO_N_TETO = 5000;
const PASSO_MIN = 1;
const PASSO_MAX = 10;
const TOLERANCIA_MS = TOLERANCIA_JANELA_S * 1000;

const pares = () => Array.from({ length: 24 }, () => [0, 0]);
const dois = (n) => String(n).padStart(2, '0');

export function aprendizadoVazio(agoraMs) {
  return { v: 1, desde: agoraMs, sessoes: 0, semanas: [], ritmo: { h5: pares(), d7: pares() }, janelas: { h5: [], d7: [], fable: [] } };
}

export function inicioSemana(ms) {
  const d = new Date(ms);
  const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${seg.getFullYear()}-${dois(seg.getMonth() + 1)}-${dois(seg.getDate())}`;
}

export function slotDaSemana(ms) {
  const d = new Date(ms);
  return ((d.getDay() + 6) % 7) * 24 + d.getHours();
}

function semanaDe(ap, ms) {
  const inicio = inicioSemana(ms);
  let s = ap.semanas.find((x) => x.inicio === inicio);
  if (s === undefined) {
    s = { inicio, modelos: {}, ativo: new Array(168).fill(0) };
    ap.semanas.push(s);
    ap.semanas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  }
  return s;
}

function somarAtivo(ap, ms, minutos) {
  const s = semanaDe(ap, ms);
  const slot = slotDaSemana(ms);
  s.ativo[slot] = Math.min(SLOT_MAX_MIN, s.ativo[slot] + minutos);
}

export function agregarRegistros(ap, registros) {
  for (const r of registros) {
    if (r.t === 'ativo') {
      somarAtivo(ap, r.em, r.segundos / 60);
      continue;
    }
    const s = semanaDe(ap, r.em);
    const chave = `${r.modelo}|${r.effort}|${r.origem}`;
    if (!Object.hasOwn(s.modelos, chave)) {
      if (Object.keys(s.modelos).length >= MODELOS_SEMANA_MAX) continue;
      s.modelos[chave] = new Array(CAMPOS_MODELO.length).fill(0);
    }
    const v = s.modelos[chave];
    if (r.t === 'req') {
      v[0] += 1;
      v[1] += r.custo;
      v[2] += r.entrada;
      v[3] += r.saida;
      v[4] += r.cacheLeitura;
      v[5] += r.cacheEscrita;
      v[6] += r.duracaoMs ?? 0;
      if (r.ttftMs !== null) {
        v[7] += r.ttftMs;
        v[8] += 1;
      }
    } else if (r.t === 'erro') {
      v[9] += 1;
    } else if (r.t === 'ferramenta') {
      v[10] += 1;
      if (!r.ok) v[11] += 1;
    }
  }
  return ap;
}

// Pontos do histórico de estado.json ({ at, h5, d7 }, a cada 2 min). Cada
// ponto depois de `desdeMs` conta 2 min de atividade; cada par seguido (de 1
// a 10 min, sem queda, que é reset) soma a taxa em pp/min à hora do dia do
// segundo ponto. Devolve o maior instante processado (o novo cursor).
export function agregarHistorico(ap, pontos, desdeMs) {
  const validos = [];
  for (const p of Array.isArray(pontos) ? pontos : []) {
    const t = typeof p?.at === 'string' ? Date.parse(p.at) : Number.NaN;
    if (!numeroFinito(t)) continue;
    validos.push({ t, h5: numeroFinito(p.h5) ? p.h5 : null, d7: numeroFinito(p.d7) ? p.d7 : null });
  }
  validos.sort((a, b) => a.t - b.t);
  let ate = desdeMs;
  for (let i = 0; i < validos.length; i++) {
    const q = validos[i];
    if (q.t <= desdeMs) continue;
    somarAtivo(ap, q.t, MINUTOS_POR_PONTO);
    const p = validos[i - 1];
    const minutos = p === undefined ? 0 : (q.t - p.t) / 60_000;
    if (minutos >= PASSO_MIN && minutos <= PASSO_MAX) {
      for (const col of ['h5', 'd7']) {
        if (p[col] === null || q[col] === null || q[col] < p[col]) continue;
        const par = ap.ritmo[col][new Date(q.t).getHours()];
        par[0] += (q[col] - p[col]) / minutos;
        par[1] += 1;
        if (par[1] > RITMO_N_TETO) {
          par[0] /= 2;
          par[1] /= 2;
        }
      }
    }
    ate = Math.max(ate, q.t);
  }
  return ate;
}

export function atualizarJanela(ap, tipo, leitura) {
  const { pct, resetMs, emMs } = leitura ?? {};
  if (!numeroFinito(pct) || !numeroFinito(resetMs) || !numeroFinito(emMs)) return ap;
  if (emMs > resetMs + TOLERANCIA_MS || emMs <= resetMs - DURACAO_JANELA_MS[tipo]) return ap;
  const lista = ap.janelas[tipo];
  let j = lista.find((x) => Math.abs(x.reset - resetMs) <= TOLERANCIA_MS);
  if (j === undefined) {
    j = { reset: resetMs, max: 0, cruzou: {}, esgotou: null, disparou: false };
    lista.push(j);
    lista.sort((a, b) => a.reset - b.reset);
  }
  if (emMs > j.reset) return ap;
  const v = Math.max(0, Math.min(100, pct));
  if (v > j.max) j.max = v;
  for (const T of LIMIARES) {
    if (v >= T && !Object.hasOwn(j.cruzou, String(T))) j.cruzou[String(T)] = emMs;
  }
  if (v >= 100 && j.esgotou === null) j.esgotou = emMs;
  return ap;
}

export function marcarNaJanela(ap, tipo, emMs, oque) {
  if (!numeroFinito(emMs)) return ap;
  const j = ap.janelas[tipo].find((x) => emMs <= x.reset && emMs > x.reset - DURACAO_JANELA_MS[tipo]);
  if (j === undefined) return ap;
  if (oque === 'disparou') {
    j.disparou = true;
  } else if (oque === 'esgotou' && (j.esgotou === null || emMs < j.esgotou)) {
    j.esgotou = emMs;
    j.max = 100;
  }
  return ap;
}

export function marcarSessao(ap, agoraMs) {
  ap.sessoes = Math.min(ap.sessoes + 1, 1_000_000);
  somarAtivo(ap, agoraMs, MINUTOS_POR_SESSAO);
  return ap;
}

// Horas ativas: o slot com ATIVO_MIN minutos em pelo menos metade das
// últimas (até) 4 semanas. Máscara de 24 bits por dia (segunda = 0).
export function perfilDe(ap) {
  const semanas = ap.semanas.slice(-4);
  const horasAtivas = [0, 0, 0, 0, 0, 0, 0];
  for (let slot = 0; slot < 168; slot++) {
    const n = semanas.filter((s) => s.ativo[slot] >= ATIVO_MIN).length;
    if (n > 0 && n * 2 >= semanas.length) horasAtivas[Math.floor(slot / 24)] |= 1 << (slot % 24);
  }
  const ritmoHora = {};
  for (const col of ['h5', 'd7']) {
    ritmoHora[col] = ap.ritmo[col].map(([soma, n]) => (n >= RITMO_N_MIN ? Math.round((soma / n) * 1e4) / 1e4 : null));
  }
  return { horasAtivas, ritmoHora };
}

export function podar(ap, agoraMs) {
  ap.semanas = ap.semanas.slice(-SEMANAS_MAX);
  for (const s of ap.semanas) {
    const chaves = Object.keys(s.modelos);
    if (chaves.length <= MODELOS_SEMANA_MAX) continue;
    const manter = chaves.sort((a, b) => s.modelos[b][0] - s.modelos[a][0]).slice(0, MODELOS_SEMANA_MAX);
    s.modelos = Object.fromEntries(manter.map((k) => [k, s.modelos[k]]));
  }
  for (const tipo of Object.keys(JANELAS_MAX)) {
    ap.janelas[tipo] = ap.janelas[tipo]
      .filter((j) => j.reset <= agoraMs + DURACAO_JANELA_MS[tipo] + TOLERANCIA_MS)
      .slice(-JANELAS_MAX[tipo]);
  }
  return ap;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/aprendizado-agregar.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/aprendizado/agregar.js test/aprendizado-agregar.test.js
git commit -m @'
feat: learning aggregates by model-effort-origin, hour and window (spec aprendizado 4.1, 5.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/agregar.js test/aprendizado-agregar.test.js
```

---

### Task 4: Arquivos novos (`arquivos.js`, `registro.js`) e a trava do passo (§3.1, §4.7, §6, §11)

**Files:**
- Create: `src/aprendizado/arquivos.js`, `src/aprendizado/registro.js`
- Test: `test/aprendizado-registro.test.js`

**Interfaces:**
- Consome: `gravarJsonAtomico` (`src/estado.js`), `lerSemLink` (`src/guarda/arquivo.js`), `MODELO_VALIDO` (`src/guarda/registros.js`), `apagar`, `esperar`, `fechar`, `instante`, `numeroFinito` (`src/base.js`), `aprendizadoVazio`, `CAMPOS_MODELO`, `CHAVE_MODELO`, `JANELAS_MAX`, `LIMIARES`, `MODELOS_SEMANA_MAX`, `SEMANAS_MAX` (Task 3).
- Produz, em `arquivos.js` (leve: só `fs`, `path` e `base.js`; a guarda e os caminhos quentes importam só este):
  - `DIR_OTEL` ('otel'), `ARQ`, `ARQ_OTEL`, `TETO`, `ITENS`, `caminhos(dir) → { otel, bin, ligado, pid, log, config, subindo, instalado, aprendizado, ajustes, sugestoes, cursor, eventos, trava }`
  - `valorDoItem(item, v) → number | null | undefined` (undefined = inválido)
  - `chaveSugestao(s) → string` (`'afrouxar:<item>'` ou `'modelo:<origem>|<modelo>|<effort>|<modelo>|<effort>'`)
  - `ligadoExiste(dir) → boolean`
- Produz, em `registro.js`:
  - `validarAprendizado(v, agoraMs) → Aprendizado | null`; `lerAprendizado(dir, agoraMs) → Aprendizado`; `gravarAprendizado(dir, ap) → { ok }`
  - `Ajustes = { v: 1, seq, vigentes: { [item]: valor }, registros: Registro[], bloqueios: { [chave]: ms }, perfil }`; `ajustesVazios()`, `validarAjustes(v, agoraMs) → Ajustes | null`, `lerAjustes(dir, agoraMs) → Ajustes`, `gravarAjustes(dir, aj) → { ok }`
  - `Sugestoes = { v: 1, seq, lista: Sugestao[] }`; `sugestoesVazias()`, `lerSugestoes(dir, agoraMs)`, `gravarSugestoes(dir, sug) → { ok }`
  - `Cursor = { v: 1, arquivo: { ino, pos } | null, historicoAte: ms, anuncio: { dia: 'AAAA-MM-DD' | null, ajustes: int, sugestoes: int }, avisos: { [tipo]: 'AAAA-MM-DD' } }`; `cursorVazio()`, `lerCursor(dir, agoraMs)`, `gravarCursor(dir, c) → { ok }`
  - `TIPOS_EVENTO_APR`, `lerEventosApr(dir, agoraMs) → { at, tipo }[]`, `anexarEventoApr(dir, tipo, agoraMs) → { ok }`
  - `lerLigado(dir) → { chaves: { [K]: V }, criouEnv: boolean } | null`, `gravarLigado(dir, { chaves, criouEnv }, agoraMs) → { ok }`, `apagarLigado(dir)`
  - `pegarTrava(dir) → { ok: true, soltar() } | { ok: false, motivo: 'ocupada' | 'erro' }`
  - para os consumidores (Task 13): `ajustesParaConsumo(dir, agoraMs) → { vigentes, perfil } | null`, `horaAtiva(perfil, ms) → boolean`, `intervaloDoPainelMs(dir, agoraMs) → number | null`, `faixasDoPainel(dir, agoraMs) → { amarelo, vermelho }`, `perfilDaPrevisao(dir, agoraMs) → { peso, h5, d7 } | null`
  - `MOTIVOS`, `ORIGENS_REGISTRO`, `ORIGEM_VALIDA`, `DIA_ISO`

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-registro.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhos, ligadoExiste, valorDoItem, chaveSugestao, TETO } from '../src/aprendizado/arquivos.js';
import {
  lerAprendizado, gravarAprendizado, ajustesVazios, lerAjustes, gravarAjustes, sugestoesVazias, lerSugestoes, gravarSugestoes,
  cursorVazio, lerCursor, gravarCursor, lerEventosApr, anexarEventoApr, lerLigado, gravarLigado, apagarLigado, pegarTrava,
  ajustesParaConsumo, intervaloDoPainelMs, faixasDoPainel, perfilDaPrevisao,
} from '../src/aprendizado/registro.js';
import { aprendizadoVazio, agregarRegistros, atualizarJanela, marcarSessao } from '../src/aprendizado/agregar.js';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprendizado ç '));
  dirs.push(d);
  return d;
}
const AGORA = new Date(2026, 9, 20, 15, 0).getTime();
const D = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
function ligar(d) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  assert.equal(gravarLigado(d, { chaves: { OTEL_LOGS_EXPORTER: 'otlp' }, criouEnv: false }, AGORA).ok, true);
}

test('valorDoItem: faixas, inteiros, peso de 0,1 em 0,1 e null só na guarda', () => {
  assert.equal(valorDoItem('painel.intervaloS', 60), 60);
  assert.equal(valorDoItem('painel.intervaloS', 20), undefined);
  assert.equal(valorDoItem('painel.intervaloS', 60.5), undefined);
  assert.equal(valorDoItem('painel.intervaloS', null), undefined);
  assert.equal(valorDoItem('previsao.pesoPerfil', 0.3), 0.3);
  assert.equal(valorDoItem('previsao.pesoPerfil', 0.35), undefined);
  assert.equal(valorDoItem('guarda.teto7d', null), null);
  assert.equal(valorDoItem('guarda.teto7d', 69), undefined);
  assert.equal(valorDoItem('__proto__', 1), undefined);
  assert.equal(chaveSugestao({ tipo: 'afrouxar', item: 'guarda.teto7d' }), 'afrouxar:guarda.teto7d');
  assert.equal(
    chaveSugestao({ tipo: 'modelo', origem: 'sub:revisor', de: { modelo: 'a', effort: 'high' }, para: { modelo: 'b', effort: '-' } }),
    'modelo:sub:revisor|a|high|b|-',
  );
});

test('aprendizado.json: ida e volta; inválido, grande ou link vira vazio', (t) => {
  const d = novoDir();
  const ap = aprendizadoVazio(AGORA - 10 * D);
  agregarRegistros(ap, [{ t: 'req', em: AGORA - D, modelo: 'm', effort: 'high', origem: 'principal', custo: 1, entrada: 2, saida: 3, cacheLeitura: 4, cacheEscrita: 5, duracaoMs: 6, ttftMs: 7 }]);
  atualizarJanela(ap, 'd7', { pct: 70, resetMs: AGORA + D, emMs: AGORA - D });
  marcarSessao(ap, AGORA);
  assert.equal(gravarAprendizado(d, ap).ok, true);
  assert.deepEqual(lerAprendizado(d, AGORA), ap);
  fs.writeFileSync(caminhos(d).aprendizado, '{"v":1,"desde":');
  assert.equal(lerAprendizado(d, AGORA).sessoes, 0);
  fs.writeFileSync(caminhos(d).aprendizado, JSON.stringify({ ...ap, pad: 'x'.repeat(TETO.aprendizado) }));
  assert.equal(lerAprendizado(d, AGORA).semanas.length, 0);
  fs.rmSync(caminhos(d).aprendizado);
  const alvo = path.join(d, 'alvo.json');
  fs.writeFileSync(alvo, JSON.stringify(ap));
  try { fs.symlinkSync(alvo, caminhos(d).aprendizado); } catch (e) { if (e.code === 'EPERM') { t.skip('sem link'); return; } throw e; }
  assert.equal(lerAprendizado(d, AGORA).sessoes, 0);
});

test('aprendizado.json forjado: chaves de modelo fora do padrão e listas quebradas saem', () => {
  const d = novoDir();
  const texto = `{"v":1,"desde":${AGORA - D},"sessoes":3,"semanas":[{"inicio":"2026-10-19","ativo":${JSON.stringify(new Array(168).fill(0))},"modelos":{"__proto__":[1,2,3,4,5,6,7,8,9,10,11,12],"m|high|principal":[1,2],"n|high|principal":[1,1,1,1,1,1,1,1,1,1,1,1]}}],"ritmo":{"h5":"x"},"janelas":{"h5":[{"reset":${AGORA + 400 * D},"max":1}]}}`;
  fs.writeFileSync(caminhos(d).aprendizado, texto);
  const ap = lerAprendizado(d, AGORA);
  assert.equal(ap.sessoes, 3);
  assert.deepEqual(Object.keys(ap.semanas[0].modelos), ['n|high|principal']);
  assert.equal(ap.ritmo.h5.length, 24);
  assert.deepEqual(ap.janelas.h5, []);
  assert.equal(Object.getPrototypeOf(ap.semanas[0].modelos), Object.prototype);
});

test('ajustes.json: vigentes fora da faixa voltam ao padrão, amarelo >= vermelho volta aos dois', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 999;
  aj.vigentes['painel.amarelo'] = 85;
  aj.vigentes['painel.vermelho'] = 85;
  aj.vigentes['guarda.teto7d'] = 75;
  gravarAjustes(d, aj);
  const lido = lerAjustes(d, AGORA);
  assert.equal(lido.vigentes['painel.intervaloS'], 30);
  assert.equal(lido.vigentes['painel.amarelo'], 75);
  assert.equal(lido.vigentes['painel.vermelho'], 90);
  assert.equal(lido.vigentes['guarda.teto7d'], 75);
  assert.equal(lido.vigentes['guarda.fableTetoPct'], null);
});

test('Foco de revisão 4: registro de 2099 e bloqueio de 1 ano saem; bloqueio de 7 dias fica', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.registros.push({ id: 'a1', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: '2099-01-01T00:00:00Z', origem: 'auto' });
  aj.registros.push({ id: 'a2', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: iso(AGORA - D), origem: 'auto' });
  aj.bloqueios['painel.amarelo'] = AGORA + 365 * D;
  aj.bloqueios['painel.intervaloS'] = AGORA + 7 * D;
  aj.bloqueios['coisa.qualquer; rm'] = AGORA + D;
  gravarAjustes(d, aj);
  const lido = lerAjustes(d, AGORA);
  assert.deepEqual(lido.registros.map((r) => r.id), ['a2']);
  assert.deepEqual(lido.bloqueios, { 'painel.intervaloS': AGORA + 7 * D });
  assert.equal(lido.seq, 2);
});

test('ajustes.json acima de 64 KiB: os registros mais antigos saem primeiro', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  for (let i = 1; i <= 200; i++) {
    aj.registros.push({ id: `a${i}`, item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: iso(AGORA - (201 - i) * 60_000), origem: 'auto' });
  }
  // Chaves longas demais para valer na leitura, mas a gravação não as
  // confere: 50 × ~620 bytes empurram o arquivo acima de 64 KiB.
  for (let i = 0; i < 50; i++) aj.bloqueios[`modelo:${'m'.repeat(600)}${i}`] = AGORA + D;
  aj.seq = 200;
  assert.equal(gravarAjustes(d, aj).ok, true);
  assert.ok(fs.statSync(caminhos(d).ajustes).size <= TETO.ajustes);
  const lido = lerAjustes(d, AGORA);
  assert.ok(lido.registros.length < 200);
  assert.equal(lido.registros.at(-1).id, 'a200');
});

test('sugestoes.json: ida e volta; afrouxar que não afrouxa e modelo com nome estranho saem', () => {
  const d = novoDir();
  const sug = sugestoesVazias();
  sug.seq = 3;
  sug.lista.push({ id: 's1', estado: 'pendente', em: iso(AGORA - D), tipo: 'afrouxar', item: 'guarda.teto7d', de: 75, para: 80 });
  sug.lista.push({ id: 's2', estado: 'pendente', em: iso(AGORA - D), tipo: 'afrouxar', item: 'guarda.teto7d', de: 80, para: 75 });
  sug.lista.push({ id: 's3', estado: 'pendente', em: iso(AGORA - D), tipo: 'modelo', origem: 'principal', de: { modelo: 'x y', effort: 'high' }, para: { modelo: 'b', effort: 'high' }, razao: 3, erroDe: 1, erroPara: 2 });
  sug.lista.push({ id: 's4', estado: 'aprovada', em: iso(AGORA - D), tipo: 'modelo', origem: 'sub:revisor', de: { modelo: 'a', effort: 'high' }, para: { modelo: 'b', effort: '-' }, razao: 3.5, erroDe: 1, erroPara: 1.5 });
  gravarSugestoes(d, sug);
  const lido = lerSugestoes(d, AGORA);
  assert.deepEqual(lido.lista.map((s) => s.id), ['s1', 's4']);
  assert.equal(lido.seq, 4);
});

test('cursor, eventos (50 no máximo) e ligado.json', () => {
  const d = novoDir();
  const c = cursorVazio();
  c.arquivo = { ino: '123', pos: 10 };
  c.historicoAte = AGORA - 1000;
  c.anuncio = { dia: '2026-10-20', ajustes: 3, sugestoes: 1 };
  c.avisos['porta-ocupada'] = '2026-10-20';
  gravarCursor(d, c);
  assert.deepEqual(lerCursor(d, AGORA), c);
  for (let i = 0; i < 60; i++) anexarEventoApr(d, 'porta-ocupada', AGORA + i);
  anexarEventoApr(d, 'inventado', AGORA);
  const ev = lerEventosApr(d, AGORA + 100);
  assert.equal(ev.length, 50);
  assert.ok(ev.every((e) => e.tipo === 'porta-ocupada'));
  assert.equal(lerLigado(d), null);
  assert.equal(ligadoExiste(d), false);
  fs.mkdirSync(path.join(d, 'otel'));
  gravarLigado(d, { chaves: { OTEL_LOGS_EXPORTER: 'otlp', 'rm -rf': 'x', OTEL_X: 'a b' }, criouEnv: true }, AGORA);
  assert.deepEqual(lerLigado(d), { chaves: { OTEL_LOGS_EXPORTER: 'otlp' }, criouEnv: true });
  assert.equal(ligadoExiste(d), true);
  apagarLigado(d);
  assert.equal(ligadoExiste(d), false);
});

test('Foco de revisão 3: a trava deixa um passo por vez; trava velha é retomada', () => {
  const d = novoDir();
  const a = pegarTrava(d);
  assert.equal(a.ok, true);
  const b = pegarTrava(d);
  assert.deepEqual(b, { ok: false, motivo: 'ocupada' });
  a.soltar();
  const c = pegarTrava(d);
  assert.equal(c.ok, true);
  const velho = (Date.now() - 10 * 60_000) / 1000;
  fs.utimesSync(caminhos(d).trava, velho, velho);
  const e = pegarTrava(d);
  assert.equal(e.ok, true);
  e.soltar();
});

test('consumidores: sem ligado.json nada vale; com ele, intervalo fora das horas ativas, faixas e peso', () => {
  const d = novoDir();
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 120;
  aj.vigentes['painel.amarelo'] = 70;
  aj.vigentes['previsao.pesoPerfil'] = 0.3;
  aj.perfil.ritmoHora.h5[15] = 0.2;
  const hoje = new Date(AGORA);
  const dia = (hoje.getDay() + 6) % 7;
  gravarAjustes(d, aj);
  assert.equal(ajustesParaConsumo(d, AGORA), null);
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 75, vermelho: 90 });
  assert.equal(perfilDaPrevisao(d, AGORA), null);
  ligar(d);
  assert.equal(intervaloDoPainelMs(d, AGORA), 120_000);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 70, vermelho: 90 });
  assert.equal(perfilDaPrevisao(d, AGORA).peso, 0.3);
  assert.equal(perfilDaPrevisao(d, AGORA).h5[15], 0.2);
  aj.perfil.horasAtivas[dia] = 1 << hoje.getHours();
  gravarAjustes(d, aj);
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  fs.writeFileSync(caminhos(d).ajustes, 'quebrado');
  assert.equal(intervaloDoPainelMs(d, AGORA), null);
  assert.deepEqual(faixasDoPainel(d, AGORA), { amarelo: 75, vermelho: 90 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-registro.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/arquivos.js`.

- [ ] **Step 3: Escrever `src/aprendizado/arquivos.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { numeroFinito } from '../base.js';

// Nomes, tetos e itens do aprendizado (spec aprendizado §4.3, §4.4, §11 e
// R8). Módulo leve: a guarda (src/guarda/aperto.js), o painel e o
// UserPromptSubmit importam só este para saber se o aprendizado está ligado,
// sem carregar o resto. Sem rede e sem processo filho.

export const DIR_OTEL = 'otel';
export const ARQ = Object.freeze({
  aprendizado: 'aprendizado.json', ajustes: 'ajustes.json', sugestoes: 'sugestoes.json',
  cursor: 'aprendizado-cursor.json', eventos: 'aprendizado-eventos.json', trava: 'aprendizado.lock',
});
export const ARQ_OTEL = Object.freeze({
  bin: 'bin', ligado: 'ligado.json', pid: 'coletor.pid', log: 'coletor.log', config: 'config.yaml', subindo: 'subindo.lock', instalado: 'instalado.json',
});
export const TETO = Object.freeze({
  aprendizado: 256 * 1024, ajustes: 64 * 1024, sugestoes: 16 * 1024, cursor: 4 * 1024, eventos: 16 * 1024,
  ligado: 4 * 1024, instalado: 4 * 1024, pid: 1024,
});

// Itens ajustáveis (§4.3 e §4.4, R3 e R9). `padrao` null = o valor do
// config.json (itens da guarda). `decimal`: anda de 0,1 em 0,1; os outros são
// inteiros.
export const ITENS = Object.freeze({
  'painel.intervaloS': Object.freeze({ padrao: 30, min: 30, max: 300, tipo: 'conforto' }),
  'painel.amarelo': Object.freeze({ padrao: 75, min: 60, max: 85, tipo: 'conforto' }),
  'painel.vermelho': Object.freeze({ padrao: 90, min: 85, max: 95, tipo: 'conforto' }),
  'previsao.pesoPerfil': Object.freeze({ padrao: 0, min: 0, max: 0.5, tipo: 'conforto', decimal: true }),
  'guarda.fableTetoPct': Object.freeze({ padrao: null, min: 70, max: 100, tipo: 'guarda', campo: 'fableTetoPct', janela: 'fable' }),
  'guarda.teto7d': Object.freeze({ padrao: null, min: 70, max: 100, tipo: 'guarda', campo: 'teto7d', janela: 'd7' }),
});

export function caminhos(dir) {
  const otel = path.join(dir, DIR_OTEL);
  const bin = path.join(otel, ARQ_OTEL.bin);
  return {
    otel,
    bin,
    ligado: path.join(otel, ARQ_OTEL.ligado),
    pid: path.join(otel, ARQ_OTEL.pid),
    log: path.join(otel, ARQ_OTEL.log),
    config: path.join(otel, ARQ_OTEL.config),
    subindo: path.join(otel, ARQ_OTEL.subindo),
    instalado: path.join(bin, ARQ_OTEL.instalado),
    aprendizado: path.join(dir, ARQ.aprendizado),
    ajustes: path.join(dir, ARQ.ajustes),
    sugestoes: path.join(dir, ARQ.sugestoes),
    cursor: path.join(dir, ARQ.cursor),
    eventos: path.join(dir, ARQ.eventos),
    trava: path.join(dir, ARQ.trava),
  };
}

// O valor, se vale para o item; undefined se não vale. null só nos itens da
// guarda (= o config.json).
export function valorDoItem(item, v) {
  if (typeof item !== 'string' || !Object.hasOwn(ITENS, item)) return undefined;
  const d = ITENS[item];
  if (v === null) return d.padrao === null ? null : undefined;
  if (!numeroFinito(v) || v < d.min || v > d.max) return undefined;
  if (d.decimal) return Math.abs(Math.round(v * 10) - v * 10) < 1e-9 ? v : undefined;
  return Number.isInteger(v) ? v : undefined;
}

export function chaveSugestao(s) {
  if (s.tipo === 'afrouxar') return `afrouxar:${s.item}`;
  return `modelo:${s.origem}|${s.de.modelo}|${s.de.effort}|${s.para.modelo}|${s.para.effort}`;
}

// Ligado = otel/ligado.json é arquivo regular (lstat, link não conta) de até
// 4 KiB. Desligado, que é o padrão, nada do aprendizado é lido (§11).
export function ligadoExiste(dir) {
  try {
    if (typeof dir !== 'string') return false;
    const info = fs.lstatSync(path.join(dir, DIR_OTEL, ARQ_OTEL.ligado), { throwIfNoEntry: false });
    return Boolean(info) && info.isFile() && info.size <= TETO.ligado;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Escrever `src/aprendizado/registro.js`**

```js
import fs from 'node:fs';
import { gravarJsonAtomico } from '../estado.js';
import { lerSemLink } from '../guarda/arquivo.js';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { apagar, esperar, fechar, instante, numeroFinito } from '../base.js';
import { ITENS, TETO, caminhos, ligadoExiste, valorDoItem } from './arquivos.js';
import { aprendizadoVazio, CAMPOS_MODELO, CHAVE_MODELO, JANELAS_MAX, LIMIARES, MODELOS_SEMANA_MAX, SEMANAS_MAX } from './agregar.js';

// Leitura e gravação dos arquivos do aprendizado (spec aprendizado §3.1,
// §4.7, §6 e R8): gravação atômica, lstat antes de ler (link é inválido),
// teto de bytes e reconstrução só dos campos conhecidos. Arquivo inválido
// volta vazio (§6). Nenhuma função lança.

const DIA_MS = 86_400_000;
const FUTURO_MS = 5 * 60_000;
// Bloqueio (desfazer, recusar) de até 8 dias; mais que isso é inválido e
// sai, então um relógio adiantado ou um arquivo forjado nunca trava um item
// para sempre (Foco de revisão 4).
export const BLOQUEIO_MAX_MS = 8 * DIA_MS;
const REGISTROS_MAX = 200;
const BLOQUEIOS_MAX = 50;
const SUGESTOES_MAX = 30;
const EVENTOS_MAX = 50;
const TRAVA_VENCIDA_MS = 120_000;
const TRAVA_TENTATIVAS = 5;
const TRAVA_ESPERA_MS = 50;
export const TIPOS_EVENTO_APR = Object.freeze([
  'porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-falhou', 'coletor-ausente', 'ajuste-fora', 'erro', 'sem-otel', 'orfao', 'telemetria-corrompida',
]);
export const MOTIVOS = Object.freeze([
  'fora-do-horario', 'horario-mudou', 'faixa-historico', 'perfil-por-hora', 'perfil-insuficiente', 'esgotou-2-de-3', 'sobra-4-semanas', 'desfazer',
]);
export const ORIGENS_REGISTRO = Object.freeze(['auto', 'aprovado', 'desfeito']);
export const ORIGEM_VALIDA = /^(?:principal|outro|sub|sub:[A-Za-z0-9._-]{1,40})$/;
export const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const EFFORT_OU_TRACO = new Set(['low', 'medium', 'high', 'xhigh', 'max', '-']);
const ID_AJUSTE = /^a\d{1,6}$/;
const ID_SUGESTAO = /^s\d{1,6}$/;
const CHAVE_BLOQUEIO = /^(?:(?:painel|previsao|guarda)\.[A-Za-z0-9]{1,30}|(?:afrouxar|modelo):[A-Za-z0-9._:|[\]-]{1,300})$/;
const CHAVE_ENV = /^(?:CLAUDE_CODE_ENABLE_TELEMETRY|OTEL_[A-Z_]{1,60})$/;
const VALOR_ENV = /^[A-Za-z0-9:/._-]{1,100}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lista = (v) => (Array.isArray(v) ? v : []);
const inteiroEntre = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const msValido = (n, agoraMs) => numeroFinito(n) && n >= 0 && n <= agoraMs + FUTURO_MS;
const diaLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { diaLocal };

function lerV1(arquivo, teto) {
  const l = lerSemLink(arquivo, teto);
  return l.ok && ehObjeto(l.valor) && l.valor.v === 1 ? l.valor : null;
}

// ------------------------------------------------------------ aprendizado.json

// (Não se chama janelaValida: esse nome é de util.js, test/casa-unica.test.js.)
function resumoDeJanela(j, agoraMs) {
  if (!ehObjeto(j) || !numeroFinito(j.reset) || j.reset <= 0 || j.reset > agoraMs + BLOQUEIO_MAX_MS) return null;
  if (!numeroFinito(j.max) || j.max < 0 || j.max > 100) return null;
  const cruzou = {};
  if (ehObjeto(j.cruzou)) {
    for (const T of LIMIARES) {
      const k = String(T);
      if (Object.hasOwn(j.cruzou, k) && msValido(j.cruzou[k], agoraMs)) cruzou[k] = j.cruzou[k];
    }
  }
  const esgotou = msValido(j.esgotou, agoraMs) ? j.esgotou : null;
  return { reset: j.reset, max: j.max, cruzou, esgotou, disparou: j.disparou === true };
}

export function validarAprendizado(v, agoraMs) {
  try {
    if (!ehObjeto(v) || v.v !== 1 || !msValido(v.desde, agoraMs)) return null;
    const ap = aprendizadoVazio(v.desde);
    ap.sessoes = inteiroEntre(v.sessoes, 0, 1_000_000) ? v.sessoes : 0;
    for (const s of lista(v.semanas).slice(-SEMANAS_MAX)) {
      if (!ehObjeto(s) || typeof s.inicio !== 'string' || !DIA_ISO.test(s.inicio) || !ehObjeto(s.modelos)) continue;
      if (!Array.isArray(s.ativo) || s.ativo.length !== 168 || ap.semanas.some((x) => x.inicio === s.inicio)) continue;
      const modelos = {};
      for (const [k, arr] of Object.entries(s.modelos).slice(0, MODELOS_SEMANA_MAX)) {
        if (!CHAVE_MODELO.test(k) || !Array.isArray(arr) || arr.length !== CAMPOS_MODELO.length) continue;
        if (arr.every((n) => numeroFinito(n) && n >= 0)) modelos[k] = [...arr];
      }
      ap.semanas.push({ inicio: s.inicio, modelos, ativo: s.ativo.map((m) => (numeroFinito(m) && m >= 0 && m <= 60 ? m : 0)) });
    }
    ap.semanas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
    for (const col of ['h5', 'd7']) {
      const r = ehObjeto(v.ritmo) ? v.ritmo[col] : undefined;
      if (Array.isArray(r) && r.length === 24 && r.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => numeroFinito(n) && n >= 0))) {
        ap.ritmo[col] = r.map((p) => [p[0], p[1]]);
      }
    }
    for (const tipo of Object.keys(JANELAS_MAX)) {
      const bruto = ehObjeto(v.janelas) ? v.janelas[tipo] : undefined;
      ap.janelas[tipo] = lista(bruto).map((j) => resumoDeJanela(j, agoraMs)).filter(Boolean).slice(-JANELAS_MAX[tipo]);
    }
    return ap;
  } catch {
    return null;
  }
}

export function lerAprendizado(dir, agoraMs) {
  return validarAprendizado(lerV1(caminhos(dir).aprendizado, TETO.aprendizado), agoraMs) ?? aprendizadoVazio(agoraMs);
}

// JSON compacto (os agregados são listas longas de números); acima do teto,
// as semanas mais antigas saem primeiro.
export function gravarAprendizado(dir, ap) {
  try {
    const copia = { ...ap, v: 1, semanas: [...ap.semanas] };
    while (Buffer.byteLength(JSON.stringify(copia)) > TETO.aprendizado && copia.semanas.length > 0) copia.semanas.shift();
    return { ok: gravarJsonAtomico(caminhos(dir).aprendizado, copia, { compacto: true }).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ ajustes.json

const vigentesPadrao = () => Object.fromEntries(Object.entries(ITENS).map(([k, d]) => [k, d.padrao]));
const perfilVazio = () => ({ horasAtivas: [0, 0, 0, 0, 0, 0, 0], ritmoHora: { h5: new Array(24).fill(null), d7: new Array(24).fill(null) } });

export function ajustesVazios() {
  return { v: 1, seq: 0, vigentes: vigentesPadrao(), registros: [], bloqueios: {}, perfil: perfilVazio() };
}

function registroValido(r, agoraMs) {
  if (!ehObjeto(r) || typeof r.id !== 'string' || !ID_AJUSTE.test(r.id) || typeof r.item !== 'string' || !Object.hasOwn(ITENS, r.item)) return null;
  const antes = valorDoItem(r.item, r.antes);
  const depois = valorDoItem(r.item, r.depois);
  if (antes === undefined || depois === undefined || !MOTIVOS.includes(r.motivo) || !ORIGENS_REGISTRO.includes(r.origem)) return null;
  const em = instante(r.em, agoraMs);
  return em === null ? null : { id: r.id, item: r.item, antes, depois, motivo: r.motivo, em: new Date(em).toISOString(), origem: r.origem };
}

function perfilValido(p) {
  const r = perfilVazio();
  if (!ehObjeto(p)) return r;
  if (Array.isArray(p.horasAtivas) && p.horasAtivas.length === 7 && p.horasAtivas.every((m) => inteiroEntre(m, 0, 0xffffff))) {
    r.horasAtivas = [...p.horasAtivas];
  }
  for (const col of ['h5', 'd7']) {
    const a = ehObjeto(p.ritmoHora) ? p.ritmoHora[col] : undefined;
    if (Array.isArray(a) && a.length === 24) r.ritmoHora[col] = a.map((x) => (numeroFinito(x) && x >= 0 && x <= 100 ? x : null));
  }
  return r;
}

export function validarAjustes(v, agoraMs) {
  try {
    if (!ehObjeto(v) || v.v !== 1) return null;
    const aj = ajustesVazios();
    aj.seq = inteiroEntre(v.seq, 0, 999_999) ? v.seq : 0;
    if (ehObjeto(v.vigentes)) {
      for (const item of Object.keys(ITENS)) {
        if (!Object.hasOwn(v.vigentes, item)) continue;
        const x = valorDoItem(item, v.vigentes[item]);
        if (x !== undefined) aj.vigentes[item] = x;
      }
    }
    if (aj.vigentes['painel.amarelo'] >= aj.vigentes['painel.vermelho']) {
      aj.vigentes['painel.amarelo'] = ITENS['painel.amarelo'].padrao;
      aj.vigentes['painel.vermelho'] = ITENS['painel.vermelho'].padrao;
    }
    for (const r of lista(v.registros).slice(-REGISTROS_MAX)) {
      const x = registroValido(r, agoraMs);
      if (x !== null) aj.registros.push(x);
    }
    if (ehObjeto(v.bloqueios)) {
      for (const [k, ate] of Object.entries(v.bloqueios).slice(0, BLOQUEIOS_MAX)) {
        if (CHAVE_BLOQUEIO.test(k) && numeroFinito(ate) && ate > agoraMs && ate <= agoraMs + BLOQUEIO_MAX_MS) aj.bloqueios[k] = ate;
      }
    }
    aj.perfil = perfilValido(v.perfil);
    // Um id novo nunca repete um antigo.
    for (const r of aj.registros) aj.seq = Math.max(aj.seq, Number(r.id.slice(1)));
    return aj;
  } catch {
    return null;
  }
}

export function lerAjustes(dir, agoraMs) {
  return validarAjustes(lerV1(caminhos(dir).ajustes, TETO.ajustes), agoraMs) ?? ajustesVazios();
}

// Teto de 64 KiB (§4.7): os registros mais antigos saem primeiro.
export function gravarAjustes(dir, aj) {
  try {
    const bloqueios = Object.fromEntries(Object.entries(aj.bloqueios).slice(-BLOQUEIOS_MAX));
    const copia = { ...aj, v: 1, bloqueios, registros: aj.registros.slice(-REGISTROS_MAX) };
    const grande = () => Buffer.byteLength(JSON.stringify(copia, null, 2)) > TETO.ajustes;
    while (grande() && copia.registros.length > 0) copia.registros.shift();
    // Sem registros e ainda grande: só os bloqueios podem ser; saem todos.
    if (grande()) copia.bloqueios = {};
    return { ok: gravarJsonAtomico(caminhos(dir).ajustes, copia).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ sugestoes.json

export function sugestoesVazias() {
  return { v: 1, seq: 0, lista: [] };
}

const modeloEffortValido = (x) => ehObjeto(x) && typeof x.modelo === 'string' && MODELO_VALIDO.test(x.modelo) && EFFORT_OU_TRACO.has(x.effort);

function sugestaoValida(s, agoraMs) {
  if (!ehObjeto(s) || typeof s.id !== 'string' || !ID_SUGESTAO.test(s.id) || !['pendente', 'aprovada'].includes(s.estado)) return null;
  const em = instante(s.em, agoraMs);
  if (em === null) return null;
  const base = { id: s.id, estado: s.estado, em: new Date(em).toISOString() };
  if (s.tipo === 'afrouxar') {
    if (typeof s.item !== 'string' || !Object.hasOwn(ITENS, s.item) || ITENS[s.item].tipo !== 'guarda') return null;
    const de = valorDoItem(s.item, s.de);
    const para = valorDoItem(s.item, s.para);
    if (!Number.isInteger(de) || !Number.isInteger(para) || para <= de) return null;
    return { ...base, tipo: 'afrouxar', item: s.item, de, para };
  }
  if (s.tipo === 'modelo') {
    if (typeof s.origem !== 'string' || !ORIGEM_VALIDA.test(s.origem) || !modeloEffortValido(s.de) || !modeloEffortValido(s.para)) return null;
    if (!numeroFinito(s.razao) || s.razao < 2 || s.razao > 1000) return null;
    if (![s.erroDe, s.erroPara].every((x) => numeroFinito(x) && x >= 0 && x <= 100)) return null;
    return {
      ...base, tipo: 'modelo', origem: s.origem,
      de: { modelo: s.de.modelo, effort: s.de.effort }, para: { modelo: s.para.modelo, effort: s.para.effort },
      razao: s.razao, erroDe: s.erroDe, erroPara: s.erroPara,
    };
  }
  return null;
}

export function lerSugestoes(dir, agoraMs) {
  try {
    const v = lerV1(caminhos(dir).sugestoes, TETO.sugestoes);
    if (v === null) return sugestoesVazias();
    const sug = { v: 1, seq: inteiroEntre(v.seq, 0, 999_999) ? v.seq : 0, lista: [] };
    for (const s of lista(v.lista).slice(-SUGESTOES_MAX)) {
      const x = sugestaoValida(s, agoraMs);
      if (x !== null && !sug.lista.some((y) => y.id === x.id)) sug.lista.push(x);
    }
    for (const s of sug.lista) sug.seq = Math.max(sug.seq, Number(s.id.slice(1)));
    return sug;
  } catch {
    return sugestoesVazias();
  }
}

// Acima do teto: saem primeiro as aprovadas mais antigas, depois as pendentes.
export function gravarSugestoes(dir, sug) {
  try {
    const copia = { v: 1, seq: sug.seq, lista: [...sug.lista] };
    const grande = () => copia.lista.length > SUGESTOES_MAX || Buffer.byteLength(JSON.stringify(copia, null, 2)) > TETO.sugestoes;
    while (grande() && copia.lista.length > 0) {
      const i = copia.lista.findIndex((s) => s.estado === 'aprovada');
      copia.lista.splice(i === -1 ? 0 : i, 1);
    }
    return { ok: gravarJsonAtomico(caminhos(dir).sugestoes, copia).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ cursor

export function cursorVazio() {
  return { v: 1, arquivo: null, historicoAte: 0, anuncio: { dia: null, ajustes: 0, sugestoes: 0 }, avisos: {} };
}

export function lerCursor(dir, agoraMs) {
  const c = cursorVazio();
  try {
    const v = lerV1(caminhos(dir).cursor, TETO.cursor);
    if (v === null) return c;
    const a = v.arquivo;
    if (ehObjeto(a) && typeof a.ino === 'string' && /^\d{1,40}$/.test(a.ino) && Number.isSafeInteger(a.pos) && a.pos >= 0) c.arquivo = { ino: a.ino, pos: a.pos };
    if (msValido(v.historicoAte, agoraMs)) c.historicoAte = v.historicoAte;
    if (ehObjeto(v.anuncio)) {
      if (typeof v.anuncio.dia === 'string' && DIA_ISO.test(v.anuncio.dia)) c.anuncio.dia = v.anuncio.dia;
      for (const k of ['ajustes', 'sugestoes']) if (inteiroEntre(v.anuncio[k], 0, 999_999)) c.anuncio[k] = v.anuncio[k];
    }
    if (ehObjeto(v.avisos)) {
      for (const t of TIPOS_EVENTO_APR) {
        if (Object.hasOwn(v.avisos, t) && typeof v.avisos[t] === 'string' && DIA_ISO.test(v.avisos[t])) c.avisos[t] = v.avisos[t];
      }
    }
    return c;
  } catch {
    return cursorVazio();
  }
}

export function gravarCursor(dir, c) {
  return { ok: gravarJsonAtomico(caminhos(dir).cursor, { ...c, v: 1 }).ok };
}

// ------------------------------------------------------------ eventos

export function lerEventosApr(dir, agoraMs) {
  try {
    const v = lerV1(caminhos(dir).eventos, TETO.eventos);
    const r = [];
    for (const e of lista(v?.eventos).slice(-EVENTOS_MAX)) {
      if (!ehObjeto(e) || !TIPOS_EVENTO_APR.includes(e.tipo)) continue;
      const t = instante(e.at, agoraMs);
      if (t !== null) r.push({ at: new Date(t).toISOString(), tipo: e.tipo });
    }
    return r;
  } catch {
    return [];
  }
}

export function anexarEventoApr(dir, tipo, agoraMs) {
  try {
    if (typeof dir !== 'string' || !TIPOS_EVENTO_APR.includes(tipo) || !numeroFinito(agoraMs)) return { ok: false };
    const eventos = [...lerEventosApr(dir, agoraMs), { at: new Date(agoraMs).toISOString(), tipo }].slice(-EVENTOS_MAX);
    return { ok: gravarJsonAtomico(caminhos(dir).eventos, { v: 1, eventos }).ok };
  } catch {
    return { ok: false };
  }
}

// ------------------------------------------------------------ ligado.json (R8)

export function lerLigado(dir) {
  try {
    const v = lerV1(caminhos(dir).ligado, TETO.ligado);
    if (v === null || !ehObjeto(v.chaves) || typeof v.criouEnv !== 'boolean') return null;
    const chaves = {};
    for (const [k, x] of Object.entries(v.chaves).slice(0, 20)) {
      if (CHAVE_ENV.test(k) && typeof x === 'string' && VALOR_ENV.test(x)) chaves[k] = x;
    }
    return { chaves, criouEnv: v.criouEnv };
  } catch {
    return null;
  }
}

export function gravarLigado(dir, { chaves, criouEnv }, agoraMs) {
  try {
    fs.mkdirSync(caminhos(dir).otel, { recursive: true });
    return { ok: gravarJsonAtomico(caminhos(dir).ligado, { v: 1, chaves, criouEnv, em: new Date(agoraMs).toISOString() }).ok };
  } catch {
    return { ok: false };
  }
}

export function apagarLigado(dir) {
  apagar(caminhos(dir).ligado);
}

// ------------------------------------------------------------ trava

// Um passo por vez (Foco de revisão 3): arquivo criado com 'wx'. Trava com
// mais de 2 min pelo mtime é de um processo morto e é retomada. Até 5
// tentativas com 50 ms entre elas; depois, 'ocupada'.
export function pegarTrava(dir) {
  const arq = caminhos(dir).trava;
  for (let i = 0; i < TRAVA_TENTATIVAS; i++) {
    try {
      fechar(fs.openSync(arq, 'wx'));
      return { ok: true, soltar: () => apagar(arq) };
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, motivo: 'erro' };
      try {
        const info = fs.lstatSync(arq);
        if (info.isFile() && Date.now() - info.mtimeMs >= TRAVA_VENCIDA_MS) {
          apagar(arq);
          continue;
        }
      } catch {
        continue;
      }
      if (i < TRAVA_TENTATIVAS - 1) esperar(TRAVA_ESPERA_MS);
    }
  }
  return { ok: false, motivo: 'ocupada' };
}

// ------------------------------------------------------------ consumidores

// Os vigentes e o perfil para o painel e a previsão, ou null quando o
// aprendizado está desligado ou o ajustes.json não vale: o consumidor usa os
// valores de hoje (§11).
export function ajustesParaConsumo(dir, agoraMs) {
  try {
    if (!ligadoExiste(dir)) return null;
    const aj = validarAjustes(lerV1(caminhos(dir).ajustes, TETO.ajustes), agoraMs);
    return aj === null ? null : { vigentes: aj.vigentes, perfil: aj.perfil };
  } catch {
    return null;
  }
}

export function horaAtiva(perfil, ms) {
  const d = new Date(ms);
  return ((perfil.horasAtivas[(d.getDay() + 6) % 7] >>> d.getHours()) & 1) === 1;
}

// O intervalo aprendido fora das horas ativas (R9), em ms; null = o de hoje.
export function intervaloDoPainelMs(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  if (a === null) return null;
  const s = a.vigentes['painel.intervaloS'];
  if (s === ITENS['painel.intervaloS'].padrao || horaAtiva(a.perfil, agoraMs)) return null;
  return s * 1000;
}

export function faixasDoPainel(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  return a === null
    ? { amarelo: ITENS['painel.amarelo'].padrao, vermelho: ITENS['painel.vermelho'].padrao }
    : { amarelo: a.vigentes['painel.amarelo'], vermelho: a.vigentes['painel.vermelho'] };
}

export function perfilDaPrevisao(dir, agoraMs) {
  const a = ajustesParaConsumo(dir, agoraMs);
  if (a === null || !(a.vigentes['previsao.pesoPerfil'] > 0)) return null;
  return { peso: a.vigentes['previsao.pesoPerfil'], h5: a.perfil.ritmoHora.h5, d7: a.perfil.ritmoHora.d7 };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/aprendizado-registro.test.js test/aprendizado-fronteiras.test.js test/casa-unica.test.js`
Expected: PASS (o caso do link pode sair como `skip`).

- [ ] **Step 6: Commit**

```powershell
git add -- src/aprendizado/arquivos.js src/aprendizado/registro.js test/aprendizado-registro.test.js
git commit -m @'
feat: learning files, items, lock and consumer readers (spec aprendizado 4.7, 6, 11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/arquivos.js src/aprendizado/registro.js test/aprendizado-registro.test.js
```

---

### Task 5: O decisor (`ajustar.js`): conforto, aperto, sugestões, `desfazer`/`aprovar`/`recusar` (§4.2–§4.5, §4.7, §6 "fora dos limites", §8 propriedade e relógio falso)

**Files:**
- Create: `src/aprendizado/ajustar.js`
- Test: `test/aprendizado-ajustar.test.js`

**Interfaces:**
- Consome: `ITENS`, `valorDoItem`, `chaveSugestao` (Task 4, `arquivos.js`); `perfilDe`, `CAMPOS_MODELO`, `DURACAO_JANELA_MS`, `LIMIARES` (Task 3); os tipos `Aprendizado`, `Ajustes`, `Sugestoes` (Tasks 3 e 4). Nas fixtures do teste: `aprendizadoVazio`, `agregarRegistros`, `inicioSemana` (Task 3), `ajustesVazios`, `sugestoesVazias` (Task 4).
- Produz (sem E/S; relógio por parâmetro; mudam `aj`/`sug` recebidos e os devolvem):
  - `ajustar({ ap, aj, sug, config, agoraMs }) → { aj, sug, novos: { ajustes: RegistroAjuste[], sugestoes: Sugestao[] }, fora: string[] }` — `config` é o `ConfigGuarda` **do `config.json` puro** (`lerConfigGuardaBase`, Task 6); `fora` são os itens cujo ajuste calculado saiu dos limites (o chamador grava o evento `ajuste-fora`).
  - `desfazer(aj, id | null, agoraMs) → { ok: true, aj, registro } | { ok: false, motivo: 'nada' | 'nao-achou' | 'nao-e-o-ultimo' }`
  - `aprovar(aj, sug, id, config, agoraMs) → { ok: true, tipo: 'afrouxar', aj, sug, registro } | { ok: true, tipo: 'modelo', aj, sug, sugestao } | { ok: false, motivo: 'nao-achou' } | { ok: false, motivo: 'mudou', aj, sug }`
  - `recusar(sug, aj, id, agoraMs) → { ok: true, aj, sug, sugestao } | { ok: false, motivo: 'nao-achou' }`
  - constantes `PISO_MS`, `PISO_SESSOES`, `AMOSTRAS_MIN`, `UM_AJUSTE_MS`, `BLOQUEIO_MS`, `PASSO_PONTOS`, `PISO_GUARDA`, `SOBRA_LIMITE`, `INTERVALO_FORA_S`, `ANTECEDENCIA_MS`, `JANELAS_FAIXA_MIN`, `PESO_ALVO`, `PESO_PASSO`, `COBERTURA_MIN`, `SEMANAS_MODELO`

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-ajustar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustar, desfazer, aprovar, recusar } from '../src/aprendizado/ajustar.js';
import { aprendizadoVazio, agregarRegistros, inicioSemana, LIMIARES } from '../src/aprendizado/agregar.js';
import { ajustesVazios, sugestoesVazias } from '../src/aprendizado/registro.js';
import { ITENS, valorDoItem } from '../src/aprendizado/arquivos.js';

// Decisor do aprendizado (spec aprendizado §4 e §8): puro, relógio por
// parâmetro. O teste de propriedade prova que nenhum ajuste automático
// afrouxa a guarda e que todo ajuste de conforto fica nos limites de §4.3.

const H = 3_600_000;
const D = 24 * H;
const M = 60_000;
const AGORA = new Date(2026, 9, 20, 15, 0).getTime(); // terça-feira, 15h local
const CONFIG = Object.freeze({ teto7d: 85, fableTetoPct: 90 });
const iso = (ms) => new Date(ms).toISOString();
const janela = (reset, max, extra = {}) => ({ reset, max, cruzou: {}, esgotou: null, disparou: false, ...extra });

// 10 dias de dados, 25 sessões, ativo às terças 10h (fora dela o intervalo sobe).
function apMaduro() {
  const ap = aprendizadoVazio(AGORA - 10 * D);
  ap.sessoes = 25;
  agregarRegistros(ap, [{ t: 'ativo', em: new Date(2026, 9, 20, 10).getTime(), segundos: 600 }]);
  return ap;
}
const rodar = (ap, aj, sug, agoraMs, config = CONFIG) => ajustar({ ap, aj, sug, config, agoraMs });

test('piso de §4.2: sem 7 dias ou sem 20 sessões nada muda, mas o perfil é atualizado', () => {
  const ap = apMaduro();
  ap.desde = AGORA - 6 * D;
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(r.novos, { ajustes: [], sugestoes: [] });
  assert.equal(r.aj.perfil.horasAtivas[1], 1 << 10);
  ap.desde = AGORA - 7 * D;
  ap.sessoes = 19;
  r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.novos.ajustes.length, 0);
  ap.sessoes = 20;
  r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(
    r.novos.ajustes.map((x) => [x.id, x.item, x.antes, x.depois, x.motivo, x.origem, x.em]),
    [['a1', 'painel.intervaloS', 30, 60, 'fora-do-horario', 'auto', iso(AGORA)]],
  );
});

test('um ajuste por item a cada 24 h, com passo de dobro até o alvo de 120 s', () => {
  const ap = apMaduro();
  const sug = sugestoesVazias();
  let r = rodar(ap, ajustesVazios(), sug, AGORA);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 60);
  r = rodar(ap, r.aj, sug, AGORA + 23 * H);
  assert.equal(r.novos.ajustes.length, 0);
  r = rodar(ap, r.aj, sug, AGORA + 24 * H);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 120);
  r = rodar(ap, r.aj, sug, AGORA + 48 * H);
  assert.equal(r.novos.ajustes.length, 0);
});

test('desfazer volta ao anterior, grava origem desfeito e bloqueia o item por 7 dias', () => {
  const ap = apMaduro();
  const sug = sugestoesVazias();
  const { aj } = rodar(ap, ajustesVazios(), sug, AGORA);
  const d = desfazer(aj, null, AGORA + H);
  assert.equal(d.ok, true);
  assert.deepEqual(
    [d.registro.id, d.registro.item, d.registro.antes, d.registro.depois, d.registro.motivo, d.registro.origem],
    ['a2', 'painel.intervaloS', 60, 30, 'desfazer', 'desfeito'],
  );
  assert.equal(d.aj.vigentes['painel.intervaloS'], 30);
  assert.equal(d.aj.bloqueios['painel.intervaloS'], AGORA + H + 7 * D);
  assert.deepEqual(desfazer(d.aj, null, AGORA + 2 * H), { ok: false, motivo: 'nada' });
  let r = rodar(ap, d.aj, sug, AGORA + 6 * D);
  assert.equal(r.novos.ajustes.length, 0);
  r = rodar(ap, r.aj, sug, AGORA + H + 7 * D);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 60);
  assert.deepEqual(desfazer(r.aj, 'a1', AGORA + 8 * D), { ok: false, motivo: 'nao-e-o-ultimo' });
  assert.deepEqual(desfazer(r.aj, 'a99', AGORA + 8 * D), { ok: false, motivo: 'nao-achou' });
  assert.deepEqual(desfazer(ajustesVazios(), null, AGORA), { ok: false, motivo: 'nada' });
});

test('faixas de §4.3: amarelo e vermelho vão ao limiar com antecedência mediana suficiente; sem limiar possível, ajuste-fora', () => {
  const ap = apMaduro();
  const antecedencia = { 60: 120, 65: 90, 70: 50, 75: 30, 80: 20, 85: 16, 90: 10, 95: 5 };
  for (let i = 5; i >= 1; i--) {
    const reset = AGORA - i * 5 * H;
    const esg = reset - H;
    const cruzou = Object.fromEntries(Object.entries(antecedencia).map(([T, min]) => [T, esg - min * M]));
    ap.janelas.h5.push(janela(reset, 100, { esgotou: esg, cruzou }));
  }
  const r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.aj.vigentes['painel.amarelo'], 70);
  assert.equal(r.aj.vigentes['painel.vermelho'], 85);
  assert.ok(r.novos.ajustes.filter((x) => x.item.startsWith('painel.') && x.item !== 'painel.intervaloS').every((x) => x.motivo === 'faixa-historico'));

  const curto = apMaduro();
  for (let i = 5; i >= 1; i--) {
    const reset = AGORA - i * 5 * H;
    const esg = reset - H;
    curto.janelas.h5.push(janela(reset, 100, { esgotou: esg, cruzou: Object.fromEntries(LIMIARES.map((T) => [String(T), esg - 5 * M])) }));
  }
  const f = rodar(curto, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(f.fora.sort(), ['painel.amarelo', 'painel.vermelho']);
  assert.equal(f.aj.vigentes['painel.amarelo'], 75);
  assert.equal(f.aj.vigentes['painel.vermelho'], 90);
});

test('peso do perfil por hora: sobe 0,1 por dia com cobertura ≥ 80%, desce sem ela', () => {
  const ap = apMaduro();
  ap.ritmo.h5[10] = [3, 3];
  const sug = sugestoesVazias();
  let r = rodar(ap, ajustesVazios(), sug, AGORA);
  assert.equal(r.aj.vigentes['previsao.pesoPerfil'], 0.1);
  r = rodar(ap, r.aj, sug, AGORA + D);
  assert.equal(r.aj.vigentes['previsao.pesoPerfil'], 0.2);
  ap.ritmo.h5[10] = [0, 0];
  r = rodar(ap, r.aj, sug, AGORA + 2 * D);
  const reg = r.novos.ajustes.find((x) => x.item === 'previsao.pesoPerfil');
  assert.deepEqual([reg.antes, reg.depois, reg.motivo], [0.2, 0.1, 'perfil-insuficiente']);
});

test('guarda de §4.4: aperta −5 com 2 de 3 semanas esgotadas, uma vez por evidência; piso 70 dá ajuste-fora', () => {
  const ap = apMaduro();
  ap.janelas.d7 = [
    janela(AGORA - 15 * D, 100, { esgotou: AGORA - 16 * D }),
    janela(AGORA - 8 * D, 60),
    janela(AGORA - D, 100, { esgotou: AGORA - 2 * D }),
  ];
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  const reg = r.novos.ajustes.find((x) => x.item === 'guarda.teto7d');
  assert.deepEqual([reg.antes, reg.depois, reg.motivo, reg.origem], [null, 80, 'esgotou-2-de-3', 'auto']);
  r = rodar(ap, r.aj, r.sug, AGORA + 2 * D);
  assert.equal(r.aj.vigentes['guarda.teto7d'], 80);
  assert.equal(r.novos.ajustes.filter((x) => x.item === 'guarda.teto7d').length, 0);
  const p = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA, { ...CONFIG, teto7d: 72 });
  assert.equal(p.aj.vigentes['guarda.teto7d'], null);
  assert.ok(p.fora.includes('guarda.teto7d'));
});

test('guarda de §4.4: afrouxar é só sugestão, com 4 semanas de sobra depois do aperto; aprovar vai até o config.json', () => {
  const ap = apMaduro();
  const aj = ajustesVazios();
  aj.vigentes['guarda.teto7d'] = 80;
  aj.seq = 1;
  aj.registros.push({ id: 'a1', item: 'guarda.teto7d', antes: null, depois: 80, motivo: 'esgotou-2-de-3', em: iso(AGORA - 30 * D), origem: 'auto' });
  ap.janelas.d7 = [22, 15, 8, 1].map((n) => janela(AGORA - n * D, 50));
  let r = rodar(ap, aj, sugestoesVazias(), AGORA);
  assert.equal(r.aj.vigentes['guarda.teto7d'], 80);
  assert.deepEqual(
    r.novos.sugestoes.map((s) => [s.id, s.tipo, s.item, s.de, s.para, s.estado]),
    [['s1', 'afrouxar', 'guarda.teto7d', 80, 85, 'pendente']],
  );
  r = rodar(ap, r.aj, r.sug, AGORA + D);
  assert.equal(r.novos.sugestoes.length, 0);

  const comDisparo = structuredClone(ap);
  comDisparo.janelas.d7[3].disparou = true;
  assert.equal(rodar(comDisparo, structuredClone(aj), sugestoesVazias(), AGORA).novos.sugestoes.length, 0);

  const acima = aprovar(structuredClone(r.aj), structuredClone(r.sug), 's1', { ...CONFIG, teto7d: 90 }, AGORA + D);
  assert.equal(acima.aj.vigentes['guarda.teto7d'], 85);
  const a = aprovar(r.aj, r.sug, 's1', CONFIG, AGORA + D);
  assert.equal(a.ok, true);
  assert.equal(a.tipo, 'afrouxar');
  assert.deepEqual([a.registro.antes, a.registro.depois, a.registro.motivo, a.registro.origem], [80, null, 'sobra-4-semanas', 'aprovado']);
  assert.equal(a.aj.vigentes['guarda.teto7d'], null);
  assert.deepEqual(a.sug.lista, []);
  assert.deepEqual(aprovar(a.aj, a.sug, 's1', CONFIG, AGORA + D), { ok: false, motivo: 'nao-achou' });
});

test('sugestão de modelo de §4.5: mesma origem, 20 amostras, custo ≤ metade, erros até 2 pontos pior; nunca aplicada', () => {
  const ap = apMaduro();
  const s = ap.semanas[0];
  const linha = (pedidos, custo, erros, ferramentas, falhas) => [pedidos, custo, 0, 0, 0, 0, 0, 0, 0, erros, ferramentas, falhas];
  s.modelos['claude-opus-5-5|high|sub:revisor'] = linha(40, 40, 1, 10, 0);
  s.modelos['claude-sonnet-5-5|high|sub:revisor'] = linha(25, 7.5, 1, 10, 0);
  s.modelos['claude-haiku-5|-|sub:revisor'] = linha(19, 1, 0, 0, 0);
  s.modelos['claude-sonnet-5-5|high|principal'] = linha(30, 3, 0, 0, 0);
  const vigentesAntes = { ...ajustesVazios().vigentes };
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.novos.sugestoes.length, 1);
  const x = r.novos.sugestoes[0];
  assert.deepEqual({ ...x, em: undefined }, {
    id: 's1', tipo: 'modelo', origem: 'sub:revisor', estado: 'pendente', em: undefined,
    de: { modelo: 'claude-opus-5-5', effort: 'high' }, para: { modelo: 'claude-sonnet-5-5', effort: 'high' },
    razao: 3.3, erroDe: 2.5, erroPara: 4,
  });
  assert.deepEqual({ ...r.aj.vigentes, 'painel.intervaloS': 30 }, vigentesAntes);
  r = rodar(ap, r.aj, r.sug, AGORA + D);
  assert.equal(r.novos.sugestoes.length, 0);

  const rec = recusar(r.sug, r.aj, 's1', AGORA + D);
  assert.equal(rec.ok, true);
  assert.equal(rec.aj.bloqueios['modelo:sub:revisor|claude-opus-5-5|high|claude-sonnet-5-5|high'], AGORA + 8 * D);
  assert.deepEqual(rec.sug.lista, []);
  r = rodar(ap, rec.aj, rec.sug, AGORA + 2 * D);
  assert.equal(r.novos.sugestoes.length, 0);
  r = rodar(ap, r.aj, r.sug, AGORA + 8 * D + 1);
  assert.equal(r.novos.sugestoes[0].id, 's2');

  const n = r.aj.registros.length;
  const ap2 = aprovar(r.aj, r.sug, 's2', CONFIG, AGORA + 8 * D + 2);
  assert.deepEqual([ap2.ok, ap2.tipo, ap2.sug.lista[0].estado, ap2.aj.registros.length], [true, 'modelo', 'aprovada', n]);
  r = rodar(ap, ap2.aj, ap2.sug, AGORA + 9 * D);
  assert.equal(r.novos.sugestoes.length, 0);
  assert.deepEqual(recusar(r.sug, r.aj, 's2', AGORA + 9 * D), { ok: false, motivo: 'nao-achou' });
});

// Gerador com semente fixa (mulberry32): o mesmo conjunto de casos em toda máquina.
function mulberry32(semente) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const escolher = (r, lista) => lista[Math.floor(r() * lista.length)];
const inteiro = (r, min, max) => min + Math.floor(r() * (max - min + 1));

function casoAleatorio(r) {
  const agoraMs = AGORA + inteiro(r, 0, 60) * D + inteiro(r, 0, 23) * H;
  const ap = aprendizadoVazio(agoraMs - inteiro(r, 0, 30) * D);
  ap.sessoes = inteiro(r, 0, 60);
  const semana = { inicio: inicioSemana(agoraMs), modelos: {}, ativo: Array.from({ length: 168 }, () => (r() < 0.2 ? inteiro(r, 0, 60) : 0)) };
  for (let i = 0; i < 4; i++) {
    semana.modelos[`m${i}|${escolher(r, ['high', 'max', '-'])}|${escolher(r, ['principal', 'sub:x'])}`] = [
      inteiro(r, 0, 60), r() * 50, 0, 0, 0, 0, 0, 0, 0, inteiro(r, 0, 5), inteiro(r, 0, 20), inteiro(r, 0, 5),
    ];
  }
  ap.semanas.push(semana);
  for (let h = 0; h < 24; h++) ap.ritmo.h5[h] = [r(), inteiro(r, 0, 5)];
  for (const tipo of ['h5', 'd7', 'fable']) {
    const dur = tipo === 'h5' ? 5 * H : 7 * D;
    for (let i = 8; i >= 0; i--) {
      const reset = agoraMs - i * dur + inteiro(r, 0, 59) * M;
      const max = inteiro(r, 0, 100);
      const cruzou = {};
      for (const T of LIMIARES) if (max >= T) cruzou[String(T)] = reset - dur + Math.floor(r() * dur * 0.9);
      ap.janelas[tipo].push(janela(reset, max, { cruzou, esgotou: max >= 100 ? reset - inteiro(r, 1, 300) * M : null, disparou: r() < 0.2 }));
    }
  }
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = escolher(r, [30, 45, 60, 120, 240, 300]);
  aj.vigentes['painel.amarelo'] = escolher(r, [60, 65, 70, 75, 80, 85]);
  aj.vigentes['painel.vermelho'] = escolher(r, [85, 90, 95]);
  if (aj.vigentes['painel.amarelo'] >= aj.vigentes['painel.vermelho']) aj.vigentes['painel.vermelho'] = 90;
  aj.vigentes['previsao.pesoPerfil'] = escolher(r, [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  for (const item of ['guarda.teto7d', 'guarda.fableTetoPct']) aj.vigentes[item] = r() < 0.5 ? null : inteiro(r, 70, 100);
  if (r() < 0.5) {
    const item = escolher(r, Object.keys(ITENS));
    aj.seq = 1;
    aj.registros.push({ id: 'a1', item, antes: aj.vigentes[item], depois: aj.vigentes[item], motivo: 'faixa-historico', em: iso(agoraMs - inteiro(r, 0, 72) * H), origem: 'auto' });
  }
  const config = { teto7d: inteiro(r, 50, 100), fableTetoPct: inteiro(r, 50, 100) };
  return { ap, aj, config, agoraMs };
}

const efetivo = (vig, cfg) => (vig === null ? cfg : Math.min(vig, cfg));

test('propriedade de §8 (1.000 casos): nunca aperto acima do config.json, nunca afrouxamento automático, conforto nos limites', () => {
  const r = mulberry32(20261020);
  for (let caso = 0; caso < 1000; caso++) {
    const { ap, aj, config, agoraMs } = casoAleatorio(r);
    const antes = structuredClone(aj.vigentes);
    const res = ajustar({ ap, aj, sug: sugestoesVazias(), config, agoraMs });
    const itens = res.novos.ajustes.map((x) => x.item);
    assert.equal(new Set(itens).size, itens.length, `caso ${caso}: mais de um ajuste por item`);
    for (const x of res.novos.ajustes) {
      assert.equal(x.origem, 'auto', `caso ${caso}`);
      const d = ITENS[x.item];
      if (d.tipo === 'guarda') {
        const cfg = config[d.campo];
        assert.ok(Number.isInteger(x.depois) && x.depois >= 70 && x.depois <= cfg, `caso ${caso}: aperto ${x.depois} > ${cfg}`);
        assert.ok(x.depois < efetivo(x.antes, cfg), `caso ${caso}: ${x.item} afrouxou`);
      } else {
        assert.notEqual(valorDoItem(x.item, x.depois), undefined, `caso ${caso}: ${x.item}=${x.depois} fora dos limites`);
        if (x.item === 'painel.intervaloS') assert.ok(x.depois <= x.antes * 2 && x.depois >= Math.ceil(x.antes / 2), `caso ${caso}`);
        else if (x.item === 'previsao.pesoPerfil') assert.ok(Math.abs(x.depois - x.antes) <= 0.1 + 1e-9, `caso ${caso}`);
        else assert.ok(Math.abs(x.depois - x.antes) <= 5, `caso ${caso}`);
      }
    }
    for (const item of ['guarda.teto7d', 'guarda.fableTetoPct']) {
      const cfg = config[ITENS[item].campo];
      assert.ok(efetivo(res.aj.vigentes[item], cfg) <= efetivo(antes[item], cfg), `caso ${caso}: ${item} afrouxou`);
    }
    for (const item of ['painel.intervaloS', 'painel.amarelo', 'painel.vermelho', 'previsao.pesoPerfil']) {
      assert.notEqual(valorDoItem(item, res.aj.vigentes[item]), undefined, `caso ${caso}: ${item}`);
    }
    assert.ok(res.aj.vigentes['painel.amarelo'] < res.aj.vigentes['painel.vermelho'], `caso ${caso}: amarelo >= vermelho`);
    for (const s of res.novos.sugestoes) {
      if (s.tipo !== 'afrouxar') continue;
      assert.equal(s.de, res.aj.vigentes[s.item], `caso ${caso}`);
      assert.ok(s.para <= config[ITENS[s.item].campo] && s.para > s.de, `caso ${caso}: sugestão acima do config.json`);
    }
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-ajustar.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/ajustar.js`.

- [ ] **Step 3: Escrever `src/aprendizado/ajustar.js`**

```js
import { ITENS, chaveSugestao, valorDoItem } from './arquivos.js';
import { perfilDe, CAMPOS_MODELO, DURACAO_JANELA_MS, LIMIARES } from './agregar.js';

// Decisor do aprendizado (spec aprendizado §4.2 a §4.5 e §4.7). Puro: sem
// E/S e com o relógio por parâmetro. O conforto se ajusta sozinho dentro de
// ITENS; a guarda só aperta sozinha (−5, piso 70, nunca acima do
// config.json); afrouxar e trocar de modelo são sempre sugestões. Um valor
// calculado fora dos limites é descartado e volta em `fora` (§6), para o
// chamador gravar o evento ajuste-fora. O teste de propriedade de §8 prova
// as três garantias.

const M = 60_000;
const H = 60 * M;
const DIA_MS = 24 * H;
export const PISO_MS = 7 * DIA_MS;
export const PISO_SESSOES = 20;
export const AMOSTRAS_MIN = 20;
export const UM_AJUSTE_MS = DIA_MS;
export const BLOQUEIO_MS = 7 * DIA_MS;
export const PASSO_PONTOS = 5;
export const PISO_GUARDA = 70;
// "Sobrou > 30%" (§4.4): o máximo da janela ficou abaixo de 70%.
export const SOBRA_LIMITE = 70;
// Fora das horas ativas, até 120 s (§4.3 e R9).
export const INTERVALO_FORA_S = 120;
// Antecedência mediana entre cruzar a faixa e esgotar (§4.3; vermelho: R9).
export const ANTECEDENCIA_MS = Object.freeze({
  'painel.amarelo': Object.freeze({ h5: 45 * M, d7: 24 * H }),
  'painel.vermelho': Object.freeze({ h5: 15 * M, d7: 8 * H }),
});
// Janelas esgotadas mínimas para a faixa se mover por aquele tipo.
export const JANELAS_FAIXA_MIN = Object.freeze({ h5: 5, d7: 3 });
export const PESO_ALVO = 0.5;
export const PESO_PASSO = 0.1;
export const COBERTURA_MIN = 0.8;
export const SEMANAS_MODELO = 4;

const redondo1 = (n) => Math.round(n * 10) / 10;

function ultimoRegistro(aj, item) {
  for (let i = aj.registros.length - 1; i >= 0; i--) if (aj.registros[i].item === item) return aj.registros[i];
  return null;
}
const instanteDoUltimo = (aj, item) => {
  const r = ultimoRegistro(aj, item);
  return r === null ? Number.NEGATIVE_INFINITY : Date.parse(r.em);
};
const bloqueado = (aj, chave, agoraMs) => Object.hasOwn(aj.bloqueios, chave) && aj.bloqueios[chave] > agoraMs;

// No máximo um ajuste por item a cada 24 h (§4.3), e nada durante o
// bloqueio de 7 dias do desfazer (§4.7). Vale para qualquer origem.
const podeMudar = (aj, item, agoraMs) => !bloqueado(aj, item, agoraMs) && agoraMs - instanteDoUltimo(aj, item) >= UM_AJUSTE_MS;

function registrar(aj, item, depois, motivo, origem, agoraMs) {
  aj.seq += 1;
  const r = { id: `a${aj.seq}`, item, antes: aj.vigentes[item], depois, motivo, em: new Date(agoraMs).toISOString(), origem };
  aj.registros.push(r);
  aj.vigentes[item] = depois;
  return r;
}

// Passo máximo (§4.3): dobro ou metade no intervalo, 0,1 no peso (R9), 5
// pontos no resto; nunca passa do alvo.
function passoPara(item, atual, alvo) {
  if (item === 'painel.intervaloS') return alvo > atual ? Math.min(alvo, atual * 2) : Math.max(alvo, Math.ceil(atual / 2));
  if (item === 'previsao.pesoPerfil') return redondo1(alvo > atual ? Math.min(alvo, atual + PESO_PASSO) : Math.max(alvo, atual - PESO_PASSO));
  return alvo > atual ? Math.min(alvo, atual + PASSO_PONTOS) : Math.max(alvo, atual - PASSO_PONTOS);
}

function mediana(xs) {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// O maior limiar dentro da faixa do item em que, em cada tipo de janela com
// dados suficientes, a antecedência mediana até esgotar é a pedida. null =
// sem dados; { fora: true } = nenhum limiar dentro da faixa serve (o ideal
// fica abaixo do mínimo: descartado, §6).
function alvoDaFaixa(ap, item, agoraMs) {
  const d = ITENS[item];
  let comDados = false;
  for (let T = d.max; T >= d.min; T -= PASSO_PONTOS) {
    if (!LIMIARES.includes(T)) continue;
    let algum = false;
    let vale = true;
    for (const tipo of ['h5', 'd7']) {
      const leads = ap.janelas[tipo]
        .filter((j) => j.reset <= agoraMs && j.esgotou !== null && Object.hasOwn(j.cruzou, String(T)))
        .map((j) => j.esgotou - j.cruzou[String(T)]);
      if (leads.length < JANELAS_FAIXA_MIN[tipo]) continue;
      algum = true;
      if (mediana(leads) < ANTECEDENCIA_MS[item][tipo]) vale = false;
    }
    comDados ||= algum;
    if (algum && vale) return { alvo: T };
  }
  return comDados ? { fora: true } : null;
}

// Fração das horas ativas (dia × hora) cuja hora do dia tem ritmo típico.
function cobertura(perfil) {
  let ativas = 0;
  let cobertas = 0;
  for (let dia = 0; dia < 7; dia++) {
    for (let h = 0; h < 24; h++) {
      if (((perfil.horasAtivas[dia] >>> h) & 1) === 0) continue;
      ativas += 1;
      if (perfil.ritmoHora.h5[h] !== null) cobertas += 1;
    }
  }
  return ativas === 0 ? 0 : cobertas / ativas;
}

// Guarda (§4.4). Aperto: −5 a partir do valor efetivo (min(config,
// vigente)), piso 70, quando 2 das 3 últimas janelas concluídas esgotaram e
// o esgotamento mais novo é posterior à última mudança do item (a mesma
// evidência nunca aperta duas vezes). Afrouxar: só sugestão, +5 até o
// config.json, com 4 janelas inteiras depois da última mudança, todas abaixo
// de 70%, sem esgotar e sem disparo.
function guarda(ap, aj, sug, config, agoraMs, novos, fora) {
  for (const item of ['guarda.fableTetoPct', 'guarda.teto7d']) {
    const d = ITENS[item];
    const cfg = config?.[d.campo];
    if (!Number.isInteger(cfg)) continue;
    const vig = aj.vigentes[item];
    const ef = vig === null ? cfg : Math.min(vig, cfg);
    const desdeMs = instanteDoUltimo(aj, item);
    const concluidas = ap.janelas[d.janela].filter((j) => j.reset <= agoraMs);
    const ult3 = concluidas.slice(-3);
    const esgotadas = ult3.filter((j) => j.esgotou !== null);
    if (ult3.length === 3 && esgotadas.length >= 2 && Math.max(...esgotadas.map((j) => j.esgotou)) > desdeMs) {
      if (!podeMudar(aj, item, agoraMs)) continue;
      const novo = ef - PASSO_PONTOS;
      if (novo < PISO_GUARDA || valorDoItem(item, novo) === undefined) fora.push(item);
      else novos.ajustes.push(registrar(aj, item, novo, 'esgotou-2-de-3', 'auto', agoraMs));
      continue;
    }
    const ult4 = concluidas.slice(-4);
    const sobrou = ult4.length === 4 && ult4.every((j) => j.reset - DURACAO_JANELA_MS[d.janela] >= desdeMs
      && j.max < SOBRA_LIMITE && j.esgotou === null && !j.disparou);
    if (vig === null || vig >= cfg || !sobrou) continue;
    const s = { tipo: 'afrouxar', item, de: vig, para: Math.min(cfg, vig + PASSO_PONTOS) };
    if (bloqueado(aj, chaveSugestao(s), agoraMs) || sug.lista.some((x) => x.tipo === 'afrouxar' && x.item === item)) continue;
    sug.seq += 1;
    const nova = { id: `s${sug.seq}`, ...s, estado: 'pendente', em: new Date(agoraMs).toISOString() };
    sug.lista.push(nova);
    novos.sugestoes.push(nova);
  }
}

// Sugestão de modelo (§4.5): nas últimas 4 semanas, na mesma origem, o
// modelo·effort mais usado contra o mais barato que custa no máximo metade
// por pedido, com erro de API e falha de ferramenta até 2 pontos pior e 20
// pedidos de cada lado. Uma por origem; nunca aplicada.
function modelos(ap, aj, sug, agoraMs, novos) {
  const somas = new Map();
  for (const s of ap.semanas.slice(-SEMANAS_MODELO)) {
    for (const [k, v] of Object.entries(s.modelos)) {
      const a = somas.get(k) ?? new Array(CAMPOS_MODELO.length).fill(0);
      for (let i = 0; i < a.length; i++) a[i] += v[i];
      somas.set(k, a);
    }
  }
  const porOrigem = new Map();
  for (const [k, v] of somas) {
    const [modelo, effort, ...resto] = k.split('|');
    const origem = resto.join('|');
    if (v[0] < AMOSTRAS_MIN || !(v[1] > 0)) continue;
    const linha = { modelo, effort, pedidos: v[0], cpp: v[1] / v[0], erro: (100 * v[9]) / v[0], falha: v[10] > 0 ? (100 * v[11]) / v[10] : 0 };
    if (!porOrigem.has(origem)) porOrigem.set(origem, []);
    porOrigem.get(origem).push(linha);
  }
  for (const [origem, lista] of porOrigem) {
    if (lista.length < 2 || sug.lista.some((x) => x.tipo === 'modelo' && x.origem === origem && x.estado === 'pendente')) continue;
    const de = lista.reduce((a, b) => (b.pedidos > a.pedidos ? b : a));
    const candidatos = lista
      .filter((p) => p !== de && p.cpp <= de.cpp / 2 && p.erro <= de.erro + 2 && p.falha <= de.falha + 2)
      .sort((a, b) => a.cpp - b.cpp);
    for (const para of candidatos) {
      const s = { tipo: 'modelo', origem, de: { modelo: de.modelo, effort: de.effort }, para: { modelo: para.modelo, effort: para.effort } };
      const chave = chaveSugestao(s);
      if (bloqueado(aj, chave, agoraMs) || sug.lista.some((x) => x.tipo === 'modelo' && chaveSugestao(x) === chave)) continue;
      sug.seq += 1;
      const nova = {
        id: `s${sug.seq}`, ...s, razao: Math.min(1000, redondo1(de.cpp / para.cpp)), erroDe: redondo1(de.erro), erroPara: redondo1(para.erro),
        estado: 'pendente', em: new Date(agoraMs).toISOString(),
      };
      sug.lista.push(nova);
      novos.sugestoes.push(nova);
      break;
    }
  }
}

export function ajustar({ ap, aj, sug, config, agoraMs }) {
  const novos = { ajustes: [], sugestoes: [] };
  const fora = [];
  aj.perfil = perfilDe(ap);
  if (!(agoraMs - ap.desde >= PISO_MS) || ap.sessoes < PISO_SESSOES) return { aj, sug, novos, fora };

  const mudar = (item, alvo, motivoSobe, motivoDesce) => {
    const atual = aj.vigentes[item];
    if (alvo === atual || !podeMudar(aj, item, agoraMs)) return;
    const depois = passoPara(item, atual, alvo);
    const hip = { ...aj.vigentes, [item]: depois };
    if (valorDoItem(item, depois) === undefined || hip['painel.amarelo'] >= hip['painel.vermelho']) {
      fora.push(item);
      return;
    }
    novos.ajustes.push(registrar(aj, item, depois, depois > atual ? motivoSobe : motivoDesce, 'auto', agoraMs));
  };

  const temHoraAtiva = aj.perfil.horasAtivas.some((m) => m !== 0);
  mudar('painel.intervaloS', temHoraAtiva ? INTERVALO_FORA_S : ITENS['painel.intervaloS'].padrao, 'fora-do-horario', 'horario-mudou');
  for (const item of ['painel.vermelho', 'painel.amarelo']) {
    const a = alvoDaFaixa(ap, item, agoraMs);
    if (a === null) continue;
    if (a.fora) fora.push(item);
    else mudar(item, a.alvo, 'faixa-historico', 'faixa-historico');
  }
  mudar('previsao.pesoPerfil', cobertura(aj.perfil) >= COBERTURA_MIN ? PESO_ALVO : 0, 'perfil-por-hora', 'perfil-insuficiente');
  guarda(ap, aj, sug, config, agoraMs, novos, fora);
  modelos(ap, aj, sug, agoraMs, novos);
  return { aj, sug, novos, fora };
}

// §4.7: sem id, o último ajuste que ainda vale (o mais novo do seu item e
// que não é um desfazer); com id, só se ele for o mais novo do item. Volta
// ao valor anterior e bloqueia o item por 7 dias.
export function desfazer(aj, id, agoraMs) {
  let alvo = null;
  if (id === null) {
    for (let i = aj.registros.length - 1; i >= 0 && alvo === null; i--) {
      const r = aj.registros[i];
      if (r.origem !== 'desfeito' && ultimoRegistro(aj, r.item) === r) alvo = r;
    }
    if (alvo === null) return { ok: false, motivo: 'nada' };
  } else {
    alvo = aj.registros.find((r) => r.id === id) ?? null;
    if (alvo === null) return { ok: false, motivo: 'nao-achou' };
    if (alvo.origem === 'desfeito' || ultimoRegistro(aj, alvo.item) !== alvo) return { ok: false, motivo: 'nao-e-o-ultimo' };
  }
  const registro = registrar(aj, alvo.item, alvo.antes, 'desfazer', 'desfeito', agoraMs);
  aj.bloqueios[alvo.item] = agoraMs + BLOQUEIO_MS;
  return { ok: true, aj, registro };
}

// Aprovar um afrouxamento (§4.4): só até o config.json; no valor dele ou
// acima, o vigente volta a null (= o config.json). Se o vigente mudou desde a
// sugestão, ela sai sem aplicar. Aprovar uma sugestão de modelo só a marca
// (§4.5: nunca aplicada).
export function aprovar(aj, sug, id, config, agoraMs) {
  const s = sug.lista.find((x) => x.id === id && x.estado === 'pendente');
  if (s === undefined) return { ok: false, motivo: 'nao-achou' };
  if (s.tipo === 'modelo') {
    s.estado = 'aprovada';
    return { ok: true, tipo: 'modelo', aj, sug, sugestao: s };
  }
  sug.lista = sug.lista.filter((x) => x !== s);
  const cfg = config?.[ITENS[s.item].campo];
  if (aj.vigentes[s.item] !== s.de || !Number.isInteger(cfg)) return { ok: false, motivo: 'mudou', aj, sug };
  const para = Math.min(s.para, cfg);
  const registro = registrar(aj, s.item, para >= cfg ? null : para, 'sobra-4-semanas', 'aprovado', agoraMs);
  return { ok: true, tipo: 'afrouxar', aj, sug, registro };
}

// Recusar: a sugestão sai e a mesma (pela chave) fica bloqueada 7 dias.
export function recusar(sug, aj, id, agoraMs) {
  const s = sug.lista.find((x) => x.id === id && x.estado === 'pendente');
  if (s === undefined) return { ok: false, motivo: 'nao-achou' };
  sug.lista = sug.lista.filter((x) => x !== s);
  aj.bloqueios[chaveSugestao(s)] = agoraMs + BLOQUEIO_MS;
  return { ok: true, aj, sug, sugestao: s };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/aprendizado-ajustar.test.js test/aprendizado-agregar.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS. Se o teste de propriedade falhar, a mensagem traz o número do caso; o gerador é determinístico, então o caso se reproduz rodando o laço só até ele.

- [ ] **Step 5: Commit**

```powershell
git add -- src/aprendizado/ajustar.js test/aprendizado-ajustar.test.js
git commit -m @'
feat: learning decider: comfort within limits, guard only tightens, suggestions need approval (spec aprendizado 4.2-4.7, 8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/ajustar.js test/aprendizado-ajustar.test.js
```

---

### Task 6: A guarda lê `min(config.json, aperto)` (§4.4, §8 "Guarda", §10 última linha)

**Files:**
- Create: `src/guarda/aperto.js`
- Modify: `src/guarda/config.js` (a função `lerConfigGuarda`)
- Test: `test/guarda-aperto.test.js`

**Interfaces:**
- Consome: `lerSemLink` (`src/guarda/arquivo.js`); `caminhos`, `ligadoExiste`, `valorDoItem`, `TETO` (Task 4, `src/aprendizado/arquivos.js`, que só importa `fs`, `path` e `base.js`).
- Produz:
  - `lerAperto(dir) → { fableTetoPct: number | null, teto7d: number | null }` (null = sem aperto; nunca lança)
  - `aplicarAperto(config, aperto) → ConfigGuarda` (cópia com `min` nos dois campos)
  - `lerConfigGuardaBase(dir) → { config, avisos }` (o corpo atual de `lerConfigGuarda`, o `config.json` puro; é o que `ajustar` e `aprovar` usam)
  - `lerConfigGuarda(dir) → { config, avisos }` passa a devolver `aplicarAperto(base.config, lerAperto(dir))`; todo chamador atual (`avaliar.js`, `liberar.js` e os da parte 2) passa a ver o aperto sem mudar.

- [ ] **Step 1: Escrever o teste**

Crie `test/guarda-aperto.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerAperto, aplicarAperto } from '../src/guarda/aperto.js';
import { lerConfigGuarda, lerConfigGuardaBase, PADRAO_GUARDA } from '../src/guarda/config.js';
import { avaliarGuarda } from '../src/guarda/avaliar.js';

// A guarda lê min(config.json, aperto aprendido) (spec aprendizado §4.4 e
// §8 "Guarda"). ajustes.json ausente, inválido ou link, ou aprendizado
// desligado: config.json puro. Pastas temporárias; nada toca ~/.claude.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function novo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aperto ç '));
  dirs.push(d);
  return d;
}
const agora = Date.UTC(2026, 9, 20, 18, 0);
const agoraS = agora / 1000;
const iso = (ms) => new Date(ms).toISOString();
function ligar(d) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(d, 'otel', 'ligado.json'), JSON.stringify({ v: 1, chaves: {}, criouEnv: false, em: iso(agora) }));
}
function gravarAjustes(d, vigentes) {
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 1, seq: 0, vigentes, registros: [], bloqueios: {}, perfil: {} }));
}
function gravarEstado(d, u7) {
  const at = iso(agora);
  fs.writeFileSync(path.join(d, 'estado.json'), JSON.stringify({
    versao: 1, at,
    five_hour: { used_percentage: 10, resets_at: agoraS + 3 * 3600, at },
    seven_day: { used_percentage: u7, resets_at: agoraS + 4 * 86_400, at },
    sessoes: {}, historico: [],
  }));
}

test('sem aperto: ajustes.json ausente, desligado, inválido, fora da faixa ou link', (t) => {
  const d = novo();
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  gravarAjustes(d, { 'guarda.teto7d': 75 });
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null }, 'sem ligado.json o aprendizado está desligado');
  ligar(d);
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: 75 });
  fs.writeFileSync(path.join(d, 'ajustes.json'), '{"v":1,');
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  gravarAjustes(d, { 'guarda.teto7d': 40, 'guarda.fableTetoPct': 75.5 });
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
  fs.writeFileSync(path.join(d, 'ajustes.json'), JSON.stringify({ v: 1, vigentes: { 'guarda.teto7d': 75 }, pad: 'x'.repeat(70 * 1024) }));
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null }, 'acima de 64 KiB');
  const alvo = path.join(d, 'alvo.json');
  fs.rmSync(path.join(d, 'ajustes.json'));
  fs.writeFileSync(alvo, JSON.stringify({ v: 1, vigentes: { 'guarda.teto7d': 75 } }));
  try {
    fs.symlinkSync(alvo, path.join(d, 'ajustes.json'));
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link'); return; }
    throw e;
  }
  assert.deepEqual(lerAperto(d), { fableTetoPct: null, teto7d: null });
});

test('aplicarAperto: só o mínimo, nunca acima do config.json', () => {
  const base = { ...PADRAO_GUARDA, teto7d: 80, fableTetoPct: 90 };
  assert.deepEqual(aplicarAperto(base, { teto7d: 75, fableTetoPct: null }), { ...base, teto7d: 75 });
  assert.deepEqual(aplicarAperto(base, { teto7d: 95, fableTetoPct: 100 }), base);
  assert.deepEqual(aplicarAperto(base, null), base);
  assert.notEqual(aplicarAperto(base, { teto7d: 75, fableTetoPct: null }), base);
});

test('lerConfigGuarda devolve o mínimo; lerConfigGuardaBase, o config.json puro', () => {
  const d = novo();
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ guarda: { teto7d: 80 } }));
  ligar(d);
  gravarAjustes(d, { 'guarda.teto7d': 75, 'guarda.fableTetoPct': 85 });
  assert.equal(lerConfigGuarda(d).config.teto7d, 75);
  assert.equal(lerConfigGuarda(d).config.fableTetoPct, 85);
  assert.equal(lerConfigGuardaBase(d).config.teto7d, 80);
  gravarAjustes(d, { 'guarda.teto7d': 95 });
  assert.equal(lerConfigGuarda(d).config.teto7d, 80);
});

test('avaliarGuarda: 7d em 80% dispara G4 com aperto 75 e não dispara sem ele', () => {
  const d = novo();
  gravarEstado(d, 80);
  assert.equal(avaliarGuarda({ dir: d, agoraMs: agora, sessionId: 's' }).status, 'armada');
  const e = novo();
  gravarEstado(e, 80);
  ligar(e);
  gravarAjustes(e, { 'guarda.teto7d': 75 });
  const g = avaliarGuarda({ dir: e, agoraMs: agora, sessionId: 's' });
  assert.equal(g.status, 'disparada');
  assert.equal(g.motivos[0].gatilho, 'G4');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/guarda-aperto.test.js`
Expected: FAIL com `Cannot find module` de `src/guarda/aperto.js`.

- [ ] **Step 3: Escrever `src/guarda/aperto.js`**

```js
import { lerSemLink } from './arquivo.js';
import { TETO, caminhos, ligadoExiste, valorDoItem } from '../aprendizado/arquivos.js';

// Aperto aprendido da guarda (spec aprendizado §4.4). A guarda lê
// min(config.json, aperto), e só esse mínimo: o aperto nunca afrouxa nada.
// Aprendizado desligado (sem otel/ligado.json), ajustes.json ausente,
// inválido, acima de 64 KiB ou link: sem aperto, e a guarda usa o
// config.json puro, que o próprio usuário escolheu (§10, limite registrado
// no SECURITY.md). Sem rede e sem processo filho, como todo src/guarda/**;
// só importa o módulo leve de nomes do aprendizado.

const ITEM_DO_CAMPO = Object.freeze({ fableTetoPct: 'guarda.fableTetoPct', teto7d: 'guarda.teto7d' });
const nenhum = () => ({ fableTetoPct: null, teto7d: null });

export function lerAperto(dir) {
  try {
    if (!ligadoExiste(dir)) return nenhum();
    const l = lerSemLink(caminhos(dir).ajustes, TETO.ajustes);
    const vig = l.ok && l.valor !== null && typeof l.valor === 'object' && l.valor.v === 1 ? l.valor.vigentes : null;
    if (vig === null || typeof vig !== 'object' || Array.isArray(vig)) return nenhum();
    const r = nenhum();
    for (const [campo, item] of Object.entries(ITEM_DO_CAMPO)) {
      if (!Object.hasOwn(vig, item)) continue;
      const v = valorDoItem(item, vig[item]);
      if (Number.isInteger(v)) r[campo] = v;
    }
    return r;
  } catch {
    return nenhum();
  }
}

export function aplicarAperto(config, aperto) {
  const c = { ...config };
  for (const campo of Object.keys(ITEM_DO_CAMPO)) {
    const v = aperto?.[campo];
    if (Number.isInteger(v) && v < c[campo]) c[campo] = v;
  }
  return c;
}
```

- [ ] **Step 4: Mudar `src/guarda/config.js`**

Acrescente o import no topo, depois de `import { lerJson } from '../estado.js';`:

```js
import { lerAperto, aplicarAperto } from './aperto.js';
```

Ache a linha `export function lerConfigGuarda(dir) {` e troque **só o nome** dela por `lerConfigGuardaBase` (o corpo fica igual):

```js
export function lerConfigGuardaBase(dir) {
```

Logo depois do fim dessa função (a chave `}` que fecha o `catch` final dela), acrescente:

```js

// O que a guarda usa (spec aprendizado §4.4): o config.json com o aperto
// aprendido por cima, só pelo mínimo. lerConfigGuardaBase é o config.json
// puro, para o aprendizado calcular apertos e aprovações sem se somar.
export function lerConfigGuarda(dir) {
  const base = lerConfigGuardaBase(dir);
  try {
    return { config: aplicarAperto(base.config, lerAperto(dir)), avisos: base.avisos };
  } catch {
    return base;
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/guarda-aperto.test.js test/guarda-config.test.js test/guarda-avaliar.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS (o caso do link pode sair como `skip`). As fronteiras continuam valendo: `aperto.js` não importa rede nem processo filho.

Run: `node --test`
Expected: PASS em toda a suíte (os testes da guarda das partes 1 e 2 não criam `otel/ligado.json`, então nada muda para eles).

- [ ] **Step 6: Commit**

```powershell
git add -- src/guarda/aperto.js src/guarda/config.js test/guarda-aperto.test.js
git commit -m @'
feat: guard reads min(config.json, learned tightening); absent, invalid or linked ajustes.json falls back to config.json (spec aprendizado 4.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/guarda/aperto.js src/guarda/config.js test/guarda-aperto.test.js
```

---

### Task 7: Download fixado e conferido (`baixar.js`) (§3.2 passo 2, §6 primeira linha, §8 "Download", R5, R7)

**Files:**
- Create: `src/aprendizado/baixar.js`
- Test: `test/aprendizado-baixar.test.js`

**Interfaces:**
- Consome: o bloco `VERSAO_COLETOR`/`FIXADO` impresso pelo Step 1 da Task 1 (`$S\fixado.js`) e, da Emenda A2, `HOSTS`, `TAMANHO_MAX`, `PRAZO_MS`; `apagar` (`src/base.js`).
- Produz:
  - `VERSAO_COLETOR: string`, `FIXADO: { [chave]: { arquivo, sha256 } }` com as chaves `'win32-x64'`, `'linux-x64'`, `'linux-arm64'`, `'darwin-x64'`, `'darwin-arm64'`
  - `HOSTS`, `TAMANHO_MAX`, `PRAZO_MS`, `REDIRECIONAMENTOS_MAX` (5), `SHA_VALIDO`
  - `plataformaAtual(plataforma = process.platform, arch = process.arch) → chave | null`
  - `urlDoColetor(chave) → string`
  - `baixarColetor({ destino, chave, url?, sha256?, hosts?, protocolos?, prazoMs?, tamanhoMax? }) → Promise<{ ok: true, bytes } | { ok: false, motivo: 'plataforma' | 'rede' | 'http' | 'host' | 'grande' | 'prazo' | 'hash' | 'escrita' }>` (nunca rejeita; baixa num `.parte` ao lado do destino e só renomeia com o hash certo; em qualquer falha o `.parte` é apagado)

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-baixar.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { baixarColetor, plataformaAtual, urlDoColetor, FIXADO, VERSAO_COLETOR, HOSTS } from '../src/aprendizado/baixar.js';

// Download do Collector (spec aprendizado §3.2 passo 2, §6 e §8 "Download"):
// um servidor HTTP local em 127.0.0.1, nunca a rede de verdade.

const CONTEUDO = crypto.randomBytes(300_000);
const SHA = crypto.createHash('sha256').update(CONTEUDO).digest('hex');
const dirs = [];
let servidor;
let base;

before(async () => {
  servidor = http.createServer((req, res) => {
    const rota = new URL(req.url, 'http://x').pathname;
    if (rota === '/ok') {
      res.writeHead(200, { 'content-length': CONTEUDO.length });
      res.end(CONTEUDO);
    } else if (rota === '/pedacos') {
      res.writeHead(200);
      res.write(CONTEUDO);
      res.end(CONTEUDO);
    } else if (rota === '/redir') {
      res.writeHead(302, { location: '/ok' });
      res.end();
    } else if (rota === '/laco') {
      res.writeHead(302, { location: '/laco' });
      res.end();
    } else if (rota === '/fora') {
      res.writeHead(302, { location: 'http://localhost:1/ok' });
      res.end();
    } else if (rota === '/parado') {
      res.writeHead(200);
      res.write(CONTEUDO.subarray(0, 1000));
    } else if (rota === '/corta') {
      req.socket.destroy();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function novoDestino() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk baixar ç '));
  dirs.push(d);
  return path.join(d, 'otel', 'bin', 'coletor.tar.gz');
}
const local = (rota, extra = {}) => ({ url: `${base}${rota}`, sha256: SHA, hosts: ['127.0.0.1'], protocolos: ['http:'], ...extra });
const soltos = (destino) => (fs.existsSync(path.dirname(destino)) ? fs.readdirSync(path.dirname(destino)).filter((n) => n.endsWith('.parte')) : []);

test('bloco fixado da Task 1 colado: versão e as 5 plataformas com SHA-256', () => {
  assert.match(VERSAO_COLETOR, /^\d+\.\d+\.\d+$/);
  assert.notEqual(VERSAO_COLETOR, '0.0.0', 'cole o bloco de $S\\fixado.js (Task 1, Step 1)');
  const sufixo = { 'win32-x64': 'windows_amd64', 'linux-x64': 'linux_amd64', 'linux-arm64': 'linux_arm64', 'darwin-x64': 'darwin_amd64', 'darwin-arm64': 'darwin_arm64' };
  assert.deepEqual(Object.keys(FIXADO).sort(), Object.keys(sufixo).sort());
  for (const [k, f] of Object.entries(FIXADO)) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/, k);
    assert.equal(f.arquivo, `otelcol-contrib_${VERSAO_COLETOR}_${sufixo[k]}.tar.gz`);
  }
  assert.equal(
    urlDoColetor('win32-x64'),
    `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSAO_COLETOR}/otelcol-contrib_${VERSAO_COLETOR}_windows_amd64.tar.gz`,
  );
  assert.ok(HOSTS.includes('github.com'));
  assert.ok(HOSTS.every((h) => h === 'github.com' || h.endsWith('.githubusercontent.com')));
});

test('plataformaAtual: só as 5 do release', () => {
  assert.equal(plataformaAtual('win32', 'x64'), 'win32-x64');
  assert.equal(plataformaAtual('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(plataformaAtual('linux', 'ia32'), null);
  assert.equal(plataformaAtual('sunos', 'x64'), null);
});

test('hash certo: grava o destino (criando a pasta) e não deixa .parte; redirecionamento no mesmo host vale', async () => {
  for (const rota of ['/ok', '/redir']) {
    const destino = novoDestino();
    const r = await baixarColetor({ destino, ...local(rota) });
    assert.deepEqual(r, { ok: true, bytes: CONTEUDO.length });
    assert.ok(fs.readFileSync(destino).equals(CONTEUDO));
    assert.deepEqual(soltos(destino), []);
  }
});

test('hash errado: nada gravado e o .parte é apagado (§6)', async () => {
  const destino = novoDestino();
  assert.deepEqual(await baixarColetor({ destino, ...local('/ok', { sha256: '0'.repeat(64) }) }), { ok: false, motivo: 'hash' });
  assert.equal(fs.existsSync(destino), false);
  assert.deepEqual(soltos(destino), []);
});

test('acima do teto, pelo cabeçalho ou no meio do fluxo: grande', async () => {
  const d1 = novoDestino();
  assert.deepEqual(await baixarColetor({ destino: d1, ...local('/ok', { tamanhoMax: 1000 }) }), { ok: false, motivo: 'grande' });
  const d2 = novoDestino();
  assert.deepEqual(await baixarColetor({ destino: d2, ...local('/pedacos', { tamanhoMax: 400_000 }) }), { ok: false, motivo: 'grande' });
  assert.deepEqual(soltos(d2), []);
});

test('HTTP fora de 200, laço de redirecionamento, outro host, http sem permissão, conexão cortada', async () => {
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/nada') }), { ok: false, motivo: 'http' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/laco') }), { ok: false, motivo: 'http' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/fora') }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/ok', { protocolos: undefined }) }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/ok', { hosts: undefined }) }), { ok: false, motivo: 'host' });
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), ...local('/corta') }), { ok: false, motivo: 'rede' });
});

test('prazo: servidor que não termina', async () => {
  const destino = novoDestino();
  assert.deepEqual(await baixarColetor({ destino, ...local('/parado', { prazoMs: 300 }) }), { ok: false, motivo: 'prazo' });
  assert.deepEqual(soltos(destino), []);
});

test('plataforma sem binário fixado', async () => {
  assert.deepEqual(await baixarColetor({ destino: novoDestino(), chave: 'sunos-x64' }), { ok: false, motivo: 'plataforma' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-baixar.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/baixar.js`.

- [ ] **Step 3: Escrever `src/aprendizado/baixar.js`**

As duas linhas entre `>>>` e `<<<` são **substituídas pelas 7 linhas de `$S\fixado.js`** (Task 1, Step 1), sem edição: é daí, e só daí, que vêm a versão e os hashes (tirados do arquivo de checksums oficial do release; nenhum hash é digitado à mão). O primeiro teste falha enquanto isso não for feito. `HOSTS`, `TAMANHO_MAX` e `PRAZO_MS` ficam com os valores da Emenda A2 (os abaixo são os padrões do plano).

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { apagar } from '../base.js';

// Download do otelcol-contrib (spec aprendizado §3.2 passo 2 e §6). É o
// ÚNICO módulo com rede do plugin (test/aprendizado-fronteiras.test.js), e só
// o `ligar` confirmado o chama. Versão e SHA-256 do .tar.gz fixados no
// código, por plataforma (R7). Só https, só os hosts do release, no máximo 5
// redirecionamentos, teto de tamanho e prazo (R5: 300 s, dentro dos 600 s do
// hook). Baixa num .parte ao lado do destino e só renomeia depois de
// conferir o hash; qualquer falha apaga o .parte. Nunca rejeita.

// >>> bloco da Task 1, Step 1 ($S\fixado.js), colado sem edição
export const VERSAO_COLETOR = '0.0.0';
export const FIXADO = Object.freeze({});
// <<<

const REPO = 'open-telemetry/opentelemetry-collector-releases';
// Emenda A2: os hosts por onde o download do release passa.
export const HOSTS = Object.freeze(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
export const TAMANHO_MAX = 200 * 1024 * 1024;
export const PRAZO_MS = 300_000;
export const REDIRECIONAMENTOS_MAX = 5;
export const SHA_VALIDO = /^[0-9a-f]{64}$/;
const REDIRECIONA = new Set([301, 302, 303, 307, 308]);

export function plataformaAtual(plataforma = process.platform, arch = process.arch) {
  const chave = `${plataforma}-${arch}`;
  return Object.hasOwn(FIXADO, chave) ? chave : null;
}

export function urlDoColetor(chave) {
  return `https://github.com/${REPO}/releases/download/v${VERSAO_COLETOR}/${FIXADO[chave].arquivo}`;
}

function transferir({ url, sha, hosts, protocolos, prazoMs, tamanhoMax, parte }) {
  return new Promise((resolver) => {
    let fim = false;
    let pedido = null;
    let saida = null;
    const terminar = (r) => {
      if (fim) return;
      fim = true;
      clearTimeout(relogio);
      try { pedido?.destroy(); } catch { /* já fechado */ }
      // No Windows o arquivo aberto não se apaga: espera o fechamento.
      if (saida === null || saida.closed) {
        resolver(r);
        return;
      }
      saida.once('close', () => resolver(r));
      saida.destroy();
    };
    const relogio = setTimeout(() => terminar({ ok: false, motivo: 'prazo' }), prazoMs);
    const pedir = (alvo, saltos) => {
      let u;
      try {
        u = new URL(alvo);
      } catch {
        terminar({ ok: false, motivo: 'host' });
        return;
      }
      if (!protocolos.includes(u.protocol) || !hosts.includes(u.hostname) || u.username !== '' || u.password !== '') {
        terminar({ ok: false, motivo: 'host' });
        return;
      }
      const cliente = u.protocol === 'https:' ? https : http;
      pedido = cliente.get(u, { headers: { 'user-agent': 'claude-hadouken' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECIONA.has(status)) {
          res.resume();
          const destino = res.headers.location;
          if (typeof destino !== 'string' || saltos >= REDIRECIONAMENTOS_MAX) {
            terminar({ ok: false, motivo: 'http' });
            return;
          }
          let proximo;
          try {
            proximo = new URL(destino, u).href;
          } catch {
            terminar({ ok: false, motivo: 'host' });
            return;
          }
          pedir(proximo, saltos + 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          terminar({ ok: false, motivo: 'http' });
          return;
        }
        const declarado = Number(res.headers['content-length']);
        if (Number.isFinite(declarado) && declarado > tamanhoMax) {
          terminar({ ok: false, motivo: 'grande' });
          return;
        }
        try {
          saida = fs.createWriteStream(parte, { flags: 'wx' });
        } catch {
          terminar({ ok: false, motivo: 'escrita' });
          return;
        }
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        saida.on('error', () => terminar({ ok: false, motivo: 'escrita' }));
        res.on('error', () => terminar({ ok: false, motivo: 'rede' }));
        res.on('aborted', () => terminar({ ok: false, motivo: 'rede' }));
        res.on('data', (pedaco) => {
          bytes += pedaco.length;
          if (bytes > tamanhoMax) terminar({ ok: false, motivo: 'grande' });
          else hash.update(pedaco);
        });
        saida.on('close', () => {
          if (fim) return;
          if (!res.complete) {
            terminar({ ok: false, motivo: 'rede' });
            return;
          }
          terminar(hash.digest('hex') === sha ? { ok: true, bytes } : { ok: false, motivo: 'hash' });
        });
        res.pipe(saida);
      });
      pedido.on('error', () => terminar({ ok: false, motivo: 'rede' }));
    };
    pedir(url, 0);
  });
}

export async function baixarColetor(opcoes) {
  let parte = null;
  try {
    const o = opcoes ?? {};
    const fixo = typeof o.chave === 'string' && Object.hasOwn(FIXADO, o.chave) ? FIXADO[o.chave] : null;
    const url = o.url ?? (fixo === null ? null : urlDoColetor(o.chave));
    const sha = o.sha256 ?? fixo?.sha256 ?? null;
    if (typeof url !== 'string' || typeof sha !== 'string' || !SHA_VALIDO.test(sha)) return { ok: false, motivo: 'plataforma' };
    if (typeof o.destino !== 'string' || !path.isAbsolute(o.destino)) return { ok: false, motivo: 'escrita' };
    try {
      fs.mkdirSync(path.dirname(o.destino), { recursive: true });
    } catch {
      return { ok: false, motivo: 'escrita' };
    }
    parte = `${o.destino}.${process.pid}.${Date.now()}.parte`;
    const r = await transferir({
      url, sha, parte,
      hosts: o.hosts ?? HOSTS,
      protocolos: o.protocolos ?? ['https:'],
      prazoMs: o.prazoMs ?? PRAZO_MS,
      tamanhoMax: o.tamanhoMax ?? TAMANHO_MAX,
    });
    if (!r.ok) return r;
    fs.renameSync(parte, o.destino);
    parte = null;
    return r;
  } catch {
    return { ok: false, motivo: 'escrita' };
  } finally {
    if (parte !== null) apagar(parte);
  }
}
```

- [ ] **Step 4: Colar o bloco fixado**

Troque as duas linhas entre `// >>>` e `// <<<` pelo conteúdo de `$S\fixado.js` (Task 1, Step 1), com o Edit, sem mudar nenhum caractere do bloco. Confira que `VERSAO_COLETOR` é a versão registrada na Emenda A2.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/aprendizado-baixar.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS. O teste nunca sai da máquina: todo pedido vai a `127.0.0.1`.

- [ ] **Step 6: Commit**

```powershell
git add -- src/aprendizado/baixar.js test/aprendizado-baixar.test.js
git commit -m @'
feat: pinned Collector download (version and SHA-256 from the release checksums), https-only, host allowlist, size cap, deadline (spec aprendizado 3.2, 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/baixar.js test/aprendizado-baixar.test.js
```

---

### Task 8: A vida do Collector (`coletor.js`) (§3.2 passo 2, §3.3, §8 "Coletor", R2, R6, R7, R12)

**Files:**
- Create: `src/aprendizado/coletor.js`, `test/fixtures/coletor-falso.mjs`, `test/fixtures/subir-paralelo.mjs`
- Test: `test/aprendizado-coletor.test.js`

**Interfaces:**
- Consome: `configColetor` (Task 2), `ARQ_TELEMETRIA` (Task 2, `otlp.js`), `caminhos`, `TETO` (Task 4), `RAM_MIN_BYTES` (`src/uso/painel.js`), `gravarJsonAtomico` (`src/estado.js`), `lerSemLink` (`src/guarda/arquivo.js`), `apagar`, `fechar`, `numeroFinito` (`src/base.js`); da Emenda A2/A3: `MEMBRO_TAR`, `NOME_BINARIO`, `PORTA_OCUPADA`, `A3_ATRAPALHA`.
- Produz (nenhuma função lança; todas aceitam `plataforma`, `executar` (no lugar de `execFileSync`) e `systemRoot` para o teste):
  - `NOME_BINARIO`, `MEMBRO_TAR`, `PORTA_OCUPADA`, `A3_ATRAPALHA`, `ORFAO_MS` (30 min), `OUTRA_SESSAO_MS` (5 min; 24 h se `A3_ATRAPALHA`)
  - `caminhoBinario(dir, plataforma?) → string`; `programa('tar' | 'tasklist' | 'taskkill' | 'ps', { plataforma, systemRoot }) → string | null`
  - `hashArquivo(arquivo) → string`; `registrarInstalacao(dir, plataforma?) → { ok }`
  - `extrairColetor({ dir, tarGz, plataforma?, executar?, systemRoot? }) → { ok: true } | { ok: false, motivo: 'extrair' }` (`tarGz` fica em `otel/bin/`; o tar roda com `cwd` nessa pasta e só extrai o membro fixado)
  - `conferirIntegridade(dir, { plataforma?, hashar? }) → { ok: true } | { ok: false, motivo: 'coletor-ausente' | 'coletor-hash' }`
  - `lerPid(dir) → { pid, emMs } | null`; `nomeDoProcesso(pid, opcoes) → string | null`; `coletorVivo(dir, opcoes) → { vivo, pid, emMs }`
  - `classificarLog(dir) → 'porta-ocupada' | 'coletor-falhou' | null`
  - `gravarConfig(dir) → { ok }`
  - `subirColetor({ dir, agoraMs, plataforma?, memLivre?, env?, gerar?, executar?, systemRoot?, hashar? }) → { ok: true, pid, evento: string | null } | { ok: false, motivo: 'vivo' | 'subindo' | 'pouca-ram' | 'coletor-ausente' | 'coletor-hash' | 'config' | 'erro', evento: string | null }` (`evento` é o que a subida anterior deixou no log: `'porta-ocupada'` ou `'coletor-falhou'`)
  - `pararColetor({ dir, plataforma?, executar?, systemRoot?, matar? }) → { ok: true, motivo: 'parado' | 'sem-pid' | 'morto' } | { ok: false, motivo: 'outro-processo' | 'erro' }`
  - `ehOrfao({ emMs, ultimaOutraSessaoMs, agoraMs }) → boolean`

- [ ] **Step 1: Escrever os processos falsos**

Crie `test/fixtures/coletor-falso.mjs`:

```js
// Processo falso no lugar do otelcol-contrib (spec aprendizado §8
// "Coletor"). Escreve no stderr, que o hadouken manda para otel/coletor.log,
// quantas variáveis OTEL_* chegaram, se SEGREDO_TESTE chegou e a mensagem do
// primeiro argumento; fica vivo pelo tempo do segundo (ms).
const [msg = '', ms = '3000'] = process.argv.slice(2);
const otel = Object.keys(process.env).filter((k) => k.startsWith('OTEL_')).length;
const segredo = process.env.SEGREDO_TESTE === undefined ? 'nao' : 'sim';
process.stderr.write(`falso otel:${otel} segredo:${segredo} ${msg}\n`);
setTimeout(() => process.exit(0), Number(ms));
```

Crie `test/fixtures/subir-paralelo.mjs`:

```js
// Foco de revisão 3: dois processos chamam subirColetor ao mesmo tempo. O
// "gerar" falso anota cada subida em gerados.txt; o "executar" falso diz que
// todo PID do arquivo de PID é o Collector vivo.
import fs from 'node:fs';
import path from 'node:path';
import { subirColetor } from '../../src/aprendizado/coletor.js';

const [dir] = process.argv.slice(2);
const plataforma = process.platform;
const r = subirColetor({
  dir,
  agoraMs: Date.now(),
  plataforma,
  memLivre: () => 8 * 1024 ** 3,
  env: {},
  gerar: () => {
    fs.appendFileSync(path.join(dir, 'gerados.txt'), `${process.pid}\n`);
    return { pid: process.pid, unref() {}, on() {} };
  },
  executar: (_arquivo, args) => {
    const pid = plataforma === 'win32' ? String(args[1]).replace('PID eq ', '') : String(args[1]);
    return plataforma === 'win32' ? `"otelcol-contrib.exe","${pid}","Console","1","1.000 K"\r\n` : 'otelcol-contrib\n';
  },
});
process.stdout.write(JSON.stringify(r));
```

- [ ] **Step 2: Escrever o teste**

Crie `test/aprendizado-coletor.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  caminhoBinario, programa, registrarInstalacao, extrairColetor, conferirIntegridade, lerPid, nomeDoProcesso, coletorVivo,
  classificarLog, subirColetor, pararColetor, ehOrfao, NOME_BINARIO, ORFAO_MS,
} from '../src/aprendizado/coletor.js';

// Vida do Collector (spec aprendizado §3.3 e §8 "Coletor"): um processo
// falso em Node no lugar do binário; tasklist, ps e taskkill trocados por
// funções que respondem o que o teste quer. Pastas temporárias.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(aqui, 'fixtures', 'coletor-falso.mjs');
const PARALELO = path.join(aqui, 'fixtures', 'subir-paralelo.mjs');
const GiB = 1024 ** 3;
const plat = process.platform;
const dirs = [];
const pids = [];
after(() => {
  for (const p of pids) { try { process.kill(p); } catch { /* já saiu */ } }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk coletor ç '));
  dirs.push(d);
  return d;
}
function instalarFalso(d, conteudo = 'binario falso') {
  fs.mkdirSync(path.join(d, 'otel', 'bin'), { recursive: true });
  fs.writeFileSync(caminhoBinario(d, plat), conteudo);
  assert.equal(registrarInstalacao(d, plat).ok, true);
}
function gravarPid(d, pid, emMs = Date.now()) {
  fs.mkdirSync(path.join(d, 'otel'), { recursive: true });
  fs.writeFileSync(path.join(d, 'otel', 'coletor.pid'), JSON.stringify({ v: 1, pid, em: new Date(emMs).toISOString() }));
}
// "tasklist"/"ps" falso: vivos é o conjunto de PIDs que respondem com o nome do Collector.
function consultaFalsa(vivos, chamadas = []) {
  return (arquivo, args) => {
    chamadas.push({ arquivo, args });
    const pid = Number(plat === 'win32' ? String(args[1]).replace('PID eq ', '') : args[1]);
    if (!vivos.has(pid)) {
      if (plat === 'win32') return 'INFO: No tasks are running which match the specified criteria.\r\n';
      throw Object.assign(new Error('sem processo'), { status: 1 });
    }
    return plat === 'win32' ? `"otelcol-contrib.exe","${pid}","Console","1","80.000 K"\r\n` : 'otelcol-contrib\n';
  };
}
function gerarFalso(chamadas, msg, ms = 3000) {
  return (bin, args, opcoes) => {
    chamadas.push({ bin, args, opcoes });
    const filho = spawn(process.execPath, [FALSO, msg, String(ms)], opcoes);
    pids.push(filho.pid);
    return filho;
  };
}
async function esperarLog(d, re) {
  const log = path.join(d, 'otel', 'coletor.log');
  for (let i = 0; i < 100; i++) {
    const t = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    if (re.test(t)) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
// .tar.gz com um só membro, montado aqui (cabeçalho ustar de 512 bytes).
function tarGz(nome, conteudo) {
  const h = Buffer.alloc(512);
  h.write(nome, 0, 'utf8');
  h.write('0000755\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${conteudo.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let soma = 0;
  for (const b of h) soma += b;
  h.write(`${soma.toString(8).padStart(6, '0')}\0 `, 148);
  const resto = Buffer.alloc((512 - (conteudo.length % 512)) % 512);
  return zlib.gzipSync(Buffer.concat([h, conteudo, resto, Buffer.alloc(1024)]));
}

test('programa: System32 por caminho absoluto no Windows; tar e ps do sistema no POSIX', () => {
  assert.equal(programa('tar', { plataforma: 'win32', systemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\tar.exe');
  assert.equal(programa('taskkill', { plataforma: 'win32', systemRoot: 'relativo' }), 'C:\\Windows\\System32\\taskkill.exe');
  assert.equal(programa('tasklist', { plataforma: 'win32', systemRoot: '' }), 'C:\\Windows\\System32\\tasklist.exe');
  assert.equal(programa('ps', { plataforma: 'linux' }), '/bin/ps');
});

test('extrair com o tar do sistema: só o membro fixado, hash do binário em instalado.json; sem o membro, falha limpa', () => {
  const d = novoDir();
  const bin = path.join(d, 'otel', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const nome = plat === 'win32' ? NOME_BINARIO.win32 : NOME_BINARIO.posix;
  fs.writeFileSync(path.join(bin, 'c.tar.gz'), tarGz(nome, Buffer.from('conteudo do binario')));
  assert.deepEqual(extrairColetor({ dir: d, tarGz: path.join(bin, 'c.tar.gz') }), { ok: true });
  assert.equal(fs.readFileSync(caminhoBinario(d), 'utf8'), 'conteudo do binario');
  assert.deepEqual(conferirIntegridade(d), { ok: true });
  const e = novoDir();
  fs.mkdirSync(path.join(e, 'otel', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(e, 'otel', 'bin', 'c.tar.gz'), tarGz('outro-nome', Buffer.from('x')));
  assert.deepEqual(extrairColetor({ dir: e, tarGz: path.join(e, 'otel', 'bin', 'c.tar.gz') }), { ok: false, motivo: 'extrair' });
  assert.equal(fs.existsSync(caminhoBinario(e)), false);
});

test('integridade (§3.3, R7): tamanho e mtime iguais não recalculam; binário trocado ou sem instalado.json bloqueia', () => {
  const d = novoDir();
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-ausente' });
  instalarFalso(d);
  let hashes = 0;
  const hashar = () => { hashes += 1; return 'f'.repeat(64); };
  assert.deepEqual(conferirIntegridade(d, { hashar }), { ok: true });
  assert.equal(hashes, 0);
  fs.appendFileSync(caminhoBinario(d), 'trocado');
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-hash' });
  instalarFalso(d);
  fs.rmSync(path.join(d, 'otel', 'bin', 'instalado.json'));
  assert.deepEqual(conferirIntegridade(d), { ok: false, motivo: 'coletor-hash' });
});

test('nomeDoProcesso: tasklist em CSV pelo System32; ps -o comm=; ausente = null', () => {
  const chamadas = [];
  const win = (arquivo, args) => {
    chamadas.push({ arquivo, args });
    return '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  };
  assert.equal(nomeDoProcesso(4242, { plataforma: 'win32', executar: win, systemRoot: 'C:\\Windows' }), 'otelcol-contrib.exe');
  assert.deepEqual(chamadas[0], { arquivo: 'C:\\Windows\\System32\\tasklist.exe', args: ['/FI', 'PID eq 4242', '/FO', 'CSV', '/NH'] });
  assert.equal(nomeDoProcesso(4243, { plataforma: 'win32', executar: win }), null, 'outro PID na resposta não conta');
  assert.equal(nomeDoProcesso(7, { plataforma: 'linux', executar: () => '/opt/x/otelcol-contrib\n' }), 'otelcol-contrib');
  assert.equal(nomeDoProcesso(7, { plataforma: 'linux', executar: () => { throw new Error('status 1'); } }), null);
  assert.equal(nomeDoProcesso(-1, { plataforma: 'linux', executar: () => 'x' }), null);
});

test('subirColetor: desanexado e sem janela, stderr no coletor.log, só o ambiente permitido, PID gravado', async () => {
  const d = novoDir();
  instalarFalso(d);
  const chamadas = [];
  const r = subirColetor({
    dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB,
    env: { ...process.env, OTEL_LOGS_EXPORTER: 'otlp', SEGREDO_TESTE: 'x' },
    gerar: gerarFalso(chamadas, 'oi'), executar: consultaFalsa(new Set()),
  });
  assert.equal(r.ok, true);
  assert.equal(r.evento, null);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].bin, caminhoBinario(d));
  assert.deepEqual(chamadas[0].args, ['--config', path.join(d, 'otel', 'config.yaml')]);
  assert.equal(chamadas[0].opcoes.detached, true);
  assert.equal(chamadas[0].opcoes.windowsHide, true);
  assert.equal(lerPid(d).pid, r.pid);
  assert.ok(await esperarLog(d, /falso otel:0 segredo:nao oi/), 'o Collector não herda OTEL_* nem segredos');
  assert.ok(fs.readFileSync(path.join(d, 'otel', 'config.yaml'), 'utf8').includes('endpoint: 127.0.0.1:47318'));
});

test('subirColetor: vivo, pouca RAM, integridade e trava de subida', () => {
  const d = novoDir();
  instalarFalso(d);
  const chamadas = [];
  const base = { dir: d, agoraMs: Date.now(), plataforma: plat, env: {}, gerar: gerarFalso(chamadas, 'x') };
  gravarPid(d, 4242);
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set([4242])) }), { ok: false, motivo: 'vivo', evento: null });
  fs.rmSync(path.join(d, 'otel', 'coletor.pid'));
  assert.deepEqual(subirColetor({ ...base, memLivre: () => GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'pouca-ram', evento: null });
  fs.writeFileSync(path.join(d, 'otel', 'subindo.lock'), '');
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'subindo', evento: null });
  const velho = (Date.now() - 5 * 60_000) / 1000;
  fs.utimesSync(path.join(d, 'otel', 'subindo.lock'), velho, velho);
  fs.appendFileSync(caminhoBinario(d), 'trocado');
  assert.deepEqual(subirColetor({ ...base, memLivre: () => 8 * GiB, executar: consultaFalsa(new Set()) }), { ok: false, motivo: 'coletor-hash', evento: null });
  assert.equal(chamadas.length, 0);
  assert.equal(fs.existsSync(path.join(d, 'otel', 'subindo.lock')), false);
});

test('porta ocupada (R6): o log da subida anterior vira o evento e o PID velho sai', () => {
  const d = novoDir();
  instalarFalso(d);
  gravarPid(d, 4242);
  fs.writeFileSync(path.join(d, 'otel', 'coletor.log'), 'Error: cannot start pipelines: listen tcp 127.0.0.1:47318: bind: address already in use\n');
  assert.equal(classificarLog(d), 'porta-ocupada');
  const chamadas = [];
  const r = subirColetor({ dir: d, agoraMs: Date.now(), plataforma: plat, memLivre: () => 8 * GiB, env: {}, gerar: gerarFalso(chamadas, 'y'), executar: consultaFalsa(new Set()) });
  assert.equal(r.ok, true);
  assert.equal(r.evento, 'porta-ocupada');
  fs.writeFileSync(path.join(d, 'otel', 'coletor.log'), 'Only one usage of each socket address (protocol/network address/port) is normally permitted.\n');
  assert.equal(classificarLog(d), 'porta-ocupada');
  fs.writeFileSync(path.join(d, 'otel', 'coletor.log'), 'panic: runtime error\n');
  assert.equal(classificarLog(d), 'coletor-falhou');
  fs.writeFileSync(path.join(d, 'otel', 'coletor.log'), '');
  assert.equal(classificarLog(d), null);
});

test('Foco de revisão 3: dois SessionStart ao mesmo tempo sobem um só Collector, sem porta-ocupada falso', async () => {
  const d = novoDir();
  instalarFalso(d);
  const rodar = () => new Promise((pronto) => {
    const filho = spawn(process.execPath, [PARALELO, d], { stdio: ['ignore', 'pipe', 'inherit'] });
    let saida = '';
    filho.stdout.on('data', (b) => { saida += b; });
    filho.on('close', () => pronto(JSON.parse(saida)));
  });
  const rs = await Promise.all([rodar(), rodar()]);
  assert.equal(fs.readFileSync(path.join(d, 'gerados.txt'), 'utf8').trim().split('\n').length, 1);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.every((r) => r.ok || r.motivo === 'vivo' || r.motivo === 'subindo'));
  assert.ok(rs.every((r) => r.evento === null));
});

test('pararColetor: confere o nome antes de matar; outro processo com o mesmo PID não é morto', () => {
  const d = novoDir();
  assert.deepEqual(pararColetor({ dir: d, plataforma: plat }), { ok: true, motivo: 'sem-pid' });
  gravarPid(d, 4242);
  const chamadas = [];
  const outro = (arquivo, args) => {
    chamadas.push({ arquivo, args });
    return '"notepad.exe","4242","Console","1","8.000 K"\r\n';
  };
  assert.deepEqual(pararColetor({ dir: d, plataforma: 'win32', executar: outro, systemRoot: 'C:\\Windows' }), { ok: false, motivo: 'outro-processo' });
  assert.ok(chamadas.every((c) => !c.arquivo.endsWith('taskkill.exe')));
  assert.equal(lerPid(d), null);

  gravarPid(d, 4242);
  const win = [];
  const executar = (arquivo, args) => {
    win.push({ arquivo, args });
    return '"otelcol-contrib.exe","4242","Console","1","80.000 K"\r\n';
  };
  assert.deepEqual(pararColetor({ dir: d, plataforma: 'win32', executar, systemRoot: 'C:\\Windows' }), { ok: true, motivo: 'parado' });
  assert.deepEqual(win.at(-1), { arquivo: 'C:\\Windows\\System32\\taskkill.exe', args: ['/pid', '4242', '/t', '/f'] });
  assert.equal(lerPid(d), null);

  gravarPid(d, 4242);
  const sinais = [];
  const r = pararColetor({ dir: d, plataforma: 'linux', executar: () => 'otelcol-contrib\n', matar: (pid, sinal) => sinais.push([pid, sinal]) });
  assert.deepEqual(r, { ok: true, motivo: 'parado' });
  assert.deepEqual(sinais, [[4242, 'SIGTERM']]);
});

test('coletorVivo e órfão (§3.3): vivo pelo nome; órfão com mais de 30 min sem sessão', () => {
  const d = novoDir();
  assert.deepEqual(coletorVivo(d, { plataforma: plat, executar: consultaFalsa(new Set()) }), { vivo: false, pid: null, emMs: null });
  const em = Date.now() - 60 * 60_000;
  gravarPid(d, 4242, em);
  assert.deepEqual(coletorVivo(d, { plataforma: plat, executar: consultaFalsa(new Set([4242])) }), { vivo: true, pid: 4242, emMs: em });
  const agora = Date.now();
  assert.equal(ehOrfao({ emMs: agora - ORFAO_MS - 1, ultimaOutraSessaoMs: null, agoraMs: agora }), true);
  assert.equal(ehOrfao({ emMs: agora - ORFAO_MS - 1, ultimaOutraSessaoMs: agora - 60_000, agoraMs: agora }), false);
  assert.equal(ehOrfao({ emMs: agora - 60_000, ultimaOutraSessaoMs: null, agoraMs: agora }), false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/aprendizado-coletor.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/coletor.js`.

- [ ] **Step 4: Escrever `src/aprendizado/coletor.js`**

Os valores de `MEMBRO_TAR`, `NOME_BINARIO`, `PORTA_OCUPADA` e `A3_ATRAPALHA` são os da Emenda A2/A3 (os abaixo são os padrões do plano; se a emenda disser outra coisa, vale a emenda e o teste de porta ocupada ganha a mensagem que ela registrou).

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { apagar, fechar, numeroFinito } from '../base.js';
import { gravarJsonAtomico } from '../estado.js';
import { lerSemLink } from '../guarda/arquivo.js';
import { RAM_MIN_BYTES } from '../uso/painel.js';
import { TETO, caminhos } from './arquivos.js';
import { configColetor } from './config-coletor.js';
import { ARQ_TELEMETRIA } from './otlp.js';

// Vida do Collector (spec aprendizado §3.3). É o ÚNICO módulo do aprendizado
// com processo filho (test/aprendizado-fronteiras.test.js): tar (R12),
// tasklist/ps, taskkill e o próprio Collector. No Windows, tudo do System32
// por caminho absoluto, como matarArvore em src/uso/oficial.js. O Collector
// sobe desanexado, sem janela, sem herdar o ambiente (só a lista de
// AMBIENTE_PERMITIDO: nada de OTEL_* nem segredo), com o stderr no
// otel/coletor.log, que é só classificado (R6), nunca repetido. O PID é
// conferido pelo nome do processo antes de matar. Nenhuma função lança.

export const NOME_BINARIO = Object.freeze({ win32: 'otelcol-contrib.exe', posix: 'otelcol-contrib' });
// Emenda A2: o membro do .tar.gz (na raiz, com o nome do binário).
export const MEMBRO_TAR = NOME_BINARIO;
// Emenda A2: a mensagem do Collector com a porta ocupada (Windows e POSIX).
export const PORTA_OCUPADA = /address already in use|only one usage of each socket address/i;
const FALHOU = /\b(?:error|panic|fatal)\b/i;
// Emenda A3: true se o Claude Code atrasa ou mostra erro com o endpoint fora
// do ar; então o SessionEnd não para o Collector enquanto houver sessão
// conhecida (24 h, o teto de sessão de estado.json).
export const A3_ATRAPALHA = false;
export const ORFAO_MS = 30 * 60_000;
export const OUTRA_SESSAO_MS = A3_ATRAPALHA ? 24 * 3_600_000 : 5 * 60_000;
const SUBINDO_VENCIDA_MS = 60_000;
const LOG_LIDO_MAX = 64 * 1024;
const EXTRAIR_PRAZO_MS = 120_000;
const CONSULTA_PRAZO_MS = 5_000;
const PEDACO = 1024 * 1024;
const AMBIENTE_PERMITIDO = Object.freeze(['SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'TZ']);
const POSIX = Object.freeze({ tar: ['/usr/bin/tar', '/bin/tar'], ps: ['/bin/ps', '/usr/bin/ps'] });

const ehWin = (plataforma) => plataforma === 'win32';
const nomeBinario = (plataforma) => (ehWin(plataforma) ? NOME_BINARIO.win32 : NOME_BINARIO.posix);
const membro = (plataforma) => (ehWin(plataforma) ? MEMBRO_TAR.win32 : MEMBRO_TAR.posix);

export function caminhoBinario(dir, plataforma = process.platform) {
  return path.join(caminhos(dir).bin, nomeBinario(plataforma));
}

function raizWindows(systemRoot) {
  return typeof systemRoot === 'string' && /^[A-Za-z]:[\\/]/.test(systemRoot) && !systemRoot.includes('\0') ? systemRoot : 'C:\\Windows';
}

function regular(arquivo) {
  try {
    return fs.lstatSync(arquivo, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

export function programa(nome, { plataforma = process.platform, systemRoot = process.env.SystemRoot } = {}) {
  if (ehWin(plataforma)) return path.win32.join(raizWindows(systemRoot), 'System32', `${nome}.exe`);
  const opcoes = POSIX[nome];
  if (opcoes === undefined) return null;
  return opcoes.find(regular) ?? opcoes[0];
}

export function hashArquivo(arquivo) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(PEDACO);
    let n;
    while ((n = fs.readSync(fd, buf, 0, PEDACO, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } finally {
    fechar(fd);
  }
}

// R7: o hash do binário extraído, com o tamanho e o mtime, para conferir de
// novo só quando um deles mudar.
export function registrarInstalacao(dir, plataforma = process.platform, hashar = hashArquivo) {
  try {
    const bin = caminhoBinario(dir, plataforma);
    const info = fs.lstatSync(bin);
    if (!info.isFile()) return { ok: false };
    const sha256 = hashar(bin);
    return { ok: gravarJsonAtomico(caminhos(dir).instalado, { v: 1, sha256, tamanho: info.size, mtimeMs: info.mtimeMs }).ok };
  } catch {
    return { ok: false };
  }
}

// R12: o tar do sistema, com cwd em otel/bin e só o membro fixado (nome
// relativo; nenhum caminho com acento ou espaço vai nos argumentos).
export function extrairColetor({ dir, tarGz, plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot } = {}) {
  const pasta = caminhos(dir).bin;
  const bin = caminhoBinario(dir, plataforma);
  try {
    if (path.dirname(path.resolve(tarGz)) !== path.resolve(pasta)) return { ok: false, motivo: 'extrair' };
    fs.mkdirSync(pasta, { recursive: true });
    apagar(bin);
    const tar = programa('tar', { plataforma, systemRoot });
    executar(tar, ['-xzf', path.basename(tarGz), membro(plataforma)], {
      cwd: pasta, windowsHide: true, timeout: EXTRAIR_PRAZO_MS, stdio: 'ignore',
    });
    if (!regular(bin)) {
      apagar(bin);
      return { ok: false, motivo: 'extrair' };
    }
    if (!ehWin(plataforma)) fs.chmodSync(bin, 0o755);
    if (!registrarInstalacao(dir, plataforma).ok) return { ok: false, motivo: 'extrair' };
    return { ok: true };
  } catch {
    apagar(bin);
    return { ok: false, motivo: 'extrair' };
  }
}

export function conferirIntegridade(dir, { plataforma = process.platform, hashar = hashArquivo } = {}) {
  try {
    const bin = caminhoBinario(dir, plataforma);
    const info = fs.lstatSync(bin, { throwIfNoEntry: false });
    if (!info || !info.isFile()) return { ok: false, motivo: 'coletor-ausente' };
    const l = lerSemLink(caminhos(dir).instalado, TETO.instalado);
    const inst = l.ok ? l.valor : null;
    if (inst === null || typeof inst !== 'object' || inst.v !== 1 || typeof inst.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(inst.sha256)) {
      return { ok: false, motivo: 'coletor-hash' };
    }
    if (inst.tamanho === info.size && inst.mtimeMs === info.mtimeMs) return { ok: true };
    if (hashar(bin) !== inst.sha256) return { ok: false, motivo: 'coletor-hash' };
    gravarJsonAtomico(caminhos(dir).instalado, { ...inst, tamanho: info.size, mtimeMs: info.mtimeMs });
    return { ok: true };
  } catch {
    return { ok: false, motivo: 'coletor-hash' };
  }
}

export function lerPid(dir) {
  try {
    const l = lerSemLink(caminhos(dir).pid, TETO.pid);
    const v = l.ok ? l.valor : null;
    if (v === null || typeof v !== 'object' || v.v !== 1 || !Number.isSafeInteger(v.pid) || v.pid <= 0) return null;
    const emMs = typeof v.em === 'string' && v.em.length <= 64 ? Date.parse(v.em) : Number.NaN;
    return { pid: v.pid, emMs: numeroFinito(emMs) ? emMs : null };
  } catch {
    return null;
  }
}

export function nomeDoProcesso(pid, { plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot } = {}) {
  try {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    if (ehWin(plataforma)) {
      const saida = String(executar(programa('tasklist', { plataforma, systemRoot }), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true, timeout: CONSULTA_PRAZO_MS, encoding: 'utf8',
      }));
      for (const linha of saida.split(/\r?\n/)) {
        const m = /^"([^"]{1,260})","(\d{1,10})"/.exec(linha.trim());
        if (m && Number(m[2]) === pid) return m[1];
      }
      return null;
    }
    const saida = String(executar(programa('ps', { plataforma }), ['-p', String(pid), '-o', 'comm='], {
      timeout: CONSULTA_PRAZO_MS, encoding: 'utf8',
    })).trim();
    return saida === '' ? null : path.posix.basename(saida);
  } catch {
    return null;
  }
}

const ehColetor = (nome, plataforma) => nome !== null && (ehWin(plataforma) ? nome.toLowerCase() === NOME_BINARIO.win32 : nome === NOME_BINARIO.posix);

export function coletorVivo(dir, opcoes = {}) {
  const p = lerPid(dir);
  if (p === null) return { vivo: false, pid: null, emMs: null };
  const plataforma = opcoes.plataforma ?? process.platform;
  return { vivo: ehColetor(nomeDoProcesso(p.pid, opcoes), plataforma), pid: p.pid, emMs: p.emMs };
}

// R6: o fim do log da subida anterior, só classificado.
export function classificarLog(dir) {
  let fd = null;
  try {
    const arq = caminhos(dir).log;
    const info = fs.lstatSync(arq, { throwIfNoEntry: false });
    if (!info || !info.isFile() || info.size === 0) return null;
    const n = Math.min(info.size, LOG_LIDO_MAX);
    const buf = Buffer.alloc(n);
    fd = fs.openSync(arq, 'r');
    fs.readSync(fd, buf, 0, n, info.size - n);
    const texto = buf.toString('utf8');
    if (PORTA_OCUPADA.test(texto)) return 'porta-ocupada';
    return FALHOU.test(texto) ? 'coletor-falhou' : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fechar(fd);
  }
}

function gravarTextoAtomico(arquivo, texto) {
  const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeSync(fd, texto);
    } finally {
      fechar(fd);
    }
    fs.renameSync(tmp, arquivo);
    return { ok: true };
  } catch {
    apagar(tmp);
    return { ok: false };
  }
}

// §3.2 passo 3: gerada pelo hadouken e regravada a cada subida.
export function gravarConfig(dir) {
  try {
    const c = caminhos(dir);
    fs.mkdirSync(c.otel, { recursive: true });
    const r = configColetor({ arquivoTelemetria: path.join(c.otel, ARQ_TELEMETRIA) });
    return r.ok ? gravarTextoAtomico(c.config, r.texto) : { ok: false };
  } catch {
    return { ok: false };
  }
}

function ambienteColetor(env) {
  const r = {};
  for (const k of AMBIENTE_PERMITIDO) if (typeof env?.[k] === 'string') r[k] = env[k];
  return r;
}

function pegarSubindo(arq) {
  for (let i = 0; i < 2; i++) {
    try {
      fechar(fs.openSync(arq, 'wx'));
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') return false;
      try {
        const info = fs.lstatSync(arq);
        if (!info.isFile() || Date.now() - info.mtimeMs < SUBINDO_VENCIDA_MS) return false;
        apagar(arq);
      } catch {
        /* sumiu entre o open e o lstat: tenta de novo */
      }
    }
  }
  return false;
}

// §3.3 SessionStart, sob a trava otel/subindo.lock (Foco de revisão 3: duas
// sessões juntas sobem um só Collector, e a segunda nunca tenta a porta).
export function subirColetor(opcoes) {
  const {
    dir, agoraMs, plataforma = process.platform, memLivre = os.freemem, env = process.env,
    gerar = spawn, executar = execFileSync, systemRoot = process.env.SystemRoot, hashar = hashArquivo,
  } = opcoes ?? {};
  let evento = null;
  let trava = null;
  try {
    const c = caminhos(dir);
    fs.mkdirSync(c.otel, { recursive: true });
    if (!pegarSubindo(c.subindo)) return { ok: false, motivo: 'subindo', evento };
    trava = c.subindo;
    const consulta = { plataforma, executar, systemRoot };
    const anterior = lerPid(dir);
    if (anterior !== null) {
      if (ehColetor(nomeDoProcesso(anterior.pid, consulta), plataforma)) return { ok: false, motivo: 'vivo', evento };
      evento = classificarLog(dir);
      apagar(c.pid);
    }
    let livre;
    try {
      livre = memLivre();
    } catch {
      livre = Number.NaN;
    }
    if (!numeroFinito(livre) || livre < RAM_MIN_BYTES) return { ok: false, motivo: 'pouca-ram', evento };
    const integ = conferirIntegridade(dir, { plataforma, hashar });
    if (!integ.ok) return { ok: false, motivo: integ.motivo, evento };
    if (!gravarConfig(dir).ok) return { ok: false, motivo: 'config', evento };
    apagar(c.log);
    const fdLog = fs.openSync(c.log, 'wx');
    let filho;
    try {
      filho = gerar(caminhoBinario(dir, plataforma), ['--config', c.config], {
        detached: true, windowsHide: true, stdio: ['ignore', 'ignore', fdLog], env: ambienteColetor(env), cwd: c.otel,
      });
    } finally {
      fechar(fdLog);
    }
    filho.on('error', () => { /* binário sumiu entre a conferência e o spawn: o próximo SessionStart vê pelo log */ });
    filho.unref();
    if (!Number.isSafeInteger(filho.pid) || filho.pid <= 0) return { ok: false, motivo: 'erro', evento };
    gravarJsonAtomico(c.pid, { v: 1, pid: filho.pid, em: new Date(numeroFinito(agoraMs) ? agoraMs : Date.now()).toISOString() });
    return { ok: true, pid: filho.pid, evento };
  } catch {
    return { ok: false, motivo: 'erro', evento };
  } finally {
    if (trava !== null) apagar(trava);
  }
}

// §3.3 SessionEnd: só mata o processo que tem o nome do Collector (um PID
// reaproveitado por outro programa nunca é morto); o arquivo de PID sai.
export function pararColetor(opcoes) {
  const {
    dir, plataforma = process.platform, executar = execFileSync, systemRoot = process.env.SystemRoot,
    matar = (pid, sinal) => process.kill(pid, sinal),
  } = opcoes ?? {};
  try {
    const p = lerPid(dir);
    if (p === null) return { ok: true, motivo: 'sem-pid' };
    const nome = nomeDoProcesso(p.pid, { plataforma, executar, systemRoot });
    apagar(caminhos(dir).pid);
    if (nome === null) return { ok: true, motivo: 'morto' };
    if (!ehColetor(nome, plataforma)) return { ok: false, motivo: 'outro-processo' };
    if (ehWin(plataforma)) {
      executar(programa('taskkill', { plataforma, systemRoot }), ['/pid', String(p.pid), '/t', '/f'], {
        windowsHide: true, timeout: CONSULTA_PRAZO_MS, stdio: 'ignore',
      });
    } else {
      matar(p.pid, 'SIGTERM');
    }
    return { ok: true, motivo: 'parado' };
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

// §3.3: vivo sem sessão por mais de 30 min, contando da subida ou da última
// outra sessão, o que for mais novo.
export function ehOrfao({ emMs, ultimaOutraSessaoMs, agoraMs }) {
  const ref = Math.max(numeroFinito(emMs) ? emMs : 0, numeroFinito(ultimaOutraSessaoMs) ? ultimaOutraSessaoMs : 0);
  return numeroFinito(agoraMs) && agoraMs - ref > ORFAO_MS;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/aprendizado-coletor.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS. O teste do tar usa o `tar` do sistema de verdade (System32 no Windows, `/usr/bin/tar` ou `/bin/tar` fora dele) com um `.tar.gz` montado no próprio teste; nenhum outro teste roda programa de sistema.

- [ ] **Step 6: Commit**

```powershell
git add -- src/aprendizado/coletor.js test/aprendizado-coletor.test.js test/fixtures/coletor-falso.mjs test/fixtures/subir-paralelo.mjs
git commit -m @'
feat: Collector lifecycle: extract with system tar, integrity check, detached start with allowlisted env, name-checked stop, port-busy from log (spec aprendizado 3.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/coletor.js test/aprendizado-coletor.test.js test/fixtures/coletor-falso.mjs test/fixtures/subir-paralelo.mjs
```

---

### Task 9: O `env` do `settings.json` (`settings-env.js`) sobre o gravador seguro (§3.2 passos 4 e 5, `desligar`, §6 última linha, §8 "Ligar e desligar", R1)

**Files:**
- Modify: `src/configuracao.js` (só uma linha de `export` no fim)
- Create: `src/aprendizado/settings-env.js`
- Test: `test/aprendizado-settings-env.test.js`

**Interfaces:**
- Consome: de `src/configuracao.js`, as funções internas que passam a ser exportadas sem mudar de comportamento: `lerSettings(arquivo) → { ok: true, existe: false, info: null } | { ok: true, existe: true, settings, bytes, texto, info, formato } | { ok: false, motivo, codigo? }`, `gravar(arquivo, lido, valor, agoraMs) → { ok: true, backup } | { ok: false, motivo, codigo? }` (exportada como `gravarSettings`) e `bloqueioDeEscrita(lido) → null | { ok: false, motivo: 'settings-somente-leitura' | 'settings-numero-impreciso' }`; `HOST`, `PORTA` (Task 2, `config-coletor.js`).
- Produz:
  - `ENDPOINT` (`'http://127.0.0.1:47318'`), `CHAVES_LIGAR` (as 9 chaves e valores, na ordem em que entram no `env`), `INTERRUPTORES_CONTEUDO`, `OUTROS_ENDPOINTS`
  - `interruptorLigado(valor) → boolean`
  - `planejarLigar(settings, ambiente) → { ok: true, adicionar: string[], criaEnv: boolean } | { ok: false, motivo: 'env-invalido' | 'conteudo-ligado' | 'outro-endpoint' | 'env-conflito' }`
  - `planejarDesligar(settings, ligado) → { remover: string[], removeEnv: boolean }`
  - `assinaturaSettings(lido) → string` (SHA-256 dos bytes em hex, ou `'ausente'`)
  - `consultarLigar({ arquivo, ambiente }) → { ok: true, assinatura, adicionar, criaEnv } | falha` (sem gravar nada)
  - `aplicarLigar({ arquivo, agoraMs, ambiente, esperado }) → { ok: true, adicionadas: { [K]: V }, criouEnv, backup: string | null } | falha` (`'settings-mudou'` se a assinatura não for `esperado`)
  - `aplicarDesligar({ arquivo, agoraMs, ligado }) → { ok: true, removidas: string[], backup: string | null } | falha`

- [ ] **Step 1: Exportar as três funções de `src/configuracao.js`**

No fim do arquivo, depois de `removerStatusline`, acrescente:

```js

// Aprendizado (spec aprendizado §3.2, R1): src/aprendizado/settings-env.js
// edita o `env` com as mesmas garantias da barra (sem link, teto, UTF-8,
// formato do original, backup, troca conferida pelo lstat).
export { lerSettings, gravar as gravarSettings, bloqueioDeEscrita };
```

- [ ] **Step 2: Escrever o teste**

Crie `test/aprendizado-settings-env.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aplicarDesligar, aplicarLigar, assinaturaSettings, CHAVES_LIGAR, consultarLigar, ENDPOINT, interruptorLigado,
  planejarDesligar, planejarLigar,
} from '../src/aprendizado/settings-env.js';
import { lerSettings } from '../src/configuracao.js';

// O `env` do settings.json (spec aprendizado §3.2, §8 "Ligar e desligar";
// Foco de revisão 1). Todo settings.json é temporário: nenhum teste toca o
// ~/.claude/settings.json de verdade.

const BOM = String.fromCodePoint(0xfeff);
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const dirs = [];
after(() => {
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) { try { fs.chmodSync(path.join(d, f), 0o644); } catch { /* link */ } }
    fs.rmSync(d, { recursive: true, force: true });
  }
});
function novoArquivo(conteudo) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk settings ç '));
  dirs.push(d);
  const arq = path.join(d, 'settings.json');
  if (conteudo !== undefined) fs.writeFileSync(arq, conteudo);
  return arq;
}
const esperadoDe = (arq) => assinaturaSettings(lerSettings(arq));
const ligadoDe = (r) => ({ chaves: r.adicionadas, criouEnv: r.criouEnv });

test('interruptores: só vazio, 0, false, no e off contam como desligado', () => {
  for (const v of [undefined, null, '', '0', 'false', 'FALSE', 'no', 'off', ' 0 ']) assert.equal(interruptorLigado(v), false, String(v));
  for (const v of ['1', 'true', 'yes', 'on', 1, true]) assert.equal(interruptorLigado(v), true, String(v));
});

test('planejarLigar: env que não é objeto é recusado', () => {
  for (const env of ['OTEL=1', ['a'], null, 7]) assert.deepEqual(planejarLigar({ env }, {}), { ok: false, motivo: 'env-invalido' });
});

test('§3.2 passo 5: conteúdo ligado no env ou no ambiente, ou outro endpoint, é recusado', () => {
  assert.deepEqual(planejarLigar({ env: { OTEL_LOG_USER_PROMPTS: '1' } }, {}), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(planejarLigar({}, { OTEL_LOG_RAW_API_BODIES: 'true' }), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(planejarLigar({}, { OTEL_LOG_TOOL_DETAILS: 'yes' }), { ok: false, motivo: 'conteudo-ligado' });
  assert.equal(planejarLigar({ env: { OTEL_LOG_USER_PROMPTS: '0' } }, {}).ok, true);
  assert.deepEqual(planejarLigar({ env: { OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://coletor.exemplo' } }, {}), { ok: false, motivo: 'outro-endpoint' });
  assert.deepEqual(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.0.5:4318' }), { ok: false, motivo: 'outro-endpoint' });
  assert.equal(planejarLigar({}, { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT }).ok, true, 'o nosso endpoint no ambiente é o de uma sessão já ligada');
  assert.deepEqual(planejarLigar({ env: { OTEL_METRICS_EXPORTER: 'console' } }, {}), { ok: false, motivo: 'env-conflito' });
});

test('planejarLigar: chave que já está com o mesmo valor não entra (e o desligar não a tira)', () => {
  const p = planejarLigar({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: 1 } }, {});
  assert.equal(p.ok, true);
  assert.equal(p.criaEnv, false);
  assert.deepEqual(p.adicionar, Object.keys(CHAVES_LIGAR).filter((k) => k !== 'CLAUDE_CODE_ENABLE_TELEMETRY'));
  assert.deepEqual(planejarLigar({}, {}).adicionar, Object.keys(CHAVES_LIGAR));
  assert.equal(planejarLigar({}, {}).criaEnv, true);
});

test('Foco de revisão 1: CRLF, BOM, tabulação e chaves do usuário antes e depois; desligar volta byte a byte', () => {
  const original = {
    permissions: { allow: ['Bash(ls)'] },
    env: { MINHA: 'x', OUTRA: 'y' },
    statusLine: { type: 'command', command: 'node "C:/x/statusline.mjs"', padding: 0 },
    zeta: 1,
  };
  const texto = `${BOM}${JSON.stringify(original, null, '\t').replace(/\n/g, '\r\n')}\r\n`;
  const arq = novoArquivo(texto);
  const antes = fs.readFileSync(arq);
  const c = consultarLigar({ arquivo: arq, ambiente: {} });
  assert.equal(c.ok, true);
  assert.deepEqual(fs.readFileSync(arq), antes, 'consultar não grava');
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: c.assinatura });
  assert.equal(r.ok, true);
  assert.equal(r.backup, `${arq}.bak-hadouken-${AGORA}`);
  assert.deepEqual(fs.readFileSync(r.backup), antes, 'a cópia é o original');
  const depois = fs.readFileSync(arq, 'utf8');
  assert.ok(depois.startsWith(BOM));
  assert.doesNotMatch(depois.replace(/\r\n/g, ''), /\n/, 'só CRLF');
  assert.match(depois, /\r\n\t"env": \{\r\n\t\t"MINHA": "x",/);
  const v = JSON.parse(depois.slice(1));
  assert.deepEqual(Object.keys(v), ['permissions', 'env', 'statusLine', 'zeta']);
  assert.deepEqual(Object.keys(v.env), ['MINHA', 'OUTRA', ...Object.keys(CHAVES_LIGAR)]);
  assert.deepEqual(r.adicionadas, CHAVES_LIGAR);
  assert.equal(r.criouEnv, false);
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) });
  assert.equal(d.ok, true);
  assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR));
  assert.deepEqual(fs.readFileSync(arq), antes, 'desligar devolve os bytes do original');
});

test('sem env: o ligar cria o env no fim e o desligar o tira inteiro', () => {
  const texto = '{\n  "model": "opus"\n}\n';
  const arq = novoArquivo(texto);
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  assert.equal(r.criouEnv, true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(arq, 'utf8'))), ['model', 'env']);
  assert.equal(aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) }).ok, true);
  assert.equal(fs.readFileSync(arq, 'utf8'), texto);
});

test('arquivo ausente: o ligar cria só o env; esperado "ausente"', () => {
  const arq = novoArquivo();
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: 'ausente' });
  assert.equal(r.ok, true);
  assert.equal(r.backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { env: CHAVES_LIGAR });
});

test('desligar tira só as chaves com o valor que o ligar gravou; chave nova do usuário fica no lugar', () => {
  const arq = novoArquivo('{\n  "env": {\n    "MINHA": "x"\n  }\n}\n');
  const r = aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) });
  const v = JSON.parse(fs.readFileSync(arq, 'utf8'));
  v.env.OTEL_LOGS_EXPORTER = 'console';
  v.env.DEPOIS = 'z';
  fs.writeFileSync(arq, `${JSON.stringify(v, null, 2)}\n`);
  const d = aplicarDesligar({ arquivo: arq, agoraMs: AGORA + 1, ligado: ligadoDe(r) });
  assert.equal(d.ok, true);
  assert.ok(!d.removidas.includes('OTEL_LOGS_EXPORTER'));
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).env, { MINHA: 'x', OTEL_LOGS_EXPORTER: 'console', DEPOIS: 'z' });
  assert.deepEqual(planejarDesligar({ env: 'x' }, ligadoDe(r)), { remover: [], removeEnv: false });
});

test('§6 última linha: settings.json mudou entre a prévia e a gravação → recusa sem gravar', () => {
  const arq = novoArquivo('{}\n');
  const esperado = esperadoDe(arq);
  fs.writeFileSync(arq, '{"model":"opus"}\n');
  const antes = fs.readFileSync(arq);
  assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado }), { ok: false, motivo: 'settings-mudou' });
  assert.deepEqual(fs.readFileSync(arq), antes);
  assert.equal(fs.readdirSync(path.dirname(arq)).length, 1, 'nem cópia nem temporário');
});

test('somente leitura e link são recusados sem gravar', (t) => {
  const arq = novoArquivo('{}\n');
  fs.chmodSync(arq, 0o444);
  assert.deepEqual(aplicarLigar({ arquivo: arq, agoraMs: AGORA, ambiente: {}, esperado: esperadoDe(arq) }), { ok: false, motivo: 'settings-somente-leitura' });
  fs.chmodSync(arq, 0o644);
  const link = path.join(path.dirname(arq), 'link.json');
  try {
    fs.symlinkSync(arq, link);
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link'); return; }
    throw e;
  }
  assert.deepEqual(consultarLigar({ arquivo: link, ambiente: {} }), { ok: false, motivo: 'settings-link' });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/aprendizado-settings-env.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/settings-env.js`.

- [ ] **Step 4: Escrever `src/aprendizado/settings-env.js`**

As quatro últimas chaves de `CHAVES_LIGAR` são as da Emenda A1 (os valores abaixo são os padrões do plano; se a emenda disser outra coisa, vale a emenda, e o teste segue igual porque compara com `CHAVES_LIGAR`).

```js
import crypto from 'node:crypto';
import { bloqueioDeEscrita, gravarSettings, lerSettings } from '../configuracao.js';
import { HOST, PORTA } from './config-coletor.js';

// O `env` do settings.json (spec aprendizado §3.2 passos 4 e 5, `desligar`,
// §6 última linha; R1). Toda leitura e gravação passa pelo gravador da barra
// (configuracao.js): sem link, teto de bytes, UTF-8 estrito, formato do
// original (BOM, CRLF, indentação), cópia <settings>.bak-hadouken-<ms> e troca
// conferida pelo lstat. O `ligar` só acrescenta as chaves de CHAVES_LIGAR que
// faltam (as que já estão com o mesmo valor ficam e não são "nossas"); o
// `desligar` só tira as que o `ligar` gravou e que ainda têm o valor dele.
// Recusa (§3.2 passo 5) com conteúdo ligado ou outro endpoint OTLP, no `env`
// ou no ambiente. Nenhuma função lança.

export const ENDPOINT = `http://${HOST}:${PORTA}`;
export const CHAVES_LIGAR = Object.freeze({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
  // Emenda A1: tira a conta das métricas; intervalos curtos para sessões
  // curtas; métricas em delta (o leitor só soma delta, otlp.js).
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: 'false',
  OTEL_METRIC_EXPORT_INTERVAL: '10000',
  OTEL_LOGS_EXPORT_INTERVAL: '5000',
  OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
});
export const INTERRUPTORES_CONTEUDO = Object.freeze(['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_LOG_RAW_API_BODIES']);
export const OUTROS_ENDPOINTS = Object.freeze([
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
]);
const DESLIGADO = new Set(['', '0', 'false', 'no', 'off']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const falha = (motivo) => ({ ok: false, motivo });
const valorDe = (obj, k) => (ehObjeto(obj) && Object.hasOwn(obj, k) ? obj[k] : undefined);

// "Ligado" é qualquer valor fora de vazio, 0, false, no e off (sem caixa e
// sem espaços nas pontas), como o Claude Code lê as chaves booleanas.
export function interruptorLigado(valor) {
  if (valor === undefined || valor === null) return false;
  try {
    return !DESLIGADO.has(String(valor).trim().toLowerCase());
  } catch {
    return true;
  }
}

export function planejarLigar(settings, ambiente) {
  const temEnv = ehObjeto(settings) && Object.hasOwn(settings, 'env');
  const env = temEnv ? settings.env : {};
  if (!ehObjeto(env)) return falha('env-invalido');
  for (const k of INTERRUPTORES_CONTEUDO) {
    if (interruptorLigado(valorDe(env, k)) || interruptorLigado(valorDe(ambiente, k))) return falha('conteudo-ligado');
  }
  for (const k of OUTROS_ENDPOINTS) {
    for (const v of [valorDe(env, k), valorDe(ambiente, k)]) {
      if (v !== undefined && v !== null && v !== '' && String(v) !== ENDPOINT) return falha('outro-endpoint');
    }
  }
  const adicionar = [];
  for (const [k, v] of Object.entries(CHAVES_LIGAR)) {
    const atual = valorDe(env, k);
    if (atual === undefined) adicionar.push(k);
    else if (String(atual) !== v) return falha('env-conflito');
  }
  return { ok: true, adicionar, criaEnv: !temEnv };
}

export function planejarDesligar(settings, ligado) {
  const env = valorDe(settings, 'env');
  if (!ehObjeto(env) || !ehObjeto(ligado?.chaves)) return { remover: [], removeEnv: false };
  const remover = Object.keys(ligado.chaves).filter((k) => Object.hasOwn(env, k) && env[k] === ligado.chaves[k]);
  const sobra = Object.keys(env).filter((k) => !remover.includes(k));
  return { remover, removeEnv: ligado.criouEnv === true && sobra.length === 0 };
}

// R4: a assinatura entra no código de confirmação; qualquer byte diferente
// entre a prévia e o ligar muda o código.
export function assinaturaSettings(lido) {
  return lido?.existe === true ? crypto.createHash('sha256').update(lido.bytes).digest('hex') : 'ausente';
}

function planoDoArquivo(arquivo, ambiente) {
  const lido = lerSettings(arquivo);
  if (!lido.ok) return lido;
  const settings = lido.existe ? lido.settings : {};
  const p = planejarLigar(settings, ambiente);
  if (!p.ok) return p;
  if (p.adicionar.length > 0) {
    const b = bloqueioDeEscrita(lido);
    if (b !== null) return b;
  }
  return { ok: true, lido, settings, ...p };
}

export function consultarLigar({ arquivo, ambiente } = {}) {
  try {
    const c = planoDoArquivo(arquivo, ambiente);
    return c.ok ? { ok: true, assinatura: assinaturaSettings(c.lido), adicionar: c.adicionar, criaEnv: c.criaEnv } : c;
  } catch {
    return falha('erro-interno');
  }
}

export function aplicarLigar({ arquivo, agoraMs, ambiente, esperado } = {}) {
  try {
    const c = planoDoArquivo(arquivo, ambiente);
    if (!c.ok) return c;
    if (assinaturaSettings(c.lido) !== esperado) return falha('settings-mudou');
    if (c.adicionar.length === 0) return { ok: true, adicionadas: {}, criouEnv: false, backup: null };
    const adicionadas = Object.fromEntries(c.adicionar.map((k) => [k, CHAVES_LIGAR[k]]));
    // Espalhar mantém a posição de `env` e das chaves do usuário; as nossas
    // entram no fim do `env` (ou o `env` entra no fim do arquivo).
    const env = c.criaEnv ? adicionadas : { ...c.settings.env, ...adicionadas };
    const g = gravarSettings(arquivo, c.lido, { ...c.settings, env }, agoraMs);
    return g.ok ? { ok: true, adicionadas, criouEnv: c.criaEnv, backup: g.backup } : g;
  } catch {
    return falha('erro-interno');
  }
}

export function aplicarDesligar({ arquivo, agoraMs, ligado } = {}) {
  try {
    const lido = lerSettings(arquivo);
    if (!lido.ok) return lido;
    if (!lido.existe) return { ok: true, removidas: [], backup: null };
    const p = planejarDesligar(lido.settings, ligado);
    if (p.remover.length === 0 && !p.removeEnv) return { ok: true, removidas: [], backup: null };
    const b = bloqueioDeEscrita(lido);
    if (b !== null) return b;
    const novo = { ...lido.settings };
    if (p.removeEnv) {
      delete novo.env;
    } else {
      const env = { ...lido.settings.env };
      for (const k of p.remover) delete env[k];
      novo.env = env;
    }
    const g = gravarSettings(arquivo, lido, novo, agoraMs);
    return g.ok ? { ok: true, removidas: p.remover, backup: g.backup } : g;
  } catch {
    return falha('erro-interno');
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/aprendizado-settings-env.test.js test/configuracao.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS (o caso do link pode sair como `skip` no Windows sem modo de desenvolvedor). `configuracao.test.js` prova que a barra não mudou.

- [ ] **Step 6: Commit**

```powershell
git add -- src/configuracao.js src/aprendizado/settings-env.js test/aprendizado-settings-env.test.js
git commit -m @'
feat: settings.json env editing for learning on the safe writer: add-only, remove-only-ours, format kept (spec aprendizado 3.2, 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/configuracao.js src/aprendizado/settings-env.js test/aprendizado-settings-env.test.js
```

---

### Task 10: Orquestração do `ligar` e do `desligar` (`ligar.js`) (§3.2, `desligar`, §6 primeira e última linhas, R4, R5, R7, R8)

**Files:**
- Create: `src/aprendizado/ligar.js`
- Test: `test/aprendizado-ligar.test.js`

**Interfaces:**
- Consome: `consultarLigar`, `aplicarLigar`, `aplicarDesligar`, `CHAVES_LIGAR` (Task 9); `VERSAO_COLETOR`, `FIXADO`, `TAMANHO_MAX`, `plataformaAtual`, `urlDoColetor`, `baixarColetor` (Task 7); `A3_ATRAPALHA`, `conferirIntegridade`, `extrairColetor`, `gravarConfig`, `subirColetor`, `pararColetor` (Task 8); `HOST`, `PORTA` (Task 2); `caminhos`, `ARQ_OTEL`, `ligadoExiste` (Task 4, `arquivos.js`); `lerLigado`, `gravarLigado`, `apagarLigado`, `pegarTrava` (Task 4, `registro.js`).
- Produz:
  - `previa({ dir, arquivo, ambiente?, plataforma?, arch?, integridade? }) → { ok: true, plano, assinatura, codigo } | { ok: false, motivo: 'ja-ligado' | 'plataforma' | <motivos de consultarLigar> }`, com `plano = { versao, chave, url, tamanhoMax, host, porta, pasta, arquivo, adicionar, criaEnv, baixar }` e `codigo` = 8 hex (R4). Não grava nada.
  - `ligar({ dir, arquivo, codigo, agoraMs, ambiente?, plataforma?, arch?, baixar?, extrair?, subir?, parar?, aplicar?, integridade?, exigirColetor?, opcoesBaixar?, executar?, systemRoot? }) → Promise<{ ok: true, plano, backup } | { ok: false, motivo: <de previa> | 'codigo' | 'download' | 'extrair' | 'config' | 'coletor' | 'escrita' | <de aplicarLigar>, detalhe? }>` (nunca rejeita)
  - `desligar({ dir, arquivo, agoraMs, apagar?: 'nada' | 'dados' | 'tudo', parar?, plataforma?, executar?, systemRoot? }) → { ok: true, removidas, backup, parado, apagou, pasta, ligadoInvalido } | { ok: false, motivo: 'desligado' | 'ocupado' | 'erro' | 'uso' | <de aplicarDesligar> }`

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-ligar.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhos, ligadoExiste } from '../src/aprendizado/arquivos.js';
import { FIXADO } from '../src/aprendizado/baixar.js';
import { caminhoBinario, registrarInstalacao } from '../src/aprendizado/coletor.js';
import { desligar, ligar, previa } from '../src/aprendizado/ligar.js';
import { lerLigado } from '../src/aprendizado/registro.js';
import { CHAVES_LIGAR } from '../src/aprendizado/settings-env.js';

// O ligar e o desligar de ponta a ponta (spec aprendizado §3.2, §6, R4),
// com download, extração, subida e parada falsos. Pasta de dados e
// settings.json temporários; ambiente vazio (nunca o process.env de quem roda
// o teste, que pode ter OTEL_* de verdade).

const [PLATAFORMA, ARCH] = Object.keys(FIXADO)[0].split('-');
const CHAVE = `${PLATAFORMA}-${ARCH}`;
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const ORIGINAL = '{\n  "model": "opus",\n  "env": {\n    "MINHA": "x"\n  }\n}\n';
const tmps = [];
after(() => {
  for (const d of tmps) {
    try { fs.chmodSync(path.join(d, 'settings.json'), 0o644); } catch { /* não existe */ }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function cenario() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk ligar ç '));
  tmps.push(raiz);
  const dir = path.join(raiz, 'hadouken');
  fs.mkdirSync(dir);
  const arquivo = path.join(raiz, 'settings.json');
  fs.writeFileSync(arquivo, ORIGINAL);
  return { raiz, dir, arquivo };
}
const listar = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : []);
const baixarOk = async ({ destino, chave }) => {
  assert.equal(chave, CHAVE);
  fs.writeFileSync(destino, 'tar.gz falso');
  return { ok: true, bytes: 12 };
};
function extrairOk({ dir, tarGz }) {
  assert.ok(fs.existsSync(tarGz), 'extrai do .tar.gz baixado');
  fs.writeFileSync(caminhoBinario(dir, PLATAFORMA), 'binário falso');
  return { ok: registrarInstalacao(dir, PLATAFORMA).ok };
}
const nuncaBaixar = async () => { throw new Error('não devia baixar'); };
const base = (c, extra = {}) => ({
  dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA, ambiente: {}, plataforma: PLATAFORMA, arch: ARCH,
  baixar: baixarOk, extrair: extrairOk, parar: () => ({ ok: true, motivo: 'sem-pid' }),
  // A Emenda A3 decide o padrão; aqui ele é fixo, e os dois testes que exigem
  // o Collector o ligam explicitamente com subir falso.
  exigirColetor: false,
  subir: () => { throw new Error('não devia subir'); },
  ...extra,
});
async function ligado(c, extra = {}) {
  const p = previa(base(c));
  assert.equal(p.ok, true);
  const r = await ligar(base(c, { codigo: p.codigo, ...extra }));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test('§3.2 passo 1 e R4: a prévia mostra o plano e o código e não grava nada', () => {
  const c = cenario();
  const antes = listar(c.raiz);
  const p = previa(base(c));
  assert.equal(p.ok, true);
  assert.match(p.codigo, /^[0-9a-f]{8}$/);
  assert.equal(p.plano.chave, CHAVE);
  assert.equal(p.plano.host, '127.0.0.1');
  assert.equal(p.plano.porta, 47318);
  assert.equal(p.plano.pasta, caminhos(c.dir).otel);
  assert.equal(p.plano.arquivo, c.arquivo);
  assert.equal(p.plano.baixar, true);
  assert.deepEqual(p.plano.adicionar, Object.keys(CHAVES_LIGAR));
  assert.deepEqual(listar(c.raiz), antes);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(previa(base(c)).codigo, p.codigo, 'o código é estável');
});

test('código errado ou settings.json mudado depois da prévia: recusa sem gravar', async () => {
  const c = cenario();
  const p = previa(base(c));
  assert.deepEqual(await ligar(base(c, { codigo: '00000000' })), { ok: false, motivo: 'codigo' });
  assert.deepEqual(await ligar(base(c)), { ok: false, motivo: 'codigo' });
  fs.writeFileSync(c.arquivo, ORIGINAL.replace('opus', 'sonnet'));
  assert.deepEqual(await ligar(base(c, { codigo: p.codigo })), { ok: false, motivo: 'codigo' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
});

test('§3.2: ligar baixa, extrai, apaga o .tar.gz, gera a configuração, grava ligado.json e o env', async () => {
  const c = cenario();
  const r = await ligado(c);
  const cm = caminhos(c.dir);
  assert.equal(fs.existsSync(path.join(cm.bin, FIXADO[CHAVE].arquivo)), false, 'o .tar.gz sai');
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.ok(fs.existsSync(cm.config));
  assert.ok(ligadoExiste(c.dir));
  assert.deepEqual(lerLigado(c.dir), { chaves: CHAVES_LIGAR, criouEnv: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(c.arquivo, 'utf8')).env, { MINHA: 'x', ...CHAVES_LIGAR });
  assert.equal(r.backup, `${c.arquivo}.bak-hadouken-${AGORA}`);
  assert.equal(previa(base(c)).motivo, 'ja-ligado');
});

test('§6 primeira linha: hash errado no download → nada fica, settings.json intacto', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, {
    codigo: p.codigo,
    baixar: async ({ destino }) => { fs.writeFileSync(destino, 'meio'); return { ok: false, motivo: 'hash' }; },
    extrair: () => { throw new Error('não devia extrair'); },
  }));
  assert.deepEqual(r, { ok: false, motivo: 'download', detalhe: 'hash' });
  assert.equal(fs.existsSync(path.join(caminhos(c.dir).bin, FIXADO[CHAVE].arquivo)), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('falha na extração → .tar.gz apagado e nada ligado', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, { codigo: p.codigo, extrair: () => ({ ok: false, motivo: 'extrair' }) }));
  assert.deepEqual(r, { ok: false, motivo: 'extrair' });
  assert.equal(fs.existsSync(path.join(caminhos(c.dir).bin, FIXADO[CHAVE].arquivo)), false);
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('R7: binário já instalado e conferido → não baixa de novo', async () => {
  const c = cenario();
  fs.mkdirSync(caminhos(c.dir).bin, { recursive: true });
  fs.writeFileSync(caminhoBinario(c.dir, PLATAFORMA), 'binário falso');
  assert.equal(registrarInstalacao(c.dir, PLATAFORMA).ok, true);
  const p = previa(base(c));
  assert.equal(p.plano.baixar, false);
  const r = await ligar(base(c, { codigo: p.codigo, baixar: nuncaBaixar }));
  assert.equal(r.ok, true);
});

test('§3.2 passo 5: conteúdo ligado no ambiente → recusa na prévia e no ligar', async () => {
  const c = cenario();
  const ambiente = { OTEL_LOG_USER_PROMPTS: '1' };
  assert.deepEqual(previa(base(c, { ambiente })), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(await ligar(base(c, { ambiente, codigo: '00000000', baixar: nuncaBaixar })), { ok: false, motivo: 'conteudo-ligado' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
});

test('a gravação do settings.json falha → ligado.json sai e o Collector que subiu é parado', async () => {
  const c = cenario();
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: () => ({ ok: true, pid: 4242, evento: null }),
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
    aplicar: () => ({ ok: false, motivo: 'settings-mudou' }),
  }));
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(parou, 1);
});

test('Emenda A3: com exigirColetor, sem RAM → não liga e não toca o settings.json', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, { codigo: p.codigo, exigirColetor: true, subir: () => ({ ok: false, motivo: 'pouca-ram', evento: null }) }));
  assert.deepEqual(r, { ok: false, motivo: 'coletor', detalhe: 'pouca-ram' });
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('desligar: tira as chaves, para o Collector, apaga ligado.json e mantém os dados', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  fs.writeFileSync(cm.aprendizado, '{}');
  let parou = 0;
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => { parou++; return { ok: true, motivo: 'parado' }; } });
  assert.equal(d.ok, true);
  assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR));
  assert.equal(d.parado, true);
  assert.equal(d.apagou, false);
  assert.equal(parou, 1);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
  assert.ok(fs.existsSync(cm.aprendizado));
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.equal(fs.existsSync(cm.trava), false, 'a trava sai');
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 2 }), { ok: false, motivo: 'desligado' });
});

test('desligar dados: apaga agregados, ajustes, sugestões, cursor, eventos e a telemetria; fica o binário', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  for (const k of ['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']) fs.writeFileSync(cm[k], '{}');
  fs.writeFileSync(path.join(cm.otel, 'telemetria.jsonl'), '{}\n');
  fs.writeFileSync(path.join(cm.otel, 'telemetria-2026-10-01T00-00-00.000.jsonl'), '{}\n');
  fs.writeFileSync(path.join(c.dir, 'estado.json'), '{"v":1}');
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'dados', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(d.apagou, true);
  for (const k of ['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']) assert.equal(fs.existsSync(cm[k]), false, k);
  assert.deepEqual(fs.readdirSync(cm.otel), ['bin']);
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.ok(fs.existsSync(path.join(c.dir, 'estado.json')), 'os arquivos da barra e da guarda ficam');
});

test('desligar tudo: a pasta otel inteira sai, inclusive o binário; funciona já desligado', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(fs.existsSync(cm.otel), false);
  const deNovo = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 2, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(deNovo.ok, true);
  assert.equal(deNovo.pasta, cm.otel);
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 3, apagar: 'metade' }), { ok: false, motivo: 'uso' });
});

test('desligar com settings.json somente leitura: recusa, ligado.json fica e o Collector não é parado', async () => {
  const c = cenario();
  await ligado(c);
  fs.chmodSync(c.arquivo, 0o444);
  let parou = 0;
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => { parou++; return { ok: true, motivo: 'parado' }; } });
  assert.deepEqual(d, { ok: false, motivo: 'settings-somente-leitura' });
  assert.equal(parou, 0);
  assert.ok(ligadoExiste(c.dir));
});

test('ligado.json inválido: desligar não mexe no settings.json e avisa', async () => {
  const c = cenario();
  await ligado(c);
  fs.writeFileSync(caminhos(c.dir).ligado, 'não é JSON');
  const antes = fs.readFileSync(c.arquivo);
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(d.ligadoInvalido, true);
  assert.deepEqual(d.removidas, []);
  assert.deepEqual(fs.readFileSync(c.arquivo), antes);
  assert.equal(ligadoExiste(c.dir), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-ligar.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/ligar.js`.

- [ ] **Step 3: Escrever `src/aprendizado/ligar.js`**

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apagar } from '../base.js';
import { ARQ_OTEL, caminhos, ligadoExiste } from './arquivos.js';
import { baixarColetor, FIXADO, plataformaAtual, TAMANHO_MAX, urlDoColetor, VERSAO_COLETOR } from './baixar.js';
import { A3_ATRAPALHA, conferirIntegridade, extrairColetor, gravarConfig, pararColetor, subirColetor } from './coletor.js';
import { HOST, PORTA } from './config-coletor.js';
import { apagarLigado, gravarLigado, lerLigado, pegarTrava } from './registro.js';
import { aplicarDesligar, aplicarLigar, CHAVES_LIGAR, consultarLigar } from './settings-env.js';

// O `ligar` e o `desligar` (spec aprendizado §3.2 e `desligar`). Dois tempos
// (R4): a prévia só lê e devolve o plano e um código de 8 hex; o `ligar
// <código>` refaz a prévia e só segue se o código bate, isto é, se nem o
// settings.json nem o plano mudaram. A ordem do ligar deixa tudo como estava
// em qualquer falha: baixa e confere o hash (baixar.js), extrai e apaga o
// .tar.gz (coletor.js, R7), gera a configuração, grava otel/ligado.json (R8,
// o que o desligar tira) e só então o `env` do settings.json (settings-env.js);
// se o settings.json falha, o ligado.json sai. Rede e processo filho ficam
// nos módulos de fronteira; este só os chama. Nenhuma função lança.

const ALCANCES = Object.freeze(['nada', 'dados', 'tudo']);
const DADOS = Object.freeze(['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']);
const falha = (motivo, detalhe) => (detalhe === undefined ? { ok: false, motivo } : { ok: false, motivo, detalhe });

function codigoDe(assinatura, plano) {
  return crypto.createHash('sha256').update(`${assinatura}\0${JSON.stringify(plano)}`).digest('hex').slice(0, 8);
}

export function previa(opcoes = {}) {
  try {
    const {
      dir, arquivo, ambiente = process.env, plataforma = process.platform, arch = process.arch, integridade = conferirIntegridade,
    } = opcoes;
    if (typeof dir !== 'string' || typeof arquivo !== 'string') return falha('erro-interno');
    if (ligadoExiste(dir)) return falha('ja-ligado');
    const chave = plataformaAtual(plataforma, arch);
    if (chave === null) return falha('plataforma');
    const c = consultarLigar({ arquivo, ambiente });
    if (!c.ok) return c;
    const plano = {
      versao: VERSAO_COLETOR,
      chave,
      url: urlDoColetor(chave),
      tamanhoMax: TAMANHO_MAX,
      host: HOST,
      porta: PORTA,
      pasta: caminhos(dir).otel,
      arquivo,
      adicionar: c.adicionar,
      criaEnv: c.criaEnv,
      baixar: !integridade(dir, { plataforma }).ok,
    };
    return { ok: true, plano, assinatura: c.assinatura, codigo: codigoDe(c.assinatura, plano) };
  } catch {
    return falha('erro-interno');
  }
}

export async function ligar(opcoes = {}) {
  const {
    dir, arquivo, codigo, agoraMs, ambiente = process.env, plataforma = process.platform, arch = process.arch,
    baixar = baixarColetor, extrair = extrairColetor, subir = subirColetor, parar = pararColetor, aplicar = aplicarLigar,
    integridade = conferirIntegridade, exigirColetor = A3_ATRAPALHA, opcoesBaixar = {}, executar, systemRoot,
  } = opcoes;
  let tarGz = null;
  let subiu = false;
  try {
    const p = previa({ dir, arquivo, ambiente, plataforma, arch, integridade });
    if (!p.ok) return p;
    if (typeof codigo !== 'string' || codigo.toLowerCase() !== p.codigo) return falha('codigo');
    const c = caminhos(dir);
    fs.mkdirSync(c.bin, { recursive: true });
    if (p.plano.baixar) {
      tarGz = path.join(c.bin, FIXADO[p.plano.chave].arquivo);
      const b = await baixar({ ...opcoesBaixar, destino: tarGz, chave: p.plano.chave });
      if (!b?.ok) return falha('download', typeof b?.motivo === 'string' ? b.motivo : 'rede');
      const x = extrair({ dir, tarGz, plataforma, executar, systemRoot });
      if (!x?.ok) return falha('extrair');
    }
    if (!gravarConfig(dir).ok) return falha('config');
    // Emenda A3: se o Claude Code atrapalha com o endpoint fora do ar, o
    // Collector tem de estar de pé antes de o env entrar no settings.json.
    if (exigirColetor) {
      const s = subir({ dir, agoraMs, plataforma, executar, systemRoot });
      if (s?.ok) subiu = true;
      else if (s?.motivo !== 'vivo') return falha('coletor', typeof s?.motivo === 'string' ? s.motivo : 'erro');
    }
    const chaves = Object.fromEntries(p.plano.adicionar.map((k) => [k, CHAVES_LIGAR[k]]));
    if (!gravarLigado(dir, { chaves, criouEnv: p.plano.criaEnv }, agoraMs).ok) {
      if (subiu) parar({ dir, plataforma, executar, systemRoot });
      return falha('escrita');
    }
    const a = aplicar({ arquivo, agoraMs, ambiente, esperado: p.assinatura });
    if (!a?.ok) {
      apagarLigado(dir);
      if (subiu) parar({ dir, plataforma, executar, systemRoot });
      return a?.motivo ? a : falha('erro-interno');
    }
    return { ok: true, plano: p.plano, backup: a.backup };
  } catch {
    return falha('erro-interno');
  } finally {
    if (tarGz !== null) apagar(tarGz);
  }
}

// Tira uma entrada sem seguir link: link e arquivo saem sozinhos; pasta de
// verdade sai inteira. maxRetries cobre o Windows, que segura o binário ou o
// telemetria.jsonl por alguns ms depois do taskkill.
function tirar(alvo) {
  try {
    const info = fs.lstatSync(alvo, { throwIfNoEntry: false });
    if (!info) return true;
    fs.rmSync(alvo, { recursive: info.isDirectory(), force: true, maxRetries: 5, retryDelay: 100 });
    return fs.lstatSync(alvo, { throwIfNoEntry: false }) === undefined;
  } catch {
    return false;
  }
}

function apagarDados(dir, tudo) {
  const c = caminhos(dir);
  let ok = true;
  for (const k of DADOS) ok = tirar(c[k]) && ok;
  let info;
  try {
    info = fs.lstatSync(c.otel, { throwIfNoEntry: false });
  } catch {
    return false;
  }
  if (!info) return ok;
  if (!info.isDirectory() || tudo) return tirar(c.otel) && ok;
  for (const nome of fs.readdirSync(c.otel)) {
    if (nome !== ARQ_OTEL.bin) ok = tirar(path.join(c.otel, nome)) && ok;
  }
  return ok;
}

export function desligar(opcoes = {}) {
  const {
    dir, arquivo, agoraMs, apagar: alcance = 'nada', parar = pararColetor, plataforma = process.platform, executar, systemRoot,
  } = opcoes;
  if (!ALCANCES.includes(alcance)) return falha('uso');
  if (typeof dir !== 'string' || typeof arquivo !== 'string') return falha('erro');
  const estavaLigado = ligadoExiste(dir);
  if (!estavaLigado && alcance === 'nada') return falha('desligado');
  const t = pegarTrava(dir);
  if (!t.ok) return falha(t.motivo === 'ocupada' ? 'ocupado' : 'erro');
  try {
    let removidas = [];
    let backup = null;
    let ligadoInvalido = false;
    if (estavaLigado) {
      const l = lerLigado(dir);
      if (l === null) {
        ligadoInvalido = true;
      } else {
        const d = aplicarDesligar({ arquivo, agoraMs, ligado: l });
        if (!d.ok) return d;
        removidas = d.removidas;
        backup = d.backup;
      }
    }
    const pr = parar({ dir, plataforma, executar, systemRoot });
    apagarLigado(dir);
    const apagou = alcance === 'nada' ? false : apagarDados(dir, alcance === 'tudo');
    return {
      ok: true, removidas, backup, parado: pr?.ok === true && pr.motivo === 'parado', apagou, pasta: caminhos(dir).otel, ligadoInvalido,
    };
  } catch {
    return falha('erro');
  } finally {
    t.soltar();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/aprendizado-ligar.test.js test/aprendizado-settings-env.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS. Nenhum teste baixa, extrai com o `tar` ou sobe processo: tudo é falso e injetado.

- [ ] **Step 5: Commit**

```powershell
git add -- src/aprendizado/ligar.js test/aprendizado-ligar.test.js
git commit -m @'
feat: two-step ligar (preview code over settings bytes and plan), rollback-safe order, desligar with nada/dados/tudo (spec aprendizado 3.2, 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/ligar.js test/aprendizado-ligar.test.js
```

---

### Task 11: O comando `/claude-hadouken:aprender` (§3.2 "Outros subcomandos", §4.5, §4.6, §4.7, R4, R5; Foco de revisão 5)

**Files:**
- Create: `src/aprendizado/mensagens.js`, `src/aprendizado/comando.js`, `src/hooks/aprender.js`, `skills/aprender/SKILL.md`
- Modify: `hooks/hooks.json` (uma entrada no `UserPromptExpansion`), `test/guarda-ameacas.test.js` (o filtro do teste de ligação)
- Test: `test/aprendizado-mensagens.test.js`, `test/aprendizado-comando.test.js`

**Interfaces:**
- Consome: `previa`, `ligar`, `desligar` (Task 10); `CHAVES_LIGAR` (Task 9); `desfazer`, `aprovar`, `recusar`, `PISO_MS`, `PISO_SESSOES`, `BLOQUEIO_MS` (Task 5); `lerConfigGuardaBase` (Task 6); `coletorVivo` (Task 8); `ITENS`, `ligadoExiste` (Task 4); `lerAprendizado`, `lerAjustes`, `gravarAjustes`, `lerSugestoes`, `gravarSugestoes`, `lerEventosApr`, `anexarEventoApr`, `pegarTrava`, `diaLocal`, `ORIGEM_VALIDA` (Task 4); `HOST`, `PORTA` (Task 2); `ARQ_TELEMETRIA` (Task 2); `arquivoSettings` (`src/configuracao.js`); `MODELO_VALIDO` (`src/guarda/registros.js`); `decimal` (`src/util.js`); `RAM_MIN_BYTES` (`src/uso/painel.js`); `rodarHook`, `emitirJson` (`src/hooks/comum.js`); `dirDados` (`src/base.js`).
- Produz:
  - `mensagens.js`: as constantes `USO`, `RECUSADO_ENTRYPOINT`, `DESLIGADO`, `OCUPADO`, `FALHOU`, `NAO_GRAVADO`, `SEM_SUGESTAO`, `MUDOU`; `anuncio(registros, nSugestoes) → string | null`; `avisoColetor(tipo) → string | null`; `textoModelo(sugestao) → string | null`; `status({ ligado, ap, aj, sug, eventos, vivo, agoraMs }) → string`; `previa(plano, codigo)`, `ligado(r)`, `falhaLigar(r)`, `falhaSettings(motivo)`, `desligado(r, alcance)`, `falhaDesligar(r)`, `desfeito(registro)`, `falhaDesfazer(motivo)`, `aprovadoAfrouxar(registro)`, `aprovadoModelo(sugestao)`, `recusado(sugestao)` → `string`
  - `comando.js`: `interpretarComando(texto) → { sub: 'status' | 'ligar' | 'desligar' | 'desfazer' | 'aprovar' | 'recusar', arg: string | null } | null`; `executarComando({ dir, texto, agoraMs, entrypoint, ambiente?, arquivo?, deps? }) → Promise<string>` (nunca rejeita; `deps.ligar` e `deps.desligar` são repassados às funções da Task 10, para os testes)
  - o hook `src/hooks/aprender.js`: sempre `{ decision: 'block', reason }`

- [ ] **Step 1: Escrever o teste das mensagens**

Crie `test/aprendizado-mensagens.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as msg from '../src/aprendizado/mensagens.js';
import { aprendizadoVazio } from '../src/aprendizado/agregar.js';
import { ajustesVazios, sugestoesVazias } from '../src/aprendizado/registro.js';

// Textos fixos do aprendizado (spec aprendizado §3.2 "Mensagens só de modelos
// fixos", §4.5, §4.6): números validados, rótulos do código, caminhos que o
// hadouken calculou; nada de telemetria, arquivo ou stdin é repetido.

const AGORA = Date.UTC(2026, 9, 20, 15, 0, 0);
const DIA = 86_400_000;
const CONTROLE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u;
const reg = (id, item, antes, depois, extra = {}) => ({ id, item, antes, depois, motivo: 'fora-do-horario', em: new Date(AGORA - DIA).toISOString(), origem: 'auto', ...extra });
const MODELO = {
  id: 's3', estado: 'pendente', em: new Date(AGORA - DIA).toISOString(), tipo: 'modelo', origem: 'sub:revisor',
  de: { modelo: 'claude-opus-5-5', effort: 'high' }, para: { modelo: 'claude-sonnet-5-5', effort: 'high' }, razao: 3, erroDe: 1.5, erroPara: 2,
};

test('§4.6: a linha do SessionStart, com o texto exato da spec', () => {
  assert.equal(
    msg.anuncio([reg('a1', 'painel.intervaloS', 30, 60)], 1),
    'Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status).',
  );
  assert.equal(
    msg.anuncio([reg('a1', 'painel.intervaloS', 30, 60), reg('a2', 'painel.amarelo', 75, 70, { motivo: 'faixa-historico' })], 2),
    'Aprendizado: 2 ajustes novos (faixa amarela 75→70% e mais 1), 2 sugestões (use /claude-hadouken:aprender status).',
  );
  assert.equal(msg.anuncio([], 1), 'Aprendizado: 1 sugestão (use /claude-hadouken:aprender status).');
  assert.equal(msg.anuncio([reg('a4', 'guarda.fableTetoPct', null, 85, { motivo: 'esgotou-2-de-3' })], 0),
    'Aprendizado: 1 ajuste novo (teto do Fable config.json→85%) (use /claude-hadouken:aprender status).');
  assert.equal(msg.anuncio([], 0), null);
  assert.equal(msg.anuncio([{ item: '__proto__' }], 0), null);
});

test('§4.5: o texto da sugestão de modelo segue o modelo fixo da spec', () => {
  assert.equal(
    msg.textoModelo(MODELO),
    'No seu uso, os pedidos do subagente revisor com claude-sonnet-5-5·high custaram 3× menos que com claude-opus-5-5·high, com erros parecidos (2% contra 1,5%). É um indício pelo custo e pelos erros, não uma medida de qualidade.',
  );
  assert.match(msg.textoModelo({ ...MODELO, origem: 'principal', razao: 3.3, para: { modelo: 'claude-haiku-5', effort: '-' } }),
    /^No seu uso, os pedidos da sessão principal com claude-haiku-5 custaram 3,3× menos que com claude-opus-5-5·high,/);
  for (const ruim of [
    { ...MODELO, de: { modelo: 'opus\u202e', effort: 'high' } },
    { ...MODELO, para: { modelo: 'a b', effort: 'high' } },
    { ...MODELO, origem: 'sub:<script>' },
    { ...MODELO, para: { modelo: 'x', effort: 'turbo' } },
    { ...MODELO, razao: Number.NaN },
  ]) assert.equal(msg.textoModelo(ruim), null);
});

test('avisos do Collector: um por tipo, todos fixos', () => {
  for (const t of ['porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-ausente', 'coletor-falhou', 'sem-otel']) {
    const a = msg.avisoColetor(t);
    assert.match(a, /^Aprendizado: /, t);
    assert.doesNotMatch(a, CONTROLE, t);
  }
  assert.match(msg.avisoColetor('porta-ocupada'), /127\.0\.0\.1:47318/);
  assert.match(msg.avisoColetor('pouca-ram'), /1,5 GiB/);
  assert.equal(msg.avisoColetor('ajuste-fora'), null);
  assert.equal(msg.avisoColetor('toString'), null);
});

test('status: piso, Collector, ajustes em vigor, sugestões pendentes, registros e eventos', () => {
  const ap = { ...aprendizadoVazio(AGORA - 3 * DIA), sessoes: 5 };
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 60;
  aj.registros.push(reg('a1', 'painel.intervaloS', 30, 60));
  const sug = sugestoesVazias();
  sug.lista.push(MODELO, { id: 's4', estado: 'pendente', em: MODELO.em, tipo: 'afrouxar', item: 'guarda.fableTetoPct', de: 80, para: 85 });
  const t = msg.status({ ligado: true, ap, aj, sug, eventos: [{ at: new Date(AGORA - DIA).toISOString(), tipo: 'porta-ocupada' }], vivo: false, agoraMs: AGORA });
  assert.match(t, /^hadouken: aprendizado ligado\.$/m);
  assert.match(t, /Dados: 3 dias e 5 sessões\. Ajustes e sugestões começam com 7 dias e 20 sessões\./);
  assert.match(t, /Collector: parado/);
  assert.match(t, /- intervalo do painel fora do horário: 60 s \(a1, automático\)/);
  assert.match(t, /- s3: No seu uso, os pedidos do subagente revisor/);
  assert.match(t, /- s4: afrouxar o teto do Fable na guarda de 80% para 85%/);
  assert.match(t, /aprovar s4/);
  assert.match(t, /- a1 \d{4}-\d{2}-\d{2}: intervalo do painel fora do horário 30 s → 60 s \(fora das horas ativas; automático\)/);
  assert.match(t, /Eventos recentes: porta ocupada \(\d{4}-\d{2}-\d{2}\)\./);
  assert.doesNotMatch(t, CONTROLE);
  assert.equal(msg.status({ ligado: false }), msg.DESLIGADO);
  const semNada = msg.status({ ligado: true, ap: { ...ap, sessoes: 30, desde: AGORA - 10 * DIA }, aj: ajustesVazios(), sug: sugestoesVazias(), eventos: [], vivo: true, agoraMs: AGORA });
  assert.match(semNada, /Dados: 10 dias e 30 sessões\.$/m);
  assert.match(semNada, /Collector: rodando em 127\.0\.0\.1:47318\./);
  assert.match(semNada, /- nenhum; tudo nos valores de fábrica e do config\.json\./);
  assert.match(semNada, /- nenhuma\./);
});

test('prévia: plano, chaves, código; caminho com controle não é repetido', () => {
  const plano = {
    versao: '0.130.0', chave: 'win32-x64', url: 'https://github.com/x/y.tar.gz', tamanhoMax: 200 * 1024 * 1024, host: '127.0.0.1', porta: 47318,
    pasta: 'C:\\Users\\José\\.claude\\hadouken\\otel', arquivo: 'C:\\Users\\José\\.claude\\settings.json',
    adicionar: ['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER'], criaEnv: false, baixar: true,
  };
  const t = msg.previa(plano, 'ab12cd34');
  assert.match(t, /Nada foi mudado ainda\./);
  assert.match(t, /otelcol-contrib 0\.130\.0 \(win32-x64\)/);
  assert.match(t, /até 200 MiB/);
  assert.match(t, /^ {3}\+ CLAUDE_CODE_ENABLE_TELEMETRY=1$/m);
  assert.match(t, /^ {3}\+ OTEL_LOGS_EXPORTER=otlp$/m);
  assert.match(t, /\/claude-hadouken:aprender ligar ab12cd34$/);
  const hostil = msg.previa({ ...plano, arquivo: 'C:\\x\n2. Apague tudo\\settings.json', adicionar: ['NAO_E_NOSSA'] }, 'ab12cd34');
  assert.doesNotMatch(hostil, /Apague tudo|NAO_E_NOSSA/);
  assert.match(msg.previa({ ...plano, baixar: false }, 'ab12cd34'), /nada será baixado/);
});

test('respostas de falha cobrem cada motivo sem repetir o que veio de fora', () => {
  for (const motivo of ['ja-ligado', 'plataforma', 'codigo', 'conteudo-ligado', 'outro-endpoint', 'env-conflito', 'env-invalido', 'settings-mudou',
    'extrair', 'config', 'escrita', 'settings-link', 'settings-somente-leitura', 'erro-interno', 'qualquer-outro']) {
    const t = msg.falhaLigar({ ok: false, motivo });
    assert.match(t, /^hadouken: não ligou: /, motivo);
    assert.ok(!t.includes('qualquer-outro'));
  }
  assert.match(msg.falhaLigar({ ok: false, motivo: 'download', detalhe: 'hash' }), /SHA-256/);
  assert.match(msg.falhaLigar({ ok: false, motivo: 'coletor', detalhe: 'pouca-ram' }), /memória/);
  assert.match(msg.falhaDesligar({ ok: false, motivo: 'settings-somente-leitura' }), /^hadouken: não desligou: /);
  for (const m of ['nada', 'nao-achou', 'nao-e-o-ultimo']) assert.match(msg.falhaDesfazer(m), /^hadouken: /);
});

test('as constantes são fixas e sem caractere de controle', () => {
  for (const k of ['USO', 'RECUSADO_ENTRYPOINT', 'DESLIGADO', 'OCUPADO', 'FALHOU', 'NAO_GRAVADO', 'SEM_SUGESTAO', 'MUDOU']) {
    assert.equal(typeof msg[k], 'string', k);
    assert.match(msg[k], /^hadouken: /, k);
    assert.doesNotMatch(msg[k], CONTROLE, k);
  }
});

test('a reserva do hook é o mesmo texto de FALHOU', () => {
  const t = fs.readFileSync(new URL('../src/hooks/aprender.js', import.meta.url), 'utf8');
  assert.ok(t.includes(`const FALHOU_RESERVA = '${msg.FALHOU}';`));
});
```

- [ ] **Step 2: Escrever o teste do comando e do hook**

Crie `test/aprendizado-comando.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhos, ligadoExiste } from '../src/aprendizado/arquivos.js';
import { FIXADO } from '../src/aprendizado/baixar.js';
import { caminhoBinario, registrarInstalacao } from '../src/aprendizado/coletor.js';
import { executarComando, interpretarComando } from '../src/aprendizado/comando.js';
import * as msg from '../src/aprendizado/mensagens.js';
import { ajustesVazios, gravarAjustes, gravarLigado, gravarSugestoes, lerAjustes, lerSugestoes } from '../src/aprendizado/registro.js';

// O comando /claude-hadouken:aprender (spec aprendizado §3.2, R4) e o Foco de
// revisão 5: vindo de uma sessão `claude -p` filha (CLAUDE_CODE_ENTRYPOINT
// sdk-*), nada é gravado. Pasta de dados e settings.json temporários.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOK = path.join(repo, 'src', 'hooks', 'aprender.js');
const [PLATAFORMA, ARCH] = Object.keys(FIXADO)[0].split('-');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

function cenario({ ligado = false } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk aprender ç '));
  tmps.push(raiz);
  const dir = path.join(raiz, 'hadouken');
  const cfg = path.join(raiz, 'cfg');
  fs.mkdirSync(dir);
  fs.mkdirSync(cfg);
  const arquivo = path.join(cfg, 'settings.json');
  fs.writeFileSync(arquivo, '{\n  "model": "opus"\n}\n');
  const agora = Date.now();
  if (ligado) {
    const em = new Date(agora - 86_400_000).toISOString();
    assert.equal(gravarLigado(dir, { chaves: {}, criouEnv: false }, agora).ok, true);
    const aj = ajustesVazios();
    aj.seq = 1;
    aj.vigentes['guarda.fableTetoPct'] = 80;
    aj.registros.push({ id: 'a1', item: 'guarda.fableTetoPct', antes: null, depois: 80, motivo: 'esgotou-2-de-3', em, origem: 'auto' });
    assert.equal(gravarAjustes(dir, aj).ok, true);
    assert.equal(gravarSugestoes(dir, {
      v: 1, seq: 1, lista: [{ id: 's1', estado: 'pendente', em, tipo: 'afrouxar', item: 'guarda.fableTetoPct', de: 80, para: 85 }],
    }).ok, true);
  }
  return { raiz, dir, cfg, arquivo };
}

function fotografar(raiz) {
  const r = {};
  for (const rel of fs.readdirSync(raiz, { recursive: true }).map(String).sort()) {
    const p = path.join(raiz, rel);
    r[rel] = fs.lstatSync(p).isDirectory() ? 'pasta' : fs.readFileSync(p).toString('base64');
  }
  return r;
}

function rodarHook(c, args, entrypoint) {
  const env = {
    ...process.env, HADOUKEN_HOME: c.dir, HADOUKEN_SETTINGS: c.arquivo, CLAUDE_CONFIG_DIR: c.cfg, HADOUKEN_SEM_PAINEL: '1',
    CLAUDE_CODE_ENTRYPOINT: entrypoint,
  };
  assert.ok(env.HADOUKEN_HOME.startsWith(os.tmpdir()));
  const entrada = {
    session_id: 'sessao-teste', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
    command_name: 'claude-hadouken:aprender', command_args: args,
  };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('gramática: subcomando, argumento validado, no máximo duas partes', () => {
  const casos = [
    ['', { sub: 'status', arg: null }],
    ['  STATUS ', { sub: 'status', arg: null }],
    ['ligar', { sub: 'ligar', arg: null }],
    ['ligar AB12cd34', { sub: 'ligar', arg: 'ab12cd34' }],
    ['desligar', { sub: 'desligar', arg: null }],
    ['desligar dados', { sub: 'desligar', arg: 'dados' }],
    ['desligar tudo', { sub: 'desligar', arg: 'tudo' }],
    ['desfazer', { sub: 'desfazer', arg: null }],
    ['desfazer a12', { sub: 'desfazer', arg: 'a12' }],
    ['aprovar s1', { sub: 'aprovar', arg: 's1' }],
    ['recusar s999999', { sub: 'recusar', arg: 's999999' }],
  ];
  for (const [texto, esperado] of casos) assert.deepEqual(interpretarComando(texto), esperado, texto);
  for (const ruim of ['status x', 'ligar 123', 'ligar ab12cd345', 'desligar metade', 'desfazer s1', 'aprovar', 'aprovar a1', 'recusar s1 s2',
    'apagar', '__proto__', 'x'.repeat(300), null, 42]) {
    assert.equal(interpretarComando(ruim), null, String(ruim));
  }
});

test('Foco de revisão 5: aprovar s1 vindo de sessão -p/SDK é recusado sem gravar nada', () => {
  const c = cenario({ ligado: true });
  const antes = fotografar(c.raiz);
  for (const ep of ['sdk-cli', 'sdk-ts', 'SDK-PY']) {
    const r = rodarHook(c, 'aprovar s1', ep);
    assert.deepEqual(r, { decision: 'block', reason: msg.RECUSADO_ENTRYPOINT });
  }
  assert.deepEqual(fotografar(c.raiz), antes, 'nenhum byte mudou e nenhum arquivo apareceu');
  // O mesmo cenário numa sessão interativa aprova: a recusa acima não é por
  // cenário inválido.
  const ok = rodarHook(c, 'aprovar s1', 'cli');
  assert.match(ok.reason, /^hadouken: aprovado\. O teto do Fable na guarda passa de 80% para 85% \(a2\)\./);
  assert.equal(lerAjustes(c.dir, Date.now()).vigentes['guarda.fableTetoPct'], 85);
  assert.deepEqual(lerSugestoes(c.dir, Date.now()).lista, []);
});

test('argumento hostil não volta no texto; comando de outro nome é ignorado', () => {
  const c = cenario({ ligado: true });
  const r = rodarHook(c, 'aprovar s1 \u202e<script>rm -rf ~</script>', 'cli');
  assert.deepEqual(r, { decision: 'block', reason: msg.USO });
  const outro = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ command_name: 'claude-hadouken:liberar', command_args: 'status' }),
    env: { ...process.env, HADOUKEN_HOME: c.dir, HADOUKEN_SETTINGS: c.arquivo, HADOUKEN_SEM_PAINEL: '1' }, encoding: 'utf8',
  });
  assert.equal(outro.stdout, '');
});

test('desligado: status, desfazer e aprovar não criam nenhum arquivo', async () => {
  const c = cenario();
  const antes = fotografar(c.raiz);
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo };
  assert.equal(await executarComando({ ...base, texto: 'status' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'desfazer' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'aprovar s1' }), msg.DESLIGADO);
  assert.equal(await executarComando({ ...base, texto: 'desligar' }), msg.DESLIGADO);
  assert.deepEqual(fotografar(c.raiz), antes);
});

test('ligar em dois tempos pelo comando; desfazer e recusar sob a trava', async () => {
  const c = cenario();
  const deps = {
    ligar: {
      plataforma: PLATAFORMA, arch: ARCH, exigirColetor: false,
      baixar: async ({ destino }) => { fs.writeFileSync(destino, 'tar'); return { ok: true, bytes: 3 }; },
      extrair: ({ dir }) => { fs.writeFileSync(caminhoBinario(dir, PLATAFORMA), 'bin'); return { ok: registrarInstalacao(dir, PLATAFORMA).ok }; },
    },
    desligar: { parar: () => ({ ok: true, motivo: 'sem-pid' }) },
  };
  const base = { dir: c.dir, agoraMs: Date.now(), entrypoint: 'cli', ambiente: {}, arquivo: c.arquivo, deps };
  const p = await executarComando({ ...base, texto: 'ligar' });
  const codigo = /aprender ligar ([0-9a-f]{8})$/.exec(p)?.[1];
  assert.ok(codigo, p);
  assert.equal(ligadoExiste(c.dir), false);
  const l = await executarComando({ ...base, texto: `ligar ${codigo}` });
  assert.match(l, /^hadouken: aprendizado ligado\./);
  assert.ok(ligadoExiste(c.dir));
  assert.equal(JSON.parse(fs.readFileSync(c.arquivo, 'utf8')).env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:47318');
  assert.match(await executarComando({ ...base, texto: 'status' }), /^hadouken: aprendizado ligado\./);
  assert.match(await executarComando({ ...base, texto: 'desfazer' }), /^hadouken: não há ajuste para desfazer\./);
  assert.equal(await executarComando({ ...base, texto: 'recusar s9' }), msg.SEM_SUGESTAO);
  fs.writeFileSync(caminhos(c.dir).trava, '');
  assert.equal(await executarComando({ ...base, texto: 'desfazer' }), msg.OCUPADO);
  fs.rmSync(caminhos(c.dir).trava);
  const d = await executarComando({ ...base, texto: 'desligar' });
  assert.match(d, /^hadouken: aprendizado desligado\./);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), '{\n  "model": "opus"\n}\n');
});

test('hooks.json liga o aprender com timeout de 600 s (R5) e a skill é inerte', () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const grupo = h.UserPromptExpansion.find((g) => g.matcher === 'claude-hadouken:aprender');
  assert.deepEqual(grupo.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/aprender.js'], timeout: 600 }]);
  const t = fs.readFileSync(path.join(repo, 'skills', 'aprender', 'SKILL.md'), 'utf8');
  const [, fm, corpo] = t.split(/^---$/m);
  assert.match(fm, /^name: aprender$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  assert.match(corpo, /nada foi mudado/);
  assert.doesNotMatch(corpo, /\bnode\b|ligado\.json|ajustes\.json|\$ARGUMENTS|`/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/aprendizado-mensagens.test.js test/aprendizado-comando.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/mensagens.js`.

- [ ] **Step 4: Escrever `src/aprendizado/mensagens.js`**

```js
import path from 'node:path';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { RAM_MIN_BYTES } from '../uso/painel.js';
import { decimal } from '../util.js';
import { BLOQUEIO_MS, PISO_MS, PISO_SESSOES } from './ajustar.js';
import { ITENS } from './arquivos.js';
import { HOST, PORTA } from './config-coletor.js';
import { ARQ_TELEMETRIA } from './otlp.js';
import { diaLocal, ORIGEM_VALIDA } from './registro.js';
import { CHAVES_LIGAR } from './settings-env.js';

// Textos do aprendizado (spec aprendizado §3.2 "Mensagens só de modelos
// fixos", §4.5, §4.6), como src/guarda/mensagens.js. Só entram números
// validados, rótulos deste arquivo, constantes do código e caminhos que o
// hadouken calculou (sem caractere de controle ou invisível). A única
// exceção, só no status e na sugestão de modelo (que só o usuário vê, pela
// `reason` do decision:block): nomes de modelo que casam MODELO_VALIDO e de
// subagente que casam SUBAGENTE, conferidos de novo aqui.

const CMD = '/claude-hadouken:aprender';
const DIA_MS = 86_400_000;
const DIAS_BLOQUEIO = Math.round(BLOQUEIO_MS / DIA_MS);
const INVISIVEL = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', '-']);
const SUBAGENTE = /^[A-Za-z0-9._-]{1,40}$/;

export const USO = `hadouken: uso: ${CMD} [status | ligar [código] | desligar [dados | tudo] | desfazer [aN] | aprovar sN | recusar sN]. Nada foi mudado.`;
export const RECUSADO_ENTRYPOINT = 'hadouken: o aprendizado só aceita comandos digitados pelo usuário numa sessão interativa. Nada foi mudado.';
export const DESLIGADO = `hadouken: o aprendizado está desligado. Para ligar: ${CMD} ligar.`;
export const OCUPADO = 'hadouken: o aprendizado está ocupado com outra sessão. Tente de novo em alguns segundos. Nada foi mudado.';
export const FALHOU = `hadouken: o comando falhou. Confira o estado com ${CMD} status.`;
export const NAO_GRAVADO = `hadouken: a mudança não pôde ser gravada. Confira o estado com ${CMD} status.`;
export const SEM_SUGESTAO = `hadouken: não há sugestão pendente com esse id. Veja ${CMD} status.`;
export const MUDOU = 'hadouken: essa sugestão não vale mais (o ajuste ou o config.json mudou desde ela) e foi retirada. Nada foi aplicado.';

// Rótulo longo (status), rótulo curto (linha de §4.6), unidade e o que vem
// depois do valor na linha curta.
const ROTULO = Object.freeze({
  'painel.intervaloS': Object.freeze({ nome: 'intervalo do painel fora do horário', curto: 'painel', unidade: ' s', fim: ' fora do horário' }),
  'painel.amarelo': Object.freeze({ nome: 'faixa amarela do painel', curto: 'faixa amarela', unidade: '%', fim: '' }),
  'painel.vermelho': Object.freeze({ nome: 'faixa vermelha do painel', curto: 'faixa vermelha', unidade: '%', fim: '' }),
  'previsao.pesoPerfil': Object.freeze({ nome: 'peso do perfil por hora na previsão', curto: 'peso do perfil na previsão', unidade: '', fim: '' }),
  'guarda.fableTetoPct': Object.freeze({ nome: 'teto do Fable na guarda', curto: 'teto do Fable', unidade: '%', fim: '' }),
  'guarda.teto7d': Object.freeze({ nome: 'teto de 7d na guarda', curto: 'teto de 7d', unidade: '%', fim: '' }),
});
const MOTIVO_TXT = Object.freeze({
  'fora-do-horario': 'fora das horas ativas',
  'horario-mudou': 'as horas ativas mudaram',
  'faixa-historico': 'antecedência no seu histórico',
  'perfil-por-hora': 'ritmo por hora com cobertura',
  'perfil-insuficiente': 'ritmo por hora sem cobertura',
  'esgotou-2-de-3': 'esgotou em 2 das últimas 3 semanas',
  'sobra-4-semanas': 'sobra nas últimas 4 semanas',
  desfazer: 'desfeito pelo senhor',
});
const ORIGEM_REG = Object.freeze({ auto: 'automático', aprovado: 'aprovado', desfeito: 'desfeito' });
const EVENTO_TXT = Object.freeze({
  'porta-ocupada': 'porta ocupada',
  'pouca-ram': 'pouca memória',
  'coletor-hash': 'hash do Collector diferente',
  'coletor-falhou': 'Collector parou com erro',
  'coletor-ausente': 'binário do Collector ausente',
  'ajuste-fora': 'ajuste fora dos limites descartado',
  erro: 'erro no passo',
  'sem-otel': 'sem telemetria',
  orfao: 'Collector órfão reiniciado',
  'telemetria-corrompida': 'telemetria corrompida ignorada',
});
const AVISO = Object.freeze({
  'porta-ocupada': `Aprendizado: o Collector não subiu porque a porta ${HOST}:${PORTA} está ocupada por outro programa. Segue só com os dados dos hooks.`,
  'pouca-ram': `Aprendizado: o Collector não subiu com menos de ${decimal(RAM_MIN_BYTES / 1024 ** 3, 1)} GiB de memória livre. Segue só com os dados dos hooks.`,
  'coletor-hash': `Aprendizado: o binário do Collector não confere com o hash registrado e não foi executado. Rode ${CMD} desligar tudo e ligue de novo.`,
  'coletor-ausente': `Aprendizado: o binário do Collector não está na pasta. Rode ${CMD} desligar tudo e ligue de novo.`,
  'coletor-falhou': 'Aprendizado: o Collector parou com erro na última subida. Segue só com os dados dos hooks.',
  'sem-otel': 'Aprendizado: ainda não chegou telemetria do Claude Code; ela vale a partir da sessão seguinte ao ligar. Segue com os dados dos hooks.',
});
const SETTINGS_TXT = Object.freeze({
  'settings-link': 'o settings.json é um link; o hadouken não segue links',
  'settings-invalido': 'o settings.json não é um JSON válido',
  'settings-grande': 'o settings.json passa do tamanho que o hadouken aceita',
  'settings-ilegivel': 'o settings.json não pôde ser lido',
  'settings-somente-leitura': 'o settings.json está somente leitura',
  'settings-numero-impreciso': 'o settings.json tem um número que não voltaria igual depois de gravado',
  'settings-mudou': `o settings.json mudou no meio; rode ${CMD} de novo`,
  'backup-existe': 'já existe uma cópia com o mesmo instante; rode de novo',
  'hadouken-settings-invalido': 'HADOUKEN_SETTINGS não é um caminho absoluto',
  'config-dir-invalido': 'CLAUDE_CONFIG_DIR não é um caminho absoluto',
  'sem-diretorio': 'não achei a pasta do usuário',
  'env-invalido': 'o env do settings.json não é um objeto',
});
const LIGAR_TXT = Object.freeze({
  'ja-ligado': `o aprendizado já está ligado. Veja ${CMD} status.`,
  plataforma: 'não há Collector fixado no código para esta plataforma. Nada foi mudado.',
  codigo: `o código não confere: o settings.json ou o plano mudou desde a prévia. Rode ${CMD} ligar de novo. Nada foi mudado.`,
  'conteudo-ligado': 'OTEL_LOG_USER_PROMPTS, OTEL_LOG_TOOL_DETAILS ou OTEL_LOG_RAW_API_BODIES está ligado (no env do settings.json ou no ambiente). O hadouken não liga com conteúdo na telemetria. Nada foi mudado.',
  'outro-endpoint': 'já há outro endpoint OTLP configurado. O hadouken não sobrescreve a telemetria que já existe. Nada foi mudado.',
  'env-conflito': 'o env do settings.json já tem uma chave de telemetria com outro valor. O hadouken não sobrescreve. Nada foi mudado.',
  extrair: 'a extração com o tar do sistema falhou; o .tar.gz foi apagado e o settings.json não mudou.',
  config: 'a configuração do Collector não pôde ser gravada; o settings.json não mudou.',
  escrita: 'otel/ligado.json não pôde ser gravado; o settings.json não mudou.',
});
const DOWNLOAD_TXT = Object.freeze({
  rede: 'sem rede ou conexão interrompida',
  http: 'resposta inesperada do servidor',
  host: 'redirecionamento para um endereço fora da lista',
  grande: 'arquivo maior que o teto',
  prazo: 'passou do prazo',
  hash: 'o SHA-256 não confere com o fixado no código; o arquivo foi apagado',
  escrita: 'não deu para gravar na pasta',
  plataforma: 'sem versão fixada para esta plataforma',
});
const COLETOR_TXT = Object.freeze({
  'pouca-ram': 'pouca memória livre',
  subindo: 'outra sessão está subindo o Collector',
  'coletor-ausente': 'binário ausente',
  'coletor-hash': 'binário fora do hash',
  config: 'configuração não gravada',
});

const temRotulo = (item) => typeof item === 'string' && Object.hasOwn(ROTULO, item);
const caminhoTxt = (p) => (typeof p === 'string' && p.length > 0 && p.length <= 1024 && !INVISIVEL.test(p) ? p : '(caminho com caractere de controle; confira a pasta à mão)');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const numero = (n) => (Number.isInteger(n) ? String(n) : decimal(n, 1));
const dia = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? diaLocal(t) : '?';
};

function numeroDoItem(item, v) {
  if (v === null) return 'config.json';
  return ITENS[item].decimal ? decimal(v, 1) : String(v);
}

function valorTxt(item, v) {
  return v === null ? 'o valor do config.json' : `${numeroDoItem(item, v)}${ROTULO[item].unidade}`;
}

function curto(r) {
  const d = ROTULO[r.item];
  const depois = r.depois === null ? 'config.json' : `${numeroDoItem(r.item, r.depois)}${d.unidade}`;
  return `${d.curto} ${numeroDoItem(r.item, r.antes)}→${depois}${d.fim}`;
}

// §4.6: no máximo uma vez por dia (quem decide é passo.js).
export function anuncio(registros, nSugestoes) {
  const lista = Array.isArray(registros) ? registros.filter((r) => temRotulo(r?.item)) : [];
  const n = Number.isSafeInteger(nSugestoes) && nSugestoes > 0 ? nSugestoes : 0;
  const partes = [];
  if (lista.length > 0) {
    const mais = lista.length > 1 ? ` e mais ${lista.length - 1}` : '';
    partes.push(`${plural(lista.length, 'ajuste novo', 'ajustes novos')} (${curto(lista[lista.length - 1])}${mais})`);
  }
  if (n > 0) partes.push(plural(n, 'sugestão', 'sugestões'));
  return partes.length === 0 ? null : `Aprendizado: ${partes.join(', ')} (use ${CMD} status).`;
}

export function avisoColetor(tipo) {
  return typeof tipo === 'string' && Object.hasOwn(AVISO, tipo) ? AVISO[tipo] : null;
}

function modeloTxt(m) {
  if (m === null || typeof m !== 'object' || typeof m.modelo !== 'string' || !MODELO_VALIDO.test(m.modelo) || INVISIVEL.test(m.modelo)) return null;
  if (!EFFORTS.has(m.effort)) return null;
  return m.effort === '-' ? m.modelo : `${m.modelo}·${m.effort}`;
}

function origemTxt(o) {
  if (typeof o !== 'string' || !ORIGEM_VALIDA.test(o)) return null;
  if (o === 'principal') return 'os pedidos da sessão principal';
  if (o === 'sub') return 'os pedidos de subagentes';
  if (o === 'outro') return 'os pedidos de outras origens';
  const nome = o.slice(4);
  return SUBAGENTE.test(nome) ? `os pedidos do subagente ${nome}` : null;
}

// §4.5, o texto fixo da spec: "a medida é indireta".
export function textoModelo(s) {
  const de = modeloTxt(s?.de);
  const para = modeloTxt(s?.para);
  const origem = origemTxt(s?.origem);
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1000;
  if (de === null || para === null || origem === null || !ok(s.razao) || !ok(s.erroDe) || !ok(s.erroPara)) return null;
  return `No seu uso, ${origem} com ${para} custaram ${numero(s.razao)}× menos que com ${de}, com erros parecidos (${numero(s.erroPara)}% contra ${numero(s.erroDe)}%). É um indício pelo custo e pelos erros, não uma medida de qualidade.`;
}

function textoSugestao(s) {
  if (s.tipo === 'afrouxar' && temRotulo(s.item)) {
    return `afrouxar o ${ROTULO[s.item].nome} de ${valorTxt(s.item, s.de)} para ${valorTxt(s.item, s.para)} (nunca acima do config.json).`;
  }
  if (s.tipo === 'modelo') {
    const t = textoModelo(s);
    return t === null ? null : `${t} Aprovar só registra; a troca de modelo é sua.`;
  }
  return null;
}

export function status({ ligado, ap, aj, sug, eventos, vivo, agoraMs } = {}) {
  if (ligado !== true) return DESLIGADO;
  const l = ['hadouken: aprendizado ligado.'];
  const dias = Math.max(0, Math.floor((agoraMs - ap.desde) / DIA_MS));
  const noPiso = agoraMs - ap.desde >= PISO_MS && ap.sessoes >= PISO_SESSOES;
  const piso = noPiso ? '' : ` Ajustes e sugestões começam com ${Math.round(PISO_MS / DIA_MS)} dias e ${PISO_SESSOES} sessões.`;
  l.push(`Dados: ${plural(dias, 'dia', 'dias')} e ${plural(ap.sessoes, 'sessão', 'sessões')}.${piso}`);
  l.push(vivo ? `Collector: rodando em ${HOST}:${PORTA}.` : 'Collector: parado; sobe no próximo início de sessão.');
  l.push('Ajustes em vigor:');
  const mudados = Object.keys(ITENS).filter((item) => aj.vigentes[item] !== ITENS[item].padrao);
  if (mudados.length === 0) l.push('- nenhum; tudo nos valores de fábrica e do config.json.');
  for (const item of mudados) {
    const r = [...aj.registros].reverse().find((x) => x.item === item);
    l.push(`- ${ROTULO[item].nome}: ${valorTxt(item, aj.vigentes[item])}${r ? ` (${r.id}, ${ORIGEM_REG[r.origem]})` : ''}`);
  }
  l.push('Sugestões pendentes:');
  const pendentes = sug.lista.filter((s) => s.estado === 'pendente').map((s) => [s.id, textoSugestao(s)]).filter(([, t]) => t !== null);
  if (pendentes.length === 0) l.push('- nenhuma.');
  for (const [id, t] of pendentes) l.push(`- ${id}: ${t} Aprovar: ${CMD} aprovar ${id}. Recusar: ${CMD} recusar ${id}.`);
  const ultimos = aj.registros.slice(-5).reverse();
  if (ultimos.length > 0) {
    l.push('Últimos registros:');
    for (const r of ultimos) {
      l.push(`- ${r.id} ${dia(r.em)}: ${ROTULO[r.item].nome} ${valorTxt(r.item, r.antes)} → ${valorTxt(r.item, r.depois)} (${MOTIVO_TXT[r.motivo]}; ${ORIGEM_REG[r.origem]}).`);
    }
  }
  const recentes = (Array.isArray(eventos) ? eventos : []).slice(-5).reverse().filter((e) => Object.hasOwn(EVENTO_TXT, e.tipo));
  if (recentes.length > 0) l.push(`Eventos recentes: ${recentes.map((e) => `${EVENTO_TXT[e.tipo]} (${dia(e.at)})`).join(', ')}.`);
  l.push(`Desfazer o último ajuste: ${CMD} desfazer. Desligar: ${CMD} desligar.`);
  return l.join('\n');
}

// §3.2 passo 1 e R4: o que será feito e o código da confirmação.
export function previa(plano, codigo) {
  const bin = caminhoTxt(path.join(plano.pasta, 'bin'));
  const l = ['hadouken: prévia do aprendizado local. Nada foi mudado ainda.'];
  l.push(plano.baixar
    ? `1. Baixar o otelcol-contrib ${plano.versao} (${plano.chave}) de ${plano.url}, até ${decimal(plano.tamanhoMax / 1024 ** 2, 0)} MiB, conferir o SHA-256 fixado no código, extrair só o binário para ${bin} com o tar do sistema e apagar o .tar.gz.`
    : `1. O otelcol-contrib ${plano.versao} já está em ${bin} e confere com o hash registrado: nada será baixado.`);
  l.push(`2. Gerar a configuração do Collector: recebe só em ${plano.host}:${plano.porta} (HTTP, sem gRPC), apaga os campos de identidade e grava em ${caminhoTxt(path.join(plano.pasta, ARQ_TELEMETRIA))}.`);
  const chaves = plano.adicionar.filter((k) => Object.hasOwn(CHAVES_LIGAR, k));
  const arq = caminhoTxt(plano.arquivo);
  if (chaves.length === 0) {
    l.push(`3. O env de ${arq} já tem todas as chaves: nada será acrescentado.`);
  } else {
    l.push(`3. Acrescentar ao env de ${arq}${plano.criaEnv ? ' (criando o env)' : ''}, com cópia de segurança ao lado (settings.json.bak-hadouken-<instante>), sem tocar em mais nada:`);
    for (const k of chaves) l.push(`   + ${k}=${CHAVES_LIGAR[k]}`);
  }
  l.push('4. A telemetria vale a partir da próxima sessão. Prompts, detalhes de ferramentas e respostas continuam fora dela.');
  l.push(`Para confirmar: ${CMD} ligar ${codigo}`);
  return l.join('\n');
}

export function ligado(r) {
  const copia = typeof r.backup === 'string' ? ` Cópia do settings.json de antes: ${caminhoTxt(r.backup)}.` : '';
  return `hadouken: aprendizado ligado. O Collector ${r.plano.versao} está em ${caminhoTxt(path.join(r.plano.pasta, 'bin'))}.${copia} A telemetria vale a partir da próxima sessão; prompts, detalhes de ferramentas e respostas continuam fora dela. Status: ${CMD} status.`;
}

export function falhaSettings(motivo) {
  return `hadouken: ${Object.hasOwn(SETTINGS_TXT, motivo) ? SETTINGS_TXT[motivo] : 'falha inesperada'}. Nada foi mudado.`;
}

export function falhaLigar(r) {
  const m = r?.motivo;
  let t;
  if (m === 'download') {
    t = `o download falhou (${Object.hasOwn(DOWNLOAD_TXT, r.detalhe) ? DOWNLOAD_TXT[r.detalhe] : 'motivo desconhecido'}). Nada foi instalado e o settings.json não mudou.`;
  } else if (m === 'coletor') {
    t = `o Collector não subiu (${Object.hasOwn(COLETOR_TXT, r.detalhe) ? COLETOR_TXT[r.detalhe] : 'falha ao subir'}); com ele fora do ar o Claude Code atrapalha, então o settings.json não mudou.`;
  } else if (typeof m === 'string' && Object.hasOwn(LIGAR_TXT, m)) {
    t = LIGAR_TXT[m];
  } else if (typeof m === 'string' && Object.hasOwn(SETTINGS_TXT, m)) {
    t = `${SETTINGS_TXT[m]}. O settings.json não mudou.`;
  } else {
    t = `falha inesperada. Confira com ${CMD} status.`;
  }
  return `hadouken: não ligou: ${t}`;
}

export function desligado(r, alcance) {
  const l = ['hadouken: aprendizado desligado.'];
  if (r.ligadoInvalido) l.push('O otel/ligado.json estava ilegível: nenhuma chave foi tirada do settings.json; confira o env dele à mão.');
  else if (r.removidas.length > 0) l.push(`${plural(r.removidas.length, 'chave saiu', 'chaves saíram')} do env do settings.json${typeof r.backup === 'string' ? ` (cópia em ${caminhoTxt(r.backup)})` : ''}.`);
  else l.push('O env do settings.json não tinha chaves do hadouken com o valor dele para tirar.');
  if (r.parado) l.push('O Collector foi parado.');
  const pasta = caminhoTxt(r.pasta);
  if (alcance === 'dados' || alcance === 'tudo') {
    l.push(r.apagou
      ? (alcance === 'tudo' ? `Os dados do aprendizado e a pasta ${pasta} foram apagados.` : `Os dados do aprendizado foram apagados; o binário fica em ${pasta}.`)
      : `Alguns arquivos não puderam ser apagados; confira ${pasta}.`);
  } else {
    l.push(`Os dados e o binário ficam em ${pasta}. Para apagar: ${CMD} desligar dados (ou desligar tudo, com o binário).`);
  }
  l.push('A telemetria para a partir da próxima sessão.');
  return l.join(' ');
}

export function falhaDesligar(r) {
  const m = r?.motivo;
  const t = typeof m === 'string' && Object.hasOwn(SETTINGS_TXT, m) ? SETTINGS_TXT[m] : 'falha inesperada';
  return `hadouken: não desligou: ${t}. O aprendizado continua ligado; confira com ${CMD} status.`;
}

export function desfeito(registro) {
  return `hadouken: desfeito. O ${ROTULO[registro.item].nome} volta a ${valorTxt(registro.item, registro.depois)} (${registro.id}) e não muda sozinho por ${DIAS_BLOQUEIO} dias.`;
}

export function falhaDesfazer(motivo) {
  if (motivo === 'nada') return 'hadouken: não há ajuste para desfazer.';
  if (motivo === 'nao-e-o-ultimo') return `hadouken: esse ajuste já foi substituído ou desfeito; só o mais novo de cada item se desfaz. Veja ${CMD} status.`;
  return `hadouken: não há ajuste com esse id. Veja ${CMD} status.`;
}

export function aprovadoAfrouxar(registro) {
  return `hadouken: aprovado. O ${ROTULO[registro.item].nome} passa de ${valorTxt(registro.item, registro.antes)} para ${valorTxt(registro.item, registro.depois)} (${registro.id}). Desfazer: ${CMD} desfazer ${registro.id}.`;
}

export function aprovadoModelo(s) {
  return `hadouken: sugestão ${s.id} marcada como aprovada. O hadouken nunca troca o modelo sozinho: a troca é sua, no /model ou na definição do subagente.`;
}

export function recusado(s) {
  return `hadouken: sugestão ${s.id} recusada. A mesma sugestão não volta por ${DIAS_BLOQUEIO} dias.`;
}
```

- [ ] **Step 5: Escrever `src/aprendizado/comando.js`**

```js
import { arquivoSettings } from '../configuracao.js';
import { lerConfigGuardaBase } from '../guarda/config.js';
import { aprovar, desfazer, recusar } from './ajustar.js';
import { ligadoExiste } from './arquivos.js';
import { coletorVivo } from './coletor.js';
import { desligar, ligar, previa } from './ligar.js';
import * as msg from './mensagens.js';
import {
  gravarAjustes, gravarSugestoes, lerAjustes, lerAprendizado, lerEventosApr, lerSugestoes, pegarTrava,
} from './registro.js';

// O comando /claude-hadouken:aprender (spec aprendizado §3.2, R4). Chamado
// só pelo hook UserPromptExpansion (src/hooks/aprender.js), que bloqueia a
// expansão: o modelo não é chamado (0 tokens) e a resposta vai ao usuário.
// Como o liberar, recusa qualquer subcomando vindo de -p ou SDK
// (CLAUDE_CODE_ENTRYPOINT sdk-*) antes de ler ou gravar qualquer coisa
// (Foco de revisão 5). O argumento só passa pela gramática; o texto sai de
// mensagens.js. Nunca rejeita.

const TEXTO_MAX = 200;
const ARGUMENTO = Object.freeze({
  status: (a) => a === null,
  ligar: (a) => a === null || /^[0-9a-f]{8}$/.test(a),
  desligar: (a) => a === null || a === 'dados' || a === 'tudo',
  desfazer: (a) => a === null || /^a\d{1,6}$/.test(a),
  aprovar: (a) => a !== null && /^s\d{1,6}$/.test(a),
  recusar: (a) => a !== null && /^s\d{1,6}$/.test(a),
});

export function interpretarComando(texto) {
  if (typeof texto !== 'string' || texto.length > TEXTO_MAX) return null;
  const partes = texto.trim().toLowerCase().split(/\s+/).filter((p) => p !== '');
  if (partes.length === 0) return { sub: 'status', arg: null };
  if (partes.length > 2) return null;
  const [sub, arg = null] = partes;
  if (!Object.hasOwn(ARGUMENTO, sub) || !ARGUMENTO[sub](arg)) return null;
  return { sub, arg };
}

function mostrarStatus(dir, agoraMs) {
  if (!ligadoExiste(dir)) return msg.DESLIGADO;
  return msg.status({
    ligado: true,
    ap: lerAprendizado(dir, agoraMs),
    aj: lerAjustes(dir, agoraMs),
    sug: lerSugestoes(dir, agoraMs),
    eventos: lerEventosApr(dir, agoraMs),
    vivo: coletorVivo(dir).vivo,
    agoraMs,
  });
}

async function fazerLigar(dir, codigo, agoraMs, ambiente, arquivo, deps) {
  const base = { ...(deps.ligar ?? {}), dir, arquivo, ambiente };
  if (codigo === null) {
    const p = previa(base);
    return p.ok ? msg.previa(p.plano, p.codigo) : msg.falhaLigar(p);
  }
  const r = await ligar({ ...base, codigo, agoraMs });
  return r.ok ? msg.ligado(r) : msg.falhaLigar(r);
}

function fazerDesligar(dir, arg, agoraMs, arquivo, deps) {
  const alcance = arg ?? 'nada';
  const r = desligar({ ...(deps.desligar ?? {}), dir, arquivo, agoraMs, apagar: alcance });
  if (r.ok) return msg.desligado(r, alcance);
  if (r.motivo === 'desligado') return msg.DESLIGADO;
  if (r.motivo === 'ocupado') return msg.OCUPADO;
  return msg.falhaDesligar(r);
}

// desfazer, aprovar e recusar: sob a trava do passo, para não gravar por
// cima de um passo que está rodando. As sugestões são gravadas antes dos
// ajustes: se a segunda gravação falha, a aprovação se perde (e a sugestão
// não volta a valer), mas nunca fica um afrouxamento sem a sugestão fechada.
function responder(dir, c, agoraMs) {
  if (!ligadoExiste(dir)) return msg.DESLIGADO;
  const t = pegarTrava(dir);
  if (!t.ok) return t.motivo === 'ocupada' ? msg.OCUPADO : msg.FALHOU;
  try {
    const aj = lerAjustes(dir, agoraMs);
    if (c.sub === 'desfazer') {
      const r = desfazer(aj, c.arg, agoraMs);
      if (!r.ok) return msg.falhaDesfazer(r.motivo);
      return gravarAjustes(dir, r.aj).ok ? msg.desfeito(r.registro) : msg.NAO_GRAVADO;
    }
    const sug = lerSugestoes(dir, agoraMs);
    const r = c.sub === 'aprovar'
      ? aprovar(aj, sug, c.arg, lerConfigGuardaBase(dir).config, agoraMs)
      : recusar(sug, aj, c.arg, agoraMs);
    if (!r.ok && r.motivo === 'nao-achou') return msg.SEM_SUGESTAO;
    if (!gravarSugestoes(dir, r.sug).ok || !gravarAjustes(dir, r.aj).ok) return msg.NAO_GRAVADO;
    if (!r.ok) return msg.MUDOU;
    if (c.sub === 'recusar') return msg.recusado(r.sugestao);
    return r.tipo === 'afrouxar' ? msg.aprovadoAfrouxar(r.registro) : msg.aprovadoModelo(r.sugestao);
  } finally {
    t.soltar();
  }
}

export async function executarComando(opcoes = {}) {
  try {
    const { dir, texto, agoraMs, entrypoint, ambiente = process.env, deps = {} } = opcoes;
    if (typeof entrypoint === 'string' && /^sdk/i.test(entrypoint)) return msg.RECUSADO_ENTRYPOINT;
    const c = interpretarComando(texto);
    if (c === null) return msg.USO;
    if (typeof dir !== 'string') return msg.FALHOU;
    if (c.sub === 'status') return mostrarStatus(dir, agoraMs);
    if (c.sub === 'ligar' || c.sub === 'desligar') {
      let { arquivo } = opcoes;
      if (arquivo === undefined) {
        const s = arquivoSettings();
        if (!s.ok) return msg.falhaSettings(s.motivo);
        arquivo = s.arquivo;
      }
      return c.sub === 'ligar'
        ? await fazerLigar(dir, c.arg, agoraMs, ambiente, arquivo, deps)
        : fazerDesligar(dir, c.arg, agoraMs, arquivo, deps);
    }
    return responder(dir, c, agoraMs);
  } catch {
    return msg.FALHOU;
  }
}
```

- [ ] **Step 6: Escrever o hook `src/hooks/aprender.js`**

```js
import { dirDados } from '../base.js';
import { emitirJson, rodarHook } from './comum.js';

// Hook UserPromptExpansion de /claude-hadouken:aprender (spec aprendizado
// §3.2, R4, R5). Sempre bloqueia a expansão (decision:block): o corpo da
// skill não chega ao Claude, o modelo não é chamado e a `reason` vai só ao
// usuário. A recusa de -p e SDK fica em comando.js, antes de qualquer leitura
// (Foco de revisão 5). Sem rede e sem processo filho aqui
// (test/aprendizado-fronteiras.test.js): o download e o Collector moram em
// baixar.js e coletor.js, carregados por import dinâmico só depois do gate.
// Timeout de 600 s no hooks.json (R5); o download tem prazo próprio.

const COMANDO = 'claude-hadouken:aprender';
// O mesmo texto de FALHOU (mensagens.js), para quando o import dele falha.
const FALHOU_RESERVA = 'hadouken: o comando falhou. Confira o estado com /claude-hadouken:aprender status.';

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = FALHOU_RESERVA;
  try {
    const { executarComando } = await import('../aprendizado/comando.js');
    reason = await executarComando({
      dir,
      texto: typeof entrada.command_args === 'string' ? entrada.command_args : '',
      agoraMs,
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
    });
  } catch {
    // Só com o aprendizado ligado o evento é gravado: desligado não cria
    // arquivo nenhum (§11).
    try {
      const [{ ligadoExiste }, { anexarEventoApr }] = await Promise.all([
        import('../aprendizado/arquivos.js'),
        import('../aprendizado/registro.js'),
      ]);
      if (ligadoExiste(dir)) anexarEventoApr(dir, 'erro', agoraMs);
    } catch { /* nada a fazer: a resposta segue */ }
  }
  emitirJson({ decision: 'block', reason });
});
```

- [ ] **Step 7: Criar `skills/aprender/SKILL.md`** (mesmo estilo de `skills/liberar/SKILL.md`)

```markdown
---
name: aprender
description: Aprendizado local do hadouken. Só o usuário usa, digitando /claude-hadouken:aprender [status | ligar | desligar | desfazer | aprovar | recusar].
disable-model-invocation: true
---

O hook do aprendizado do hadouken não rodou nesta sessão: nada foi mudado. Diga ao usuário para reiniciar a sessão ou rodar /reload-plugins. Não crie, não edite e não apague arquivos do hadouken nem o settings.json.
```

- [ ] **Step 8: Ligar o hook no `hooks/hooks.json` e ajustar o teste de ligação**

Em `hooks/hooks.json`, no array `"UserPromptExpansion"` (que a parte 1 criou com o `liberar`), acrescente depois do grupo do `liberar`:

```json
      { "matcher": "claude-hadouken:aprender",
        "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/aprender.js"], "timeout": 600 } ] }
```

(com a vírgula depois do `}` do grupo do `liberar`). Em `test/guarda-ameacas.test.js`, no teste `'hooks.json liga cada hook novo em forma exec, com os timeouts da spec'`, troque o trecho

```js
  const novos = handlers.filter((x) => Array.isArray(x.args));
```

por

```js
  // O aprender (aprendizado, R5) tem timeout próprio de 600 s e teste próprio
  // em test/aprendizado-comando.test.js.
  const novos = handlers.filter((x) => Array.isArray(x.args) && !x.args[0].endsWith('/aprender.js'));
```

Se a parte 2 tiver mudado a contagem de `novos`, mantenha a contagem dela: esta task só tira o `aprender` do filtro.

- [ ] **Step 9: Rodar e ver passar**

Run: `node --test test/aprendizado-mensagens.test.js test/aprendizado-comando.test.js test/guarda-ameacas.test.js test/aprendizado-fronteiras.test.js test/casa-unica.test.js`
Expected: PASS. O teste do Foco 5 roda o hook de verdade com `CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `sdk-ts` e `SDK-PY` e compara os bytes de todos os arquivos da pasta temporária antes e depois.

- [ ] **Step 10: Commit**

```powershell
git add -- src/aprendizado/mensagens.js src/aprendizado/comando.js src/hooks/aprender.js skills/aprender/SKILL.md hooks/hooks.json test/guarda-ameacas.test.js test/aprendizado-mensagens.test.js test/aprendizado-comando.test.js
git commit -m @'
feat: /claude-hadouken:aprender (status, two-step ligar, desligar, desfazer, aprovar, recusar) as a blocking UserPromptExpansion hook, refused from -p and SDK (spec aprendizado 3.2, 4.5, 4.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/mensagens.js src/aprendizado/comando.js src/hooks/aprender.js skills/aprender/SKILL.md hooks/hooks.json test/guarda-ameacas.test.js test/aprendizado-mensagens.test.js test/aprendizado-comando.test.js
```

---

### Task 12: O passo de aprendizado e a vida do Collector nas sessões (`passo.js`) (§3.3, §4.6, §6, §7; R2, R6, R11, R13; Foco de revisão 3)

**Files:**
- Create: `src/aprendizado/passo.js`, `test/fixtures/passo-paralelo.mjs`, `bench/aprendizado.mjs`
- Modify: `src/hooks/session-start.js`, `src/hooks/session-end.js`
- Test: `test/aprendizado-passo.test.js`

**Interfaces:**
- Consome: `lerNovos` (Task 2); `agregarRegistros`, `agregarHistorico`, `atualizarJanela`, `marcarNaJanela`, `marcarSessao`, `podar` (Task 3); `caminhos`, `ligadoExiste` (Task 4); `lerAprendizado`, `gravarAprendizado`, `lerAjustes`, `gravarAjustes`, `lerSugestoes`, `gravarSugestoes`, `lerCursor`, `gravarCursor`, `lerEventosApr`, `anexarEventoApr`, `pegarTrava`, `diaLocal` (Task 4); `ajustar` (Task 5); `lerConfigGuardaBase` (Task 6); `coletorVivo`, `subirColetor`, `pararColetor`, `ehOrfao`, `OUTRA_SESSAO_MS` (Task 8); `anuncio`, `avisoColetor` (Task 11); `ARQ_ESTADO`, `lerJson`, `validarEstado`, `limitesValidos`, `instante` (`src/estado.js`); `lerEventos`, `ultimoLimiteFable` (`src/guarda/registros.js`); `lerUso` (`src/uso/ler-uso.js`); `emitirJson`, `emitirContexto` (`src/hooks/comum.js`).
- Produz:
  - `GATILHO_JANELA` (`{ G1: 'h5', G3: 'h5', G2: 'd7', G4: 'd7', G6: 'fable', G7: 'fable' }`), `AVISOS` (os tipos de evento que viram aviso diário)
  - `outrasSessoes(estado, sessionId, agoraMs) → { recente: boolean, ultimaMs: number | null }` (R2)
  - `rodarPasso({ dir, agoraMs, inicio? }) → { ok: true, novos: { ajustes, sugestoes } } | { ok: false, motivo: 'ocupada' | 'erro' }`
  - `linhasDoInicio({ dir, agoraMs }) → string[]` (o anúncio de §4.6 e um aviso do Collector, cada um no máximo uma vez por dia; nunca lança)
  - `depoisDoInicio({ dir, sessionId, source, agoraMs, opcoesColetor? })` e `depoisDoFim({ dir, sessionId, agoraMs, opcoesColetor? })` (nunca lançam; uma exceção vira o evento `erro`)

- [ ] **Step 1: Escrever o processo do teste de concorrência**

Crie `test/fixtures/passo-paralelo.mjs`:

```js
// Foco de revisão 3: dois processos rodam o passo ao mesmo tempo sobre a
// mesma pasta. Imprime o resultado de rodarPasso.
import { rodarPasso } from '../../src/aprendizado/passo.js';

const [dir, agora] = process.argv.slice(2);
process.stdout.write(JSON.stringify(rodarPasso({ dir, agoraMs: Number(agora), inicio: false })));
```

- [ ] **Step 2: Escrever o teste**

Crie `test/aprendizado-passo.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhos } from '../src/aprendizado/arquivos.js';
import { ARQ_TELEMETRIA } from '../src/aprendizado/otlp.js';
import { depoisDoFim, depoisDoInicio, linhasDoInicio, outrasSessoes, rodarPasso } from '../src/aprendizado/passo.js';
import {
  ajustesVazios, anexarEventoApr, gravarAjustes, gravarLigado, gravarSugestoes, lerAprendizado, lerEventosApr,
} from '../src/aprendizado/registro.js';
import { gravarJsonAtomico } from '../src/estado.js';

// O passo de aprendizado (spec aprendizado §3.3, §4.6, §6, §7) e a vida do
// Collector nas sessões. Pasta de dados temporária; o Collector nunca sobe
// de verdade (executar, gerar e memLivre falsos), e os hooks rodam com
// HADOUKEN_SEM_PAINEL=1.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = path.join(repo, 'test', 'fixtures', 'passo-paralelo.mjs');
const H = 3_600_000;
const DIA = 24 * H;
// Meio-dia local de hoje: AGORA + 1 min nunca vira o dia (o anúncio e os
// avisos são por dia local), e AGORA + 24 h é sempre o dia seguinte.
const AGORA = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk passo ç '));
  tmps.push(d);
  return d;
}
const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
function linhaPedido(ms) {
  const a = {
    'event.name': S('api_request'), model: S('claude-sonnet-5-5'), effort: S('high'), query_source: S('repl_main_thread'), cost_usd: { doubleValue: 0.01 },
    input_tokens: I(100), output_tokens: I(10), cache_read_tokens: I(1000), cache_creation_tokens: I(5), duration_ms: I(2000), ttft_ms: I(700),
  };
  return JSON.stringify({ resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: [{ timeUnixNano: `${BigInt(ms) * 1_000_000n}`, body: S('claude_code.api_request'), attributes: attrs(a) }] }] }] });
}
function escreverTelemetria(dir, linhas, { anexar = false } = {}) {
  fs.mkdirSync(caminhos(dir).otel, { recursive: true });
  const arq = path.join(caminhos(dir).otel, ARQ_TELEMETRIA);
  (anexar ? fs.appendFileSync : fs.writeFileSync)(arq, linhas.map((l) => `${l}\n`).join(''));
}
function pedidos(dir, agoraMs) {
  let n = 0;
  for (const s of lerAprendizado(dir, agoraMs).semanas) for (const v of Object.values(s.modelos)) n += v[0];
  return n;
}
function estadoCom(dir, sessoes) {
  gravarJsonAtomico(path.join(dir, 'estado.json'), {
    versao: 1, at: new Date(AGORA).toISOString(), five_hour: null, seven_day: null,
    sessoes: Object.fromEntries(Object.entries(sessoes).map(([id, ms]) => [id, { at: new Date(ms).toISOString() }])), historico: [],
  });
}
// Windows forçado, com tasklist e taskkill falsos: o PID 4242 é o Collector.
function coletorFalso() {
  const chamadas = [];
  return {
    chamadas,
    opcoes: {
      plataforma: 'win32', systemRoot: 'C:\\Windows', memLivre: () => 8 * 1024 ** 3, env: {},
      gerar: () => { chamadas.push('gerar'); return { pid: 5151, unref() {}, on() {} }; },
      executar: (arq, args) => {
        chamadas.push(`${path.win32.basename(arq)} ${args.join(' ')}`);
        return arq.endsWith('tasklist.exe') ? '"otelcol-contrib.exe","4242","Console","1","50 000 K"\r\n' : '';
      },
    },
  };
}

test('§5.3 e Foco 2: o passo não conta duas vezes e segue o arquivo que cresce', () => {
  const d = novoDir();
  escreverTelemetria(d, [linhaPedido(AGORA - 3000), linhaPedido(AGORA - 2000)]);
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA }).ok, true);
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA }).ok, true);
  assert.equal(pedidos(d, AGORA), 2);
  escreverTelemetria(d, [linhaPedido(AGORA - 1000)], { anexar: true });
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(pedidos(d, AGORA), 3);
  assert.equal(fs.existsSync(caminhos(d).trava), false, 'a trava sai');
});

test('Foco de revisão 3: dois passos em paralelo não contam em dobro', async () => {
  const d = novoDir();
  escreverTelemetria(d, Array.from({ length: 2000 }, (_, i) => linhaPedido(AGORA - 10_000 + i)));
  const rodar = () => new Promise((resolver) => {
    const p = spawn(process.execPath, [FIXTURE, d, String(AGORA)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let saida = '';
    p.stdout.on('data', (b) => { saida += b; });
    p.on('close', () => resolver(JSON.parse(saida)));
  });
  const [a, b] = await Promise.all([rodar(), rodar()]);
  assert.ok(a.ok || b.ok);
  assert.equal(pedidos(d, AGORA), 2000);
});

test('§6: linha corrompida vira evento, o resto conta e nenhum ajuste sai daquela leitura', () => {
  const d = novoDir();
  escreverTelemetria(d, ['{quebrado', linhaPedido(AGORA - 1000)]);
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(pedidos(d, AGORA), 1);
  assert.deepEqual(lerEventosApr(d, AGORA).map((e) => e.tipo), ['telemetria-corrompida']);
  assert.equal(fs.existsSync(caminhos(d).ajustes), false, 'ajustar não rodou');
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(fs.existsSync(caminhos(d).ajustes), true, 'a leitura seguinte, limpa, ajusta');
});

test('§4.1: janela do Fable pela leitura oficial, disparo da guarda e limite atingido', () => {
  const d = novoDir();
  const reset = AGORA + 3 * DIA;
  gravarJsonAtomico(path.join(d, 'uso-oficial.json'), { versao: 1, lidoEm: new Date(AGORA - 60_000).toISOString(), modelos: { fable: { pct: 72, resetsAtMs: reset } } });
  gravarJsonAtomico(path.join(d, 'guarda-eventos.json'), { v: 1, eventos: [
    { at: new Date(AGORA - 30_000).toISOString(), tipo: 'disparo', detalhe: 'G7' },
    { at: new Date(AGORA - 20_000).toISOString(), tipo: 'disparo', detalhe: 'G9' },
    { at: new Date(AGORA - 20_000).toISOString(), tipo: 'negado', detalhe: 'G6' },
  ] });
  gravarJsonAtomico(path.join(d, 'limites-atingidos.json'), { v: 1, fable: AGORA - 10_000 });
  rodarPasso({ dir: d, agoraMs: AGORA });
  const [j] = lerAprendizado(d, AGORA).janelas.fable;
  assert.equal(j.reset, reset);
  assert.equal(j.disparou, true);
  assert.equal(j.esgotou, AGORA - 10_000);
  assert.equal(j.max, 100);
  assert.deepEqual(lerAprendizado(d, AGORA).janelas.h5, []);
});

test('§4.1: pontos novos do histórico entram na janela de 5h com o reset da leitura atual', () => {
  const d = novoDir();
  const resetS = Math.floor((AGORA + 2 * H) / 1000);
  const ponto = (ms, h5) => ({ at: new Date(ms).toISOString(), h5, d7: 40 });
  gravarJsonAtomico(path.join(d, 'estado.json'), {
    versao: 1, at: new Date(AGORA - 60_000).toISOString(),
    five_hour: { used_percentage: 81, resets_at: resetS, at: new Date(AGORA - 60_000).toISOString() }, seven_day: null,
    sessoes: {}, historico: [ponto(AGORA - 20 * 60_000, 58), ponto(AGORA - 15 * 60_000, 66), ponto(AGORA - 10 * 60_000, 76)],
  });
  rodarPasso({ dir: d, agoraMs: AGORA });
  const [j] = lerAprendizado(d, AGORA).janelas.h5;
  assert.equal(j.max, 81);
  assert.equal(j.cruzou['65'], AGORA - 15 * 60_000);
  assert.equal(j.cruzou['75'], AGORA - 10 * 60_000);
  assert.equal(j.cruzou['80'], AGORA - 60_000);
});

test('R11: só o SessionStart startup conta sessão', () => {
  const d = novoDir();
  rodarPasso({ dir: d, agoraMs: AGORA, inicio: true });
  rodarPasso({ dir: d, agoraMs: AGORA, inicio: false });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 1);
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 's2', source: 'resume', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 1);
  depoisDoInicio({ dir: d, sessionId: 's3', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 2);
});

test('§4.6: o anúncio sai uma vez por dia e só com novidade, no texto da spec', () => {
  const d = novoDir();
  const ontem = new Date(AGORA - DIA).toISOString();
  const aj = ajustesVazios();
  aj.seq = 1;
  aj.vigentes['painel.intervaloS'] = 60;
  aj.registros.push({ id: 'a1', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: ontem, origem: 'auto' });
  gravarAjustes(d, aj);
  gravarSugestoes(d, { v: 1, seq: 1, lista: [{ id: 's1', estado: 'pendente', em: ontem, tipo: 'afrouxar', item: 'guarda.teto7d', de: 80, para: 85 }] });
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA }), [
    'Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status).',
  ]);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA }), [], 'no mesmo dia, nada');
  aj.seq = 2;
  aj.vigentes['painel.amarelo'] = 70;
  aj.registros.push({ id: 'a2', item: 'painel.amarelo', antes: 75, depois: 70, motivo: 'faixa-historico', em: new Date(AGORA).toISOString(), origem: 'auto' });
  gravarAjustes(d, aj);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 60_000 }), [], 'novidade no mesmo dia espera o dia seguinte');
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA }), [
    'Aprendizado: 1 ajuste novo (faixa amarela 75→70%) (use /claude-hadouken:aprender status).',
  ]);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 2 * DIA }), [], 'sem novidade, nada');
});

test('§6: o aviso do Collector sai uma vez por dia, só com evento das últimas 24 h', () => {
  const d = novoDir();
  anexarEventoApr(d, 'porta-ocupada', AGORA - 1000);
  const [linha] = linhasDoInicio({ dir: d, agoraMs: AGORA });
  assert.match(linha, /^Aprendizado: o Collector não subiu porque a porta 127\.0\.0\.1:47318 está ocupada/);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 1000 }), []);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA + 1000 }), [], 'o evento de ontem não repete');
  anexarEventoApr(d, 'pouca-ram', AGORA + DIA);
  assert.match(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA + 2000 })[0], /memória livre/);
});

test('R2: outras sessões ativas, fora a que está encerrando', () => {
  const estado = { sessoes: { s1: { at: new Date(AGORA - 60_000).toISOString() }, s2: { at: new Date(AGORA - 2 * H).toISOString() } } };
  assert.deepEqual(outrasSessoes(estado, 's1', AGORA), { recente: false, ultimaMs: AGORA - 2 * H });
  assert.deepEqual(outrasSessoes(estado, 's2', AGORA), { recente: true, ultimaMs: AGORA - 60_000 });
  assert.deepEqual(outrasSessoes(null, 's1', AGORA), { recente: false, ultimaMs: null });
});

test('§3.3: Collector órfão (vivo, sem sessão há mais de 30 min) é parado e o evento registrado', () => {
  const d = novoDir();
  fs.mkdirSync(caminhos(d).otel, { recursive: true });
  gravarJsonAtomico(caminhos(d).pid, { v: 1, pid: 4242, em: new Date(AGORA - 2 * H).toISOString() });
  estadoCom(d, { velha: AGORA - H });
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.ok(c.chamadas.includes('taskkill.exe /pid 4242 /t /f'), c.chamadas.join('; '));
  const tipos = lerEventosApr(d, AGORA).map((e) => e.tipo);
  assert.ok(tipos.includes('orfao'));
  assert.ok(tipos.includes('coletor-ausente'), 'sem binário, a subida registra o motivo');
});

test('§3.3 e R2: SessionEnd para o Collector só sem outra sessão nos últimos 5 min', () => {
  const d = novoDir();
  fs.mkdirSync(caminhos(d).otel, { recursive: true });
  gravarJsonAtomico(caminhos(d).pid, { v: 1, pid: 4242, em: new Date(AGORA - H).toISOString() });
  estadoCom(d, { saindo: AGORA - 10_000, outra: AGORA - 60_000 });
  const c1 = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c1.opcoes });
  assert.ok(!c1.chamadas.some((x) => x.startsWith('taskkill')), 'outra sessão ativa: fica');
  estadoCom(d, { saindo: AGORA - 10_000, outra: AGORA - 20 * 60_000 });
  const c2 = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c2.opcoes });
  assert.ok(c2.chamadas.includes('taskkill.exe /pid 4242 /t /f'));
});

function hook(nome, home, entrada) {
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    HADOUKEN_SETTINGS: path.join(home, 'settings.json'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  };
  assert.ok(home.startsWith(os.tmpdir()));
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', nome)], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('R13: ligado, o SessionStart manda o aviso por systemMessage, fora do contexto; o SessionEnd roda o passo', () => {
  const d = novoDir();
  gravarLigado(d, { chaves: {}, criouEnv: false }, AGORA);
  const inicio = { session_id: 'sessao-a', hook_event_name: 'SessionStart', source: 'startup' };
  const primeira = JSON.parse(hook('session-start.js', d, inicio));
  assert.equal(primeira.systemMessage, undefined, 'nada a anunciar ainda');
  assert.ok(fs.existsSync(caminhos(d).aprendizado), 'o passo rodou depois da saída');
  // Sem binário (ou sem RAM), a subida deixou um evento que vira aviso.
  const segunda = JSON.parse(hook('session-start.js', d, { ...inicio, source: 'resume' }));
  assert.match(segunda.systemMessage, /^Aprendizado: /);
  assert.doesNotMatch(segunda.hookSpecificOutput.additionalContext, /Aprendizado/);
  escreverTelemetria(d, [linhaPedido(Date.now() - 1000)]);
  assert.equal(hook('session-end.js', d, { session_id: 'sessao-a', hook_event_name: 'SessionEnd', reason: 'exit' }), '');
  assert.equal(pedidos(d, Date.now()), 1);
});

test('§11: desligado, os hooks de sessão não criam nenhum arquivo do aprendizado', () => {
  const d = novoDir();
  const saida = JSON.parse(hook('session-start.js', d, { session_id: 'sessao-b', hook_event_name: 'SessionStart', source: 'startup' }));
  assert.equal(saida.systemMessage, undefined);
  hook('session-end.js', d, { session_id: 'sessao-b', hook_event_name: 'SessionEnd', reason: 'exit' });
  const c = caminhos(d);
  for (const k of ['otel', 'aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos', 'trava']) assert.equal(fs.existsSync(c[k]), false, k);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/aprendizado-passo.test.js`
Expected: FAIL com `Cannot find module` de `src/aprendizado/passo.js`.

- [ ] **Step 4: Escrever `src/aprendizado/passo.js`**

```js
import path from 'node:path';
import { ARQ_ESTADO, instante, lerJson, limitesValidos, validarEstado } from '../estado.js';
import { lerConfigGuardaBase } from '../guarda/config.js';
import { lerEventos, ultimoLimiteFable } from '../guarda/registros.js';
import { lerUso } from '../uso/ler-uso.js';
import { ajustar } from './ajustar.js';
import { agregarHistorico, agregarRegistros, atualizarJanela, marcarNaJanela, marcarSessao, podar } from './agregar.js';
import { caminhos } from './arquivos.js';
import { coletorVivo, ehOrfao, OUTRA_SESSAO_MS, pararColetor, subirColetor } from './coletor.js';
import { anuncio, avisoColetor } from './mensagens.js';
import { lerNovos } from './otlp.js';
import {
  anexarEventoApr, diaLocal, gravarAjustes, gravarAprendizado, gravarCursor, gravarSugestoes, lerAjustes, lerAprendizado,
  lerCursor, lerEventosApr, lerSugestoes, pegarTrava,
} from './registro.js';

// O passo de aprendizado (spec aprendizado §3.1, §3.3, §4.6, §6, §7). Roda
// depois da saída do SessionStart e do SessionEnd, sob a trava
// aprendizado.lock (Foco de revisão 3), e só com o aprendizado ligado (quem
// chama confere ligadoExiste). Lê o que é novo desde o cursor (telemetria,
// histórico do estado.json) e o que é idempotente (a leitura oficial do Fable,
// os disparos e o limite da guarda), agrega, ajusta e grava. Nenhuma função
// lança: uma exceção vira o evento 'erro' e o hook segue (§6).

const DIA_MS = 86_400_000;
export const GATILHO_JANELA = Object.freeze({ G1: 'h5', G3: 'h5', G2: 'd7', G4: 'd7', G6: 'fable', G7: 'fable' });
// Eventos que viram o aviso diário do SessionStart (§3.3, §6).
export const AVISOS = Object.freeze(['porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-ausente', 'coletor-falhou', 'sem-otel']);
// Motivos de subirColetor que viram evento; 'vivo' e 'subindo' são normais.
const EVENTO_DA_SUBIDA = Object.freeze({
  'pouca-ram': 'pouca-ram', 'coletor-ausente': 'coletor-ausente', 'coletor-hash': 'coletor-hash', config: 'coletor-falhou', erro: 'coletor-falhou',
});
// Sem nenhuma telemetria depois de SESSOES_SEM_OTEL sessões com o
// aprendizado ligado, o evento sem-otel (a primeira sessão depois do ligar
// ainda pode não ter exportado nada).
const SESSOES_SEM_OTEL = 2;

function estadoDe(dir, agoraMs) {
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  return lido.ok ? validarEstado(lido.valor, agoraMs) : null;
}

// R2: as sessões de estado.json fora a que chama; `recente` com `at` de até
// OUTRA_SESSAO_MS (5 min; 24 h com a Emenda A3).
export function outrasSessoes(estado, sessionId, agoraMs) {
  let ultimaMs = null;
  let recente = false;
  const sessoes = estado !== null && typeof estado === 'object' && estado.sessoes && typeof estado.sessoes === 'object' ? estado.sessoes : {};
  for (const [id, s] of Object.entries(sessoes)) {
    if (id === sessionId) continue;
    const t = instante(s?.at, agoraMs);
    if (t === null) continue;
    if (ultimaMs === null || t > ultimaMs) ultimaMs = t;
    if (agoraMs - t <= OUTRA_SESSAO_MS) recente = true;
  }
  return { recente, ultimaMs };
}

// §4.1 "Ritmo das janelas": os pontos novos do histórico e a leitura atual,
// com o reset da leitura atual. atualizarJanela descarta o ponto que não é
// daquela janela e só guarda a primeira vez que cada limiar foi cruzado.
function janelasDoEstado(ap, estado, pontosNovos, agoraMs) {
  const lim = limitesValidos(estado, agoraMs);
  if (lim === null) return;
  for (const [tipo, chave] of [['h5', 'five_hour'], ['d7', 'seven_day']]) {
    const j = lim[chave];
    if (!j) continue;
    const resetMs = j.resets_at * 1000;
    for (const p of pontosNovos) {
      if (p[tipo] !== null) atualizarJanela(ap, tipo, { pct: p[tipo], resetMs, emMs: p.t });
    }
    const emMs = instante(estado[chave]?.at ?? estado.at, agoraMs);
    if (emMs !== null) atualizarJanela(ap, tipo, { pct: j.used_percentage, resetMs, emMs });
  }
}

function pontosDepois(estado, desdeMs, agoraMs) {
  const r = [];
  for (const p of Array.isArray(estado?.historico) ? estado.historico : []) {
    const t = instante(p.at, agoraMs);
    if (t !== null && t > desdeMs) r.push({ t, h5: p.h5, d7: p.d7 });
  }
  return r;
}

export function rodarPasso({ dir, agoraMs, inicio = false } = {}) {
  const t = pegarTrava(dir);
  if (!t.ok) return { ok: false, motivo: t.motivo };
  try {
    const c = caminhos(dir);
    const ap = lerAprendizado(dir, agoraMs);
    const cursor = lerCursor(dir, agoraMs);
    // 1. Telemetria nova (R11: só eventos e active_time).
    const n = lerNovos({ pasta: c.otel, cursor: cursor.arquivo, agoraMs });
    agregarRegistros(ap, n.registros);
    cursor.arquivo = n.cursor;
    if (n.corrompido) anexarEventoApr(dir, 'telemetria-corrompida', agoraMs);
    // 2. Ritmo e janelas de 5h e 7d pelo estado.json.
    const estado = estadoDe(dir, agoraMs);
    janelasDoEstado(ap, estado, pontosDepois(estado, cursor.historicoAte, agoraMs), agoraMs);
    cursor.historicoAte = agregarHistorico(ap, estado?.historico ?? [], cursor.historicoAte);
    // 3. Janela do Fable pela leitura oficial (uso-oficial.json).
    const uso = lerUso(dir, agoraMs);
    const fable = uso?.modelos?.fable;
    const lidoMs = typeof uso?.lidoEm === 'string' ? Date.parse(uso.lidoEm) : Number.NaN;
    if (fable && fable.resetsAtMs !== null && Number.isFinite(lidoMs)) {
      atualizarJanela(ap, 'fable', { pct: fable.pct, resetMs: fable.resetsAtMs, emMs: lidoMs });
    }
    // 4. Disparos da guarda e o limite do Fable atingido (§4.4).
    for (const e of lerEventos(dir, agoraMs)) {
      if (e.tipo !== 'disparo' || typeof e.detalhe !== 'string' || !Object.hasOwn(GATILHO_JANELA, e.detalhe)) continue;
      marcarNaJanela(ap, GATILHO_JANELA[e.detalhe], Date.parse(e.at), 'disparou');
    }
    const limite = ultimoLimiteFable(dir, agoraMs);
    if (limite !== null) marcarNaJanela(ap, 'fable', limite.atMs, 'esgotou');
    if (inicio) marcarSessao(ap, agoraMs);
    // 5. Sem telemetria depois de algumas sessões: evento, no máximo um por dia.
    const hoje = diaLocal(agoraMs);
    if (cursor.arquivo === null && ap.sessoes >= SESSOES_SEM_OTEL
      && !lerEventosApr(dir, agoraMs).some((e) => e.tipo === 'sem-otel' && diaLocal(Date.parse(e.at)) === hoje)) {
      anexarEventoApr(dir, 'sem-otel', agoraMs);
    }
    // 6. Ajustes e sugestões (§4.2–§4.5), nunca de uma leitura corrompida
    // (§6). As sugestões são gravadas antes dos ajustes, como no comando.
    let novos = { ajustes: [], sugestoes: [] };
    if (!n.corrompido) {
      const r = ajustar({ ap, aj: lerAjustes(dir, agoraMs), sug: lerSugestoes(dir, agoraMs), config: lerConfigGuardaBase(dir).config, agoraMs });
      if (r.fora.length > 0) anexarEventoApr(dir, 'ajuste-fora', agoraMs);
      if (gravarSugestoes(dir, r.sug).ok && gravarAjustes(dir, r.aj).ok) novos = r.novos;
    }
    podar(ap, agoraMs);
    // O cursor só anda com os agregados gravados: uma falha relê, nunca perde.
    if (!gravarAprendizado(dir, ap).ok) return { ok: false, motivo: 'erro' };
    gravarCursor(dir, cursor);
    return { ok: true, novos };
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
    return { ok: false, motivo: 'erro' };
  } finally {
    t.soltar();
  }
}

const idNum = (id) => Number(id.slice(1));

// §4.6 e §6: o anúncio (só com novidade e só se hoje ainda não houve) e um
// aviso do Collector (o evento de AVISOS mais novo das últimas 24 h, se o
// tipo dele ainda não foi avisado hoje). Sem a trava, nada: o próximo
// SessionStart mostra.
export function linhasDoInicio({ dir, agoraMs } = {}) {
  let t = null;
  try {
    t = pegarTrava(dir);
    if (!t.ok) return [];
    const linhas = [];
    const cursor = lerCursor(dir, agoraMs);
    const hoje = diaLocal(agoraMs);
    if (cursor.anuncio.dia !== hoje) {
      const aj = lerAjustes(dir, agoraMs);
      const sug = lerSugestoes(dir, agoraMs);
      const novos = aj.registros.filter((r) => r.origem === 'auto' && idNum(r.id) > cursor.anuncio.ajustes);
      const pendentes = sug.lista.filter((s) => s.estado === 'pendente' && idNum(s.id) > cursor.anuncio.sugestoes);
      const texto = anuncio(novos, pendentes.length);
      if (texto !== null) {
        linhas.push(texto);
        cursor.anuncio = {
          dia: hoje,
          ajustes: Math.max(cursor.anuncio.ajustes, ...aj.registros.map((r) => idNum(r.id))),
          sugestoes: Math.max(cursor.anuncio.sugestoes, ...sug.lista.map((s) => idNum(s.id))),
        };
      }
    }
    const recente = lerEventosApr(dir, agoraMs)
      .filter((e) => AVISOS.includes(e.tipo) && agoraMs - Date.parse(e.at) <= DIA_MS)
      .pop();
    if (recente && cursor.avisos[recente.tipo] !== hoje) {
      const aviso = avisoColetor(recente.tipo);
      if (aviso !== null) {
        linhas.push(aviso);
        cursor.avisos = { ...cursor.avisos, [recente.tipo]: hoje };
      }
    }
    if (linhas.length > 0) gravarCursor(dir, cursor);
    return linhas;
  } catch {
    return [];
  } finally {
    if (t?.ok) t.soltar();
  }
}

// §3.3 SessionStart, depois da saída: órfão, subida e o passo.
export function depoisDoInicio({ dir, sessionId, source, agoraMs, opcoesColetor = {} } = {}) {
  try {
    const outras = outrasSessoes(estadoDe(dir, agoraMs), sessionId, agoraMs);
    const vivo = coletorVivo(dir, opcoesColetor);
    if (vivo.vivo && ehOrfao({ emMs: vivo.emMs, ultimaOutraSessaoMs: outras.ultimaMs, agoraMs })) {
      pararColetor({ ...opcoesColetor, dir });
      anexarEventoApr(dir, 'orfao', agoraMs);
    }
    const s = subirColetor({ ...opcoesColetor, dir, agoraMs });
    if (s.evento) anexarEventoApr(dir, s.evento, agoraMs);
    if (!s.ok && Object.hasOwn(EVENTO_DA_SUBIDA, s.motivo)) anexarEventoApr(dir, EVENTO_DA_SUBIDA[s.motivo], agoraMs);
    rodarPasso({ dir, agoraMs, inicio: source === 'startup' });
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
}

// §3.3 SessionEnd: o passo e, sem outra sessão ativa (R2), a parada.
export function depoisDoFim({ dir, sessionId, agoraMs, opcoesColetor = {} } = {}) {
  try {
    rodarPasso({ dir, agoraMs, inicio: false });
    if (!outrasSessoes(estadoDe(dir, agoraMs), sessionId, agoraMs).recente) pararColetor({ ...opcoesColetor, dir });
  } catch {
    anexarEventoApr(dir, 'erro', agoraMs);
  }
}
```

- [ ] **Step 5: `src/hooks/session-start.js`**

Acrescente `emitirJson` ao import de `./comum.js`, se a parte 2 ainda não o fez. No comentário do topo, depois do item 5, acrescente:

```js
// 6. com o aprendizado ligado (otel/ligado.json), o anúncio e os avisos do
//    aprendizado vão ao usuário pelo systemMessage (spec aprendizado §4.6,
//    R13), fora do contexto do Claude; depois da saída, a vida do Collector e
//    o passo de aprendizado (passo.js). Desligado, nada disso é carregado.
```

Logo antes da emissão, acrescente:

```js
  // Aprendizado (spec aprendizado §4.6, §11): arquivos.js é leve; passo.js só
  // carrega com o aprendizado ligado.
  const { ligadoExiste } = await import('../aprendizado/arquivos.js');
  const aprendizadoLigado = ligadoExiste(dir);
  let aprendizado = [];
  if (aprendizadoLigado) {
    try {
      aprendizado = (await import('../aprendizado/passo.js')).linhasDoInicio({ dir, agoraMs });
    } catch { /* sem linha do aprendizado nesta sessão */ }
  }
```

Troque a emissão — a linha `emitirContexto('SessionStart', saida.join('\n'));` ou, se a Task 12 da parte 2 rodou, as linhas de `const retomada = linhas.linhaRetomada(entrada);` até o `else emitirJson(...)` — por:

```js
  // Ao usuário, fora do contexto do Claude (systemMessage): a linha de
  // retomada (parte 2, §10 item 11) e as do aprendizado (R13).
  const retomada = linhas.linhaRetomada(entrada);
  const aoUsuario = [retomada, ...aprendizado].filter((x) => typeof x === 'string' && x.length > 0);
  if (aoUsuario.length === 0) emitirContexto('SessionStart', saida.join('\n'));
  else emitirJson({ systemMessage: aoUsuario.join('\n'), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: saida.join('\n') } });
```

Se a Task 12 da parte 2 foi pulada (S10 reprovado), a primeira linha do bloco é `const retomada = null;`.

Depois da linha do `dispararPainel`, acrescente:

```js
  if (aprendizadoLigado) {
    try {
      (await import('../aprendizado/passo.js')).depoisDoInicio({ dir, sessionId, source: entrada.source, agoraMs });
    } catch { /* o passo registra os próprios erros; um import que falha só pula o passo */ }
  }
```

- [ ] **Step 6: `src/hooks/session-end.js`**

No comentário do topo, acrescente: "Com o aprendizado ligado, depois do histórico, roda o passo de aprendizado e para o Collector sem outra sessão ativa (spec aprendizado §3.3, R2; passo.js)." No fim do callback, depois de `anexarHistorico(dir, registro);`, acrescente:

```js
  try {
    const { ligadoExiste } = await import('../aprendizado/arquivos.js');
    if (ligadoExiste(dir)) (await import('../aprendizado/passo.js')).depoisDoFim({ dir, sessionId, agoraMs });
  } catch { /* o histórico já foi gravado; o passo fica para a próxima sessão */ }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test test/aprendizado-passo.test.js test/hooks.test.js test/guarda-hooks.test.js test/aprendizado-fronteiras.test.js`
Expected: PASS. `test/hooks.test.js` e `test/guarda-hooks.test.js` provam que, desligado, a saída do SessionStart e do SessionEnd não mudou.

- [ ] **Step 8: Escrever o bench `bench/aprendizado.mjs`** (em inglês, como os vizinhos de `bench/`)

```js
// Timings of the learning step (spec aprendizado section 7): worst case (20 MB
// of new telemetry over 26 weeks of aggregates) and common case (a few KB
// new). Zero dependencies. Usage:
//
//   node bench/aprendizado.mjs [--json]
//
// Targets: worst <= 300 ms, common <= 30 ms. Report-only, like the other
// benches: a number over its target never changes the exit code; the exit
// code is 1 only when the bench itself fails (the step returns ok: false or
// the count check fails). Everything lives in a temporary directory removed at
// the end; the real ~/.claude/hadouken is never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CAMPOS_MODELO, inicioSemana, MODELOS_SEMANA_MAX, SEMANAS_MAX } from '../src/aprendizado/agregar.js';
import { caminhos } from '../src/aprendizado/arquivos.js';
import { ARQ_TELEMETRIA } from '../src/aprendizado/otlp.js';
import { rodarPasso } from '../src/aprendizado/passo.js';
import { gravarAprendizado, lerCursor } from '../src/aprendizado/registro.js';

const JSON_OUT = process.argv.includes('--json');
const MB = 1024 * 1024;
const PIOR_BYTES = 19.5 * MB;
const DIA = 86_400_000;
const agora = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-bench-aprendizado-'));

const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
// Resource attributes like a real export (the Collector would have deleted the
// identity ones; the reader drops whatever is left).
const RECURSO = attrs({ 'service.name': S('claude-code'), 'service.version': S('2.1.300'), 'os.type': S('windows'), 'host.arch': S('amd64') });
function linha(ms, i) {
  const a = attrs({
    'event.name': S('api_request'), model: S(i % 3 === 0 ? 'claude-opus-5-5' : 'claude-sonnet-5-5'), effort: S(i % 2 ? 'high' : 'xhigh'),
    query_source: S(i % 5 === 0 ? 'agent:custom' : 'repl_main_thread'), 'agent.name': S(`agente-${i % 7}`), cost_usd: { doubleValue: 0.0123 },
    input_tokens: I(1200 + i % 50), output_tokens: I(300), cache_read_tokens: I(50_000), cache_creation_tokens: I(900), duration_ms: I(2400), ttft_ms: I(800),
    'terminal.type': S('vscode'), 'prompt.id': S(`p-${i}`),
  });
  return `${JSON.stringify({ resourceLogs: [{ resource: { attributes: RECURSO }, scopeLogs: [{ logRecords: [{ timeUnixNano: `${BigInt(ms) * 1_000_000n}`, body: S('claude_code.api_request'), attributes: a }] }] }] })}\n`;
}

// 26 full weeks: 40 model keys each, every activity slot filled, full windows.
function agregadosCheios() {
  const semanas = [];
  for (let w = SEMANAS_MAX - 1; w >= 0; w--) {
    const modelos = {};
    for (let k = 0; k < MODELOS_SEMANA_MAX; k++) modelos[`claude-modelo-${k}|high|${k % 2 ? 'principal' : `sub:agente-${k}`}`] = new Array(CAMPOS_MODELO.length).fill(7);
    semanas.push({ inicio: inicioSemana(agora - w * 7 * DIA), modelos, ativo: new Array(168).fill(30) });
  }
  const resumo = (reset) => ({ reset, max: 90, cruzou: { 60: reset - 3 * 3_600_000, 75: reset - 2 * 3_600_000, 90: reset - 3_600_000 }, esgotou: null, disparou: false });
  return {
    v: 1, desde: agora - 180 * DIA, sessoes: 900, semanas,
    ritmo: { h5: Array.from({ length: 24 }, () => [12, 40]), d7: Array.from({ length: 24 }, () => [2, 40]) },
    janelas: {
      h5: Array.from({ length: 60 }, (_, i) => resumo(agora - i * 5 * 3_600_000)),
      d7: Array.from({ length: 12 }, (_, i) => resumo(agora - i * 7 * DIA)),
      fable: Array.from({ length: 12 }, (_, i) => resumo(agora - i * 7 * DIA)),
    },
  };
}

function medir(rotulo, alvoMs) {
  const t0 = performance.now();
  const r = rodarPasso({ dir, agoraMs: agora, inicio: false });
  const ms = performance.now() - t0;
  if (!r.ok) throw new Error(`${rotulo}: rodarPasso devolveu ${JSON.stringify(r)}`);
  return { id: rotulo, ms: Math.round(ms * 10) / 10, alvoMs, dentro: ms <= alvoMs };
}

let codigo = 0;
try {
  gravarAprendizado(dir, agregadosCheios());
  fs.mkdirSync(caminhos(dir).otel, { recursive: true });
  const arq = path.join(caminhos(dir).otel, ARQ_TELEMETRIA);
  const fd = fs.openSync(arq, 'w');
  let bytes = 0;
  let n = 0;
  while (bytes < PIOR_BYTES) {
    const l = linha(agora - 6 * DIA + n * 20, n);
    fs.writeSync(fd, l);
    bytes += Buffer.byteLength(l);
    n++;
  }
  fs.closeSync(fd);
  const pior = medir('pior', 300);
  // Own check: the whole file was read in one step (the current weeks are
  // already at 40 keys, so the counts may not grow; the cursor must).
  const lido = lerCursor(dir, agora).arquivo;
  if (lido === null || lido.pos !== bytes) throw new Error(`the worst case stopped at ${lido?.pos ?? 'null'} of ${bytes} bytes`);
  fs.appendFileSync(arq, Array.from({ length: 4 }, (_, i) => linha(agora - 1000 + i, i)).join(''));
  const comum = medir('comum', 30);
  const saida = { linhas: n, mb: Math.round((bytes / MB) * 10) / 10, medidas: [pior, comum] };
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(saida)}\n`);
  else {
    process.stdout.write(`learning step, ${saida.mb} MB / ${n} lines of new telemetry over ${SEMANAS_MAX} weeks of aggregates\n`);
    for (const m of saida.medidas) process.stdout.write(`  ${m.id.padEnd(6)} ${String(m.ms).padStart(8)} ms  (target <= ${m.alvoMs} ms: ${m.dentro ? 'ok' : 'OVER'})\n`);
  }
} catch (e) {
  process.stderr.write(`bench failed: ${e?.message ?? e}\n`);
  codigo = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exitCode = codigo;
```

- [ ] **Step 9: Rodar o bench**

Run: `node bench/aprendizado.mjs`
Expected: saída com as duas linhas (`pior` e `comum`) e código 0. Anote os números no relatório da tarefa. Se `pior` passar de 300 ms ou `comum` de 30 ms, relate ao controlador com o perfil (`node --cpu-prof bench/aprendizado.mjs`) antes de seguir: a meta é da spec (§7), e o controlador decide com o Sr. Garioli.

- [ ] **Step 10: Commit**

```powershell
git add -- src/aprendizado/passo.js src/hooks/session-start.js src/hooks/session-end.js bench/aprendizado.mjs test/fixtures/passo-paralelo.mjs test/aprendizado-passo.test.js
git commit -m @'
feat: learning step after SessionStart/SessionEnd output, Collector start/stop/orphan per session, daily announcement and warnings via systemMessage, bench (spec aprendizado 3.3, 4.6, 7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/aprendizado/passo.js src/hooks/session-start.js src/hooks/session-end.js bench/aprendizado.mjs test/fixtures/passo-paralelo.mjs test/aprendizado-passo.test.js
```

---

### Task 13: Os consumidores dos ajustes: painel, previsão das linhas de alerta (§4.3, §11; R9, R10, R14)

**Files:**
- Modify: `src/uso/painel.js`, `src/previsao.js`, `src/hooks/prompt-submit.js`
- Test: `test/aprendizado-consumo.test.js`

**Interfaces:**
- Consome: `faixasDoPainel`, `intervaloDoPainelMs`, `perfilDaPrevisao`, `ajustesVazios`, `gravarAjustes`, `gravarLigado` (Task 4); `ligadoExiste` (Task 4).
- Produz:
  - `ritmoMisturado(b, perfil, coluna, agoraMs) → number | null` em `src/previsao.js`: `(1 − peso)·b + peso·típico[hora local]` quando `b > 0`, `peso` em (0; 0,5] e o típico da hora é número > 0; senão `b` como veio
  - `preverEstouro({ historico, limites, agoraMs, perfil? })`: `perfil` opcional (`{ peso, h5, d7 }` de `perfilDaPrevisao`); sem ele, igual a hoje
  - painel: o nível (`aviso`/`erro`) pelas faixas aprendidas (R14) e, fora das horas ativas, a leitura do `/usage` no intervalo aprendido (R9)

- [ ] **Step 1: Escrever o teste**

Crie `test/aprendizado-consumo.test.js`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ajustesVazios, gravarAjustes, gravarLigado } from '../src/aprendizado/registro.js';
import { preverEstouro, ritmoMisturado } from '../src/previsao.js';
import { ARQ_USO, estadoPainel, talvezAtualizar } from '../src/uso/painel.js';

// Os consumidores dos ajustes (spec aprendizado §4.3 e §11; R9, R10, R14):
// desligado, tudo como hoje; ligado, o painel usa as faixas e o intervalo
// aprendidos, e a previsão das linhas de alerta mistura o ritmo por hora. A
// guarda continua com a regressão pura. Pasta de dados temporária; nenhum
// `claude` de verdade (rodar falso).

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIN = 60_000;
const H = 60 * MIN;
const AGORA = new Date(2026, 8, 29, 17, 4).getTime();
const iso = (ms) => new Date(ms).toISOString();
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// O opt-out do ambiente de quem roda os testes não pode mudar o resultado.
delete process.env.HADOUKEN_SEM_PAINEL;

function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk consumo ç '));
  tmps.push(d);
  return d;
}
function comAjustes(dir, vigentes, horasAtivas = [0, 0, 0, 0, 0, 0, 0]) {
  const aj = ajustesVazios();
  Object.assign(aj.vigentes, vigentes);
  aj.perfil.horasAtivas = horasAtivas;
  assert.equal(gravarAjustes(dir, aj).ok, true);
}
const ligar = (dir) => assert.equal(gravarLigado(dir, { chaves: {}, criouEnv: false }, AGORA).ok, true);
const desligar = (dir) => fs.rmSync(path.join(dir, 'otel'), { recursive: true, force: true });
function gravarUso(dir, pct5h, lidoMs = AGORA - 1000) {
  fs.writeFileSync(path.join(dir, ARQ_USO), JSON.stringify({
    versao: 1, lidoEm: iso(lidoMs),
    sessao: { pct: pct5h, resetsAtMs: AGORA + H }, semana: { pct: 10, resetsAtMs: AGORA + 72 * H }, modelos: { fable: { pct: 10, resetsAtMs: AGORA + 72 * H } },
    estado: { motivo: 'ok', em: iso(lidoMs) }, bloqueado: null,
  }));
}

test('R14: ligado, o nível do painel segue as faixas aprendidas; desligado, 75% e 90%', () => {
  const d = novoDir();
  comAjustes(d, { 'painel.amarelo': 70, 'painel.vermelho': 85 });
  for (const [pct, semAprendizado, comAprendizado] of [[69, 'ok', 'ok'], [72, 'ok', 'aviso'], [86, 'aviso', 'erro'], [91, 'erro', 'erro']]) {
    gravarUso(d, pct);
    desligar(d);
    assert.equal(estadoPainel({ dir: d, agoraMs: AGORA }).nivel, semAprendizado, `desligado ${pct}`);
    ligar(d);
    assert.equal(estadoPainel({ dir: d, agoraMs: AGORA }).nivel, comAprendizado, `ligado ${pct}`);
  }
});

test('R9: fora das horas ativas, o intervalo aprendido de 120 s segura a leitura por 115 s', async () => {
  const d = novoDir();
  const chamadas = [];
  const rodar = async () => {
    chamadas.push(1);
    return { ok: true, uso: { sessao: { pct: 25, resetsAtMs: AGORA + H }, semana: { pct: 41, resetsAtMs: AGORA + 72 * H }, modelos: { fable: { pct: 57, resetsAtMs: AGORA + 72 * H } } } };
  };
  const opcoes = { dir: d, agoraMs: AGORA, env: {}, rodar, memLivre: () => 8 * 1024 ** 3, estadoAtivo: () => true, achar: () => path.join(os.tmpdir(), 'nao-existe', 'claude.exe') };
  comAjustes(d, { 'painel.intervaloS': 120 });
  ligar(d);
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: false, motivo: 'recente' });
  gravarUso(d, 25, AGORA - 115_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // Nas horas ativas (todas, aqui), vale o intervalo de hoje: 60 s não é recente.
  comAjustes(d, { 'painel.intervaloS': 120 }, new Array(7).fill(0xffffff));
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // Desligado, também.
  comAjustes(d, { 'painel.intervaloS': 120 });
  desligar(d);
  gravarUso(d, 25, AGORA - 60_000);
  assert.deepEqual(await talvezAtualizar(opcoes), { feito: true, motivo: 'ok' });
  // O comando manual (forcar) segue com o piso de 5 s.
  ligar(d);
  gravarUso(d, 25, AGORA - 6_000);
  assert.deepEqual(await talvezAtualizar({ ...opcoes, forcar: true }), { feito: true, motivo: 'ok' });
  assert.equal(chamadas.length, 4);
});

test('R10: ritmoMisturado só mistura com peso em (0; 0,5], ritmo atual positivo e típico da hora > 0', () => {
  const tres = new Array(24).fill(3);
  const p = (peso, h5 = tres) => ({ peso, h5, d7: new Array(24).fill(null) });
  assert.equal(ritmoMisturado(1, p(0.5), 'h5', AGORA), 2);
  assert.ok(Math.abs(ritmoMisturado(1, p(0.1), 'h5', AGORA) - 1.2) < 1e-12);
  assert.equal(ritmoMisturado(1, p(0.5), 'd7', AGORA), 1, 'hora sem ritmo típico');
  const buraco = [...tres];
  buraco[new Date(AGORA).getHours()] = null;
  assert.equal(ritmoMisturado(1, p(0.5, buraco), 'h5', AGORA), 1);
  for (const b of [0, -1, null]) assert.equal(ritmoMisturado(b, p(0.5), 'h5', AGORA), b);
  for (const perfil of [null, undefined, 'x', p(0), p(0.6), p(Number.NaN), p('0.5'), p(0.5, [3]), p(0.5, new Array(24).fill(0))]) {
    assert.equal(ritmoMisturado(1, perfil, 'h5', AGORA), 1, JSON.stringify(perfil));
  }
});

test('R10: preverEstouro com perfil antecipa a previsão; sem perfil, igual a antes', () => {
  // 1 ponto por minuto de ritmo (10, 12 … 18 em 8 min), 18% usados, reset em 3 h.
  const historico = [-8, -6, -4, -2, 0].map((m, i) => ({ at: iso(AGORA + m * MIN), h5: 10 + 2 * i, d7: 40 }));
  const limites = { five_hour: { used_percentage: 18, resets_at: (AGORA + 3 * H) / 1000 }, seven_day: null };
  const perfil = { peso: 0.5, h5: new Array(24).fill(3), d7: new Array(24).fill(null) };
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA }).five_hour, AGORA + 82 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil: null }).five_hour, AGORA + 82 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil }).five_hour, AGORA + 41 * MIN);
  assert.equal(preverEstouro({ historico, limites, agoraMs: AGORA, perfil }).seven_day, null);
});

test('R10: a guarda segue com a regressão pura; só o UserPromptSubmit passa o perfil', () => {
  const avaliar = fs.readFileSync(path.join(repo, 'src', 'guarda', 'avaliar.js'), 'utf8');
  const chamada = /preverEstouro\(\{[^}]*\}\)/.exec(avaliar);
  assert.ok(chamada, 'avaliar.js chama preverEstouro');
  assert.doesNotMatch(chamada[0], /perfil/);
  for (const nome of fs.readdirSync(path.join(repo, 'src', 'guarda'))) {
    if (!nome.endsWith('.js')) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(repo, 'src', 'guarda', nome), 'utf8'), /perfilDaPrevisao|ritmoMisturado/, nome);
  }
  const prompt = fs.readFileSync(path.join(repo, 'src', 'hooks', 'prompt-submit.js'), 'utf8');
  assert.match(prompt, /preverEstouro\(\{[^}]*\bperfil\b[^}]*\}\)/);
  assert.match(prompt, /perfilDaPrevisao/);
});

function hook(nome, home, entrada) {
  assert.ok(home.startsWith(os.tmpdir()));
  const env = {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    HADOUKEN_SETTINGS: path.join(home, 'settings.json'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  };
  return spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', nome)], { input: JSON.stringify(entrada), env, encoding: 'utf8', timeout: 30_000 });
}

test('§11: UserPromptSubmit com o aprendizado ligado e peso em vigor termina limpo', () => {
  const d = novoDir();
  ligar(d);
  comAjustes(d, { 'previsao.pesoPerfil': 0.5 });
  assert.equal(hook('session-start.js', d, { session_id: 'consumo-a', hook_event_name: 'SessionStart', source: 'startup' }).status, 0);
  const r = hook('prompt-submit.js', d, { session_id: 'consumo-a', hook_event_name: 'UserPromptSubmit', prompt: 'oi' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/aprendizado-consumo.test.js`
Expected: FAIL (`ritmoMisturado` não existe; o nível e o `recente` ainda são os de hoje).

- [ ] **Step 3: `src/previsao.js`**

No comentário do topo, depois do último parágrafo, acrescente:

```js
//
// Com o aprendizado ligado (spec aprendizado §4.3, R10), o UserPromptSubmit
// passa `perfil` ({ peso, h5, d7 } de perfilDaPrevisao): o ritmo atual é
// misturado ao ritmo típico da hora local, com peso de até 0,5. A guarda
// (src/guarda/avaliar.js) nunca passa perfil: um perfil que atrasasse a
// previsão afrouxaria o G1/G2 sem aprovação.
```

Logo depois de `const MINUTO_MS = 60_000;`, acrescente:

```js
// O máximo do item previsao.pesoPerfil (src/aprendizado/arquivos.js, ITENS).
const PESO_PERFIL_MAX = 0.5;
```

Logo antes do comentário de `preverJanela` ("// Previsão de uma janela: …"), acrescente:

```js
// R10: (1 − peso)·b + peso·típico da hora local, em pontos por minuto. Só
// com b > 0 (sem ritmo atual não há previsão, e o perfil não cria uma), peso
// em (0; PESO_PERFIL_MAX] e o típico da hora número finito > 0; em qualquer
// outro caso, b como veio. Nunca lança.
export function ritmoMisturado(b, perfil, coluna, agoraMs) {
  try {
    if (!numeroFinito(b) || b <= 0 || perfil === null || typeof perfil !== 'object') return b;
    const { peso } = perfil;
    if (!numeroFinito(peso) || peso <= 0 || peso > PESO_PERFIL_MAX) return b;
    const serie = perfil[coluna];
    if (!Array.isArray(serie) || serie.length !== 24 || !numeroFinito(agoraMs)) return b;
    const tipico = serie[new Date(agoraMs).getHours()];
    if (!numeroFinito(tipico) || tipico <= 0) return b;
    const r = (1 - peso) * b + peso * tipico;
    return numeroFinito(r) ? r : b;
  } catch {
    return b;
  }
}
```

Em `preverJanela`, acrescente o parâmetro `perfil = null` no fim da assinatura (`function preverJanela(historico, coluna, alcance, regras, janela, agoraMs, perfil = null) {`) e troque a linha `const b = inclinacao(pontos, regras);` por:

```js
  const b = ritmoMisturado(inclinacao(pontos, regras), perfil, coluna, agoraMs);
```

Em `preverEstouro`, troque a desestruturação `const { historico, limites, agoraMs } = opcoes ?? {};` por `const { historico, limites, agoraMs, perfil = null } = opcoes ?? {};` e a chamada `preverJanela(historico, coluna, alcance, regras, limites[k], agoraMs)` por `preverJanela(historico, coluna, alcance, regras, limites[k], agoraMs, perfil)`. Se a Task 7 da parte 2 mudou outras linhas de `preverJanela` (a extração de `pontosDaColuna`), as três trocas continuam valendo: ache os trechos citados. `ritmo7dPorHora` (parte 2) não muda.

- [ ] **Step 4: `src/uso/painel.js`**

Depois de `import { fraseEsgota } from './frase.js';`, acrescente:

```js
import { faixasDoPainel, intervaloDoPainelMs } from '../aprendizado/registro.js';
```

Troque a assinatura e a linha do `espera` de `barreira`:

```js
function barreira(uso, agoraMs, forcado, recenteMs = RECENTE_MS) {
```

```js
  const espera = MOTIVOS_ESPERA.has(uso.estado?.motivo) && msDe(uso.estado.em) === ultimo ? ESPERA_FALHA_MS : recenteMs;
```

Acrescente ao comentário de `barreira`: "`recenteMs` é o intervalo aprendido menos a folga de um tique (spec aprendizado §4.3, R9), ou RECENTE_MS." Em `talvezAtualizar`, logo depois de `const forcado = forcar === true;`, acrescente:

```js
    // Spec aprendizado §4.3 e R9: fora das horas ativas, o intervalo
    // aprendido no lugar dos 30 s, com a mesma folga de um tique. O comando
    // manual (forcar) segue com o piso de 5 s. Desligado: null, e nada muda.
    const aprendido = forcado ? null : intervaloDoPainelMs(dir, agoraMs);
    const recenteMs = aprendido === null ? RECENTE_MS : aprendido - (INTERVALO_MS - RECENTE_MS);
```

e troque as duas chamadas `barreira(lerUso(dir, agoraMs), agoraMs, forcado)` por `barreira(lerUso(dir, agoraMs), agoraMs, forcado, recenteMs)`.

Em `estadoPainel`, troque `nivel = pior >= 90 ? 'erro' : pior >= 75 ? 'aviso' : 'ok';` por:

```js
      // Spec aprendizado R14: as faixas aprendidas mudam só este nível; sem
      // aprendizado, 75 e 90, como antes.
      const faixas = faixasDoPainel(dir, agoraMs);
      nivel = pior >= faixas.vermelho ? 'erro' : pior >= faixas.amarelo ? 'aviso' : 'ok';
```

e, no comentário de `estadoPainel`, troque "'erro' a partir de 90%, 'aviso' a partir de 75%" por "'erro' a partir da faixa vermelha (90%, ou a aprendida), 'aviso' a partir da amarela (75%, ou a aprendida)". Não há ciclo de import: `registro.js` não importa `painel.js` (quem importa `RAM_MIN_BYTES` é `coletor.js` e `mensagens.js`, que o painel não carrega).

- [ ] **Step 5: `src/hooks/prompt-submit.js`**

Logo antes da linha que começa com `const previsao = preverEstouro({`, acrescente:

```js
  // Spec aprendizado §4.3 e R10: com o aprendizado ligado e peso > 0, a
  // previsão das linhas de alerta mistura o ritmo típico da hora. A guarda
  // (src/guarda/avaliar.js) segue com a regressão pura. Desligado, nada do
  // aprendizado é carregado além do módulo leve de nomes.
  let perfil = null;
  try {
    const { ligadoExiste } = await import('../aprendizado/arquivos.js');
    if (ligadoExiste(dir)) perfil = (await import('../aprendizado/registro.js')).perfilDaPrevisao(dir, agoraMs);
  } catch {
    perfil = null;
  }
```

e acrescente `perfil` ao objeto da chamada: `preverEstouro({ historico: estado?.historico, limites, agoraMs, perfil })` (se a parte 2 mudou os nomes nessa linha, mantenha os dela e só acrescente `, perfil` antes do `}`).

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test test/aprendizado-consumo.test.js test/uso-painel.test.js test/previsao.test.js test/hooks.test.js test/guarda-avaliar.test.js test/casa-unica.test.js`
Expected: PASS. `test/uso-painel.test.js` e `test/previsao.test.js` provam que, desligado, o painel e a previsão não mudaram.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `node --test`
Expected: PASS, sem teste cancelado.

- [ ] **Step 8: Commit**

```powershell
git add -- src/uso/painel.js src/previsao.js src/hooks/prompt-submit.js test/aprendizado-consumo.test.js
git commit -m @'
feat: learned panel bands and off-hours interval, hourly pace blend in alert forecasts only (spec aprendizado 4.3, 11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- src/uso/painel.js src/previsao.js src/hooks/prompt-submit.js test/aprendizado-consumo.test.js
```

---

### Task 14: Documentação e roteiro manual (§4.6, §5, §10, §11)

**Files:**
- Modify: `README.md`, `README.en.md`, `SECURITY.md`

A versão já é 0.4.0 (Task 20 da parte 2): nenhum manifesto muda. Todo texto acentuado vai pelo Edit. Cada trecho abaixo entra no ponto indicado pelo **texto a achar**, não pelo número da linha (a parte 2 mexeu nesses arquivos). As chaves do `env` citadas em L5 são as de `CHAVES_LIGAR` da Task 9; se a Emenda A1 mudou essa lista, o texto segue o código.

- [ ] **Step 1: `README.md`, seção nova antes de `## Instalação`**

Logo antes da linha `## Instalação`, acrescente (e, no Sumário, a entrada `- [Aprendizado local (opcional)](#aprendizado-local-opcional)` logo antes de `- [Instalação](#instalação)`):

````markdown
## Aprendizado local (opcional)

Desligado por padrão. Ligado, o hadouken aprende só nesta máquina, sem gastar tokens, com duas fontes: o OpenTelemetry do próprio Claude Code, recebido por um Collector oficial (`otelcol-contrib`) que escuta só em `127.0.0.1:47318`, e os dados que os hooks já gravam. Com isso ele ajusta sozinho o conforto, dentro de limites fixos no código, e só **aperta** a guarda sozinho. Afrouxar a guarda e trocar de modelo ficam como sugestões que o senhor aprova.

### Ligar, em dois tempos

1. `/claude-hadouken:aprender ligar` mostra o plano, sem mudar nada: a versão do Collector, o endereço do download no GitHub, o tamanho máximo, a pasta (`~/.claude/hadouken/otel/`), as chaves que entram no `env` do `settings.json` e um código de 8 caracteres.
2. `/claude-hadouken:aprender ligar <código>` executa: baixa o Collector uma vez, confere o SHA-256 fixado no código (fora do hash, o arquivo é apagado e nada muda), extrai com o `tar` do sistema, grava a configuração e só então acrescenta as chaves ao `env` do `settings.json`, com cópia de segurança. Se o `settings.json` mudou entre os dois tempos, o código não confere e nada é feito.

O `ligar` recusa se `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` ou `OTEL_LOG_RAW_API_BODIES` estiver ligado, ou se já houver outro endpoint OTLP configurado. A telemetria vale a partir da sessão seguinte. O comando é um hook que roda antes do modelo: não gasta tokens, e uma sessão `claude -p` (um script ou um subagente) é recusada.

O Collector sobe no início de cada sessão (sem janela, sem esperar), não sobe com menos de 1,5 GiB de memória livre e para no fim da última sessão aberta.

### O que ele ajusta sozinho

Só depois de 7 dias corridos com dados **e** 20 sessões, e no máximo um ajuste por item a cada 24 h:

| Item | Limites | Quando muda |
|---|---|---|
| Intervalo do painel fora das horas ativas | 30 a 120 s | Nas suas horas ativas o painel lê a cada 30 s; fora delas, a cada 60 e depois 120 s. |
| Faixa amarela do painel | 60 a 85% | Pela antecedência, no seu histórico, entre cruzar a faixa e esgotar a janela. |
| Faixa vermelha do painel | 85 a 95% | Idem. |
| Peso do ritmo por hora na previsão | 0 a 0,5 | Sobe de 0,1 em 0,1 quando o ritmo por hora cobre 80% das suas horas ativas. Vale para os avisos ao Claude; a guarda continua com o ritmo atual. |
| Teto do Fable e teto de 7 dias da guarda | Só para baixo, 5 pontos por vez, nunca abaixo de 70% | Quando a janela esgotou em 2 das 3 últimas semanas. |

As faixas aprendidas mudam só a cor do painel do VS Code; os avisos ao Claude seguem as faixas de sempre.

### Sugestões, nunca aplicadas sozinhas

- **Afrouxar a guarda**, até no máximo o valor do seu `config.json`, quando sobrou mais de 30% nas últimas 4 semanas.
- **Trocar de modelo ou effort** numa origem (a sessão principal ou um subagente), quando o outro custou no máximo metade por pedido, com erros até 2 pontos piores e pelo menos 20 pedidos de cada lado. A medida é indireta (custo e erros, não qualidade), e a troca nunca é feita pelo hadouken.

### Comandos

| Comando | O que faz |
|---|---|
| `/claude-hadouken:aprender` ou `… status` | O estado, os ajustes em vigor, as sugestões e os últimos eventos. |
| `… ligar`, `… ligar <código>` | A prévia e a execução, acima. |
| `… desligar` | Para o Collector e tira do `env` só as chaves com o valor que o `ligar` pôs. Os dados ficam; `desligar dados` apaga os dados aprendidos, e `desligar tudo` apaga também a pasta `otel/`, com o binário. |
| `… desfazer`, `… desfazer aN` | Volta o último ajuste (ou o `aN`) e bloqueia o item por 7 dias. |
| `… aprovar sN`, `… recusar sN` | Aplica ou descarta uma sugestão; recusar bloqueia a mesma sugestão por 7 dias. |

No início da sessão, no máximo uma vez por dia e só quando há novidade, aparece só para o senhor, fora do contexto do Claude, uma linha como:

```
Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status).
```

### Privacidade do aprendizado

- **Primeira barreira, no Collector:** apaga `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` e todo `vcs.*` antes de gravar; recebe só OTLP/HTTP em 127.0.0.1, sem gRPC, sem extensões e sem outro exportador.
- **Segunda barreira, no leitor:** cada registro é montado do zero, só com modelo, effort, origem, custo, tokens, duração e resultado; o resto, inclusive `session.id`, é descartado.
- **Conteúdo, nunca:** prompts, detalhes de ferramenta e corpos de API ficam desligados, e o `ligar` recusa se algum estiver ligado.
- **Retenção:** o arquivo bruto gira em 5 MB, com 3 antigos e 30 dias; os agregados guardam 26 semanas.
- **Nada sai da máquina:** a única rede é o download do Collector, uma vez, pelo `ligar <código>`.

---

````

- [ ] **Step 2: `README.md`, as outras seções**

1. Em `## Onde ficam os dados`, na tabela, logo depois da linha de `` `bin/` ``, acrescente:

```markdown
| `otel/` | Só com o aprendizado ligado: o Collector (`bin/`), a configuração gerada (`config.yaml`), a telemetria filtrada (`telemetria.jsonl`, com rotação), o PID, o log da subida e o registro do que o `ligar` pôs no `settings.json` (`ligado.json`). |
| `aprendizado.json`, `ajustes.json`, `sugestoes.json` | Só com o aprendizado ligado: os agregados (26 semanas), os ajustes em vigor com o registro de cada um e as sugestões. |
| `aprendizado-cursor.json`, `aprendizado-eventos.json`, `aprendizado.lock` | Só com o aprendizado ligado: até onde a telemetria foi lida, os últimos eventos (porta ocupada, pouca memória…) e a trava de um passo por vez. |
```

2. Em `## Privacidade e segurança`, no **Resumo**: ao fim do item que começa com `- **Sem telemetria.**`, acrescente " O aprendizado local, opcional e desligado por padrão, recebe o OpenTelemetry do Claude Code só em 127.0.0.1 e o guarda na pasta de dados, filtrado."; ao fim do item que começa com `- **Rede:`, " Com o aprendizado ligado, também o download único do Collector, do GitHub, com o SHA-256 conferido."; ao fim do item que começa com `- **Onde grava:**`, " O `ligar` e o `desligar` do aprendizado mudam só as chaves de telemetria do `env` do `settings.json`, com o mesmo gravador e a mesma cópia de segurança." No parágrafo **A garantia**, depois de "`uso-oficial.json` adulterado)", acrescente "; e, do aprendizado, L1 a L8: OTLP forjado, binário trocado, vazamento de identidade, porta exposta, `settings.json` corrompido, `ajustes.json` apagado, o download e os processos do Collector".

3. Em `## Roteiro`, ao fim do item que começa com `- **v0.4.0**`, acrescente: " E o aprendizado local, opcional: o hadouken aprende com o OpenTelemetry do Claude Code, só nesta máquina e sem tokens, ajusta o conforto dentro de limites fixos, só aperta a guarda sozinho e deixa afrouxar e trocar de modelo como sugestão."

- [ ] **Step 3: `README.en.md`**

Logo antes de `## Installation`, acrescente (e, em Contents, `- [Local learning (optional)](#local-learning-optional)` logo antes de `- [Installation](#installation)`):

````markdown
## Local learning (optional)

Off by default. When on, hadouken learns on this machine only, spending no tokens, from two sources: Claude Code's own OpenTelemetry, received by an official Collector (`otelcol-contrib`) that listens only on `127.0.0.1:47318`, and the data the hooks already save. With that it adjusts comfort settings by itself, within limits fixed in the code, and only ever **tightens** the guard by itself. Loosening the guard and switching models stay as suggestions you approve.

### Turning it on, in two steps

1. `/claude-hadouken:aprender ligar` shows the plan and changes nothing: the Collector version, the GitHub download address, the maximum size, the folder (`~/.claude/hadouken/otel/`), the keys that go into the `env` of `settings.json`, and an 8-character code.
2. `/claude-hadouken:aprender ligar <code>` does it: downloads the Collector once, checks the SHA-256 pinned in the code (on a mismatch the file is deleted and nothing changes), extracts it with the system `tar`, writes the configuration and only then adds the keys to the `env` of `settings.json`, with a backup. If `settings.json` changed between the two steps, the code does not match and nothing happens.

`ligar` refuses if `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` or `OTEL_LOG_RAW_API_BODIES` is on, or if another OTLP endpoint is already configured. Telemetry starts with the next session. The command is a hook that runs before the model: it spends no tokens, and a `claude -p` session (a script or a subagent) is refused.

The Collector starts at the beginning of each session (no window, no waiting), does not start with less than 1.5 GiB of free memory, and stops at the end of the last open session.

### What it adjusts by itself

Only after 7 calendar days of data **and** 20 sessions, and at most one change per item every 24 h:

| Item | Limits | When it changes |
|---|---|---|
| Panel interval outside active hours | 30 to 120 s | During your active hours the panel reads every 30 s; outside them, every 60 and then 120 s. |
| Panel yellow band | 60 to 85% | From the lead time, in your history, between crossing the band and running out of the window. |
| Panel red band | 85 to 95% | Same. |
| Weight of the hourly pace in the forecast | 0 to 0.5 | Goes up 0.1 at a time when the hourly pace covers 80% of your active hours. It applies to the notices Claude receives; the guard keeps the current pace. |
| Guard's Fable ceiling and 7-day ceiling | Down only, 5 points at a time, never below 70% | When the window ran out in 2 of the last 3 weeks. |

Learned bands only change the colour of the VS Code panel; the notices Claude receives keep the usual bands.

### Suggestions, never applied by themselves

- **Loosen the guard**, at most up to the value in your `config.json`, when more than 30% was left over in the last 4 weeks.
- **Switch model or effort** for one origin (the main session or a subagent), when the other one cost at most half per request, with errors at most 2 points worse and at least 20 requests on each side. The measure is indirect (cost and errors, not quality), and hadouken never makes the switch.

### Commands

| Command | What it does |
|---|---|
| `/claude-hadouken:aprender` or `… status` | The state, the adjustments in force, the suggestions and the latest events. |
| `… ligar`, `… ligar <code>` | The preview and the run, above. |
| `… desligar` | Stops the Collector and removes from `env` only the keys with the value `ligar` wrote. The data stays; `desligar dados` deletes the learned data, and `desligar tudo` also deletes the `otel/` folder, binary included. |
| `… desfazer`, `… desfazer aN` | Reverts the last adjustment (or `aN`) and locks the item for 7 days. |
| `… aprovar sN`, `… recusar sN` | Applies or discards a suggestion; discarding locks the same suggestion for 7 days. |

At the start of a session, at most once a day and only when there is something new, a line like this shows up for you only, outside Claude's context (the plugin's messages are in Portuguese):

```
Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status).
```

### Learning privacy

- **First barrier, in the Collector:** deletes `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` and every `vcs.*` before writing; it only takes OTLP/HTTP on 127.0.0.1, with no gRPC, no extensions and no other exporter.
- **Second barrier, in the reader:** every record is rebuilt from scratch with only model, effort, origin, cost, tokens, duration and outcome; everything else, `session.id` included, is dropped.
- **Content, never:** prompts, tool details and API bodies stay off, and `ligar` refuses if any of them is on.
- **Retention:** the raw file rotates at 5 MB, keeping 3 old files and 30 days; the aggregates keep 26 weeks.
- **Nothing leaves the machine:** the only network access is the Collector download, once, through `ligar <code>`.

---

````

Nas outras seções do `README.en.md`, as mesmas mudanças do Step 2, em inglês:

1. `## Where the data lives`, depois da linha de `` `bin/` ``:

```markdown
| `otel/` | Only with learning on: the Collector (`bin/`), the generated configuration (`config.yaml`), the filtered telemetry (`telemetria.jsonl`, rotated), the PID, the startup log and the record of what `ligar` put into `settings.json` (`ligado.json`). |
| `aprendizado.json`, `ajustes.json`, `sugestoes.json` | Only with learning on: the aggregates (26 weeks), the adjustments in force with a record of each one, and the suggestions. |
| `aprendizado-cursor.json`, `aprendizado-eventos.json`, `aprendizado.lock` | Only with learning on: how far the telemetry has been read, the latest events (port busy, low memory…) and the one-step-at-a-time lock. |
```

2. `## Privacy and security`, no resumo: ao fim do item de telemetria, " Local learning, optional and off by default, receives Claude Code's OpenTelemetry only on 127.0.0.1 and keeps it, filtered, in the data folder."; ao fim do item de rede, " With learning on, also the one-time Collector download from GitHub, with its SHA-256 checked."; ao fim do item de onde grava, " Learning's `ligar` and `desligar` change only the telemetry keys in the `env` of `settings.json`, with the same writer and the same backup."; no parágrafo da garantia, depois da lista do painel, "; and, for learning, L1 to L8: forged OTLP, swapped binary, identity leak, exposed port, corrupted `settings.json`, deleted `ajustes.json`, the download and the Collector's processes".

3. `## Roadmap`, ao fim do item `- **v0.4.0**`: " Plus optional local learning: hadouken learns from Claude Code's OpenTelemetry, on this machine only and with no tokens, adjusts comfort within fixed limits, only tightens the guard by itself, and leaves loosening and model switches as suggestions."

- [ ] **Step 4: `SECURITY.md` (PT e EN)**

Na lista de **Escopo** em português, depois do último item `S…` (o último que a parte 2 deixou), acrescente:

```markdown
- **L1, OTLP forjado para a porta do Collector** (v0.4.0, aprendizado; um processo local manda eventos falsos para `127.0.0.1:47318`). O leitor monta cada registro do zero, com teto de 1 MiB por linha e 20 MB por leitura, e descarta instante mais de 40 dias atrás ou 5 min à frente. O que ele aprende só move o conforto dentro de limites fixos no código ou aperta a guarda; afrouxar exige `/claude-hadouken:aprender aprovar`, que só o usuário digita. Os textos são fixos e não repetem nada da telemetria.
- **L2, binário do Collector trocado.** O SHA-256 do `.tar.gz` de cada plataforma é fixado no código e conferido no download; fora do hash, o arquivo é apagado e nunca extraído. O hash do binário extraído fica em `otel/bin/instalado.json` e é conferido de novo a cada subida em que o tamanho ou o mtime mudarem; fora dele, o Collector não é executado e a sessão avisa.
- **L3, vazamento de identidade para arquivo.** Duas barreiras: o Collector apaga `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` e todo `vcs.*` antes de gravar, e o leitor reconstrói só os campos que usa (modelo, effort, origem, custo, tokens, duração, resultado), sem ler `session.id`. Prompts, detalhes de ferramenta e corpos de API ficam desligados, e o `ligar` recusa se algum estiver ligado.
- **L4, porta exposta na rede.** O Collector escuta só em `127.0.0.1`, só OTLP/HTTP, sem gRPC, sem extensões e com a telemetria própria desligada. Com a porta ocupada, ele não sobe (nunca tenta outra porta) e a sessão seguinte avisa.
- **L5, `settings.json` corrompido pelo `ligar`, ou `ligar` acionado sem o usuário.** O `ligar` é em dois tempos: a prévia mostra o plano e um código que é o SHA-256 dos bytes do `settings.json` com o plano; o `ligar <código>` recusa se o arquivo mudou. A gravação usa o mesmo gravador do instalador (sem seguir link, com teto, formato preservado, troca atômica, cópia `settings.json.bak-hadouken-<ms>`) e mexe só nas chaves do `env` `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRICS_INCLUDE_ACCOUNT_UUID`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_LOGS_EXPORT_INTERVAL` e `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`; o `desligar` tira só as que ainda têm o valor que o `ligar` gravou (`otel/ligado.json`). O comando é um hook `UserPromptExpansion` que bloqueia a expansão (sem modelo); a skill tem `disable-model-invocation: true`, e uma sessão `claude -p` (entrypoint `sdk-*`) é recusada sem gravar nada.
- **L6, apagar `ajustes.json` para soltar um aperto aprendido.** **Limite aceito:** sem o `ajustes.json` (ou com ele inválido, link ou acima de 64 KiB, ou com o aprendizado desligado), a guarda volta ao `config.json`, que o próprio usuário escolheu. Quem apaga o arquivo já roda como o usuário e poderia editar o `config.json` direto; o aperto aprendido nunca fica abaixo do piso de 70% nem acima do que o usuário configurou.
- **L7, a rede do aprendizado.** Só `src/aprendizado/baixar.js` abre conexão (teste de fronteiras pelo texto do código): um GET HTTPS do release do Collector no GitHub, com lista fixa de hosts inclusive nos redirecionamentos, teto de tamanho e de tempo, e só pelo `ligar <código>` que o usuário digitou. O Claude Code manda o OTLP só para `127.0.0.1`.
- **L8, os processos do aprendizado.** Só `src/aprendizado/coletor.js` cria processo: o `tar` do sistema (com cwd na pasta do binário e só o membro fixado), `tasklist`/`ps`, `taskkill` e o próprio Collector; no Windows, tudo do System32 por caminho absoluto, e sempre por `execFile`/`spawn` sem shell, com argumentos fixos. O Collector sobe desanexado, sem janela e com ambiente mínimo (sem `OTEL_*` nem segredo); o PID é conferido pelo nome do processo antes de parar; com menos de 1,5 GiB livres, não sobe.
```

Em **O que o plugin nunca faz** (PT): ao fim do item **Rede:**, acrescente " Desde a v0.4.0, com o aprendizado ligado (opcional, desligado por padrão), há mais duas: o download único do Collector (L7) e o OTLP que o Claude Code manda ao Collector em `127.0.0.1`, que não sai da máquina (L4)."; ao fim do item **Telemetria:**, " O aprendizado local recebe o OpenTelemetry do Claude Code só em `127.0.0.1` e o guarda filtrado na pasta de dados (L3); nada vai a serviço nenhum."; ao fim do item **Gravação fora de `~/.claude/hadouken/`:**, " O `ligar` e o `desligar` do aprendizado mudam só as chaves de telemetria do `env` do mesmo `settings.json`, com o mesmo gravador e a mesma cópia (L5)."

Na parte em inglês, depois do último `S…` do **Scope**:

```markdown
- **L1, forged OTLP sent to the Collector port** (v0.4.0, learning; a local process sends fake events to `127.0.0.1:47318`). The reader rebuilds every record from scratch, capped at 1 MiB per line and 20 MB per read, and drops instants more than 40 days old or 5 min ahead. What it learns can only move comfort settings within limits fixed in the code or tighten the guard; loosening requires `/claude-hadouken:aprender aprovar`, which only the user types. Texts are fixed and repeat nothing from the telemetry.
- **L2, swapped Collector binary.** The SHA-256 of each platform's `.tar.gz` is pinned in the code and checked on download; on a mismatch the file is deleted and never extracted. The extracted binary's hash is kept in `otel/bin/instalado.json` and checked again on every start where its size or mtime changed; on a mismatch the Collector is not run and the session warns.
- **L3, identity leak into a file.** Two barriers: the Collector deletes `user.email`, `user.account_uuid`, `user.account_id`, `user.id`, `organization.id`, `workspace.host_paths` and every `vcs.*` before writing, and the reader rebuilds only the fields it uses (model, effort, origin, cost, tokens, duration, outcome), never reading `session.id`. Prompts, tool details and API bodies stay off, and `ligar` refuses if any of them is on.
- **L4, port exposed to the network.** The Collector listens only on `127.0.0.1`, OTLP/HTTP only, with no gRPC, no extensions and its own telemetry off. If the port is busy it does not start (it never tries another port) and the next session warns.
- **L5, `settings.json` corrupted by `ligar`, or `ligar` triggered without the user.** `ligar` has two steps: the preview shows the plan and a code that is the SHA-256 of the `settings.json` bytes with the plan; `ligar <code>` refuses if the file changed. Writing uses the installer's writer (no link following, size cap, format kept, atomic swap, `settings.json.bak-hadouken-<ms>` backup) and touches only the `env` keys `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRICS_INCLUDE_ACCOUNT_UUID`, `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_LOGS_EXPORT_INTERVAL` and `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`; `desligar` removes only those that still hold the value `ligar` wrote (`otel/ligado.json`). The command is a `UserPromptExpansion` hook that blocks the expansion (no model); the skill has `disable-model-invocation: true`, and a `claude -p` session (`sdk-*` entrypoint) is refused without writing anything.
- **L6, deleting `ajustes.json` to release a learned tightening.** **Accepted limit:** without `ajustes.json` (or with it invalid, a link or above 64 KiB, or with learning off) the guard falls back to `config.json`, which the user chose. Whoever deletes the file already runs as the user and could edit `config.json` directly; a learned tightening never goes below the 70% floor nor above what the user configured.
- **L7, learning's network access.** Only `src/aprendizado/baixar.js` opens a connection (boundary test over the source text): an HTTPS GET of the Collector release on GitHub, with a fixed host list also for redirects, size and time caps, and only through the `ligar <code>` the user typed. Claude Code sends OTLP only to `127.0.0.1`.
- **L8, learning's processes.** Only `src/aprendizado/coletor.js` creates processes: the system `tar` (cwd in the binary folder, only the pinned member), `tasklist`/`ps`, `taskkill` and the Collector itself; on Windows everything comes from System32 by absolute path, always through `execFile`/`spawn` without a shell, with fixed arguments. The Collector starts detached, without a window and with a minimal environment (no `OTEL_*`, no secrets); the PID is checked against the process name before stopping it; with less than 1.5 GiB free it does not start.
```

Em **What the plugin never does**: ao fim de **Network:**, " Since v0.4.0, with learning on (optional, off by default), there are two more: the one-time Collector download (L7) and the OTLP that Claude Code sends to the Collector on `127.0.0.1`, which never leaves the machine (L4)."; ao fim de **Telemetry:**, " Local learning receives Claude Code's OpenTelemetry only on `127.0.0.1` and keeps it, filtered, in the data folder (L3); nothing goes to any service."; ao fim de **Writes outside `~/.claude/hadouken/`:**, " Learning's `ligar` and `desligar` change only the telemetry keys in the `env` of the same `settings.json`, with the same writer and the same backup (L5)."

- [ ] **Step 5: Conferir os textos**

```powershell
Select-String -Path README.md -Pattern '\(#aprendizado-local-opcional\)' | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path README.en.md -Pattern '\(#local-learning-optional\)' | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path SECURITY.md -Pattern '^- \*\*L[1-8],' | Measure-Object | Select-Object -ExpandProperty Count
git diff --stat -- README.md README.en.md SECURITY.md
```

Expected: `1`, `1`, `16` (L1 a L8 em PT e em EN); o diff só nos três arquivos. Depois, `node --test` (a documentação não muda nenhum teste; a suíte segue PASS).

- [ ] **Step 6: Commit**

```powershell
git add -- README.md README.en.md SECURITY.md
git commit -m @'
docs: README (PT/EN) local learning section, data files and roadmap; SECURITY L1-L8 (spec aprendizado 10, ajustes.json limit, download and Collector processes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@ -- README.md README.en.md SECURITY.md
```

- [ ] **Step 7: Roteiro manual (controlador, com o Sr. Garioli na frente da tela)**

Com o Collector real, uma sessão real e **nada** do `~/.claude` de verdade: `HADOUKEN_HOME` e `HADOUKEN_SETTINGS` temporários, o `env` lido pelo `--settings` do Claude Code, o plugin pelo `--plugin-dir` do worktree e o modelo `haiku` (as sessões gastam alguns centavos: o controlador pede a autorização antes). Tudo no PowerShell (nunca `claude` com argumento `/…` pelo Git Bash).

```powershell
$S = "$env:TEMP\hadouken-spike-aprendizado"
$h = "$env:TEMP\hdk-roteiro-aprendizado"; New-Item -ItemType Directory -Force $h | Out-Null
'{}' | Set-Content -Encoding utf8 "$h\settings.json"
$env:HADOUKEN_HOME = $h; $env:HADOUKEN_SETTINGS = "$h\settings.json"; $env:HADOUKEN_SEM_PAINEL = '1'
$wt = 'E:\Projetos DEV\claude-hadouken-guarda'
```

1. `claude --model haiku --plugin-dir $wt --settings "$h\settings.json"`. Digite `/claude-hadouken:aprender ligar`. Esperado: a prévia com a versão da Emenda A2, a URL, o tamanho máximo, a pasta e o código. Digite `/claude-hadouken:aprender ligar <código>`. Esperado: "ligado", com a cópia do `settings.json`. Saia (`/exit`). Confira:

```powershell
(Get-Content "$h\settings.json" -Raw | ConvertFrom-Json).env
(Get-FileHash "$h\otel\bin\otelcol-contrib.exe").Hash -eq (Get-FileHash "$S\a2\otelcol-contrib.exe").Hash
```

Esperado: só as chaves de `CHAVES_LIGAR`; `True`.

2. Abra a sessão de novo (mesmo comando). Esperado: sem aviso do Collector. Confira noutra janela do PowerShell:

```powershell
Get-Process otelcol-contrib | Select-Object Id, @{n='MiB';e={[math]::Round($_.WorkingSet64 / 1MB)}}
Get-NetTCPConnection -LocalPort 47318 -State Listen | Select-Object LocalAddress, LocalPort
```

Esperado: um processo só, com no máximo 120 MiB (o portão da A2); escuta só em `127.0.0.1`.

3. Na sessão, mande `responda só ok: marcador-hdk-7431` e depois `leia o README.md e diga o título`. Espere uns 10 s (o `batch` do Collector). Confira:

```powershell
Get-ChildItem "$h\otel" -Filter 'telemetria*.jsonl' | Select-Object Name, Length
Select-String -Path "$h\otel\telemetria*.jsonl" -Pattern 'user\.email|user\.account_uuid|user\.account_id|"user\.id"|organization\.id|workspace\.host_paths|"vcs\.' | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path "$h\otel\telemetria*.jsonl" -Pattern '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path "$h\otel\telemetria*.jsonl" -SimpleMatch 'marcador-hdk-7431' | Measure-Object | Select-Object -ExpandProperty Count
```

Esperado: `telemetria.jsonl` com tamanho > 0; as três contagens `0` (nenhum campo de §5.1, nenhum endereço de e-mail, nenhum texto de prompt).

4. Na sessão, `/claude-hadouken:aprender status`. Esperado: ligado, Collector vivo, 0 ajustes (o piso de 7 dias e 20 sessões ainda não passou). Saia. Em até uns 5 s, `Get-Process otelcol-contrib -ErrorAction SilentlyContinue` não acha nada (sem outra sessão, o SessionEnd parou o Collector; com `A3_ATRAPALHA = true`, o esperado é o Collector seguir vivo, e o item anota isso). Abra e feche a sessão mais uma vez e confira `(Get-Content "$h\aprendizado.json" -Raw | ConvertFrom-Json).sessoes` ≥ 2 e `.semanas[-1].modelos` com pelo menos uma chave terminada em `|principal`.

5. Pelo PowerShell, `claude -p "/claude-hadouken:aprender desligar" --plugin-dir $wt --settings "$h\settings.json"`. Esperado: a recusa de sessão não interativa ("só aceita comandos digitados pelo usuário"), e o `env` do `settings.json` igual ao do item 1.

6. Numa sessão interativa, `/claude-hadouken:aprender desligar tudo`. Esperado: "aprendizado desligado", as chaves fora do `env` (`(Get-Content "$h\settings.json" -Raw | ConvertFrom-Json).env` sem nenhuma delas) e `Test-Path "$h\otel"` → `False`.

7. Limpe: `Remove-Item Env:HADOUKEN_HOME, Env:HADOUKEN_SETTINGS, Env:HADOUKEN_SEM_PAINEL; Remove-Item -Recurse -Force $h, $S`.

Anote o resultado de cada item no registro do plano. Um item que falha volta ao implementador da task dona (2 a 13) com o passo exato, antes da Task 15.

---

### Task 15: Portão de segurança da v0.4.0 (branch inteiro: guarda partes 1 e 2 e aprendizado)

Quem faz esta tarefa é o controlador, sem implementador. É o **único** portão Fable da v0.4.0: o da Task 19 da parte 1 e o da parte 2 foram movidos para cá.

- [ ] **Step 1: Suíte e bench**

Run: `node --test` e `node bench/aprendizado.mjs` (e os benches da parte 2, como ela manda).
Expected: suíte PASS, sem teste cancelado; os números do bench anotados para o revisor.

- [ ] **Step 2: Linha do hadouken e liberação**

Leia a linha do hadouken. Com alerta de projeção, pare e pergunte ao Sr. Garioli. O revisor `fable-xhigh` é despacho caro (G5): se a versão instalada ainda é a v0.3.0, sem a guarda, não há trava, mas registre que, com a v0.4.0 em uso, o portão exige `/claude-hadouken:liberar caro` digitado por ele.

- [ ] **Step 3: Despachar um único revisor `fable-xhigh`** sobre o branch `v0.4.0-guarda` inteiro, contra `8d1bff3`, com o brief:

"Revisão de segurança do claude-hadouken v0.4.0 (branch `v0.4.0-guarda` inteiro contra `8d1bff3`, a base: v0.3.0 com a correção de CI): a guarda (partes 1 e 2) e o aprendizado local. Specs: `docs/superpowers/specs/2026-09-29-guardiao-design.md` e `docs/superpowers/specs/2026-09-30-aprendizado-design.md`; valem as emendas do fim de cada uma. Planos: `docs/superpowers/plans/2026-09-29-guardiao-parte1-guarda.md`, `2026-09-30-guardiao-parte2.md` e `2026-09-30-aprendizado.md` (resoluções R1–R14). Procure, com arquivo e linha: (1) qualquer caminho em que o modelo, um subagente ou uma sessão `claude -p` se libere sozinho, solte uma trava, aprove uma sugestão, afrouxe a guarda ou ligue/desligue o aprendizado sem o usuário; (2) fail-open onde a spec pede fail-closed (guarda.json ilegível) e aperto aprendido que afrouxe algo (a guarda deve ler só `min(config.json, aperto)`); (3) texto de arquivo, telemetria, stdin, frontmatter, ambiente ou argumento chegando ao contexto do Claude, ao `systemMessage`, à barra ou ao painel sem passar por modelo fixo e número validado; (4) leitura sem lstat ou sem teto, gravação não atômica, cursor ou arquivo que cresce sem limite, e instante futuro que trave algo para sempre, nos arquivos novos; (5) rede fora de `src/aprendizado/baixar.js`, processo filho fora de `src/aprendizado/coletor.js` (e dos módulos que já tinham na v0.3.0), e em `src/guarda/**` nenhum dos dois; (6) no download e na extração: host fora da lista (inclusive por redirecionamento), hash conferido depois de extrair, `.tar.gz` fora do hash que sobra no disco, membro do tar que escape da pasta; (7) no Collector: escuta fora de 127.0.0.1, gRPC, campo de identidade de §5.1 que chegue ao `telemetria.jsonl` ou ao `aprendizado.json`, conteúdo (§5.2) ligável, ambiente herdado com segredo, PID morto sem conferir o nome; (8) no `settings.json`: gravação que perca chave do usuário ou siga link, e `desligar` que tire uma chave que não foi o `ligar` que pôs; (9) bloqueio que perde trabalho em andamento (task-notification, subagente em segundo plano); (10) desvios do D1 e do D4 emendados da guarda e das resoluções R1–R14. Não rode testes; o controlador já rodou (a saída do Step 1 vai anexa). Classifique cada achado como crítico, importante ou menor, e diga 'nenhum achado' se for o caso."

- [ ] **Step 4: Correções**

Achados críticos e importantes: um implementador `opus-high` por achado (ou por grupo do mesmo arquivo), com teste que falha antes e passa depois e commit com pathspec explícito; depois, uma re-revisão Sonnet escopada no diff da correção. Os menores vão ao Sr. Garioli numa lista, e ele decide. `node --test` de novo no fim.

- [ ] **Step 5: Relato**

Relate ao Sr. Garioli: os achados e o que foi feito de cada um, os números do bench, o roteiro manual da Task 14 e o consumo por modelo do bloco (a linha do hadouken antes e depois, e o `/claude-hadouken:consumo`). A versão fica em 0.4.0 (Task 20 da parte 2). **Sem tag e sem push**: o release é decisão dele.
