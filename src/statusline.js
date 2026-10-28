import { fileURLToPath } from 'node:url';
import { lerStdin, dirDados } from './base.js';
import { sessaoAtiva, renovarSessao } from './ativas.js';

// Script da statusline: o Claude Code o executa a cada atualização da barra,
// com o JSON da sessão no stdin. Imprime uma linha (ou nada) e sai sempre com
// código 0, sem stack trace.
//
// Toda sessão aberta roda este script, registrada ou não (spec 8.2), então o
// caminho até o gate carrega o mínimo: base.js (lerStdin, dirDados e
// idValido) e ativas.js. estado.js, formato.js e o resto (util.js incluído)
// vêm por import dinâmico depois do gate.

// Se o Claude Code fechar o pipe antes da escrita, o EPIPE vira evento de
// erro no stdout; sem ouvinte ele derrubaria o processo com código 1.
process.stdout.on('error', () => {});

// O Claude Code fecha o stdin depois do JSON; o prazo é só a rede de segurança
// se um dia não fechar. Fica abaixo do debounce de 300 ms da barra, senão
// cada execução seria cancelada pela seguinte e a barra congelaria. Os hooks
// seguem com o padrão de 1 s de lerStdin.
const PRAZO_STDIN_MS = 250;

// Spec §8.3 e §11: o segmento da guarda. A avaliação também grava a trava na
// transição (§5.3, "quem avaliar primeiro"). Sem a marca, a sessão roda hooks
// antigos: "sem guarda nesta sessão". Qualquer falha dá '' (a barra da v0.3.0
// segue igual).
async function segmentoDaGuarda(dir, entrada, agoraMs) {
  try {
    if (dir === null) return '';
    const [{ avaliarGuarda }, reg, { segmentoBarra }] = await Promise.all([
      import('./guarda/avaliar.js'),
      import('./guarda/registros.js'),
      import('./guarda/mensagens.js'),
    ]);
    const g = avaliarGuarda({ dir, agoraMs, sessionId: entrada.session_id });
    const m = entrada.model !== null && typeof entrada.model === 'object' ? entrada.model : {};
    const nomeModelo = [m.id, m.display_name].filter((x) => typeof x === 'string').join(' ').slice(0, 200);
    // M3 da revisão final da parte 1: só a liberação em vigor (cobertura
    // ativa) vai à barra, com ou sem trava descoberta ao lado; a vencida, não.
    // M4: o evento 'erro' recente de hook, na mesma leitura dos eventos.
    const liberacao = g.cobertura?.ativa === true && g.liberacao ? g.liberacao : null;
    const sinais = reg.sinaisDaBarra(dir, liberacao ? liberacao.id : null, agoraMs);
    return segmentoBarra({
      marcada: reg.sessaoMarcada(dir, entrada.session_id), status: g.status, ativas: g.ativas, liberacao,
      origemConhecida: sinais.origemConhecida, erroRecente: sinais.erroRecente,
      fableSessao: /fable/i.test(nomeModelo), despachosFable: g.despachosFable, config: g.config, usoFable: g.usoFable,
    }, agoraMs);
  } catch {
    return '';
  }
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
  // nada gravado.
  if (!sessaoAtiva(entrada.session_id, agoraMs)) return;
  // Só depois do gate: sessão vencida ou desconhecida nunca é revivida. Grava
  // no máximo uma vez por hora (RENOVAR_APOS_MS), não a cada redesenho.
  renovarSessao(entrada.session_id, agoraMs);
  const [{ atualizarEstado, lerJson }, { formatarBarra }] = await Promise.all([
    import('./estado.js'),
    import('./formato.js'),
  ]);
  // E6: a barra fica só com a sessão, mas a statusline segue gravando
  // rate_limits e o histórico em estado.json a cada atualização, porque essa é
  // a fonte exata e gratuita do 5h e da semana (hooks e painel leem dali).
  // limitesValidos, preverEstouro e sessoesAtivas saíram daqui: a barra não os
  // mostra mais, e cada redesenho economiza essa conta.
  atualizarEstado(entrada, agoraMs);
  // A guarda lê a janela de 7 dias do estado.json recém-gravado, não da barra.
  const guarda = await segmentoDaGuarda(dirDados(), entrada, agoraMs);
  // Spec roteamento §7: a marca da sugestão em curso; uma falha só a tira.
  let marca = null;
  try {
    marca = (await import('./roteamento/fila.js')).marcaDaSessao(dirDados(), entrada.session_id, agoraMs);
  } catch { /* sem marca */ }
  // no-color.org: NO_COLOR presente e não vazio desliga as cores.
  const cor = !process.env.NO_COLOR;
  // v0.5.3: a versão do hadouken que roda esta barra, do plugin.json ao lado
  // deste script; formatarBarra valida o formato e a põe no canto direito.
  const plugin = lerJson(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 64 * 1024);
  const versao = plugin.ok && plugin.valor !== null && typeof plugin.valor === 'object' ? plugin.valor.version : undefined;
  // v0.5.4: faixas da barra do config.json; uma falha deixa as de sempre.
  let faixas;
  try {
    faixas = (await import('./config/ler.js')).faixasBarra(dirDados());
  } catch { /* faixas de sempre */ }
  process.stdout.write(formatarBarra({ entrada, cor, guarda, versao, marca, faixas }));
}

principal().catch(() => {}).finally(() => { process.exitCode = 0; });
