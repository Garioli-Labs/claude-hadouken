# Painel no VS Code, leitura oficial do Fable e barra só da sessão (v0.3.0): plano de implementação

> **Para executores:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development. Os passos usam checkbox (`- [ ]`).

**Objetivo:** mostrar 5h, semana e Fable com os mesmos números da aba Uso do claude.ai, uma vez só, num item da barra de status do VS Code, com custo zero de tokens e RAM contida. A barra do terminal fica só com o que é da sessão.

**Arquitetura:**
- **Leitura.** O plugin roda `claude -p /usage` no modo enxuto. É comando local do Claude Code, sem modelo e sem tokens. O resultado é interpretado e gravado em `<dirDados>/uso-oficial.json`.
- **Extensão.** Uma extensão VS Code mínima carrega a lógica do plugin por um shim estável (`<dirDados>/bin/painel.mjs`) e mostra um item na barra de status. A cada 30 s ela pede uma nova leitura: uma por vez entre as janelas, só com sessão ativa e com pausa quando falta RAM.
- **Instalação.** O SessionStart instala a extensão em segundo plano, montando um `.vsix` sem dependências.

**Stack:** Node ≥ 20 ESM, zero dependências, `node --test`. Extensão em CommonJS (`extension.cjs`), que usa `import()` dinâmico para o ESM do plugin.

**Spec:** `docs/superpowers/specs/2026-09-29-guardiao-design.md`, seção "Emenda 2026-09-29 (noite)" (E1–E8).

## Restrições globais

- Zero dependências de npm e zero tokens. Nada no plugin chama o modelo, e nenhum texto novo entra no contexto do Claude, exceto a linha do SessionStart que já existe (E5).
- Nenhuma função exportada lança. Falha vira `{ ok: false, motivo }` ou `null`, no estilo do repo.
- Comentários em português, citando a seção da spec (E2, E3...). Os nomes seguem o repo (`dirDados`, `lerJson`, `gravarJsonAtomico`, `instante`, `numeroFinito`).
- Texto com acento só pelo Write/Edit (UTF-8, LF).
- **Não faça commit.** O controlador faz os commits por tarefa, com pathspec explícito.
- Rode só os seus testes (`node --test test/<seu>.test.js`) e, no fim, `node --test`. Falha em arquivo de outra tarefa em andamento não é sua: relate e siga.
- `quandoLocal` é nome reservado para a Task 2 do plano da parte 1. Aqui o nome é `momentoFalado`.
- Não mexer em `~/.claude/hadouken` real nos testes. Use pasta temporária e `HADOUKEN_HOME`, como os testes existentes.

## Foco de revisão

1. **Mudança no formato do `/usage`.** Linha nova, ordem trocada, `resets` sem data, porcentagem com decimal: o parser não pode inventar número. Linha que não casa vira "sem leitura", nunca 0.
2. **Custo.** Se o `/usage` um dia chamar o modelo (`num_turns > 0`, `total_cost_usd > 0` ou `local_command` diferente de `usage`), a leitura para por 24 h e o painel diz "bloqueado: custo".
3. **Várias janelas do VS Code.** Duas extensões ao mesmo tempo não disparam duas leituras: a trava `wx` resolve, e uma trava vencida (processo morto) é retomada depois de 90 s.
4. **Pouca RAM.** Com `os.freemem()` abaixo de 1,5 GiB, nenhuma leitura é disparada, nem pelo comando manual.
5. **Plugin atualizado ou shim ausente.** A extensão não quebra: mostra "Hadouken: abra uma sessão do Claude Code" e tenta de novo a cada 60 s.

## Mapa de arquivos

| Arquivo | Tarefa | Papel |
|---|---|---|
| `src/uso/oficial.js` | T1 | localizar o `claude`, montar os argumentos enxutos, rodar e interpretar o `/usage` |
| `src/uso/frase.js` | T1 | `momentoFalado`, `fraseEsgota` (E5) |
| `test/uso-oficial.test.js`, `test/uso-frase.test.js` | T1 | testes |
| `src/formato.js`, `src/statusline.js`, `test/formato.test.js`, `test/statusline.test.js`, `test/hooks-unidades.test.js` (só o que quebrar) | T2 | barra só da sessão (E6) |
| `src/painel/vsix.js`, `src/painel/instalar-painel.js`, `vscode/package.json`, `vscode/extension.cjs`, `src/comandos.js`, `src/hooks/session-start.js`, `test/painel-vsix.test.js`, `test/painel-instalar.test.js` | T4 | extensão, `.vsix`, instalador, disparo no SessionStart |
| `src/uso/painel.js`, `src/shim.js`, `src/hooks/linha-estado.js`, `test/uso-painel.test.js`, `test/shim.test.js`, `test/hooks-unidades.test.js` | T3 | arquivo de uso, trava, `talvezAtualizar`, `estadoPainel`, shim `painel.mjs`, frase no SessionStart |
| `README.md`, `README.en.md`, `SECURITY.md` | T5 | documentação |

