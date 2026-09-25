# Leitor de consumo (v0.1.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o subprojeto A do `claude-hadouken`: statusline com limites e ritmo, alertas injetados no Claude, `/consumo` com tokens e GitHub, e `/claude-hadouken:instalar`.

**Architecture:** Módulos Node ESM pequenos e sem dependências. Funções puras (`ritmo`, `alerta`, `formato`, `agregacao`) separadas das de I/O (`estado`, `transcripts`, `github`, `configuracao`). A statusline grava `estado.json` em `~/.claude/hadouken/`; os hooks e o `/consumo` só leem esse arquivo. Um hook SessionStart mantém shims estáveis em `~/.claude/hadouken/bin/`, que é o que a statusline e as skills chamam.

**Tech Stack:** Node ≥ 20 (máquina de desenvolvimento: Node 24.18), ESM, `node:test`, `node:assert/strict`, `gh` CLI 2.x, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-leitor-de-consumo-design.md` (aprovada em 2026-09-25). Quem executa lê a spec e este plano.

## Global Constraints

- Zero dependências de runtime e de desenvolvimento; só a biblioteca padrão do Node.
- `"type": "module"`; todo arquivo em `src/` e `test/` é ESM com extensão `.js`.
- Nenhuma função exportada lança exceção para quem chama: erros viram `{ ok: false, motivo }` ou valor neutro documentado. Scripts de hook e statusline sempre terminam com código 0.
- Dado ausente é exibido como `—`, "indisponível: <motivo>" ou "sem leitura", nunca como `0`.
- Diretório de dados: `process.env.HADOUKEN_HOME` se definido (testes), senão `~/.claude/hadouken`.
- Cálculos em UTC/epoch; só a exibição usa o fuso local.
- Fixtures de teste 100 % sintéticas: nada de transcripts reais, caminhos pessoais, e-mails, ids reais.
- Chamadas ao `gh`: endpoints sem barra inicial e `MSYS_NO_PATHCONV=1` no ambiente.
- Commits em inglês, prefixo por área (`core:`, `hooks:`, `report:`, `ci:`, `docs:`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Autor: `267510758+LucasGarioli@users.noreply.github.com` (já configurado no repo).
- Rodar testes com `node --test` na raiz do repo.
- Metas de performance da spec §9: statusline p95 ≤ 150 ms; hook UserPromptSubmit p95 ≤ 100 ms; `/consumo` com índice quente ≤ 2 s e frio ≤ 15 s; GitHub com cache quente e 3 repos ≤ 3 s.

## Verificações já feitas (2026-09-25)

| # | Resultado | Fonte |
|---|---|---|
| V2 | `${CLAUDE_PLUGIN_ROOT}` é exportado para os hooks; existe também `${CLAUDE_PLUGIN_DATA}` (não usado: a statusline roda fora do ambiente do plugin) | code.claude.com/docs/en/plugins/manifest-reference |
| V3 | Uma resposta da API aparece em várias linhas (uma por `apiBlockIndex`) com `usage` idêntico: 93 linhas = 41 `requestId` numa sessão real. Subagentes em `<projeto>/<sessão>/subagents/agent-*.jsonl` com `isSidechain: true` e `agentId`. `effort` no transcript é string (`"high"`). 477 MB de transcripts em 7 dias nesta máquina | Leitura local |
| V4 | Repo público: minutos grátis nos runners padrão. Pesos: Linux 1, Windows 2, macOS 10. Cada job arredondado para cima ao minuto. Cache: 10 GB por repo | docs.github.com/en/billing/concepts/product-billing/github-actions; docs.github.com/en/billing/reference/actions-runner-pricing; docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching |
| V5 | Injeção de contexto: stdout `{"hookSpecificOutput":{"hookEventName":"<Evento>","additionalContext":"<texto>"}}` com código 0. Stdin dos hooks traz `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source` (SessionStart) e `effort: {"level": "..."}`. Timeout padrão 30 s, configurável em segundos. Statusline em `settings.json`: `{"type":"command","command":"...","padding":0}`; stdin traz `model.display_name`, `context_window.used_percentage`, `cost.total_input_tokens`, `cost.total_output_tokens`, `rate_limits.five_hour|seven_day.{used_percentage,resets_at}`, `prompt_cache.hit_ratio` | code.claude.com/docs/en/hooks; code.claude.com/docs/en/statusline |

| V1 | Executada em 2026-09-25 com OK do Sr. Garioli, `settings.json` restaurado. Chegam: `rate_limits.five_hour` e `.seven_day` (`used_percentage`, `resets_at`), `model.display_name`, `effort: {"level": "medium"}`, `context_window.used_percentage`, `prompt_cache.hit_ratio`. **Divergência:** `cost` NÃO traz `total_input_tokens`/`total_output_tokens` (só `total_cost_usd`, durações e linhas); `context_window.total_input_tokens` é o tamanho do contexto atual, não acumulado | Sonda local |

`effort` pode chegar como string ou como `{ "level": "..." }`: todo leitor usa `normalizarEffort` (Task 1).

**Ruling V1 (2026-09-25):** o último segmento da barra passa de `sessão N tok` para `cache NN%` (`prompt_cache.hit_ratio`), e `estado.sessoes[id].tokens` vira `cache_hit`. Tokens por sessão continuam no `/consumo`, vindos dos transcripts. Custo se errado: um segmento da barra a trocar.

## Review Focus

1. **Contagem dobrada de tokens** — o mesmo `requestId` em várias linhas e em várias passagens do índice incremental deve contar uma vez só (Task 8, teste de duplicação e teste de reindexação).
2. **Dado velho exibido como atual** — snapshot com `at` > 1 h ou `resets_at` já passado deve virar "sem leitura" na barra, no hook e no relatório (Tasks 4, 5, 6, 10).
3. **Statusline que quebra a interface** — JSON de entrada inválido, vazio ou sem `rate_limits` deve imprimir uma linha curta e sair com 0 (Task 5, teste com entrada vazia e com lixo).
4. **Instalador que destrói configuração** — `settings.json` com outras chaves, `statusLine` alheia ou JSON inválido não pode ser sobrescrito sem confirmação nem perder conteúdo (Task 11).
5. **Caminhos com espaço e acento no Windows** (`E:\Projetos DEV\...`, `C:\Users\Lucas Garioli\...`) no shim, no instalador e no parser (Tasks 7, 8, 11, teste com diretório temporário contendo espaço e `ç`).

---

## Estrutura de arquivos

```
.claude-plugin/plugin.json          manifesto (name, version 0.1.0, description, author, license)
.claude-plugin/marketplace.json     marketplace de um plugin, source "./"
hooks/hooks.json                    SessionStart, UserPromptSubmit, SessionEnd
skills/consumo/SKILL.md             /claude-hadouken:consumo
skills/instalar/SKILL.md            /claude-hadouken:instalar
src/util.js                         normalizarEffort, lerStdin, horaLocal, diaHora, formatarTokens
src/ritmo.js                        calcularRitmo (puro)
src/alerta.js                       faixa5h, faixa7d, avaliarAlertas (puro)
src/estado.js                       dirDados, lerJson, gravarJsonAtomico, atualizarEstado, limitesValidos
src/formato.js                      formatarBarra (puro)
src/statusline.js                   script da statusline
src/hooks/comum.js                  emitirContexto, rodarHook
src/hooks/session-start.js          sincroniza shims + linha de estado
src/hooks/prompt-submit.js          alertas
src/hooks/session-end.js            historico.jsonl
src/shim.js                         sincronizarShims
src/transcripts.js                  lerTranscript, indexarTranscripts
src/agregacao.js                    agregar (puro)
src/github.js                       coletarGithub, pesoSistema, minutosJob
src/relatorio.js                    montarRelatorio, formatarMarkdown
src/configuracao.js                 planejarStatusline, aplicarStatusline
src/cli.js                          subcomandos consumo | instalar
scripts/bench.js                    medição das metas de performance
test/*.test.js                      um por módulo + ponta a ponta
test/fixtures/                      só dados sintéticos
.github/workflows/ci.yml            Linux, Windows, macOS a cada push
package.json  LICENSE  README.md
```

---

### Task 0: V1 — confirmar que a statusline recebe `rate_limits` nesta conta

Executada pela sessão principal (não por subagente), porque altera `~/.claude/settings.json` do Sr. Garioli. **Exige confirmação explícita dele antes do passo 2.**

**Files:** nenhum no repo; temporário em `~/.claude/hadouken-probe/`.

- [ ] **Step 1: Criar o script de sonda**

`~/.claude/hadouken-probe/probe.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
let dados = '';
process.stdin.on('data', (c) => { dados += c; });
process.stdin.on('end', () => {
  const dir = path.join(os.homedir(), '.claude', 'hadouken-probe');
  fs.writeFileSync(path.join(dir, 'ultima-entrada.json'), dados);
  process.stdout.write('probe');
});
```
Com `~/.claude/hadouken-probe/package.json` = `{"type":"module"}`.

- [ ] **Step 2: Pedir confirmação e instalar a sonda**

Mostrar ao Sr. Garioli a chave que será adicionada e, com o "sim", fazer backup `settings.json.bak-probe` e adicionar:
```json
"statusLine": { "type": "command", "command": "node \"C:/Users/Lucas Garioli/.claude/hadouken-probe/probe.js\"", "padding": 0 }
```

- [ ] **Step 3: Gerar uma resposta e ler a entrada**

Numa sessão qualquer, enviar um prompt; depois:
Run: `node -e "const d=require(require('os').homedir()+'/.claude/hadouken-probe/ultima-entrada.json');console.log(JSON.stringify({rl:d.rate_limits,model:d.model,effort:d.effort,ctx:d.context_window&&d.context_window.used_percentage,cost:d.cost,pc:d.prompt_cache},null,1))"`
Expected: `rl.five_hour.used_percentage`, `rl.five_hour.resets_at`, `rl.seven_day.*` presentes.

- [ ] **Step 4: Restaurar e registrar**

Restaurar `settings.json` a partir do backup, apagar `~/.claude/hadouken-probe/`. Registrar no fim deste plano (seção "Registro de execução") os campos encontrados e a forma de `effort`. Se `rate_limits` não vier: parar e levar ao Sr. Garioli antes da Task 1 (a spec muda).

---

### Task 1: Esqueleto do plugin, CI e utilitários

**Files:**
- Create: `package.json`, `LICENSE`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/workflows/ci.yml`, `.gitignore`, `src/util.js`
- Test: `test/util.test.js`

**Interfaces:**
- Produces: `normalizarEffort(e) → string|null`; `lerStdin() → Promise<string>`; `horaLocal(epochS) → "HH:MM"`; `diaHora(epochS) → "qui 22:00"`; `formatarTokens(n) → "1.2M" | "850k" | "999"`.

- [ ] **Step 1: Arquivos de projeto**

`package.json`:
```json
{
  "name": "claude-hadouken",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test" },
  "license": "MIT"
}
```

`.claude-plugin/plugin.json`:
```json
{
  "name": "claude-hadouken",
  "displayName": "Claude Hadouken",
  "version": "0.1.0",
  "description": "Usage-aware pacing for Claude Code: rate limits, weekly pace, tokens per model and effort, GitHub Actions minutes.",
  "author": { "name": "Lucas Garioli", "url": "https://github.com/Garioli-Labs" },
  "homepage": "https://github.com/Garioli-Labs/claude-hadouken",
  "license": "MIT"
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "claude-hadouken",
  "owner": { "name": "Garioli Labs" },
  "plugins": [
    { "name": "claude-hadouken", "source": "./", "description": "Usage-aware pacing for Claude Code.", "version": "0.1.0" }
  ]
}
```

`LICENSE`: texto MIT padrão, `Copyright (c) 2026 Lucas Garioli`.

`.gitignore`:
```
node_modules/
*.log
.hadouken-tmp/
```

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node --test
```

- [ ] **Step 2: Escrever o teste que falha**

`test/util.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEffort, horaLocal, diaHora, formatarTokens } from '../src/util.js';

test('normalizarEffort aceita string, objeto e ausência', () => {
  assert.equal(normalizarEffort('high'), 'high');
  assert.equal(normalizarEffort({ level: 'xhigh' }), 'xhigh');
  assert.equal(normalizarEffort(undefined), null);
  assert.equal(normalizarEffort({}), null);
  assert.equal(normalizarEffort(42), null);
});

test('horaLocal e diaHora usam o fuso local', () => {
  const d = new Date(2026, 8, 24, 22, 5); // quinta, 22:05 local
  const s = Math.floor(d.getTime() / 1000);
  assert.equal(horaLocal(s), '22:05');
  assert.equal(diaHora(s), 'qui 22:05');
});

test('formatarTokens', () => {
  assert.equal(formatarTokens(999), '999');
  assert.equal(formatarTokens(850_000), '850k');
  assert.equal(formatarTokens(1_234_567), '1.2M');
  assert.equal(formatarTokens(null), '—');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/util.test.js`
Expected: FAIL com `Cannot find module '../src/util.js'`.

- [ ] **Step 4: Implementar**

`src/util.js`:
```js
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const doisDigitos = (n) => String(n).padStart(2, '0');

export function normalizarEffort(e) {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e && typeof e === 'object' && typeof e.level === 'string') return e.level;
  return null;
}

export function lerStdin() {
  return new Promise((resolve) => {
    let dados = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { dados += c; });
    process.stdin.on('end', () => resolve(dados));
    process.stdin.on('error', () => resolve(dados));
  });
}

export function horaLocal(epochS) {
  const d = new Date(epochS * 1000);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function diaHora(epochS) {
  const d = new Date(epochS * 1000);
  return `${DIAS[d.getDay()]} ${horaLocal(epochS)}`;
}

export function formatarTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: PASS, 3 testes.

- [ ] **Step 6: Commit**

```bash
git add package.json LICENSE .gitignore .claude-plugin .github src/util.js test/util.test.js
git commit -m "core: plugin skeleton, CI matrix and shared utils"
```

---

### Task 2: `ritmo` — ritmo linear semanal

**Files:**
- Create: `src/ritmo.js`
- Test: `test/ritmo.test.js`

**Interfaces:**
- Produces: `calcularRitmo({ usado7d: number, resetsAt7d: number /*epoch s*/, agoraMs: number }) → { esperado: number, desvio: number, modo: 'economico'|'normal'|'folga' }`

- [ ] **Step 1: Teste que falha**

`test/ritmo.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRitmo } from '../src/ritmo.js';

