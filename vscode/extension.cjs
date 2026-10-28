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
// Spec v0.5.3 VS Code §3: com o shim novo (painel-api.js) vêm mais um item, a
// logo (prioridade 101), que anima quando o último evento muda e tem a cor da
// urgência, e o item de uso com segmentos de energia no lugar das
// porcentagens soltas e a seta da versão nova; o clique nos dois abre a
// janela. Um shim velho, só com estadoPainel e talvezAtualizar, segue como
// antes: um item, `$(pulse)`, o clique atualiza o uso (foco 1).
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

// Spec vscode §3: 5 quadros a ~120 ms quando o evento muda; uma por vez;
// nada com movimento reduzido ou painel.animarLogo false.
const QUADROS = Object.freeze(['$(hadouken-0)', '$(hadouken-1)', '$(hadouken-2)', '$(hadouken-3)', '$(hadouken-4)']);
const QUADRO_MS = 120;
const CORES = Object.freeze({ __proto__: null, calma: 'charts.blue', atencao: 'charts.yellow', urgente: 'charts.red' });
const URGENCIA_DO_NIVEL = Object.freeze({ __proto__: null, aviso: 'atencao', erro: 'urgente' });
const corDaUrgencia = (u) => CORES[u] ?? CORES.calma;
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
const TIPOS_MENSAGEM = new Set(['pronto', 'salvar', 'voltarPadrao', 'desfazer', 'atualizarUso', 'atualizarHadouken', 'ligarAprendizado', 'desligarAprendizado']);
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
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude', 'hadouken') : null;
  } catch {
    return null;
  }
}

// Estado do módulo, dividido entre as ativações do mesmo processo.
let modulo = null;
let cargaFalhouEm = null;
let descartes = 0;
let carregando = null;
let relogio = null;

// Importa <dirDados>/bin/painel.mjs com um ?t= novo (um import que falhou não
// fica guardado para a próxima tentativa) e confere os dois nomes combinados.
// Rejeita em qualquer falha.
async function importarPainel() {
  const dir = dirDados();
  if (dir === null) throw new Error('sem pasta de dados');
  const m = await import(`${pathToFileURL(path.join(dir, 'bin', 'painel.mjs')).href}?t=${Date.now()}`);
  if (typeof m.estadoPainel !== 'function' || typeof m.talvezAtualizar !== 'function') throw new Error('painel incompleto');
  return m;
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
  const pcts = p !== null && typeof p === 'object' && pctValido(p.h5) && pctValido(p.d7) && pctValido(p.fable) ? { h5: p.h5, d7: p.d7, fable: p.fable } : null;
  return { texto: e.texto.slice(0, TEXTO_MAX), nivel: e.nivel, dica: typeof e.dica === 'string' ? e.dica : '', pcts };
}

// "5h ▮▮▮▮▯▯▯▯ 55% · sem — · Fable …", com os glifos da fonte hadouken.
function textoComSegmentos(pcts) {
  const parte = (rotulo, p) => (p === null ? `${rotulo} —` : `${rotulo} ${segmentos(p).join('')} ${Math.floor(p)}%`);
  return [parte('5h', pcts.h5), parte('sem', pcts.d7), parte('Fable', pcts.fable)].join(' · ');
}

