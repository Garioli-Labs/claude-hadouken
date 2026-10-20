import fs from 'node:fs';
import path from 'node:path';
import { lerLimitado } from '../estado.js';
import { lerSemLink } from '../guarda/arquivo.js';
import { lerTrecho } from './trecho.js';

// Coleta do /consumo para as seções O3, O4 e a reescrita (spec roteamento §7
// e §8). Só lê; devolve nomes validados, tamanhos e hashes, nunca o texto de
// um arquivo nem um caminho. Cada função engole o próprio erro e devolve o
// vazio, para uma fonte que falha só tirar a sua seção.

const JSON_MAX = 1024 * 1024;
const CLAUDE_JSON_MAX = 16 * 1024 * 1024;
const TEXTO_MAX = 1024 * 1024;
const NOME = /^[A-Za-z0-9_.-]{1,64}$/;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const chaves = (v) => (ehObjeto(v) ? Object.keys(v).filter((k) => NOME.test(k) && k !== '__proto__') : []);
const lerObjeto = (arq, max = JSON_MAX) => {
  const lido = lerSemLink(arq, max);
  return lido.ok && ehObjeto(lido.valor) ? lido.valor : null;
};
const absoluto = (p) => typeof p === 'string' && p !== '' && !p.includes('\0') && path.isAbsolute(p);

// Plugins ligados (enabledPlugins true em algum dos settings, o último
// vencendo) e instalados: [{ nome, raiz }].
function pluginsLigados(settings, instalados) {
  const ligado = new Map();
  for (const s of settings) for (const [k, v] of Object.entries(ehObjeto(s.enabledPlugins) ? s.enabledPlugins : {})) ligado.set(k, v === true);
  const lista = ehObjeto(instalados) && ehObjeto(instalados.plugins) ? instalados.plugins : {};
  const r = [];
  for (const [chave, on] of ligado) {
    if (!on || !Object.hasOwn(lista, chave) || !Array.isArray(lista[chave])) continue;
    const raiz = lista[chave][0]?.installPath;
    const nome = chave.split('@')[0];
    if (absoluto(raiz) && NOME.test(nome)) r.push({ nome, raiz });
  }
  return r;
}

// O3: os servidores MCP ligados e se as ferramentas vêm sob demanda.
// `arquivos`: { settings: [caminhos], claudeJson, cwd, instalados }. O nome
// de servidor de plugin segue o do Claude Code: plugin_<plugin>_<servidor>.
// sobDemanda: o tool search vem ligado por padrão; ENABLE_TOOL_SEARCH=false
// ou um ANTHROPIC_BASE_URL próprio o desligam (doc do Claude Code, "MCP",
// consultada em 2026-10-20).
export function servidoresLigados({ settings: arqs = [], claudeJson = null, cwd = null, instalados = null, env = {} } = {}) {
  try {
    const settings = arqs.map((a) => lerObjeto(a)).filter((s) => s !== null);
    const nomes = [];
    const cj = absoluto(claudeJson) ? lerObjeto(claudeJson, CLAUDE_JSON_MAX) : null;
    if (cj !== null) {
      nomes.push(...chaves(cj.mcpServers));
      if (absoluto(cwd) && ehObjeto(cj.projects) && Object.hasOwn(cj.projects, cwd) && ehObjeto(cj.projects[cwd])) nomes.push(...chaves(cj.projects[cwd].mcpServers));
    }
    if (absoluto(cwd)) {
      const desligados = new Set(settings.flatMap((s) => (Array.isArray(s.disabledMcpjsonServers) ? s.disabledMcpjsonServers : [])));
      const mcp = lerObjeto(path.join(cwd, '.mcp.json'));
      if (mcp !== null) nomes.push(...chaves(mcp.mcpServers).filter((n) => !desligados.has(n)));
    }
    for (const p of pluginsLigados(settings, instalados)) {
      const mcp = lerObjeto(path.join(p.raiz, '.mcp.json'));
      const doManifesto = lerObjeto(path.join(p.raiz, '.claude-plugin', 'plugin.json'));
      const servidores = [...chaves(mcp?.mcpServers ?? mcp), ...chaves(doManifesto?.mcpServers)];
      for (const s of new Set(servidores)) nomes.push(`plugin_${p.nome}_${s}`.slice(0, 64));
    }
    let busca = typeof env.ENABLE_TOOL_SEARCH === 'string' ? env.ENABLE_TOOL_SEARCH : null;
    let base = typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL !== '' ? env.ANTHROPIC_BASE_URL : null;
    for (const s of settings) {
      if (!ehObjeto(s.env)) continue;
      if (typeof s.env.ENABLE_TOOL_SEARCH === 'string') busca = s.env.ENABLE_TOOL_SEARCH;
      if (typeof s.env.ANTHROPIC_BASE_URL === 'string' && s.env.ANTHROPIC_BASE_URL !== '') base = s.env.ANTHROPIC_BASE_URL;
    }
    return { servidores: [...new Set(nomes)], sobDemanda: busca?.toLowerCase() !== 'false' && base === null };
  } catch {
    return { servidores: [], sobDemanda: null };
  }
}