const H = 3600_000;
const reset = 1_800_000_000; // epoch s
const inicioMs = reset * 1000 - 168 * H;

const casos = [
  { nome: 'início da janela', usado: 0, agora: inicioMs, esperado: 0, desvio: 0, modo: 'normal' },
  { nome: 'meio da janela no ritmo', usado: 50, agora: inicioMs + 84 * H, esperado: 50, desvio: 0, modo: 'normal' },
  { nome: 'exatamente +10 é normal', usado: 60, agora: inicioMs + 84 * H, esperado: 50, desvio: 10, modo: 'normal' },
  { nome: '+10.1 é econômico', usado: 60.1, agora: inicioMs + 84 * H, esperado: 50, desvio: 10.1, modo: 'economico' },
  { nome: 'exatamente -10 é normal', usado: 40, agora: inicioMs + 84 * H, esperado: 50, desvio: -10, modo: 'normal' },
  { nome: '-10.5 é folga', usado: 39.5, agora: inicioMs + 84 * H, esperado: 50, desvio: -10.5, modo: 'folga' },
  { nome: 'relógio antes da janela: clamp 0', usado: 5, agora: inicioMs - 5 * H, esperado: 0, desvio: 5, modo: 'normal' },
  { nome: 'depois do reset: clamp 100', usado: 80, agora: reset * 1000 + H, esperado: 100, desvio: -20, modo: 'folga' },
];

for (const c of casos) {
  test(`calcularRitmo: ${c.nome}`, () => {
    assert.deepEqual(
      calcularRitmo({ usado7d: c.usado, resetsAt7d: reset, agoraMs: c.agora }),
      { esperado: c.esperado, desvio: c.desvio, modo: c.modo },
    );
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ritmo.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/ritmo.js`:
```js
const HORA_MS = 3600_000;
const JANELA_H = 168;
const LIMIAR_PONTOS = 10;

const arred = (x) => Math.round(x * 10) / 10;

export function calcularRitmo({ usado7d, resetsAt7d, agoraMs }) {
  const inicioMs = resetsAt7d * 1000 - JANELA_H * HORA_MS;
  const horas = (agoraMs - inicioMs) / HORA_MS;
  const esperado = arred(Math.min(100, Math.max(0, (horas / JANELA_H) * 100)));
  const desvio = arred(usado7d - esperado);
  let modo = 'normal';
  if (desvio > LIMIAR_PONTOS) modo = 'economico';
  else if (desvio < -LIMIAR_PONTOS) modo = 'folga';
  return { esperado, desvio, modo };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/ritmo.test.js`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/ritmo.js test/ritmo.test.js
git commit -m "core: linear weekly pace and mode"
```

---

### Task 3: `alerta` — faixas e linhas para o Claude

**Files:**
- Create: `src/alerta.js`
- Test: `test/alerta.test.js`

**Interfaces:**
- Consumes: `calcularRitmo` (Task 2); `horaLocal`, `diaHora` (Task 1).
- Produces:
  - `faixa5h(pct: number) → 'ok'|'atencao'|'serializar'|'fechar'`
  - `faixa7d({ usado, resetsAt, agoraMs }) → { faixa: 'economico'|'normal'|'folga'|'so-leitura', esperado, desvio }`
  - `avaliarAlertas({ limites: { five_hour?, seven_day? } | null, anteriores: Alertas, sessionId: string, agoraMs: number }) → { linhas: string[], novos: Alertas }`
  - Tipo `Alertas = { five_hour: { resets_at, faixa } | null, seven_day: { resets_at, faixa } | null, sem_leitura: { [sessionId]: true } }`
  - `ALERTAS_VAZIO` (objeto com os três campos vazios).

- [ ] **Step 1: Teste que falha**

`test/alerta.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faixa5h, faixa7d, avaliarAlertas, ALERTAS_VAZIO } from '../src/alerta.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const inicio7 = reset7 * 1000 - 168 * H;
const agora = inicio7 + 84 * H; // esperado 50%
const reset5 = Math.floor(agora / 1000) + 2 * 3600;

test('faixa5h nos limiares', () => {
  assert.equal(faixa5h(69.9), 'ok');
  assert.equal(faixa5h(70), 'atencao');
  assert.equal(faixa5h(80), 'serializar');
  assert.equal(faixa5h(90), 'fechar');
  assert.equal(faixa5h(100), 'fechar');
});

test('faixa7d: só leitura vence o modo quando ≥90% e reset a mais de 24 h', () => {
  assert.equal(faixa7d({ usado: 90, resetsAt: reset7, agoraMs: agora }).faixa, 'so-leitura');
  const perto = reset7 * 1000 - 23 * H;
  assert.equal(faixa7d({ usado: 95, resetsAt: reset7, agoraMs: perto }).faixa, 'normal');
  assert.equal(faixa7d({ usado: 61, resetsAt: reset7, agoraMs: agora }).faixa, 'economico');
  assert.equal(faixa7d({ usado: 30, resetsAt: reset7, agoraMs: agora }).faixa, 'folga');
});

const limites = (p5, p7) => ({
  five_hour: { used_percentage: p5, resets_at: reset5 },
  seven_day: { used_percentage: p7, resets_at: reset7 },
});

test('primeira leitura normal não gera linha', () => {
  const r = avaliarAlertas({ limites: limites(10, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r.linhas, []);
  assert.equal(r.novos.five_hour.faixa, 'ok');
  assert.equal(r.novos.seven_day.faixa, 'normal');
});

test('subida de faixa gera uma linha e não repete', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.equal(r1.linhas.length, 1);
  assert.match(r1.linhas[0], /^5h em 82%: serializar/);
  const r2 = avaliarAlertas({ limites: limites(85, 50), anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r2.linhas, []);
});

test('descida de faixa é anunciada uma vez', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  const r2 = avaliarAlertas({ limites: limites(40, 50), anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.equal(r2.linhas.length, 1);
  assert.match(r2.linhas[0], /^5h voltou a 40%: faixa normal/);
});

test('janela nova zera o estado de alerta', () => {
  const r1 = avaliarAlertas({ limites: limites(82, 50), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  const novaJanela = { ...limites(82, 50), five_hour: { used_percentage: 82, resets_at: reset5 + 5 * 3600 } };
  const r2 = avaliarAlertas({ limites: novaJanela, anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.equal(r2.linhas.length, 1);
});

test('modo econômico e folga geram as linhas da spec', () => {
  const eco = avaliarAlertas({ limites: limites(10, 61), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.match(eco.linhas[0], /^7d 61% vs 50% esperado → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação\.$/);
  const folga = avaliarAlertas({ limites: limites(10, 30), anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.match(folga.linhas[0], /^7d 30% vs 50% esperado → modo folga: investir em qualidade/);
});

test('sem leitura avisa uma vez por sessão', () => {
  const r1 = avaliarAlertas({ limites: null, anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r1.linhas, ['Consumo sem leitura: rode /usage.']);
  const r2 = avaliarAlertas({ limites: null, anteriores: r1.novos, sessionId: 's1', agoraMs: agora });
  assert.deepEqual(r2.linhas, []);
  const r3 = avaliarAlertas({ limites: null, anteriores: r1.novos, sessionId: 's2', agoraMs: agora });
  assert.equal(r3.linhas.length, 1);
});

test('janela individual ausente é ignorada sem erro', () => {
  const r = avaliarAlertas({ limites: { five_hour: { used_percentage: 91, resets_at: reset5 } }, anteriores: ALERTAS_VAZIO, sessionId: 's1', agoraMs: agora });
  assert.equal(r.linhas.length, 1);
  assert.match(r.linhas[0], /^5h em 91%: fechar a tarefa em curso/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/alerta.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/alerta.js`:
```js
import { calcularRitmo } from './ritmo.js';
import { horaLocal, diaHora } from './util.js';

const DIA_MS = 24 * 3600_000;
const ORDEM_5H = ['ok', 'atencao', 'serializar', 'fechar'];

export const ALERTAS_VAZIO = Object.freeze({ five_hour: null, seven_day: null, sem_leitura: {} });

export function faixa5h(pct) {
  if (pct >= 90) return 'fechar';
  if (pct >= 80) return 'serializar';
  if (pct >= 70) return 'atencao';
  return 'ok';
}

export function faixa7d({ usado, resetsAt, agoraMs }) {
  const r = calcularRitmo({ usado7d: usado, resetsAt7d: resetsAt, agoraMs });
  const faixa = usado >= 90 && resetsAt * 1000 - agoraMs > DIA_MS ? 'so-leitura' : r.modo;
  return { faixa, esperado: r.esperado, desvio: r.desvio };
}

const pct = (x) => `${Math.round(x)}%`;

function linha5h(faixa, anterior, usado, resetsAt) {
  const subiu = anterior === null || ORDEM_5H.indexOf(faixa) > ORDEM_5H.indexOf(anterior);
  if (!subiu) return `5h voltou a ${pct(usado)}: faixa ${faixa === 'ok' ? 'normal' : faixa}.`;
  switch (faixa) {
    case 'atencao': return `5h em ${pct(usado)} (reset ${horaLocal(resetsAt)}): atenção ao ritmo.`;
    case 'serializar': return `5h em ${pct(usado)}: serializar — sem Workflow nem subagentes em paralelo.`;
    case 'fechar': return `5h em ${pct(usado)}: fechar a tarefa em curso, não abrir etapa nova, agendar a volta para depois de ${horaLocal(resetsAt)}.`;
    default: return null;
  }
}

function linha7d(faixa, usado, esperado, resetsAt) {
  const base = `7d ${pct(usado)} vs ${pct(esperado)} esperado`;
  switch (faixa) {
    case 'economico': return `${base} → modo econômico: menos volume e paralelismo, sem cortar testes, review nem effort de implementação.`;
    case 'folga': return `${base} → modo folga: investir em qualidade (review extra, effort maior em spec/auditoria), não em volume.`;
    case 'so-leitura': return `7d em ${pct(usado)} com reset em ${diaHora(resetsAt)}: só leitura; recomendar parar.`;
    default: return `${base} → modo normal.`;
  }
}

export function avaliarAlertas({ limites, anteriores, sessionId, agoraMs }) {
  const ant = anteriores ?? ALERTAS_VAZIO;
  const novos = { five_hour: ant.five_hour, seven_day: ant.seven_day, sem_leitura: { ...ant.sem_leitura } };
  const linhas = [];

  if (!limites || (!limites.five_hour && !limites.seven_day)) {
    if (!novos.sem_leitura[sessionId]) {
      linhas.push('Consumo sem leitura: rode /usage.');
      novos.sem_leitura[sessionId] = true;
    }
    return { linhas, novos };
  }
  delete novos.sem_leitura[sessionId];

  const f5 = limites.five_hour;
  if (f5) {
    const faixa = faixa5h(f5.used_percentage);
    const mesmaJanela = ant.five_hour && ant.five_hour.resets_at === f5.resets_at;
    const anterior = mesmaJanela ? ant.five_hour.faixa : null;
    if (anterior !== faixa && !(anterior === null && faixa === 'ok')) {
      const l = linha5h(faixa, anterior, f5.used_percentage, f5.resets_at);
      if (l) linhas.push(l);
    }
    novos.five_hour = { resets_at: f5.resets_at, faixa };
  }

  const f7 = limites.seven_day;
  if (f7) {
    const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
    const mesmaJanela = ant.seven_day && ant.seven_day.resets_at === f7.resets_at;
    const anterior = mesmaJanela ? ant.seven_day.faixa : null;
    if (anterior !== faixa && !(anterior === null && faixa === 'normal')) {
      linhas.push(linha7d(faixa, f7.used_percentage, esperado, f7.resets_at));
    }
    novos.seven_day = { resets_at: f7.resets_at, faixa };
  }
  return { linhas, novos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/alerta.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/alerta.js test/alerta.test.js
git commit -m "core: alert bands with once-per-band announcements"
```

---

### Task 4: `estado` — snapshot atômico e limites válidos

**Files:**
- Create: `src/estado.js`
- Test: `test/estado.test.js`

**Interfaces:**
- Consumes: `normalizarEffort` (Task 1).
- Produces:
  - `dirDados() → string`
  - `lerJson(arquivo) → { ok: true, valor } | { ok: false, motivo: 'ausente'|'invalido' }`
  - `gravarJsonAtomico(arquivo, valor) → { ok: true } | { ok: false, motivo }`
  - `atualizarEstado(entradaStatusline: object, agoraMs: number) → { ok, estado }` (grava `estado.json`)
  - `limitesValidos(estado, agoraMs) → { five_hour?, seven_day? } | null`
  - `LIMITE_VELHO_MS = 3_600_000`, `ARQ_ESTADO = 'estado.json'`

- [ ] **Step 1: Teste que falha**

`test/estado.test.js`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirDados, lerJson, gravarJsonAtomico, atualizarEstado, limitesValidos } from '../src/estado.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadouken ç '));
  process.env.HADOUKEN_HOME = dir;
});

