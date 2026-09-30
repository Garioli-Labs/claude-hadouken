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

// A palavra é claude: o nome (com caminho e .exe, .cmd ou .ps1; decisão do
// controlador na rodada 3 da revisão da Task 16) ou o pacote claude-code
// (npx @anthropic-ai/claude-code, node .../claude-code/cli.js). Decisão do
// controlador na Task 18 (Step 0): o leitor não separa redireção da palavra,
// então claude seguido de < ou > (claude>o, claude<x) conta, e também depois
// de ':' (Start-Process -FilePath:claude).
const EH_CLAUDE = /(?:^|[\\/:])claude(?:\.exe|\.cmd|\.ps1)?(?:$|[<>])/;
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

// A P4 passa o mesmo comando, em minúsculas, pelos dois testes em sequência
// (claudeComLiberar e chamaClaude), e cada um lia tudo de novo. A leitura de
// nível 0 do último texto fica guardada e a segunda sai de graça: com o pior
// caso de 4 MiB o hook cabe em 5 s (decisão do controlador na Task 18, Step 0;
// test/guarda-caminho-extra.test.js). A função é pura, então o resultado
// guardado é o mesmo que a leitura daria.
let ultimaLeitura = { texto: null, r: NENHUM };
function lancamentoDe(texto) {
  if (ultimaLeitura.texto === texto) return ultimaLeitura.r;
  const r = lancamento(texto, 0);
  ultimaLeitura = { texto, r };
  return r;
}

