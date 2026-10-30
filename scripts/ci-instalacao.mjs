// Teste de instalação de ponta a ponta, para o CI (job "instalacao", em
// macOS, Linux e Windows): com o Claude Code e o plugin já instalados pelo
// workflow a partir do checkout, roda o instalar-tudo como o install.sh faz
// e confere o que um usuário veria num PC novo. Sai com 1 na primeira falha.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ID = 'hadouken@claude-hadouken';
const dirConfig = path.join(os.homedir(), '.claude');
const dados = path.join(dirConfig, 'hadouken');
let falhas = 0;

function ok(cond, oque) {
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${oque}`);
  if (!cond) falhas++;
  return cond;
}

function rodar(args, { entrada = '', env = {} } = {}) {
  const r = spawnSync(process.execPath, args, { input: entrada, encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env } });
  return { codigo: r.status, saida: r.stdout ?? '', erro: r.stderr ?? '' };
}

// 1. O plugin registrado, na versão do checkout.
const versaoRepo = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8')).version;
const registro = JSON.parse(fs.readFileSync(path.join(dirConfig, 'plugins', 'installed_plugins.json'), 'utf8'));
const entrada = (registro.plugins?.[ID] ?? []).find((e) => e.scope === 'user') ?? registro.plugins?.[ID]?.[0];
if (!ok(entrada !== undefined, `${ID} registrado`)) process.exit(1);
const raiz = entrada.installPath;
ok(entrada.version === versaoRepo, `versão registrada ${entrada.version} = ${versaoRepo}`);
ok(fs.existsSync(path.join(raiz, 'src', 'statusline.js')), 'pasta do plugin com src/statusline.js');

// 2. O resto da instalação, como o install.sh faz (sem perguntas e sem extras).
const inst = rodar([path.join(raiz, 'src', 'instalar-tudo.js'), '--sim', '--sem-extras', '--sem-aprender']);
console.log(inst.saida.trim(), inst.erro.trim());
ok(inst.codigo === 0, `instalar-tudo saiu com ${inst.codigo}`);

// 3. Os atalhos de bin/ apontam para a versão instalada.
for (const s of ['statusline.mjs', 'cli.mjs', 'painel.mjs']) {
  const arq = path.join(dados, 'bin', s);
  const texto = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
  ok(texto.includes(`/${versaoRepo}/src/`), `bin/${s} aponta para ${versaoRepo}`);
}

// 4. Os hooks de início e de prompt rodam e devolvem JSON ou nada. O de
// início registra a sessão: a barra só aparece para sessão registrada.
const SESSAO = '0c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e';
const env = { CLAUDE_PLUGIN_ROOT: raiz };
for (const [hook, dadosHook] of [
  ['session-start.js', { session_id: SESSAO, cwd: process.cwd(), source: 'startup', hook_event_name: 'SessionStart' }],
  ['prompt-submit.js', { session_id: SESSAO, cwd: process.cwd(), prompt: 'oi', hook_event_name: 'UserPromptSubmit' }],
]) {
  const r = rodar([path.join(raiz, 'src', 'hooks', hook)], { entrada: JSON.stringify(dadosHook), env });
  let json = true;
  if (r.saida.trim() !== '') try { JSON.parse(r.saida); } catch { json = false; }
  ok(r.codigo === 0 && json, `hook ${hook} saiu com ${r.codigo}${json ? '' : ' e saída que não é JSON'}`);
}

// 5. A barra do Claude Code responde com o JSON que ele manda.
const barra = rodar([path.join(dados, 'bin', 'statusline.mjs')], {
  entrada: JSON.stringify({ session_id: SESSAO, model: { id: 'claude-opus-5-5', display_name: 'Opus' }, workspace: { current_dir: process.cwd() }, cwd: process.cwd() }),
});
ok(barra.codigo === 0 && barra.saida.trim() !== '', `statusline respondeu (${JSON.stringify(barra.saida.trim().slice(0, 80))})`);

// 6. O relatório de consumo roda sem conta (sem leitura, sem erro interno).
const consumo = rodar([path.join(dados, 'bin', 'cli.mjs'), 'consumo']);
ok(!/erro interno/.test(consumo.saida), `consumo sem erro interno (código ${consumo.codigo})`);

// 7. A conferência da instalação: sessão, atalhos e nenhum plugin de nome antigo.
const { conferirInstalacao, textoInstalacao } = await import(pathToFileURL(path.join(raiz, 'src', 'instalacao.js')).href);
const c = conferirInstalacao({ dir: dados, raiz });
console.log('Instal.:', textoInstalacao(c));
ok(c.sessao === versaoRepo && c.registrada === versaoRepo, 'sessão e registro na mesma versão');
ok(c.atalhos.length === 1 && c.atalhos[0] === versaoRepo, `atalhos só em ${versaoRepo}`);
ok(c.restos.length === 0, 'nenhum plugin de nome antigo');

console.log(falhas === 0 ? `\ninstalação ok em ${process.platform}` : `\n${falhas} falha(s) em ${process.platform}`);
process.exit(falhas === 0 ? 0 : 1);
