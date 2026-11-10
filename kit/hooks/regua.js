// Régua de desenvolvimento do kit (spec v0.6.0, Fatia 7): formato, saneamento,
// precedência repo → global → padrão, conferência contra o catálogo e a linha
// que o SessionStart injeta. O cache do kit não tem src/: este arquivo só
// importa node: e ./dependencias.js, e a regra de HADOUKEN_HOME é a cópia de
// dirDados() (src/base.js). Nada aqui escreve em disco nem lança: leitura que
// falha → nível seguinte ou régua padrão. Os avisos ao usuário têm texto fixo
// e contagem, nunca o nome nem o texto cru de uma régua.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerRegistro, pastaConfig as pastaConfigDe } from './dependencias.js';

export const LIMITE_FASE = 60;
export const LIMITE_QUANDO = 120;
export const LIMITE_NOME = 80;
export const MAX_FASES = 20;
export const MAX_LISTA = 12;
export const MAX_TRANSVERSAIS = 40;
export const LIMITE_TEXTO = 2000;
export const NOME_REGUA = /^[A-Za-z0-9_:-]{1,80}$/;

// As 16 skills do mattpocock-skills 1.3.1 com disable-model-invocation: o
// modelo não as aciona, então a régua as cita com / (sugestão ao usuário).
// Vale quando o catálogo não conhece a skill; o catálogo, quando conhece, manda.
export const SO_USUARIO_PADRAO = Object.freeze([
  'ask-matt', 'grill-with-docs', 'implement', 'implement-spec', 'improve-codebase-architecture', 'retro',
  'setup-matt-pocock-skills', 'to-spec', 'to-tickets', 'triage', 'wayfinder', 'grill-me', 'handoff', 'teach',
  'to-questionnaire', 'wait-what',
].map((s) => `mattpocock-skills:${s}`));

const PONTEIRO = '… (régua completa: /hadouken-kit:regua)';
const TETO_JSON = 4 * 1024 * 1024;
const LEITURA_FRONTMATTER = 16 * 1024;
const MAX_SKILLS = 3000;
const NIVEIS_ACIMA = 64;
const ABRIR_LEITURA = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehTexto = (v) => typeof v === 'string' && v !== '';

// Arquivo regular até o teto, lido pelo mesmo descritor que o fstat conferiu.
// ausente: o arquivo não existe (nível sem régua, sem aviso).
export function lerJson(arquivo) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > TETO_JSON) return { ok: false };
    let texto = fs.readFileSync(fd, 'utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    return { ok: true, valor: JSON.parse(texto) };
  } catch (e) {
    return { ok: false, ausente: e?.code === 'ENOENT' };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* já fechado */ } }
  }
}

// Só o começo do arquivo: o frontmatter de uma skill ou de um agente.
function lerComeco(arquivo) {
  let fd;
  try {
    fd = fs.openSync(arquivo, ABRIR_LEITURA);
    if (!fs.fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(LEITURA_FRONTMATTER);
    const lidos = fs.readSync(fd, buffer, 0, LEITURA_FRONTMATTER, 0);
    return buffer.toString('utf8', 0, lidos);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* já fechado */ } }
  }
}

