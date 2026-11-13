'use strict';

// Extensão do painel no VS Code (spec E4, Task 4): um item na barra de status
// com 5h, semana e Fable, sem webview e sem dependências. A extensão é fina: a
// lógica mora no plugin (src/uso/painel.js), carregada pelo shim estável
// <dirDados>/bin/painel.mjs que o SessionStart mantém (sincronizarShims), e
// aqui só há o relógio e o desenho:
// - a cada 5 s o item é redesenhado com estadoPainel, que só lê arquivos;
// - depois do desenho, se esta janela não tem leitura em curso, pede
//   talvezAtualizar({}) sem esperar. É ele que decide se lê de fato: 30 s entre
//   leituras, uma só entre todas as janelas (trava), só com sessão ativa e
//   nunca com pouca RAM (E3). O motivo devolvido vai para o estadoPainel
//   seguinte (ultimoMotivo), que o mostra na dica;
// - o comando "Claude Hadouken: atualizar uso agora" pede
//   talvezAtualizar({ forcar: true }), que ainda respeita a trava e a pausa por
//   RAM (Foco 4), e redesenha;
// - sem o shim (nenhuma sessão do Claude Code abriu com o plugin nesta
//   máquina, ou a pasta de dados é inválida), o item diz "abra uma sessão do
//   Claude Code" e o import só é tentado de novo depois de 60 s; o comando
//   manual tenta na hora (Foco 5). Um painel que lança é descartado e
//   recarregado pela mesma regra (plugin atualizado com a janela aberta).
// Spec v0.5.3 VS Code §3: com o shim novo (painel-api.js), o item traz a logo
// animada no começo (no mesmo item desde a v0.5.7, na cor do texto da barra,
// para aparecer em qualquer tema), segmentos de energia no lugar das
// porcentagens soltas e a seta da versão nova; o clique abre a janela. Um
// shim velho, só com estadoPainel e talvezAtualizar, segue como antes:
// `$(pulse)` e o clique atualiza o uso (foco 1).
// Nenhum callback lança: tudo fica em try/catch, e nenhuma promessa fica sem
// tratamento. CommonJS, porque o VS Code carrega a extensão com require; o
// ESM do plugin entra por import() dinâmico.

const vscode = require('vscode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RELOGIO_MS = 5_000;
const NOVA_CARGA_MS = 60_000;
// No máximo um pedido de leitura a cada 30 s por janela, diga o painel o que
// disser: se a gravação do uso-oficial.json falhar (disco cheio), a recência
// gravada não segura o próximo tique, e sem este piso cada tique de 5 s
// rodaria outro `claude` (E3, RAM).
const PEDIDO_MIN_MS = 30_000;
// Cada import com ?t= novo deixa o grafo anterior na memória. Um painel que
// lança sai de uso e é recarregado, mas no máximo MAX_RECARGAS vezes por
// processo; depois disso a janela fica em "abra uma sessão" até ser
// recarregada (Reload Window), e a memória não cresce (RAM).
const MAX_RECARGAS = 5;
const COMANDO = 'claudeHadouken.atualizarUso';
const TEXTO_SEM_MODULO = '$(pulse) Hadouken: abra uma sessão do Claude Code';
const SEM_LEITURA = Object.freeze({ texto: 'Hadouken: sem leitura', nivel: 'sem-leitura', dica: '' });
const TEXTO_MAX = 120;
const COR = Object.freeze({ __proto__: null, aviso: 'statusBarItem.warningBackground', erro: 'statusBarItem.errorBackground' });
// Caminho absoluto completo no Windows, a mesma regra de base.js
// (COMPLETO_WIN): letra de unidade, ou UNC com servidor e compartilhamento,
// fora os caminhos de dispositivo (\\?\ e \\.\).
const COMPLETO_WIN = /^(?:[A-Za-z]:[\\/]|[\\/]{2}(?![?.][\\/])[^\\/]+[\\/]+[^\\/])/;

const COMANDO_JANELA = 'claudeHadouken.abrirJanela';
const VERSAO = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

// 5 quadros a 120 ms, em loop (v0.5.7); nada com movimento reduzido ou
// painel.animarLogo false.
const QUADROS = Object.freeze(['$(hadouken-0)', '$(hadouken-1)', '$(hadouken-2)', '$(hadouken-3)', '$(hadouken-4)']);
const QUADRO_MS = 120;
const quadros = () => [...QUADROS];

// Barra de vida: 8 segmentos, em meios (55% são 4 cheios, 1 meio e 3 vazios).
const SEGMENTOS = 8;
function segmentos(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const meios = Math.round((Math.min(100, Math.max(0, pct)) / 100) * SEGMENTOS * 2);
  const cheios = Math.floor(meios / 2);
  const meio = meios % 2;
  return [
    ...Array(cheios).fill('$(hadouken-seg-cheio)'),
    ...Array(meio).fill('$(hadouken-seg-meio)'),
    ...Array(SEGMENTOS - cheios - meio).fill('$(hadouken-seg-vazio)'),
  ];
}

function movimentoReduzido() {
  try {
    const v = vscode.workspace.getConfiguration('workbench').get('reduceMotion');
    return v === 'on'; // 'auto' segue o sistema, que a extensão não lê: anima (ruling: o webview respeita prefers-reduced-motion por CSS)
  } catch {
    return false;
  }
}

const CHAVE_AVISADA = 'claudeHadouken.versaoAvisada';
const CONSULTA_VERSAO_TIQUES = 120; // 10 min com o relógio de 5 s

// O que o shim tem além dos dois nomes de sempre.
const apiDe = (m) => ({
  janela: typeof m.lerConfiguracao === 'function' && typeof m.gravarConfiguracao === 'function',
  versao: typeof m.estadoVersao === 'function',
  evento: typeof m.ultimoEvento === 'function',
});

// Chama m[nome]() se a API tem o nome; null em qualquer falha. Nunca rejeita.
const chamar = (m, nome) => Promise.resolve().then(() => (typeof m[nome] === 'function' ? m[nome]() : null)).catch(() => null);

// Spec vscode §4.4: só esta lista de mensagens da janela, cada uma com a forma
// conferida; o resto é ignorado.
const TIPOS_MENSAGEM = new Set(['pronto', 'salvar', 'voltarPadrao', 'desfazer', 'atualizarUso', 'atualizarHadouken', 'ligarAprendizado', 'desligarAprendizado', 'ligarLeve', 'desligarLeve', 'conta']);
const CHAVE_CONFIG = /^[a-zA-Z0-9.]{1,60}$/;
const VERSAO_CONFIG = /^([0-9a-f]{16}|ausente)$/;
const MAX_CHAVES = 40;
const DESFAZER_MS = 15_000;
const objetoSimples = (o) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;

// A mensagem da janela numa forma limpa, ou null.
function mensagemValida(msg) {
  if (!objetoSimples(msg) || typeof msg.tipo !== 'string' || !TIPOS_MENSAGEM.has(msg.tipo)) return null;
  if (msg.tipo === 'salvar') {
    const m = msg.mudancas;
    if (!objetoSimples(m) || typeof msg.versao !== 'string' || !VERSAO_CONFIG.test(msg.versao)) return null;
    const chaves = Object.keys(m);
    if (chaves.length === 0 || chaves.length > MAX_CHAVES) return null;
    if (!chaves.every((k) => CHAVE_CONFIG.test(k) && (Number.isSafeInteger(m[k]) || typeof m[k] === 'boolean'))) return null;
    return { tipo: 'salvar', mudancas: Object.fromEntries(chaves.map((k) => [k, m[k]])), versao: msg.versao };
  }
  if (msg.tipo === 'voltarPadrao') {
    const ids = msg.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_CHAVES || typeof msg.versao !== 'string' || !VERSAO_CONFIG.test(msg.versao)) return null;
    if (!ids.every((k) => typeof k === 'string' && CHAVE_CONFIG.test(k))) return null;
    return { tipo: 'voltarPadrao', ids: [...ids], versao: msg.versao };
  }
  return { tipo: msg.tipo };
}