const agora = Date.UTC(2026, 8, 25, 18, 0);
const agoraS = Math.floor(agora / 1000);
const entrada = (extra = {}) => ({
  session_id: 's1', cwd: 'C:/tmp/proj x', model: { display_name: 'Opus 5.5' }, effort: { level: 'high' },
  context_window: { used_percentage: 31 }, prompt_cache: { hit_ratio: 0.975 },
  rate_limits: { five_hour: { used_percentage: 42, resets_at: agoraS + 3600 }, seven_day: { used_percentage: 48, resets_at: agoraS + 86400 } },
  ...extra,
});

test('dirDados respeita HADOUKEN_HOME', () => {
  assert.equal(dirDados(), dir);
});

test('lerJson distingue ausente e inválido', () => {
  assert.deepEqual(lerJson(path.join(dir, 'nao.json')), { ok: false, motivo: 'ausente' });
  fs.writeFileSync(path.join(dir, 'ruim.json'), '{');
  assert.deepEqual(lerJson(path.join(dir, 'ruim.json')), { ok: false, motivo: 'invalido' });
});

test('gravarJsonAtomico grava e sobrescreve', () => {
  const arq = path.join(dir, 'a.json');
  assert.deepEqual(gravarJsonAtomico(arq, { x: 1 }), { ok: true });
  assert.deepEqual(gravarJsonAtomico(arq, { x: 2 }), { ok: true });
  assert.deepEqual(lerJson(arq), { ok: true, valor: { x: 2 } });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), []);
});

test('atualizarEstado grava limites da conta e sessão', () => {
  const r = atualizarEstado(entrada(), agora);
  assert.equal(r.ok, true);
  const e = lerJson(path.join(dir, 'estado.json')).valor;
  assert.equal(e.versao, 1);
  assert.equal(e.five_hour.used_percentage, 42);
  assert.equal(e.sessoes.s1.effort, 'high');
  assert.equal(e.sessoes.s1.cache_hit, 0.975);
});

test('entrada sem rate_limits preserva os limites anteriores', () => {
  atualizarEstado(entrada(), agora);
  atualizarEstado(entrada({ rate_limits: undefined, session_id: 's2' }), agora + 1000);
  const e = lerJson(path.join(dir, 'estado.json')).valor;
  assert.equal(e.five_hour.used_percentage, 42);
  assert.ok(e.sessoes.s2);
});

test('sessões com mais de 24 h são removidas', () => {
  atualizarEstado(entrada(), agora);
  atualizarEstado(entrada({ session_id: 's2' }), agora + 25 * 3600_000);
  const e = lerJson(path.join(dir, 'estado.json')).valor;
  assert.equal(e.sessoes.s1, undefined);
});

test('limitesValidos: velho, reset no passado e versão desconhecida', () => {
  atualizarEstado(entrada(), agora);
  const e = lerJson(path.join(dir, 'estado.json')).valor;
  assert.ok(limitesValidos(e, agora).five_hour);
  assert.equal(limitesValidos(e, agora + 3600_001), null);
  const r = limitesValidos({ ...e, five_hour: { used_percentage: 1, resets_at: agoraS - 1 } }, agora);
  assert.equal(r.five_hour, undefined);
  assert.ok(r.seven_day);
  assert.equal(limitesValidos({ ...e, versao: 99 }, agora), null);
  assert.equal(limitesValidos(null, agora), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/estado.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/estado.js`:
```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizarEffort } from './util.js';

export const LIMITE_VELHO_MS = 3_600_000;
export const ARQ_ESTADO = 'estado.json';
const SESSAO_MAX_MS = 24 * 3_600_000;
const VERSAO = 1;

export function dirDados() {
  return process.env.HADOUKEN_HOME || path.join(os.homedir(), '.claude', 'hadouken');
}

export function lerJson(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return { ok: false, motivo: 'ausente' }; }
  try { return { ok: true, valor: JSON.parse(texto) }; } catch { return { ok: false, motivo: 'invalido' }; }
}

const esperar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function gravarJsonAtomico(arquivo, valor) {
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(valor, null, 2));
    for (let i = 0; i < 3; i++) {
      try { fs.renameSync(tmp, arquivo); return { ok: true }; } catch (e) {
        if (i === 2) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, motivo: e.code || 'rename' }; }
        esperar(20);
      }
    }
  } catch (e) {
    return { ok: false, motivo: e.code || 'escrita' };
  }
  return { ok: false, motivo: 'rename' };
}

const janela = (j) => (j && typeof j.used_percentage === 'number' && typeof j.resets_at === 'number'
  ? { used_percentage: j.used_percentage, resets_at: j.resets_at } : null);

export function atualizarEstado(entrada, agoraMs) {
  const arq = path.join(dirDados(), ARQ_ESTADO);
  const lido = lerJson(arq);
  const ant = lido.ok && lido.valor?.versao === VERSAO ? lido.valor : { versao: VERSAO, sessoes: {} };
  const at = new Date(agoraMs).toISOString();
  const rl = entrada?.rate_limits;
  const estado = { versao: VERSAO, at: ant.at ?? null, five_hour: ant.five_hour ?? null, seven_day: ant.seven_day ?? null, sessoes: {} };
  if (janela(rl?.five_hour) || janela(rl?.seven_day)) {
    estado.at = at;
    estado.five_hour = janela(rl?.five_hour) ?? estado.five_hour;
    estado.seven_day = janela(rl?.seven_day) ?? estado.seven_day;
  }
  for (const [id, s] of Object.entries(ant.sessoes ?? {})) {
    if (agoraMs - Date.parse(s.at) <= SESSAO_MAX_MS) estado.sessoes[id] = s;
  }
  if (entrada?.session_id) {
    const hr = entrada.prompt_cache?.hit_ratio;
    estado.sessoes[entrada.session_id] = {
      at, model: entrada.model?.display_name ?? null, effort: normalizarEffort(entrada.effort),
      cwd: entrada.cwd ?? null, context_pct: entrada.context_window?.used_percentage ?? null,
      cache_hit: typeof hr === 'number' ? hr : null,
    };
  }
  const r = gravarJsonAtomico(arq, estado);
  return { ok: r.ok, estado };
}