Ordem: **lote A** com T1, T2 e T4 em paralelo; **lote B** com T3, que depende de T1; depois T5 e o teste manual do controlador.

---

### Task 1: leitura oficial e frase de previsão

**Arquivos:** criar `src/uso/oficial.js`, `src/uso/frase.js`, `test/uso-oficial.test.js` e `test/uso-frase.test.js`.

**Interfaces produzidas:**

```js
// src/uso/oficial.js
export const PRAZO_USO_MS = 30_000;
export const MAX_SAIDA_BYTES = 64 * 1024;
export function argsUso(): string[]          // argumentos fixos (E3)
export function ambienteUso(env): object     // cópia de env SEM CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (ela congela o /usage no cache)
export function acharClaude({ home, pathEnv, plataforma, existe }): string | null
export function interpretarReset(texto, agoraMs): number | null   // ms epoch
export function interpretarSaida(stdout, agoraMs):
  { ok: true, uso: { sessao: Janela|null, semana: Janela|null, modelos: { fable?: Janela } } }
  | { ok: false, motivo: 'custo' | 'formato' }
  // Janela = { pct: number (0–100), resetsAtMs: number | null }
export function rodarUso({ exe, cwd, env, agoraMs, executar }): Promise<
  { ok: true, uso } | { ok: false, motivo: 'sem-claude'|'tempo'|'saida'|'custo'|'formato'|'erro' }>
// src/uso/frase.js
export const DECORRIDO_MIN_MS = 30 * 60_000;
export function momentoFalado(alvoMs, agoraMs): string | null
export function fraseEsgota({ usado, resetsAtMs, janelaMs, agoraMs }): string | null
```

**Regras de `oficial.js`:**

- `argsUso()` devolve exatamente `['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--no-chrome', '--setting-sources', '', '--settings', '{"disableAllHooks":true}']`. Congelado ou cópia nova a cada chamada.
- `acharClaude`:
  - primeiro `path.join(home, '.local', 'bin', plataforma === 'win32' ? 'claude.exe' : 'claude')`;
  - depois cada diretório absoluto de `pathEnv`, separado por `path.delimiter` (`;` no win32), com `claude.exe` no win32 e `claude` fora dele;
  - `existe(p)` diz se é arquivo regular (o padrão usa `fs.statSync(p).isFile()` em try);
  - devolve o primeiro que existir, senão `null`. No win32 nunca `.cmd`/`.bat`, porque `execFile` não os roda sem shell (E8, S26).
- `interpretarSaida`:
  - `JSON.parse` em try. Objeto com `type === 'result'`, senão `formato`.
  - Se `local_command !== 'usage'`, ou `num_turns !== 0`, ou `total_cost_usd !== 0`, devolve `custo` (E2, trava de custo).
  - `result` tem de ser string de até 16 KiB, senão `formato`.
  - As linhas são casadas por regex ancorada (`^...$`, flag `m`):
    - `^Current session: (\d{1,3}(?:\.\d{1,2})?)% used(?: · (resets .{1,80}))?$` → `sessao`;
    - `^Current week \(all models\): (\d{1,3}(?:\.\d{1,2})?)% used(?: · (resets .{1,80}))?$` → `semana`;
    - `^Current week \(Fable\): (\d{1,3}(?:\.\d{1,2})?)% used(?: · (resets .{1,80}))?$` → `modelos.fable`.
  - `pct` é o número, válido só em [0, 100]; fora disso a janela vira `null`. `resetsAtMs` vem de `interpretarReset`.
  - Nenhuma das três casou: `formato`. Pelo menos uma casou: `ok`, e as outras ficam `null` (a de modelo fica ausente).
  - O separador ` · ` é U+00B7. O teste usa a saída real abaixo.
