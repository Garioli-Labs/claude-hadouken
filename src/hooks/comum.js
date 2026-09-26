import { lerStdin } from '../util.js';

// O que os três hooks do plugin (spec 6.5) têm em comum: ler o JSON do
// stdin, escrever o contexto no formato do Claude Code e sair sempre com
// código 0, sem stack trace. Nenhum hook bloqueia o prompt nem devolve erro ao
// Claude: qualquer falha termina calada.
//
// Este arquivo fica no caminho curto de todo hook (antes do gate de ativação,
// spec 8.2), então só importa util.js.

// Se o Claude Code fechar o pipe antes da escrita, o EPIPE vira evento de
// erro no stdout; sem ouvinte ele derrubaria o processo com código 1.
process.stdout.on('error', () => {});

// Escreve { hookSpecificOutput: { hookEventName, additionalContext } }. O
// JSON.stringify escapa todo controle C0; o texto vem só de rótulos do código
// e números validados (spec 8.1, S1), então nada de fora chega aqui.
export function emitirContexto(evento, texto) {
  if (typeof evento !== 'string' || typeof texto !== 'string' || texto.length === 0) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: texto } }));
}

// Objeto JSON do stdin, ou null (vazio, inválido, lista, primitivo, acima do
// teto de 1 MiB de lerStdin).
function entradaDe(texto) {
  try {
    const v = JSON.parse(texto);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Lê o stdin, chama fn(entrada | null) e sai com 0 aconteça o que acontecer:
// erro síncrono, promessa rejeitada ou stdin quebrado. Usa exitCode (nunca
// process.exit) para que a escrita no stdout termine antes da saída.
export function rodarHook(fn) {
  lerStdin()
    .then((texto) => fn(entradaDe(texto)))
    .catch(() => {})
    .finally(() => { process.exitCode = 0; });
}
