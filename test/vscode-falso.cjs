'use strict';

// Um `vscode` falso com o que a extensão e a janela usam (spec v0.5.3 VS Code,
// Task 9). Cada item de barra guarda em `historico` todo texto que recebeu,
// para o teste ver os quadros da animação. `estado` expõe o que foi criado e
// chamado; `respostas` é a fila de showInformationMessage; `reduceMotion` e
// `executados` ficam em `estado`.
function criar() {
  const estado = {
    itens: [],
    paineis: [],
    criacoesDePainel: 0,
    mensagens: [],
    respostas: [],
    avisos: [], respostasAviso: [], quickPicks: [], escolhas: [], inputBoxes: [], digitados: [],
    config: {}, configGlobal: {}, atualizacoes: [], ouvintesConfig: [], pastas: undefined,
    terminais: [],
    comandos: new Map(),
    executados: [],
    reduceMotion: 'off',
  };

  function novoItem(id, alinhamento, prioridade) {
    let texto = '';
    const item = {
      id, alinhamento, prioridade, visivel: false, descartado: false, historico: [],
      color: undefined, backgroundColor: undefined, tooltip: undefined, command: undefined, name: undefined,
      get text() { return texto; },
      set text(v) { texto = v; item.historico.push(v); },
      show() { item.visivel = true; },
      hide() { item.visivel = false; },
      dispose() { item.descartado = true; },
    };
    return item;
  }

  function novoPainel(tipo, titulo, coluna, opcoes) {
    const ouvintesMsg = [];
    const ouvintesFim = [];
    const painel = {
      tipo, titulo, coluna, opcoes, revelado: 0, descartado: false, enviadas: [],
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (u) => u,
        postMessage(m) { painel.enviadas.push(m); return Promise.resolve(true); },
        onDidReceiveMessage(fn) { ouvintesMsg.push(fn); return { dispose() {} }; },
      },
      reveal() { painel.revelado++; },
      onDidDispose(fn) { ouvintesFim.push(fn); return { dispose() {} }; },
      dispose() {
        if (painel.descartado) return;
        painel.descartado = true;
        for (const fn of ouvintesFim) fn();
      },
      // Só do teste: entrega uma mensagem como se viesse do webview.
      receber(m) { return Promise.all(ouvintesMsg.map((fn) => fn(m))); },
    };
    return painel;
  }

  const api = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor(valor) { this.value = valor; } },
    Uri: {
      file: (p) => ({ fsPath: p, path: p, toString: () => p }),
      joinPath: (base, ...partes) => {
        const p = [base.fsPath ?? base.path ?? String(base), ...partes].join('/');
        return { fsPath: p, path: p, toString: () => p };
      },
    },
    window: {
      createStatusBarItem(id, alinhamento, prioridade) {
        const item = novoItem(id, alinhamento, prioridade);
        estado.itens.push(item);
        return item;
      },
      createWebviewPanel(tipo, titulo, coluna, opcoes) {
        estado.criacoesDePainel++;
        const painel = novoPainel(tipo, titulo, coluna, opcoes);
        estado.paineis.push(painel);
        return painel;
      },
      showInformationMessage(...args) {
        estado.mensagens.push(args);
        return Promise.resolve(estado.respostas.shift());
      },
      showWarningMessage(...args) {
        estado.avisos.push(args);
        return Promise.resolve(estado.respostasAviso.shift());
      },
      showQuickPick(itens, opcoes) {
        estado.quickPicks.push({ itens, opcoes });
        const f = estado.escolhas.shift();
        return Promise.resolve(typeof f === 'function' ? f(itens) : undefined);
      },
      showInputBox(opcoes) {
        estado.inputBoxes.push(opcoes);
        return Promise.resolve(estado.digitados.shift());
      },
      createTerminal(opcoes) {
        const t = { opcoes, enviados: [], mostrado: false, sendText(s) { t.enviados.push(s); }, show() { t.mostrado = true; } };
        estado.terminais.push(t);
        return t;
      },
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      get workspaceFolders() { return estado.pastas; },
      getConfiguration(secao) {
        return {
          get: (chave) => (secao === 'workbench' && chave === 'reduceMotion' ? estado.reduceMotion : (estado.config[`${secao}.${chave}`] ?? estado.configGlobal[`${secao}.${chave}`])),
          inspect: (chave) => ({ globalValue: estado.configGlobal[`${secao}.${chave}`], workspaceValue: estado.config[`${secao}.${chave}`] }),
          update: (chave, valor, alvo) => {
            estado.atualizacoes.push({ chave: `${secao}.${chave}`, valor, alvo });
            estado.config[`${secao}.${chave}`] = valor;
            for (const f of estado.ouvintesConfig) f({ affectsConfiguration: (s) => `${secao}.${chave}`.startsWith(s) });
            return Promise.resolve();
          },
        };
      },
      onDidChangeConfiguration(f) {
        estado.ouvintesConfig.push(f);
        return { dispose() { estado.ouvintesConfig = estado.ouvintesConfig.filter((x) => x !== f); } };
      },
    },
    commands: {
      registerCommand(nome, fn) {
        estado.comandos.set(nome, fn);
        return { dispose() { estado.comandos.delete(nome); } };
      },
      executeCommand(nome, ...args) {
        estado.executados.push([nome, ...args]);
        const fn = estado.comandos.get(nome);
        return Promise.resolve(fn === undefined ? undefined : fn(...args));
      },
    },
  };
  return { api, estado };
}

module.exports = { criar };