- `interpretarReset(texto, agoraMs)`:
  - casa `^resets (?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?(am|pm)(?: \([^)]{1,64}\))?$`;
  - monta a hora local com `new Date(ano, mes, dia, h24, min)`: 12am é 0, 12pm é 12;
  - sem mês, usa hoje, e se já passou, amanhã;
  - com mês, usa o ano corrente, e se ficou mais de 1 dia no passado, o ano seguinte;
  - hora maior que 12, minuto maior que 59 ou dia inválido (Date normalizou para outro dia) dão `null`;
  - o fuso entre parênteses é ignorado, porque o Claude Code já formata no fuso do sistema.
- `rodarUso`:
  - `exe` ausente dá `sem-claude`;
  - `executar` tem por padrão `(exe, args, opcoes, cb) => execFile(exe, args, opcoes, cb)` de `node:child_process`, com opções `{ cwd, env, timeout: PRAZO_USO_MS, maxBuffer: MAX_SAIDA_BYTES, windowsHide: true, encoding: 'utf8' }`;
  - erro com `killed`/`signal` ou `code === 'ETIMEDOUT'` dá `tempo`, e `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` dá `saida`;
  - saída com código diferente de 0 e stdout vazio dá `erro`;
  - senão, o resultado de `interpretarSaida`. Nunca rejeita.

Saída real para o teste (2.1.285, 29/09/2026, com `\n` reais no `result`):

```json
{"type":"result","subtype":"success","is_error":false,"num_turns":0,"total_cost_usd":0,"local_command":"usage","result":"You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 25% used · resets Sep 29, 5:19pm (America/Sao_Paulo)\nCurrent week (all models): 41% used · resets Oct 5, 9:59pm (America/Sao_Paulo)\nCurrent week (Fable): 57% used · resets Oct 5, 9:59pm (America/Sao_Paulo)\n\nWhat's contributing to your limits usage?\nLast 24h · 5578 requests · 6 sessions"}
```

**Regras de `frase.js` (E5):**

- `momentoFalado(alvoMs, agoraMs)`:
  - se `alvoMs − agoraMs < 6 h`: `por volta das HH:MM` (hora local, 2 dígitos);
  - senão, o período da hora local do alvo: 0–5 `de madrugada`, 6–11 `de manhã`, 12–17 `à tarde`, 18–23 `à noite`;
  - dia de calendário local: mesmo dia `hoje <período>`, dia seguinte `amanhã <período>`, de 2 a 6 dias `<dia> <período>`, com os dias `domingo, segunda, terça, quarta, quinta, sexta, sábado`;
  - mais longe, `em dd/mm`;
  - entrada não finita ou alvo no passado: `null`.
- `fraseEsgota`:
  - valida tudo finito, `usado` em (0, 100], `janelaMs > 0` e `resetsAtMs > agoraMs`;
  - `decorrido = janelaMs − (resetsAtMs − agoraMs)`; abaixo de `DECORRIDO_MIN_MS` → `null`;
  - `usado >= 100` → `Limite atingido; reinicia <sufixo>.`;
  - `ritmo = usado / decorrido` (por ms) e `esgotaMs = agoraMs + (100 − usado) / ritmo`;
  - se `esgotaMs < resetsAtMs`: `Nesse ritmo, esgota <momentoFalado(esgotaMs)>, antes do reinício <sufixo>.`;
  - senão: `Nesse ritmo, não esgota antes do reinício <sufixo>.`;
  - `<sufixo>` é `das HH:MM` quando o reinício cai no mesmo dia local de agora e `de dd/mm às HH:MM` quando não cai;
  - nunca lança (try → `null`).

**Testes obrigatórios:**

