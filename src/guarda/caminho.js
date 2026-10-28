import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Apoio da P4 e da P5 (spec v0.4.0 §4.2, S13 e spike S9).

const WIN = process.platform === 'win32';
const normal = (p) => (WIN ? p.toLowerCase() : p);

// Rodada 1 da revisão da Task 0 da parte 2: no Windows, o compartilhamento
// administrativo da própria máquina (\\localhost\C$\x, \\127.0.0.1\C$\x,
// \\?\UNC\localhost\C$\x, com barra normal também, e o nome da máquina) é o
// mesmo C:\x, e o realpath mantém a forma UNC; vira a letra do disco antes e
// depois do realpath. Só texto, nenhum acesso à rede. Outro nome da mesma
// máquina (apelido de DNS, IP da rede, IPv6) fica de fora (R1).
const ADMIN = /^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)[\\/]([a-z])\$(?=[\\/]|$)/i;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3})$/i;
function semCompartilhamentoAdmin(p) {
  if (!WIN) return p;
  const m = ADMIN.exec(p);
  if (m === null) return p;
  const host = m[1].toLowerCase();
  if (!LOOPBACK.test(host) && host !== os.hostname().toLowerCase()) return p;
  const resto = p.slice(m[0].length);
  return `${m[2].toUpperCase()}:${resto === '' ? path.sep : resto}`;
}

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
    const escrito = path.resolve(semCompartilhamentoAdmin(p));
    let atual = escrito;
    const resto = [];
    for (;;) {
      try {
        return semCompartilhamentoAdmin(path.join(fs.realpathSync.native(atual), ...resto.reverse()));
      } catch {
        const pai = path.dirname(atual);
        if (pai === atual) return escrito;
        resto.push(path.basename(atual));
        atual = pai;
      }
    }
  } catch {
    return null;
  }
}

// O alvo relativo à pasta, os dois já pelo caminho real e com a caixa do
// Windows normalizada: '' para a própria pasta, null fora dela.
function relativoReal(a, b) {
  if (a === null || b === null) return null;
  const rel = path.relative(normal(a), normal(b));
  // Fora é ".." ou "../algo"; um filho chamado "..x" continua dentro.
  const sobe = rel === '..' || rel.startsWith(`..${path.sep}`);
  return rel === '' || (!sobe && !path.isAbsolute(rel)) ? rel : null;
}

export function dentroDe(pasta, alvo) {
  return relativoReal(caminhoReal(pasta), caminhoReal(alvo)) !== null;
}

// O caminho real com a caixa do Windows normalizada: a mesma comparação do
// dentroDe (links, '..', 8.3, compartilhamento administrativo, caixa no
// win32), como texto, para servir de chave (a fotografia dos settings da Task
// 19b, config-base.js). Relativo, vazio, longo demais ou não texto: null.
// Nunca lança.
export function caminhoComparavel(p) {
  const real = caminhoReal(p);
  return real === null ? null : normal(real);
}

// --- P5 estendida: settings e o próprio plugin (Task 0 da parte 2) ---------
// A revisão final da parte 1 achou que o Write ou o Edit no cache do plugin
// ou no settings.json desligam a guarda a partir do próximo hook, sem shell:
// a doc diz que o disableAllHooks dos settings do usuário, do projeto ou
// locais desliga os hooks de plugin, e que os settings são relidos durante a
// sessão. Classes do alvo:
// - 'settings': settings.json e settings.local.json do usuário, em
//   <casa>/.claude e no CLAUDE_CONFIG_DIR. A P5 nega sempre (decisão do Sr.
//   Garioli, 2026-09-30).
// - 'plugin': dentro da raiz do plugin (CLAUDE_PLUGIN_ROOT, só absoluto) ou
//   em <config>/plugins/ com 'claude-hadouken' no trecho depois de plugins/
//   (o cache instalado e o marketplace). A P5 nega sempre.
// - 'settings-projeto': qualquer outro .claude/settings.json ou
//   .claude/settings.local.json. A P5 nega só pelo texto novo (mexeNaGuarda,
//   decisão do controlador na Task 0 da parte 2).
// - null: o resto.
// O caminho real é o mesmo do dentroDe (links, '..', 8.3, caixa no Windows).
// O 'claude-hadouken' e o nome do settings de projeto são procurados sem
// diferenciar maiúsculas em todo sistema: o macOS não diferencia por padrão,
// e negar a mais um nome com outra caixa não custa nada.
const SETTINGS = ['settings.json', 'settings.local.json'];
const absoluto = (p) => typeof p === 'string' && p.length > 0 && path.isAbsolute(p);

