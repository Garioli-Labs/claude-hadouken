import crypto from 'node:crypto';
import { numeroFinito, somaSegura } from './base.js';

// Custo dos hooks no /consumo (spec v0.4.0 §9.4; decisões 11 e 12 do plano da
// parte 2): por plugin, execuções, injeções, caracteres injetados, p50 e p95
// da duração, timeouts; compactações por sessão e por subagente. Tudo aqui é
// puro (sem E/S; indice-hooks.js lê os arquivos). Fronteira de segurança: o
// stdout dos hooks e o comando vêm de transcripts, texto de qualquer plugin,
// e podem trazer instrução. Daqui só saem números, o hash do comando e
// rótulos que casam ROTULO_PLUGIN; o texto nunca é guardado nem devolvido.
// Nunca lança.

export const EVENTOS_HOOK = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionEnd', 'Notification',
  'PreModelSwitch', 'PostModelSwitch', 'outro',
]);
export const TIPO = Object.freeze({ execucao: 0, timeout: 1, compactacaoSessao: 2, compactacaoSubagente: 3 });
// Nome de plugin como o installed_plugins.json guarda antes do @: letras,
// dígitos, ponto, sublinhado e hífen, até 64. Nada com espaço ou controle.
export const ROTULO_PLUGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Os parênteses nunca casam ROTULO_PLUGIN: um plugin não se passa por eles.
export const OUTROS = '(outros)';
export const AMBIGUO = '(ambíguo)';
const COMANDO_MAX = 8192;
const STDOUT_JSON_MAX = 1024 * 1024;
const CHARS_MAX = 1e9;
const DURACAO_MAX_MS = 3_600_000;
const UUID = /^[A-Za-z0-9-]{1,64}$/;
const HASH = /^[0-9a-f]{16}$/;
const HOOKS_MAX = 500;
const PLUGINS_MAX = 200;
const INSTALACOES_MAX = 8;
const LINHAS_MAX = 20;
const SEM_JSON_NO_CONTEXTO = new Set(['SessionStart', 'UserPromptSubmit']);
const EXECUCAO = new Set(['hook_success', 'hook_non_blocking_error', 'hook_blocking_error', 'hook_cancelled']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inteiroEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

export function hashComando(texto) {
  if (typeof texto !== 'string' || texto === '' || texto.length > COMANDO_MAX) return null;
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, 16);
}

// Caracteres que o hook pôs no contexto (decisão 12): additionalContext +
// systemMessage do stdout em JSON; stdout sem JSON só conta em SessionStart e
// UserPromptSubmit, onde o Claude Code o põe no contexto. Saída com exitCode
// diferente de 0 não injeta. Só o tamanho sai daqui.
export function injetados(stdout, evento, exitCode) {
  try {
    if (typeof stdout !== 'string' || stdout === '') return 0;
    if (exitCode !== undefined && exitCode !== 0) return 0;
    const t = stdout.trim();
    if (t.startsWith('{') && t.length <= STDOUT_JSON_MAX) {
      let o = null;
      try { o = JSON.parse(t); } catch { o = null; }
      if (ehObjeto(o)) {
        const extra = ehObjeto(o.hookSpecificOutput) && typeof o.hookSpecificOutput.additionalContext === 'string' ? o.hookSpecificOutput.additionalContext.length : 0;
        const sistema = typeof o.systemMessage === 'string' ? o.systemMessage.length : 0;
        return Math.min(CHARS_MAX, extra + sistema);
      }
    }
    return SEM_JSON_NO_CONTEXTO.has(evento) ? Math.min(CHARS_MAX, stdout.length) : 0;
  } catch {
    return 0;
  }
}

const eventoDe = (e) => {
  const i = typeof e === 'string' ? EVENTOS_HOOK.indexOf(e) : -1;
  return i === -1 ? EVENTOS_HOOK.indexOf('outro') : i;
};

