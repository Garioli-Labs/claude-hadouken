// Otimizações da sessão (spec roteamento §9: O1, O2, O5). Puras; o hook
// decide quando chamar. Nunca lança.
const O1_VEZES = 3;
const O1_LINHAS = 300;
const O2_BYTES = 30 * 1024;
const O5_PAUSA_MS = 5 * 60_000;
const COMANDOS = new Set(['Bash', 'PowerShell']);

function o1(rs) {
  const vezes = new Map();
  for (const r of rs) for (const f of r.ferramentas) {
    if (f.nome !== 'Read' || !f.leituraInteira || !f.arquivoHash) continue;
    const res = r.resultados.find((x) => x.nome === 'Read');
    if (!res || res.linhasLidas < O1_LINHAS) continue;
    vezes.set(f.arquivoHash, (vezes.get(f.arquivoHash) ?? 0) + 1);
  }
  return [...vezes.values()].some((n) => n >= O1_VEZES);
}
const o2 = (rs) => rs.some((r) => r.resultados.some((x) => COMANDOS.has(x.nome) && x.bytes > O2_BYTES));
function acerto(rs) {
  const u = rs.slice(-5).map((r) => r.usage).filter(Boolean);
  const total = u.reduce((s, x) => s + x.entrada + x.cacheLido + x.cacheCriado, 0);
  return total > 0 ? (100 * u.reduce((s, x) => s + x.cacheLido, 0)) / total : null;
}
function o5(rs, s, faixas, agoraMs) {
  if (!s || typeof s.context_pct !== 'number' || s.context_pct < faixas.ctxAmarelo || rs.length === 0) return false;
  const a = acerto(rs);
  const pausa = agoraMs - rs[rs.length - 1].em;
  return (a !== null && a < faixas.cacheAmarelo) || pausa > O5_PAUSA_MS;
}

// A desestruturação fica dentro do try: uma entrada ausente devolve [].
export function otimizacoesDaSessao(entrada) {
  try {
    const { respostas, sessaoEstado, faixas, otimizacoes, agoraMs } = entrada;
    const rs = Array.isArray(respostas) ? respostas : [];
    const f = faixas ?? { ctxAmarelo: 70, cacheAmarelo: 50 };
    const s = [];
    if (otimizacoes.compactar && o5(rs, sessaoEstado, f, agoraMs)) s.push({ chave: 'O5', economia: 4 });
    if (otimizacoes.leiturasRepetidas && o1(rs)) s.push({ chave: 'O1', economia: 2 });
    if (otimizacoes.saidaGrande && o2(rs)) s.push({ chave: 'O2', economia: 1 });
    return s;
  } catch {
    return [];
  }
}
