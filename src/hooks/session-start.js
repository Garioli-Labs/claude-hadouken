import { spawn } from 'node:child_process';
import path from 'node:path';
import { rodarHook, emitirContexto } from './comum.js';
import { caminhoDoAmbiente, dirDados, idValido } from '../base.js';
import { registrarSessao } from '../ativas.js';

// Hook SessionStart (spec 6.5, 8.2 e adendo A/B da Task 7; E4 da v0.3.0).
// Roda em toda origem (startup, resume, clear, compact e qualquer outra), sem
// matcher:
// 1. registra a sessão em <dirDados>/ativas/, o que liga a barra e os alertas
//    para ela (o gate de ativação);
// 2. sincroniza os shims estáveis de <dirDados>/bin/ com a versão do plugin
//    em uso (CLAUDE_PLUGIN_ROOT);
// 3. injeta uma linha com o consumo atual, mais uma linha fixa para cada
//    passo anterior que falhou;
// 4. depois da saída, com os shims em dia e sem HADOUKEN_SEM_PAINEL=1,
//    dispara em segundo plano a instalação da extensão do painel no VS Code
//    (dispararPainel). Nada deste passo entra no contexto (zero tokens), e o
//    hook não espera o filho.
// session_id ausente ou inválido, ou sem diretório de dados: nenhum registro,
// nenhuma linha, nenhuma escrita.
//
// Texto injetado (spec 8.1, S1): só números validados, horários formatados e
// rótulos fixos de linha-estado.js. Nada de estado.json, do stdin, do
// ambiente ou de um motivo de erro entra como texto.

// Dispara `node <raiz>/src/cli.js painel instalar` destacado quando a versão
// do plugin ainda não está instalada no VS Code e não houve tentativa na
// última hora (precisaInstalar). A tentativa é marcada aqui, antes do
// disparo, para duas sessões abertas juntas não dispararem duas vezes. O
// filho não herda stdin, stdout nem stderr (o Claude Code recebe o fim do
// hook sem esperar a instalação), roda com o cwd na pasta de dados (nunca no
// repo aberto) e sem janela no Windows. Melhor esforço: nunca lança, e um
// erro do spawn só é engolido.
async function dispararPainel(dir, agoraMs) {
  try {
    const raiz = caminhoDoAmbiente(process.env.CLAUDE_PLUGIN_ROOT);
    if (raiz === null) return;
    // Caminho rápido do dia a dia: versão já instalada. Duas leituras de JSON
    // pequenas, com o estado.js que este hook já carregou, e nada do
    // instalador (vsix, zlib) entra no processo.
    const { lerJson } = await import('../estado.js');
    const plugin = lerJson(path.join(raiz, '.claude-plugin', 'plugin.json'), 64 * 1024);
    const instalado = lerJson(path.join(dir, 'painel', 'instalado.json'), 4 * 1024);
    const versaoDe = (r) => (r.ok && r.valor !== null && typeof r.valor === 'object' && typeof r.valor.versao === 'string' ? r.valor.versao : null);
    const atual = plugin.ok && plugin.valor !== null && typeof plugin.valor === 'object' && typeof plugin.valor.version === 'string' ? plugin.valor.version : null;
    if (atual !== null && versaoDe(instalado) === atual) return;
    const { marcarTentativa, precisaInstalar, versaoDoPlugin } = await import('../painel/instalar-painel.js');
    const versao = versaoDoPlugin(raiz);
    if (versao === null || !precisaInstalar({ dir, versao, agoraMs })) return;
    if (!marcarTentativa({ dir, agoraMs }).ok) return;
    const filho = spawn(process.execPath, [path.join(raiz, 'src', 'cli.js'), 'painel', 'instalar'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: raiz },
    });
    filho.on('error', () => {});
    filho.unref();
  } catch {
    // sem painel nesta sessão; a barra e o contexto não mudam
  }
}

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  const registro = registrarSessao(sessionId, agoraMs);
  const [{ sincronizarShims }, { ARQ_ESTADO, lerJson, validarEstado, limitesValidos }, linhas] = await Promise.all([
    import('../shim.js'),
    import('../estado.js'),
    import('./linha-estado.js'),
  ]);
  const shims = sincronizarShims(process.env.CLAUDE_PLUGIN_ROOT);
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  const estado = lido.ok ? validarEstado(lido.valor, agoraMs) : null;
  const saida = [linhas.linhaEstado(limitesValidos(estado, agoraMs), agoraMs)];
  if (!registro.ok) saida.push(linhas.linhaSemRegistro(registro.motivo));
  if (!shims.ok) saida.push(linhas.linhaShimIndisponivel(shims.motivo));
  emitirContexto('SessionStart', saida.join('\n'));
  if (shims.ok && process.env.HADOUKEN_SEM_PAINEL !== '1') await dispararPainel(dir, agoraMs);
});
