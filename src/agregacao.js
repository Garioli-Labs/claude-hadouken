import { effortValido, sanear } from './util.js';

// Agregação pura dos registros de uso (Registro da Task 8) para o /consumo.
// Os registros já chegam validados pelo parser, mas esta é a última etapa
// antes do relatório imprimir as chaves: projeto, sessão, modelo e effort
// passam de novo pelas mesmas regras (spec 8.1, S2), e os mapas por chave não
// têm protótipo, porque um projeto chamado `__proto__` ou `constructor` é um
// nome de pasta possível.
//
// Pensamento (thinking) não entra nas somas: os transcripts só o trazem em
// parte das respostas (spec 12), e somar a ausência como 0 apresentaria um
// piso como total.

const SEM_VALOR = '—';
const MAX_PROJETO = 64;
const MAX_MODELO = 40;
const MAX_SESSAO = 64;
// Mesma régua da Task 8 para contagens de tokens: inteiro de 0 a 1e9.
const MAX_TOKENS = 1e9;
// Texto saneado uma vez por valor distinto; o teto só limita a memória diante
// de uma enxurrada de nomes diferentes.
const MEMO_MAX = 10_000;
// Sessões por agregado: as de maior consumo; as outras só entram na contagem
// sessoesOmitidas (e no total). 200 cobre uma semana de uso pesado (28 sessões
// por dia). Medido em 2026-09-26 com 200 sessões (jsonSeguro, que indenta):
// ~80 KB de porSessao por período com ids UUID, um projeto e dois modelos; no
// pior caso (ids de 64, cinco projetos de 64 e cinco modelos de 40), ~200 KB
// por período e 0,7 MB o relatório inteiro. O JSON só sai com --json; o
// markdown mostra só as 10 primeiras.
export const MAX_SESSOES = 200;
// Projetos e modelos listados por sessão: os de mais respostas.
export const MAX_ROTULOS_SESSAO = 5;

const vazia = () => ({
  respostas: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
  cacheCreate1h: 0, cacheCreate5m: 0, cacheCreateSemDetalhe: 0, acertoCache: null,
});
const contagemValida = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_TOKENS;
const tokens = (n) => (contagemValida(n) ? n : 0);
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Consumo que ordena as tabelas e escolhe as sessões: entrada + cache criado
// + saída. O cache lido fica de fora: é cobrado a uma fração do preço da
// entrada e ordenaria pelo tamanho do contexto, não pelo gasto.
export const pesoConsumo = (s) => s.input + s.cacheCreate + s.output;

function resultadoVazio() {
  return {
    total: vazia(),
    porProjeto: Object.create(null),
    porModeloEffort: Object.create(null),
    principalVsSubagente: { principal: vazia(), subagente: vazia() },
    porSessao: Object.create(null),
    sessoesOmitidas: 0,
  };
}

// Rótulo de exibição: `sanear(valor, max)`, ou — se não for texto ou nada
// sobrar. Memoizado: há poucos projetos e modelos em milhares de registros.
function rotulador(max) {
  const memo = new Map();
  return (valor) => {
    if (typeof valor !== 'string') return SEM_VALOR;
    let rotulo = memo.get(valor);
    if (rotulo === undefined) {
      rotulo = sanear(valor, max) ?? SEM_VALOR;
      if (memo.size >= MEMO_MAX) memo.clear();
      memo.set(valor, rotulo);
    }
    return rotulo;
  };
}

// Lê cada campo uma única vez, antes de somar: um getter que lança derruba só
// este registro, nunca deixa uma soma feita pela metade.
//
// Cache criado: o total vai para 1 h e 5 min só quando o registro traz os dois
// números válidos e eles somam exatamente o total; senão o total inteiro fica
// em cacheCreateSemDetalhe (nunca se deduz a parte que falta). Assim, em toda
// soma, cacheCreate = cacheCreate1h + cacheCreate5m + cacheCreateSemDetalhe.
function lerRegistro(r, desdeMs, rot) {
  if (r === null || typeof r !== 'object') return null;
  const ts = r.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < desdeMs) return null;
  const modelo = rot.modelo(r.model);
  const cacheCreate = tokens(r.cacheCreate);
  const h1 = r.cacheCreate1h;
  const m5 = r.cacheCreate5m;
  const comDetalhe = contagemValida(h1) && contagemValida(m5) && h1 + m5 === cacheCreate;
  return {
    projeto: rot.projeto(r.projeto),
    sessao: rot.sessao(r.sessionId),
    modelo,
    modeloEffort: `${modelo}·${effortValido(r.effort) ?? SEM_VALOR}`,
    subagente: r.subagente === true,
    input: tokens(r.input),
    output: tokens(r.output),
    cacheRead: tokens(r.cacheRead),
    cacheCreate,
    cacheCreate1h: comDetalhe ? h1 : 0,
    cacheCreate5m: comDetalhe ? m5 : 0,
    cacheCreateSemDetalhe: comDetalhe ? 0 : cacheCreate,
  };
}

