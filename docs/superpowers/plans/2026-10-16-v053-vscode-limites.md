# v0.5.3, parte VS Code: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`) para acompanhar o andamento.

**Objetivo:** o usuário configura limites, barra, alertas, aprendizado, painel e roteamento sem editar JSON, tanto na janela do VS Code quanto no `/hadouken:limites`. Ele também vê a logo do hadouken animar quando o plugin atua, recebe o aviso de versão nova com o botão Atualizar e encontra um README curto com a wiki.

**Arquitetura:**
- **Plugin:** módulos novos em `src/config/`, `src/atualizacao/` e `src/eventos/`. Eles ficam expostos à extensão por um módulo novo, `src/uso/painel-api.js`, que passa a ser o alvo do shim `painel.mjs`.
- **Extensão:** continua fina. Ela ganha a segunda barra, a fonte de ícones, a janela (`vscode/janela/`) e o aviso de versão. O `.vsix` passa a levar esses arquivos.
- **Comando no terminal:** o `/hadouken:limites` é um hook `UserPromptExpansion`, no molde do `liberar.js`.

**Tecnologia:** Node 20+, ESM no plugin, CommonJS na extensão, `node:test`, sem dependências de execução. A fonte `.woff` é gerada uma vez, no desenvolvimento, e commitada (Task 8).

**Spec:** `docs/superpowers/specs/2026-10-16-v053-vscode-limites-design.md`, aprovada pelo Sr. Garioli em 2026-10-16. Ela é a autoridade. A aba Roteamento usa a chave definida no plano `2026-10-16-v053-roteamento.md`, Task 3.

## Restrições globais

- **Textos:** sempre em português. Os comentários citam a spec (`spec vscode §N`).
- **Nunca lançar:** nenhuma função exportada lança, e nenhum callback da extensão lança.
- **Textos fixos:** o nome do campo vem da tabela de `src/config/`, nunca do arquivo nem do argumento digitado.
- **`config.json`:**
  - lido com teto de 64 KiB;
  - gravado de forma atômica (arquivo temporário e `rename`);
  - um arquivo ilegível nunca desliga a guarda.
- **Na janela, nada vira HTML:** o que vem de fora (`config.json`, GitHub, estado) entra só por `textContent`.
- **Comando de atualizar:** fixo no código, igual ao texto do README.
- **Testes de hook:** usam os ajudantes de `test/guarda-hooks.test.js`, com `HADOUKEN_HOME`, `CLAUDE_CONFIG_DIR`, HOME e USERPROFILE falsos e `HADOUKEN_SEM_PAINEL=1`.
- **Commits:** pelo `commit.sh` do scratchpad, com pathspec explícito e terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antes de cada commit, apague a pasta `Microsoft/` na raiz.
- **Suíte:** `node --test`. Ela tem que terminar com `ℹ fail 0`.

## Foco da revisão

São os cinco casos mais prováveis de causar problema. Cada um tem teste na tarefa dona.

1. **Extensão nova com plugin velho,** em que o shim não tem os nomes novos: o item mostra os números de sempre e esconde só a janela e o aviso. É testado na Task 9.
2. **`config.json` mudado por fora** enquanto a janela está aberta (outra janela, ou o `/hadouken:limites`): o Salvar recusa sem perder o rascunho. É testado nas Tasks 2 e 10.
3. **Afrouxar com aperto do aprendizado vigente:** solta só o item afrouxado, e o aprendizado não reaperta na hora (bloqueio de 7 dias). É testado na Task 2.
4. **GitHub fora do ar, com limite 403 ou com tag estranha:** nada muda e vale a última resposta boa. Depois de atualizar, a marca some. É testado na Task 6.
5. **Movimento reduzido** (`workbench.reduceMotion` ou `prefers-reduced-motion`): nada anima, nem a logo nem a janela. É testado nas Tasks 9 e 10.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `src/config/tabela.js` | A tabela de itens: caminho, rótulo, unidade, mínimo, máximo, padrão e grupo. |
| `src/config/ler.js` | `lerConfiguracao`, `validar`, `faixasBarra`, `limiaresAlertas`. |
| `src/config/gravar.js` | `gravarConfiguracao`, `voltarAoPadrao`, `desfazer` e o backup. |
| `src/aprendizado/ajustar.js` | Ganha `soltarAperto`. |
| `src/formato.js`, `src/statusline.js` | As faixas da barra vindas da config. |
| `src/alerta.js`, `src/hooks/alertas-gravados.js` | Os limiares de projeção vindos da config, e o evento. |
| `src/hooks/limites.js`, `skills/limites/SKILL.md`, `hooks/hooks.json` | O `/hadouken:limites`. |
| `src/eventos/eventos.js` | `registrarEvento`, `ultimoEvento`. |
| `src/guarda/registros.js` | Os eventos de negar e pedir viram o evento "guarda". |
| `src/atualizacao/versao.js` | `talvezConsultarVersao`, `estadoVersao`, `comandoAtualizar`. |
| `src/uso/painel-api.js`, `src/shim.js` | A API inteira para a extensão. |
| `vscode/icones/*`, `vscode/package.json`, `src/painel/vsix.js`, `src/painel/instalar-painel.js` | A fonte de ícones e o `.vsix` com todos os arquivos. |
| `vscode/extension.cjs` | Os dois itens, a animação, a cor, a janela e o aviso. |
| `vscode/janela/index.html`, `janela.css`, `janela.js`, `bola.svg` | A janela. |
| `test/vscode-falso.cjs` | Um `vscode` falso para testar a extensão. |
| `install.sh`, `install.ps1`, `src/instalar-tudo.js`, `src/aprendizado/ligar.js` | O aprendizado ligado por padrão. |
| `README.md`, `README.en.md`, `wiki/*`, `scripts/publicar-wiki.sh` | O README curto e a wiki. |

---

### Task 1: a tabela de itens, `lerConfiguracao` e `validar`

**Arquivos:**
- Criar: `src/config/tabela.js`, `src/config/ler.js`
- Teste: `test/config-ler.test.js`

**Interfaces:**
- Produz:
  - `ITENS: readonly Item[]`, com `Item = { id, caminho: string[], grupo, rotulo, unidade, tipo: 'inteiro' | 'booleano', min?, max?, padrao }`.
    - Os `id` são os nomes do `/hadouken:limites`: `guarda.ligada`, `guarda.teto5h`, …, `guarda.fable.tetoPct`, `barra.ctx.amarelo`, `barra.ctx.vermelho`, `barra.cache.amarelo`, `barra.cache.verde`, `alertas.projecao5hMin.0`, `alertas.projecao5hMin.1`, `alertas.projecao7dH`, `painel.avisarVersaoNova`, `painel.animarLogo`, `aprendizado.ligado`, `roteamento.negarN1`, `roteamento.negarN2`, `roteamento.avisos`, `roteamento.sugerirSessao`.
    - `grupo` ∈ `guarda | barra | alertas | aprendizado | painel | roteamento`.
  - `lerConfiguracao(dir) → { itens: [{ id, grupo, rotulo, unidade, tipo, min, max, padrao, valor, aperto: number | null }], versao: string, avisos: string[] }`.
    - `versao` é o sha256 do conteúdo do arquivo, cortado em 16 hex, ou `'ausente'`. É ele que detecta a gravação concorrente.
  - `validar(mudancas, lido) → { ok, erros: [{ id, texto }], afrouxa: string[] }`.
    - `mudancas` é `{ [id]: valor }`.
    - Afrouxar é ficar mais frouxo que o **efetivo** de hoje: o valor com o aperto aplicado.
  - `faixasBarra(dir) → { ctx: { amarelo, vermelho }, cache: { amarelo, verde } }`.
  - `limiaresAlertas(dir) → { five_hour: [[rotulo, ms], [rotulo, ms]], seven_day: [[rotulo, ms]] }`, no mesmo formato da tabela de `alerta.js:27`.

A tabela de faixas dos itens novos:

| id | min | max | padrão | unidade | mais frouxo quando |
|---|---|---|---|---|---|
| `barra.ctx.amarelo` | 30 | 95 | 70 | % | maior |
| `barra.ctx.vermelho` | 40 | 99 | 85 | % | maior |
| `barra.cache.amarelo` | 10 | 90 | 50 | % | menor |
| `barra.cache.verde` | 20 | 99 | 80 | % | menor |
| `alertas.projecao5hMin.0` | 10 | 180 | 60 | min | menor |
| `alertas.projecao5hMin.1` | 5 | 120 | 30 | min | menor |
| `alertas.projecao7dH` | 1 | 72 | 24 | h | menor |

