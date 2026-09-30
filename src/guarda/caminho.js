import fs from 'node:fs';
import path from 'node:path';

// Apoio da P4 e da P5 (spec v0.4.0 §4.2, S13 e spike S9).

// Caminho real: o ancestral existente mais longo passa por
// realpathSync.native (desfaz links, '..' e o nome curto 8.3 do Windows) e o
// resto é reanexado. Relativo ou não texto: null. Nunca lança.
export function caminhoReal(p) {
  try {
    if (typeof p !== 'string' || p.length === 0 || p.length > 4096 || !path.isAbsolute(p)) return null;
    let atual = path.resolve(p);
    const resto = [];
    for (;;) {
      try {
        return path.join(fs.realpathSync.native(atual), ...resto.reverse());
      } catch {
        const pai = path.dirname(atual);
        if (pai === atual) return path.resolve(p);
        resto.push(path.basename(atual));
        atual = pai;
      }
    }
  } catch {
    return null;
  }
}

const WIN = process.platform === 'win32';
const normal = (p) => (WIN ? p.toLowerCase() : p);

export function dentroDe(pasta, alvo) {
  const a = caminhoReal(pasta);
  const b = caminhoReal(alvo);
  if (a === null || b === null) return false;
  const rel = path.relative(normal(a), normal(b));
  // Fora é ".." ou "../algo"; um filho chamado "..x" continua dentro.
  const sobe = rel === '..' || rel.startsWith(`..${path.sep}`);
  return rel === '' || (!sobe && !path.isAbsolute(rel));
}

// O executável claude como palavra de comando: no começo, depois de um
// separador (; & | ( ou espaço) ou de um caminho, seguido de espaço ou do fim.
// Não casa 'claude-hadouken', 'CLAUDE.md' nem 'claudette'.
const CLAUDE = /(?:^|[\s;&|(])(?:[^\s;&|()"']*[\\/])?claude(?:\.exe|\.cmd|\.ps1)?(?=\s|$|["'])/i;
export const chamaClaude = (comando) => typeof comando === 'string' && CLAUDE.test(comando.slice(0, 8192));

// Regra fixa da P4 (decisão do controlador na revisão da Task 13): o comando
// que chama claude junto com o comando de liberação é negado sempre, com a
// guarda disparada ou não. Uma sessão `claude -p` aberta do Bash de uma sessão
// do VS Code herda CLAUDE_CODE_ENTRYPOINT=claude-vscode (C23), e o hook do
// liberar não a separa pelo entrypoint; fechar o lançamento aqui é a defesa.
// Só texto, sem E/S, o comando inteiro (sem o corte de 8 KiB de chamaClaude)
// e nunca lança: na dúvida, nega.
// - Liberação: sem aspas, crase (escape do PowerShell), ^ (escape do cmd),
//   barra invertida (escape do bash), espaços e maiúsculas, o texto tem
//   ':liberar' (cobre 'claude-hadouken:liberar' com ou sem a barra, e o
//   prefixo montado por variável); ou '/liberar' como palavra, caso o Claude
//   Code aceite o nome curto do comando do plugin.
// - Claude: a palavra claude (como em chamaClaude, também entre aspas, depois
//   de '=' e antes de ')' ou crase, com .exe, .cmd, .ps1 ou .bat) ou o pacote
//   'claude-code' (npx, bunx ou node .../@anthropic-ai/claude-code/cli.js).
// Resíduo (R1; SECURITY.md na Task 18): um script fora da ferramenta Bash ou
// PowerShell (arquivo .sh ou .ps1, npm run, um executável com outro nome),
// o texto vindo de arquivo (claude -p < pedido.txt) e comandos ofuscados
// (nome montado aos pedaços, códigos de caractere) ainda chegam lá.
const LIBERAR_CURTO = /(?:^|[\s;&|(=])\/liberar(?=[\s;&|)]|$)/;
const PALAVRA_CLAUDE = /(?:^|[\s;&|()=`])(?:[^\s;&|()"'`=]*[\\/])?claude(?:\.exe|\.cmd|\.ps1|\.bat)?(?=[\s;&|()"'`]|$)/;
const PACOTE = /claude-code/;

export function claudeComLiberar(comando) {
  try {
    if (typeof comando !== 'string') return false;
    const bruto = comando.toLowerCase();
    const semAspas = bruto.replace(/["'`^]/g, '');
    const semEscape = semAspas.replace(/\\/g, '');
    const liberar = semEscape.replace(/\s+/g, '').includes(':liberar') || LIBERAR_CURTO.test(semEscape);
    if (!liberar) return false;
    return [bruto, semAspas, semEscape].some((v) => PACOTE.test(v) || PALAVRA_CLAUDE.test(v));
  } catch {
    return true;
  }
}