function ehSettingsDeProjeto(p) {
  const n = p.toLowerCase();
  return SETTINGS.includes(path.basename(n)) && path.basename(path.dirname(n)) === '.claude';
}

export function arquivoProtegido(alvo, { casa, configDir, raizPlugin } = {}) {
  const b = caminhoReal(alvo);
  if (b === null) return null;
  const dentro = (pasta) => relativoReal(caminhoReal(pasta), b);
  const configs = [];
  if (absoluto(casa)) configs.push(path.join(casa, '.claude'));
  if (absoluto(configDir)) configs.push(configDir);
  for (const c of configs) {
    for (const nome of SETTINGS) if (dentro(path.join(c, nome)) === '') return 'settings';
  }
  if (absoluto(raizPlugin) && dentro(raizPlugin) !== null) return 'plugin';
  for (const c of configs) {
    const rel = dentro(path.join(c, 'plugins'));
    if (rel !== null && rel.toLowerCase().includes('claude-hadouken')) return 'plugin';
  }
  // O nome escrito e o real: um .claude que é link para outra pasta conta
  // pelo nome escrito.
  return ehSettingsDeProjeto(path.resolve(alvo)) || ehSettingsDeProjeto(b) ? 'settings-projeto' : null;
}

// Os escapes do JSON desfeitos numa passada só, como o JSON.parse faria:
// \uXXXX, \n, \t, \r, \b, \f, \", \\ e \/ ("disableAllHooks" é a mesma
// chave para o Claude Code). Também usado no texto cru da agenda, que não
// chega ao JSON.parse: lá o '\n' antes de '/liberar' é uma quebra de linha,
// não a letra n colada na barra (rodada 3 da revisão da Task 0). A barra
// invertida escapada (\\n) vira uma barra e a letra, e escape inválido fica
// como está.
const ESCAPES_JSON = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const ESCAPE_JSON = /\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g;
export const desfazEscapesJson = (t) => t.replace(ESCAPE_JSON, (_, h, c) => (h === undefined ? ESCAPES_JSON[c] : String.fromCharCode(parseInt(h, 16))));

// Settings de projeto (decisão do controlador na Task 0 da parte 2): a edição
// mexe nos hooks ou nos plugins quando o texto dela tem, sem diferenciar
// maiúsculas e com os escapes do JSON desfeitos, disableAllHooks, enabledPlugins,
// "hooks" (a chave, entre aspas) ou claude-hadouken. Conta o texto novo do
// Write (content), do Edit (new_string) e do MultiEdit (cada
// edits[].new_string) e, desde a rodada 1 da revisão, o texto antigo
// (old_string e cada edits[].old_string): apagar ou trocar a chave é mexer
// nela. Campo que não é texto não conta.
// O arquivo atual, lido por lerAtual() (o hook passa o lerTextoSemLink de
// arquivo.js: lstat antes, teto); a leitura que falha mexe (na dúvida,
// nega). Arquivo ausente não tem chave atual: o Edit com old_string falha
// nele, e o texto novo de quem o cria já foi conferido.
// - Filtro barato (rodada 1): um old_string curto (abaixo de 40 caracteres,
//   como 'false' ou 'true') casa dentro de uma chave que já está no arquivo e
//   vira o valor dela sem citá-la, e o Write troca o arquivo todo; nesses dois
//   casos, o arquivo atual com uma das palavras mexe.
// - Simulação (rodada 2): a edição aplicada ao arquivo atual (mudaChaves).
//   Fecha o old_string longo que cobre só o valor e a chave montada em várias
//   edições.
// Resíduo (R1, SECURITY.md): o sed -i pelo Bash ou pelo PowerShell.
const CHAVES_DA_GUARDA = ['disableallhooks', 'enabledplugins', '"hooks"', 'claude-hadouken'];
const OLD_CURTO = 40;
const temChave = (t) => {
  if (typeof t !== 'string') return false;
  const n = desfazEscapesJson(t).toLowerCase();
  return CHAVES_DA_GUARDA.some((c) => n.includes(c));
};

