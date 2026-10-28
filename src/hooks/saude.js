import { rodarHook, emitirJson, falharAberto, digitado, entrypointSdk } from './comum.js';
import { dirDados } from '../base.js';

// Hook UserPromptExpansion de /hadouken:saude (spec v0.5.5 §6.D). Sempre
// bloqueia a expansão (decision:block), como /hadouken:limites: o texto vai
// só ao usuário e o modelo não é chamado. Mesmo portão (comum.js): recusa -p
// e SDK, e qualquer origem que não seja o comando digitado, antes de ler ou
// gravar qualquer coisa. O argumento nunca volta no texto: só '', 'leve' e
// 'normal' valem. Sem leitura recente, pede uma ao coletor, depois da saída.

const COMANDO = 'hadouken:saude';
const ARGS_MAX = 64;
const USO = 'uso: /hadouken:saude [leve | normal]';
const RECUSADO_ENTRYPOINT = 'hadouken: nada mudado. /hadouken:saude só vale digitado numa sessão normal, não em -p nem no SDK.';
const RECUSADO_ORIGEM = 'hadouken: nada mudado. /hadouken:saude só vale digitado pelo usuário.';
const NAO_GRAVADO = 'hadouken: nada mudado. O modo não pôde ser gravado.';
const ERRO = 'hadouken: não deu para montar a saúde agora.';

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function pedido(entrada) {
  const a = typeof entrada.command_args === 'string' && entrada.command_args.length <= ARGS_MAX ? entrada.command_args.trim().toLowerCase() : null;
  return a === '' || a === 'leve' || a === 'normal' ? a : null;
}

async function decidir(entrada, dir, agoraMs, depois) {
  if (entrypointSdk()) return RECUSADO_ENTRYPOINT;
  if (!digitado(entrada)) return RECUSADO_ORIGEM;
  const p = pedido(entrada);
  if (p === null) return USO;
  if (p !== '') {
    const { gravarModo } = await import('../saude/modo.js');
    const r = gravarModo(dir, p === 'leve', agoraMs);
    if (!r.ok) return NAO_GRAVADO;
    return p === 'leve' ? `hadouken: modo leve até ${hhmm(r.ateMs)}. O Claude passa a trabalhar em série; /hadouken:saude normal volta.` : 'hadouken: modo normal.';
  }
  const [{ relatorioSaude }, ler] = await Promise.all([import('../saude/relatorio.js'), import('../saude/ler.js')]);
  ler.talvezColetar(dir, agoraMs, {
    dirProjeto: typeof entrada.cwd === 'string' ? entrada.cwd : undefined,
    disparar: (o) => { depois.pedido = o; },
  });
  return relatorioSaude({ dir, agoraMs, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
}

rodarHook(async (entrada) => {
  if (entrada === null || entrada.command_name !== COMANDO) return;
  const dir = dirDados();
  const agoraMs = Date.now();
  let reason = ERRO;
  const depois = { pedido: null };
  await falharAberto(dir, 'saude', agoraMs, async () => {
    if (dir === null) return;
    reason = await decidir(entrada, dir, agoraMs, depois);
  });
  emitirJson({ decision: 'block', reason });
  if (depois.pedido !== null) {
    try {
      await (await import('../saude/ler.js')).dispararDoHook(dir, depois.pedido);
    } catch { /* sem coleta agora */ }
  }
}, undefined, undefined, 'saude', { prazoMs: 8000 });
