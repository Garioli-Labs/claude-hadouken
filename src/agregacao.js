import { effortValido, sanear } from './util.js';

// Agregação pura dos registros de uso (Registro da Task 8) para o /consumo.
// Os registros já chegam validados pelo parser, mas esta é a última etapa
// antes do relatório imprimir as chaves: projeto, modelo e effort passam de
// novo pelas mesmas regras (spec 8.1, S2), e os mapas por chave não têm
// protótipo, porque um projeto chamado `__proto__` ou `constructor` é um nome
// de pasta possível.

const SEM_VALOR = '—';
const MAX_PROJETO = 64;
const MAX_MODELO = 40;
// Mesma régua da Task 8 para contagens de tokens: inteiro de 0 a 1e9.
const MAX_TOKENS = 1e9;
// Texto saneado uma vez por valor distinto; o teto só limita a memória diante
// de uma enxurrada de nomes diferentes.
const MEMO_MAX = 10_000;

const vazia = () => ({ respostas: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheCreate: 0, acertoCache: null });
const tokens = (n) => (Number.isInteger(n) && n >= 0 && n <= MAX_TOKENS ? n : 0);

function resultadoVazio() {
  return {
    total: vazia(),
    porProjeto: Object.create(null),
    porModeloEffort: Object.create(null),
    principalVsSubagente: { principal: vazia(), subagente: vazia() },
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
function lerRegistro(r, desdeMs, projetoDe, modeloDe) {
  if (r === null || typeof r !== 'object') return null;
  const ts = r.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < desdeMs) return null;
  return {
    projeto: projetoDe(r.projeto),
    modeloEffort: `${modeloDe(r.model)}·${effortValido(r.effort) ?? SEM_VALOR}`,
    subagente: r.subagente === true,
    input: tokens(r.input),
    output: tokens(r.output),
    thinking: tokens(r.thinking),
    cacheRead: tokens(r.cacheRead),
    cacheCreate: tokens(r.cacheCreate),
  };
}

function somar(s, v) {
  s.respostas++;
  s.input += v.input;
  s.output += v.output;
  s.thinking += v.thinking;
  s.cacheRead += v.cacheRead;
  s.cacheCreate += v.cacheCreate;
}

// Acerto de cache = cacheRead / (input + cacheRead + cacheCreate), 3 casas;
// null (não 0) quando o denominador é 0.
function fechar(s) {
  const den = s.input + s.cacheRead + s.cacheCreate;
  s.acertoCache = den > 0 ? Math.round((s.cacheRead / den) * 1000) / 1000 : null;
}

// Soma os registros com `ts >= desdeMs` no total, por projeto, por
// modelo·effort (— quando ausente ou fora da lista fixa) e por principal ×
// subagente. `registros` que não é lista, ou `desdeMs` que não é número
// finito, devolvem o agregado vazio. Registro ilegível ou com `ts` inválido é
// pulado; contagem de tokens inválida vale 0. `porProjeto` e `porModeloEffort`
// não têm protótipo. Nunca lança.
export function agregar(registros, desdeMs) {
  if (!Array.isArray(registros) || typeof desdeMs !== 'number' || !Number.isFinite(desdeMs)) return resultadoVazio();
  try {
    const a = resultadoVazio();
    const projetoDe = rotulador(MAX_PROJETO);
    const modeloDe = rotulador(MAX_MODELO);
    for (let i = 0; i < registros.length; i++) {
      let v;
      try { v = lerRegistro(registros[i], desdeMs, projetoDe, modeloDe); } catch { v = null; }
      if (v === null) continue;
      somar(a.total, v);
      somar((a.porProjeto[v.projeto] ??= vazia()), v);
      somar((a.porModeloEffort[v.modeloEffort] ??= vazia()), v);
      somar(a.principalVsSubagente[v.subagente ? 'subagente' : 'principal'], v);
    }
    fechar(a.total);
    for (const s of Object.values(a.porProjeto)) fechar(s);
    for (const s of Object.values(a.porModeloEffort)) fechar(s);
    fechar(a.principalVsSubagente.principal);
    fechar(a.principalVsSubagente.subagente);
    return a;
  } catch {
    return resultadoVazio();
  }
}