// A simulação (rodada 2 da revisão da Task 0): Edit troca a primeira
// ocorrência do old_string, ou todas com replace_all; MultiEdit aplica as
// edições em ordem; Write vale o content. O old_string que não está no texto,
// um replace_all que não é booleano, a ferramenta desconhecida e o resultado
// acima dos tetos fazem a simulação falhar (null). old_string vazio só cria:
// vale num arquivo em branco. O fim de linha CRLF vira LF dos dois lados (fora
// das strings do JSON, é só espaço). Tetos: o resultado de 2 MiB (o dobro da
// leitura) e o trabalho somado de 32 MiB de texto, então um replace_all de um
// caractere num arquivo grande não trava o hook.
const TETO_RESULTADO = 2_097_152;
const TETO_TRABALHO = 33_554_432;
const semCR = (t) => t.replace(/\r\n/g, '\n');
function simular(texto, input, ferramenta) {
  if (ferramenta === 'Write') return typeof input.content === 'string' ? semCR(input.content) : null;
  let edicoes;
  if (ferramenta === 'Edit') edicoes = [input];
  else if (ferramenta === 'MultiEdit' && Array.isArray(input.edits)) edicoes = input.edits;
  else return null;
  let atual = semCR(texto);
  let trabalho = 0;
  for (const e of edicoes) {
    if (e === null || typeof e !== 'object' || typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null;
    if (e.replace_all !== undefined && typeof e.replace_all !== 'boolean') return null;
    const velho = semCR(e.old_string);
    const novo = semCR(e.new_string);
    if (velho === '') {
      if (atual.trim() !== '') return null;
      atual = novo;
    } else {
      const i = atual.indexOf(velho);
      if (i < 0) return null;
      let n = 1;
      if (e.replace_all === true) {
        for (let j = atual.indexOf(velho, i + velho.length); j >= 0; j = atual.indexOf(velho, j + velho.length)) n += 1;
      }
      if (atual.length + n * (novo.length - velho.length) > TETO_RESULTADO) return null;
      atual = e.replace_all === true ? atual.split(velho).join(novo) : atual.slice(0, i) + novo + atual.slice(i + velho.length);
    }
    trabalho += atual.length;
    if (trabalho > TETO_TRABALHO) return null;
  }
  return atual;
}

function lerJsonTexto(texto) {
  try {
    return { ok: true, valor: JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto) };
  } catch {
    return { ok: false };
  }
}

// As chaves de topo que desligam a guarda; ausente vale undefined.
const CHAVES_JSON = ['disableAllHooks', 'enabledPlugins', 'hooks'];
const chaveDe = (v, k) => (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, k) ? v[k] : undefined);

// Igualdade profunda de dois valores do JSON, sem recursão: o JSON.parse
// aceita centenas de milhares de níveis, e a recursão estouraria a pilha. A
// ordem das chaves de um objeto não conta.
function igualJson(a, b) {
  const pilha = [[a, b]];
  while (pilha.length > 0) {
    const [x, y] = pilha.pop();
    if (x === y) continue;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    for (const k of kx) {
      if (!Object.hasOwn(y, k)) return false;
      pilha.push([x[k], y[k]]);
    }
  }
  return true;
}