- `interpretarSaida` com a saída real dá `sessao.pct` 25, `semana.pct` 41 e `modelos.fable.pct` 57. Os `resetsAtMs` batem com `new Date(2026, 8, 29, 17, 19)` e `new Date(2026, 9, 5, 21, 59)`, com `agoraMs = new Date(2026, 8, 29, 17, 4)`.
- `num_turns: 1`, `total_cost_usd: 0.01` e `local_command: "compact"` dão, cada um, `{ ok: false, motivo: 'custo' }`.
- JSON inválido, `result` sem nenhuma linha, `result` de 20 KiB e `pct` 101 dão `formato`, ou janela `null` quando outra linha casou.
- Só a linha do Fable, sem as outras duas, dá `ok` com `sessao` e `semana` `null`.
- `interpretarReset`: `resets 5:19pm` depois das 17:19 cai amanhã; `resets 12am` dá meia-noite; `resets Feb 30, 1pm` dá `null`; `resets Jan 2, 1pm` visto em 30/12 cai no ano seguinte; `resets 13pm` dá `null`.
- `acharClaude` com `existe` falso, com `.cmd` no PATH no win32 (ignorado) e com `~/.local/bin` antes do PATH.
- `rodarUso` com `executar` falso: timeout dá `tempo`, maxBuffer dá `saida`, sucesso repassa o resultado e um `executar` que lança dá `erro`.
- `fraseEsgota` com o caso E1 (41%, reinício 05/10 22:00, agora 29/09 17:04, janela 7 d) dá `Nesse ritmo, esgota amanhã à noite, antes do reinício de 05/10 às 22:00.`
- `fraseEsgota` com 25% na janela de 5 h, faltando 16 min, dá "não esgota ... das 17:20".
- `fraseEsgota` com decorrido de 10 min dá `null`.
- `momentoFalado` cobre as bordas 5:59 e 6:00, 11:59 e 12:00, 17:59 e 18:00, e o caso dos 6 dias.

Os testes fixam as datas com `new Date(ano, mes, ...)` locais, para passar em qualquer fuso.

- [ ] Escrever os testes e ver falhar: `node --test test/uso-oficial.test.js test/uso-frase.test.js`.
- [ ] Implementar e ver passar. Rodar `node --test` completo.
- [ ] Relatar (sem commit).

---

### Task 2: a barra do terminal fica só com a sessão (E6)

**Arquivos:**
- modificar `src/formato.js`, `src/statusline.js`, `test/formato.test.js` e `test/statusline.test.js`;
- ajustar as asserções da barra em `test/hooks-unidades.test.js`, se houver;
- ajustar `bench/`, se algum cenário conferir o texto da barra.

**Interface:** `formatarBarra({ entrada, cor })` devolve `modelo·effort │ ctx … │ cache …`. As opções `limites`, `agoraMs`, `previsao` e `sessoesAtivas` passam a ser ignoradas: continuam aceitas e sem efeito, para não quebrar quem chama. Também `export const PARTES_BARRA = Object.freeze(['modelo', 'ctx', 'cache'])`, para documentar.

**Mudanças:**
- **`formato.js`:**
  - sai o bloco de 5h/7d, a previsão e "N sessões";
  - saem os imports que ficarem sem uso (`faixa5h`, `faixa7d`, `MAX_SESSOES_ATIVAS`, `horaLocal`, `diaHora`, `janelaValida`), assim como as constantes e funções sem uso (`COR_5H`, `COR_7D`, `ROTULO_7D`, `estouro`), para não sobrar código morto;
  - o comentário do topo passa a citar a E6.
- **`statusline.js`:**
  - segue chamando `atualizarEstado` (grava `rate_limits` e histórico, a fonte exata e gratuita do 5h/7d);
  - deixa de importar `previsao.js` e de calcular `limitesValidos`, `preverEstouro` e `sessoesAtivas`, o que economiza CPU a cada redesenho;
  - chama `formatarBarra({ entrada, cor })`.
- **Testes:** substituir as asserções de 5h/7d/sessões/previsão da barra por:
  - (a) a linha completa `Opus 5.5·high │ ctx ▰▰▱▱▱▱▱▱ 31% │ cache ▰▰▰▰▰▰▰▱ 97%`;
  - (b) com `limites` e `sessoesAtivas: 3` passados, a saída não contém `5h`, `7d`, `sessões` nem `→100%`;
  - (c) os testes de cor de ctx/cache seguem iguais;
  - (d) o teste da statusline confere que `estado.json` continua recebendo `five_hour`/`seven_day` depois de uma execução.
- Os testes que existiam só para 5h/7d na barra saem. Os de `alerta.js`/`previsao.js` ficam, porque esses módulos continuam em uso.

- [ ] Ajustar os testes, ver falhar, implementar, ver passar e rodar `node --test`.
- [ ] Relatar (sem commit).

---

### Task 3: `src/uso/painel.js`, shim `painel.mjs` e frase no SessionStart

**Depende de:** T1 (`src/uso/oficial.js` e `src/uso/frase.js` já existem com as interfaces da T1).