Os itens da guarda reusam as faixas de `CAMPOS` em `src/guarda/config.js`. Exporte `CAMPOS` de lá, sem mudar o conteúdo. O sentido de "mais frouxo" na guarda é este:
- **maior é mais frouxo:** `teto*`, `fableDespachosMax`, `liberacao*` e `fable.tetoPct`;
- **menor é mais frouxo:** `horizonte*` e `margemReset5hMin`;
- **desligar é mais frouxo:** `ligada` de `true` para `false`.

Os booleanos de barra, painel, aprendizado e roteamento nunca contam como afrouxamento.

- [ ] **Passo 1: teste que falha**

```js
// test/config-ler.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ITENS } from '../src/config/tabela.js';
import { lerConfiguracao, validar, faixasBarra, limiaresAlertas } from '../src/config/ler.js';
import { PADRAO_GUARDA } from '../src/guarda/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-cfg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const com = (v) => {
  const d = fs.mkdtempSync(path.join(tmp, 'd'));
  if (v !== undefined) fs.writeFileSync(path.join(d, 'config.json'), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
};
const item = (l, id) => l.itens.find((i) => i.id === id);

test('tabela: ids únicos, padrões da guarda iguais aos de hoje', () => {
  assert.equal(new Set(ITENS.map((i) => i.id)).size, ITENS.length);
  assert.equal(ITENS.find((i) => i.id === 'guarda.teto7d').padrao, PADRAO_GUARDA.teto7d);
  for (const i of ITENS.filter((x) => x.tipo === 'inteiro')) assert.ok(i.min <= i.padrao && i.padrao <= i.max, i.id);
});

test('sem arquivo: padrões, versao ausente; com arquivo: valor e versao estável', () => {
  const l = lerConfiguracao(com());
  assert.equal(l.versao, 'ausente');
  assert.equal(item(l, 'barra.ctx.amarelo').valor, 70);
  const d = com({ barra: { ctx: { amarelo: 60 } } });
  assert.equal(item(lerConfiguracao(d), 'barra.ctx.amarelo').valor, 60);
  assert.match(lerConfiguracao(d).versao, /^[0-9a-f]{16}$/);
  assert.equal(lerConfiguracao(d).versao, lerConfiguracao(d).versao);
});

test('validar: faixa, coerência, id desconhecido e __proto__', () => {
  const l = lerConfiguracao(com());
  assert.equal(validar({ 'barra.ctx.amarelo': 200 }, l).ok, false);
  assert.equal(validar({ 'barra.ctx.amarelo': 1.5 }, l).ok, false);
  assert.equal(validar({ 'barra.ctx.amarelo': 90, 'barra.ctx.vermelho': 80 }, l).ok, false);
  assert.equal(validar({ 'alertas.projecao5hMin.1': 90 }, l).ok, false);
  assert.equal(validar({ 'guarda.liberacao.padraoH': 10, 'guarda.liberacao.maxH': 5 }, l).ok, false);
  assert.equal(validar({ 'nao.existe': 1 }, l).ok, false);
  assert.equal(validar(JSON.parse('{"__proto__":{"x":1}}'), l).ok, true);
  assert.deepEqual(validar({ 'barra.ctx.amarelo': 60 }, l), { ok: true, erros: [], afrouxa: [] });
});

test('afrouxa: guarda mais frouxa que o efetivo; texto do erro sem o valor digitado', () => {
  const l = lerConfiguracao(com());
  assert.deepEqual(validar({ 'guarda.teto7d': 95, 'guarda.horizonte7dH': 12 }, l).afrouxa.sort(), ['guarda.horizonte7dH', 'guarda.teto7d']);
  assert.deepEqual(validar({ 'guarda.ligada': false }, l).afrouxa, ['guarda.ligada']);
  const e = validar({ 'guarda.teto7d': 9999 }, l).erros[0].texto;
  assert.ok(!e.includes('9999'));
  assert.match(e, /50–100/);
});

test('faixasBarra e limiaresAlertas: configurados, e padrões com config inválida', () => {
  const d = com({ barra: { ctx: { amarelo: 60, vermelho: 50 } }, alertas: { projecao7dH: 12 } });
  assert.deepEqual(faixasBarra(d).ctx, { amarelo: 70, vermelho: 85 });
  assert.equal(limiaresAlertas(d).seven_day[0][1], 12 * 3_600_000);
  assert.deepEqual(faixasBarra(com('{')), { ctx: { amarelo: 70, vermelho: 85 }, cache: { amarelo: 50, verde: 80 } });
});
```

**Regra de coerência na leitura:** um par incoerente no arquivo, como o `amarelo` 60 com o `vermelho` 50 acima, faz o par **inteiro** voltar ao padrão, com um aviso. O teste fixa isso.

- [ ] **Passo 2:** rode `node --test test/config-ler.test.js`. Esperado: FAIL, porque o módulo não existe.

- [ ] **Passo 3: implementar.**

`tabela.js`:
- monta `ITENS` com `Object.freeze`, a partir de `CAMPOS` (o import de `src/guarda/config.js`) e da tabela acima;
- cada item ganha um `frouxo: 'maior' | 'menor' | 'desligar' | null`;
- os rótulos são em português, por exemplo "Teto da semana", "Contexto: amarelo a partir de" e "Avisar versão nova".

`ler.js`:
- usa `lerJson(arquivo, 64 * 1024)`, e calcula `crypto.createHash('sha256')` sobre os bytes lidos com `fs.readFileSync` (já validados pelo `lerJson`);
- pega cada valor por propriedade própria (`Object.hasOwn`), igual ao `proprio` de `src/guarda/config.js`;
- pega o `aperto` de `lerAperto(dir)` e aplica só em `guarda.teto7d` e `guarda.fable.tetoPct`.

Os textos de erro são fixos:
- `"<rótulo> fora da faixa <min>–<max>"`;
- `"<rótulo do vermelho> precisa ser maior que <rótulo do amarelo>"`;
- `"item desconhecido"`.

- [ ] **Passo 4:** rode o teste e depois `node --test test/guarda-config*.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: tabela e leitura da configuração inteira' src/config src/guarda/config.js test/config-ler.test.js`

---

### Task 2: gravar, voltar ao padrão e desfazer, soltando o aperto

**Arquivos:**
- Criar: `src/config/gravar.js`
- Modificar: `src/aprendizado/ajustar.js` (ganha `soltarAperto`)
- Teste: `test/config-gravar.test.js`

**Interfaces:**
- Consome: a Task 1.
- Produz:
  - `gravarConfiguracao(dir, mudancas, { versao, agoraMs }) → { ok: true, versao, desfazer: Token, afrouxou: string[] } | { ok: false, motivo: 'invalido' | 'mudou' | 'erro', erros? }`;
  - `voltarAoPadrao(dir, ids, { versao, agoraMs })`, com o mesmo retorno;
  - `desfazer(dir, token, { agoraMs })`, também com o mesmo retorno.
  - `Token = { antes: { [id]: valor | undefined }, versaoDepois, ate: number }`. Ele vale por 15 minutos e só se o arquivo ainda estiver na `versaoDepois`.
  - `soltarAperto(aj, item, agoraMs) → { ok, aj }`, em `ajustar.js`. Registra `depois: null` com a origem `'limites'` e bloqueia o item por `BLOQUEIO_MS`, para o aprendizado não reapertar na hora (foco 3).

- [ ] **Passo 1: teste que falha.** Os casos:
- **Gravação:** grava `{ 'barra.ctx.amarelo': 60 }`. O arquivo final mantém a chave `repos` e a `guarda` que já existiam, e ganha `barra.ctx.amarelo` = 60.
- **Backup:**
  - depois de 4 gravações, ficam exatamente 3 arquivos `config.json.bak-*`, os mais novos;
  - o nome do backup é `config.json.bak-<AAAAMMDDTHHMMSSmmm>`.
- **Gravação concorrente (foco 2):** com a `versao` lida antes de outra gravação, devolve `{ ok: false, motivo: 'mudou' }` e não muda o arquivo.
- **Inválido:** devolve `invalido` com os `erros`, e o arquivo continua igual.
- **Afrouxar `guarda.teto7d`** com o aprendizado ligado e o aperto vigente em 80:
  - `ajustes.json` fica com o vigente `null` para esse item e um bloqueio de 7 dias;
  - o vigente de `guarda.fableTetoPct` não muda.

  O ambiente do teste é montado com os ajudantes de `test/guarda-aperto*.test.js`: um `otel/ligado.json` e um `ajustes.json` com `v: 1`.
- **Voltar ao padrão:** `voltarAoPadrao(dir, ['barra.ctx.amarelo'])` remove a chave, e um objeto `barra.ctx` que fica vazio também é removido.
- **Desfazer:**
  - um `desfazer` com o token volta os valores anteriores (inclusive a ausência);
  - um segundo `desfazer` com o mesmo token devolve `mudou`;
  - um token vencido também devolve `mudou`.