// Uma linha de transcript já decodificada → [ts, u, h, ev, ms, chars, tipo]:
// ts em ms; u o uuid da linha (ou null; só serve para não contar duas vezes a
// mesma linha); h o hash do comando (ou null); ev a posição em EVENTOS_HOOK;
// ms a duração (ou null); chars os caracteres injetados; tipo de TIPO. Só
// execuções e compactações viram item; hook_additional_context e afins, não.
// A conta é só pela linha da execução, sem casar com a linha de contexto por
// toolUseID|hookEvent|hookName (registro da Task 1, 89387 hook_success): o
// SessionStart grava uma linha de contexto mesclada e o UserPromptSubmit um
// hookName sem sufixo, e 523 delas nunca casam. A linha de contexto nunca é
// outra execução, e o texto do SessionStart e do PreToolUse já está no stdout
// do hook_success. Ficam de fora, e a Task 20 declara: o hook com stdout vazio
// (não grava hook_success) e a injeção do UserPromptSubmit (nenhum
// hook_success desse evento no corpus local; a linha de contexto dele não traz
// comando nem duração). Outra linha → null.
export function registroDeLinha(d, subagente) {
  try {
    if (!ehObjeto(d)) return null;
    const ts = typeof d.timestamp === 'string' && d.timestamp.length <= 64 ? Date.parse(d.timestamp) : Number.NaN;
    if (!Number.isFinite(ts)) return null;
    const u = typeof d.uuid === 'string' && UUID.test(d.uuid) ? d.uuid : null;
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      return [ts, u, null, null, null, 0, subagente === true ? TIPO.compactacaoSubagente : TIPO.compactacaoSessao];
    }
    const a = d.attachment;
    if (!ehObjeto(a) || !EXECUCAO.has(a.type)) return null;
    const ms = inteiroEntre(a.durationMs, 0, DURACAO_MAX_MS) ? a.durationMs : null;
    const chars = a.type === 'hook_success' ? injetados(a.stdout, a.hookEvent, a.exitCode) : 0;
    const tipo = a.type === 'hook_cancelled' && a.timedOut === true ? TIPO.timeout : TIPO.execucao;
    return [ts, u, hashComando(a.command), eventoDe(a.hookEvent), ms, chars, tipo];
  } catch {
    return null;
  }
}

// Forma de um item guardado no índice (indice-hooks.js revalida com esta
// função tudo o que lê do disco).
export function ITEM_VALIDO(it) {
  if (!Array.isArray(it) || it.length !== 7) return false;
  const [ts, u, h, ev, ms, chars, tipo] = it;
  if (!numeroFinito(ts) || !(u === null || (typeof u === 'string' && UUID.test(u)))) return false;
  if (!(h === null || (typeof h === 'string' && HASH.test(h)))) return false;
  if (!(ev === null || inteiroEntre(ev, 0, EVENTOS_HOOK.length - 1))) return false;
  if (!(ms === null || inteiroEntre(ms, 0, DURACAO_MAX_MS))) return false;
  return inteiroEntre(chars, 0, CHARS_MAX) && inteiroEntre(tipo, 0, 3);
}

// Textos de comando de um hooks/hooks.json (decisão 11): a forma shell
// (`command` sem `args`) e, na forma exec (`args` só de texto), as duas formas
// em que ela pode aparecer no transcript (juntada com espaço, e com cada arg
// entre aspas JSON). O `command` puro de uma forma exec (`node`) não entra:
// todo hook exec de todo plugin o compartilha, e ele atribuiria ao plugin os
// hooks dos outros (F5 do pré-voo). Até HOOKS_MAX textos; formas estranhas são
// ignoradas.
export function comandosDeHooks(valor) {
  const r = [];
  try {
    const eventos = ehObjeto(valor) && ehObjeto(valor.hooks) ? valor.hooks : null;
    if (eventos === null) return r;
    for (const ev of Object.keys(eventos)) {
      const grupos = eventos[ev];
      if (!Array.isArray(grupos)) continue;
      for (const g of grupos) {
        const hs = ehObjeto(g) && Array.isArray(g.hooks) ? g.hooks : [];
        for (const h of hs) {
          if (r.length >= HOOKS_MAX) return r;
          if (!ehObjeto(h) || h.type !== 'command' || typeof h.command !== 'string' || h.command === '' || h.command.length > COMANDO_MAX) continue;
          if (h.args === undefined) {
            r.push(h.command);
          } else if (Array.isArray(h.args) && h.args.length > 0 && h.args.length <= 64 && h.args.every((x) => typeof x === 'string')) {
            r.push([h.command, ...h.args].join(' '), [h.command, ...h.args.map((x) => JSON.stringify(x))].join(' '));
          }
        }
      }
    }
    return r;
  } catch {
    return r;
  }
}