**Arquivos:**
- criar `src/uso/painel.js` e `test/uso-painel.test.js`;
- modificar `src/shim.js`, `test/shim.test.js`, `src/hooks/linha-estado.js` e os testes dela (em `test/hooks-unidades.test.js`).

**Interfaces produzidas:**

```js
export const ARQ_USO = 'uso-oficial.json';
export const ARQ_TRAVA = 'uso-oficial.lock';
export const DIR_CWD = 'uso-cwd';
export const INTERVALO_MS = 30_000;
export const TRAVA_VENCIDA_MS = 90_000;
export const RAM_MIN_BYTES = 1.5 * 1024 ** 3;
export const BLOQUEIO_CUSTO_MS = 24 * 3_600_000;
export function lerUso(dir, agoraMs): UsoGravado | null
export function talvezAtualizar(opcoes?): Promise<{ feito: boolean, motivo: string }>
export function estadoPainel(opcoes?): { texto: string, nivel: 'ok'|'aviso'|'erro'|'sem-leitura', dica: string }
```

**`uso-oficial.json` (E4, E8/S28):**

```json
{ "versao": 1, "lidoEm": "<ISO>", "sessao": {"pct": 25, "resetsAtMs": 1790713140000}, "semana": {...}, "modelos": {"fable": {...}},
  "estado": { "motivo": "ok" | "tempo" | "saida" | "formato" | "erro" | "sem-claude", "em": "<ISO>" },
  "bloqueado": { "motivo": "custo", "ate": "<ISO>" } }
```

- `lerUso` valida o arquivo com `lerJson(arquivo, 16 * 1024)`: `versao === 1`; `lidoEm` legível por `instante`; cada janela `{ pct: numeroFinito em [0, 100], resetsAtMs: numeroFinito ou null }`, senão `null`; `modelos` só com a chave `fable`; `bloqueado.ate` legível.
- **Erro de leitura.** A gravação preserva as últimas janelas boas e atualiza só `estado`.
- **Sucesso.** Troca as janelas, `lidoEm` e `estado.motivo = 'ok'`.
- **Custo.** Grava `bloqueado` com `ate = agora + BLOQUEIO_CUSTO_MS`.
- Grava com `gravarJsonAtomico`.

**`talvezAtualizar({ dir = dirDados(), agoraMs = Date.now(), forcar = false, rodar = rodarUso, memLivre = os.freemem, achar = acharClaude, estadoAtivo })` segue esta ordem (E3):**

1. `dir === null` dá `{ feito: false, motivo: 'sem-pasta' }`.
2. Com `bloqueado.ate > agora`, `'bloqueado'`, mesmo com `forcar`.
3. Sem `forcar`, com `lidoEm` ou `estado.em` a menos de `INTERVALO_MS − 5_000`, `'recente'`. Com `forcar`, o piso é 5 s.
4. Sem `forcar`, sem sessão ativa, `'sem-sessao'`. `estadoAtivo` tem por padrão `() => sessoesAtivas(validarEstado(lerJson(estado.json).valor), agoraMs) > 0`; os imports vêm de `estado.js`.
5. `memLivre() < RAM_MIN_BYTES` dá `'pouca-ram'`, mesmo com `forcar` (Foco 4).
6. **Trava.** `fs.openSync(<dir>/uso-oficial.lock, 'wx')`, gravando `pid` e `agoraMs`. Com `EEXIST`, se o `mtime` da trava tiver mais de `TRAVA_VENCIDA_MS`, apaga e tenta uma vez de novo; senão devolve `'travado'`.
7. `mkdir <dir>/uso-cwd` (recursive), `exe = achar({ home: os.homedir(), pathEnv: process.env.PATH, plataforma: process.platform, existe })` e `r = await rodar({ exe, cwd, env: ambienteUso(process.env), agoraMs })`.
8. Grava conforme `r` e devolve `{ feito: true, motivo: r.ok ? 'ok' : r.motivo }`.
9. `finally`: apaga a trava. Nunca rejeita.

**`estadoPainel({ dir = dirDados(), agoraMs = Date.now(), ultimoMotivo })`:**
- **Juntar as fontes (E4).**
  - Estado: `lerJson(estado.json)` → `validarEstado` → `limitesValidos`. A leitura da statusline de cada janela vale com o instante `estado[k].at`, ou `estado.at`.
  - Uso: `lerUso`.
  - 5h e semana: vale o `pct` da fonte mais nova. O reinício vem da statusline (`resets_at * 1000`) quando existe, senão do uso.
  - Fable: só do uso.
