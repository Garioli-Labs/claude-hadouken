// Sessões do Claude paradas (plano v0.5.6, decisões 8 a 10). Puro: o coletor
// passa a leitura anterior (com as ociosas dela) e a nova, e grava o
// resultado em saude.json como `ociosas`. Uma sessão está parada enquanto o
// tempo de CPU acumulado dela sobe menos de CPU_PARADA_MS entre duas leituras
// seguidas; a sessão em uso sempre gasta CPU quando o hook roda, então nunca
// fica parada. Só números saem daqui: nome e linha de comando não.

export const CPU_PARADA_MS = 2000;
const PARADA_MIN_MS = 30 * 60_000;
// Mais que isto entre duas leituras (PC dormindo, sem hooks): ninguém sabe o
// que houve no meio, então as contagens recomeçam.
const SALTO_MAX_MS = 2 * 3600_000;
const ITENS_MAX = 20;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inteiroNaoNeg = (v) => Number.isInteger(v) && v >= 0;
const TEMPO_PS = /^(?:(\d{1,4})-)?(?:(\d{1,3}):)?(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/;

// O tempo de CPU do `ps -o time=`: `[DD-]HH:MM:SS` (Linux) ou `M:SS.ss`
// (macOS), em ms. null para o resto.
export function tempoCpuMs(texto) {
  const m = typeof texto === 'string' ? TEMPO_PS.exec(texto.trim()) : null;
  if (m === null) return null;
  const [, dias = '0', horas = '0', minutos, segundos, fracao = '0'] = m;
  const s = Number(dias) * 86_400 + Number(horas) * 3600 + Number(minutos) * 60 + Number(segundos);
  return s * 1000 + Math.round(Number(`0.${fracao}`) * 1000);
}

function itemValido(o) {
  return ehObjeto(o) && inteiroNaoNeg(o.pid) && Number.isFinite(o.desdeMs) && inteiroNaoNeg(o.cpuMs) && Number.isFinite(o.rssBytes) && o.rssBytes >= 0;
}

// anterior: { em, ociosas, processos } ou null. Devolve a lista nova de
// { pid, desdeMs, cpuMs, rssBytes }, uma por sessão `claude` com cpuMs lido.
// Leitura sem processos (prazo, falha): as ociosas anteriores ficam como
// estão, sem avançar nem zerar. Nunca lança.
export function atualizarOciosas(anterior, leitura, agoraMs) {
  try {
    const antigas = ehObjeto(anterior) && Array.isArray(anterior.ociosas) ? anterior.ociosas.filter(itemValido) : [];
    if (leitura?.fontes?.processos !== 'ok' || !Array.isArray(leitura.processos)) return antigas.slice(0, ITENS_MAX);
    const continua = ehObjeto(anterior) && Number.isFinite(anterior.em) && anterior.em <= agoraMs && agoraMs - anterior.em <= SALTO_MAX_MS;
    const porPid = new Map(continua ? antigas.map((o) => [o.pid, o]) : []);
    const r = [];
    for (const p of leitura.processos) {
      if (r.length >= ITENS_MAX) break;
      if (p?.classe !== 'claude' || !inteiroNaoNeg(p.pid) || !inteiroNaoNeg(p.cpuMs)) continue;
      const rssBytes = Number.isFinite(p.rssBytes) && p.rssBytes > 0 ? p.rssBytes : 0;
      const a = porPid.get(p.pid);
      const subiu = a === undefined ? null : p.cpuMs - a.cpuMs;
      const parada = subiu !== null && subiu >= 0 && subiu < CPU_PARADA_MS;
      r.push({ pid: p.pid, desdeMs: parada ? a.desdeMs : agoraMs, cpuMs: p.cpuMs, rssBytes });
    }
    return r;
  } catch {
    return [];
  }
}

// Quantas sessões estão paradas há minMs ou mais em agoraMs, e quanta RAM ocupam.
export function paradas(lista, agoraMs, { minMs = PARADA_MIN_MS } = {}) {
  let n = 0;
  let rssBytes = 0;
  if (Array.isArray(lista)) {
    for (const o of lista) {
      if (!itemValido(o) || agoraMs - o.desdeMs < minMs) continue;
      n++;
      rssBytes += o.rssBytes;
    }
  }
  return { n, rssBytes };
}
