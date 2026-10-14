// Abre o MCP do REA com versão fixa. No Windows o npx é npx.cmd e só abre
// por cmd.exe (instrução oficial do REA: cmd.exe /d /c npx ...). O cmd.exe vem
// por caminho absoluto, nunca pelo PATH. Argumentos fixos: nada do ambiente
// entra neles. stdio herdado: o protocolo MCP passa direto.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSAO_REA = '6.1.0';
const ARGS = ['-y', `rea-agents@${VERSAO_REA}`, 'mcp'];

export function comandoRea(plataforma, env) {
  if (plataforma === 'win32') {
    const raiz = env.SystemRoot || 'C:\\Windows';
    return { comando: path.win32.join(raiz, 'System32', 'cmd.exe'), args: ['/d', '/c', 'npx', ...ARGS] };
  }
  return { comando: 'npx', args: [...ARGS] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { comando, args } = comandoRea(process.platform, process.env);
  const filho = spawn(comando, args, { stdio: 'inherit', windowsHide: true });
  filho.on('error', (e) => { process.stderr.write(`hadouken-rea: ${e.message}\n`); process.exit(1); });
  filho.on('exit', (codigo, sinal) => process.exit(sinal ? 1 : (codigo ?? 1)));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => filho.kill(s));
}