- **`texto`:** `5h 25% · sem 41% · Fable 57%`, com `—` para janela sem leitura. Os percentuais são o piso inteiro.
- **`nivel`:** pelo maior percentual: 90 ou mais `erro`, 75 ou mais `aviso`, abaixo disso `ok`. Sem nenhuma janela, `sem-leitura` e texto `Hadouken: sem leitura`.
- **`dica`:** Markdown só com rótulos fixos e números. Uma linha por janela:
  - `**Sessão (5h):** 25% · reinicia 17:20` e, se houver, ` · ` mais a `fraseEsgota` com `janelaMs` de 5 h;
  - `**Semana (todos os modelos):** …`, com janela de 7 d;
  - `**Semana (Fable):** …`, com janela de 7 d.
  - Depois, `Sessões ativas: N` e `Leitura oficial: há N s` (ou `há N min`, ou `sem leitura oficial ainda`).
  - Com `ultimoMotivo` ou o `estado.motivo` gravado diferente de `ok`/`recente`/`sem-sessao`, uma linha fixa por motivo: `pouca-ram` → `Leitura pausada: pouca RAM livre.`, `bloqueado` → `Leitura bloqueada por 24 h: o /usage passou a ter custo.`, `sem-claude` → `claude não encontrado em ~/.local/bin nem no PATH.`, `travado` → não mostra nada, e os outros → `Última leitura falhou (<motivo fixo>).`
  - Termina com `Fonte: statusline do Claude Code e claude /usage, sem tokens.`
- Nunca lança: em erro, `{ texto: 'Hadouken: sem leitura', nivel: 'sem-leitura', dica: '' }`.

**Shim (E4):**
- Em `src/shim.js`, acrescentar `'painel.mjs': { alvo: 'uso/painel.js', modelo: (url) => \`export * from ${url};\n\` }`.
- Conferir que a resolução do alvo aceita subpasta. Se o código montar o caminho com `path.join(raiz, 'src', alvo)`, já funciona; se validar o nome, ajustar só o necessário.
- `NOME_TMP` passa a aceitar `painel`: `/^\.(?:statusline|cli|painel)\.mjs\.[0-9a-f]{12}\.tmp$/`, também no teste.
- Atualizar os testes que listam os shims (`['statusline.mjs', 'cli.mjs']` → incluir `'painel.mjs'`).
- Novo teste: o shim `painel.mjs` importado com `HADOUKEN_HOME` temporário exporta `estadoPainel`.

**`linha-estado.js` (E5):**
- `linhaEstado(limites, agoraMs)` passa a produzir `Consumo: 5h 25% (reset 17:20) · 7d 41% (reset seg 22:00); nesse ritmo, esgota amanhã à noite.`
- A frase vem de `fraseEsgota` da janela de 7 d: sem o `Nesse ritmo, ` inicial e o ponto final, com a primeira letra minúscula.
- Sem frase, a linha termina depois do reset.
- Saem `faixa7d`/`ROTULO_7D` desta linha, e os imports ficam limpos.
- Os testes da linha são atualizados. `LINHA_SEM_LEITURA` continua.

- [ ] Testes primeiro (`test/uso-painel.test.js` com pasta temporária, `rodar`, `memLivre` e `estadoAtivo` falsos), cobrindo cada motivo da ordem acima, trava vencida contra trava viva, preservação das janelas no erro, bloqueio por custo e a mescla das fontes, em que a statusline mais nova vence.
- [ ] Implementar, passar e rodar `node --test`.
- [ ] Relatar (sem commit).

---

### Task 4: extensão, `.vsix`, instalador e disparo no SessionStart

**Arquivos:**
- criar `vscode/package.json`, `vscode/extension.cjs`, `src/painel/vsix.js`, `src/painel/instalar-painel.js`, `test/painel-vsix.test.js` e `test/painel-instalar.test.js`;
- modificar `src/comandos.js` (subcomando `painel`), `src/hooks/session-start.js` e os testes do CLI e dos hooks que listam subcomandos, se houver.

**Consome (da T3, por nome, sem import nos testes):** a extensão chama `estadoPainel({})`, `talvezAtualizar({})` e `talvezAtualizar({ forcar: true })` do módulo carregado de `<dirDados>/bin/painel.mjs`.

