import { AMBIGUO, OUTROS, ROTULO_PLUGIN } from '../custo-hooks.js';

// Compatibilidade e conflitos (spec v0.5.5 §6.G e §6.H). Puro: as leituras
// ficam no coletor (conflitos, uma vez a cada 24 h, em conflitos.json) e no
// SessionStart (versões). Só relata; nada é desativado. Texto ao usuário só
// com rótulos fixos, versões no formato x.y.z e nomes de plugin que casam
// ROTULO_PLUGIN (o resto vira "(outros)").

// As ferramentas que a guarda vigia em PreToolUse (hooks/hooks.json; o teste
// confere). O matcher de MCP da agenda fica de fora: é regex sobre nomes de
// servidor, e outro plugin raramente decide nele.
export const FERRAMENTAS_GUARDA = Object.freeze([
  'Agent', 'Task', 'Workflow', 'Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'CronCreate', 'ScheduleWakeup', 'RemoteTrigger',
]);
const LENTO_MS = 500;
const ITENS_MAX = 10;
const AVISO_MAX = 300;
const MATCHER_MAX = 512;
const VERSAO = /^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+][0-9A-Za-z.-]{0,40})?$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 'v18.19.0' → [18, 19, 0] e '18.19.0'; '>=20' → [20, 0, 0] e '20'; o resto, null.
function versao(texto) {
  if (typeof texto !== 'string') return null;
  const m = VERSAO.exec(texto.trim().replace(/^>=\s*/, ''));
  if (m === null) return null;
  const partes = [m[1], m[2], m[3]].filter((p) => p !== undefined);
  return { num: [0, 1, 2].map((i) => Number(partes[i] ?? 0)), texto: partes.join('.') };
}
const menor = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.num[i] !== b.num[i]) return a.num[i] < b.num[i];
  return false;
};

// { node, claudeCode, extensao, plugin } (strings ou null) contra
// package.json#compat → [{ tipo, atual, minimo }]. A extensão do VS Code é
// comparada com a versão do plugin. O que não é versão fica de fora.
export function conferirCompat(versoes, compat) {
  const r = [];
  try {
    const v = ehObjeto(versoes) ? versoes : {};
    const c = ehObjeto(compat) ? compat : {};
    const pares = [['node', v.node, c.node], ['claudeCode', v.claudeCode, c.claudeCode], ['extensao', v.extensao, v.plugin]];
    for (const [tipo, atual, minimo] of pares) {
      const a = versao(atual);
      const m = versao(minimo);
      if (a !== null && m !== null && menor(a, m)) r.push({ tipo, atual: a.texto, minimo: m.texto });
    }
  } catch { /* sem itens */ }
  return r;
}

const rotulo = (p) => (typeof p === 'string' && ROTULO_PLUGIN.test(p) ? p : OUTROS);

function casa(matcher, ferramenta) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (typeof matcher !== 'string' || matcher.length > MATCHER_MAX) return false;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(ferramenta);
  try {
    return new RegExp(`^(?:${matcher})$`).test(ferramenta);
  } catch {
    return false;
  }
}

function decideNaGuarda(hooks) {
  const pre = ehObjeto(hooks) && ehObjeto(hooks.hooks) && Array.isArray(hooks.hooks.PreToolUse) ? hooks.hooks.PreToolUse : [];
  return pre.some((e) => ehObjeto(e) && FERRAMENTAS_GUARDA.some((f) => casa(e.matcher, f)));
}

// { statusLine: 'nossa'|'outra'|'nenhuma', pluginsHooks: [{ plugin, hooks }],
// custos: [{ plugin, p95 }] } → [{ tipo: 'statusLine'|'permissao'|'lento',
// plugin, p95? }]. `pluginsHooks` são os hooks.json dos outros plugins
// habilitados; um PreToolUse nas ferramentas da guarda pode decidir
// permissão junto com ela. `custos` vem de resumirCusto (custo-hooks.js).
export function acharConflitos(entrada) {
  const r = [];
  try {
    const e = ehObjeto(entrada) ? entrada : {};
    if (e.statusLine === 'outra') r.push({ tipo: 'statusLine', plugin: null });
    const vistos = new Set();
    for (const p of Array.isArray(e.pluginsHooks) ? e.pluginsHooks : []) {
      if (!ehObjeto(p) || p.plugin === 'hadouken') continue;
      const nome = rotulo(p.plugin);
      if (vistos.has(nome) || !decideNaGuarda(p.hooks)) continue;
      vistos.add(nome);
      r.push({ tipo: 'permissao', plugin: nome });
    }
    for (const c of Array.isArray(e.custos) ? e.custos : []) {
      if (!ehObjeto(c) || c.plugin === 'hadouken' || c.plugin === OUTROS || c.plugin === AMBIGUO) continue;
      if (!ROTULO_PLUGIN.test(c.plugin ?? '') || !Number.isFinite(c.p95) || c.p95 <= LENTO_MS) continue;
      r.push({ tipo: 'lento', plugin: c.plugin, p95: Math.round(c.p95) });
    }
  } catch { /* o que deu até aqui */ }
  return r.slice(0, ITENS_MAX);
}

// Um item (de conferirCompat ou acharConflitos) em texto, com rótulos fixos;
// null para tipo desconhecido. O /hadouken:saude usa o mesmo.
export function descreverItem(i) {
  switch (i?.tipo) {
    case 'node': return `Node ${i.atual} abaixo do suportado (${i.minimo}); atualize o Node`;
    case 'claudeCode': return `Claude Code ${i.atual} abaixo do suportado (${i.minimo}); rode claude update`;
    case 'extensao': return `extensão do VS Code ${i.atual} atrás do plugin ${i.minimo}; rode /hadouken:instalar`;
    case 'statusLine': return 'outra statusLine no settings.json (a barra do hadouken não aparece)';
    case 'permissao': return `${i.plugin} também decide em ferramentas que a guarda vigia`;
    case 'lento': return `hooks de ${i.plugin} lentos (p95 ${i.p95} ms)`;
    default: return null;
  }
}

// Um aviso só ao usuário, com tudo, até 300 caracteres; null sem nada.
export function textoAviso(compat, conflitos) {
  const partes = [...(Array.isArray(compat) ? compat : []), ...(Array.isArray(conflitos) ? conflitos : [])].map(descreverItem).filter(Boolean);
  if (partes.length === 0) return null;
  const fim = '. O hadouken só relata; detalhes no /hadouken:saude.';
  let texto = `hadouken: ${partes[0]}`;
  for (const p of partes.slice(1)) {
    if (texto.length + 2 + p.length + 2 + fim.length > AVISO_MAX) {
      texto += '; …';
      break;
    }
    texto += `; ${p}`;
  }
  return (texto + fim).slice(0, AVISO_MAX);
}

// A combinação, sem os números que oscilam (p95, versão exata da extensão
// não: ela é a combinação), em 8 hex (FNV-1a de 32 bits; não é segurança, só
// "já avisei isto").
export function chaveDe(itens) {
  const linhas = (Array.isArray(itens) ? itens : [])
    .filter(ehObjeto)
    .map((i) => [i.tipo, i.plugin ?? '', i.atual ?? '', i.minimo ?? ''].join(':'))
    .sort();
  let h = 0x811c9dc5;
  for (const ch of linhas.join('|')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
