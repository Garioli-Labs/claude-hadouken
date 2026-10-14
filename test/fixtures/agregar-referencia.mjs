// Referência congelada de agregarRegistros antes da otimização da revisão
// da Task 12 (src/aprendizado/agregar.js no commit b0db525). Só para o teste
// diferencial de test/aprendizado-agregar-rapido.test.js; nunca muda junto
// com o agregador.
const CAMPOS = 12;
const MODELOS_SEMANA_MAX = 40;
const SLOT_MAX_MIN = 60;
const dois = (n) => String(n).padStart(2, '0');

function inicioSemana(ms) {
  const d = new Date(ms);
  const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${seg.getFullYear()}-${dois(seg.getMonth() + 1)}-${dois(seg.getDate())}`;
}

function slotDaSemana(ms) {
  const d = new Date(ms);
  return ((d.getDay() + 6) % 7) * 24 + d.getHours();
}

function semanaDe(ap, ms) {
  const inicio = inicioSemana(ms);
  let s = ap.semanas.find((x) => x.inicio === inicio);
  if (s === undefined) {
    s = { inicio, modelos: {}, ativo: new Array(168).fill(0) };
    ap.semanas.push(s);
    ap.semanas.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  }
  return s;
}

function somarAtivo(ap, ms, minutos) {
  const s = semanaDe(ap, ms);
  const slot = slotDaSemana(ms);
  s.ativo[slot] = Math.min(SLOT_MAX_MIN, s.ativo[slot] + minutos);
}

export function agregarRegistros(ap, registros) {
  for (const r of registros) {
    if (r.t === 'ativo') {
      somarAtivo(ap, r.em, r.segundos / 60);
      continue;
    }
    const s = semanaDe(ap, r.em);
    const chave = `${r.modelo}|${r.effort}|${r.origem}`;
    if (!Object.hasOwn(s.modelos, chave)) {
      if (Object.keys(s.modelos).length >= MODELOS_SEMANA_MAX) continue;
      s.modelos[chave] = new Array(CAMPOS).fill(0);
    }
    const v = s.modelos[chave];
    if (r.t === 'req') {
      v[0] += 1;
      v[1] += r.custo;
      v[2] += r.entrada;
      v[3] += r.saida;
      v[4] += r.cacheLeitura;
      v[5] += r.cacheEscrita;
      v[6] += r.duracaoMs ?? 0;
      if (r.ttftMs !== null) {
        v[7] += r.ttftMs;
        v[8] += 1;
      }
    } else if (r.t === 'erro') {
      v[9] += 1;
    } else if (r.t === 'ferramenta') {
      v[10] += 1;
      if (!r.ok) v[11] += 1;
    }
  }
  return ap;
}