**`vscode/package.json`:**

```json
{
  "name": "claude-hadouken-painel",
  "displayName": "Claude Hadouken: painel de uso",
  "description": "5h, semana e Fable do plano Claude na barra de status, sem gastar tokens.",
  "publisher": "gariolilabs",
  "version": "0.0.0",
  "license": "MIT",
  "engines": { "vscode": "^1.90.0" },
  "main": "./extension.cjs",
  "activationEvents": ["onStartupFinished"],
  "contributes": { "commands": [{ "command": "claudeHadouken.atualizarUso", "title": "Claude Hadouken: atualizar uso agora" }] }
}
```

A `version` é trocada pela do plugin (`.claude-plugin/plugin.json`) na montagem.

**`vscode/extension.cjs` (CommonJS, sem dependências):**
- `dirDados()` com a mesma regra de `base.js`: `HADOUKEN_HOME` definida só vale se `path.isAbsolute` (e, no win32, com letra de unidade ou UNC); definida e inválida dá `null`; sem ela, `~/.claude/hadouken`.
- `carregar()` faz `import(pathToFileURL(<dir>/bin/painel.mjs).href + '?t=' + Date.now())` só quando o módulo ainda não carregou. Se falhar, guarda o instante e tenta de novo só depois de 60 s.
- `activate(ctx)`:
  - `item = vscode.window.createStatusBarItem('claudeHadouken.uso', vscode.StatusBarAlignment.Right, 100)`, com `name`, `command = 'claudeHadouken.atualizarUso'` e `show()`;
  - um `setInterval` de 5 s atualiza o item com `estadoPainel`:
    - `text = '$(pulse) ' + texto`;
    - `backgroundColor` com `new vscode.ThemeColor('statusBarItem.warningBackground' | 'statusBarItem.errorBackground')` ou `undefined`;
    - `tooltip = new vscode.MarkdownString(dica)`;
  - sem módulo, mostra `$(pulse) Hadouken: abra uma sessão do Claude Code`;
  - em seguida, se não houver leitura em curso, chama `talvezAtualizar({})` sem `await` bloqueante e guarda o `motivo` em `ultimoMotivo`, que vai para o `estadoPainel` seguinte;
  - o comando registrado chama `talvezAtualizar({ forcar: true })` e atualiza o item;
  - tudo vai para `ctx.subscriptions`, e o intervalo é limpo no `dispose`;
  - todo callback fica em try/catch, e a extensão nunca lança.
- `deactivate()` limpa o intervalo.

**`src/painel/vsix.js`:**
- `export function montarZip(entradas: { nome: string, dados: Buffer }[]): Buffer`:
  - zip com `deflateRawSync` e `zlib.crc32`;
  - método 8, ou 0 quando o deflate não reduz;
  - data DOS fixa 1980-01-01 00:00, para a montagem ser determinística;
  - nomes ASCII com `/`, sem `..`;
  - EOCD simples, sem zip64 (teto de 4 MiB no total, senão `null`).
- `export function montarVsix({ versao, packageJson: string, extensionCjs: string }): Buffer | null`:
  - `[Content_Types].xml` com Default para `.json`, `.cjs`, `.vsixmanifest` e `.xml`;
  - `extension.vsixmanifest` com `Identity Id="claude-hadouken-painel" Publisher="gariolilabs" Version="<versao>"`, `InstallationTarget Id="Microsoft.VisualStudio.Code"`, `Property Microsoft.VisualStudio.Code.Engine ^1.90.0` e `Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"`;
  - `extension/package.json` com a versão trocada e `extension/extension.cjs`;
  - `versao` validada por `^\d+\.\d+\.\d+$`.
- Teste: o zip montado passa por um leitor mínimo no teste, que percorre o diretório central, confere CRC e descomprime com `inflateRawSync`. As quatro entradas aparecem, e o XML tem a versão.
- Se `tar` estiver disponível, `tar -tf` (bsdtar lê zip) lista as entradas. Esse teste pula se `tar` falhar.

