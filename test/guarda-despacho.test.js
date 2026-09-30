import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerFrontmatter, perfilDoDespacho, despachoCaro, dirConfigClaude } from '../src/guarda/despacho.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk-desp-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const cfg = path.join(tmp, 'cfg');
const proj = path.join(tmp, 'proj');
const agente = (raiz, nome, texto) => {
  fs.mkdirSync(path.join(raiz, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'agents', `${nome}.md`), texto);
};
agente(cfg, 'fable-max', '---\nname: fable-max\nmodel: fable\neffort: max\n---\ncorpo');
agente(cfg, 'opus-high', '---\nmodel: "opus"\neffort: high\n---\n');
agente(cfg, 'herda', '---\nmodel: inherit\n---\n');
agente(path.join(proj, '.claude'), 'fable-max', '---\nmodel: sonnet\neffort: low\n---\n');

const base = { cwd: proj, dirConfigClaude: cfg, env: {}, modeloSessao: 'Opus 5.5' };
const perfil = (toolInput, extra = {}) => perfilDoDespacho({ ...base, toolInput, ...extra });

test('parâmetro model vence tudo', () => {
  assert.deepEqual(perfil({ subagent_type: 'opus-high', model: 'fable' }), { modelo: 'fable', effort: 'high', origem: 'parametro' });
});

test('frontmatter do projeto vence o do usuário; o do usuário vale sem o do projeto', () => {
  assert.deepEqual(perfil({ subagent_type: 'fable-max' }), { modelo: 'outro', effort: 'low', origem: 'frontmatter' });
  assert.deepEqual(perfil({ subagent_type: 'fable-max' }, { cwd: path.join(tmp, 'outro') }), { modelo: 'fable', effort: 'max', origem: 'frontmatter' });
});

test('inherit e ausente: ambiente, depois sessão; general-purpose herda a sessão', () => {
  assert.deepEqual(perfil({ subagent_type: 'herda' }, { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-fable-5-1' } }), { modelo: 'fable', effort: null, origem: 'ambiente' });
  assert.deepEqual(perfil({ subagent_type: 'herda' }, { modeloSessao: 'Fable 5.1' }), { modelo: 'fable', effort: null, origem: 'sessao' });
  assert.deepEqual(perfil({ subagent_type: 'general-purpose' }, { modeloSessao: 'Fable 5.1', env: { CLAUDE_EFFORT: 'max' } }), { modelo: 'fable', effort: 'max', origem: 'sessao' });
});

test('agente de plugin, embutido sem modelo e nome hostil: desconhecido', () => {
  for (const t of ['plugin:revisor', 'Explore', '../../etc/passwd', 'a'.repeat(65), 7, undefined]) {
    assert.equal(perfil({ subagent_type: t }).modelo, 'desconhecido', String(t));
  }
});

test('modelo desconhecido mantém o effort calculado: max de qualquer modelo é caro (G5, D1 emendado)', () => {
  assert.deepEqual(perfil({ subagent_type: 'plugin:revisor' }, { env: { CLAUDE_EFFORT: 'max' } }), { modelo: 'desconhecido', effort: 'max', origem: 'desconhecido' });
  assert.deepEqual(perfil({ subagent_type: 'general-purpose' }, { modeloSessao: undefined, env: { CLAUDE_EFFORT: 'max' } }), { modelo: 'desconhecido', effort: 'max', origem: 'desconhecido' });
  assert.equal(despachoCaro(perfil({ subagent_type: 'Explore' }, { env: { CLAUDE_EFFORT: 'max' } })), true);
  assert.deepEqual(perfil({ subagent_type: 'Explore' }), { modelo: 'desconhecido', effort: null, origem: 'desconhecido' });
});

test('despachoCaro: max em qualquer modelo, xhigh só no Fable', () => {
  assert.equal(despachoCaro({ modelo: 'outro', effort: 'max' }), true);
  assert.equal(despachoCaro({ modelo: 'fable', effort: 'xhigh' }), true);
  assert.equal(despachoCaro({ modelo: 'outro', effort: 'xhigh' }), false);
  assert.equal(despachoCaro({ modelo: 'fable', effort: 'high' }), false);
  assert.equal(despachoCaro({ modelo: 'desconhecido', effort: null }), false);
  assert.equal(despachoCaro(null), false);
});

test('lerFrontmatter: teto de 8 KiB, sem frontmatter e link', () => {
  const grande = path.join(tmp, 'grande.md');
  fs.writeFileSync(grande, `---\nmodel: fable\n---\n${'x'.repeat(9000)}`);
  assert.equal(lerFrontmatter(grande), null);
  const sem = path.join(tmp, 'sem.md');
  fs.writeFileSync(sem, 'model: fable\n');
  assert.deepEqual(lerFrontmatter(sem), { model: null, effort: null });
  assert.equal(lerFrontmatter(path.join(tmp, 'nao-existe.md')), null);
  // Salvo no Windows: BOM e CRLF não escondem o frontmatter.
  const bom = path.join(tmp, 'bom.md');
  fs.writeFileSync(bom, `${String.fromCodePoint(0xfeff)}---\r\nmodel: fable # comentário\r\neffort: 'xhigh'\r\n---\r\n`);
  assert.deepEqual(lerFrontmatter(bom), { model: 'fable', effort: 'xhigh' });
});

// M7 da revisão final da parte 1: o teto vale na leitura, não só no lstat.
// Um .md trocado por um arquivo grande entre o lstat e a leitura (aqui o
// lstat mente) não é lido inteiro: a leitura pelo descritor para no teto.
test('lerFrontmatter: arquivo que cresce depois do lstat não é lido além do teto', (t) => {
  const troca = path.join(tmp, 'troca.md');
  fs.writeFileSync(troca, `---\nmodel: fable\n---\n${'x'.repeat(2 * 1024 * 1024)}`);
  const lstatReal = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, o) => (p === troca ? { isFile: () => true, size: 100 } : lstatReal(p, o)));
  let lidos = 0;
  const somar = (r) => { lidos += typeof r === 'number' ? r : (r?.length ?? 0); return r; };
  const readFileReal = fs.readFileSync;
  const readReal = fs.readSync;
  t.mock.method(fs, 'readFileSync', (...a) => somar(readFileReal(...a)));
  t.mock.method(fs, 'readSync', (...a) => somar(readReal(...a)));
  assert.equal(lerFrontmatter(troca), null);
  assert.ok(lidos <= 8 * 1024 + 1, `leu ${lidos} bytes`);
});

// O título acima promete o link: lstat não segue, então um .md que é link
// para um frontmatter válido não conta. No Windows sem modo de desenvolvedor
// criar o link falha com EPERM, e o teste fica pulado.
test('lerFrontmatter: link não é seguido', (t) => {
  const alvo = path.join(cfg, 'agents', 'fable-max.md');
  const link = path.join(tmp, 'link.md');
  try {
    fs.symlinkSync(alvo, link, 'file');
  } catch (e) {
    t.skip(`sem permissão para criar link (${e.code})`);
    return;
  }
  assert.equal(lerFrontmatter(link), null);
});

test('dirConfigClaude: CLAUDE_CONFIG_DIR absoluto ou <home>/.claude', () => {
  assert.equal(dirConfigClaude({ CLAUDE_CONFIG_DIR: cfg }, '/h'), cfg);
  assert.equal(dirConfigClaude({ CLAUDE_CONFIG_DIR: 'relativo' }, tmp), path.join(tmp, '.claude'));
  assert.equal(dirConfigClaude({}, tmp), path.join(tmp, '.claude'));
  assert.equal(dirConfigClaude({}, 'relativo'), null);
});