// Os erros de validação do plugin, só com id e texto curtos.
const errosLimpos = (erros) => (Array.isArray(erros) ? erros : [])
  .filter((e) => e !== null && typeof e === 'object' && typeof e.texto === 'string')
  .slice(0, MAX_CHAVES)
  .map((e) => ({ id: typeof e.id === 'string' ? e.id.slice(0, 60) : null, texto: e.texto.slice(0, 200) }));

const pctValido = (p) => p === null || (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1000);
const completo = (p) => typeof p === 'string' && (process.platform === 'win32' ? COMPLETO_WIN.test(p) : p.startsWith('/'));

// Pasta de dados com a regra de dirDados (base.js): HADOUKEN_HOME, quando
// definida, só vale como caminho absoluto completo sem NUL, e definida com
// qualquer outro valor dá null (nunca a pasta padrão); sem ela,
// ~/.claude/hadouken. Nunca lança.
function dirDados() {
  try {
    const configurado = process.env.HADOUKEN_HOME;
    if (configurado !== undefined) {
      if (!completo(configurado) || configurado.includes('\0')) return null;
      const resolvido = path.resolve(configurado);
      return completo(resolvido) ? resolvido : null;
    }
    const home = os.homedir();
    if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
    // v0.5.9: CLAUDE_CONFIG_DIR de uma conta (~/.claude-contas/<nome>) leva
    // os dados para <conta>/hadouken, como em base.js.
    const conta = contaValida(process.env.CLAUDE_CONFIG_DIR, home);
    return path.join(conta ?? path.join(home, '.claude'), 'hadouken');
  } catch {
    return null;
  }
}

// ------------------------------------------------------- conta por janela (v0.5.9)
// Cada conta é uma pasta em ~/.claude-contas/<nome>, usada como
// CLAUDE_CONFIG_DIR. A janela guarda a escolha nas configurações do workspace
// (claudeCode.environmentVariables e terminal.integrated.env.<so>); a conta é
// só a pasta e o nome que a pessoa deu: nada de e-mail nem credencial.
const COMANDO_CONTA = 'claudeHadouken.conta';
const PASTA_CONTAS = '.claude-contas';
const NOME_CONTA = /^[a-z0-9-]{1,32}$/;

// "Ação 2" -> "acao-2"; null para o que não serve (ou "principal").
function nomeDeConta(texto) {
  if (typeof texto !== 'string') return null;
  const n = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
  return NOME_CONTA.test(n) && n !== 'principal' ? n : null;
}
const rotuloConta = (n) => n.charAt(0).toUpperCase() + n.slice(1).replace(/-/g, ' ');