**`src/painel/instalar-painel.js`:**
- `export function acharCode({ pathEnv, plataforma, existe })` procura `code.cmd` (win32) ou `code` nos diretórios absolutos do PATH e devolve o caminho ou `null`.
- `export function caminhoSeguro(p)` valida pela mesma regra de caracteres de `configuracao.js` (§ caminho-inseguro: A–Z, a–z, U+00C0–U+024F exceto × ÷, dígitos, espaço e `/ : . _ - ( ) + , @ ~`, mais `\` no win32).
  - Se `configuracao.js` já exporta o teste, importe; se não exporta, exporte de lá sem mudar o comportamento.
- `export function precisaInstalar({ dir, versao, agoraMs })` dá `true` quando `<dir>/painel/instalado.json` não tem essa `versao` e não houve tentativa (`<dir>/painel/tentativa.json`) há menos de 1 h.
- `export async function instalarPainel({ dir, raizPlugin, agoraMs, achar = acharCode, executar })`:
  1. grava `tentativa.json`;
  2. lê `versao` de `<raizPlugin>/.claude-plugin/plugin.json` e os dois arquivos de `<raizPlugin>/vscode/`;
  3. `montarVsix` e grava em `<dir>/painel/claude-hadouken-painel-<versao>.vsix`, com escrita atômica em Buffer;
  4. `code = achar(...)`: sem `code`, `sem-vscode`; `code` ou `vsix` fora de `caminhoSeguro`, `caminho-inseguro`;
  5. win32: `execFile('cmd.exe', ['/d', '/s', '/c', \`""${code}" --install-extension "${vsix}" --force"\`], { windowsVerbatimArguments: true, windowsHide: true, timeout: 120_000 })`; POSIX: `execFile(code, ['--install-extension', vsix, '--force'], { timeout: 120_000 })`;
  6. com sucesso, grava `instalado.json { versao, em }`;
  7. devolve `{ ok, motivo }` e nunca rejeita.
- **CLI.** `painel instalar` em `comandos.js`:
  - a raiz do plugin é `process.env.CLAUDE_PLUGIN_ROOT` quando é caminho absoluto, senão a pasta dois níveis acima de `comandos.js`;
  - escreve `{"ok":true}` ou `{"ok":false,"motivo":"..."}` e sai 0/1;
  - `painel` sem subcomando, ou com outro, dá o uso fixo com saída 1.
- **SessionStart.** Depois de `sincronizarShims`, se `process.env.HADOUKEN_SEM_PAINEL !== '1'`, `shims.ok` e `precisaInstalar({ dir, versao, agoraMs })`:
  - `spawn(process.execPath, [<raiz>/src/cli.js, 'painel', 'instalar'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, CLAUDE_PLUGIN_ROOT: raiz } }).unref()` em try/catch;
  - nenhuma linha nova no contexto;
  - a `versao` vem de `plugin.json`, lido com `lerJson`.
- **Testes:**
  - `precisaInstalar` (sem arquivo, mesma versão, tentativa recente);
  - `instalarPainel` com `achar`/`executar` falsos: `sem-vscode`, `caminho-inseguro` com `"` no caminho, sucesso grava `instalado.json`, e a linha de comando win32 montada exatamente como acima (capturada pelo `executar` falso);
  - o SessionStart com `HADOUKEN_SEM_PAINEL=1` não dispara nada. Se testar o disparo exigir hack, basta `precisaInstalar` + revisão.
- A extensão não tem teste automático, porque não há VS Code no CI. O controlador faz o teste manual.

- [ ] Testes primeiro, depois implementar, passar e rodar `node --test`.
- [ ] Relatar (sem commit).

---

### Task 5: documentação e teste manual (controlador)

- **README.md e README.en.md.** Seção "Painel no VS Code":
  - o que mostra e de onde vêm os números (statusline e `claude -p /usage`, sem tokens);
  - o custo de RAM medido (E3), o intervalo de 30 s, as pausas e `HADOUKEN_SEM_PAINEL=1`;
  - como remover (`code --uninstall-extension gariolilabs.claude-hadouken-painel`);
  - a barra do terminal agora só com modelo, effort, ctx e cache.
- **SECURITY.md.** S26 a S28 da emenda E8.
- **Teste manual do controlador:**
  - `node src/cli.js painel instalar` com `CLAUDE_PLUGIN_ROOT` no repo, e a extensão aparece no VS Code;
  - criar só o shim `painel.mjs` na pasta de dados real, apontando para o `src/uso/painel.js` do repo, sem tocar nos outros shims;
  - o item mostra `5h … · sem … · Fable …` igual à aba Uso;
  - medir a RAM de uma leitura pelo painel.
