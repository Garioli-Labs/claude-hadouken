import fs from 'node:fs';
import path from 'node:path';

// Apoio da P4 e da P5 (spec v0.4.0 §4.2, S13 e spike S9).

// Caminho real: o ancestral existente mais longo passa por
// realpathSync.native (desfaz links, '..' e o nome curto 8.3 do Windows) e o
// resto é reanexado. Relativo ou não texto: null. Nunca lança.
// Limites (R1, declarados na Task 18): o path.resolve desfaz '..' antes de os
// links serem resolvidos (um 'link/..' sobe pelo caminho escrito, não pelo
// destino do link, ao contrário do sistema de arquivos); e só o Windows é
// comparado sem diferenciar maiúsculas, então o macOS com o sistema de
// arquivos padrão (que não diferencia) fica de fora num nome ainda inexistente.
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

// --- Onde o comando abre claude (P4) ---------------------------------------
// Um leitor de comando pequeno, só texto e linear: separa segmentos (; && ||
// | & ( ) e quebra de linha, e também $( ) e, no bash, a crase, que rodam
// mesmo dentro de aspas duplas) em palavras sem aspas nem escapes. Roda em
// duas leituras e vale a que achar mais: a do bash (barra invertida escapa, a
// crase é substituição, \ + quebra de linha continua a linha) e a do
// PowerShell e do cmd (crase e ^ são escapes e continuam a linha; a barra
// invertida é de caminho). Na dúvida, conta como claude.

