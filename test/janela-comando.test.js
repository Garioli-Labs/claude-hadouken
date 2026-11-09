import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerArgsJanela, gravarJanela, descreverJanela, validarJanela } from '../src/janela.js';

// Tarefa 4 da v0.6.0 (spec §4 "Fatia 2", histórias 13, 16, 17 e 19): o comando
// /hadouken:janela mostra, grava e remove a chave `janela` do config.json pelo
// mesmo UserPromptExpansion dos outros comandos digitados. O nome não é
// janela.test.js (janela do VS Code) nem janela-trabalho.test.js (cálculo da T3).

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'src', 'hooks', 'janela.js');
const SEG_SEX = { dias: ['seg', 'ter', 'qua', 'qui', 'sex'], inicio: '09:00', fim: '21:00' };

const dirs = [];
function novoHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-janela-cmd-'));
  dirs.push(d);
  return d;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// O filho recebe HADOUKEN_HOME temporário: nunca o ~/.claude/hadouken de verdade.
function rodar(args, home, { extra = {}, entrada = {} } = {}) {
  assert.ok(path.isAbsolute(home) && home.startsWith(os.tmpdir()), `HADOUKEN_HOME fora do temporário: ${home}`);
  const env = { ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, CLAUDE_CODE_ENTRYPOINT: 'cli', ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const stdin = {
    session_id: 's1', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command',
    command_name: 'hadouken:janela', command_args: args, command_source: 'plugin', prompt: `/hadouken:janela ${args}`,
    ...entrada,
  };
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(stdin), env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout === '' ? null : JSON.parse(r.stdout);
}

const arqConfig = (home) => path.join(home, 'config.json');
const lerConfig = (home) => JSON.parse(fs.readFileSync(arqConfig(home), 'utf8'));
const bloqueio = (saida) => {
  assert.ok(saida !== null, 'sem saída do hook');
  assert.equal(saida.decision, 'block');
  assert.equal(typeof saida.reason, 'string');
  return saida.reason;
};

test('seg-sex 9-21 grava a janela normalizada, preserva a guarda e responde a descrição', () => {
  const home = novoHome();
  fs.writeFileSync(arqConfig(home), JSON.stringify({ guarda: { ligada: false } }));
  const reason = bloqueio(rodar('seg-sex 9-21', home));
  assert.ok(reason.includes('seg–sex 09:00–21:00'), reason);
  assert.deepEqual(lerConfig(home).janela, { dias: ['seg', 'ter', 'qua', 'qui', 'sex'], inicio: '09:00', fim: '21:00' });
  assert.deepEqual(lerConfig(home).guarda, { ligada: false });
});

test('seg,qua,sex 08:30-18:00 grava os três dias e os minutos', () => {
  const home = novoHome();
  const reason = bloqueio(rodar('seg,qua,sex 08:30-18:00', home));
  assert.ok(reason.includes('08:30–18:00'), reason);
  assert.deepEqual(lerConfig(home).janela, { dias: ['seg', 'qua', 'sex'], inicio: '08:30', fim: '18:00' });
});

test('sem argumento: mostra a janela gravada; sem janela, diz que o ritmo é de 168 h', () => {
  const home = novoHome();
  assert.ok(bloqueio(rodar('', home)).includes('sem janela: ritmo em 168 h'));
  fs.writeFileSync(arqConfig(home), JSON.stringify({ janela: SEG_SEX }));
  const antes = fs.readFileSync(arqConfig(home), 'utf8');
  assert.ok(bloqueio(rodar('', home)).includes('seg–sex 09:00–21:00'));
  assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), antes);
});

test('off remove só a chave janela', () => {
  const home = novoHome();
  fs.writeFileSync(arqConfig(home), JSON.stringify({ guarda: { ligada: true }, janela: SEG_SEX }));
  const reason = bloqueio(rodar('off', home));
  assert.ok(reason.includes('168 h'), reason);
  assert.deepEqual(lerConfig(home), { guarda: { ligada: true } });
});

test('off sem config.json não cria arquivo', () => {
  const home = novoHome();
  bloqueio(rodar('off', home));
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

for (const args of ['22-6', 'sex-seg 9-21', 'seg-sex 9-9', 'seg-sex 25-26', 'xyz 9-21', 'seg-sex', 'seg-sex 9-21 extra']) {
  test(`janela inválida (${args}) avisa e deixa o config.json byte a byte igual`, () => {
    const home = novoHome();
    const original = JSON.stringify({ guarda: { ligada: true }, janela: SEG_SEX }, null, 2);
    fs.writeFileSync(arqConfig(home), original);
    const reason = bloqueio(rodar(args, home));
    assert.ok(reason.includes('janela inválida'), reason);
    assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), original);
  });
}

test('config.json ilegível nunca é sobrescrito', () => {
  const home = novoHome();
  fs.writeFileSync(arqConfig(home), '{ não é json');
  const reason = bloqueio(rodar('seg-sex 9-21', home));
  assert.ok(reason.includes('nada mudado'), reason);
  assert.equal(fs.readFileSync(arqConfig(home), 'utf8'), '{ não é json');
});

