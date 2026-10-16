import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rodarHook, emitirContexto, emitirJson, falharAberto, dentroDeSubagente } from './comum.js';
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
//    passo anterior que falhou e, se a instalação do item do VS Code falhou
//    (v0.5.2), uma com o motivo;
// 4. depois da saída, com os shims em dia e sem HADOUKEN_SEM_PAINEL=1,
//    dispara em segundo plano a instalação da extensão do painel no VS Code
//    (dispararPainel). Nada deste passo entra no contexto (zero tokens), e o
//    hook não espera o filho;
// 5. grava a marca da guarda e o modelo da sessão (spec v0.4.0 §4.3);
// 6. fotografa os campos da guarda (disableAllHooks, enabledPlugins, hooks)
//    dos três settings da sessão em <dirDados>/config-base.json, a base do
//    hook ConfigChange (Task 19b, guarda/config-base.js). Roda em toda origem,
//    mas só grava o que a sessão ainda não tem: um compact, clear ou resume
//    da mesma sessão não troca a base dela (fix round 1). A fotografia nunca
//    derruba nem muda a saída: erro vira o evento 'erro' config-foto.
// 7. com o aprendizado ligado (otel/ligado.json), o anúncio e os avisos do
//    aprendizado vão ao usuário pelo systemMessage (spec aprendizado §4.6,
//    R13), fora do contexto do Claude; depois da saída, a vida do Collector e
//    o passo de aprendizado (passo.js). Desligado, nada disso é carregado; só
//    um otel/coletor.pid que sobrou de um desligar cuja parada falhou (Task
//    10) carrega passo.js, para uma parada por melhor esforço.
// session_id ausente ou inválido, ou sem diretório de dados: nenhum registro,
// nenhuma linha, nenhuma escrita. O mesmo dentro de um subagente
// (dentroDeSubagente, spec v0.4.0 §10, item 3).
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