export function limitesValidos(estado, agoraMs) {
  if (!estado || estado.versao !== VERSAO || !estado.at) return null;
  if (agoraMs - Date.parse(estado.at) > LIMITE_VELHO_MS) return null;
  const r = {};
  for (const k of ['five_hour', 'seven_day']) {
    const j = estado[k];
    if (j && j.resets_at * 1000 > agoraMs) r[k] = j;
  }
  return Object.keys(r).length ? r : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/estado.test.js`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add src/estado.js test/estado.test.js
git commit -m "core: atomic usage snapshot and freshness rules"
```

---

### Task 5: `formato` + script da statusline

**Files:**
- Create: `src/formato.js`, `src/statusline.js`
- Test: `test/formato.test.js`, `test/statusline.test.js`

**Interfaces:**
- Consumes: `faixa5h`, `faixa7d` (Task 3); `atualizarEstado`, `limitesValidos` (Task 4); `horaLocal`, `diaHora`, `formatarTokens`, `normalizarEffort`, `lerStdin` (Task 1).
- Produces: `formatarBarra({ entrada, limites, agoraMs, cor: boolean }) → string`; executável `node src/statusline.js` (stdin JSON → stdout uma linha, código 0 sempre).

- [ ] **Step 1: Teste que falha (formato)**

`test/formato.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarBarra } from '../src/formato.js';

const H = 3600_000;
const reset7 = 1_800_000_000;
const agora = reset7 * 1000 - 84 * H; // esperado 50%
const agoraS = Math.floor(agora / 1000);
const entrada = { model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, context_window: { used_percentage: 31 }, prompt_cache: { hit_ratio: 0.9749 } };
const limites = { five_hour: { used_percentage: 42, resets_at: agoraS + 3600 }, seven_day: { used_percentage: 61, resets_at: reset7 } };

test('barra completa sem cor', () => {
  const s = formatarBarra({ entrada, limites, agoraMs: agora, cor: false });
  assert.match(s, /^Opus 5\.5·high │ 5h 42% ↻\d\d:\d\d │ 7d 61%\/50% econ ↻\S+ \d\d:\d\d │ ctx 31% │ cache 97%$/);
});

test('sem limites mostra traços', () => {
  const s = formatarBarra({ entrada, limites: null, agoraMs: agora, cor: false });
  assert.match(s, /│ 5h — │ 7d — │/);
});

test('entrada vazia não quebra', () => {
  assert.equal(formatarBarra({ entrada: {}, limites: null, agoraMs: agora, cor: false }), '— │ 5h — │ 7d — │ ctx — │ cache —');
});

test('cor vermelha em 5h ≥ 80', () => {
  const s = formatarBarra({ entrada, limites: { ...limites, five_hour: { used_percentage: 85, resets_at: agoraS + 60 } }, agoraMs: agora, cor: true });
  assert.ok(s.includes('\x1b[31m5h 85%'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/formato.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `formato`**

`src/formato.js`:
```js
import { faixa5h, faixa7d } from './alerta.js';
import { horaLocal, diaHora, normalizarEffort } from './util.js';

const COR = { verde: '\x1b[32m', amarelo: '\x1b[33m', vermelho: '\x1b[31m', fim: '\x1b[0m' };
const COR_5H = { ok: 'verde', atencao: 'amarelo', serializar: 'vermelho', fechar: 'vermelho' };
const COR_7D = { normal: 'verde', folga: 'verde', economico: 'amarelo', 'so-leitura': 'vermelho' };
const ROTULO_7D = { normal: '', folga: ' folga', economico: ' econ', 'so-leitura': ' só leitura' };

const pinta = (texto, cor, ligado) => (ligado ? `${COR[cor]}${texto}${COR.fim}` : texto);
const pct = (x) => `${Math.round(x)}%`;

export function formatarBarra({ entrada, limites, agoraMs, cor }) {
  const nome = entrada?.model?.display_name ?? '—';
  const effort = normalizarEffort(entrada?.effort);
  const partes = [effort ? `${nome}·${effort}` : nome];

  const f5 = limites?.five_hour;
  partes.push(f5 ? pinta(`5h ${pct(f5.used_percentage)} ↻${horaLocal(f5.resets_at)}`, COR_5H[faixa5h(f5.used_percentage)], cor) : '5h —');

  const f7 = limites?.seven_day;
  if (f7) {
    const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
    partes.push(pinta(`7d ${pct(f7.used_percentage)}/${pct(esperado)}${ROTULO_7D[faixa]} ↻${diaHora(f7.resets_at)}`, COR_7D[faixa], cor));
  } else {
    partes.push('7d —');
  }

  const ctx = entrada?.context_window?.used_percentage;
  partes.push(typeof ctx === 'number' ? `ctx ${pct(ctx)}` : 'ctx —');

  // V1 (2026-09-25): a statusline não traz tokens acumulados da sessão; o acerto de cache
  // (prompt_cache.hit_ratio) é o sinal de desperdício disponível ao vivo.
  const hr = entrada?.prompt_cache?.hit_ratio;
  partes.push(typeof hr === 'number' ? `cache ${Math.floor(hr * 100)}%` : 'cache —');

  return partes.join(' │ ');
}
```

- [ ] **Step 4: Teste que falha (script ponta a ponta)**

`test/statusline.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('src/statusline.js');
const rodar = (stdin, home) => spawnSync(process.execPath, [script], { input: stdin, env: { ...process.env, HADOUKEN_HOME: home, NO_COLOR: '1' }, encoding: 'utf8' });

test('entrada válida imprime a barra e grava estado.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk sl '));
  const s = Math.floor(Date.now() / 1000);
  const entrada = { session_id: 's1', model: { display_name: 'Opus 5.5' }, rate_limits: { five_hour: { used_percentage: 10, resets_at: s + 3600 }, seven_day: { used_percentage: 20, resets_at: s + 86400 } } };
  const r = rodar(JSON.stringify(entrada), home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Opus 5\.5 │ 5h 10%/);
  assert.ok(fs.existsSync(path.join(home, 'estado.json')));
});

for (const [nome, stdin] of [['vazia', ''], ['lixo', '{nao é json'], ['array', '[]']]) {
  test(`entrada ${nome} sai com 0 e uma linha curta`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk sl '));
    const r = rodar(stdin, home);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.ok(r.stdout.split('\n').length <= 2);
  });
}
```

- [ ] **Step 5: Implementar o script**

`src/statusline.js`:
```js
import { lerStdin } from './util.js';
import { atualizarEstado, limitesValidos } from './estado.js';
import { formatarBarra } from './formato.js';

async function principal() {
  const texto = await lerStdin();
  let entrada = {};
  try { const v = JSON.parse(texto); if (v && typeof v === 'object' && !Array.isArray(v)) entrada = v; } catch {}
  const agoraMs = Date.now();
  const { estado } = atualizarEstado(entrada, agoraMs);
  const limites = limitesValidos(estado, agoraMs);
  const cor = !process.env.NO_COLOR;
  process.stdout.write(formatarBarra({ entrada, limites, agoraMs, cor }));
}

principal().catch(() => { process.stdout.write(''); }).finally(() => { process.exitCode = 0; });
```

- [ ] **Step 6: Rodar tudo**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add src/formato.js src/statusline.js test/formato.test.js test/statusline.test.js
git commit -m "core: status line rendering and script"
```

---

### Task 6: Shims estáveis

**Files:**
- Create: `src/shim.js`
- Test: `test/shim.test.js`

**Interfaces:**
- Consumes: `dirDados` (Task 4).
- Produces: `sincronizarShims(raizPlugin: string) → { ok: true, alterados: string[] } | { ok: false, motivo }`. Cria `<dirDados>/bin/statusline.mjs` e `<dirDados>/bin/cli.mjs`, cada um com uma linha `await import("<file URL do alvo>");`. Só reescreve se o conteúdo mudou.

- [ ] **Step 1: Teste que falha**

`test/shim.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sincronizarShims } from '../src/shim.js';

test('cria shims apontando para a raiz do plugin e é idempotente', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk shim ç '));
  process.env.HADOUKEN_HOME = home;
  const raiz = path.join(home, 'Plugin Dir');
  const r1 = sincronizarShims(raiz);
  assert.deepEqual(r1, { ok: true, alterados: ['statusline.mjs', 'cli.mjs'] });
  const conteudo = fs.readFileSync(path.join(home, 'bin', 'statusline.mjs'), 'utf8');
  assert.equal(conteudo, `await import(${JSON.stringify(pathToFileURL(path.join(raiz, 'src', 'statusline.js')).href)});\n`);
  assert.deepEqual(sincronizarShims(raiz), { ok: true, alterados: [] });
  assert.deepEqual(sincronizarShims(path.join(home, 'v2')).alterados, ['statusline.mjs', 'cli.mjs']);
});

test('shim executa o alvo de verdade (caminho com espaço)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk shim run '));
  process.env.HADOUKEN_HOME = home;
  sincronizarShims(path.resolve('.'));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(home, 'bin', 'statusline.mjs')], { input: '{}', encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /5h —/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/shim.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/shim.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirDados } from './estado.js';

const ALVOS = { 'statusline.mjs': 'statusline.js', 'cli.mjs': 'cli.js' };

export function sincronizarShims(raizPlugin) {
  try {
    const bin = path.join(dirDados(), 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const alterados = [];
    for (const [shim, alvo] of Object.entries(ALVOS)) {
      const url = pathToFileURL(path.join(raizPlugin, 'src', alvo)).href;
      const conteudo = `await import(${JSON.stringify(url)});\n`;
      const arq = path.join(bin, shim);
      let atual = null;
      try { atual = fs.readFileSync(arq, 'utf8'); } catch {}
      if (atual !== conteudo) { fs.writeFileSync(arq, conteudo); alterados.push(shim); }
    }
    return { ok: true, alterados };
  } catch (e) {
    return { ok: false, motivo: e.code || 'shim' };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/shim.test.js`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add src/shim.js test/shim.test.js
git commit -m "core: stable shims for status line and CLI"
```

---

### Task 7: Hooks

**Files:**
- Create: `src/hooks/comum.js`, `src/hooks/session-start.js`, `src/hooks/prompt-submit.js`, `src/hooks/session-end.js`, `hooks/hooks.json`
- Test: `test/hooks.test.js`

**Interfaces:**
- Consumes: `lerStdin` (Task 1); `faixa7d` (Task 3); `dirDados`, `lerJson`, `gravarJsonAtomico`, `limitesValidos`, `ARQ_ESTADO` (Task 4); `avaliarAlertas`, `ALERTAS_VAZIO` (Task 3); `sincronizarShims` (Task 6).
- Produces:
  - `emitirContexto(evento: string, texto: string) → void` (escreve o JSON de `hookSpecificOutput`)
  - `rodarHook(fn: (entrada) => Promise<void>|void) → void` (lê stdin, captura tudo, sai com 0)
  - `linhaEstado(limites, agoraMs) → string` (exportada de `session-start.js` via `src/hooks/linha-estado.js`)
  - arquivos `alertas.json` e `historico.jsonl` em `dirDados()`.

- [ ] **Step 1: Teste que falha**

`test/hooks.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linhaEstado } from '../src/hooks/linha-estado.js';

const rodar = (script, entrada, home, extraEnv = {}) => spawnSync(process.execPath, [path.resolve('src/hooks', script)], {
  input: JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, HADOUKEN_HOME: home, ...extraEnv },
});
const novoHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hdk hook '));
const gravarEstado = (home, p5, p7) => {
  const s = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(home, 'estado.json'), JSON.stringify({
    versao: 1, at: new Date().toISOString(),
    five_hour: { used_percentage: p5, resets_at: s + 3600 }, seven_day: { used_percentage: p7, resets_at: s + 3 * 86400 }, sessoes: {},
  }));
};

test('linhaEstado resume ou diz sem leitura', () => {
  assert.equal(linhaEstado(null, Date.now()), 'Consumo sem leitura: rode /usage.');
  const s = Math.floor(Date.now() / 1000);
  assert.match(linhaEstado({ five_hour: { used_percentage: 42, resets_at: s + 60 }, seven_day: { used_percentage: 48, resets_at: s + 86400 } }, Date.now()),
    /^Consumo: 5h 42% \(reset \d\d:\d\d\) · 7d 48% vs \d+% esperado, modo \S+; reset \S+ \d\d:\d\d\.$/);
});

test('prompt-submit injeta uma vez ao subir de faixa', () => {
  const home = novoHome();
  gravarEstado(home, 82, 40);
  const r1 = rodar('prompt-submit.js', { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, home);
  assert.equal(r1.status, 0);
  const out = JSON.parse(r1.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /5h em 82%: serializar/);
  const r2 = rodar('prompt-submit.js', { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, home);
  assert.equal(r2.stdout, '');
});

test('prompt-submit sem estado avisa sem leitura', () => {
  const home = novoHome();
  const r = rodar('prompt-submit.js', { session_id: 's1' }, home);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /sem leitura/);
});

test('session-start sincroniza shims e injeta estado', () => {
  const home = novoHome();
  gravarEstado(home, 10, 40);
  const r = rodar('session-start.js', { session_id: 's1', source: 'startup' }, home, { CLAUDE_PLUGIN_ROOT: path.resolve('.') });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(home, 'bin', 'statusline.mjs')));
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^Consumo: 5h 10%/);
});

test('session-end anexa ao histórico', () => {
  const home = novoHome();
  gravarEstado(home, 10, 40);
  rodar('session-end.js', { session_id: 's1', cwd: 'C:/x y', reason: 'exit' }, home);
  rodar('session-end.js', { session_id: 's2', cwd: 'C:/x y', reason: 'exit' }, home);
  const linhas = fs.readFileSync(path.join(home, 'historico.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].five_hour.used_percentage, 10);
});

test('hooks com stdin inválido saem com 0 e sem saída', () => {
  const home = novoHome();
  for (const s of ['prompt-submit.js', 'session-start.js', 'session-end.js']) {
    const r = spawnSync(process.execPath, [path.resolve('src/hooks', s)], { input: 'lixo', encoding: 'utf8', env: { ...process.env, HADOUKEN_HOME: home } });
    assert.equal(r.status, 0, s);
    assert.equal(r.stderr, '', s);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/hooks.test.js`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Implementar**

`src/hooks/comum.js`:
```js
import { lerStdin } from '../util.js';

export function emitirContexto(evento, texto) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: texto } }));
}

export function rodarHook(fn) {
  lerStdin()
    .then((t) => { let e = null; try { e = JSON.parse(t); } catch {} return fn(e && typeof e === 'object' ? e : null); })
    .catch(() => {})
    .finally(() => { process.exitCode = 0; });
}
```

`src/hooks/linha-estado.js`:
```js
import { faixa7d } from '../alerta.js';
import { horaLocal, diaHora } from '../util.js';

