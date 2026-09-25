const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEM_VALOR = '—';
const doisDigitos = (n) => String(n).padStart(2, '0');
const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);

export function normalizarEffort(e) {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e && typeof e === 'object' && typeof e.level === 'string') return e.level;
  return null;
}

// Lê todo o stdin. Nunca bloqueia: com TTY devolve '' na hora; se o 'end'
// não chegar em prazoMs, devolve o que já leu e solta o stdin.
export function lerStdin(prazoMs = 1000) {
  return new Promise((resolve) => {
    const entrada = process.stdin;
    if (entrada.isTTY) {
      resolve('');
      return;
    }
    let dados = '';
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(prazo);
      entrada.off('data', aoLer);
      entrada.off('end', terminar);
      entrada.off('error', terminar);
      entrada.pause();
      resolve(dados);
    };
    const aoLer = (c) => { dados += c; };
    const prazo = setTimeout(terminar, prazoMs);
    entrada.setEncoding('utf8');
    entrada.on('data', aoLer);
    entrada.on('end', terminar);
    entrada.on('error', terminar);
  });
}

export function horaLocal(epochS) {
  if (!numeroFinito(epochS)) return SEM_VALOR;
  const d = new Date(epochS * 1000);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function diaHora(epochS) {
  if (!numeroFinito(epochS)) return SEM_VALOR;
  const d = new Date(epochS * 1000);
  return `${DIAS[d.getDay()]} ${horaLocal(epochS)}`;
}

export function formatarTokens(n) {
  if (!numeroFinito(n)) return SEM_VALOR;
  // A partir de 999 500 o arredondamento em k daria "1000k": vira M.
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