// hash do comando → rótulo do plugin (o nome antes do @ na chave de
// installed_plugins.json; spec §9.4: "o nome, sem o caminho"). `lerHooks`
// recebe o installPath e devolve o hooks.json lido (ou null); é a única E/S, e
// vem injetada. O mesmo comando em dois plugins → AMBIGUO. Nunca lança; numa
// falha, mapa vazio (tudo cai em OUTROS).
export function mapaDePlugins(instalados, lerHooks) {
  const mapa = new Map();
  try {
    const plugins = ehObjeto(instalados) && ehObjeto(instalados.plugins) ? instalados.plugins : null;
    if (plugins === null) return mapa;
    for (const chave of Object.keys(plugins).slice(0, PLUGINS_MAX)) {
      const rotulo = chave.split('@')[0];
      if (!ROTULO_PLUGIN.test(rotulo) || !Array.isArray(plugins[chave])) continue;
      for (const inst of plugins[chave].slice(0, INSTALACOES_MAX)) {
        const p = ehObjeto(inst) ? inst.installPath : null;
        if (typeof p !== 'string' || p === '') continue;
        for (const c of comandosDeHooks(lerHooks(p))) {
          const h = hashComando(c);
          if (h === null) continue;
          const atual = mapa.get(h);
          mapa.set(h, atual === undefined || atual === rotulo ? rotulo : AMBIGUO);
        }
      }
    }
    return mapa;
  } catch {
    return new Map();
  }
}

// Percentil pela posição (nearest rank): o ⌈q·n⌉-ésimo valor em ordem.
const percentil = (ordenados, q) => (ordenados.length === 0 ? null : ordenados[Math.max(0, Math.ceil(q * ordenados.length) - 1)]);

// Itens (de indexarHooks) → resumo por plugin. Itens com ts < desdeMs saem; o
// mesmo uuid conta uma vez. Durações só das execuções que terminaram (o
// timeout conta em execuções e timeouts, não no p50/p95). Ordem: caracteres,
// depois execuções, depois nome; até LINHAS_MAX linhas, o resto em omitidos.
export function resumirCusto(itens, mapa, desdeMs) {
  const vazio = () => ({ plugins: [], omitidos: 0, compactacoes: { sessao: 0, subagente: 0 } });
  try {
    if (!Array.isArray(itens)) return vazio();
    const m = mapa instanceof Map ? mapa : new Map();
    const corte = numeroFinito(desdeMs) ? desdeMs : 0;
    const r = vazio();
    const vistos = new Set();
    const por = new Map();
    for (const it of itens) {
      if (!ITEM_VALIDO(it) || it[0] < corte) continue;
      const [, u, h, , ms, chars, tipo] = it;
      if (u !== null) {
        if (vistos.has(u)) continue;
        vistos.add(u);
      }
      if (tipo === TIPO.compactacaoSessao) { r.compactacoes.sessao++; continue; }
      if (tipo === TIPO.compactacaoSubagente) { r.compactacoes.subagente++; continue; }
      const plugin = (h !== null && m.get(h)) || OUTROS;
      let p = por.get(plugin);
      if (p === undefined) por.set(plugin, (p = { plugin, execucoes: 0, injecoes: 0, caracteres: 0, duracoes: [], timeouts: 0 }));
      p.execucoes++;
      if (chars > 0) p.injecoes++;
      // A soma que para em Number.MAX_SAFE_INTEGER mora em base.js (casa-unica.test.js).
      p.caracteres = somaSegura(p.caracteres, chars);
      if (tipo === TIPO.timeout) p.timeouts++;
      else if (ms !== null) p.duracoes.push(ms);
    }
    const linhas = [...por.values()]
      .map((p) => {
        const d = p.duracoes.sort((a, b) => a - b);
        return { plugin: p.plugin, execucoes: p.execucoes, injecoes: p.injecoes, caracteres: p.caracteres, p50: percentil(d, 0.5), p95: percentil(d, 0.95), timeouts: p.timeouts };
      })
      .sort((a, b) => b.caracteres - a.caracteres || b.execucoes - a.execucoes || (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
    r.plugins = linhas.slice(0, LINHAS_MAX);
    r.omitidos = Math.max(0, linhas.length - LINHAS_MAX);
    return r;
  } catch {
    return vazio();
  }
}
