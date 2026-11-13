// Ambiente de teste do kit sem o HOME de quem roda (v0.6.0, Tarefa A2, Passo 0).
// Um hook que cai no fallback ~/.claude/... (por exemplo, um mutante que ignora
// HADOUKEN_HOME) lê e grava na casa do usuário real. Aqui HOME, USERPROFILE,
// CLAUDE_CONFIG_DIR e HADOUKEN_HOME apontam sempre para pastas temporárias, e
// CLAUDE_PROJECT_DIR só entra quando o teste o pede.
import path from 'node:path';

const DA_CASA = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'CLAUDE_CONFIG_DIR', 'HADOUKEN_HOME', 'CLAUDE_PROJECT_DIR'];

// `casa`: pasta temporária que faz de HOME. `extra`: o que o teste põe por cima
// (CLAUDE_CONFIG_DIR, HADOUKEN_HOME, TMPDIR…); undefined remove a variável.
export function envIsolado(casa, extra = {}) {
  const env = { ...process.env };
  for (const k of DA_CASA) delete env[k];
  Object.assign(env, {
    HOME: casa,
    USERPROFILE: casa,
    CLAUDE_CONFIG_DIR: path.join(casa, '.claude'),
    HADOUKEN_HOME: path.join(casa, '.claude', 'hadouken'),
  }, extra);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}