const ROTULO = { normal: 'normal', folga: 'folga', economico: 'econômico', 'so-leitura': 'só leitura' };
const pct = (x) => `${Math.round(x)}%`;

export function linhaEstado(limites, agoraMs) {
  if (!limites) return 'Consumo sem leitura: rode /usage.';
  const partes = [];
  const f5 = limites.five_hour;
  if (f5) partes.push(`5h ${pct(f5.used_percentage)} (reset ${horaLocal(f5.resets_at)})`);
  const f7 = limites.seven_day;
  if (f7) {
    const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
    partes.push(`7d ${pct(f7.used_percentage)} vs ${pct(esperado)} esperado, modo ${ROTULO[faixa]}; reset ${diaHora(f7.resets_at)}`);
  }
  return `Consumo: ${partes.join(' · ')}.`;
}
```

`src/hooks/session-start.js`:
```js
import path from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { dirDados, lerJson, limitesValidos, ARQ_ESTADO } from '../estado.js';
import { sincronizarShims } from '../shim.js';
import { linhaEstado } from './linha-estado.js';

rodarHook(() => {
  const raiz = process.env.CLAUDE_PLUGIN_ROOT;
  if (raiz) sincronizarShims(raiz);
  const agoraMs = Date.now();
  const lido = lerJson(path.join(dirDados(), ARQ_ESTADO));
  emitirContexto('SessionStart', linhaEstado(lido.ok ? limitesValidos(lido.valor, agoraMs) : null, agoraMs));
});
```

`src/hooks/prompt-submit.js`:
```js
import path from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { dirDados, lerJson, gravarJsonAtomico, limitesValidos, ARQ_ESTADO } from '../estado.js';
import { avaliarAlertas, ALERTAS_VAZIO } from '../alerta.js';

rodarHook((entrada) => {
  const agoraMs = Date.now();
  const dir = dirDados();
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  const limites = lido.ok ? limitesValidos(lido.valor, agoraMs) : null;
  const arqAlertas = path.join(dir, 'alertas.json');
  const ant = lerJson(arqAlertas);
  const { linhas, novos } = avaliarAlertas({
    limites, anteriores: ant.ok ? ant.valor : ALERTAS_VAZIO, sessionId: entrada?.session_id ?? 'desconhecida', agoraMs,
  });
  gravarJsonAtomico(arqAlertas, novos);
  if (linhas.length) emitirContexto('UserPromptSubmit', linhas.join('\n'));
});
```

`src/hooks/session-end.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { rodarHook } from './comum.js';
import { dirDados, lerJson, ARQ_ESTADO } from '../estado.js';

rodarHook((entrada) => {
  const dir = dirDados();
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  const e = lido.ok ? lido.valor : {};
  const sessao = e.sessoes?.[entrada?.session_id] ?? {};
  const registro = {
    at: new Date().toISOString(), session_id: entrada?.session_id ?? null, cwd: entrada?.cwd ?? null,
    model: sessao.model ?? null, effort: sessao.effort ?? null,
    five_hour: e.five_hour ?? null, seven_day: e.seven_day ?? null, leitura_at: e.at ?? null,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'historico.jsonl'), `${JSON.stringify(registro)}\n`);
});
```

`hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.js\"", "timeout": 5 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/hooks/prompt-submit.js\"", "timeout": 5 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/hooks/session-end.js\"", "timeout": 5 } ] }
    ]
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Validar o manifesto e os hooks**

Run: `claude plugin validate .`
Expected: sem erros. Se o subcomando não existir nesta versão, carregar com `claude --plugin-dir .`, rodar `/hooks` e conferir que os três eventos aparecem; registrar qual caminho foi usado no "Registro de execução". Se o validador rejeitar o envelope `{"hooks": {...}}`, trocar para o formato que ele indicar e registrar.

- [ ] **Step 6: Commit**

```bash
git add src/hooks hooks test/hooks.test.js
git commit -m "hooks: session start context, prompt alerts, session history"
```

---

### Task 8: `transcripts` — parser com deduplicação e índice incremental

**Files:**
- Create: `src/transcripts.js`, `test/fixtures/transcripts/` (gerados pelo teste)
- Test: `test/transcripts.test.js`

**Interfaces:**
- Consumes: `dirDados`, `lerJson`, `gravarJsonAtomico` (Task 4); `normalizarEffort` (Task 1).
- Produces:
  - `lerTranscript(arquivo) → Promise<{ registros: Registro[], linhasInvalidas: number }>`
  - `Registro = { requestId, ts /*ms*/, sessionId, subagente: boolean, projeto, model, effort, input, output, thinking, cacheRead, cacheCreate }`
  - `indexarTranscripts({ raiz: string, desdeMs: number }) → Promise<{ registros: Registro[], linhasInvalidas: number, arquivos: number }>` (usa e atualiza `<dirDados>/indice-transcripts.json`; raiz padrão `~/.claude/projects` passada pelo chamador)

- [ ] **Step 1: Teste que falha**

`test/transcripts.test.js`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerTranscript, indexarTranscripts } from '../src/transcripts.js';

let home, raiz;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk tr '));
  process.env.HADOUKEN_HOME = home;
  raiz = path.join(home, 'projects');
});

const agora = Date.now();
const linha = (req, bloco, extra = {}) => JSON.stringify({
  type: 'assistant', requestId: req, apiBlockIndex: bloco, sessionId: 'sess-1', cwd: 'C:/Projetos DEV/Demo Proj',
  timestamp: new Date(agora - 60_000).toISOString(), effort: 'high', isSidechain: false,
  message: { id: `msg-${req}`, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100, output_tokens_details: { thinking_tokens: 40 }, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } },
  ...extra,
});
const escrever = (rel, linhas) => {
  const arq = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, linhas.join('\n') + '\n');
  return arq;
};

test('deduplica blocos da mesma resposta e conta linhas inválidas', async () => {
  const arq = escrever('proj-a/sess-1.jsonl', [linha('r1', 0), linha('r1', 1), linha('r2', 0), '{"usage": quebrada', JSON.stringify({ type: 'user', message: { content: 'oi' } })]);
  const r = await lerTranscript(arq);
  assert.equal(r.registros.length, 2);
  assert.equal(r.linhasInvalidas, 1);
  const r1 = r.registros.find((x) => x.requestId === 'r1');
  assert.deepEqual(
    { projeto: r1.projeto, model: r1.model, effort: r1.effort, input: r1.input, output: r1.output, thinking: r1.thinking, cacheRead: r1.cacheRead, cacheCreate: r1.cacheCreate, subagente: r1.subagente },
    { projeto: 'Demo Proj', model: 'claude-opus-5', effort: 'high', input: 10, output: 100, thinking: 40, cacheRead: 1000, cacheCreate: 500, subagente: false },
  );
});

test('usa message.id quando falta requestId', async () => {
  const semReq = (b) => { const o = JSON.parse(linha('x', b)); delete o.requestId; return JSON.stringify(o); };
  const arq = escrever('proj-a/s.jsonl', [semReq(0), semReq(1)]);
  assert.equal((await lerTranscript(arq)).registros.length, 1);
});

test('índice inclui subagentes, respeita desdeMs e não duplica na reindexação', async () => {
  escrever('proj-a/sess-1.jsonl', [linha('r1', 0)]);
  escrever('proj-a/sess-1/subagents/agent-a1.jsonl', [linha('r9', 0, { isSidechain: true, agentId: 'a1' })]);
  escrever('proj-a/velha.jsonl', [linha('r5', 0, { timestamp: new Date(agora - 30 * 86400_000).toISOString() })]);
  const desdeMs = agora - 7 * 86400_000;
  const i1 = await indexarTranscripts({ raiz, desdeMs });
  assert.equal(i1.registros.length, 2);
  assert.equal(i1.registros.filter((x) => x.subagente).length, 1);
  const i2 = await indexarTranscripts({ raiz, desdeMs });
  assert.equal(i2.registros.length, 2);
  assert.ok(fs.existsSync(path.join(home, 'indice-transcripts.json')));
});

test('arquivo alterado é relido e arquivo apagado sai do índice', async () => {
  const arq = escrever('proj-a/sess-1.jsonl', [linha('r1', 0)]);
  const desdeMs = agora - 7 * 86400_000;
  await indexarTranscripts({ raiz, desdeMs });
  fs.appendFileSync(arq, linha('r2', 0) + '\n');
  assert.equal((await indexarTranscripts({ raiz, desdeMs })).registros.length, 2);
  fs.unlinkSync(arq);
  assert.equal((await indexarTranscripts({ raiz, desdeMs })).registros.length, 0);
});