// Tamanho em caracteres de um arquivo de texto regular (sem seguir link), ou
// null.
function caracteres(arq) {
  try {
    const st = fs.lstatSync(arq, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > TEXTO_MAX) return null;
    const lido = lerLimitado(arq, TEXTO_MAX);
    return lido.ok ? lido.bytes.toString('utf8').length : null;
  } catch {
    return null;
  }
}

// Caracteres de name + description no frontmatter (o que o Claude Code põe no
// contexto de cada skill e agente), ou null.
function descricao(arq) {
  try {
    const st = fs.lstatSync(arq, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > TEXTO_MAX) return null;
    const lido = lerLimitado(arq, TEXTO_MAX);
    if (!lido.ok) return null;
    const t = lido.bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
    if (!t.startsWith('---\n')) return null;
    const fim = t.indexOf('\n---', 4);
    if (fim < 0) return null;
    let n = 0;
    let dentro = false;
    for (const l of t.slice(4, fim).split('\n')) {
      const m = /^(name|description)\s*:(.*)$/.exec(l);
      if (m) { n += m[2].trim().length; dentro = m[1] === 'description'; continue; }
      if (dentro && /^\s+\S/.test(l)) n += l.trim().length + 1;
      else dentro = false;
    }
    return n;
  } catch {
    return null;
  }
}

const pastas = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

// O4: { item, caracteres } dos CLAUDE.md (usuário e projeto), das skills e dos
// agentes dos plugins ligados e dos agentes do usuário. Até 400 itens.
export function itensDeContexto({ dirConfig = null, cwd = null, settings: arqs = [], instalados = null } = {}) {
  const itens = [];
  const por = (item, n) => { if (n !== null && n > 0 && itens.length < 400) itens.push({ item: item.slice(0, 100), caracteres: n }); };
  try {
    if (absoluto(dirConfig)) por('CLAUDE.md do usuário', caracteres(path.join(dirConfig, 'CLAUDE.md')));
    if (absoluto(cwd)) {
      por('CLAUDE.md do projeto', caracteres(path.join(cwd, 'CLAUDE.md')));
      por('CLAUDE.md do projeto (.claude)', caracteres(path.join(cwd, '.claude', 'CLAUDE.md')));
    }
    const settings = arqs.map((a) => lerObjeto(a)).filter((s) => s !== null);
    for (const p of pluginsLigados(settings, instalados)) {
      for (const e of pastas(path.join(p.raiz, 'skills'))) {
        if (e.isDirectory() && NOME.test(e.name)) por(`skill ${p.nome}:${e.name}`, descricao(path.join(p.raiz, 'skills', e.name, 'SKILL.md')));
      }
      for (const e of pastas(path.join(p.raiz, 'agents'))) {
        const nome = e.name.replace(/\.md$/, '');
        if (e.isFile() && e.name.endsWith('.md') && NOME.test(nome)) por(`agente ${p.nome}:${nome}`, descricao(path.join(p.raiz, 'agents', e.name)));
      }
    }
    if (absoluto(dirConfig)) {
      for (const e of pastas(path.join(dirConfig, 'agents'))) {
        const nome = e.name.replace(/\.md$/, '');
        if (e.isFile() && e.name.endsWith('.md') && NOME.test(nome)) por(`agente ${nome}`, descricao(path.join(dirConfig, 'agents', e.name)));
      }
    }
  } catch {
    // fica o que deu para ler
  }
  return itens;
}

// Transcripts de sessão principal sob a raiz (<raiz>/<projeto>/<id>.jsonl)
// modificados desde desdeMs: [{ sessao, arquivo, pasta }]. Até `max`.
const SESSAO = /^[A-Za-z0-9-]{1,80}$/;
function sessoesNaRaiz(raiz, desdeMs, max) {
  const r = [];
  for (const p of pastas(raiz)) {
    if (!p.isDirectory()) continue;
    const dir = path.join(raiz, p.name);
    for (const f of pastas(dir)) {
      const id = f.name.replace(/\.jsonl$/, '');
      if (!f.isFile() || !f.name.endsWith('.jsonl') || !SESSAO.test(id)) continue;
      const arquivo = path.join(dir, f.name);
      const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
      if (st && st.isFile() && st.mtimeMs >= desdeMs) r.push({ sessao: id, arquivo, pasta: dir, mtimeMs: st.mtimeMs });
    }
  }
  return r.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
}

