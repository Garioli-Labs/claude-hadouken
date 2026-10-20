import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerTrecho } from '../src/roteamento/trecho.js';

// Task 7 do plano do roteamento: o fim do transcript vira Resposta[] sem
// texto de comando nem de arquivo (só hashes). Transcript sintético.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk trecho ç '));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const T0 = Date.parse('2026-10-19T10:00:00.000Z');
const linhas350 = Array.from({ length: 350 }, (_, i) => `${String(i + 1).padStart(6)}→linha ${i}`).join('\n');

// Uma volta: a resposta do assistente (Read, Edit, Bash, thinking) e a linha
// do usuário com os tool_result.
function volta(i, { erro = false } = {}) {
  const id = `msg_${i}`;
  const ts = new Date(T0 + i * 1000).toISOString();
  const a = {
    type: 'assistant', timestamp: ts, message: { id, role: 'assistant', content: [
      { type: 'thinking', thinking: 'x'.repeat(5000) },
      { type: 'tool_use', id: `r${i}`, name: 'Read', input: { file_path: '/p/a.js' } },
      { type: 'tool_use', id: `e${i}`, name: 'Edit', input: { file_path: '/p/a.js', old_string: 'a\nb\nc', new_string: '1\n2\n3\n4\n5' } },
      { type: 'tool_use', id: `b${i}`, name: 'Bash', input: { command: 'rm -rf /tmp/x' } },
    ], usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } },
  };
  const u = {
    type: 'user', timestamp: ts, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: `b${i}`, content: 'y'.repeat(40_000), is_error: erro },
      { type: 'tool_result', tool_use_id: `r${i}`, content: [{ type: 'text', text: linhas350 }] },
      { type: 'tool_result', tool_use_id: `e${i}`, content: 'ok' },
    ] },
  };
  return [JSON.stringify(a), JSON.stringify(u)];
}

function gravar(nome, linhas, fim = '\n') {
  const f = path.join(dir, nome);
  fs.writeFileSync(f, linhas.join('\n') + fim);
  return f;
}

test('20 voltas viram as 15 últimas, em ordem, com os campos do contrato', async () => {
  const ls = [];
  for (let i = 0; i < 20; i++) ls.push(...volta(i, { erro: i === 19 }));
  ls.splice(3, 0, JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: new Date(T0).toISOString(), message: { id: 'sub', content: [] } }));
  ls.splice(5, 0, '{"type":"assistant","quebr');
  ls.push('{"type":"assistant","parcial":');
  const f = gravar('t.jsonl', ls, '');
  const rs = await lerTrecho(f);
  assert.equal(rs.length, 15);
  assert.equal(rs[0].em, T0 + 5000);
  assert.equal(rs[14].em, T0 + 19_000);
  const r = rs[14];
  assert.equal(r.pensamento, 5000);
  assert.deepEqual(r.usage, { entrada: 10, cacheLido: 1000, cacheCriado: 50 });
  const [ler, edit, bash] = r.ferramentas;
  assert.equal(ler.nome, 'Read');
  assert.equal(ler.leituraInteira, true);
  assert.equal(edit.linhasMudadas, 5);
  assert.equal(edit.leituraInteira, false);
  assert.match(ler.arquivoHash, /^[0-9a-f]{12}$/);
  assert.equal(ler.arquivoHash, edit.arquivoHash);
  const rb = r.resultados.find((x) => x.nome === 'Bash');
  assert.ok(rb.bytes >= 40_000);
  assert.equal(rb.falhou, true);
  assert.match(rb.comandoHash, /^[0-9a-f]{12}$/);
  assert.equal(rb.comandoHash, rs[0].resultados.find((x) => x.nome === 'Bash').comandoHash);
  assert.equal(rs[0].resultados.find((x) => x.nome === 'Bash').falhou, false);
  assert.equal(r.resultados.find((x) => x.nome === 'Read').linhasLidas, 350);
  assert.ok(!JSON.stringify(rs).includes('rm -rf'));
  assert.ok(!JSON.stringify(rs).includes('/p/a.js'));
});