test('raiz inexistente devolve vazio', async () => {
  const r = await indexarTranscripts({ raiz: path.join(home, 'nada'), desdeMs: 0 });
  assert.deepEqual(r, { registros: [], linhasInvalidas: 0, arquivos: 0 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/transcripts.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/transcripts.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { dirDados, lerJson, gravarJsonAtomico } from './estado.js';
import { normalizarEffort } from './util.js';

const VERSAO_INDICE = 1;
// cwd pode vir com \ ou / independentemente do sistema que roda o parser.
const nomeProjeto = (cwd, arquivo) => (cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : path.basename(path.dirname(arquivo)));

export async function lerTranscript(arquivo) {
  const vistos = new Map();
  let linhasInvalidas = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(arquivo, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const bruta of rl) {
    // Filtro barato: linhas sem "usage" não são decodificadas (477 MB/semana medidos em 2026-09-25).
    if (!bruta.includes('"usage"')) {
      if (bruta.trim() && !bruta.trimStart().startsWith('{')) linhasInvalidas++;
      continue;
    }
    let d;
    try { d = JSON.parse(bruta); } catch { linhasInvalidas++; continue; }
    const m = d.message;
    const u = m && typeof m === 'object' ? m.usage : null;
    if (!u) continue;
    const chave = d.requestId || m.id;
    if (!chave || vistos.has(chave)) continue;
    vistos.set(chave, {
      requestId: chave,
      ts: Date.parse(d.timestamp) || 0,
      sessionId: d.sessionId ?? null,
      subagente: d.isSidechain === true,
      projeto: nomeProjeto(d.cwd, arquivo),
      model: m.model ?? null,
      effort: normalizarEffort(d.effort),
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      thinking: u.output_tokens_details?.thinking_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreate: u.cache_creation_input_tokens ?? 0,
    });
  }
  return { registros: [...vistos.values()], linhasInvalidas };
}

function listarArquivos(raiz) {
  const saida = [];
  let projetos = [];
  try { projetos = fs.readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return saida; }
  for (const p of projetos) {
    const dirP = path.join(raiz, p.name);
    let itens = [];
    try { itens = fs.readdirSync(dirP, { withFileTypes: true }); } catch { continue; }
    for (const it of itens) {
      if (it.isFile() && it.name.endsWith('.jsonl')) saida.push(path.join(dirP, it.name));
      if (it.isDirectory()) {
        const sub = path.join(dirP, it.name, 'subagents');
        try {
          for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) saida.push(path.join(sub, f));
        } catch {}
      }
    }
  }
  return saida;
}

export async function indexarTranscripts({ raiz, desdeMs }) {
  const arqIndice = path.join(dirDados(), 'indice-transcripts.json');
  const lido = lerJson(arqIndice);
  const antigo = lido.ok && lido.valor?.versao === VERSAO_INDICE ? lido.valor.arquivos : {};
  const novo = {};
  const registros = [];
  let linhasInvalidas = 0;
  const arquivos = listarArquivos(raiz);
  for (const arq of arquivos) {
    let st;
    try { st = fs.statSync(arq); } catch { continue; }
    if (st.mtimeMs < desdeMs) continue;
    const ant = antigo[arq];
    let ent;
    if (ant && ant.size === st.size && ant.mtimeMs === st.mtimeMs) {
      ent = ant;
    } else {
      try {
        const r = await lerTranscript(arq);
        ent = { size: st.size, mtimeMs: st.mtimeMs, registros: r.registros, linhasInvalidas: r.linhasInvalidas };
      } catch { continue; }
    }
    novo[arq] = ent;
    linhasInvalidas += ent.linhasInvalidas;
    for (const r of ent.registros) if (r.ts >= desdeMs) registros.push(r);
  }
  gravarJsonAtomico(arqIndice, { versao: VERSAO_INDICE, arquivos: novo });
  return { registros, linhasInvalidas, arquivos: Object.keys(novo).length };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/transcripts.test.js`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add src/transcripts.js test/transcripts.test.js
git commit -m "report: transcript parser with request dedup and incremental index"
```

---

### Task 9: `agregacao` (pura) e `github`

**Files:**
- Create: `src/agregacao.js`, `src/github.js`
- Test: `test/agregacao.test.js`, `test/github.test.js`

**Interfaces:**
- Consumes: `Registro` (Task 8); `dirDados`, `lerJson`, `gravarJsonAtomico` (Task 4).
- Produces:
  - `agregar(registros: Registro[], desdeMs: number) → { total: Soma, porProjeto: {[p]: Soma}, porModeloEffort: {["model·effort"]: Soma}, principalVsSubagente: { principal: Soma, subagente: Soma } }`
  - `Soma = { respostas, input, output, thinking, cacheRead, cacheCreate, acertoCache: number|null }` com `acertoCache = cacheRead / (input + cacheRead + cacheCreate)` arredondado a 3 casas, `null` se denominador 0.
  - `pesoSistema(sistema: 'linux'|'windows'|'macos') → 1|2|10`
  - `sistemaDoJob(labels: string[]) → 'linux'|'windows'|'macos'|'self-hosted'`
  - `minutosJob({ started_at, completed_at }) → number` (arredonda para cima; 0 se faltar)
  - `coletarGithub({ repos: string[], agoraMs: number, gh?: (args: string[]) => Promise<{ ok, stdout, motivo? }> }) → Promise<{ [repo]: ResumoRepo | { indisponivel: string } }>`
  - `ResumoRepo = { publico: boolean, runs7: { total, porEvento }, runs30: { total, porEvento }, minutos30: { linux, windows, macos, ponderado }, cache: { bytes, limiteBytes: 10737418240 } }`

- [ ] **Step 1: Teste que falha (agregação)**

`test/agregacao.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregar } from '../src/agregacao.js';

const r = (o) => ({ requestId: Math.random().toString(), ts: 1000, sessionId: 's', subagente: false, projeto: 'A', model: 'claude-opus-5', effort: 'high', input: 10, output: 100, thinking: 0, cacheRead: 90, cacheCreate: 0, ...o });

test('agrega por projeto, modelo·effort e principal/subagente, com acerto de cache', () => {
  const a = agregar([r(), r({ projeto: 'B', effort: null }), r({ subagente: true, model: 'claude-haiku-4-5' }), r({ ts: 1 })], 500);
  assert.equal(a.total.respostas, 3);
  assert.equal(a.total.acertoCache, 0.9);
  assert.equal(a.porProjeto.A.respostas, 2);
  assert.equal(a.porModeloEffort['claude-opus-5·—'].respostas, 1);
  assert.equal(a.porModeloEffort['claude-haiku-4-5·high'].respostas, 1);
  assert.equal(a.principalVsSubagente.subagente.respostas, 1);
});

test('sem registros o acerto de cache é null, não zero', () => {
  assert.equal(agregar([], 0).total.acertoCache, null);
});
```

- [ ] **Step 2: Teste que falha (github)**

`test/github.test.js`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pesoSistema, sistemaDoJob, minutosJob, coletarGithub } from '../src/github.js';

beforeEach(() => { process.env.HADOUKEN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk gh ')); });

test('pesos e sistemas', () => {
  assert.equal(pesoSistema('linux'), 1);
  assert.equal(pesoSistema('windows'), 2);
  assert.equal(pesoSistema('macos'), 10);
  assert.equal(sistemaDoJob(['windows-latest']), 'windows');
  assert.equal(sistemaDoJob(['macos-14']), 'macos');
  assert.equal(sistemaDoJob(['ubuntu-latest']), 'linux');
  assert.equal(sistemaDoJob(['self-hosted', 'linux']), 'self-hosted');
});

test('minutosJob arredonda para cima e trata ausência', () => {
  assert.equal(minutosJob({ started_at: '2026-09-25T10:00:00Z', completed_at: '2026-09-25T10:00:13Z' }), 1);
  assert.equal(minutosJob({ started_at: '2026-09-25T10:00:00Z', completed_at: '2026-09-25T10:02:00Z' }), 2);
  assert.equal(minutosJob({ started_at: null, completed_at: null }), 0);
});

const agora = Date.parse('2026-09-25T12:00:00Z');
function ghFalso(chamadas) {
  return async (args) => {
    chamadas.push(args.join(' '));
    const ep = args[1];
    if (ep === 'repos/o/r') return { ok: true, stdout: '"private"' };
    if (ep.startsWith('repos/o/r/actions/runs?')) return { ok: true, stdout: [
      JSON.stringify({ id: 1, event: 'push', status: 'completed', created_at: '2026-09-24T10:00:00Z' }),
      JSON.stringify({ id: 2, event: 'schedule', status: 'completed', created_at: '2026-09-01T10:00:00Z' }),
    ].join('\n') };
    if (ep === 'repos/o/r/actions/runs/1/jobs?per_page=100') return { ok: true, stdout: [
      JSON.stringify({ labels: ['ubuntu-latest'], started_at: '2026-09-24T10:00:00Z', completed_at: '2026-09-24T10:03:10Z' }),
      JSON.stringify({ labels: ['windows-latest'], started_at: '2026-09-24T10:00:00Z', completed_at: '2026-09-24T10:05:00Z' }),
    ].join('\n') };
    if (ep === 'repos/o/r/actions/runs/2/jobs?per_page=100') return { ok: true, stdout: JSON.stringify({ labels: ['macos-14'], started_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T10:00:30Z' }) };
    if (ep === 'repos/o/r/actions/cache/usage') return { ok: true, stdout: '664824301' };
    return { ok: false, motivo: `inesperado ${ep}` };
  };
}

test('coletarGithub resume runs, minutos ponderados e cache, e usa cache de jobs', async () => {
  const chamadas = [];
  const r = await coletarGithub({ repos: ['o/r'], agoraMs: agora, gh: ghFalso(chamadas) });
  assert.deepEqual(r['o/r'].runs7, { total: 1, porEvento: { push: 1 } });
  assert.deepEqual(r['o/r'].runs30, { total: 2, porEvento: { push: 1, schedule: 1 } });
  assert.deepEqual(r['o/r'].minutos30, { linux: 4, windows: 5, macos: 1, ponderado: 4 + 10 + 10 });
  assert.equal(r['o/r'].publico, false);
  assert.equal(r['o/r'].cache.bytes, 664824301);
  const antes = chamadas.filter((c) => c.includes('/jobs')).length;
  await coletarGithub({ repos: ['o/r'], agoraMs: agora, gh: ghFalso(chamadas) });
  assert.equal(chamadas.filter((c) => c.includes('/jobs')).length, antes);
});

test('falha do gh vira indisponível sem derrubar os outros repos', async () => {
  const gh = async (args) => (args[1].startsWith('repos/ruim') ? { ok: false, motivo: 'HTTP 404' } : ghFalso([])(args));
  const r = await coletarGithub({ repos: ['ruim/x', 'o/r'], agoraMs: agora, gh });
  assert.deepEqual(r['ruim/x'], { indisponivel: 'HTTP 404' });
  assert.ok(r['o/r'].runs30);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/agregacao.test.js test/github.test.js`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 4: Implementar**

`src/agregacao.js`:
```js
const vazia = () => ({ respostas: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheCreate: 0, acertoCache: null });

function somar(s, r) {
  s.respostas++; s.input += r.input; s.output += r.output; s.thinking += r.thinking;
  s.cacheRead += r.cacheRead; s.cacheCreate += r.cacheCreate;
}

function fechar(s) {
  const den = s.input + s.cacheRead + s.cacheCreate;
  s.acertoCache = den > 0 ? Math.round((s.cacheRead / den) * 1000) / 1000 : null;
  return s;
}

export function agregar(registros, desdeMs) {
  const total = vazia();
  const porProjeto = {};
  const porModeloEffort = {};
  const principalVsSubagente = { principal: vazia(), subagente: vazia() };
  for (const r of registros) {
    if (r.ts < desdeMs) continue;
    somar(total, r);
    somar((porProjeto[r.projeto] ??= vazia()), r);
    somar((porModeloEffort[`${r.model ?? '—'}·${r.effort ?? '—'}`] ??= vazia()), r);
    somar(principalVsSubagente[r.subagente ? 'subagente' : 'principal'], r);
  }
  fechar(total);
  Object.values(porProjeto).forEach(fechar);
  Object.values(porModeloEffort).forEach(fechar);
  fechar(principalVsSubagente.principal);
  fechar(principalVsSubagente.subagente);
  return { total, porProjeto, porModeloEffort, principalVsSubagente };
}
```

`src/github.js`:
```js
import { execFile } from 'node:child_process';
import path from 'node:path';
import { dirDados, lerJson, gravarJsonAtomico } from './estado.js';

const DIA_MS = 86_400_000;
const PESOS = { linux: 1, windows: 2, macos: 10 };
const LIMITE_CACHE = 10 * 1024 ** 3;

export const pesoSistema = (s) => PESOS[s] ?? 0;

export function sistemaDoJob(labels = []) {
  const l = labels.map((x) => String(x).toLowerCase());
  if (l.includes('self-hosted')) return 'self-hosted';
  if (l.some((x) => x.startsWith('windows'))) return 'windows';
  if (l.some((x) => x.startsWith('macos'))) return 'macos';
  return 'linux';
}

export function minutosJob({ started_at, completed_at }) {
  const ms = Date.parse(completed_at) - Date.parse(started_at);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

function ghReal(args) {
  return new Promise((resolve) => {
    execFile('gh', args, { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, motivo: (stderr || err.message).trim().split('\n')[0] || 'gh falhou' });
      else resolve({ ok: true, stdout });
    });
  });
}

const ndjson = (s) => s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function contar(runs) {
  const porEvento = {};
  for (const r of runs) porEvento[r.event] = (porEvento[r.event] ?? 0) + 1;
  return { total: runs.length, porEvento };
}

async function resumoRepo(repo, agoraMs, gh, cacheJobs) {
  const vis = await gh(['api', `repos/${repo}`, '--jq', '.visibility']);
  if (!vis.ok) return { indisponivel: vis.motivo };
  const desde30 = new Date(agoraMs - 30 * DIA_MS).toISOString().slice(0, 10);
  const lr = await gh(['api', `repos/${repo}/actions/runs?created=>=${desde30}&per_page=100`, '--paginate', '--jq', '.workflow_runs[] | {id, event, status, created_at}']);
  if (!lr.ok) return { indisponivel: lr.motivo };
  const runs = ndjson(lr.stdout);
  const runs7 = runs.filter((r) => Date.parse(r.created_at) >= agoraMs - 7 * DIA_MS);
  const minutos30 = { linux: 0, windows: 0, macos: 0, ponderado: 0 };
  for (const run of runs) {
    const chave = `${repo}#${run.id}`;
    let jobs = cacheJobs[chave];
    if (!jobs) {
      const lj = await gh(['api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, '--jq', '.jobs[] | {labels, started_at, completed_at}']);
      if (!lj.ok) continue;
      jobs = ndjson(lj.stdout);
      if (run.status === 'completed') cacheJobs[chave] = jobs;
    }
    for (const j of jobs) {
      const s = sistemaDoJob(j.labels);
      if (s === 'self-hosted') continue;
      const m = minutosJob(j);
      minutos30[s] += m;
      minutos30.ponderado += m * pesoSistema(s);
    }
  }
  const lc = await gh(['api', `repos/${repo}/actions/cache/usage`, '--jq', '.active_caches_size_in_bytes']);
  return {
    publico: JSON.parse(vis.stdout) === 'public',
    runs7: contar(runs7), runs30: contar(runs), minutos30,
    cache: { bytes: lc.ok ? Number(lc.stdout.trim()) : null, limiteBytes: LIMITE_CACHE },
  };
}

export async function coletarGithub({ repos, agoraMs, gh = ghReal }) {
  const arq = path.join(dirDados(), 'github-cache.json');
  const lido = lerJson(arq);
  const cacheJobs = lido.ok && lido.valor?.versao === 1 ? lido.valor.jobs : {};
  const saida = {};
  for (const repo of repos) {
    try { saida[repo] = await resumoRepo(repo, agoraMs, gh, cacheJobs); } catch (e) { saida[repo] = { indisponivel: e.message }; }
  }
  gravarJsonAtomico(arq, { versao: 1, jobs: cacheJobs });
  return saida;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/agregacao.test.js test/github.test.js`
Expected: PASS, 6 testes.

- [ ] **Step 6: Commit**

```bash
git add src/agregacao.js src/github.js test/agregacao.test.js test/github.test.js
git commit -m "report: token aggregation and GitHub Actions usage"
```

---

### Task 10: `relatorio`, CLI e skill `/consumo`

**Files:**
- Create: `src/relatorio.js`, `src/cli.js`, `skills/consumo/SKILL.md`
- Test: `test/relatorio.test.js`

**Interfaces:**
- Consumes: `limitesValidos`, `lerJson`, `dirDados`, `ARQ_ESTADO` (Task 4); `faixa7d` (Task 3); `indexarTranscripts` (Task 8); `agregar`, `coletarGithub` (Task 9); `horaLocal`, `diaHora`, `formatarTokens` (Task 1).
- Produces:
  - `montarRelatorio({ estado, agoraMs, claude: { hoje, semana, linhasInvalidas } | { indisponivel }, github }) → Relatorio` (objeto com `versao: 1`, `gerado_em`, `limites`, `claude`, `github`)
  - `formatarMarkdown(relatorio) → string`
  - CLI: `node src/cli.js consumo [--json]` e `node src/cli.js instalar [--aplicar] [--substituir]` (este último implementado na Task 11; aqui responde "não implementado" e código 0).
  - Config opcional `<dirDados>/config.json` = `{ "repos": ["Garioli-Labs/resonance-pro"] }`; se ausente, usa o `origin` do diretório atual (`git remote get-url origin` → `dono/repo`).

- [ ] **Step 1: Teste que falha**

`test/relatorio.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarRelatorio, formatarMarkdown } from '../src/relatorio.js';

const agora = Date.now();
const s = Math.floor(agora / 1000);
const estado = { versao: 1, at: new Date(agora - 60_000).toISOString(), five_hour: { used_percentage: 42, resets_at: s + 3600 }, seven_day: { used_percentage: 48, resets_at: s + 86400 }, sessoes: {} };
const soma = { respostas: 3, input: 30, output: 300, thinking: 50, cacheRead: 2700, cacheCreate: 0, acertoCache: 0.989 };
const claude = { hoje: { total: soma, porProjeto: { Demo: soma }, porModeloEffort: { 'claude-opus-5·high': soma }, principalVsSubagente: { principal: soma, subagente: soma } }, semana: { total: soma, porProjeto: { Demo: soma }, porModeloEffort: { 'claude-opus-5·high': soma }, principalVsSubagente: { principal: soma, subagente: soma } }, linhasInvalidas: 2 };
const github = { 'o/r': { publico: false, runs7: { total: 1, porEvento: { push: 1 } }, runs30: { total: 2, porEvento: { push: 1, schedule: 1 } }, minutos30: { linux: 4, windows: 5, macos: 1, ponderado: 24 }, cache: { bytes: 664824301, limiteBytes: 10737418240 } }, 'x/y': { indisponivel: 'HTTP 404' } };

test('relatório completo em JSON versionado', () => {
  const r = montarRelatorio({ estado, agoraMs: agora, claude, github });
  assert.equal(r.versao, 1);
  assert.equal(r.limites.seven_day.used_percentage, 48);
  assert.equal(typeof r.limites.seven_day.esperado, 'number');
  assert.equal(r.limites.idade_min, 1);
});

test('markdown traz os três blocos, resumo semanal e indisponíveis', () => {
  const md = formatarMarkdown(montarRelatorio({ estado, agoraMs: agora, claude, github }));
  assert.match(md, /## Limites e ritmo/);
  assert.match(md, /7d 48% usado vs \d+% esperado; reset \S+ \d\d:\d\d/);
  assert.match(md, /## Claude/);
  assert.match(md, /\| Demo \|/);
  assert.match(md, /98\.9%/);
  assert.match(md, /2 linhas inválidas ignoradas/);
  assert.match(md, /## GitHub/);
  assert.match(md, /x\/y: indisponível: HTTP 404/);
  assert.match(md, /ponderado 24/);
});

test('sem leitura e claude indisponível aparecem como tal, nunca zero', () => {
  const md = formatarMarkdown(montarRelatorio({ estado: null, agoraMs: agora, claude: { indisponivel: 'sem transcripts' }, github: {} }));
  assert.match(md, /Sem leitura de limites: rode \/usage\./);
  assert.match(md, /Claude: indisponível: sem transcripts/);
  assert.match(md, /Nenhum repo configurado/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/relatorio.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `relatorio`**

`src/relatorio.js`:
```js
import { limitesValidos } from './estado.js';
import { faixa7d } from './alerta.js';
import { horaLocal, diaHora, formatarTokens } from './util.js';

const ROTULO = { normal: 'normal', folga: 'folga', economico: 'econômico', 'so-leitura': 'só leitura' };
const pct = (x) => `${Math.round(x)}%`;
const pctCache = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const gb = (b) => (b === null ? '—' : `${(b / 1024 ** 3).toFixed(2)} GB`);

export function montarRelatorio({ estado, agoraMs, claude, github }) {
  const lim = limitesValidos(estado, agoraMs);
  let limites = null;
  if (lim) {
    limites = { idade_min: Math.round((agoraMs - Date.parse(estado.at)) / 60_000) };
    if (lim.five_hour) limites.five_hour = { ...lim.five_hour };
    if (lim.seven_day) {
      const f = faixa7d({ usado: lim.seven_day.used_percentage, resetsAt: lim.seven_day.resets_at, agoraMs });
      limites.seven_day = { ...lim.seven_day, esperado: f.esperado, desvio: f.desvio, modo: f.faixa };
    }
  }
  return { versao: 1, gerado_em: new Date(agoraMs).toISOString(), limites, claude, github };
}

function tabela(titulo, mapa) {
  const linhas = [`| ${titulo} | respostas | entrada | saída | cache lido | acerto de cache |`, '|---|---:|---:|---:|---:|---:|'];
  for (const [k, s] of Object.entries(mapa).sort((a, b) => (b[1].output + b[1].input) - (a[1].output + a[1].input))) {
    linhas.push(`| ${k} | ${s.respostas} | ${formatarTokens(s.input + s.cacheCreate)} | ${formatarTokens(s.output)} | ${formatarTokens(s.cacheRead)} | ${pctCache(s.acertoCache)} |`);
  }
  return linhas.join('\n');
}

export function formatarMarkdown(r) {
  const out = ['## Limites e ritmo'];
  if (!r.limites) out.push('Sem leitura de limites: rode /usage.');
  else {
    const { five_hour: f5, seven_day: f7, idade_min } = r.limites;
    if (f7) out.push(`7d ${pct(f7.used_percentage)} usado vs ${pct(f7.esperado)} esperado; reset ${diaHora(f7.resets_at)} — modo ${ROTULO[f7.modo]}.`);
    if (f5) out.push(`5h ${pct(f5.used_percentage)}; reset ${horaLocal(f5.resets_at)}.`);
    out.push(`Leitura de ${idade_min} min atrás.`);
  }

  out.push('', '## Claude');
  if (r.claude?.indisponivel) out.push(`Claude: indisponível: ${r.claude.indisponivel}`);
  else {
    for (const [nome, a] of [['Hoje', r.claude.hoje], ['Janela semanal', r.claude.semana]]) {
      out.push('', `### ${nome} — ${a.total.respostas} respostas, acerto de cache ${pctCache(a.total.acertoCache)}`);
      out.push('', tabela('projeto', a.porProjeto), '', tabela('modelo·effort', a.porModeloEffort));
      out.push('', `Principal: ${formatarTokens(a.principalVsSubagente.principal.output)} tok de saída · Subagentes: ${formatarTokens(a.principalVsSubagente.subagente.output)} tok de saída.`);
    }
    if (r.claude.linhasInvalidas) out.push('', `${r.claude.linhasInvalidas} linhas inválidas ignoradas.`);
  }

  out.push('', '## GitHub');
  const repos = Object.entries(r.github ?? {});
  if (!repos.length) out.push('Nenhum repo configurado (config.json → "repos") nem origin no diretório atual.');
  for (const [repo, g] of repos) {
    if (g.indisponivel) { out.push(`- ${repo}: indisponível: ${g.indisponivel}`); continue; }
    const ev = (p) => Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ');
    out.push(`- **${repo}** (${g.publico ? 'público: minutos grátis' : 'privado: consome o pool'}) — execuções 7d: ${g.runs7.total} (${ev(g.runs7.porEvento)}); 30d: ${g.runs30.total} (${ev(g.runs30.porEvento)}); minutos 30d: Linux ${g.minutos30.linux}, Windows ${g.minutos30.windows}, macOS ${g.minutos30.macos}, ponderado ${g.minutos30.ponderado}; cache ${gb(g.cache.bytes)} de ${gb(g.cache.limiteBytes)}.`);
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Implementar a CLI**

`src/cli.js`:
```js
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirDados, lerJson, ARQ_ESTADO } from './estado.js';
import { indexarTranscripts } from './transcripts.js';
import { agregar } from './agregacao.js';
import { coletarGithub } from './github.js';
import { montarRelatorio, formatarMarkdown } from './relatorio.js';

const DIA_MS = 86_400_000;

function reposConfigurados() {
  const cfg = lerJson(path.join(dirDados(), 'config.json'));
  if (cfg.ok && Array.isArray(cfg.valor?.repos)) return cfg.valor.repos;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
    return m ? [m[1]] : [];
  } catch { return []; }
}

async function consumo(args) {
  const agoraMs = Date.now();
  const est = lerJson(path.join(dirDados(), ARQ_ESTADO));
  const estado = est.ok ? est.valor : null;
  const inicioJanela = estado?.seven_day ? estado.seven_day.resets_at * 1000 - 7 * DIA_MS : agoraMs - 7 * DIA_MS;
  const desde = Math.min(inicioJanela, agoraMs - 7 * DIA_MS);
  let claude;
  try {
    const idx = await indexarTranscripts({ raiz: path.join(os.homedir(), '.claude', 'projects'), desdeMs: desde });
    const hoje = new Date(agoraMs); hoje.setHours(0, 0, 0, 0);
    claude = idx.arquivos === 0 ? { indisponivel: 'nenhum transcript nos últimos 7 dias' }
      : { hoje: agregar(idx.registros, hoje.getTime()), semana: agregar(idx.registros, inicioJanela), linhasInvalidas: idx.linhasInvalidas };
  } catch (e) { claude = { indisponivel: e.message }; }
  const github = await coletarGithub({ repos: reposConfigurados(), agoraMs });
  const rel = montarRelatorio({ estado, agoraMs, claude, github });
  process.stdout.write(args.includes('--json') ? JSON.stringify(rel, null, 2) : formatarMarkdown(rel));
}

const [cmd, ...args] = process.argv.slice(2);
const comandos = { consumo };
const fn = comandos[cmd];
if (!fn) { process.stdout.write('uso: cli.js consumo [--json] | instalar [--aplicar] [--substituir]\n'); }
else fn(args).catch((e) => { process.stdout.write(`erro: ${e.message}\n`); });
```

`skills/consumo/SKILL.md`:
```markdown
---
name: consumo
description: Relatório de consumo do Claude Code e do GitHub Actions — limites de 5 h e 7 dias com ritmo, tokens por projeto e por modelo·effort, acerto de cache, minutos e cache do Actions. Use quando o usuário pedir consumo, uso, limites, ritmo ou gasto.
argument-hint: "[--json]"
---

Rode exatamente este comando e mostre a saída ao usuário sem resumir nem reinterpretar os números:

`node ~/.claude/hadouken/bin/cli.mjs consumo $ARGUMENTS`

Se o arquivo não existir, diga que o plugin ainda não rodou uma sessão desde a instalação (o hook de início de sessão cria o arquivo) e peça para abrir uma nova sessão.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Rodar de verdade nesta máquina**

Run: `node src/cli.js consumo` (com `HADOUKEN_HOME` padrão)
Expected: os três blocos aparecem; a seção Claude mostra projetos reais; nenhum stack trace. Colar a saída no "Registro de execução" **sem** números identificáveis de clientes (apenas contagens e nomes dos projetos do Sr. Garioli).

- [ ] **Step 7: Commit**

```bash
git add src/relatorio.js src/cli.js skills/consumo test/relatorio.test.js
git commit -m "report: /consumo command with limits, tokens and GitHub sections"
```

---

### Task 11: Instalador da statusline

**Files:**
- Create: `src/configuracao.js`, `skills/instalar/SKILL.md`
- Modify: `src/cli.js` (adicionar o subcomando `instalar`)
- Test: `test/configuracao.test.js`

**Interfaces:**
- Consumes: `dirDados`, `lerJson`, `gravarJsonAtomico` (Task 4).
- Produces:
  - `comandoStatusline() → string` = `node "<dirDados>/bin/statusline.mjs"` com barras normais (`/`).
  - `planejarStatusline(settings: object|null) → { acao: 'instalar'|'ja-instalado'|'conflito', atual: object|null, proposto: object }`
  - `aplicarStatusline({ arquivo, substituir: boolean, agoraMs }) → { ok: true, acao, backup: string|null } | { ok: false, motivo }`
  - Arquivo de settings: `process.env.HADOUKEN_SETTINGS` (testes) ou `~/.claude/settings.json`.

- [ ] **Step 1: Teste que falha**

`test/configuracao.test.js`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comandoStatusline, planejarStatusline, aplicarStatusline } from '../src/configuracao.js';

let dir, arq;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk cfg ç '));
  process.env.HADOUKEN_HOME = path.join(dir, 'hadouken');
  arq = path.join(dir, 'settings.json');
});

test('comando usa barras normais e aspas', () => {
  assert.match(comandoStatusline(), /^node ".*\/hadouken\/bin\/statusline\.mjs"$/);
  assert.ok(!comandoStatusline().includes('\\'));
});

test('planejar: instalar, já instalado e conflito', () => {
  assert.equal(planejarStatusline({}).acao, 'instalar');
  assert.equal(planejarStatusline(null).acao, 'instalar');
  const p = planejarStatusline({});
  assert.equal(planejarStatusline({ statusLine: p.proposto }).acao, 'ja-instalado');
  assert.equal(planejarStatusline({ statusLine: { type: 'command', command: 'outra' } }).acao, 'conflito');
});

test('aplicar preserva as outras chaves e faz backup', () => {
  fs.writeFileSync(arq, JSON.stringify({ permissions: { defaultMode: 'auto' }, hooks: { X: [] } }, null, 2));
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.acao, 'instalar');
  const novo = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.deepEqual(novo.permissions, { defaultMode: 'auto' });
  assert.deepEqual(novo.hooks, { X: [] });
  assert.equal(novo.statusLine.type, 'command');
  assert.ok(fs.existsSync(r.backup));
});

test('conflito sem --substituir não altera o arquivo', () => {
  const original = JSON.stringify({ statusLine: { type: 'command', command: 'outra' } });
  fs.writeFileSync(arq, original);
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.deepEqual(r, { ok: false, motivo: 'conflito' });
  assert.equal(fs.readFileSync(arq, 'utf8'), original);
});

test('settings.json inválido nunca é sobrescrito', () => {
  fs.writeFileSync(arq, '{ quebrado');
  assert.deepEqual(aplicarStatusline({ arquivo: arq, substituir: true, agoraMs: 1 }), { ok: false, motivo: 'settings-invalido' });
  assert.equal(fs.readFileSync(arq, 'utf8'), '{ quebrado');
});

test('settings.json ausente é criado', () => {
  const r = aplicarStatusline({ arquivo: arq, substituir: false, agoraMs: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.backup, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/configuracao.test.js`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

`src/configuracao.js`:
```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirDados, lerJson, gravarJsonAtomico } from './estado.js';

export const arquivoSettings = () => process.env.HADOUKEN_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');

export function comandoStatusline() {
  const alvo = path.join(dirDados(), 'bin', 'statusline.mjs').split(path.sep).join('/');
  return `node "${alvo}"`;
}

export function planejarStatusline(settings) {
  const proposto = { type: 'command', command: comandoStatusline(), padding: 0 };
  const atual = settings?.statusLine ?? null;
  if (!atual) return { acao: 'instalar', atual, proposto };
  if (atual.type === proposto.type && atual.command === proposto.command) return { acao: 'ja-instalado', atual, proposto };
  return { acao: 'conflito', atual, proposto };
}

export function aplicarStatusline({ arquivo, substituir, agoraMs }) {
  const lido = lerJson(arquivo);
  if (!lido.ok && lido.motivo === 'invalido') return { ok: false, motivo: 'settings-invalido' };
  const settings = lido.ok ? lido.valor : {};
  const plano = planejarStatusline(settings);
  if (plano.acao === 'ja-instalado') return { ok: true, acao: plano.acao, backup: null };
  if (plano.acao === 'conflito' && !substituir) return { ok: false, motivo: 'conflito' };
  let backup = null;
  if (lido.ok) {
    backup = `${arquivo}.bak-hadouken-${agoraMs}`;
    fs.copyFileSync(arquivo, backup);
  }
  const r = gravarJsonAtomico(arquivo, { ...settings, statusLine: plano.proposto });
  return r.ok ? { ok: true, acao: plano.acao, backup } : { ok: false, motivo: r.motivo };
}
```

Em `src/cli.js`, adicionar antes de `const [cmd, ...args]`:
```js
import { arquivoSettings, planejarStatusline, aplicarStatusline } from './configuracao.js';

async function instalar(args) {
  const arquivo = arquivoSettings();
  if (!args.includes('--aplicar')) {
    const lido = lerJson(arquivo);
    if (!lido.ok && lido.motivo === 'invalido') { process.stdout.write(`${arquivo} tem JSON inválido; nada será alterado.\n`); return; }
    const p = planejarStatusline(lido.ok ? lido.valor : null);
    process.stdout.write(JSON.stringify({ arquivo, acao: p.acao, atual: p.atual, proposto: p.proposto }, null, 2));
    return;
  }
  const r = aplicarStatusline({ arquivo, substituir: args.includes('--substituir'), agoraMs: Date.now() });
  process.stdout.write(JSON.stringify(r, null, 2));
}
```
e trocar `const comandos = { consumo };` por `const comandos = { consumo, instalar };`.

`skills/instalar/SKILL.md`:
```markdown
---
name: instalar
description: Instala a barra de status do claude-hadouken no settings.json do usuário, mostrando a alteração e pedindo confirmação antes de gravar.
disable-model-invocation: true
---

1. Rode `node ~/.claude/hadouken/bin/cli.mjs instalar` e leia o JSON (`acao`, `atual`, `proposto`, `arquivo`).
2. Se `acao` for `ja-instalado`, diga isso e pare.
3. Mostre ao usuário a chave `statusLine` proposta e, se houver, a atual. Pergunte com AskUserQuestion se pode gravar; se `acao` for `conflito`, a pergunta deve deixar claro que a barra atual será substituída (há backup).
4. Só com "sim": rode `node ~/.claude/hadouken/bin/cli.mjs instalar --aplicar` (acrescente `--substituir` apenas se o usuário aceitou substituir a barra atual) e mostre o resultado, incluindo o caminho do backup.
5. Diga que a barra aparece na próxima atualização da interface.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Commit**

```bash
git add src/configuracao.js src/cli.js skills/instalar test/configuracao.test.js
git commit -m "core: status line installer with backup and conflict guard"
```

---

### Task 12: Medição de performance, README e v0.1.0

**Files:**
- Create: `scripts/bench.js`, `README.md`
- Modify: nada além disso

**Interfaces:**
- Consumes: executáveis `src/statusline.js`, `src/hooks/prompt-submit.js`, `src/cli.js`.

- [ ] **Step 1: Script de medição**

`scripts/bench.js`:
```js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk bench '));
const env = { ...process.env, HADOUKEN_HOME: home, NO_COLOR: '1' };
const s = Math.floor(Date.now() / 1000);
const entrada = JSON.stringify({ session_id: 'b', model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, context_window: { used_percentage: 30 }, prompt_cache: { hit_ratio: 0.97 }, rate_limits: { five_hour: { used_percentage: 40, resets_at: s + 3600 }, seven_day: { used_percentage: 50, resets_at: s + 86400 } } });

function p95(script, input, n = 100) {
  const t = [];
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    spawnSync(process.execPath, [path.resolve(script)], { input, env });
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  return Math.round(t[Math.floor(n * 0.95) - 1]);
}

const tempo = (fn) => { const a = performance.now(); fn(); return Math.round(performance.now() - a); };

console.log(`statusline p95: ${p95('src/statusline.js', entrada)} ms (meta ≤ 150)`);
console.log(`prompt-submit p95: ${p95('src/hooks/prompt-submit.js', JSON.stringify({ session_id: 'b' }))} ms (meta ≤ 100)`);
const envReal = { ...process.env, HADOUKEN_HOME: path.join(home, 'real') };
console.log(`consumo frio: ${tempo(() => spawnSync(process.execPath, ['src/cli.js', 'consumo', '--json'], { env: envReal }))} ms (meta ≤ 15000)`);
console.log(`consumo quente: ${tempo(() => spawnSync(process.execPath, ['src/cli.js', 'consumo', '--json'], { env: envReal }))} ms (meta ≤ 2000)`);
```

- [ ] **Step 2: Medir nesta máquina**

Run: `node scripts/bench.js`
Expected: quatro linhas com números. Colar no "Registro de execução". Meta estourada → **parar** e levar ao Sr. Garioli com o número medido antes de seguir (spec §9). O tempo de `consumo` inclui GitHub dos repos configurados; se o GitHub dominar, medir de novo com `config.json` vazio e registrar os dois.

- [ ] **Step 3: README**

`README.md` com: o que o plugin faz (3 parágrafos); instalação (`/plugin marketplace add Garioli-Labs/claude-hadouken`, `/plugin install claude-hadouken@claude-hadouken`, abrir nova sessão, `/claude-hadouken:instalar`); a barra explicada campo a campo; os alertas (tabela da spec §6.3); `/claude-hadouken:consumo`; `config.json` com `repos`; privacidade (spec §8); roadmap A→D e v1.0 = A+B+C+D; licença MIT.

- [ ] **Step 4: Teste de ponta a ponta instalado (sessão principal, com o Sr. Garioli)**

1. `/plugin marketplace add "E:\Projetos DEV\claude-hadouken"` e `/plugin install claude-hadouken@claude-hadouken`.
2. Abrir nova sessão: conferir a linha "Consumo: ..." injetada e `~/.claude/hadouken/bin/*.mjs` criados.
3. `/claude-hadouken:instalar` → confirmar → barra visível.
4. `/claude-hadouken:consumo` → três blocos com dados reais.
Registrar os resultados no "Registro de execução".

- [ ] **Step 5: Commit, tag e push (com o OK do Sr. Garioli)**

```bash
git add scripts/bench.js README.md docs/superpowers/plans/2026-09-25-leitor-de-consumo.md
git commit -m "docs: README, performance record and v0.1.0"
git tag v0.1.0
git push origin main --tags
```
Conferir a execução do CI nos três sistemas: `gh run watch --repo Garioli-Labs/claude-hadouken`.

---

## Registro de execução

(preenchido durante a execução: resultado da V1, validação dos hooks, saída do `/consumo`, números do bench, desvios e decisões do Sr. Garioli com data)