// Primeira resposta de cada sessão principal da semana: lê o começo do
// transcript (até 512 KiB), o primeiro prompt digitado (texto) e o usage da
// primeira resposta do assistente depois dele. [{ tokens, caracteresPrompt }].
const CABECA = 512 * 1024;
function cabeca(arq) {
  let fd = null;
  try {
    fd = fs.openSync(arq, 'r');
    const buf = Buffer.alloc(CABECA);
    const n = fs.readSync(fd, buf, 0, CABECA, 0);
    const ls = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === CABECA) ls.pop();
    return ls;
  } catch {
    return [];
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* já fechado */ }
  }
}
const textoDoPrompt = (c) => (typeof c === 'string' ? c : Array.isArray(c) && c.every((b) => ehObjeto(b) && b.type === 'text') ? c.map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n') : null);
const uso = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
export function primeirasDasSessoes(raiz, desdeMs, { max = 300 } = {}) {
  const r = [];
  try {
    if (!absoluto(raiz)) return r;
    for (const s of sessoesNaRaiz(raiz, desdeMs, max)) {
      let prompt = null;
      for (const l of cabeca(s.arquivo)) {
        if (!l.includes('"user"') && !l.includes('"assistant"')) continue;
        let o;
        try { o = JSON.parse(l); } catch { continue; }
        if (!ehObjeto(o) || o.isSidechain === true || !ehObjeto(o.message)) continue;
        if (o.type === 'user' && prompt === null && o.isMeta !== true) {
          const t = textoDoPrompt(o.message.content);
          if (t !== null) prompt = t.length;
        } else if (o.type === 'assistant' && prompt !== null && ehObjeto(o.message.usage)) {
          if (Date.parse(o.timestamp) >= desdeMs) {
            const u = o.message.usage;
            r.push({ tokens: uso(u.input_tokens) + uso(u.cache_creation_input_tokens) + uso(u.cache_read_input_tokens), caracteresPrompt: prompt });
          }
          break;
        }
      }
    }
  } catch {
    // fica o que deu para ler
  }
  return r;
}

// Reescrita: para as sessões dos despachos que rodaram (até 50), os
// subagentes (início, fim e linhas mudadas por arquivoHash) e as edições da
// sessão principal. { subagentes, principais } no formato de marcarReescrita.
const EDITA = new Set(['Edit', 'Write', 'MultiEdit']);
export async function sessoesDeReescrita(raiz, despachos, desdeMs) {
  const subagentes = [];
  const principais = {};
  try {
    if (!absoluto(raiz) || !Array.isArray(despachos)) return { subagentes, principais };
    const ids = new Set(despachos.filter((d) => d.decisao !== 'negar' && SESSAO.test(d.sessao)).map((d) => d.sessao));
    const sessoes = sessoesNaRaiz(raiz, desdeMs, 2000).filter((s) => ids.has(s.sessao)).slice(0, 50);
    for (const s of sessoes) {
      const lista = [];
      for (const resp of await lerTrecho(s.arquivo, { maxBytes: 16 * 1024 * 1024, respostas: 100_000 })) {
        for (const f of resp.ferramentas) if (EDITA.has(f.nome) && f.arquivoHash !== null) lista.push({ em: resp.em, arquivoHash: f.arquivoHash, linhasMudadas: f.linhasMudadas });
      }
      principais[s.sessao] = lista;
      const dirSub = path.join(s.pasta, s.sessao, 'subagents');
      for (const f of pastas(dirSub).slice(0, 200)) {
        if (!f.isFile() || !f.name.startsWith('agent-') || !f.name.endsWith('.jsonl')) continue;
        const rs = (await lerTrecho(path.join(dirSub, f.name), { maxBytes: 8 * 1024 * 1024, respostas: 100_000, sidechain: true })).filter((x) => Number.isFinite(x.em));
        if (rs.length === 0) continue;
        const edicoes = {};
        for (const x of rs) for (const t of x.ferramentas) if (EDITA.has(t.nome) && t.arquivoHash !== null) edicoes[t.arquivoHash] = (edicoes[t.arquivoHash] ?? 0) + t.linhasMudadas;
        subagentes.push({ sessao: s.sessao, inicio: rs[0].em, fim: rs.at(-1).em, edicoes });
      }
    }
  } catch {
    // fica o que deu para ler
  }
  return { subagentes, principais };
}