function activate(ctx) {
  try {
    const item = vscode.window.createStatusBarItem('claudeHadouken.uso', vscode.StatusBarAlignment.Right, 100);
    item.name = 'Claude Hadouken: uso';
    item.command = COMANDO;
    item.text = TEXTO_SEM_MODULO;
    item.show();
    ctx.subscriptions.push(item);
    const logo = vscode.window.createStatusBarItem('claudeHadouken.logo', vscode.StatusBarAlignment.Right, 101);
    logo.name = 'Claude Hadouken: logo';
    logo.command = COMANDO;
    logo.text = QUADROS[0];
    ctx.subscriptions.push(logo);
    let ativo = true;
    let ultimoMotivo;
    let leitura = null;
    let proximoPedidoEm = 0;
    // Logo e versão: o primeiro evento lido só fica guardado (abrir o VS Code
    // não anima); depois, cada `em` novo anima uma vez, nunca duas juntas.
    let primeiroEvento = true;
    let ultimoEm = null;
    let animando = false;
    let animacao = null;
    let animarLigado = true;
    let versaoNova = null;
    let versaoInstalada = null;
    // A janela (§4): uma só; o token de desfazer fica aqui, nunca na página.
    let janela = null;
    let tokenDesfazer = null;
    let terminal = null;
    let tiquesDeConsulta = 0;

    const animar = () => {
      animando = true;
      const seq = [1, 2, 3, 4, 0];
      const passo = (i) => {
        animacao = null;
        if (!ativo) return;
        try { logo.text = QUADROS[seq[i]]; } catch { /* item já descartado */ }
        if (i + 1 < seq.length) animacao = setTimeout(passo, QUADRO_MS, i + 1);
        else animando = false;
      };
      passo(0);
    };

    // Evento, versão e configuração do shim novo. Nunca rejeita.
    const lerExtras = async (m) => {
      const api = apiDe(m);
      const [ev, ver, cfg] = await Promise.all([
        api.evento ? chamar(m, 'ultimoEvento') : null,
        api.versao ? chamar(m, 'estadoVersao') : null,
        api.janela ? chamar(m, 'lerConfiguracao') : null,
      ]);
      if (!ativo) return;
      versaoNova = ver !== null && typeof ver === 'object' && typeof ver.nova === 'string' && VERSAO.test(ver.nova) ? ver.nova : null;
      versaoInstalada = ver !== null && typeof ver === 'object' && typeof ver.instalada === 'string' && VERSAO.test(ver.instalada) ? ver.instalada : null;
      const itens = cfg !== null && typeof cfg === 'object' && Array.isArray(cfg.itens) ? cfg.itens : [];
      animarLigado = itens.find((i) => i !== null && typeof i === 'object' && i.id === 'painel.animarLogo')?.valor !== false;
      const em = ev !== null && typeof ev === 'object' && Number.isSafeInteger(ev.em) ? ev.em : null;
      if (primeiroEvento) {
        primeiroEvento = false;
        ultimoEm = em;
        return;
      }
      if (em === null || em === ultimoEm) return;
      ultimoEm = em;
      if (!animando && animarLigado && !movimentoReduzido()) animar();
    };

    // Desenha com o painel `m` (null: sem módulo). Nunca lança.
    const redesenhar = (m) => {
      if (!ativo) return;
      try {
        if (m === null) {
          item.text = TEXTO_SEM_MODULO;
          item.command = COMANDO;
          item.backgroundColor = undefined;
          item.tooltip = undefined;
          logo.hide();
          return;
        }
        const api = apiDe(m);
        const e = estadoValido(m.estadoPainel(ultimoMotivo === undefined ? {} : { ultimoMotivo }));
        const comando = api.janela ? COMANDO_JANELA : COMANDO;
        item.command = comando;
        if (api.evento) {
          const seta = versaoNova === null ? '' : ` $(hadouken-seta) ${versaoNova}`;
          item.text = `${e.pcts === null ? e.texto : textoComSegmentos(e.pcts)}${seta}`;
          logo.command = comando;
          logo.color = new vscode.ThemeColor(corDaUrgencia(URGENCIA_DO_NIVEL[e.nivel]));
          logo.tooltip = e.dica === '' ? undefined : new vscode.MarkdownString(e.dica);
          logo.show();
        } else {
          item.text = `$(pulse) ${e.texto}`;
          logo.hide();
        }
        const cor = typeof e.nivel === 'string' ? COR[e.nivel] : undefined;
        item.backgroundColor = cor === undefined ? undefined : new vscode.ThemeColor(cor);
        item.tooltip = e.dica === '' ? undefined : new vscode.MarkdownString(e.dica);
      } catch {
        descartar(m);
        try { item.text = TEXTO_SEM_MODULO; logo.hide(); } catch { /* item já descartado */ }
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
        const [config, roteamento] = await Promise.all([chamar(m, 'lerConfiguracao'), chamar(m, 'resumoRoteamento7d')]);
        const e = estadoValido(m.estadoPainel(ultimoMotivo === undefined ? {} : { ultimoMotivo }));
        postar({
          tipo: 'estado',
          painel: { pcts: e.pcts, texto: e.texto, nivel: e.nivel, dica: e.dica },
          config,
          versaoNova,
          versaoInstalada,
          roteamento,
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
          case 'atualizarHadouken': await abrirTerminalAtualizar(m); return;
          case 'ligarAprendizado': await chamar(m, 'ligarAprendizado'); break;
          case 'desligarAprendizado': await chamar(m, 'desligarAprendizado'); break;
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
        if (animacao !== null) clearTimeout(animacao);
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

module.exports = { activate, deactivate, _teste: { quadros, corDaUrgencia, segmentos } };
