import { dirDados } from '../base.js';
import { emitirJson, rodarHook } from './comum.js';

// Hook UserPromptExpansion de /claude-hadouken:aprender (spec aprendizado
// §3.2, R4, R5). Sempre bloqueia a expansão (decision:block): o corpo da
// skill não chega ao Claude, o modelo não é chamado e a `reason` vai só ao
// usuário. A recusa de -p e SDK e a conferência da origem (command_source e
// expansion_type, a lista fechada do liberar.js, ruling I1) ficam em
// comando.js, antes de qualquer outra leitura (Foco de revisão 5). Sem rede e
// sem processo filho aqui nem em comando.js
// (test/aprendizado-fronteiras.test.js): o download e o Collector moram em
// baixar.js e coletor.js, que comando.js só carrega por import dinâmico
// (ligar.js e coletor.js), nos ramos que os usam, depois dos portões.
// Timeout de 600 s no hooks.json (R5); o download tem prazo próprio.

const COMANDO = 'claude-hadouken:aprender';
// O mesmo texto de FALHOU (mensagens.js), para quando o import dele falha.
const FALHOU_RESERVA = 'hadouken: o comando falhou. Confira o estado com /claude-hadouken:aprender status.';

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = FALHOU_RESERVA;
  try {
    const { executarComando } = await import('../aprendizado/comando.js');
    reason = await executarComando({
      dir,
      texto: typeof entrada.command_args === 'string' ? entrada.command_args : '',
      agoraMs,
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
      fonte: entrada.command_source,
      expansao: entrada.expansion_type,
    });
  } catch {
    // Só com o aprendizado ligado o evento é gravado: desligado não cria
    // arquivo nenhum (§11).
    try {
      const [{ ligadoExiste }, { anexarEventoApr }] = await Promise.all([
        import('../aprendizado/arquivos.js'),
        import('../aprendizado/registro.js'),
      ]);
      if (ligadoExiste(dir)) anexarEventoApr(dir, 'erro', agoraMs);
    } catch { /* nada a fazer: a resposta segue */ }
  }
  emitirJson({ decision: 'block', reason });
});