- **Arquivo-pasta ou link:** devolve `erro`, sem lançar.

- [ ] **Passo 2:** rode `node --test test/config-gravar.test.js`. Esperado: FAIL.

- [ ] **Passo 3: implementar.**

`gravar.js`:
1. lê o arquivo bruto com `lerJson`. Se não estiver ausente nem for um objeto válido, devolve `erro`. Um arquivo quebrado **não** é sobrescrito: o usuário conserta à mão;
2. confere a `versao`;
3. roda `validar`;
4. aplica as mudanças por caminho, criando os objetos intermediários. Os `projecao5hMin.0` e `.1` gravam o array `[v0, v1]`;
5. copia o arquivo atual para o backup e apaga os backups além dos 3 mais novos (só arquivos regulares com o padrão exato do nome);
6. grava com `gravarJsonAtomico`;
7. para cada id em `afrouxa` que é `guarda.teto7d` ou `guarda.fable.tetoPct`, com o aprendizado ligado:
   - carrega o `ajustes.json` pelas funções de leitura e gravação que o `src/aprendizado/` já usa (procure com Grep `gravarAjustes|salvarAjustes`);
   - chama `soltarAperto` com o item do aprendizado (`guarda.teto7d` ou `guarda.fableTetoPct`) e grava.

   Uma falha nesse passo não desfaz a gravação: registre `erro` em `registros.js`, com o detalhe `limites:aperto`.

`soltarAperto` usa o `registrar` interno de `ajustar.js` com `depois = null` e `origem = 'limites'`, e grava `aj.bloqueios[item] = agoraMs + BLOQUEIO_MS`. Confira que `valorDoItem` aceita `null` como "sem aperto". Se não aceitar, registre isso como ruling.

- [ ] **Passo 4:** rode `node --test test/config-gravar.test.js test/aprendizado-*.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: gravar configuração com backup, desfazer e soltar aperto' src/config/gravar.js src/aprendizado/ajustar.js test/config-gravar.test.js`

---

### Task 3: a barra e os alertas leem a configuração

**Arquivos:**
- Modificar: `src/formato.js:17-20`, `src/statusline.js`, `src/alerta.js:27`, o chamador de `avaliarAlertas` em `src/hooks/prompt-submit.js` e/ou `alertas-gravados.js`
- Teste: casos novos em `test/formato.test.js` e `test/alerta.test.js`

**Interfaces:**
- Consome: `faixasBarra` e `limiaresAlertas` da Task 1.
- Produz:
  - `formatarBarra({ ..., faixas })`: sem `faixas`, usa `FAIXAS_CTX` e `FAIXAS_CACHE` de hoje;
  - `avaliarAlertas({ ..., limiares })`: sem `limiares`, usa a tabela de hoje.

  Os testes atuais continuam verdes **sem mudança**.

- [ ] **Passo 1: testes que falham.**
- `formatarBarra` com `faixas: { ctx: { amarelo: 50, vermelho: 60 }, cache: … }` e ctx 55: a cor é a amarela (confira pelo código ANSI que o teste atual já usa).
- `avaliarAlertas` com `limiares.seven_day = [['12h', 12 * 3_600_000]]`: a projeção de 7 dias em 13 h não avisa, e em 11 h avisa. Monte a entrada como os testes de projeção atuais.
- O rótulo vem da tabela: o texto do alerta mostra "12 h". Confira como o texto usa o rótulo hoje e faça o rótulo sair de `limiaresAlertas`, nunca do arquivo.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **`formato.js`:** `corCtx` e `corCache` recebem as faixas.
  - **`statusline.js`:** passa `faixas: faixasBarra(dirDados())`, dentro de um `try` que em falha deixa `undefined`. Faça o import dinâmico, para não pesar quando o arquivo não existe.
  - **`alerta.js`:** `avaliarProjecao` recebe os `limiares` pela `entrada`.
- [ ] **Passo 4:** rode `node --test test/formato.test.js test/alerta*.test.js test/statusline*.test.js test/hooks.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: faixas da barra e limiares de alerta configuráveis' src/formato.js src/statusline.js src/alerta.js src/hooks test/formato.test.js test/alerta.test.js`

---

### Task 4: `/hadouken:limites`

**Arquivos:**
- Criar: `src/hooks/limites.js`, `skills/limites/SKILL.md`, `src/config/mensagens.js`
- Modificar: `hooks/hooks.json` (matcher `hadouken:limites` em `UserPromptExpansion`)
- Teste: `test/limites.test.js`

**Interfaces:**
- Consome: as Tasks 1 e 2.
- Produz: `lerPedidoLimites(args) → { acao: 'mostrar' } | { acao: 'gravar', id, valor } | { acao: 'padrao', id } | { acao: 'padrao-tudo' } | { acao: 'invalido' }`.
  - **Gramática fechada:** no máximo 2 tokens.
  - **`id`:** precisa ser um `ITENS[].id` dos grupos `guarda`, `barra` ou `alertas`.
  - **`valor`:** `/^\d{1,4}$/`, ou `liga`/`desliga` para `guarda.ligada`.

- [ ] **Passo 1: teste que falha.** Copie a estrutura de `test/guarda-liberar-extra.test.js`, com os mesmos ajudantes para rodar o hook e o mesmo formato de entrada `UserPromptExpansion`. Os casos:
- `lerPedidoLimites` em 10 casos:
  - vazio dá `mostrar`;
  - `guarda.teto7d 80` dá `gravar`;
  - `barra.ctx.amarelo padrao` dá `padrao`;
  - `padrao` dá `padrao-tudo`;
  - `aprendizado.ligado desliga` dá `invalido`, porque esse grupo fica fora do comando;
  - `guarda.teto7d 80 x` dá `invalido`;
  - `guarda.teto7d -1` dá `invalido`;
  - `guarda.teto7d 1e3` dá `invalido`;
  - `__proto__ 1` dá `invalido`;
  - um texto com quebra de linha dá `invalido`.
- **Pelo hook:**
  - a saída tem `decision: 'block'`;
  - "mostrar" lista a tabela com os ids e o "apertado pelo aprendizado";
  - gravar `guarda.teto7d 95` grava, e o texto contém "Afrouxado: vale agora e desfaz o aperto do aprendizado neste item.";
  - o argumento inválido `<script>` nunca aparece no `stdout`.
- **Recusas:**
  - `CLAUDE_CODE_ENTRYPOINT=sdk-cli` é recusado sem gravar;
  - `command_source` diferente de `plugin` é recusado sem gravar;
  - `expansion_type` diferente de `slash_command` é recusado sem gravar.
- **Skill:** `skills/limites/SKILL.md` tem `disable-model-invocation: true`.