test('linhas seguidas do mesmo message.id juntam-se numa resposta', async () => {
  const ts = new Date(T0).toISOString();
  const parte = (c) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id: 'm1', content: [c] } });
  const f = gravar('juntar.jsonl', ['{}', parte({ type: 'thinking', thinking: 'abc' }),
    parte({ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: '/q', content: 'a\nb\nc\nd' } })]);
  const rs = await lerTrecho(f);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].pensamento, 3);
  assert.equal(rs[0].ferramentas[0].linhasMudadas, 4);
  assert.equal(rs[0].usage, null);
});

test('exit code diferente de 0 no texto conta como falha; Read com offset não é inteira', async () => {
  const ts = new Date(T0).toISOString();
  const f = gravar('falha.jsonl', ['{}',
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { id: 'm', content: [
      { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'true' } },
      { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x', offset: 10 } }] } }),
    JSON.stringify({ type: 'user', timestamp: ts, message: { content: [
      { type: 'tool_result', tool_use_id: 'b', content: 'falhou\nExit code 1' },
      { type: 'tool_result', tool_use_id: 'c', content: 'Exit code 0' }] } })]);
  const [r] = await lerTrecho(f);
  assert.equal(r.resultados.find((x) => x.comandoHash && x.falhou).nome, 'Bash');
  assert.equal(r.resultados.filter((x) => x.falhou).length, 1);
  assert.equal(r.ferramentas[2].leituraInteira, false);
});

// Ruling do pré-voo: a Task 8 precisa de `reverte` (Edit cujo old_string é o
// new_string de um Edit anterior no mesmo arquivo), então ele nasce aqui.
test('reverte: Edit que desfaz o Edit anterior no mesmo arquivo', async () => {
  const ts = (i) => new Date(T0 + i).toISOString();
  const edit = (i, arq, de, para) => JSON.stringify({ type: 'assistant', timestamp: ts(i), message: { id: `m${i}`, content: [
    { type: 'tool_use', id: `e${i}`, name: 'Edit', input: { file_path: arq, old_string: de, new_string: para } }] } });
  const f = gravar('reverte.jsonl', ['{}', edit(1, '/a', 'x', 'y'), edit(2, '/b', 'y', 'x'), edit(3, '/a', 'y', 'x')]);
  const rs = await lerTrecho(f);
  assert.deepEqual(rs.map((r) => r.ferramentas[0].reverte), [false, false, true]);
});

test('ausente, pasta ou link devolvem [] sem lançar', async () => {
  assert.deepEqual(await lerTrecho(path.join(dir, 'nao-existe.jsonl')), []);
  assert.deepEqual(await lerTrecho(dir), []);
  assert.deepEqual(await lerTrecho(null), []);
  const alvo = gravar('alvo.jsonl', ['{}', ...volta(0), '']);
  const link = path.join(dir, 'link.jsonl');
  let criou = true;
  try { fs.symlinkSync(alvo, link); } catch { criou = false; }
  if (criou) assert.deepEqual(await lerTrecho(link), []);
});

test('5 MB: lê só os últimos 2 MB, em menos de 300 ms', async () => {
  const ls = [];
  for (let i = 0; i < 120; i++) ls.push(...volta(i));
  const f = gravar('grande.jsonl', ls);
  const tamanho = fs.statSync(f).size;
  assert.ok(tamanho > 5 * 1024 * 1024, `${tamanho}`);
  const t = performance.now();
  const rs = await lerTrecho(f, { respostas: 1000 });
  const ms = performance.now() - t;
  assert.ok(ms < 300, `${ms} ms`);
  // Cada volta tem ~46 KB: 2 MB cabem umas 45, nunca as 120.
  assert.ok(rs.length > 30 && rs.length < 60, `${rs.length}`);
  assert.equal(rs.at(-1).em, T0 + 119_000);
  assert.ok(rs[0].em > T0 + 50_000);
});