// O executável claude como palavra de comando: no começo, depois de um
// separador (; & | ( ou espaço), de ':' ou de um caminho, seguido de espaço,
// aspa, < ou > (redireção grudada, decisão do controlador na Task 18) ou do
// fim. Não casa 'claude-hadouken', 'CLAUDE.md' nem 'claudette'. Sem corte de
// tamanho (a regex é linear; na revisão, 9 KB antes do claude escapavam), e
// também o leitor acima (claude entre aspas, $(which claude), npx do pacote,
// continuação de linha). Nunca lança; na dúvida, conta como claude.
// Casa também o 'Claude' do trailer 'Co-Authored-By: Claude ...' de um
// commit, e a P4 comum, com a guarda disparada, nega esse commit. Decisão do
// controlador na rodada 5 da revisão da Task 16: fica assim, porque a fiação
// da Task 18 deixa o git commit fora da P4. O claudeComLiberar tira esse
// trailer antes do teste (b): ver TRAILER abaixo.
const CLAUDE = /(?:^|[\s;&|(:])(?:[^\s;&|()"']*[\\/])?claude(?:\.exe|\.cmd|\.ps1)?(?=\s|$|["'<>])/i;
export function chamaClaude(comando) {
  if (typeof comando !== 'string') return false;
  if (CLAUDE.test(comando)) return true;
  try {
    return lancamentoDe(comando.toLowerCase()) === CLAUDE_LANCADO;
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
//
// Decisão do controlador na rodada 2 da revisão da Task 16: parar de caçar
// variantes. A rodada 1, só com a posição de comando, deixava passar
// '>o claude ...', 'cmd /c start claude ...', 'try { claude ... }' e
// '. claude ...'. Agora nega se qualquer um de três testes disparar:
// (a) o texto normalizado (sem continuação de linha, sem aspas, crase, ^ e
//     barra invertida, minúsculas) tem 'hadouken:liberar', com ou sem
//     claude. Juntar os espaços num só não muda essa busca (o alvo não tem
//     espaço) e custaria segundos num comando de 16 MiB, então não é feito.
//     Um grep, um echo ou uma mensagem de commit que cite o comando nega; o
//     texto do deny aponta o git commit -F.
// (b) claude como palavra em qualquer lugar (a checagem larga de antes da
//     rodada 1) e, junto, ':liberar' ou '/liberar' como palavra, ou
//     'hadouken' com { $ ` * ? + ( ! ou % (chaves, variável, crase, glob,
//     concatenação "lib"+"erar", subexpressão, %X% e !X! do cmd).
// (c) o leitor de posição de comando da rodada 1, como estava: claude
//     lançado com ':liberar' (espaços fora) ou '/liberar' como palavra, ou
//     com 'hadouken' e { $ ` * ou ?; um comando que não dá para ler
//     (variável, glob) só com o texto da liberação. Os casos A a D não foram
//     levados ao leitor: (a) e (b) já os pegam, e a mudança nele não
//     apareceria em nenhuma função exportada (sem teste que a prove).
// Acima de 1 MiB (1_048_576 unidades do texto), 'liberar' em qualquer lugar,
// cru ou normalizado (com espaços no meio), nega sem o leitor. A busca crua
// vem antes, para não copiar o texto (16 MiB: 17 ms contra segundos). Acima
// de 4 MiB de stdin a P4 nem chama esta função (TETO_STDIN, guarda-filha.js).
// Nega a mais, e o texto do deny aponta a saída: uma linha de heredoc que
// comece por claude. O trailer 'Co-Authored-By: Claude ...' numa linha só
// dele não conta no (b) desde as rodadas 4 e 5 (ver semTrailer).
// Resíduo (R1; SECURITY.md na Task 18): a ofuscação que monta o próprio
// 'hadouken' em tempo de execução ($'\x68adouken', printf, códigos de
// caractere, -EncodedCommand), com ou sem claude como palavra; o nome claude
// montado aos pedaços sem o texto da liberação; um script fora da ferramenta
// Bash ou PowerShell (arquivo .sh ou .ps1, npm run, um executável com outro
// nome) e o texto vindo de arquivo (claude -p < pedido.txt).
const LIMITE = 1_048_576;
const LIBERAR_CURTO = /(?:^|[\s;&|(=])\/liberar(?=[\s;&|)]|$)/;
// 'liberar' e ':liberar' com espaços entre as letras: o mesmo que tirar os
// espaços e procurar, sem copiar o texto.
const LIBERAR_ESPACADO = /l\s*i\s*b\s*e\s*r\s*a\s*r/;
const DOIS_PONTOS_LIBERAR = /:\s*l\s*i\s*b\s*e\s*r\s*a\s*r/;
// (b), decisão do controlador na rodada 3 da revisão da Task 16: claude só
// conta como palavra com início, espaço, ; & | ( { ' " crase = / ou \ antes
// e fim, espaço, ; & | ) ' " ou crase depois, com .exe, .cmd ou .ps1
// opcionais. Nada de - . ou : grudado depois: o nome deste repositório
// (claude-hadouken), a pasta ~/.claude/, claude.json e 'claude:' não contam;
// /usr/bin/claude, "C:\x\claude.exe", claude.cmd, try {claude -p} e
// ['claude', ...] contam. Ou o pacote claude-code. Decisão do controlador na
// Task 18 (Step 0): < e > depois (redireção grudada: claude>o, claude<x) e
// ':' antes (Start-Process -FilePath:claude) também contam.
const PALAVRA_CLAUDE = /(?:^|[\s;&|({'"`=/\\:])claude(?:\.exe|\.cmd|\.ps1)?(?=$|[\s;&|)'"`<>])/;
const PACOTE = /claude-code/;
// (b): ':liberar' com qualquer coisa antes (claude-hadouken:liberar) ou
// '/liberar' fora de um caminho, sem outro nome depois (liberar.js,
// liberar/, liberara não contam; 'liberar.' no fim da frase conta).
const LIBERAR_PALAVRA = /(?::|(?<![a-z0-9_./-])\/)liberar(?![a-z0-9_/-]|\.[a-z0-9_])/;
const EXPANSAO_LARGA = /[{$`*?+(!%]/;
const semAspasDe = (t) => t.replace(/["'`^]/g, '');
const semEscapeDe = (t) => t.replace(/\\/g, '');

// Decisões do controlador nas rodadas 4 e 5 da revisão da Task 16: antes do
// teste (b), e só dele, o trailer 'Co-Authored-By: Claude ...
// <noreply@anthropic.com>' (sem diferenciar maiúsculas) vira um espaço. Um
// commit em heredoc ($(cat <<'EOF' ...)) ou em -m "..." com quebras de linha
// que cite hadouken trazia 'Claude' como palavra junto de $ e ( e era negado.
// Rodada 5: sai só o trailer que
// - começa a linha (no começo do texto ou depois de \n; espaços e tabs antes
//   valem);
// - não tem ; & | ( ) $ crase ' " \ nem quebra de linha entre Claude e o
//   endereço (nem '<', como na rodada 4);
// - tem depois do endereço só espaços ou tabs e então o fim da linha (\r?\n),
//   o fim do texto ou uma aspa de fechamento (" ou '), que fica no texto com
//   o que vier depois dela.
// Na rodada 4 o trecho aceitava qualquer coisa sem '<' nem quebra de linha e
// um comando inteiro posto ali ('echo "Co-Authored-By: Claude x"; >o claude
// ...; echo "<noreply@anthropic.com>"') sumia do (b). Um trailer num segundo
// -m "Co-Authored-By: ..." não começa a linha e continua contando.
// O resto da linha e do comando continua conferido; (a) e (c) leem o comando
// com o trailer. Sai do texto sem continuação de linha, antes de tirar aspas e
// escapes: um trailer montado com aspas no meio (Cl"aude) não é o exato.
// Linear: a âncora deixa um começo por linha, e cada tentativa anda só na sua
// linha (16 MiB adversariais em menos de 0,25 s). Sem a âncora, a regex da
// rodada 4 aplicada com replace era quadrática (420 KB em 11 s, acima do
// tempo do hook, que então passa).
// Só o (b) tira o trailer; o chamaClaude (CLAUDE, acima) ainda o casa.
// Resíduo (R1, SECURITY.md): um alias chamado 'co-authored-by:' que aponte
// para claude faz a linha do trailer lançar claude e sai do (b) junto com o
// trailer; o shell não interativo não expande alias, mas um que o faça
// (shopt -s expand_aliases, um .bashrc lido) escapa.
const TRAILER = /(?<=^|\n)[ \t]*co-authored-by:[ \t]*claude[^;&|()$`'"\\\n<]*<noreply@anthropic\.com>(?=[ \t]*(?:\r?\n|$|["']))/gi;
const semTrailer = (t) => t.replace(TRAILER, ' ');

export function claudeComLiberar(comando) {
  try {
    if (typeof comando !== 'string') return false;
    const bruto = comando.toLowerCase();
    const grande = comando.length > LIMITE;
    if (grande && bruto.includes('liberar')) return true;
    const semContinuacao = bruto.replace(/[\\`^]\r?\n/g, '');
    const semAspas = semAspasDe(semContinuacao);
    const semEscape = semEscapeDe(semAspas);
    if (grande && LIBERAR_ESPACADO.test(semEscape)) return true;
    // (a)
    if (semEscape.includes('hadouken:liberar')) return true;
    // (b), sem o trailer do Claude (rodada 4)
    const bCont = semTrailer(semContinuacao);
    const mudou = bCont !== semContinuacao;
    const bAspas = mudou ? semAspasDe(bCont) : semAspas;
    const bEscape = mudou ? semEscapeDe(bAspas) : semEscape;
    const palavraClaude = [bCont, bAspas, bEscape].some((v) => PACOTE.test(v) || PALAVRA_CLAUDE.test(v));
    if (palavraClaude) {
      if (LIBERAR_PALAVRA.test(bCont) || LIBERAR_PALAVRA.test(bEscape)) return true;
      if (bEscape.includes('hadouken') && EXPANSAO_LARGA.test(bCont)) return true;
    }
    // (c)
    const liberar = DOIS_PONTOS_LIBERAR.test(semEscape) || LIBERAR_CURTO.test(semEscape);
    const expansao = bruto.includes('hadouken') && /[{$`*?]/.test(bruto);
    if (!liberar && !expansao) return false;
    const l = lancamentoDe(bruto);
    return l === CLAUDE_LANCADO || (l === INCERTO && liberar);
  } catch {
    return true;
  }
}

// Hook da agenda (C1 da revisão final da parte 1, guarda-agenda.js): o texto
// que vai virar prompt de uma tarefa agendada (CronCreate), de um loop
// (ScheduleWakeup) ou de uma rotina (RemoteTrigger) pede a liberação quando
// tem o teste (a) do claudeComLiberar ('hadouken:liberar' no texto
// normalizado: sem continuação de linha, aspas, crase, ^ e barra invertida,
// em minúsculas) ou '/liberar' como palavra (a metade '/' de LIBERAR_PALAVRA:
// fora de um caminho, sem outro nome grudado depois; 'liberar.' no fim da
// frase conta). Nega a mais: um lembrete que só cita o comando também nega, e
// o texto do deny pede para tirá-lo do prompt. Só texto, linear, e nunca
// lança: na dúvida, true.
const BARRA_LIBERAR = /(?<![a-z0-9_./-])\/liberar(?![a-z0-9_/-]|\.[a-z0-9_])/;
export function pedeLiberacao(texto) {
  try {
    if (typeof texto !== 'string') return false;
    const normal = semEscapeDe(semAspasDe(texto.toLowerCase().replace(/[\\`^]\r?\n/g, '')));
    return normal.includes('hadouken:liberar') || BARRA_LIBERAR.test(normal);
  } catch {
    return true;
  }
}
