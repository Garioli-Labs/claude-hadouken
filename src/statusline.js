import { lerStdin } from './util.js';
import { sessaoAtiva, renovarSessao } from './ativas.js';

// Script da statusline: o Claude Code o executa a cada atualização da barra,
// com o JSON da sessão no stdin. Imprime uma linha (ou nada) e sai sempre com
// código 0, sem stack trace.
//
// Toda sessão aberta roda este script, registrada ou não (spec 8.2), então o
// caminho até o gate carrega o mínimo: só util.js e ativas.js (que traz
// estado.js, de onde vêm dirDados e idValido). formato.js, o cache de
// compilação e o resto vêm por import dinâmico depois do gate.

// Se o Claude Code fechar o pipe antes da escrita, o EPIPE vira evento de
// erro no stdout; sem ouvinte ele derrubaria o processo com código 1.
process.stdout.on('error', () => {});

// O Claude Code fecha o stdin depois do JSON; o prazo é só a rede de segurança
// se um dia não fechar. Fica abaixo do debounce de 300 ms da barra, senão
// cada execução seria cancelada pela seguinte e a barra congelaria. Os hooks
// seguem com o padrão de 1 s de lerStdin.
const PRAZO_STDIN_MS = 250;
// Pasta do cache de compilação do Node, dentro do diretório de dados.
const DIR_CACHE = 'cache';

// Liga o cache de compilação do Node (module.enableCompileCache, Node 22.1+)
// em <dirDados>/cache: os módulos compilados daqui em diante são guardados e
// reaproveitados nas próximas execuções. Só é chamado depois do gate, porque
// cria a pasta e grava nela. Sem a função (Node 20) ou com qualquer falha,
// segue sem cache. Nunca lança.
async function ligarCacheCompilacao(dir) {
  if (dir === null) return;
  try {
    const [{ default: path }, modulo] = await Promise.all([import('node:path'), import('node:module')]);
    if (typeof modulo.enableCompileCache === 'function') modulo.enableCompileCache(path.join(dir, DIR_CACHE));
  } catch { /* sem cache: segue compilando */ }
}

async function principal() {
  const texto = await lerStdin(PRAZO_STDIN_MS);
  let entrada = {};
  try {
    const v = JSON.parse(texto);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) entrada = v;
  } catch { /* entrada inválida: segue com {} */ }
  const agoraMs = Date.now();
  // Spec 8.2: sessão que não passou pelo SessionStart do plugin (aberta antes
  // da instalação, ou sem session_id válido) fica como estava: nada impresso,
  // nada gravado, nem o cache de compilação.
  if (!sessaoAtiva(entrada.session_id, agoraMs)) return;
  // Só depois do gate: sessão vencida ou desconhecida nunca é revivida. Grava
  // no máximo uma vez por hora (RENOVAR_APOS_MS), não a cada redesenho.
  renovarSessao(entrada.session_id, agoraMs);
  // estado.js já está carregado (veio com ativas.js); o import só o nomeia.
  const { dirDados, atualizarEstado, limitesValidos } = await import('./estado.js');
  // O cache vale para o que for compilado depois dele: liga antes de formato.js.
  await ligarCacheCompilacao(dirDados());
  const { formatarBarra } = await import('./formato.js');
  const { estado } = atualizarEstado(entrada, agoraMs);
  const limites = limitesValidos(estado, agoraMs);
  // no-color.org: NO_COLOR presente e não vazio desliga as cores.
  const cor = !process.env.NO_COLOR;
  process.stdout.write(formatarBarra({ entrada, limites, agoraMs, cor }));
}

principal().catch(() => {}).finally(() => { process.exitCode = 0; });