test('recusa -p/SDK e origem que não é o comando digitado, sem gravar', () => {
  const home = novoHome();
  const sdk = bloqueio(rodar('seg-sex 9-21', home, { extra: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }));
  assert.ok(sdk.includes('nada mudado'), sdk);
  const origem = bloqueio(rodar('seg-sex 9-21', home, { entrada: { command_source: 'skill_tool' } }));
  assert.ok(origem.includes('nada mudado'), origem);
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

test('outro comando passa sem saída', () => {
  const home = novoHome();
  assert.equal(rodar('seg-sex 9-21', home, { entrada: { command_name: 'hadouken:saude' } }), null);
  assert.equal(fs.existsSync(arqConfig(home)), false);
});

test('hooks.json liga o matcher hadouken:janela ao hook, timeout 10', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
  const e = hooks.hooks.UserPromptExpansion.find((x) => x.matcher === 'hadouken:janela');
  assert.ok(e, 'sem matcher hadouken:janela');
  assert.deepEqual(e.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/src/hooks/janela.js'], timeout: 10 }]);
});

test('skill janela: sem invocação pelo modelo, com a sintaxe na descrição', () => {
  const texto = fs.readFileSync(path.join(repo, 'skills', 'janela', 'SKILL.md'), 'utf8');
  assert.match(texto, /^---\nname: janela\n/);
  assert.match(texto, /\ndisable-model-invocation: true\n/);
  assert.match(texto, /\ndescription: .*\/hadouken:janela .*seg-sex 9-21.*off/);
});

test('lerArgsJanela: as quatro ações e as formas de hora e de dia', () => {
  assert.deepEqual(lerArgsJanela(''), { acao: 'mostrar' });
  assert.deepEqual(lerArgsJanela('   '), { acao: 'mostrar' });
  assert.deepEqual(lerArgsJanela(undefined), { acao: 'mostrar' });
  assert.deepEqual(lerArgsJanela(null), { acao: 'mostrar' });
  assert.deepEqual(lerArgsJanela(' OFF '), { acao: 'remover' });
  assert.deepEqual(lerArgsJanela('seg-sex 9-21'), { acao: 'gravar', valor: SEG_SEX });
  assert.deepEqual(lerArgsJanela('seg-sex 09-21'), { acao: 'gravar', valor: SEG_SEX });
  assert.deepEqual(lerArgsJanela('SEG-SEX 9:00-21:00'), { acao: 'gravar', valor: SEG_SEX });
  assert.deepEqual(lerArgsJanela('sáb,dom 10-14'), { acao: 'gravar', valor: { dias: ['dom', 'sab'], inicio: '10:00', fim: '14:00' } });
});

test('lerArgsJanela: intervalo de dias só em ordem; hora e formato inválidos viram erro', () => {
  for (const t of ['sex-seg 9-21', 'seg-sex 22-6', 'seg-sex 9-9', 'seg-sex 9-24', 'seg-sex 9-21:60', 'seg-sex 8:5-9', 'seg-sex', '9-21', 'seg-xyz 9-21', 'seg-sex 9–21', ',seg 9-21', 42, {}]) {
    const r = lerArgsJanela(t);
    assert.equal(r.acao, 'erro', String(t));
    assert.match(r.msg, /janela inválida/);
  }
});

test('descreverJanela: faixa contínua vira a–b, dias soltos viram lista', () => {
  const d = (dias) => descreverJanela(validarJanela({ dias, inicio: '09:00', fim: '21:00' }).janela);
  assert.equal(d(['seg', 'ter', 'qua', 'qui', 'sex']), 'seg–sex 09:00–21:00');
  assert.equal(d(['seg', 'qua', 'sex']), 'seg,qua,sex 09:00–21:00');
  assert.equal(d(['sab']), 'sab 09:00–21:00');
});

test('gravarJanela: troca só a chave janela; null remove; ilegível não grava', () => {
  const dir = novoHome();
  assert.equal(gravarJanela(dir, SEG_SEX).ok, true);
  assert.deepEqual(lerConfig(dir), { janela: SEG_SEX });
  fs.writeFileSync(arqConfig(dir), JSON.stringify({ agentes: { a: 1 }, janela: SEG_SEX }));
  assert.equal(gravarJanela(dir, { dias: ['seg'], inicio: '08:00', fim: '12:00' }).ok, true);
  assert.deepEqual(lerConfig(dir), { agentes: { a: 1 }, janela: { dias: ['seg'], inicio: '08:00', fim: '12:00' } });
  assert.equal(gravarJanela(dir, null).ok, true);
  assert.deepEqual(lerConfig(dir), { agentes: { a: 1 } });
  fs.writeFileSync(arqConfig(dir), '[1]');
  assert.equal(gravarJanela(dir, SEG_SEX).ok, false);
  assert.equal(gravarJanela(null, SEG_SEX).ok, false);
  assert.equal(fs.readFileSync(arqConfig(dir), 'utf8'), '[1]');
});
