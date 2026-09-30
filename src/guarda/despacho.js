import fs from 'node:fs';
import path from 'node:path';
import { effortValido } from '../util.js';
import { lerLimitado } from '../estado.js';

// Perfil de um despacho de subagente (spec v0.4.0 §4.3 e G5 do D1 emendado):
// o modelo, na ordem de resolução da documentação (C7): parâmetro `model`,
// `model` do frontmatter do agente (inherit = seguir), CLAUDE_CODE_SUBAGENT_MODEL
// e o modelo da sessão; e o effort, do frontmatter ou de CLAUDE_EFFORT, que os
// hooks recebem em contexto de ferramenta. Nada daqui vira texto: só os rótulos
// fixos do retorno.

const FABLE = /fable/i;
const NOME_AGENTE = /^[A-Za-z0-9_-]{1,64}$/;
const FRONTMATTER_MAX = 8 * 1024;
// Pelo código, nunca cru: o teste de invisíveis (util.test.js) barra o
// caractere no fonte. Mesmo jeito de configuracao.js.
const BOM = String.fromCodePoint(0xfeff);
// Tipos embutidos que herdam o modelo da conversa. Os outros embutidos
// (Explore, Plan etc.) têm padrão próprio que o hook não conhece.
const HERDAM_SESSAO = new Set(['general-purpose']);
const ehTexto = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;

export function dirConfigClaude(env, home) {
  try {
    const c = env?.CLAUDE_CONFIG_DIR;
    if (typeof c === 'string' && path.isAbsolute(c)) return c;
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude') : null;
  } catch {
    return null;
  }
}

// Frontmatter YAML simples (linhas "chave: valor" entre --- e ---) de um
// arquivo regular de até 8 KiB, sem seguir link. Só `model` e `effort` saem.
// null quando não dá para ler. Nunca lança. O lstat recusa o link; a leitura
// vai pelo descritor com o teto (lerLimitado em estado.js, fstat do mesmo
// descritor), para um arquivo trocado ou crescendo depois do lstat não ser
// lido inteiro (M7 da revisão final da parte 1).
export function lerFrontmatter(arquivo) {
  try {
    const info = fs.lstatSync(arquivo, { throwIfNoEntry: false });
    if (!info || !info.isFile() || info.size > FRONTMATTER_MAX) return null;
    const lido = lerLimitado(arquivo, FRONTMATTER_MAX);
    if (!lido.ok) return null;
    let texto = lido.bytes.toString('utf8').replace(/\r\n/g, '\n');
    if (texto.startsWith(BOM)) texto = texto.slice(BOM.length);
    if (texto.length > FRONTMATTER_MAX) return null;
    const r = { model: null, effort: null };
    if (!texto.startsWith('---\n')) return r;
    const fim = texto.indexOf('\n---', 4);
    if (fim < 0) return r;
    for (const linha of texto.slice(4, fim).split('\n')) {
      const m = /^(model|effort)\s*:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(linha);
      if (m) r[m[1]] = m[2];
    }
    return r;
  } catch {
    return null;
  }
}

function frontmatterDoAgente(nome, cwd, dirCfg) {
  if (typeof nome !== 'string' || !NOME_AGENTE.test(nome)) return null;
  const candidatos = [];
  if (typeof cwd === 'string' && path.isAbsolute(cwd)) candidatos.push(path.join(cwd, '.claude', 'agents', `${nome}.md`));
  if (typeof dirCfg === 'string' && path.isAbsolute(dirCfg)) candidatos.push(path.join(dirCfg, 'agents', `${nome}.md`));
  for (const arq of candidatos) {
    const fm = lerFrontmatter(arq);
    if (fm !== null) return fm;
  }
  return null;
}

const classificar = (m) => (FABLE.test(m) ? 'fable' : 'outro');

export function perfilDoDespacho({ toolInput, cwd, dirConfigClaude: dirCfg, env, modeloSessao } = {}) {
  const desconhecido = { modelo: 'desconhecido', effort: null, origem: 'desconhecido' };
  try {
    const ti = toolInput !== null && typeof toolInput === 'object' ? toolInput : {};
    const nome = ti.subagent_type;
    const fm = frontmatterDoAgente(nome, cwd, dirCfg);
    const effort = effortValido(fm?.effort) ?? effortValido(env?.CLAUDE_EFFORT);
    if (ehTexto(ti.model) && ti.model !== 'inherit') return { modelo: classificar(ti.model), effort, origem: 'parametro' };
    if (fm !== null && ehTexto(fm.model) && fm.model !== 'inherit') return { modelo: classificar(fm.model), effort, origem: 'frontmatter' };
    // Modelo desconhecido não apaga o effort conhecido: G5 vale para effort
    // max de qualquer modelo (D1 emendado), inclusive de um que o hook não
    // resolve (agente de plugin, embutido com padrão próprio).
    const semModelo = { modelo: 'desconhecido', effort, origem: 'desconhecido' };
    const herda = fm !== null || (typeof nome === 'string' && HERDAM_SESSAO.has(nome));
    if (!herda) return semModelo;
    const doAmbiente = env?.CLAUDE_CODE_SUBAGENT_MODEL;
    if (ehTexto(doAmbiente)) return { modelo: classificar(doAmbiente), effort, origem: 'ambiente' };
    if (ehTexto(modeloSessao)) return { modelo: classificar(modeloSessao), effort, origem: 'sessao' };
    return semModelo;
  } catch {
    return desconhecido;
  }
}

// Despacho caro (G5, D1 emendado): effort max em qualquer modelo, ou Fable
// com xhigh ou max. Effort desconhecido nunca é caro (a guarda não trava sem
// dado; o evento registra o desconhecido).
export function despachoCaro(perfil) {
  try {
    if (perfil?.effort === 'max') return true;
    return perfil?.modelo === 'fable' && perfil?.effort === 'xhigh';
  } catch {
    return false;
  }
}
