const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const doisDigitos = (n) => String(n).padStart(2, '0');

export function normalizarEffort(e) {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e && typeof e === 'object' && typeof e.level === 'string') return e.level;
  return null;
}

export function lerStdin() {
  return new Promise((resolve) => {
    let dados = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { dados += c; });
    process.stdin.on('end', () => resolve(dados));
    process.stdin.on('error', () => resolve(dados));
  });
}

export function horaLocal(epochS) {
  const d = new Date(epochS * 1000);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function diaHora(epochS) {
  const d = new Date(epochS * 1000);
  return `${DIAS[d.getDay()]} ${horaLocal(epochS)}`;
}

export function formatarTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