function frontmatter(arquivo) {
  const texto = lerComeco(arquivo);
  if (texto === null) return null;
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(texto);
  if (m === null) return { nome: null, soUsuario: false };
  const nome = /^name:[ \t]*(.+?)[ \t]*$/m.exec(m[1])?.[1]?.replace(/^(['"])(.*)\1$/, '$2') ?? null;
  return { nome: nome !== null && nome !== '' ? nome : null, soUsuario: /^disable-model-invocation:[ \t]*true[ \t]*$/m.test(m[1]) };
}

// ------------------------------------------------------------ pastas

// Caminho vindo do ambiente: só absoluto, sem NUL, normalizado; o resto é null
// e nunca vira outro caminho.
function absolutoLimpo(valor) {
  try {
    if (typeof valor !== 'string' || valor === '' || valor.includes('\0') || !path.isAbsolute(valor)) return null;
    return path.resolve(valor);
  } catch {
    return null;
  }
}

// Mesma regra de dirDados() (src/base.js): HADOUKEN_HOME vale sempre que está
// no ambiente, mas só absoluto; definida com qualquer outro valor dá null e
// nunca cai para ~/.claude/hadouken. Sem a variável: ~/.claude/hadouken.
export function dirHadouken(env = process.env) {
  try {
    const configurado = env?.HADOUKEN_HOME;
    if (configurado !== undefined) return absolutoLimpo(configurado);
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude', 'hadouken') : null;
  } catch {
    return null;
  }
}

const ehPasta = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const existe = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// CLAUDE_PROJECT_DIR (absoluto e existente) → senão o diretório mais próximo,
// do cwd para cima, com .git (pasta ou arquivo, como no worktree), achado por
// subida de pastas e sem executar git → senão o cwd, com comGit false.
export function raizProjeto({ env = process.env, cwd = process.cwd() } = {}) {
  const doAmbiente = absolutoLimpo(env?.CLAUDE_PROJECT_DIR);
  if (doAmbiente !== null && ehPasta(doAmbiente)) return { raiz: doAmbiente, comGit: true };
  const inicio = path.resolve(typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd());
  let dir = inicio;
  for (let i = 0; i < NIVEIS_ACIMA; i += 1) {
    if (existe(path.join(dir, '.git'))) return { raiz: dir, comGit: true };
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return { raiz: inicio, comGit: false };
}

// ------------------------------------------------------------ validação

// Controle (Cc), formatação invisível (Cf: bidi, largura zero, Tags Unicode) e
// separadores de linha viram espaço, espaços repetidos viram um, corte no limite
// (por caractere, sem partir um par substituto).
function limpar(texto, limite) {
  if (typeof texto !== 'string') return '';
  const unico = texto.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...unico].slice(0, limite).join('').trimEnd();
}

// Até `unidades` unidades UTF-16, sem partir um par substituto.
function cortarPorCaractere(texto, unidades) {
  let usado = 0;
  let corte = '';
  for (const c of texto) {
    if (usado + c.length > unidades) break;
    corte += c;
    usado += c.length;
  }
  return corte;
}

const nomeValido = (n) => typeof n === 'string' && NOME_REGUA.test(n);

// Nomes de uma lista: fora da regex ou acima de MAX_LISTA → descartado.
function nomes(bruto) {
  const itens = [];
  let descartes = 0;
  if (!Array.isArray(bruto)) return { itens, descartes };
  for (const n of bruto) {
    if (nomeValido(n) && itens.length < MAX_LISTA) itens.push(n);
    else descartes += 1;
  }
  return { itens, descartes };
}

// {skill, quando}: nome fora da regex ou `quando` vazio depois do saneamento →
// descartado; o excedente de `max` também.
function pares(bruto, max) {
  const itens = [];
  let descartes = 0;
  if (!Array.isArray(bruto)) return { itens, descartes };
  for (const p of bruto) {
    const quando = ehObjeto(p) ? limpar(p.quando, LIMITE_QUANDO) : '';
    if (ehObjeto(p) && nomeValido(p.skill) && quando !== '' && itens.length < max) itens.push({ skill: p.skill, quando });
    else descartes += 1;
  }
  return { itens, descartes };
}

// Formato da spec §4 Fatia 7. Item inválido sai e conta como descarte; fase
// sem `fase`, ou sem `usar` nem `agente` depois dos descartes, sai inteira
// (conta 1, além dos itens dela). Sem nenhuma fase válida → regua null.
export function validarRegua(valor) {
  if (!ehObjeto(valor) || !Array.isArray(valor.fases)) return { regua: null, avisos: ['régua sem lista de fases'], descartes: 0 };
  let descartes = 0;
  const fases = [];
  for (const f of valor.fases) {
    if (!ehObjeto(f)) { descartes += 1; continue; }
    const usar = nomes(f.usar);
    const alternativas = pares(f.alternativas, MAX_LISTA);
    let agente = null;
    let descartesAgente = 0;
    if (f.agente !== undefined && f.agente !== null) {
      if (nomeValido(f.agente)) agente = f.agente;
      else descartesAgente = 1;
    }
    descartes += usar.descartes + alternativas.descartes + descartesAgente;
    const fase = limpar(f.fase, LIMITE_FASE);
    if (fase === '' || (usar.itens.length === 0 && agente === null)) { descartes += 1; continue; }
    if (fases.length >= MAX_FASES) { descartes += 1; continue; }
    fases.push({ fase, usar: usar.itens, alternativas: alternativas.itens, agente });
  }
  const transversais = pares(valor.transversais, MAX_TRANSVERSAIS);
  descartes += transversais.descartes;
  if (fases.length === 0) return { regua: null, avisos: ['régua sem fase válida'], descartes };
  return { regua: { fases, transversais: transversais.itens }, avisos: [], descartes };
}

// ------------------------------------------------------------ origem

const AVISO_NIVEL = {
  repo: 'hadouken-kit: a régua do repositório (.claude/hadouken.json) está ilegível ou inválida e foi ignorada; /hadouken-kit:regua mostra a régua ativa.',
  global: 'hadouken-kit: a régua global (regua.json) está ilegível ou inválida e foi ignorada; /hadouken-kit:regua mostra a régua ativa.',
};

// <raiz>/.claude/hadouken.json (chave `regua`) → <dirHadouken>/regua.json (o
// próprio arquivo é a régua) → padrão. Arquivo ausente, ou sem a chave no
// repo, é só um nível sem régua; ilegível ou inválido avisa e cai para o
// seguinte. `descartes` é o do nível escolhido.
export function carregarRegua({ raiz, dirHadouken: dirH, padrao } = {}) {
  const avisos = [];
  const nivel = (arquivo, origem, chave) => {
    if (!ehTexto(arquivo)) return null;
    const lido = lerJson(arquivo);
    if (lido.ausente) return null;
    if (!lido.ok || (chave && !ehObjeto(lido.valor))) { avisos.push(AVISO_NIVEL[origem]); return null; }
    if (chave && lido.valor.regua === undefined) return null;
    const v = validarRegua(chave ? lido.valor.regua : lido.valor);
    if (v.regua === null) { avisos.push(AVISO_NIVEL[origem]); return null; }
    return { regua: v.regua, origem, avisos, descartes: v.descartes };
  };
  const escolhido = nivel(ehTexto(raiz) ? path.join(raiz, '.claude', 'hadouken.json') : null, 'repo', true)
    ?? nivel(ehTexto(dirH) ? path.join(dirH, 'regua.json') : null, 'global', false);
  if (escolhido !== null) return escolhido;
  return { regua: validarRegua(padrao).regua, origem: 'padrão', avisos, descartes: 0 };
}

// ------------------------------------------------------------ catálogo

// Nome da skill ou do agente: o `name` do frontmatter, ou o da pasta/arquivo.
function skillsEm(pasta, prefixo, saida) {
  const dirs = [];
  if (existe(path.join(pasta, 'SKILL.md'))) dirs.push(pasta);
  else {
    try {
      for (const e of fs.readdirSync(pasta)) {
        const d = path.join(pasta, e);
        if (ehPasta(d) && existe(path.join(d, 'SKILL.md'))) dirs.push(d);
      }
    } catch { /* pasta ausente */ }
  }
  for (const d of dirs) {
    if (saida.size >= MAX_SKILLS) return;
    const f = frontmatter(path.join(d, 'SKILL.md'));
    if (f === null) continue;
    saida.set(`${prefixo}${f.nome ?? path.basename(d)}`, { soUsuario: f.soUsuario });
  }
}

function agentesEm(pasta, prefixo, saida) {
  try {
    for (const e of fs.readdirSync(pasta)) {
      if (!e.endsWith('.md') || saida.size >= MAX_SKILLS) continue;
      const f = frontmatter(path.join(pasta, e));
      if (f !== null) saida.add(`${prefixo}${f.nome ?? e.slice(0, -3)}`);
    }
  } catch { /* pasta ausente */ }
}

// Commands (commands/*.md) entram no mesmo mapa das skills: o usuário os digita
// como /nome e a régua os cita igual. Nome: `name` do frontmatter ou o do arquivo.
function commandsEm(pasta, prefixo, saida) {
  try {
    for (const e of fs.readdirSync(pasta)) {
      if (!e.endsWith('.md') || saida.size >= MAX_SKILLS) continue;
      const f = frontmatter(path.join(pasta, e));
      if (f !== null) saida.set(`${prefixo}${f.nome ?? e.slice(0, -3)}`, { soUsuario: f.soUsuario });
    }
  } catch { /* pasta ausente */ }
}

const dentroDe = (pai, filho) => filho === pai || filho.startsWith(pai + path.sep);

// enabledPlugins de um settings.json (objeto) ou null quando o arquivo não
// existe, não lê ou não tem a forma esperada.
function enabledPluginsDe(arquivo) {
  const lido = lerJson(arquivo);
  if (!lido.ok || !ehObjeto(lido.valor)) return null;
  return ehObjeto(lido.valor.enabledPlugins) ? lido.valor.enabledPlugins : null;
}

// Plugins ligados com o caminho de instalação, [[id, installPath], ...]. Está
// ligado pelo valor da fonte de maior precedência que cita o id (local > project
// > user: <raiz>/.claude/settings.local.json, <raiz>/.claude/settings.json,
// <pastaConfig>/settings.json); só `true` liga. O caminho vem das entradas de
// installed_plugins.json de qualquer escopo: project e local com projectPath só
// valem quando ele é a raiz; sem projectPath, quando o projeto (local ou project)
// é quem liga. A entrada de project/local que vale ganha da de user. Função
// própria: lerRegistro (dedup) segue só com o escopo user.
function pluginsLigados(pastaConfig, raiz) {
  const ligados = [];
  const instalados = lerJson(path.join(pastaConfig, 'plugins', 'installed_plugins.json'));
  if (!instalados.ok || !ehObjeto(instalados.valor) || !ehObjeto(instalados.valor.plugins)) return ligados;
  const comRaiz = ehTexto(raiz);
  const fontes = [
    ['local', comRaiz ? enabledPluginsDe(path.join(raiz, '.claude', 'settings.local.json')) : null],
    ['project', comRaiz ? enabledPluginsDe(path.join(raiz, '.claude', 'settings.json')) : null],
    ['user', enabledPluginsDe(path.join(pastaConfig, 'settings.json'))],
  ];
  const raizAbsoluta = comRaiz ? path.resolve(raiz) : null;
  for (const [id, entradas] of Object.entries(instalados.valor.plugins)) {
    if (!Array.isArray(entradas)) continue;
    const fonte = fontes.find(([, mapa]) => mapa !== null && Object.hasOwn(mapa, id));
    if (fonte === undefined || fonte[1][id] !== true) continue;
    const doProjeto = fonte[0] !== 'user';
    const ehDeProjeto = (e) => e.scope === 'project' || e.scope === 'local';
    const valem = entradas.filter((e) => {
      if (!ehObjeto(e) || !ehTexto(e.installPath)) return false;
      if (!ehDeProjeto(e)) return true;
      return ehTexto(e.projectPath) ? raizAbsoluta !== null && path.resolve(e.projectPath) === raizAbsoluta : doProjeto;
    });
    const escolhida = valem.find(ehDeProjeto) ?? valem[0];
    if (escolhida !== undefined) ligados.push([id, escolhida.installPath]);
  }
  return ligados;
}

// Skills e commands de plugin ligado (as caminhos de `skills` do plugin.json
// quando existem, senão skills/*/SKILL.md; commands/*.md), ~/.claude/skills,
// ~/.claude/commands, <raiz>/.claude/skills e <raiz>/.claude/commands; agentes de
// plugin (agents/*.md), ~/.claude/agents, <raiz>/.claude/agents e os internos.
// Plugin ligado no user, no project ou no local (ver pluginsLigados). `lido` é
// false quando o registro de plugins não pôde ser lido: sem ele o catálogo está
// incompleto e nada deve ser tido por desconhecido.
export function catalogo({ pastaConfig, raiz } = {}) {
  const skills = new Map();
  const agentes = new Set(['Explore', 'Plan', 'general-purpose']);
  let lido = false;
  try {
    lido = ehTexto(pastaConfig) && lerRegistro(pastaConfig) !== null;
    for (const [id, installPath] of ehTexto(pastaConfig) ? pluginsLigados(pastaConfig, raiz) : []) {
      try {
        const nome = id.split('@')[0];
        const base = path.resolve(installPath);
        const manifesto = lerJson(path.join(base, '.claude-plugin', 'plugin.json'));
        const declaradas = manifesto.ok && ehObjeto(manifesto.valor) ? [manifesto.valor.skills].flat().filter(ehTexto) : [];
        const pastas = declaradas.length > 0 ? declaradas.map((s) => path.resolve(base, s)).filter((d) => dentroDe(base, d)) : [path.join(base, 'skills')];
        for (const d of pastas) skillsEm(d, `${nome}:`, skills);
        commandsEm(path.join(base, 'commands'), `${nome}:`, skills);
        agentesEm(path.join(base, 'agents'), `${nome}:`, agentes);
      } catch { /* este plugin é pulado */ }
    }
    if (ehTexto(pastaConfig)) {
      skillsEm(path.join(pastaConfig, 'skills'), '', skills);
      commandsEm(path.join(pastaConfig, 'commands'), '', skills);
      agentesEm(path.join(pastaConfig, 'agents'), '', agentes);
    }
    if (ehTexto(raiz)) {
      skillsEm(path.join(raiz, '.claude', 'skills'), '', skills);
      commandsEm(path.join(raiz, '.claude', 'commands'), '', skills);
      agentesEm(path.join(raiz, '.claude', 'agents'), '', agentes);
    }
  } catch { /* o que foi lido até aqui vale */ }
  return { skills, agentes, lido };
}

// ------------------------------------------------------------ texto

// "Régua (<origem>): <Fase> → <skills>[ (alt.: <skill> — <quando> | …)][ · agente <agente>]; …; Transversais: <skill> — <quando>; …".
// `limite` troca o teto de LIMITE_TEXTO (o comando mostra a régua inteira). Skill só do usuário vai com /. Com `validar`, skill e agente que o catálogo
// não conhece saem do texto e entram na contagem. Texto vazio quando nada sobra.
export function textoRegua({ regua, origem, catalogo: cat, validar, limite = LIMITE_TEXTO } = {}) {
  const desconhecidos = { skills: 0, agentes: 0 };
  const vazio = { texto: '', avisos: [], desconhecidos };
  if (!ehObjeto(regua) || !Array.isArray(regua.fases)) return vazio;
  const skillsDoCatalogo = cat?.skills instanceof Map ? cat.skills : new Map();
  const agentesDoCatalogo = cat?.agentes instanceof Set ? cat.agentes : new Set();
  const skillConhecida = (n) => {
    if (!validar || skillsDoCatalogo.has(n)) return true;
    desconhecidos.skills += 1;
    return false;
  };
  const agenteConhecido = (n) => {
    if (!validar || agentesDoCatalogo.has(n)) return true;
    desconhecidos.agentes += 1;
    return false;
  };
  const so = (n) => skillsDoCatalogo.get(n)?.soUsuario ?? SO_USUARIO_PADRAO.includes(n);
  const cita = (n) => (so(n) ? `/${n}` : n);

  const segmentos = [];
  for (const f of regua.fases) {
    const usar = (f.usar ?? []).filter(skillConhecida);
    const alternativas = (f.alternativas ?? []).filter((a) => skillConhecida(a.skill));
    const agente = f.agente !== null && f.agente !== undefined && agenteConhecido(f.agente) ? f.agente : null;
    if (usar.length === 0 && agente === null) continue;
    let corpo = usar.map(cita).join(', ');
    if (alternativas.length > 0) corpo += `${corpo === '' ? '' : ' '}(alt.: ${alternativas.map((a) => `${cita(a.skill)} — ${a.quando}`).join(' | ')})`;
    if (agente !== null) corpo += `${corpo === '' ? '' : ' · '}agente ${agente}`;
    segmentos.push(`${f.fase} → ${corpo}`);
  }
  const transversais = (regua.transversais ?? []).filter((t) => skillConhecida(t.skill)).map((t) => `${cita(t.skill)} — ${t.quando}`);
  if (transversais.length > 0) transversais[0] = `Transversais: ${transversais[0]}`;
  segmentos.push(...transversais);
  if (segmentos.length === 0) return { texto: '', avisos: [], desconhecidos };

  const prefixo = `Régua (${origem}): `;
  const inteiro = prefixo + segmentos.join('; ');
  if (inteiro.length <= limite) return { texto: inteiro, avisos: [], desconhecidos };
  const caber = limite - PONTEIRO.length - 1;
  let aceito = '';
  for (let i = 1; i <= segmentos.length; i += 1) {
    const tentativa = prefixo + segmentos.slice(0, i).join('; ');
    if (tentativa.length > caber) break;
    aceito = tentativa;
  }
  if (aceito === '') aceito = cortarPorCaractere(prefixo + segmentos[0], caber);
  return { texto: `${aceito.trimEnd()} ${PONTEIRO}`, avisos: [], desconhecidos };
}

// Os nomes que o catálogo não conhece, sem repetição, na ordem da régua. Só o
// /hadouken-kit:regua os mostra (já passaram pela regex de nomes); o SessionStart
// só conta. Catálogo sem registro lido → nada é desconhecido.
export function nomesDesconhecidos({ regua, catalogo: cat } = {}) {
  const skills = new Set();
  const agentes = new Set();
  if (!ehObjeto(regua) || !Array.isArray(regua.fases) || cat?.lido !== true) return { skills: [], agentes: [] };
  const sabidas = cat.skills instanceof Map ? cat.skills : new Map();
  const conhecidos = cat.agentes instanceof Set ? cat.agentes : new Set();
  const skill = (n) => { if (!sabidas.has(n)) skills.add(n); };
  for (const f of regua.fases) {
    for (const n of f.usar ?? []) skill(n);
    for (const a of f.alternativas ?? []) skill(a.skill);
    if (typeof f.agente === 'string' && !conhecidos.has(f.agente)) agentes.add(f.agente);
  }
  for (const t of regua.transversais ?? []) skill(t.skill);
  return { skills: [...skills], agentes: [...agentes] };
}

// Texto fixo e contagem, nunca nome nem texto da régua.
export function avisosDaRegua({ origem, desconhecidos, descartes } = {}) {
  const avisos = [];
  const s = desconhecidos?.skills ?? 0;
  const a = desconhecidos?.agentes ?? 0;
  const parcelas = [];
  if (s > 0) parcelas.push(`${s} skill${s > 1 ? 's' : ''} desconhecida${s > 1 ? 's' : ''}`);
  if (a > 0) parcelas.push(`${a} agente${a > 1 ? 's' : ''} desconhecido${a > 1 ? 's' : ''}`);
  if (descartes > 0) parcelas.push(`${descartes} item(ns) descartado(s)`);
  if (parcelas.length > 0) avisos.push(`hadouken-kit: régua com ${parcelas.join(' e ')}; /hadouken-kit:regua mostra a régua ativa.`);
  if (origem === 'repo') avisos.push('hadouken-kit: a régua deste repositório (.claude/hadouken.json) vale no lugar da sua; /hadouken-kit:regua mostra qual.');
  return avisos;
}

// ------------------------------------------------------------ SessionStart

const ARQUIVO_PADRAO = fileURLToPath(new URL('../regua-padrao.json', import.meta.url));

// O que o SessionStart do kit injeta e avisa: {texto, avisos}. Nunca lança;
// qualquer falha → null e o fluxo.js usa a régua padrão que carrega embutida.
// Régua padrão ilegível só pesa quando o nível que vale seria o padrão: a régua
// do repo ou a global válida seguem valendo, e `texto` vazio faz o fluxo.js usar
// a reserva (os avisos dos níveis ilegíveis continuam).
export function reguaDaSessao(env = process.env, cwd = process.cwd()) {
  try {
    const padrao = lerJson(ARQUIVO_PADRAO);
    const valorPadrao = padrao.ok ? padrao.valor : null;
    const { raiz } = raizProjeto({ env, cwd });
    const cat = catalogo({ pastaConfig: pastaConfigDe(env), raiz });
    const carregada = carregarRegua({ raiz, dirHadouken: dirHadouken(env), padrao: valorPadrao });
    let { origem } = carregada;
    let t = textoRegua({ regua: carregada.regua, origem, catalogo: cat, validar: origem !== 'padrão' && cat.lido });
    const { desconhecidos } = t;
    if (t.texto === '') {
      origem = 'padrão';
      t = textoRegua({ regua: validarRegua(valorPadrao).regua, origem, catalogo: cat, validar: false });
    }
    return { texto: t.texto, avisos: [...carregada.avisos, ...avisosDaRegua({ origem, desconhecidos, descartes: carregada.descartes })] };
  } catch {
    return null;
  }
}
