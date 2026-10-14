import { rodarHook, falharAberto } from './comum.js';
import { dirDados, idValido } from '../base.js';
import { sessaoAtiva } from '../ativas.js';

// Hook PostModelSwitch (spec v0.4.0 §4.3): grava o modelo da sessão em
// modelos.json a cada troca, de qualquer origem (inclusive auto e resume).
// Nome fora da regex vira o rótulo 'fable' ou 'outro' (normalizarModelo).
// Não imprime nada. Exceção depois do gate: registra 'erro' e sai (§4.5).

rodarHook(async (entrada) => {
  if (entrada === null) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  if (!sessaoAtiva(sessionId, agoraMs)) return;
  await falharAberto(dir, 'PostModelSwitch', agoraMs, async () => {
    const reg = await import('../guarda/registros.js');
    reg.marcarSessao(dir, sessionId);
    const modelo = reg.normalizarModelo(entrada.to_model);
    if (modelo !== null) reg.gravarModeloSessao(dir, sessionId, modelo, agoraMs);
  });
});