// otel/coletor.pid como arquivo regular (lstat; link não conta): com o
// aprendizado desligado, é tudo o que se olha (o fs já veio com base.js).
function pidDeColetor(arquivo) {
  try {
    return fs.lstatSync(arquivo, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

rodarHook(async (entrada) => {
  if (entrada === null || !Object.hasOwn(entrada, 'session_id')) return;
  const sessionId = entrada.session_id;
  if (!idValido(sessionId)) return;
  // Spec v0.4.0 §10, item 3: dentro de um subagente (o SessionStart:compact
  // dele chega com o session_id da mãe), nada. Nem registro, nem shims, nem
  // linha, nem modelo: o `model` ali é o do subagente, e gravá-lo como o da
  // sessão soltaria a P2 e a P3 numa sessão Fable.
  if (dentroDeSubagente(entrada)) return;
  const dir = dirDados();
  if (dir === null) return;
  const agoraMs = Date.now();
  const registro = registrarSessao(sessionId, agoraMs);
  // Spec v0.4.0 §4.3 e §11: a marca "sessão com a guarda" e o modelo da
  // sessão (o campo model do SessionStart, quando vier). Uma exceção aqui
  // registra 'erro' e não tira a linha de consumo nem os shims (§4.5). A
  // marca que não grava (marcarSessao devolve ok false, sem lançar; ex.:
  // guarda-sessoes como arquivo) também vira 'erro', e o modelo segue.
  await falharAberto(dir, 'SessionStart', agoraMs, async () => {
    const reg = await import('../guarda/registros.js');
    if (!reg.marcarSessao(dir, sessionId).ok) reg.anexarEvento(dir, 'erro', 'SessionStart', agoraMs);
    const modelo = reg.normalizarModelo(entrada.model);
    if (modelo !== null) reg.gravarModeloSessao(dir, sessionId, modelo, agoraMs);
  });
  // Task 19b: a fotografia dos settings da sessão (o do usuário e os dois do
  // projeto no cwd; sem cwd absoluto na entrada, o do processo, que o Claude
  // Code abre no projeto), sob o session_id; o que a sessão já tem fica.
  // Exceção (o hash, a casa que não se lê) ou gravação que falha: 'erro'
  // config-foto, e o SessionStart segue igual.
  await falharAberto(dir, 'config-foto', agoraMs, async () => {
    const foto = await import('../guarda/config-base.js');
    const cwd = typeof entrada.cwd === 'string' && path.isAbsolute(entrada.cwd) ? entrada.cwd : process.cwd();
    let casa = null;
    try { casa = os.homedir(); } catch { /* sem casa: o do usuário só pelo CLAUDE_CONFIG_DIR */ }
    const arquivos = foto.settingsDaSessao({ cwd, configDir: process.env.CLAUDE_CONFIG_DIR, casa });
    if (!foto.fotografar(dir, sessionId, arquivos, agoraMs).ok) (await import('../guarda/registros.js')).anexarEvento(dir, 'erro', 'config-foto', agoraMs);
  });
  const [{ sincronizarShims }, { ARQ_ESTADO, lerJson, validarEstado, leiturasComPiso, ultimaLeitura }, linhas] = await Promise.all([
    import('../shim.js'),
    import('../estado.js'),
    import('./linha-estado.js'),
  ]);
  const shims = sincronizarShims(process.env.CLAUDE_PLUGIN_ROOT);
  const lido = lerJson(path.join(dir, ARQ_ESTADO));
  const estado = lido.ok ? validarEstado(lido.valor, agoraMs) : null;
  const saida = [linhas.linhaEstado(leiturasComPiso(estado, agoraMs), agoraMs, ultimaLeitura(estado, agoraMs))];
  if (!registro.ok) saida.push(linhas.linhaSemRegistro(registro.motivo));
  if (!shims.ok) saida.push(linhas.linhaShimIndisponivel(shims.motivo));
  // v0.5.2: a instalação do item do VS Code falhou e a versão atual não está
  // instalada: uma linha com o motivo e o conserto (rótulos fixos). Com
  // HADOUKEN_SEM_PAINEL=1, nada. Um import que falha só tira a linha.
  if (process.env.HADOUKEN_SEM_PAINEL !== '1') {
    try {
      const motivo = (await import('../painel/falha.js')).falhaPendente({ dir, raizPlugin: process.env.CLAUDE_PLUGIN_ROOT });
      if (motivo !== null) saida.push(linhas.linhaPainel(motivo));
    } catch { /* sem a linha do painel nesta sessão */ }
  }
  // Aprendizado (spec aprendizado §4.6, §11, R13): arquivos.js é leve;
  // passo.js só carrega com o aprendizado ligado. Um import que falha não
  // tira a linha de consumo: segue como desligado.
  let apr = null;
  try {
    apr = await import('../aprendizado/arquivos.js');
  } catch { /* sem aprendizado nesta sessão */ }
  const aprendizadoLigado = apr !== null && apr.ligadoExiste(dir);
  let aprendizado = [];
  if (aprendizadoLigado) {
    try {
      aprendizado = (await import('../aprendizado/passo.js')).linhasDoInicio({ dir, agoraMs });
    } catch { /* sem linha do aprendizado nesta sessão */ }
  }
  // Ao usuário, fora do contexto do Claude (systemMessage): a linha de
  // retomada (spec v0.4.0 §10, item 11: ao retomar com o cache expirado) e
  // as do aprendizado (R13).
  const retomada = linhas.linhaRetomada(entrada);
  const aoUsuario = [retomada, ...aprendizado].filter((x) => typeof x === 'string' && x.length > 0);
  // Spec roteamento §2: a regra curta vai sempre, por último; um import que
  // falha só a tira.
  try {
    saida.push(...(await import('../roteamento/regra.js')).LINHAS_REGRA);
  } catch { /* sem a regra nesta sessão */ }
  if (aoUsuario.length === 0) emitirContexto('SessionStart', saida.join('\n'));
  else emitirJson({ systemMessage: aoUsuario.join('\n'), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: saida.join('\n') } });
  if (shims.ok && process.env.HADOUKEN_SEM_PAINEL !== '1') await dispararPainel(dir, agoraMs);
  if (aprendizadoLigado) {
    try {
      (await import('../aprendizado/passo.js')).depoisDoInicio({ dir, sessionId, source: entrada.source, agoraMs });
    } catch { /* o passo registra os próprios erros; um import que falha só pula o passo */ }
  } else if (apr !== null && pidDeColetor(apr.caminhos(dir).pid)) {
    try {
      (await import('../aprendizado/passo.js')).pararSemLigado({ dir, agoraMs });
    } catch { /* melhor esforço: a próxima sessão tenta de novo */ }
  }
});