// Mexe quando a simulação falha, quando o valor de disableAllHooks,
// enabledPlugins ou hooks muda, ou quando o resultado deixa de ser JSON num
// arquivo que tinha uma delas. Sem o JSON (o resultado num arquivo sem as
// chaves, ou o próprio arquivo atual fora do JSON estrito), vale o texto: mexe
// quando o resultado, ou o atual que não é JSON, tem uma das palavras.
function mudaChaves(texto, input, ferramenta) {
  const depois = simular(texto, input, ferramenta);
  if (depois === null) return true;
  const a = lerJsonTexto(texto);
  const d = lerJsonTexto(depois);
  if (a.ok && d.ok) return CHAVES_JSON.some((k) => !igualJson(chaveDe(a.valor, k), chaveDe(d.valor, k)));
  if (a.ok && CHAVES_JSON.some((k) => chaveDe(a.valor, k) !== undefined)) return true;
  return temChave(depois) || (!a.ok && temChave(texto));
}

// ferramenta: o tool_name (Write, Edit ou MultiEdit), para a simulação. Nunca
// lança: uma exceção aqui dentro mexe (nega), em vez de cair no fail-open do
// falharAberto.
export function mexeNaGuarda(input, lerAtual, ferramenta) {
  try {
    if (input === null || typeof input !== 'object') return false;
    const edicoes = Array.isArray(input.edits) ? input.edits.filter((e) => e !== null && typeof e === 'object') : [];
    const antigos = [input.old_string, ...edicoes.map((e) => e.old_string)].filter((t) => typeof t === 'string');
    if ([input.content, input.new_string, ...edicoes.map((e) => e.new_string), ...antigos].some(temChave)) return true;
    if (typeof lerAtual !== 'function') return true;
    const atual = lerAtual();
    if (atual?.ok !== true) return atual?.motivo !== 'ausente';
    if (typeof atual.texto !== 'string') return true;
    const curto = typeof input.content === 'string' || antigos.some((t) => t.length < OLD_CURTO);
    if (curto && temChave(atual.texto)) return true;
    return mudaChaves(atual.texto, input, ferramenta);
  } catch {
    return true;
  }
}

