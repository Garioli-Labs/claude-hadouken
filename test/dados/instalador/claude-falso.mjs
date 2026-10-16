import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `claude` falso dos testes do instalador (v0.5.2). `responder` é pura sobre
// o estado { plugins, log, raiz, versao?, falhar? }; rodado como programa
// (pelo invólucro de instalarFalso), lê e regrava o estado no arquivo de
// FALSO_ESTADO. Com FALSO_COMER_STDIN=1, lê a entrada inteira antes, como um
// comando que comeria o resto de um `curl | bash`.
// Dependências do kit: o `install` do kit traz as que faltam (menos as de
// estado.semDeps, que nunca instalam); o `update` só troca a versão do kit,
// como o de verdade (revisão final da v0.5.2, Critical 2).

export const CATALOGO = Object.freeze({
  'hadouken@claude-hadouken': '0.5.2',
  'hadouken-kit@claude-hadouken': '1.1.0',
  'hadouken-rea@claude-hadouken': '1.0.1',
  'superpowers@claude-plugins-official': '6.4.1',
  'mattpocock-skills@claude-hadouken': '1.0.0',
  'poka-yoke@claude-hadouken': '1.0.0',
  'fullstack-dev-skills@claude-hadouken': '1.0.0',
  'ui-ux-pro-max@claude-hadouken': '1.0.0',
});
export const DEPS_KIT = Object.freeze([
  'hadouken@claude-hadouken', 'superpowers@claude-plugins-official', 'mattpocock-skills@claude-hadouken',
  'poka-yoke@claude-hadouken', 'fullstack-dev-skills@claude-hadouken', 'ui-ux-pro-max@claude-hadouken',
]);
const ARQUIVO = fileURLToPath(import.meta.url);

export function responder(estado, args) {
  estado.log.push(args.join(' '));
  const [a, b, c] = args;
  const nada = (codigo) => ({ codigo, saida: '' });
  if (a === '--version') return { codigo: 0, saida: `${estado.versao ?? '2.1.301'} (Claude Code)\n` };
  if (a === 'update') {
    estado.versao = '2.1.301';
    return nada(0);
  }
  if (a !== 'plugin') return nada(1);
  if ((estado.falhar ?? []).includes(args.slice(1).join(' '))) return nada(1);
  if (b === 'marketplace') return nada(0);
  if (b === 'list') return { codigo: 0, saida: JSON.stringify(estado.plugins) };
  const p = estado.plugins.find((x) => x.id === c);
  if (b === 'install') {
    if (!Object.hasOwn(CATALOGO, c)) return nada(1);
    const novo = (id) => estado.plugins.push({ id, version: CATALOGO[id], scope: 'user', enabled: !id.startsWith('hadouken-rea@'), installPath: `${estado.raiz}/${id.split('@')[0]}` });
    if (!p) novo(c);
    if (c === 'hadouken-kit@claude-hadouken') {
      for (const d of DEPS_KIT) if (!(estado.semDeps ?? []).includes(d) && !estado.plugins.some((x) => x.id === d)) novo(d);
    }
    return nada(0);
  }
  if (b === 'update') {
    if (p) p.version = CATALOGO[c];
    return nada(p ? 0 : 1);
  }
  if (b === 'enable' || b === 'disable') {
    if (p) p.enabled = b === 'enable';
    return nada(p ? 0 : 1);
  }
  return nada(1);
}

// O `rodar` de criarClaude, em processo, sobre o mesmo estado.
export function rodarFalso(estado) {
  return async (args) => {
    const r = responder(estado, args);
    return { ok: r.codigo === 0, motivo: r.codigo === 0 ? 'ok' : 'erro', saida: r.saida };
  };
}

// Grava o invólucro executável na pasta: claude.cmd no Windows, claude (sh)
// fora dele. Devolve o caminho.
export function instalarFalso(pasta) {
  if (process.platform === 'win32') {
    const alvo = path.join(pasta, 'claude.cmd');
    fs.writeFileSync(alvo, `@"${process.execPath}" "${ARQUIVO}" %*\r\n`);
    return alvo;
  }
  const alvo = path.join(pasta, 'claude');
  fs.writeFileSync(alvo, `#!/bin/sh\nexec "${process.execPath}" "${ARQUIVO}" "$@"\n`, { mode: 0o755 });
  return alvo;
}

// Só age como programa com FALSO_ESTADO: o `node --test` sem argumentos roda
// todo .mjs de test/, este também, e aí ele não faz nada.
let principal = false;
try {
  principal = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(ARQUIVO);
} catch { /* importado */ }
if (principal && process.env.FALSO_ESTADO) {
  if (process.env.FALSO_COMER_STDIN === '1') {
    try { fs.readFileSync(0); } catch { /* sem entrada */ }
  }
  const arq = process.env.FALSO_ESTADO;
  const estado = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const r = responder(estado, process.argv.slice(2));
  fs.writeFileSync(arq, JSON.stringify(estado));
  process.stdout.write(r.saida);
  process.exitCode = r.codigo;
}
