import crypto from 'node:crypto';
import fs from 'node:fs';

// O fim do transcript (spec roteamento §7): as últimas respostas do
// assistente da thread principal, com o que as otimizações e as sugestões de
// sessão precisam medir. Caminhos e comandos viram sha256 cortado em 12 hex;
// o texto nunca sai daqui. Lê só os últimos maxBytes. Nunca lança: em falha,
// devolve [].
//
// Resposta: { em, ferramentas: [{ nome, linhasMudadas, leituraInteira,
// arquivoHash, reverte }], pensamento, usage: { entrada, cacheLido,
// cacheCriado } | null, resultados: [{ nome, bytes, linhasLidas, falhou,
// comandoHash }] }. `reverte` (ruling do pré-voo, pedido pela Task 8): um
// Edit cujo old_string é o new_string de um Edit anterior no mesmo arquivo.

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 12);
const texto = (v) => (typeof v === 'string' ? v : null);
const linhas = (t) => (t === null ? 0 : t.split('\n').length);
const LINHA_LIDA = /^\s*\d+→/;
const EXIT = /exit code (-?\d+)/i;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function lerFim(arquivo, maxBytes) {
  const st = await fs.promises.lstat(arquivo);
  if (!st.isFile()) return null;
  const fh = await fs.promises.open(arquivo, 'r');
  try {
    const inicio = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(st.size - inicio);
    const { bytesRead } = await fh.read(buf, 0, buf.length, inicio);
    const ls = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    ls.pop(); // a última, sem \n, pode estar pela metade
    if (inicio > 0) ls.shift(); // a primeira pode ter sido cortada
    return ls;
  } finally {
    await fh.close();
  }
}

function textoDoResultado(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => ehObjeto(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function falhou(bloco, t) {
  if (bloco.is_error === true) return true;
  const m = EXIT.exec(t);
  return m !== null && Number(m[1]) !== 0;
}

function usageDe(u) {
  if (!ehObjeto(u)) return null;
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { entrada: n(u.input_tokens), cacheLido: n(u.cache_read_input_tokens), cacheCriado: n(u.cache_creation_input_tokens) };
}

export async function lerTrecho(arquivo, { maxBytes = 2 * 1024 * 1024, respostas = 15 } = {}) {
  try {
    if (typeof arquivo !== 'string') return [];
    const ls = await lerFim(arquivo, maxBytes);
    if (ls === null) return [];
    const rs = [];
    const usos = new Map(); // tool_use_id → { resposta, nome, comandoHash }
    const ultimoNovo = new Map(); // arquivoHash → hash do new_string do último Edit
    let atual = null; // a resposta da última linha do assistente, para juntar o mesmo message.id
    for (const l of ls) {
      // Só a resposta do assistente e a linha com tool_result interessam; as
      // outras (prompts, anexos) nem passam pelo JSON.parse.
      if (!l.includes('"assistant"') && !l.includes('"tool_result"')) continue;
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (!ehObjeto(o) || o.isSidechain === true || !ehObjeto(o.message)) continue;
      const conteudo = Array.isArray(o.message.content) ? o.message.content : [];
      if (o.type === 'assistant') {
        const id = texto(o.message.id);
        if (atual === null || id === null || atual.id !== id) {
          atual = { id, r: { em: Date.parse(o.timestamp), ferramentas: [], pensamento: 0, usage: null, resultados: [] } };
          rs.push(atual.r);
        }
        const r = atual.r;
        const u = usageDe(o.message.usage);
        if (u !== null) r.usage = u;
        for (const b of conteudo) {
          if (!ehObjeto(b)) continue;
          if (b.type === 'thinking' && typeof b.thinking === 'string') r.pensamento += b.thinking.length;
          if (b.type !== 'tool_use' || typeof b.name !== 'string') continue;
          const inp = ehObjeto(b.input) ? b.input : {};
          const nome = b.name.slice(0, 80);
          const arq = texto(inp.file_path);
          const arquivoHash = arq === null ? null : hash(arq);
          let linhasMudadas = 0;
          let reverte = false;
          if (nome === 'Edit') {
            const de = texto(inp.old_string);
            const para = texto(inp.new_string);
            linhasMudadas = Math.max(linhas(de), linhas(para));
            if (arquivoHash !== null) {
              reverte = de !== null && ultimoNovo.get(arquivoHash) === hash(de);
              if (para !== null) ultimoNovo.set(arquivoHash, hash(para));
            }
          } else if (nome === 'Write') {
            linhasMudadas = linhas(texto(inp.content));
          }
          const leituraInteira = nome === 'Read' && inp.offset == null && inp.limit == null;
          r.ferramentas.push({ nome, linhasMudadas, leituraInteira, arquivoHash, reverte });
          const cmd = texto(inp.command);
          if (typeof b.id === 'string') usos.set(b.id, { r, nome, comandoHash: cmd === null ? null : hash(cmd) });
        }
      } else if (o.type === 'user') {
        atual = null;
        for (const b of conteudo) {
          if (!ehObjeto(b) || b.type !== 'tool_result') continue;
          const uso = usos.get(b.tool_use_id);
          if (uso === undefined) continue;
          const t = textoDoResultado(b.content);
          uso.r.resultados.push({
            nome: uso.nome, bytes: Buffer.byteLength(t, 'utf8'),
            linhasLidas: t.split('\n').filter((x) => LINHA_LIDA.test(x)).length,
            falhou: falhou(b, t), comandoHash: uso.comandoHash,
          });
        }
      }
    }
    return rs.slice(-Math.max(0, respostas));
  } catch {
    return [];
  }
}