// As variáveis do Claude Code com a conta (ou sem ela, para a Principal),
// mantendo as outras da pessoa.
function varsComConta(vars, pasta) {
  const resto = Array.isArray(vars) ? vars.filter((v) => objetoSimples(v) && v.name !== 'CLAUDE_CONFIG_DIR') : [];
  return pasta === null ? resto : [...resto, { name: 'CLAUDE_CONFIG_DIR', value: pasta }];
}
function envComConta(env, pasta) {
  const r = objetoSimples(env) ? { ...env } : {};
  delete r.CLAUDE_CONFIG_DIR;
  if (pasta !== null) r.CLAUDE_CONFIG_DIR = pasta;
  return r;
}
// A pasta só vale se for ~/.claude-contas/<nome>: um .vscode/settings.json
// de repositório não leva o painel a carregar código de outra pasta.
function contaValida(c, home) {
  try {
    if (!completo(c) || c.includes('\0') || typeof home !== 'string' || !path.isAbsolute(home)) return null;
    const r = path.resolve(c).replace(/[\\/]+$/, '');
    const igual = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const nome = path.basename(r);
    return igual(path.dirname(r), path.join(home, PASTA_CONTAS)) && NOME_CONTA.test(nome) && nome !== 'principal' ? r : null;
  } catch {
    return null;
  }
}
function pastaDaJanela(vars) {
  if (!Array.isArray(vars)) return null;
  const v = vars.find((x) => objetoSimples(x) && x.name === 'CLAUDE_CONFIG_DIR');
  return v !== undefined ? contaValida(v.value, os.homedir()) : null;
}
function listarContas(raiz) {
  try {
    return fs.readdirSync(raiz, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NOME_CONTA.test(d.name) && d.name !== 'principal')
      .map((d) => d.name).sort();
  } catch {
    return [];
  }
}
// Instalador do plugin (que traz o kit) na conta nova, e o claude para o
// /login. null para uma raiz que não dá para pôr entre aspas com segurança.
function comandoNovaConta(raiz, plataforma) {
  if (typeof raiz !== 'string') return null;
  if (plataforma === 'win32') {
    if (!COMPLETO_WIN.test(raiz) || /["`$\0\r\n]/.test(raiz)) return null;
    return { shellPath: 'powershell.exe', texto: `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.win32.join(raiz, 'install.ps1')}" --sim --sem-extras; claude` };
  }
  if (!raiz.startsWith('/') || /["`$\\\0\r\n]/.test(raiz)) return null;
  return { shellPath: undefined, texto: `bash "${path.posix.join(raiz, 'install.sh')}" --sim --sem-extras; claude` };
}
const soDoTerminal = () => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux');
// O valor do workspace e o global. O objeto do terminal é mesclado entre os
// escopos; a lista do Claude Code não: o do workspace substitui o global.
function valoresDe(cfg, chave) {
  const i = typeof cfg.inspect === 'function' ? cfg.inspect(chave) : undefined;
  return i !== undefined ? { ws: i.workspaceValue, global: i.globalValue } : { ws: cfg.get(chave), global: undefined };
}
// .vscode/settings.json versionado no git? Nunca lança; sem git, false.
function versionadoNoGit(pasta) {
  return new Promise((resolve) => {
    try {
      require('node:child_process').execFile('git', ['ls-files', '--error-unmatch', '.vscode/settings.json'], { cwd: pasta, timeout: 3_000, windowsHide: true }, (erro) => resolve(erro === null));
    } catch {
      resolve(false);
    }
  });
}

// Estado do módulo, dividido entre as ativações do mesmo processo.
let modulo = null;
// O texto do painel.mjs quando o módulo carregou (v0.5.7): o SessionStart
// regrava o shim quando o plugin muda de versão, e o tique compara.
let shimCarregado = null;
let cargaFalhouEm = null;
let descartes = 0;
let carregando = null;
let relogio = null;

// Importa <dirDados>/bin/painel.mjs com um ?t= novo (um import que falhou não
// fica guardado para a próxima tentativa) e confere os dois nomes combinados.
// Rejeita em qualquer falha. O ?t= leva também um contador: dois imports no
// mesmo milissegundo teriam o mesmo endereço e o segundo devolveria o módulo
// velho guardado, que ficaria até o shim mudar de novo.
let importes = 0;
async function importarPainel() {
  const dir = dirDados();
  if (dir === null) throw new Error('sem pasta de dados');
  const texto = lerShim();
  importes += 1;
  const m = await import(`${pathToFileURL(path.join(dir, 'bin', 'painel.mjs')).href}?t=${Date.now()}-${importes}`);
  if (typeof m.estadoPainel !== 'function' || typeof m.talvezAtualizar !== 'function') throw new Error('painel incompleto');
  shimCarregado = texto;
  return m;
}

// O painel.mjs (uma linha, poucas centenas de bytes), ou null. Nunca lança.
function lerShim() {
  try {
    const dir = dirDados();
    return dir === null ? null : fs.readFileSync(path.join(dir, 'bin', 'painel.mjs'), 'utf8').slice(0, 4096);
  } catch {
    return null;
  }
}

// Plugin atualizado: o shim agora aponta para outra versão, e o módulo
// carregado sai de uso sem contar como descarte. O próximo carregar importa o
// novo, sem Reload Window. Shim ilegível: fica o que está. Nunca lança.
function trocarSeShimMudou() {
  if (modulo === null || shimCarregado === null) return;
  const texto = lerShim();
  if (texto === null || texto === shimCarregado) return;
  modulo = null;
  shimCarregado = null;
  cargaFalhouEm = null;
}

// O módulo do painel, ou null. Só importa quando ainda não carregou; depois de
// uma falha, só de novo depois de NOVA_CARGA_MS, a não ser com `forcar`. Quem
// pede durante uma carga recebe a mesma; com `forcar`, se ela falhar, tenta
// uma vez mais na hora. Nunca rejeita.
function carregar(forcar) {
  if (modulo !== null) return Promise.resolve(modulo);
  if (carregando !== null) return forcar ? carregando.then((m) => (m !== null ? m : carregar(true))) : carregando;
  if (descartes >= MAX_RECARGAS) return Promise.resolve(null);
  if (!forcar && cargaFalhouEm !== null && Date.now() - cargaFalhouEm < NOVA_CARGA_MS) return Promise.resolve(null);
  // Os .then rodam depois desta atribuição, então `carregando` sempre volta a null.
  carregando = importarPainel().then(
    (m) => { modulo = m; cargaFalhouEm = null; return m; },
    () => { cargaFalhouEm = Date.now(); return null; },
  ).then((m) => { carregando = null; return m; });
  return carregando;
}

// Um painel que lançou sai de uso; a próxima carga segue NOVA_CARGA_MS.
function descartar(m) {
  if (modulo !== null && modulo === m) {
    modulo = null;
    cargaFalhouEm = Date.now();
    descartes++;
  }
}

// Só o que o item usa, com o texto limitado; o que não tiver forma de estado
// vira "sem leitura".
function estadoValido(e) {
  if (e === null || typeof e !== 'object' || typeof e.texto !== 'string') return SEM_LEITURA;
  const p = e.pcts;
  // Sem h5 (Ultra sem a janela de 5 h): o item mostra só semana e Fable.
  const ok = p !== null && typeof p === 'object' && (p.h5 === undefined || pctValido(p.h5)) && pctValido(p.d7) && pctValido(p.fable);
  const pcts = !ok ? null : p.h5 === undefined ? { d7: p.d7, fable: p.fable } : { h5: p.h5, d7: p.d7, fable: p.fable };
  return { texto: e.texto.slice(0, TEXTO_MAX), nivel: e.nivel, dica: typeof e.dica === 'string' ? e.dica : '', pcts };
}

// A saúde do PC (v0.5.5, Task 13) na forma que a janela desenha, ou null. O
// plugin já decide tudo; aqui só passa o que tem a forma combinada, com os
// textos cortados. Os nomes de app vão como texto (a página usa textContent).
const CHAVES_SAUDE = new Set(['ram', 'gpu', 'cpu', 'disco', 'bateria', 'paradas']);
const URGENCIAS = new Set(['calma', 'atencao', 'urgente']);
const texto = (s, max) => (typeof s === 'string' ? s.slice(0, max) : null);
const inteiroOuNull = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);

function medidaValida(x) {
  if (x === null || typeof x !== 'object' || !CHAVES_SAUDE.has(x.chave) || !URGENCIAS.has(x.urgencia)) return null;
  const rotulo = texto(x.rotulo, 40);
  const valor = texto(x.valor, 80);
  if (rotulo === null || valor === null) return null;
  const pct = typeof x.pct === 'number' && Number.isFinite(x.pct) && x.pct >= 0 && x.pct <= 100 ? x.pct : null;
  return { chave: x.chave, rotulo, pct, valor, urgencia: x.urgencia };
}

function saudeValida(s) {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return null;
  const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  return {
    idadeMs: inteiroOuNull(s.idadeMs),
    leve: s.leve === true,
    ateMs: inteiroOuNull(s.ateMs),
    medidas: lista(s.medidas, 8).map(medidaValida).filter((x) => x !== null),
    sugestoes: lista(s.sugestoes, 5)
      .filter((a) => a !== null && typeof a === 'object' && typeof a.nome === 'string' && inteiroOuNull(a.rssBytes) !== null)
      .map((a) => ({ nome: a.nome.slice(0, 60), rssBytes: a.rssBytes })),
    acaoLeve: s.acaoLeve === 'ligar' || s.acaoLeve === 'desligar' ? s.acaoLeve : null,
    resumo: texto(s.resumo, 600) ?? '',
  };
}

// O segmento da saúde na barra: só a forma que montarBarra produz (até 24
// caracteres, sem "$(" de ícone nem marcação).
const BARRA_SAUDE = /^[A-Za-z0-9 :%°,]{1,24}$/;
const barraSaudeValida = (b) => (typeof b === 'string' && BARRA_SAUDE.test(b) ? b : null);

// "5h ▮▮▮▮▯▯▯▯ 55% · sem — · Fable …", com os glifos da fonte hadouken.
function textoComSegmentos(pcts) {
  const parte = (rotulo, p) => (p === null ? `${rotulo} —` : `${rotulo} ${segmentos(p).join('')} ${Math.floor(p)}%`);
  const partes = [parte('sem', pcts.d7), parte('Fable', pcts.fable)];
  return (pcts.h5 === undefined ? partes : [parte('5h', pcts.h5), ...partes]).join(' · ');
}

function activate(ctx) {
  try {
    const item = vscode.window.createStatusBarItem('claudeHadouken.uso', vscode.StatusBarAlignment.Right, 100);
    item.name = 'Claude Hadouken: uso';
    item.command = COMANDO;
    item.text = TEXTO_SEM_MODULO;
    item.show();
    ctx.subscriptions.push(item);
    let ativo = true;
    let ultimoMotivo;
    let leitura = null;
    let proximoPedidoEm = 0;
    // A logo vai no começo do próprio item (v0.5.7), na cor do texto da barra,
    // e gira os quadros sem parar, como um gif; parada no quadro 0 com
    // movimento reduzido, painel.animarLogo false ou a janela sem foco.
    let comLogo = false;
    let textoBase = TEXTO_SEM_MODULO;
    let quadro = 0;
    let reduzido = movimentoReduzido();
    let animarLigado = true;
    let versaoNova = null;
    let versaoInstalada = null;
    let saudeBarra = null;
    // Nome da conta desta janela, ou null quando só existe a Principal.
    let contaRotulo = null;
    // A janela (§4): uma só; o token de desfazer fica aqui, nunca na página.
    let janela = null;
    let tokenDesfazer = null;
    let terminal = null;
    let tiquesDeConsulta = 0;

    const pintar = () => {
      try { item.text = comLogo ? `${QUADROS[quadro]} ${textoBase}` : textoBase; } catch { /* item já descartado */ }
    };
    const animacao = setInterval(() => {
      if (!ativo || !comLogo) return;
      const parado = !animarLigado || reduzido || vscode.window.state?.focused === false;
      const proximo = parado ? 0 : (quadro + 1) % QUADROS.length;
      if (proximo === quadro) return;
      quadro = proximo;
      pintar();
    }, QUADRO_MS);

    // Versão e configuração do shim novo. Nunca rejeita.
    const lerExtras = async (m) => {
      const api = apiDe(m);
      const [ver, cfg, barra] = await Promise.all([
        api.versao ? chamar(m, 'estadoVersao') : null,
        api.janela ? chamar(m, 'lerConfiguracao') : null,
        chamar(m, 'barraSaude'),
      ]);
      if (!ativo) return;
      saudeBarra = barraSaudeValida(barra);
      versaoNova = ver !== null && typeof ver === 'object' && typeof ver.nova === 'string' && VERSAO.test(ver.nova) ? ver.nova : null;
      versaoInstalada = ver !== null && typeof ver === 'object' && typeof ver.instalada === 'string' && VERSAO.test(ver.instalada) ? ver.instalada : null;
      const itens = cfg !== null && typeof cfg === 'object' && Array.isArray(cfg.itens) ? cfg.itens : [];
      animarLigado = itens.find((i) => i !== null && typeof i === 'object' && i.id === 'painel.animarLogo')?.valor !== false;
      reduzido = movimentoReduzido();
    };

    // Desenha com o painel `m` (null: sem módulo). Nunca lança.
    const redesenhar = (m) => {
      if (!ativo) return;
      try {
        if (m === null) {
          comLogo = false;
          textoBase = TEXTO_SEM_MODULO;
          pintar();
          item.command = COMANDO;
          item.backgroundColor = undefined;
          item.tooltip = undefined;
          return;
        }
        const api = apiDe(m);
        const e = estadoValido(m.estadoPainel(ultimoMotivo === undefined ? {} : { ultimoMotivo }));
        item.command = api.janela ? COMANDO_JANELA : COMANDO;
        if (api.evento) {
          const seta = versaoNova === null ? '' : ` $(hadouken-seta) ${versaoNova}`;
          comLogo = true;
          textoBase = `${e.pcts === null ? e.texto : textoComSegmentos(e.pcts)}${saudeBarra === null ? '' : ` · ${saudeBarra}`}${seta}`;
        } else {
          comLogo = false;
          textoBase = `$(pulse) ${e.texto}`;
        }
        pintar();
        const cor = typeof e.nivel === 'string' ? COR[e.nivel] : undefined;
        item.backgroundColor = cor === undefined ? undefined : new vscode.ThemeColor(cor);
        if (contaRotulo === null) {
          item.tooltip = e.dica === '' ? undefined : new vscode.MarkdownString(e.dica);
        } else {
          const md = new vscode.MarkdownString(`**Conta:** ${contaRotulo} · [trocar](command:${COMANDO_CONTA})${e.dica === '' ? '' : `\n\n${e.dica}`}`);
          md.isTrusted = { enabledCommands: [COMANDO_CONTA] };
          item.tooltip = md;
        }
      } catch {
        descartar(m);
        comLogo = false;
        textoBase = TEXTO_SEM_MODULO;
        pintar();
      }
    };

    const postar = (msg) => {
      try {
        if (janela !== null) Promise.resolve(janela.webview.postMessage(msg)).catch(() => {});
      } catch {
        // painel já descartado
      }
    };

    // O estado inteiro para a janela. Nunca rejeita.
    const enviarEstado = async (m) => {
      if (janela === null || m === null) return;
      try {
        const [config, roteamento, saude] = await Promise.all([
          chamar(m, 'lerConfiguracao'), chamar(m, 'resumoRoteamento7d'), chamar(m, 'estadoSaude'),
        ]);
        const e = estadoValido(m.estadoPainel(ultimoMotivo === undefined ? {} : { ultimoMotivo }));
        postar({
          tipo: 'estado',
          painel: { pcts: e.pcts, texto: e.texto, nivel: e.nivel, dica: e.dica },
          config,
          versaoNova,
          versaoInstalada,
          roteamento,
          saude: saudeValida(saude),
          conta: contaRotulo ?? 'Principal',
          movimentoReduzido: movimentoReduzido(),
        });
      } catch {
        // a janela fica com o estado anterior
      }
    };

    const recusar = (motivo, extra) => postar({ tipo: 'recusado', motivo, ...extra });

    // Salvar e voltar ao padrão: as chaves só podem ser as da tabela do
    // plugin (os ids que o lerConfiguracao devolve); config mudada em outro
    // lugar volta com a config nova (foco 2).
    const gravar = async (m, nome, argumento, versao) => {
      const cfg = await chamar(m, 'lerConfiguracao');
      const ids = new Set(cfg !== null && typeof cfg === 'object' && Array.isArray(cfg.itens) ? cfg.itens.map((i) => i?.id) : []);
      const chaves = Array.isArray(argumento) ? argumento : Object.keys(argumento);
      if (!chaves.every((k) => ids.has(k))) {
        recusar('invalido', { erros: [{ id: null, texto: 'item desconhecido' }] });
        return;
      }
      const r = await Promise.resolve().then(() => m[nome](argumento, { versao })).catch(() => null);
      if (r !== null && typeof r === 'object' && r.ok === true) {
        tokenDesfazer = r.desfazer !== undefined ? { token: r.desfazer, ate: Date.now() + DESFAZER_MS } : null;
        postar({ tipo: 'salvo', desfazerAte: Date.now() + DESFAZER_MS });
        await enviarEstado(m);
        return;
      }
      const motivo = r !== null && typeof r === 'object' && typeof r.motivo === 'string' ? r.motivo : 'erro';
      if (motivo === 'mudou') recusar('mudou', { config: await chamar(m, 'lerConfiguracao') });
      else if (motivo === 'invalido') recusar('invalido', { erros: errosLimpos(r.erros) });
      else recusar('erro');
    };

    // Um terminal "hadouken" só, para a janela e para a notificação: vivo,
    // só mostra; senão, cria e manda o comando fixo do plugin.
    const abrirTerminalAtualizar = async (m) => {
      if (terminal !== null && terminal.exitStatus === undefined) {
        terminal.show();
        return;
      }
      const c = await Promise.resolve().then(() => m.comandoAtualizar(process.platform)).catch(() => null);
      if (c === null || typeof c !== 'object' || typeof c.texto !== 'string') return;
      terminal = vscode.window.createTerminal(process.platform === 'win32' ? { name: 'hadouken', shellPath: 'powershell.exe' } : { name: 'hadouken' });
      terminal.sendText(c.texto);
      terminal.show();
    };

    const tratarMensagem = async (bruta) => {
      try {
        const msg = mensagemValida(bruta);
        if (msg === null) return;
        const m = await carregar(false);
        if (m === null || !apiDe(m).janela) return;
        switch (msg.tipo) {
          case 'pronto': break;
          case 'salvar': await gravar(m, 'gravarConfiguracao', msg.mudancas, msg.versao); return;
          case 'voltarPadrao': await gravar(m, 'voltarAoPadrao', msg.ids, msg.versao); return;
          case 'desfazer': {
            const t = tokenDesfazer;
            tokenDesfazer = null;
            if (t === null || Date.now() > t.ate) {
              recusar('mudou', { config: await chamar(m, 'lerConfiguracao') });
              return;
            }
            const r = await Promise.resolve().then(() => m.desfazer(t.token)).catch(() => null);
            if (r === null || typeof r !== 'object' || r.ok !== true) recusar(r?.motivo === 'mudou' ? 'mudou' : 'erro', { config: await chamar(m, 'lerConfiguracao') });
            break;
          }
          case 'atualizarUso': await vscode.commands.executeCommand(COMANDO); break;
          case 'conta': await vscode.commands.executeCommand(COMANDO_CONTA); return;
          case 'atualizarHadouken': await abrirTerminalAtualizar(m); return;
          case 'ligarAprendizado': await chamar(m, 'ligarAprendizado'); break;
          case 'desligarAprendizado': await chamar(m, 'desligarAprendizado'); break;
          case 'ligarLeve':
          case 'desligarLeve':
            if (typeof m.mudarModo === 'function') await Promise.resolve().then(() => m.mudarModo(msg.tipo === 'ligarLeve')).catch(() => null);
            break;
          default: return;
        }
        await enviarEstado(m);
      } catch {
        // mensagem nenhuma derruba a extensão
      }
    };

    const montarHtml = (painel) => {
      const base = ctx.extensionUri;
      const uri = (...partes) => String(painel.webview.asWebviewUri(vscode.Uri.joinPath(base, ...partes)));
      const nonce = crypto.randomBytes(18).toString('base64');
      const fonte = painel.webview.cspSource;
      const csp = `default-src 'none'; img-src ${fonte} data:; style-src ${fonte}; script-src 'nonce-${nonce}'; font-src ${fonte}`;
      const modelo = fs.readFileSync(path.join(base.fsPath, 'janela', 'index.html'), 'utf8');
      const trocas = { csp, nonce, css: uri('janela', 'janela.css'), js: uri('janela', 'janela.js'), bola: uri('janela', 'bola.svg') };
      return modelo.replace(/\{\{(csp|nonce|css|js|bola)\}\}/g, (_, k) => trocas[k]);
    };

    const abrirJanela = async () => {
      try {
        if (janela !== null) {
          janela.reveal(vscode.ViewColumn.Beside);
          return;
        }
        const painel = vscode.window.createWebviewPanel('claudeHadouken.janela', 'hadouken', vscode.ViewColumn.Beside, {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'janela'), vscode.Uri.joinPath(ctx.extensionUri, 'icones')],
        });
        janela = painel;
        painel.onDidDispose(() => { if (janela === painel) janela = null; });
        painel.webview.onDidReceiveMessage((msg) => tratarMensagem(msg));
        painel.webview.html = montarHtml(painel);
      } catch {
        // sem janela; a barra continua
      }
    };

    // Uma leitura por vez nesta janela: quem pede durante uma leitura recebe a
    // mesma promessa. Guarda o motivo e redesenha no fim. Nunca rejeita.
    const ler = (m, opcoes) => {
      if (leitura !== null) return leitura;
      leitura = Promise.resolve()
        .then(() => m.talvezAtualizar(opcoes))
        .then(
          (r) => { ultimoMotivo = r !== null && typeof r === 'object' && typeof r.motivo === 'string' ? r.motivo : undefined; },
          () => { descartar(m); },
        )
        .then(() => {
          leitura = null;
          redesenhar(modulo);
        })
        .catch(() => { leitura = null; });
      return leitura;
    };

    // Spec §5 (Task 11): a versão nova avisa uma vez por versão, em todas as
    // janelas (globalState); "Depois" só grava, e a marca no item continua.
    const avisarVersao = (m) => {
      try {
        const v = versaoNova;
        if (v === null || !ctx.globalState || ctx.globalState.get(CHAVE_AVISADA) === v) return;
        Promise.resolve(ctx.globalState.update(CHAVE_AVISADA, v)).catch(() => {});
        Promise.resolve(vscode.window.showInformationMessage(`hadouken ${v} disponível`, 'Atualizar', 'Depois'))
          .then((r) => (r === 'Atualizar' && ativo ? abrirTerminalAtualizar(m) : undefined))
          .catch(() => {});
      } catch {
        // sem aviso; a marca no item fica
      }
    };

    // A consulta em si decide as 6 h (talvezConsultarVersao); aqui só não
    // chama a cada 5 s.
    // Conta tiques (120 de 5 s = 10 min), não o relógio de parede.
    const talvezConsultar = (m) => {
      if (typeof m.talvezConsultarVersao !== 'function') return;
      const vez = tiquesDeConsulta;
      tiquesDeConsulta = (tiquesDeConsulta + 1) % CONSULTA_VERSAO_TIQUES;
      if (vez !== 0) return;
      Promise.resolve().then(() => m.talvezConsultarVersao({})).catch(() => {});
    };

    const tique = () => {
      trocarSeShimMudou();
      carregar(false)
        .then(async (m) => {
          if (m !== null) {
            talvezConsultar(m);
            await lerExtras(m);
            avisarVersao(m);
          }
          redesenhar(m);
          if (m !== null && janela !== null && janela.visible !== false && apiDe(m).janela) enviarEstado(m);
          if (m !== null && leitura === null && ativo && Date.now() >= proximoPedidoEm) {
            proximoPedidoEm = Date.now() + PEDIDO_MIN_MS;
            ler(m, {});
          }
        })
        .catch(() => {});
    };

    if (relogio !== null) clearInterval(relogio);
    const esteRelogio = setInterval(tique, RELOGIO_MS);
    relogio = esteRelogio;
    ctx.subscriptions.push({
      dispose() {
        ativo = false;
        clearInterval(esteRelogio);
        clearInterval(animacao);
        try { janela?.dispose(); } catch { /* já fechada */ }
        janela = null;
        if (relogio === esteRelogio) relogio = null;
      },
    });
    ctx.subscriptions.push(vscode.commands.registerCommand(COMANDO, async () => {
      try {
        const m = await carregar(true);
        if (m === null) {
          redesenhar(null);
          return;
        }
        if (leitura !== null) await leitura;
        await ler(m, { forcar: true });
      } catch {
        // o comando nunca lança
      }
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand(COMANDO_JANELA, abrirJanela));

    // Conta desta janela (v0.5.9). O processo da extensão é um por janela:
    // pôr o CLAUDE_CONFIG_DIR nele leva o painel para os dados da conta.
    // O CLAUDE_CONFIG_DIR que a janela herdou: a Principal volta a ele.
    const envOriginal = process.env.CLAUDE_CONFIG_DIR;
    const raizContas = () => {
      const home = os.homedir();
      return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, PASTA_CONTAS) : null;
    };
    const atualizarRotulo = () => {
      const raiz = raizContas();
      const contas = raiz === null ? [] : listarContas(raiz);
      if (contas.length === 0) {
        contaRotulo = null;
        return;
      }
      const c = process.env.CLAUDE_CONFIG_DIR;
      const p = completo(c) ? path.resolve(c) : null;
      const igual = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
      contaRotulo = p !== null && igual(path.dirname(p), raiz) && contas.includes(path.basename(p)) ? rotuloConta(path.basename(p)) : 'Principal';
    };
    const aplicarConta = (pasta) => {
      const alvo = pasta ?? envOriginal;
      if (alvo === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = alvo;
      atualizarRotulo();
      carregar(false).then((m) => redesenhar(m), () => null);
    };
    const gravarConta = async (pasta) => {
      const cc = vscode.workspace.getConfiguration('claudeCode');
      const v = valoresDe(cc, 'environmentVariables');
      // Parte do valor que vale hoje (o global, sem um do workspace) e só
      // põe ou tira o CLAUDE_CONFIG_DIR; sem sobra própria, volta ao global.
      let vars = varsComConta(v.ws ?? v.global, pasta);
      if (pasta === null && (vars.length === 0 || JSON.stringify(vars) === JSON.stringify(varsComConta(v.global, null)))) vars = undefined;
      await cc.update('environmentVariables', vars, vscode.ConfigurationTarget.Workspace);
      const ti = vscode.workspace.getConfiguration('terminal.integrated');
      const chave = `env.${soDoTerminal()}`;
      let env = envComConta(valoresDe(ti, chave).ws, pasta);
      if (pasta === null && Object.keys(env).length === 0) env = undefined;
      await ti.update(chave, env, vscode.ConfigurationTarget.Workspace);
      aplicarConta(pasta);
    };
    const escolherConta = async () => {
      try {
        const pastas = vscode.workspace.workspaceFolders;
        const raiz = raizContas();
        if (!Array.isArray(pastas) || pastas.length === 0 || raiz === null) {
          void vscode.window.showInformationMessage('Abra uma pasta nesta janela para escolher a conta do Claude dela.');
          return;
        }
        const contas = listarContas(raiz);
        const atual = contaRotulo ?? 'Principal';
        const itens = [
          { label: 'Principal', pasta: null },
          ...contas.map((n) => ({ label: rotuloConta(n), pasta: path.join(raiz, n) })),
          { label: '$(add) Nova conta…', nova: true },
        ].map((i) => (i.label === atual ? { ...i, description: 'esta janela' } : i));
        const e = await vscode.window.showQuickPick(itens, { placeHolder: 'Conta do Claude nesta janela' });
        if (e === undefined || e === null) return;
        let pasta = e.pasta ?? null;
        let nome = null;
        if (e.nova === true) {
          const digitado = await vscode.window.showInputBox({
            prompt: 'Nome da conta (ex.: Trabalho)',
            validateInput: (t) => {
              const n = nomeDeConta(t);
              if (n === null) return 'Use letras, números e espaços, até 32 (e não "Principal").';
              return contas.includes(n) ? 'Já existe uma conta com esse nome.' : null;
            },
          });
          nome = nomeDeConta(digitado);
          if (nome === null || contas.includes(nome)) return;
          pasta = path.join(raiz, nome);
        }
        if (await versionadoNoGit(pastas[0].uri.fsPath)) {
          const r = await vscode.window.showWarningMessage('O .vscode/settings.json deste projeto está no git, e a pasta da conta fica gravada nele. Se não quiser compartilhar, ponha-o no .gitignore.', { modal: true }, 'Continuar');
          if (r !== 'Continuar') return;
        }
        if (nome !== null) fs.mkdirSync(pasta, { recursive: true });
        await gravarConta(pasta);
        if (nome === null) {
          void vscode.window.showInformationMessage(`Conta desta janela: ${e.label}. Sessões novas do Claude Code usam ela; feche e reabra as que estão abertas.`);
          return;
        }
        const m = await carregar(false);
        const raizPlugin = m !== null && typeof m.raizDoPlugin === 'function' ? await Promise.resolve().then(() => m.raizDoPlugin()).catch(() => null) : null;
        const c = comandoNovaConta(raizPlugin, process.platform) ?? { shellPath: process.platform === 'win32' ? 'powershell.exe' : undefined, texto: 'claude' };
        const t = vscode.window.createTerminal({ name: `hadouken: ${rotuloConta(nome)}`, ...(c.shellPath === undefined ? {} : { shellPath: c.shellPath }), env: { CLAUDE_CONFIG_DIR: pasta } });
        t.sendText(c.texto);
        t.show();
        void vscode.window.showInformationMessage(`Conta ${rotuloConta(nome)} criada. No terminal que abriu, o hadouken se instala nela e o claude abre: digite /login e entre com a conta ${rotuloConta(nome)}. Uma vez só.`);
      } catch {
        // a troca de conta nunca derruba a extensão
      }
    };
    ctx.subscriptions.push(vscode.commands.registerCommand(COMANDO_CONTA, escolherConta));
    try {
      const inicial = pastaDaJanela(vscode.workspace.getConfiguration('claudeCode').get('environmentVariables'));
      if (inicial !== null) process.env.CLAUDE_CONFIG_DIR = inicial;
      atualizarRotulo();
      if (typeof vscode.workspace.onDidChangeConfiguration === 'function') {
        ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((ev) => {
          if (!ev.affectsConfiguration('claudeCode.environmentVariables')) return;
          const p = pastaDaJanela(vscode.workspace.getConfiguration('claudeCode').get('environmentVariables'));
          if ((p ?? envOriginal) !== process.env.CLAUDE_CONFIG_DIR) aplicarConta(p);
        }));
      }
    } catch {
      // sem conta: a Principal
    }
    tique();
  } catch {
    // a extensão nunca lança
  }
}

function deactivate() {
  try {
    if (relogio !== null) clearInterval(relogio);
    relogio = null;
  } catch {
    // nada a limpar
  }
}

module.exports = { activate, deactivate, _teste: { quadros, segmentos, dirDados, nomeDeConta, varsComConta, envComConta, pastaDaJanela, comandoNovaConta } };
