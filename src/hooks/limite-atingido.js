import { rodarHook, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook StopFailure com matcher rate_limit (spec v0.4.0 §5.2 G6, C13). O texto
// do erro só é classificado, nunca gravado nem repetido (S17): com "fable"
// no error_details (ou a frase "reached your Fable limit" na última resposta),
// o limite é do Fable e o G6 trava na avaliação seguinte; senão, é
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
    // No error_details basta a palavra; na última resposta, só a frase do
    // limite — uma resposta que cita o Fable num limite geral não trava o
    // Fable (menor M-4 do portão v0.4.0).
    const texto = (t) => (typeof t === 'string' ? t.slice(0, TEXTO_MAX) : '');
    const fable = /\bfable\b/i.test(texto(entrada.error_details))
      || /\breached your fable limit\b/i.test(texto(entrada.last_assistant_message));
    reg.registrarLimite(dir, fable ? 'fable' : 'geral', agoraMs);
  });
});