const SEPARA = new Set([';', '&', '|', '\n', '\r', '(', ')']);
const ESPACO = /\s/;
// Trechos sem nada especial, lidos de uma vez (fora e dentro de aspas duplas).
const TRECHO = /[^\s;&|()"'$`\\]+/y;
const TRECHO_DQ = /[^"$`\\]+/y;

function trecho(re, texto, i) {
  re.lastIndex = i;
  const m = re.exec(texto);
  return m === null ? texto[i] : m[0];
}

function segmentos(texto, bash) {
  const segs = [];
  let seg = [];
  let palavra = null;
  const pilha = []; // 'dq' (aspas duplas), 'sub' ($( ... )), 'bt' (crase)
  const topo = () => pilha[pilha.length - 1];
  const juntar = (s) => { palavra = (palavra ?? '') + s; };
  const fimPalavra = () => { if (palavra !== null) seg.push(palavra); palavra = null; };
  const fimSeg = () => { fimPalavra(); if (seg.length > 0) segs.push(seg); seg = []; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (bash && c === '\\' && i + 1 < texto.length) { juntar(texto[++i]); continue; }
    if (c === '$' && texto[i + 1] === '(') { i++; fimSeg(); pilha.push('sub'); continue; }
    if (bash && c === '`') {
      fimSeg();
      if (topo() === 'bt') pilha.pop();
      else pilha.push('bt');
      continue;
    }
    if (topo() === 'dq') {
      if (c === '"') { pilha.pop(); continue; }
      const t = trecho(TRECHO_DQ, texto, i);
      juntar(t);
      i += t.length - 1;
      continue;
    }
    if (c === '"') { pilha.push('dq'); juntar(''); continue; }
    if (c === "'") {
      const f = texto.indexOf("'", i + 1);
      const fim = f === -1 ? texto.length : f;
      juntar(texto.slice(i + 1, fim));
      i = fim;
      continue;
    }
    if (c === ')') { fimSeg(); if (topo() === 'sub') pilha.pop(); continue; }
    if (SEPARA.has(c)) { fimSeg(); continue; }
    if (ESPACO.test(c)) { fimPalavra(); continue; }
    const t = trecho(TRECHO, texto, i);
    juntar(t);
    i += t.length - 1;
  }
  fimSeg();
  return segs;
}

// A palavra é claude: o nome (com caminho e .exe, .cmd, .ps1 ou .bat) ou o
// pacote claude-code (npx @anthropic-ai/claude-code, node .../claude-code/cli.js).
const EH_CLAUDE = /(?:^|[\\/])claude(?:\.exe|\.cmd|\.ps1|\.bat)?$/;
const ehClaude = (w) => EH_CLAUDE.test(w) || w.includes('claude-code');
const ATRIBUICAO = /^[a-z_][a-z0-9_]*\+?=/;
// Comandos que rodam o comando seguinte (decisão do controlador: env,
// command, exec, sudo, npx, bunx, pnpm dlx, e outros do mesmo tipo).
const PREFIXOS = new Set([
  'env', 'command', 'exec', 'sudo', 'doas', 'nohup', 'time', 'nice', 'timeout', 'xargs', 'stdbuf', 'setsid', 'winpty', 'wsl',
  'npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'start', 'start-process', 'saps', 'call',
  'which', 'where', 'get-command', 'gcm', 'type', 'watch', '!', '{', 'if', 'then', 'else', 'elif', 'do', 'while', 'until',
]);
const AVALIA = new Set(['eval', 'iex', 'invoke-expression']);
const EXECUTA = new Set(['-exec', '-execdir', '-ok', '-okdir']);
// O argumento seguinte é um comando: bash/sh -c (e -lc, -ic...), cmd /c e /k,
// PowerShell -Command e as abreviações dele.
const FLAG_COMANDO = /^(?:\/[ck]|-[a-z]*c|-co(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)$/;
const nomeDe = (w) => w.split(/[\\/]/).pop().replace(/\.exe$/, '');
// Comando que não dá para ler: variável ($X, ${X}, %X%, fora uma atribuição
// do PowerShell), chaves, glob ou colchete ({claude,}, cl?ude, [Process]).
const incerto = (w, prox) => (/^[$%]/.test(w) && !w.includes('=') && !/^[-+*/]?=/.test(prox ?? '')) || /[{*?[]/.test(w);

const NENHUM = 0;
const INCERTO = 1;
const CLAUDE_LANCADO = 2;
const NIVEL_MAX = 4;

function avaliarSegmento(seg, nivel) {
  let r = NENHUM;
  let i = 0;
  while (i < seg.length && ATRIBUICAO.test(seg[i])) i++;
  if (i < seg.length) {
    const cmd = seg[i];
    const nome = nomeDe(cmd);
    if (ehClaude(cmd)) return CLAUDE_LANCADO;
    if (PREFIXOS.has(nome) && seg.slice(i + 1).some(ehClaude)) return CLAUDE_LANCADO;
    if (incerto(cmd, seg[i + 1])) r = INCERTO;
    if (AVALIA.has(nome) && i + 1 < seg.length) r = Math.max(r, lancamento(seg.slice(i + 1).join(' '), nivel + 1));
  }
  for (let j = 0; j + 1 < seg.length && r < CLAUDE_LANCADO; j++) {
    if (EXECUTA.has(seg[j]) && ehClaude(seg[j + 1])) return CLAUDE_LANCADO;
    if (FLAG_COMANDO.test(seg[j])) r = Math.max(r, lancamento(seg[j + 1], nivel + 1));
  }
  return r;
}

function pior(segs, nivel) {
  let r = NENHUM;
  for (const s of segs) {
    r = Math.max(r, avaliarSegmento(s, nivel));
    if (r === CLAUDE_LANCADO) break;
  }
  return r;
}

// Texto já em minúsculas. A leitura do PowerShell e do cmd só roda quando há
// crase, ^ ou barra invertida (sem eles, as duas leituras são iguais). Aninhar
// mais que NIVEL_MAX -c ou eval conta como claude. Uma palavra só, sem nada
// que o leitor trate, é avaliada direto (o argumento de cada '-c').
const SIMPLES = /^[^\s;&|()"'$`\\^]*$/;
function lancamento(texto, nivel) {
  if (nivel > NIVEL_MAX) return CLAUDE_LANCADO;
  if (SIMPLES.test(texto)) {
    if (texto === '' || ATRIBUICAO.test(texto)) return NENHUM;
    if (ehClaude(texto)) return CLAUDE_LANCADO;
    return incerto(texto) ? INCERTO : NENHUM;
  }
  let r = pior(segmentos(texto.replace(/\\\r?\n/g, ''), true), nivel);
  if (r < CLAUDE_LANCADO && /[`^\\]/.test(texto)) {
    const ps = texto.replace(/[\\`^]\r?\n/g, '').replace(/[`^]/g, '');
    r = Math.max(r, pior(segmentos(ps, false), nivel));
  }
  return r;
}

// O executável claude como palavra de comando: no começo, depois de um
// separador (; & | ( ou espaço) ou de um caminho, seguido de espaço ou do fim.
// Não casa 'claude-hadouken', 'CLAUDE.md' nem 'claudette'. Sem corte de
// tamanho (a regex é linear; na revisão, 9 KB antes do claude escapavam), e
// também o leitor acima (claude entre aspas, $(which claude), npx do pacote,
// continuação de linha). Nunca lança; na dúvida, conta como claude.
const CLAUDE = /(?:^|[\s;&|(])(?:[^\s;&|()"']*[\\/])?claude(?:\.exe|\.cmd|\.ps1)?(?=\s|$|["'])/i;
export function chamaClaude(comando) {
  if (typeof comando !== 'string') return false;
  if (CLAUDE.test(comando)) return true;
  try {
    return lancamento(comando.toLowerCase(), 0) === CLAUDE_LANCADO;
  } catch {
    return true;
  }
}

// Regra fixa da P4 (decisão do controlador na revisão da Task 13): o comando
// que abre claude junto com o comando de liberação é negado sempre, com a
// guarda disparada ou não. Uma sessão `claude -p` aberta do Bash de uma sessão
// do VS Code herda CLAUDE_CODE_ENTRYPOINT=claude-vscode (C23), e o hook do
// liberar não a separa pelo entrypoint; fechar o lançamento aqui é a defesa.
// Só texto, sem E/S, o comando inteiro, e nunca lança: na dúvida, nega.
// - Liberação: sem aspas, crase (escape do PowerShell), ^ (escape do cmd),
//   barra invertida (escape do bash), espaços e maiúsculas, o texto tem
//   ':liberar' (cobre 'claude-hadouken:liberar' com ou sem a barra, e o
//   prefixo montado por variável); ou '/liberar' como palavra, caso o Claude
//   Code aceite o nome curto do comando do plugin.
// - Claude (decisão do controlador na rodada 1 da revisão): só em posição de
//   comando de algum segmento, pelo leitor acima. Uma mensagem de commit que
//   cita claude e liberar passa; bash -c "claude ..." e $(claude ...) não.
// - Expansão (mesma decisão): com claude em posição de comando, o texto com
//   'hadouken' e { $ ` * ou ? nega, porque não dá para saber o que o bash
//   expande (:libe{rar,}, :lib?rar, $X).
// - Um comando que não dá para ler (variável, glob) só nega junto do texto
//   da liberação.
// Resíduo (R1; SECURITY.md na Task 18): um script fora da ferramenta Bash ou
// PowerShell (arquivo .sh ou .ps1, npm run, um executável com outro nome),
// o texto vindo de arquivo (claude -p < pedido.txt), comandos ofuscados (nome
// montado aos pedaços, códigos de caractere, -EncodedCommand) e uma linha de
// heredoc que comece por claude (conta como comando: nega a mais).
const LIBERAR_CURTO = /(?:^|[\s;&|(=])\/liberar(?=[\s;&|)]|$)/;

export function claudeComLiberar(comando) {
  try {
    if (typeof comando !== 'string') return false;
    const bruto = comando.toLowerCase();
    const semEscape = bruto.replace(/["'`^\\]/g, '');
    const liberar = semEscape.replace(/\s+/g, '').includes(':liberar') || LIBERAR_CURTO.test(semEscape);
    const expansao = bruto.includes('hadouken') && /[{$`*?]/.test(bruto);
    if (!liberar && !expansao) return false;
    const l = lancamento(bruto, 0);
    return l === CLAUDE_LANCADO || (l === INCERTO && liberar);
  } catch {
    return true;
  }
}
