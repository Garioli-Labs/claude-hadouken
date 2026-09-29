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
// Nenhum callback lança: tudo fica em try/catch, e nenhuma promessa fica sem
// tratamento. CommonJS, porque o VS Code carrega a extensão com require; o
// ESM do plugin entra por import() dinâmico.

const vscode = require('vscode');
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
  return { texto: e.texto.slice(0, TEXTO_MAX), nivel: e.nivel, dica: typeof e.dica === 'string' ? e.dica : '' };
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

    // Desenha com o painel `m` (null: sem módulo). Nunca lança.
    const redesenhar = (m) => {
      if (!ativo) return;
      try {
        if (m === null) {
          item.text = TEXTO_SEM_MODULO;
          item.backgroundColor = undefined;
          item.tooltip = undefined;
          return;
        }
        const e = estadoValido(m.estadoPainel(ultimoMotivo === undefined ? {} : { ultimoMotivo }));
        item.text = `$(pulse) ${e.texto}`;
        const cor = typeof e.nivel === 'string' ? COR[e.nivel] : undefined;
        item.backgroundColor = cor === undefined ? undefined : new vscode.ThemeColor(cor);
        item.tooltip = e.dica === '' ? undefined : new vscode.MarkdownString(e.dica);
      } catch {
        descartar(m);
        try { item.text = TEXTO_SEM_MODULO; } catch { /* item já descartado */ }
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

    const tique = () => {
      carregar(false)
        .then((m) => {
          redesenhar(m);
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

module.exports = { activate, deactivate };
