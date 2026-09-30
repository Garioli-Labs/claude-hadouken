import { rodarHook, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook StopFailure com matcher rate_limit (spec v0.4.0 §5.2 G6, C13). O texto
// do erro só é classificado, nunca gravado nem repetido (S17): com "fable"
// nele, o limite é do Fable e o G6 trava na avaliação seguinte; senão, é
// registrado como geral. A saída do StopFailure é ignorada pelo Claude Code;
// o hook não imprime nada. O S4 (o texto exato na thread principal e em
// subagente) fica para a parte 2. Exceção depois do gate: registra 'erro' e
// sai (§4.5).

const TEXTO_MAX = 4096;

rodarHook(async (entrada) => {
  if (entrada === null || entrada.error_type !== 'rate_limit') return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  await falharAberto(dir, 'StopFailure', agoraMs, async () => {
    const reg = await import('../guarda/registros.js');
    const texto = [entrada.error_details, entrada.last_assistant_message]
      .filter((t) => typeof t === 'string').map((t) => t.slice(0, TEXTO_MAX)).join(' ');
    reg.registrarLimite(dir, /\bfable\b/i.test(texto) ? 'fable' : 'geral', agoraMs);
  });
});