// Emenda 6 (v0.5.4, pedido do Metrô SP): a edição de settings de projeto que
// só ACRESCENTA ganchos vira pergunta ao usuário (com o diff do Claude Code)
// em vez de negação. Só acrescenta quando o arquivo atual (ou ausente) e o
// resultado da simulação são JSON de objeto; disableAllHooks e enabledPlugins
// não mudam; cada grupo de ganchos que existia sobrevive num grupo do mesmo
// evento com todos os ganchos dele e um matcher igual ou mais largo (as
// alternativas separadas por | contêm as de antes); e nenhum gancho novo cita
// o hadouken. Remover, desligar, estreitar ou mexer no hadouken: false, e a
// P5 nega como antes. Nunca lança: na dúvida, false.
// Sem matcher, '' e '*' casam tudo; outro valor que não é texto não se lê.
const casaTudo = (m) => m === undefined || m === '' || m === '*';
function matcherCobre(antes, depois) {
  if (casaTudo(depois)) return casaTudo(antes) || typeof antes === 'string';
  if (typeof antes !== 'string' || typeof depois !== 'string' || casaTudo(antes)) return false;
  const d = new Set(depois.split('|'));
  return antes.split('|').every((x) => d.has(x));
}
function grupoCobre(velho, novo) {
  if (!ehObj(velho) || !ehObj(novo) || !matcherCobre(velho.matcher, novo.matcher)) return false;
  const hv = Array.isArray(velho.hooks) ? velho.hooks : [];
  const hn = Array.isArray(novo.hooks) ? novo.hooks : [];
  return hv.every((h) => hn.some((n) => igualJson(h, n)));
}
const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function soAcrescentaGanchos(input, lerAtual, ferramenta) {
  try {
    if (!ehObj(input) || typeof lerAtual !== 'function') return false;
    const atual = lerAtual();
    let texto;
    if (atual?.ok === true && typeof atual.texto === 'string') texto = atual.texto;
    else if (atual?.motivo === 'ausente') texto = '';
    else return false;
    const depois = simular(texto, input, ferramenta);
    if (depois === null) return false;
    const a = texto.trim() === '' ? { ok: true, valor: {} } : lerJsonTexto(texto);
    const d = lerJsonTexto(depois);
    if (!a.ok || !d.ok || !ehObj(a.valor) || !ehObj(d.valor)) return false;
    for (const k of ['disableAllHooks', 'enabledPlugins']) if (!igualJson(chaveDe(a.valor, k), chaveDe(d.valor, k))) return false;
    const ha = chaveDe(a.valor, 'hooks') ?? {};
    const hd = chaveDe(d.valor, 'hooks') ?? {};
    if (!ehObj(ha) || !ehObj(hd)) return false;
    if (igualJson(ha, hd)) return false; // nada de gancho mudou: não é este caso
    for (const evento of Object.keys(hd)) {
      const gd = hd[evento];
      if (!Array.isArray(gd)) return false;
      const gv = Object.hasOwn(ha, evento) ? ha[evento] : [];
      if (!Array.isArray(gv)) return false;
      const usados = new Set();
      for (const g of gv) {
        const i = gd.findIndex((n, j) => !usados.has(j) && grupoCobre(g, n));
        if (i < 0) return false;
        usados.add(i);
      }
      // Gancho que entrou de novo não pode citar o hadouken.
      const antigos = gv.flatMap((g) => (ehObj(g) && Array.isArray(g.hooks) ? g.hooks : []));
      for (const n of gd) {
        if (!ehObj(n) || !Array.isArray(n.hooks)) return false;
        for (const h of n.hooks) {
          if (!antigos.some((v) => igualJson(v, h)) && /hadouken/i.test(desfazEscapesJson(JSON.stringify(h)))) return false;
        }
      }
    }
    for (const evento of Object.keys(ha)) if (!Object.hasOwn(hd, evento)) return false;
    return true;
  } catch {
    return false;
  }
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

// Emenda 3 (spec v0.5.3 VS Code §12.1): o cwd do hook, no comando, vira '.'
// antes dos testes. O caminho 'C:/Projetos DEV/Claude Hadouken/...' tinha um
// 'Claude' depois de espaço, e a P4 negava todo node ou bash que citasse um
// arquivo do projeto. Troca só o cwd inteiro (sem diferenciar maiúsculas, com
// / ou \, e na forma /c/... do bash do Git) seguido de separador, aspa,
// espaço ou fim; o resto do comando continua conferido. Não troca nada com
// um cwd relativo, só raiz, ou cujo último segmento é claude (com .exe, .cmd
// ou .ps1 opcionais: o próprio cwd poderia ser o executável). Devolve o texto em minúsculas, que
// os dois testes já comparam assim.
// Revisão do branch (achado 1): um cwd com metacaractere do shell ('z; claude')
// não é trocado, porque a troca apagaria a chamada que vem no próprio nome.
const FIM_DO_CWD = /^(?:[\\/"'\s]|$)/;
const META_SHELL = /[;&|()<>$`"'\r\n^%!*?{}]/;
function formasDoCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length > 4096 || META_SHELL.test(cwd)) return [];
  const limpo = cwd.toLowerCase().replace(/[\\/]+$/, '');
  const segs = limpo.split(/[\\/]+/).filter(Boolean);
  const absoluto = /^[a-z]:[\\/]/.test(cwd.toLowerCase()) || cwd.startsWith('/') || cwd.startsWith('\\\\');
  const raiz = segs.length === 0 || (segs.length === 1 && /^[a-z]:$/.test(segs[0]));
  if (!absoluto || raiz || /^claude(?:\.exe|\.cmd|\.ps1)?$/.test(segs[segs.length - 1])) return [];
  const barra = limpo.replace(/\\/g, '/');
  const formas = new Set([barra, barra.replace(/\//g, '\\')]);
  const drive = /^([a-z]):\/(.*)$/.exec(barra);
  if (drive) formas.add(`/${drive[1]}/${drive[2]}`);
  return [...formas].sort((a, b) => b.length - a.length);
}
export function semCwd(comando, cwd) {
  let texto = comando.toLowerCase();
  for (const forma of formasDoCwd(cwd)) {
    let saida = '';
    let i = 0;
    for (let j = texto.indexOf(forma); j !== -1; j = texto.indexOf(forma, j + 1)) {
      if (j < i || !FIM_DO_CWD.test(texto.slice(j + forma.length, j + forma.length + 1))) continue;
      saida += `${texto.slice(i, j)}.`;
      i = j + forma.length;
    }
    texto = saida + texto.slice(i);
  }
  return texto;
}
// Revisão do branch (achado 2): fora do cwd, um caminho absoluto entre aspas
// ("C:/Projetos DEV/Claude Hadouken/...", '/c/x/Claude Code/y') também vira
// '.', para o 'Claude' de um segmento não contar como o executável. Só o
// caminho inteiro entre aspas iguais, sem metacaractere do shell nem ':' fora
// do drive (então 'hadouken:liberar' nunca some), e nunca o que termina no
// próprio claude ("C:/x/claude.exe" -p continua sendo claude). Recebe e
// devolve minúsculas. Fica como está (e conferido) o texto entre aspas que
// pode ser um comando: o argumento de -c, /c, -Command, eval ou iex; o que
// tem uma opção (' -p'); e o que traz claude depois de espaço ou o pacote
// claude-code.
const ENTRE_ASPAS = /(["'])((?:[a-z]:[\\/]|\/)[^"'\r\n;&|$`()<>*?{}!%:^]*)\1/g;
const FIM_CLAUDE = /(?:^|[\\/])claude(?:\.exe|\.cmd|\.ps1)?[\\/]*$/;
// Só o formato do falso positivo: um segmento que começa por 'claude ' e
// continua como pasta ('/Claude Hadouken/'); o resto entre aspas fica.
const PASTA_CLAUDE = /[\\/]claude\s[^\\/]*[\\/]/;
const PODE_SER_COMANDO = /\s-|\sclaude(?:\.exe|\.cmd|\.ps1)?(?:\s|$)|claude-code|liberar|aprender/;
const ANTES_DE_COMANDO = /(?:^|\s)(?:\/[ck]|-[a-z]*c|-co(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?|eval|iex|invoke-expression)\s*$/;
function semCaminhosEntreAspas(t) {
  return t.replace(ENTRE_ASPAS, (todo, aspa, c, i) => {
    if (!PASTA_CLAUDE.test(c) || FIM_CLAUDE.test(c) || PODE_SER_COMANDO.test(c) || ANTES_DE_COMANDO.test(t.slice(Math.max(0, i - 40), i))) return todo;
    return `${aspa}.${aspa}`;
  });
}
const comCwd = (comando, opcoes) => {
  if (typeof comando !== 'string') return comando;
  return semCaminhosEntreAspas(typeof opcoes?.cwd === 'string' ? semCwd(comando, opcoes.cwd) : comando.toLowerCase());
};

export function chamaClaude(comandoBruto, opcoes) {
  if (typeof comandoBruto !== 'string') return false;
  let comando;
  try {
    comando = comCwd(comandoBruto, opcoes);
  } catch {
    return true;
  }
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
// (b): ':liberar' com qualquer coisa antes (hadouken:liberar) ou
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

export function claudeComLiberar(comandoBruto, opcoes) {
  try {
    if (typeof comandoBruto !== 'string') return false;
    const comando = comCwd(comandoBruto, opcoes);
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
// Desde a rodada 1 da revisão da Task 11 do aprendizado (segunda metade do
// I1 do preflight), o mesmo teste vale para o /hadouken:aprender
// ('hadouken:aprender' ou '/aprender' como palavra): o `aprovar` afrouxa a
// guarda e o `desligar` tira o aprendizado, então ele também só vale
// digitado pelo usuário.
const BARRA_LIBERAR = /(?<![a-z0-9_./-])\/(?:liberar|aprender)(?![a-z0-9_/-]|\.[a-z0-9_])/;
export function pedeLiberacao(texto) {
  try {
    if (typeof texto !== 'string') return false;
    const normal = semEscapeDe(semAspasDe(texto.toLowerCase().replace(/[\\`^]\r?\n/g, '')));
    return normal.includes('hadouken:liberar') || normal.includes('hadouken:aprender') || BARRA_LIBERAR.test(normal);
  } catch {
    return true;
  }
}
