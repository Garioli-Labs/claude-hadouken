import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Atualização do plugin com sessões abertas (spec v0.2.0 §10; ordem 1 do Sr.
// Garioli, 2026-09-26). A statusLine do Claude Code chama o shim estável
// <dirDados>/bin/statusline.mjs, uma linha que importa src/statusline.js da
// raiz do plugin gravada pelo último SessionStart (sincronizarShims em
// src/shim.js, chamado em toda origem: startup, resume, clear, compact). O
// shim não guarda versão por sessão, então:
// - até algum SessionStart rodar com a versão nova, toda sessão segue com o
//   visual velho;
// - depois dele, o próximo redesenho de toda sessão registrada usa o código
//   novo (a mudança é só visual: estado.json e ativas/ são os mesmos);
// - um SessionStart da versão velha (um /clear numa sessão antiga) aponta o
//   shim de volta para ela enquanto a pasta existir;
// - pasta apontada removida: barra vazia, código 0, até o próximo SessionStart;
// - sessão nunca registrada segue sem barra e sem escrita em todos os passos.
// Nenhum git: as duas "versões" são a raiz deste repo e uma raiz falsa mínima.

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SESSION_START = path.join(RAIZ, 'src', 'hooks', 'session-start.js');
const ATIVAS_URL = pathToFileURL(path.join(RAIZ, 'src', 'ativas.js')).href;

const pastas = [];
after(() => { for (const d of pastas) fs.rmSync(d, { recursive: true, force: true }); });
const novaPasta = (prefixo) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  pastas.push(d);
  return d;
};

// Ambiente dos filhos: HADOUKEN_HOME na pasta do teste e NO_COLOR ligado; um
// valor undefined tira a variável. HADOUKEN_SEM_PAINEL=1: o SessionStart com
// a raiz do repo não dispara a instalação do painel, que chamaria o `code` de
// verdade pelo PATH de quem roda os testes.
function ambiente(home, extra = {}) {
  const env = { ...process.env, HADOUKEN_HOME: home, NO_COLOR: '1', HADOUKEN_SEM_PAINEL: '1', ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
}

// A versão "velha": só o que o shim e raizValida exigem (src/statusline.js
// como arquivo regular), com o mesmo gate de ativação da real e um marcador
// fixo no lugar da barra.
function raizVelha(base) {
  const raiz = path.join(base, 'plugin 0.1.0 ç');
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(raiz, 'src', 'statusline.js'), [
    `import { sessaoAtiva } from ${JSON.stringify(ATIVAS_URL)};`,
    "let texto = '';",
    'for await (const pedaco of process.stdin) texto += pedaco;',
    'let id = null;',
    'try { id = JSON.parse(texto).session_id; } catch {}',
    "if (sessaoAtiva(id, Date.now())) process.stdout.write('versao-velha');",
    '',
  ].join('\n'));
  return raiz;
}

function sessionStart(home, raiz, id, source = 'startup') {
  const r = spawnSync(process.execPath, [SESSION_START], {
    input: JSON.stringify({ session_id: id, source, hook_event_name: 'SessionStart' }),
    env: ambiente(home, { CLAUDE_PLUGIN_ROOT: raiz }), encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
}

// O redesenho da barra como o Claude Code faz: o shim, com o JSON da sessão.
function barra(home, id) {
  const s = Math.floor(Date.now() / 1000);
  const entrada = {
    session_id: id, model: { display_name: 'Opus 5.5' },
    rate_limits: { five_hour: { used_percentage: 10, resets_at: s + 3600 }, seven_day: { used_percentage: 20, resets_at: s + 86400 } },
  };
  const r = spawnSync(process.execPath, [path.join(home, 'bin', 'statusline.mjs')], {
    input: JSON.stringify(entrada), env: ambiente(home, { CLAUDE_PLUGIN_ROOT: undefined }), encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout;
}

// Tudo o que há na pasta de dados: caminho, tamanho, mtime e hash de cada
// arquivo. Serve para provar que a sessão não registrada nada grava.
function fotografar(dir) {
  const itens = [];
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isDirectory()) {
        itens.push(`${rel}/`);
        andar(p);
      } else {
        const st = fs.lstatSync(p);
        const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        itens.push(`${rel} ${st.size} ${st.mtimeMs} ${hash}`);
      }
    }
  };
  andar(dir);
  return itens.sort();
}

// E6 (emenda 2026-09-29): a barra do terminal fica só com a sessão, sem 5h,
// 7d nem "N sessões"; com uma ou duas sessões ativas, a linha é a mesma.
const NOVA = /^Opus 5\.5 │ ctx — │ cache —$/;
const NOVA_DUAS = NOVA;

test('atualização: sessão registrada troca de visual no próximo SessionStart da versão nova; não registrada segue muda', () => {
  const home = novaPasta('hdk atualiza ç ');
  const velha = raizVelha(novaPasta('hdk raizes '));

  // v0.1.0 instalada: s1 abre, o shim aponta para a raiz velha.
  sessionStart(home, velha, 's1');
  assert.ok(fs.readFileSync(path.join(home, 'bin', 'statusline.mjs'), 'utf8').includes(pathToFileURL(velha).href));
  assert.equal(barra(home, 's1'), 'versao-velha');
  assert.equal(barra(home, 's3'), '', 's3 nunca passou por um SessionStart');

  // Atualização: a primeira sessão aberta com a versão nova (s2) regrava o
  // shim. s1, já registrada, passa ao visual novo no próximo redesenho.
  sessionStart(home, RAIZ, 's2');
  assert.match(barra(home, 's1'), NOVA);
  assert.match(barra(home, 's2'), NOVA_DUAS);
  const antes = fotografar(home);
  assert.equal(barra(home, 's3'), '', 's3 segue sem barra depois da atualização');
  assert.deepEqual(fotografar(home), antes, 's3 não grava nada na pasta de dados');

  // Um SessionStart da versão velha (um /clear numa sessão antiga) aponta o
  // shim de volta para ela enquanto a pasta existir.
  sessionStart(home, velha, 's1', 'clear');
  assert.equal(barra(home, 's1'), 'versao-velha');

  // O /plugin removeu a pasta velha: barra vazia, código 0, sem stderr.
  fs.rmSync(velha, { recursive: true, force: true });
  assert.equal(barra(home, 's1'), '');
  assert.equal(barra(home, 's3'), '');

  // O próximo SessionStart (qualquer origem) volta à versão nova.
  sessionStart(home, RAIZ, 's1', 'resume');
  assert.match(barra(home, 's1'), NOVA_DUAS);
  assert.equal(barra(home, 's3'), '');
});