function somar(s, v) {
  s.respostas++;
  s.input += v.input;
  s.output += v.output;
  s.cacheRead += v.cacheRead;
  s.cacheCreate += v.cacheCreate;
  s.cacheCreate1h += v.cacheCreate1h;
  s.cacheCreate5m += v.cacheCreate5m;
  s.cacheCreateSemDetalhe += v.cacheCreateSemDetalhe;
}

// Acerto de cache = cacheRead / (input + cacheRead + cacheCreate), 3 casas;
// null (não 0) quando o denominador é 0.
function fechar(s) {
  const den = s.input + s.cacheRead + s.cacheCreate;
  s.acertoCache = den > 0 ? Math.round((s.cacheRead / den) * 1000) / 1000 : null;
}

const contar = (mapa, rotulo) => mapa.set(rotulo, (mapa.get(rotulo) ?? 0) + 1);

// Os MAX_ROTULOS_SESSAO rótulos de mais respostas, empate pelo nome.
const principais = (mapa) => [...mapa]
  .sort((a, b) => b[1] - a[1] || comparar(a[0], b[0]))
  .slice(0, MAX_ROTULOS_SESSAO)
  .map(([rotulo]) => rotulo);

// Sessões em ordem de consumo (empate pelo id): as MAX_SESSOES primeiras vão
// para porSessao (sem protótipo, nessa ordem), cada uma com a soma, os
// projetos e os modelos; as outras só são contadas.
function fecharSessoes(sessoes) {
  const lista = [...sessoes];
  for (const [, s] of lista) fechar(s.soma);
  lista.sort((a, b) => pesoConsumo(b[1].soma) - pesoConsumo(a[1].soma) || comparar(a[0], b[0]));
  const porSessao = Object.create(null);
  for (const [id, s] of lista.slice(0, MAX_SESSOES)) {
    porSessao[id] = { ...s.soma, projetos: principais(s.projetos), modelos: principais(s.modelos) };
  }
  return { porSessao, sessoesOmitidas: Math.max(0, lista.length - MAX_SESSOES) };
}

// Soma os registros com `ts >= desdeMs` no total, por projeto, por
// modelo·effort (— quando ausente ou fora da lista fixa), por principal ×
// subagente e por sessão (— quando o registro não traz sessionId; cada sessão
// com os seus projetos e modelos, e só as MAX_SESSOES de maior consumo, com
// o resto contado em sessoesOmitidas). `registros` que não é lista, ou
// `desdeMs` que não é número finito, devolvem o agregado vazio. Registro
// ilegível ou com `ts` inválido é pulado; contagem de tokens inválida vale 0.
// `porProjeto`, `porModeloEffort` e `porSessao` não têm protótipo. Nunca
// lança.
export function agregar(registros, desdeMs) {
  if (!Array.isArray(registros) || typeof desdeMs !== 'number' || !Number.isFinite(desdeMs)) return resultadoVazio();
  try {
    const a = resultadoVazio();
    const rot = { projeto: rotulador(MAX_PROJETO), modelo: rotulador(MAX_MODELO), sessao: rotulador(MAX_SESSAO) };
    const sessoes = new Map();
    for (let i = 0; i < registros.length; i++) {
      let v;
      try { v = lerRegistro(registros[i], desdeMs, rot); } catch { v = null; }
      if (v === null) continue;
      somar(a.total, v);
      somar((a.porProjeto[v.projeto] ??= vazia()), v);
      somar((a.porModeloEffort[v.modeloEffort] ??= vazia()), v);
      somar(a.principalVsSubagente[v.subagente ? 'subagente' : 'principal'], v);
      let s = sessoes.get(v.sessao);
      if (s === undefined) {
        s = { soma: vazia(), projetos: new Map(), modelos: new Map() };
        sessoes.set(v.sessao, s);
      }
      somar(s.soma, v);
      contar(s.projetos, v.projeto);
      contar(s.modelos, v.modelo);
    }
    fechar(a.total);
    for (const s of Object.values(a.porProjeto)) fechar(s);
    for (const s of Object.values(a.porModeloEffort)) fechar(s);
    fechar(a.principalVsSubagente.principal);
    fechar(a.principalVsSubagente.subagente);
    Object.assign(a, fecharSessoes(sessoes));
    return a;
  } catch {
    return resultadoVazio();
  }
}