- [ ] **Passo 2:** rode `node --test test/limites.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **`src/hooks/limites.js`:** reaproveite do `liberar.js` o portão de entrada (o entrypoint, as origens aceitas e o `rodarHook`) importando as funções. Se elas não forem exportadas, extraia para `src/hooks/comum.js` e registre como ruling.
  - **Gravação:** passa por `gravarConfiguracao(dir, …, { versao: lerConfiguracao(dir).versao })`.
  - **Respostas:** saem de `src/config/mensagens.js`, com textos fixos.
  - **Tabela de "mostrar":** em Markdown, com as colunas `| item | atual | padrão | faixa | aprendizado |`.
  - **`hooks.json`:** acrescente, depois do matcher `hadouken:aprender`:
    `{ "matcher": "hadouken:limites", "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/hooks/limites.js"], "timeout": 10 } ] }`
  - **`SKILL.md`:** frontmatter com `name: limites`, `description: Mostra e muda os limites do hadouken (guarda, barra, alertas). Só o usuário usa, digitando /hadouken:limites [item valor | item padrao | padrao].` e `disable-model-invocation: true`. O corpo é igual ao do `liberar`: "O hook não rodou; nada foi mudado…".
- [ ] **Passo 4:** rode `node --test test/limites.test.js test/guarda-liberar*.test.js test/hooks-json*.test.js`. Esperado: PASS. Se o teste de `hooks.json` tiver uma lista fechada de matchers, atualize-a.
- [ ] **Passo 5:** `commit.sh 'feat: /hadouken:limites' src/hooks/limites.js src/hooks/comum.js src/config/mensagens.js skills/limites hooks/hooks.json test/limites.test.js`

---

### Task 5: eventos para animar a logo

**Arquivos:**
- Criar: `src/eventos/eventos.js`
- Modificar: `src/guarda/registros.js` (`anexarEvento`), `src/uso/painel.js` (`talvezAtualizar`), `src/hooks/alertas-gravados.js`, `src/aprendizado/ajustar.js` (o chamador que aplica um ajuste; procure com Grep onde `ajustar(` é chamado e grava)
- Teste: `test/eventos.test.js`

**Interfaces:**
- Produz:
  - `ARQ_EVENTO = 'ultimo-evento.json'`;
  - `registrarEvento(dir, tipo, urgencia, agoraMs) → boolean`;
  - `ultimoEvento(dir) → { tipo, urgencia, em } | null`.

  Tipos e urgências fora das listas são recusados.

**Decisão de desenho (ruling):** a spec lista seis hooks da guarda que chamam o evento. Em vez de mexer nos seis, o `anexarEvento` de `registros.js` chama `registrarEvento(dir, 'guarda', 'atencao', agoraMs)` quando o tipo é de negar ou pedir. O efeito é o mesmo com uma mudança só.

Os tipos de negar ou pedir são os que já existem em `TIPOS_EVENTO`:
- `negado-*`;
- `pedido-*`;
- `config-bloqueada`;
- `liberacao-recusada`;
- os `roteamento-negado` e `roteamento-aviso` do outro plano, se já estiverem lá.

Confira a lista real e fixe-a no teste.

- [ ] **Passo 1: teste que falha.** Os casos:
- grava e lê o evento;
- um tipo inválido não grava;
- uma pasta no lugar do arquivo devolve `null` e não lança;
- `anexarEvento(dir, 'config-bloqueada', 'x', t)` grava `ultimo-evento.json` com `tipo: 'guarda'`, e `anexarEvento(dir, 'erro', …)` não grava;
- `talvezAtualizar`, com uma leitura falsa bem-sucedida, grava `tipo: 'leitura'` com a urgência do `nivel` atual. O mapa é:
  - `normal` → `calma`;
  - `aviso` → `atencao`;
  - `erro` → `urgente`.

  Use os falsos que `test/uso-painel.test.js` já usa.
- **Tempo:** 1 000 chamadas de `registrarEvento` em menos de 2 s.

- [ ] **Passo 2:** rode `node --test test/eventos.test.js`. Esperado: FAIL.

- [ ] **Passo 3: implementar**

```js
// src/eventos/eventos.js
import path from 'node:path';
import { lerJson, gravarJsonAtomico } from '../estado.js';

// O último "hadouken" a animar na barra do VS Code (spec vscode §2.1). Sem
// trava: gravação pequena e atômica; o último vence. Nunca lança.
export const ARQ_EVENTO = 'ultimo-evento.json';
const TIPOS = new Set(['leitura', 'guarda', 'alerta', 'aprendizado']);
const URGENCIAS = new Set(['calma', 'atencao', 'urgente']);

export function registrarEvento(dir, tipo, urgencia, agoraMs) {
  try {
    if (typeof dir !== 'string' || !TIPOS.has(tipo) || !URGENCIAS.has(urgencia) || !Number.isSafeInteger(agoraMs)) return false;
    return gravarJsonAtomico(path.join(dir, ARQ_EVENTO), { tipo, urgencia, em: agoraMs }).ok === true;
  } catch {
    return false;
  }
}

export function ultimoEvento(dir) {
  try {
    const l = lerJson(path.join(dir, ARQ_EVENTO), 1024);
    const v = l.ok ? l.valor : null;
    return v && TIPOS.has(v.tipo) && URGENCIAS.has(v.urgencia) && Number.isSafeInteger(v.em) ? { tipo: v.tipo, urgencia: v.urgencia, em: v.em } : null;
  } catch {
    return null;
  }
}
```

Os outros chamadores:
- **`alertas-gravados.js`:** quando grava um alerta novo, chama `registrarEvento(dir, 'alerta', <urgente se a faixa for vermelha, senão atencao>, agoraMs)`.
- **Ajuste do aprendizado:** chama `registrarEvento(dir, 'aprendizado', 'calma', agoraMs)` quando aplica um ajuste.

Em todos os chamadores, a chamada fica dentro de `try`.

- [ ] **Passo 4:** rode `node --test test/eventos.test.js test/guarda-*.test.js test/uso-painel.test.js test/alertas*.test.js test/aprendizado-*.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: último evento para animar a logo' src/eventos src/guarda/registros.js src/uso/painel.js src/hooks/alertas-gravados.js src/aprendizado test/eventos.test.js`

---

### Task 6: aviso de versão nova

**Arquivos:**
- Criar: `src/atualizacao/versao.js`
- Teste: `test/atualizacao.test.js`

**Interfaces:**
- Produz:
  - `talvezConsultarVersao({ forcar, agoraMs, buscar, dir, raizPlugin }) → Promise<{ motivo: 'consultou' | 'recente' | 'travado' | 'falhou' | 'desligado' }>`.
    - `buscar` é injetável nos testes. O padrão é `fetch`, com `AbortSignal.timeout(5000)` e o cabeçalho `User-Agent: claude-hadouken`.
  - `estadoVersao({ dir, raizPlugin }) → { nova: string | null, instalada: string | null }`.
  - `comandoAtualizar(plataforma) → { shell: 'powershell' | 'posix', texto }`.
  - `compararVersoes(a, b) → -1 | 0 | 1`.
  - Arquivos: `<dir>/versao-nova.json` = `{ versao, consultadaEm }` e a trava `<dir>/versao-nova.lock`, criada com `fs.openSync(…, 'wx')`, que vence em 30 s, como `ARQ_TRAVA` em `uso/painel.js`.

- [ ] **Passo 1: teste que falha.** Os casos (foco 4):
- uma release `v0.5.9` com o plugin em 0.5.3 dá `nova: '0.5.9'`;
- `draft`, `prerelease`, `tag_name: 'latest'`, `'v0.5'` ou `'v0.5.9-rc1'` não mudam o arquivo;
- um `buscar` que rejeita, um 403 ou um JSON que não é objeto dão `falhou`, e o arquivo anterior fica igual;
- uma segunda chamada em menos de 6 h dá `recente`, sem chamar o `buscar`;
- com `forcar`, consulta mesmo em menos de 6 h, mas ainda respeita a trava;
- uma trava presente e nova dá `travado`;
- com o plugin já em 0.5.9, `nova` fica `null`, então a marca some depois de atualizar;
- `painel.avisarVersaoNova: false` no config dá `desligado`;
- `comandoAtualizar('win32').texto` é exatamente `irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex`, e `comandoAtualizar('linux').texto` é exatamente `curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash`;
- **teste de texto:** os dois comandos aparecem literalmente no `README.md`.

- [ ] **Passo 2:** rode o teste. Esperado: FAIL.

- [ ] **Passo 3: implementar.**
- `URL = 'https://api.github.com/repos/Garioli-Labs/claude-hadouken/releases/latest'`, fixo.
- `TAG = /^v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/`.
- A versão instalada vem de `<raizPlugin>/.claude-plugin/plugin.json`, lido com `lerJson(…, 16 * 1024)` e validado com `/^\d{1,4}\.\d{1,4}\.\d{1,4}$/`.
- A resposta tem limite de 256 KiB: leia com `await r.text()`, confira o tamanho e só depois faça o `JSON.parse`.
- A trava é apagada num `finally`.

- [ ] **Passo 4:** rode o teste. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: consulta de versão nova no GitHub' src/atualizacao test/atualizacao.test.js`

---

### Task 7: a API do painel e o shim

**Arquivos:**
- Criar: `src/uso/painel-api.js`
- Modificar: `src/shim.js:51` (o alvo do `painel.mjs` passa a ser `uso/painel-api.js`), `src/aprendizado/ligar.js` (o `desligar` grava o marcador `aprendizado-desligado-pelo-usuario`)
- Teste: casos novos em `test/shim.test.js` e `test/painel-api.test.js`

**Interfaces:**
- Produz: o `painel.mjs` exporta todos os nomes da spec §2.2:
  - `estadoPainel` e `talvezAtualizar`;
  - `lerConfiguracao`, `validar`, `gravarConfiguracao`, `voltarAoPadrao` e `desfazer`, já com o `dir` aplicado: a extensão não sabe a pasta;
  - `talvezConsultarVersao`, `estadoVersao` e `comandoAtualizar`;
  - `ultimoEvento`;
  - `ligarAprendizado` e `desligarAprendizado`;
  - `resumoRoteamento7d`, que devolve o resumo do plano de roteamento (Task 11 de lá) ou `null` se aquele módulo não existir.

  A `raizPlugin` sai do próprio `import.meta.url` (dois níveis acima de `src/uso/`).

- [ ] **Passo 1: testes que falham.**
- `import('../src/uso/painel-api.js')` tem os 15 nomes, todos funções.
- Com `HADOUKEN_HOME` temporário, `lerConfiguracao()` sem argumento lê daquela pasta.
- `sincronizarShims` grava um `painel.mjs` que reexporta `uso/painel-api.js`.
- Um `painel.mjs` antigo, apontando para `uso/painel.js`, é corrigido na sincronização seguinte.
- `desligar` grava o marcador.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.** `painel-api.js` reexporta `estadoPainel` e `talvezAtualizar` como vêm, e embrulha os outros com `dirDados()` e `raizPlugin`. Cada embrulho tem `try`, e devolve `null` ou `{ ok: false, motivo: 'erro' }` em falha.
  - **Ligar o aprendizado:** chama `previa` e depois `ligar` com o `settings.json` do usuário, do mesmo jeito que `passoAprendizado` em `instalar-tudo.js:167`. Ligar também apaga o marcador `aprendizado-desligado-pelo-usuario`, porque o usuário religou.
- [ ] **Passo 4:** rode `node --test test/shim.test.js test/painel-api.test.js test/uso-painel.test.js test/aprendizado-ligar*.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: API do painel para a janela do VS Code' src/uso/painel-api.js src/shim.js src/aprendizado/ligar.js test/shim.test.js test/painel-api.test.js`

---

### Task 8: a fonte de ícones e o `.vsix` com todos os arquivos

**Arquivos:**
- Criar:
  - `vscode/icones/svg/hadouken-0.svg` … `hadouken-4.svg` (os quadros: parado, carga, disparo, bola saindo e bola longe, desenhados a partir de `assets/icone.svg`);
  - `hadouken-seg-cheio.svg`, `-meio.svg`, `-vazio.svg`, `hadouken-seta.svg`;
  - `vscode/icones/hadouken.woff`;
  - `scripts/gerar-fonte.sh`.
- Modificar: `vscode/package.json` (`contributes.icons`), `src/painel/vsix.js` (`montarVsix` aceita `extras: [{ nome, dados }]`), `src/painel/instalar-painel.js:300` (lê `vscode/janela/*` e `vscode/icones/hadouken.woff`)
- Teste: casos novos em `test/painel-vsix.test.js` e `test/painel-instalar.test.js`

**Interfaces:**
- Produz:
  - os ícones `hadouken-0` … `hadouken-4`, `hadouken-seg-cheio`, `hadouken-seg-meio`, `hadouken-seg-vazio` e `hadouken-seta`, com `fontCharacter` de `\\E001` a `\\E009`, nessa ordem;
  - `montarVsix({ ..., extras })`, em que cada extra tem o nome `extension/janela/<arquivo>` ou `extension/icones/hadouken.woff`, validados pela regex `/^extension\/(janela\/[a-z-]{1,20}\.(html|css|js|svg)|janela\/pixel\.woff2|janela\/OFL\.txt|icones\/hadouken\.woff)$/`.

- [ ] **Passo 1: testes que falham.**
- `package.json` tem os 9 ícones, cada um apontando para `./icones/hadouken.woff` com o caractere esperado.
- O `.woff` existe e começa com os bytes `wOFF`.
- `montarVsix` com `extras` válidos põe todos no zip.
- Um extra com `../` ou de outra extensão faz devolver `null`.
- `instalarPainel`, num repositório montado com `vscode/janela/` e o `.woff`, inclui os arquivos. Faltando o `.woff`, falha com `motivo: 'fonte-ausente'`.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **SVGs, em pixel art (spec §4.5):**
    - `viewBox="0 0 16 16"` e `shape-rendering="crispEdges"`;
    - só elementos `<rect>` com coordenadas e tamanhos inteiros, sem `<path>` curvo nem `<circle>`;
    - de uma cor só, porque o VS Code pinta pela cor do item;
    - a bola de energia de `assets/icone.svg` vira um sprite;
    - os segmentos são blocos de barra de vida.

    O teste confere: todo SVG de `vscode/icones/svg/` só tem `<rect>` com atributos inteiros.
  - **`scripts/gerar-fonte.sh`:** roda `npx --yes fantasticon@3.0.0 vscode/icones/svg -o vscode/icones -t woff -n hadouken --normalize --codepoints <arquivo json com E001…E009>`. É uma ferramenta **só de desenvolvimento**, nunca usada na instalação. Rode o script uma vez e commite o `.woff`.

  **Ruling:** o `npx` dispara a `guarda-filha`. O executor pede ao Sr. Garioli que rode `! bash scripts/gerar-fonte.sh`, ou que libere com `/hadouken:liberar`. Se ele não puder, a alternativa registrada é `contributes.icons` sem fonte, usando `$(flame)` e os codicons de hoje. Nesse caso, a animação usa 3 codicons (`$(circle-large-outline)`, `$(circle-large-filled)` e `$(flame)`) e o critério da spec "logo do hadouken" fica pendente no ledger.
- [ ] **Passo 4:** rode `node --test test/painel-vsix.test.js test/painel-instalar.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: fonte de ícones do hadouken e vsix com a janela' vscode/icones vscode/package.json scripts/gerar-fonte.sh src/painel test/painel-vsix.test.js test/painel-instalar.test.js`

---

### Task 9: a extensão com os dois itens, a animação e a cor

**Arquivos:**
- Criar: `test/vscode-falso.cjs`, `test/extensao.test.js`
- Modificar: `vscode/extension.cjs`

**Interfaces:**
- Consome: o shim da Task 7 e os ícones da Task 8.
- Produz:
  - o item `claudeHadouken.logo` (prioridade 101) e o item `claudeHadouken.uso` (100);
  - os dois com `command = 'claudeHadouken.abrirJanela'` quando o shim tem a API nova, e com o comando de hoje quando não tem (foco 1).
  - `module.exports` ganha `_teste: { quadros, corDaUrgencia, segmentos }`, que são funções puras.

**O `vscode` falso:** `test/vscode-falso.cjs` exporta `criar()`. Ele devolve um objeto com estas partes:
- `window.createStatusBarItem`, que guarda os itens com `text`, `color`, `backgroundColor`, `tooltip`, `command`, `show` e `dispose`;
- `window.createWebviewPanel`, que conta as chamadas e devolve um painel com `webview: { html, cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage, onDidReceiveMessage }`, `reveal`, `onDidDispose` e `dispose`;
- `window.showInformationMessage`, que guarda as chamadas e responde por fila;
- `window.createTerminal`, que guarda `sendText` e `show`;
- `workspace.getConfiguration('workbench').get('reduceMotion')`;
- `commands.registerCommand` e `executeCommand`;
- `ThemeColor`, `MarkdownString`, `StatusBarAlignment` e `ViewColumn`;
- `Uri.joinPath`.

O teste carrega a extensão com `Module._load` interceptado (`require('vscode')` devolve o falso) e um `HADOUKEN_HOME` temporário com um `bin/painel.mjs` de teste que exporta funções controladas.

- [ ] **Passo 1: testes que falham.** Os casos:
- **Quadros:** `_teste.quadros()` é `['$(hadouken-0)', …, '$(hadouken-4)']`.
- **Cor:** `corDaUrgencia('calma')` é `'charts.blue'`, `'atencao'` é `'charts.yellow'` e `'urgente'` é `'charts.red'`.
- **Segmentos:** `segmentos(55)` tem 8 segmentos: 4 cheios, 1 meio e 3 vazios.
- **Animação:** com o `ultimoEvento().em` mudando de 1 para 2, o texto da logo passa pelos quadros 1 a 4 e termina em `$(hadouken-0)`. O teste usa `node:test` com `mock.timers` ligado para `setTimeout` e `setInterval`.
- **Mesmo evento:** o mesmo `em` não anima de novo.
- **Evento no meio da animação:** um evento que chega durante a animação não começa outra.
- **Movimento reduzido:** com `reduceMotion: 'on'`, o texto fica sempre em `$(hadouken-0)` e só a cor muda (foco 5).
- **Animação desligada:** com `painel.animarLogo: false` no `lerConfiguracao` do shim falso, também não anima.
- **Plugin velho:** um shim só com `estadoPainel` e `talvezAtualizar` mostra o item de uso como hoje, e o clique roda `claudeHadouken.atualizarUso` (foco 1).
- **Versão nova:** com `estadoVersao().nova = '0.5.9'`, o item de uso termina em ` $(hadouken-seta) 0.5.9`.

- [ ] **Passo 2:** rode `node --test test/extensao.test.js`. Esperado: FAIL.

- [ ] **Passo 3: implementar** em `extension.cjs`, mantendo tudo o que existe (carga, descarte, piso de 30 s):
  - `importarPainel` continua exigindo só os dois nomes antigos. A extensão guarda `api = { janela: typeof m.lerConfiguracao === 'function' && typeof m.gravarConfiguracao === 'function', versao: typeof m.estadoVersao === 'function', evento: typeof m.ultimoEvento === 'function' }`.
  - O `redesenhar` troca as barrinhas de texto que vêm do `estadoPainel` pelos segmentos de energia. Para não reformatar o texto, o `estadoPainel` ganha um campo opcional `pcts: { h5, d7, fable }`, com números ou `null`. Se ele não existir, o texto antigo fica como está.

    **Ruling:** isso pede uma mudança pequena em `src/uso/painel.js` (o `estadoPainel` devolve `pcts`), com o teste em `test/uso-painel.test.js`.
  - **Animação:**

```js
// Spec vscode §3: 5 quadros a ~120 ms quando o evento muda; uma por vez;
// nada com movimento reduzido ou painel.animarLogo false.
const QUADROS = Object.freeze(['$(hadouken-0)', '$(hadouken-1)', '$(hadouken-2)', '$(hadouken-3)', '$(hadouken-4)']);
const QUADRO_MS = 120;
const CORES = Object.freeze({ __proto__: null, calma: 'charts.blue', atencao: 'charts.yellow', urgente: 'charts.red' });
const corDaUrgencia = (u) => CORES[u] ?? CORES.calma;
function movimentoReduzido() {
  try {
    const v = vscode.workspace.getConfiguration('workbench').get('reduceMotion');
    return v === 'on'; // 'auto' segue o sistema, que a extensão não lê: anima (ruling: o webview respeita prefers-reduced-motion por CSS)
  } catch {
    return false;
  }
}
```

    O estado guarda `ultimoEm` e `animando`. A cada tique de 5 s, lê `m.ultimoEvento()`:
    - se `em !== ultimoEm`, guarda o novo `em`;
    - se não estiver animando e for permitido, roda os quadros 1, 2, 3, 4 e 0 com `setTimeout` encadeado e põe `animando = false` no fim;
    - a cor vem do `nivel` do `estadoPainel` (`aviso` → `atencao`, `erro` → `urgente`, o resto → `calma`).

    **Ruling:** com `reduceMotion: 'auto'`, a extensão anima. A API do VS Code não expõe a preferência do sistema para a extensão; o webview respeita `prefers-reduced-motion` pelo CSS. Registre isso no ledger.
  - **Primeiro tique:** só grava o `ultimoEm`, sem animar, para a janela não animar ao abrir o VS Code.
- [ ] **Passo 4:** rode `node --test test/extensao.test.js test/uso-painel.test.js test/painel-vsix.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: logo animada e segmentos de energia na barra do VS Code' vscode/extension.cjs src/uso/painel.js test/vscode-falso.cjs test/extensao.test.js test/uso-painel.test.js`

---

### Task 10: a janela

**Arquivos:**
- Criar: `vscode/janela/index.html`, `vscode/janela/janela.css`, `vscode/janela/janela.js`, `vscode/janela/bola.svg`
- Modificar: `vscode/extension.cjs` (o comando `claudeHadouken.abrirJanela`, a montagem do HTML e o tratamento das mensagens)
- Teste: `test/janela.test.js`, mais casos em `test/extensao.test.js`

**Interfaces:**
- Consome: a API da Task 7.
- Produz: as mensagens.
  - **Da janela para a extensão** (lista fechada):
    - `{ tipo: 'pronto' }`;
    - `{ tipo: 'salvar', mudancas, versao }`;
    - `{ tipo: 'voltarPadrao', ids, versao }`;
    - `{ tipo: 'desfazer' }`;
    - `{ tipo: 'atualizarUso' }`;
    - `{ tipo: 'atualizarHadouken' }`;
    - `{ tipo: 'ligarAprendizado' }`;
    - `{ tipo: 'desligarAprendizado' }`.
  - **Da extensão para a janela:**
    - `{ tipo: 'estado', painel: { pcts, texto, nivel, dica }, config: lerConfiguracao(), versaoNova, roteamento, movimentoReduzido }`;
    - `{ tipo: 'salvo', desfazerAte }`;
    - `{ tipo: 'recusado', motivo, erros?, config? }`.
  - O token de desfazer fica **na extensão**, nunca na página.

- [ ] **Passo 1: testes que falham.**

`test/janela.test.js` lê os arquivos de `vscode/janela/` como texto e confere:
- o `index.html` tem `<meta http-equiv="Content-Security-Policy"` com os marcadores `{{csp}}` e `{{nonce}}`, e nenhum `http://` ou `https://`;
- nenhum `innerHTML`, `outerHTML`, `insertAdjacentHTML` ou `eval` no `janela.js`;
- o `janela.css` tem `@media (prefers-reduced-motion: reduce)` zerando as animações e transições, e as classes `vscode-high-contrast` e `vscode-high-contrast-light` usando as variáveis `--vscode-*`;
- **contraste dos tokens:** uma função de luminância relativa (WCAG) no próprio teste confere `#E6F7FF` sobre `#111A2E` e `#38BDF8` sobre `#111A2E`, os dois com 4,5 ou mais. O `#2563EB` não aparece em nenhuma regra `color:`, só em `background`, `border` e `fill`.

Em `test/extensao.test.js`, os casos da janela:
- dois `abrirJanela` resultam em um `createWebviewPanel` e um `reveal`;
- o HTML final tem o nonce trocado (24 caracteres ou mais em base64) e a CSP exata da spec §4.4;
- `localResourceRoots` contém só `janela/` e `icones/`;
- **mensagens:**
  - `{ tipo: 'xyz' }`, `null`, uma string ou `{ tipo: 'salvar', mudancas: { 'nao.existe': 1 } }` não chamam o `gravarConfiguracao`. O último deles devolve `recusado`;
  - um `salvar` válido chama o `gravarConfiguracao` com a `versao`;
  - a resposta `mudou` vira `recusado` com a `config` nova (foco 2);
  - `atualizarHadouken` cria o terminal "hadouken" com `shellPath: 'powershell.exe'` no win32 e envia exatamente `comandoAtualizar('win32').texto`;
  - um segundo `atualizarHadouken`, com o terminal vivo, só chama `show`;
- o `movimentoReduzido` vai no `estado`.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.

- [ ] **Passo 3: implementar.**

`index.html`, a estrutura exata:

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{{csp}}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="{{css}}">
<title>hadouken</title>
</head>
<body>
<header class="cabecalho"><img class="bola" src="{{bola}}" alt="" aria-hidden="true"><h1>hadouken <span id="versao"></span></h1></header>
<section aria-labelledby="t-uso"><h2 id="t-uso">Uso</h2><div id="feixes"></div><button id="atualizar-uso" type="button">Atualizar uso agora</button></section>
<section id="faixa-versao" hidden><p id="texto-versao"></p><button id="atualizar-hadouken" type="button">Atualizar</button></section>
<section aria-labelledby="t-config"><h2 id="t-config">Configuração</h2>
  <div role="tablist" aria-label="Grupos de configuração" id="abas"></div>
  <div id="paineis"></div>
  <div class="acoes"><button id="padrao" type="button">Voltar ao padrão</button><button id="salvar" type="button" aria-describedby="motivo-salvar">Salvar</button><span id="motivo-salvar"></span></div>
  <div id="desfazer-barra" role="status" aria-live="polite" hidden><span>Salvo.</span> <button id="desfazer" type="button">Desfazer</button></div>
</section>
<script nonce="{{nonce}}" src="{{js}}"></script>
</body>
</html>
```

`janela.js` monta tudo com `document.createElement` e `textContent`, nada como HTML:
- **Abas:**
  - os botões das abas têm `role="tab"`, `aria-selected`, `aria-controls` e `tabindex` 0 ou -1;
  - as setas esquerda e direita trocam de aba, e Home/End vão à primeira e à última;
  - cada painel tem `role="tabpanel"`.
- **Campos:**
  - cada item inteiro é um `<input type="number" min max step="1">`, com `<label>` contendo o rótulo e a unidade, e uma dica "padrão N · faixa A–B";
  - o `min` do vermelho acompanha o valor do amarelo, e o `max` do amarelo acompanha o do vermelho;
  - os booleanos são `<button role="switch" aria-checked>`.
- **Validação:** só no `blur`. O erro é escrito num `<p id="erro-<id>">`, com `aria-invalid` e `aria-describedby` no campo.
- **Salvar:**
  - fica desligado (`disabled`), com o motivo em `#motivo-salvar`: "Nada mudou" ou "<rótulo> fora da faixa A–B";
  - durante a gravação, recebe a classe `carregando`.
- **Afrouxar:** um campo mais frouxo que o efetivo mostra, na linha, "Mais frouxo que o atual. Vale na hora e desfaz o aperto do aprendizado neste item.".
- **Rascunho:** fica em `vscode.setState({ rascunho, aba })` e é restaurado com `getState()`.
- **Desfazer:** a barra fica 15 s.
- **Efeitos:**
  - a classe `disparo` vai na bola ao abrir e quando o salvamento dá certo;
  - a classe `acende` vai no feixe cujo número mudou;
  - os dois só se aplicam se `!estado.movimentoReduzido && !matchMedia('(prefers-reduced-motion: reduce)').matches`.
- **Aba Aprendizado:** o switch "Aprendizado ligado" manda `ligarAprendizado` ou `desligarAprendizado`, e a lista de apertos sai de `config.itens[].aperto`.
- **Aba Roteamento:** os quatro switches de `roteamento.*` e a tabela do resumo de 7 dias (agente, despachos, negados, retrabalho), ou "Sem dados de roteamento ainda." quando o resumo for `null`.

`janela.css`, com o estilo 8 bits da spec §4.5:
- `@font-face { font-family: 'Pixel'; src: url('{{fonte}}') format('woff2'); }`;
  - a fonte é a Press Start 2P (OFL), baixada **uma vez no desenvolvimento** de `https://github.com/google/fonts/tree/main/ofl/pressstart2p` e salva como `vscode/janela/pixel.woff2`, com o `OFL.txt` ao lado;
  - o marcador `{{fonte}}` é trocado pelo `asWebviewUri`;
  - a fonte vale **só** em `h1`, `h2`, `button`, `[role=tab]` e `.numero-grande`. O corpo usa `var(--vscode-font-family)`.
- Bordas em degraus com `box-shadow` duro, sem desfoque (ex.: `4px 0 0 0 #000, -4px 0 0 0 #000, 0 4px 0 0 #000, 0 -4px 0 0 #000`).
- Feixes em blocos: `background: repeating-linear-gradient(90deg, var(--feixe-de) 0 6px, transparent 6px 8px)`.
- Animações com `steps(4)` ou `steps(5)`.
- `.bola { image-rendering: pixelated; }`.
- Linhas de varredura opcionais só no `.cabecalho::after`, com no máximo 6% de opacidade, removidas com movimento reduzido e com alto contraste.
- O teste da janela também confere:
  - o `font-family: 'Pixel'` não aparece em `body`, `label`, `p` nem nas regras de erro;
  - as `@keyframes` só são usadas com `steps(`;
  - o `pixel.woff2` e o `OFL.txt` existem.
- O regex de extras do `.vsix` (Task 8) passa a aceitar `janela/pixel.woff2` e `janela/OFL.txt`.
- tokens em `:root`: `--fundo:#111A2E`, `--texto:#E6F7FF`, `--destaque:#38BDF8`, `--feixe-de:#2563EB`, `--feixe-ate:#38BDF8`, `--atencao:#FACC15`, `--urgente:#F87171`;
- foco com `outline: 2px solid var(--destaque); outline-offset: 2px`;
- `@keyframes disparo` (bola) e `acende` (feixe), de 600 ms no máximo;
- o bloco de movimento reduzido e o bloco de alto contraste, conferidos pelo teste.

`extension.cjs`:
- `abrirJanela` cria o painel com `{ enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [Uri.joinPath(ext, 'janela'), Uri.joinPath(ext, 'icones')] }`;
- o nonce é `crypto.randomBytes(18).toString('base64')`;
- substitui os marcadores com `asWebviewUri`;
- o `onDidReceiveMessage` passa por `mensagemValida(msg)`. A forma exigida é:
  - `tipo` na lista;
  - `mudancas` como objeto simples com no máximo 40 chaves, cada chave em `/^[a-zA-Z0-9.]{1,60}$/` e cada valor inteiro ou booleano;
  - `ids` como array de no máximo 40 dessas chaves;
  - `versao` em `/^([0-9a-f]{16}|ausente)$/`.
- Depois de cada `salvo`, guarda o token por 15 s.
- Manda o `estado` a cada tique enquanto o painel estiver visível.
- [ ] **Passo 4:** rode `node --test test/janela.test.js test/extensao.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: janela do hadouken no VS Code' vscode/janela vscode/extension.cjs test/janela.test.js test/extensao.test.js`

---

### Task 11: o aviso de versão nova na extensão

**Arquivos:**
- Modificar: `vscode/extension.cjs`
- Teste: casos em `test/extensao.test.js`

**Interfaces:**
- Consome: `talvezConsultarVersao`, `estadoVersao` e `comandoAtualizar` (Tasks 6 e 7).
- Produz: a chave `claudeHadouken.versaoAvisada` em `ctx.globalState`.

- [ ] **Passo 1: testes que falham.**
- O tique chama `talvezConsultarVersao({})`, no máximo uma vez a cada 10 minutos por janela. A função decide as 6 h; isso só evita uma chamada a cada 5 s.
- Com `nova: '0.5.9'`:
  - aparece uma `showInformationMessage('hadouken 0.5.9 disponível', 'Atualizar', 'Depois')`;
  - o `globalState` fica com `'0.5.9'`;
  - o tique seguinte não mostra de novo;
  - uma versão `'0.6.0'` mostra de novo.
- "Atualizar" na notificação cria o terminal com o comando fixo, igual à mensagem `atualizarHadouken`.
- "Depois" só grava a versão avisada: a marca no item continua.
- Sem a API de versão no shim (plugin velho), não chama nada e não lança.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.** Use uma função só, `abrirTerminalAtualizar()`, tanto para a notificação quanto para a janela:
  - guarda o terminal e confere `exitStatus === undefined` para saber se ele está vivo;
  - no win32, cria com `shellPath: 'powershell.exe'`; nos outros, sem `shellPath`;
  - envia `comandoAtualizar(process.platform).texto`.
- [ ] **Passo 4:** rode `node --test test/extensao.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: notificação de versão nova com Atualizar' vscode/extension.cjs test/extensao.test.js`

---

### Task 12: o aprendizado ligado por padrão nos instaladores

**Arquivos:**
- Modificar: `src/instalar-tudo.js:34-42` e `:167-185` (`passoAprendizado`), `install.sh:95-96`, `install.ps1:19` e `:170`
- Teste: casos em `test/instalar-tudo.test.js`, `test/instalar-sh.test.js` e `test/instalar-ps1.test.js`

**Interfaces:**
- Produz:
  - a opção `--sem-aprender` (`semAprender`);
  - `--com-aprendizado` continua aceita e passa a não fazer nada, para quem tem o comando antigo salvo;
  - o marcador `<dir>/aprendizado-desligado-pelo-usuario`, gravado na Task 7.

- [ ] **Passo 1: testes que falham.**
- **Primeira instalação:** sem as opções, com o `aprendizado` falso injetado, chama `ligar` sem perguntar. O resumo tem `aprendizado: ligado (desligue na janela ou com --sem-aprender)`.
- **Usuário que desligou:** com o marcador presente, não liga, e o resumo diz `desligado por você; para ligar, na janela ou /hadouken:aprender ligar`.
- **`--sem-aprender`:** não liga.
- **Falha ao ligar:** com `ligar` devolvendo `{ ok: false, motivo: 'download' }`, o item sai como `falhou`, com o motivo e o conserto, e o código de saída final não muda (compare com o teste atual de "extras falhou").
- **Scripts:** `install.sh` aceita `--sem-aprender`, o `install.ps1` aceita `-SemAprender`, e a mensagem de opção desconhecida lista as opções novas.
- **Textos:** nenhum texto do instalador diz mais "(opcional)" para o aprendizado.

- [ ] **Passo 2:** rode os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar.** Em `passoAprendizado`:
  - `quer = !opcoes.semAprender && !marcadorExiste(dir)`;
  - o `perguntar` e o `CUSTO_APRENDIZADO` saem desse passo. Mantenha a constante se outro lugar a usar (confira com Grep).
- [ ] **Passo 4:** rode `node --test test/instalar-*.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'feat: aprendizado ligado por padrão na instalação' src/instalar-tudo.js install.sh install.ps1 test/instalar-tudo.test.js test/instalar-sh.test.js test/instalar-ps1.test.js`

---

### Task 13: o README curto e a wiki

**Arquivos:**
- Criar:
  - `wiki/Home.md`, `wiki/_Sidebar.md`, e as irmãs em inglês `wiki/Home-en.md` e `wiki/_Sidebar-en.md`;
  - 11 páginas em português, cada uma com a irmã em inglês:

    | Página em português | Irmã em inglês |
    |---|---|
    | `Barra-de-status.md` | `Status-bar.md` |
    | `Painel-e-janela-do-VS-Code.md` | `VS-Code-panel-and-window.md` |
    | `Avisos-e-alertas.md` | `Warnings-and-alerts.md` |
    | `Guarda-de-consumo.md` | `Usage-guard.md` |
    | `Relatorio-de-consumo.md` | `Usage-report.md` |
    | `Aprendizado.md` | `Learning.md` |
    | `Limites.md` | `Limits.md` |
    | `Kit.md` | `Kit-en.md` |
    | `REA.md` | `REA-en.md` |
    | `Comandos.md` | `Commands.md` |
    | `Problemas-comuns.md` | `Troubleshooting.md` |

  - `wiki/pares.json`, o mapa entre cada página em português e a irmã em inglês, usado pelo teste;
  - `scripts/publicar-wiki.sh`.
- Modificar: `README.md`, `README.en.md` e os testes que leem o README: `kit-readme`, `kit-atualizar`, `renome`, `guarda-caminho`, `guarda-caminho-extra`, `guarda-p5-extra` e `kit-robo-simulado`.
- Teste: `test/wiki.test.js`

- [ ] **Passo 1: teste que falha**, com os critérios (a), (b) e (c) da spec §8:
- todo link `https://github.com/Garioli-Labs/claude-hadouken/wiki/<Página>` do README tem `wiki/<Página>.md`;
- toda página em `pares.json` tem a irmã existente, e toda página `.md` de `wiki/`, menos `pares.json`, aparece no mapa;
- cada README tem 60 linhas ou menos, contém `[!IMPORTANT]` e os dois comandos de `comandoAtualizar` (`win32` e `linux`), contém a licença e contém os requisitos "Node 20" e "2.1.251";
- nenhuma página em português perdeu seção. Antes de mudar o README, o teste grava em `test/fixtures/readme-secoes.json` a lista dos títulos `##` e `###` do README de hoje. Cada título tem que aparecer em alguma página de `wiki/`, ou no README novo.

- [ ] **Passo 2:** gere a fixture a partir do README atual, antes de editá-lo, e rode o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **Conteúdo das páginas:** vem do README de hoje, cortado por assunto, mais as novidades: a janela, o `/hadouken:limites`, o aprendizado por padrão, o roteamento (na página Guarda de consumo) e a versão nova.
  - **README novo:** segue os 7 itens da spec §8. A imagem fica como `assets/barra-e-janela.png`; se ainda não existir captura, use `assets/icone.svg` e registre a captura como pendência no ledger.
  - **Testes que liam o README:** passam a ler a página da wiki equivalente. Faça uma troca por teste, conferindo o texto que cada um busca.
  - **`scripts/publicar-wiki.sh`:**
    - `set -euo pipefail`;
    - clona `https://github.com/Garioli-Labs/claude-hadouken.wiki.git` para uma pasta temporária e copia `wiki/*.md`, sem o `pares.json`;
    - `git add -A`, depois o commit "docs: wiki da v<versão>" e o `git push`;
    - antes de tudo, pede a confirmação digitada `publicar`.

    **O executor não roda esse script:** publicar exige a autorização do Sr. Garioli (spec §8).
- [ ] **Passo 4:** rode `node --test test/wiki.test.js test/kit-*.test.js test/renome*.test.js test/guarda-caminho*.test.js test/guarda-p5-extra.test.js`. Esperado: PASS.
- [ ] **Passo 5:** `commit.sh 'docs: README curto e fonte da wiki' README.md README.en.md wiki scripts/publicar-wiki.sh test`

---

### Task 14: versão 0.5.3, notas e suíte

**Arquivos:**
- Modificar: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (se tiver a versão), `CHANGELOG.md` (ou o arquivo de notas que o repositório usa; confira com Glob)

- [ ] **Versão:** sobe a versão para `0.5.3` em todos os lugares que o teste de versão confere (procure com Grep `0.5.2` fora de `docs/` e do CHANGELOG).
- [ ] **CHANGELOG:** escreva a entrada 0.5.3 com as duas partes, roteamento e VS Code, em linguagem de usuário.
- [ ] **Suíte:** rode `suite.sh`. Esperado: `ℹ fail 0`.
- [ ] **Validação:** rode `claude plugin validate .`. Esperado: sem erro.
- [ ] **Montagem do `.vsix`:** monte o `.vsix` pelo próprio teste de instalação e confira que ele lista os arquivos `extension/janela/*` e `extension/icones/hadouken.woff`.
- [ ] **Commit:** apague `Microsoft/` e faça `commit.sh 'chore: versão 0.5.3' .claude-plugin CHANGELOG.md`.
- **Fica com o Sr. Garioli:** o merge, a tag, o release e a publicação da wiki, cada um com uma autorização separada.

### Task 15: falso positivo do caminho e interruptores de proteção (Emenda 3, spec §12; executar antes da Task 13)

**Arquivos:**
- **Criar:** `src/guarda/protecoes.js`.
- **Mudar:**
  - `src/guarda/caminho.js`;
  - os hooks `src/hooks/guarda-filha.js`, `guarda-arquivos.js`, `guarda-config.js` e `guarda-agenda.js`;
  - `src/config/tabela.js` e `src/config/pedido.js`;
  - `vscode/janela/janela.js`.
- **Testes:**
  - `test/guarda-caminho.test.js` (ou um arquivo novo, `test/guarda-cwd.test.js`);
  - `test/protecoes.test.js`;
  - os testes de config e de janela que listam os grupos.

- [ ] **Teste falhando, caminho.** Estes casos ainda não passam:
  - `chamaClaude('node "C:/Projetos DEV/Claude Hadouken/claude-hadouken/x.mjs"', {cwd})` deve dar `false`;
  - o mesmo vale com `\`, com `/c/projetos dev/...` e com o comando em maiúsculas;
  - `claudeComLiberar('node "<cwd>/x.mjs" $HOME', {cwd})` deve dar `false`.

  Estes já passam e precisam continuar passando:
  - `chamaClaude('"<cwd>/claude.exe" -p', {cwd})` dá `true`;
  - `chamaClaude('C:/x/claude -p', {cwd:'C:/x/claude'})` dá `true`;
  - um `cwd` raiz ou relativo não neutraliza nada;
  - sem `cwd`, o comportamento é o de antes.
- [ ] **Implementação, caminho.** Crie `semCwd(comando, cwd)` e chame-o no começo de `chamaClaude` e de `claudeComLiberar` quando o segundo argumento trouxer `cwd`. Em seguida, `guarda-filha.js` passa `{ cwd: entrada.cwd }`.
- [ ] **Teste falhando, interruptores.** Os casos:
  - `protecaoLigada(dir, id)` dá `true` sem `config.json`, com o arquivo ilegível ou com um item ausente;
  - dá `false` quando o item está gravado como `false`.

  Os hooks, rodados como processo com `HADOUKEN_DATA_DIR` de teste e o item desligado, não emitem deny nos casos que hoje negam:
  - P4 com o texto do liberar;
  - P5 num arquivo do dir de dados;
  - ConfigChange;
  - CronCreate com `/hadouken:liberar`.
- [ ] **Implementação, interruptores.**
  - Inclua os itens na tabela, num grupo novo `protecoes`, e o grupo em `GRUPOS_LIMITES`.
  - Cada hook verifica o seu item antes de qualquer outra coisa (ou logo depois de resolver o `dir`).
- [ ] **Janela.** Crie a aba `['protecoes', 'Proteções']`, com switches de rascunho e, sob cada um, uma linha `consequencia`. Inclua o teste em `test/janela.test.js` ou em `test/extensao.test.js`.
- [ ] **Testes leves:** `tn.sh` com os arquivos tocados.
- [ ] **Commit:** `fecha.sh vsc 15 ...`.

---

## Autorrevisão (feita)

- **Cobertura da spec:**
  - §2.1 → Tasks 1, 2, 5 e 6;
  - §2.2 → Task 7;
  - §3 → Tasks 8 e 9;
  - §4 → Task 10;
  - §5 → Tasks 6 e 11;
  - §6 → Task 4;
  - §7 → Tasks 7 e 12;
  - §8 → Task 13;
  - a chave nova `formato` e `alerta` → Task 3;
  - §10 → os testes de cada tarefa.
- **O minor 8 da v0.5.2** (linha do painel repetida para quem não tem VS Code) **não foi absorvido.** Ele continua adiado e é citado aqui para não se perder.
- **Consistência de nomes:**
  - `lerConfiguracao`, `validar` e `gravarConfiguracao` (Tasks 1 e 2) são usados nas Tasks 4, 7 e 10;
  - `registrarEvento` e `ultimoEvento` (Task 5) são usados nas Tasks 7 e 9;
  - `comandoAtualizar` (Task 6) é usado nas Tasks 10, 11 e 13;
  - `soltarAperto` (Task 2).
- **Rulings que o executor precisa registrar:**
  - o `pcts` no `estadoPainel` (Task 9);
  - o `reduceMotion: 'auto'` (Task 9);
  - a fonte gerada com `npx`, e a alternativa com codicons (Task 8);
  - a extração do portão do `liberar` (Task 4);
  - `valorDoItem` com `null` (Task 2);
  - a captura da imagem do README (Task 13).
- **Dependência entre os planos:** a aba Roteamento (Task 10) e o `resumoRoteamento7d` (Task 7) precisam das Tasks 3 e 11 do plano de roteamento. Execute o plano de roteamento **antes** deste, ou deixe a aba mostrando "Sem dados de roteamento ainda." até lá.
