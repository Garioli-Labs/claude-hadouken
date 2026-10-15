// Abre o MCP do REA com versão fixa. No Windows o npx é npx.cmd e só abre
// por cmd.exe (instrução oficial do REA: cmd.exe /d /c npx ...). O cmd.exe vem
// por caminho absoluto, nunca pelo PATH. Argumentos fixos: nada do ambiente
// entra neles. stdio herdado: o protocolo MCP passa direto.
//
// I1 da revisão final: o cwd é a pasta do plugin, nunca o projeto aberto. Com
// o projeto no cwd, o npx usaria um node_modules/rea-agents (ou o .npmrc) do
// repositório, e abrir uma sessão nele rodaria o código dele. No Windows,
// NoDefaultCurrentDirectoryInExePath impede o cmd.exe de achar um npx.cmd
// no cwd. O REA recebe caminhos absolutos.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSAO_REA = '6.1.0';
const ARGS = ['-y', `rea-agents@${VERSAO_REA}`, 'mcp'];

// engines do rea-agents 6.1.0 no npm: ^22.19.0 || ^24.11.0 || >=26.0.0.
export function nodeServe(versao) {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(versao ?? '');
  if (!m) return false;
  const [maior, menor] = [Number(m[1]), Number(m[2])];
  return (maior === 22 && menor >= 19) || (maior === 24 && menor >= 11) || maior >= 26;
}

export function comandoRea(plataforma, env, pasta) {
  if (plataforma === 'win32') {
    const raiz = env.SystemRoot || 'C:\\Windows';
    return {
      comando: path.win32.join(raiz, 'System32', 'cmd.exe'), args: ['/d', '/c', 'npx', ...ARGS],
      cwd: pasta, env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' },
    };
  }
  return { comando: 'npx', args: [...ARGS], cwd: pasta, env: { ...env } };
}

// O Node resolve links no import.meta.url, mas não no argv[1]: sob uma junção
// ou link, só a comparação dos caminhos reais reconhece o arquivo principal.
function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  if (!nodeServe(process.versions.node)) {
    process.stderr.write(`hadouken-rea: o rea-agents ${VERSAO_REA} pede Node ^22.19.0, ^24.11.0 ou >=26.0.0; este é o ${process.versions.node}.\n`);
    process.exit(1);
  }
  const pasta = path.dirname(fileURLToPath(import.meta.url));
  const { comando, args, cwd, env } = comandoRea(process.platform, process.env, pasta);
  const filho = spawn(comando, args, { stdio: 'inherit', windowsHide: true, cwd, env });
  filho.on('error', (e) => { process.stderr.write(`hadouken-rea: ${e.message}\n`); process.exit(1); });
  filho.on('exit', (codigo, sinal) => process.exit(sinal ? 1 : (codigo ?? 1)));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => filho.kill(s));
}
