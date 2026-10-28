import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirDados } from '../base.js';

// O que o shim <dirDados>/bin/painel.mjs expõe à extensão do VS Code (spec
// v0.5.3 VS Code §2.2). estadoPainel, talvezAtualizar e o resto de
// uso/painel.js seguem como vêm (export *); os outros nomes já levam a pasta
// de dados e a raiz do plugin, que a extensão não sabe. Cada embrulho tem
// try e devolve null, ou { ok: false, motivo: 'erro' } onde o original
// devolve um resultado, em vez de lançar. Os módulos entram por import()
// dinâmico: um que falhe só cala o próprio nome.

export * from './painel.js';

// Dois níveis acima de src/uso/.
const RAIZ_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ERRO = Object.freeze({ ok: false, motivo: 'erro' });
const erro = () => ({ ...ERRO });

// O interruptor do aprendizado mostra o estado real (ligado.json), não a
// chave do config.json, que o ligar e o desligar não gravam.
export async function lerConfiguracao() {
  try {
    const dir = dirDados();
    const lido = (await import('../config/ler.js')).lerConfiguracao(dir);
    try {
      const ligado = dir !== null && (await import('../aprendizado/arquivos.js')).ligadoExiste(dir);
      for (const i of lido.itens) if (i.id === 'aprendizado.ligado') i.valor = ligado;
    } catch { /* fica o valor do config.json */ }
    return lido;
  } catch {
    return null;
  }
}

export async function validar(mudancas) {
  try {
    const ler = await import('../config/ler.js');
    return ler.validar(mudancas, ler.lerConfiguracao(dirDados()));
  } catch {
    return null;
  }
}

export async function gravarConfiguracao(mudancas, opcoes) {
  try {
    return (await import('../config/gravar.js')).gravarConfiguracao(dirDados(), mudancas, { versao: opcoes?.versao, agoraMs: Date.now() });
  } catch {
    return erro();
  }
}

export async function voltarAoPadrao(ids, opcoes) {
  try {
    return (await import('../config/gravar.js')).voltarAoPadrao(dirDados(), ids, { versao: opcoes?.versao, agoraMs: Date.now() });
  } catch {
    return erro();
  }
}

export async function desfazer(token) {
  try {
    return (await import('../config/gravar.js')).desfazer(dirDados(), token, { agoraMs: Date.now() });
  } catch {
    return erro();
  }
}

export async function talvezConsultarVersao(opcoes) {
  try {
    const { talvezConsultarVersao: consultar } = await import('../atualizacao/versao.js');
    return await consultar({ forcar: opcoes?.forcar === true, dir: dirDados(), raizPlugin: RAIZ_PLUGIN });
  } catch {
    return { motivo: 'falhou' };
  }
}

export async function estadoVersao() {
  try {
    return (await import('../atualizacao/versao.js')).estadoVersao({ dir: dirDados(), raizPlugin: RAIZ_PLUGIN });
  } catch {
    return null;
  }
}

export async function comandoAtualizar(plataforma = process.platform) {
  try {
    return (await import('../atualizacao/versao.js')).comandoAtualizar(plataforma);
  } catch {
    return null;
  }
}

export async function ultimoEvento() {
  try {
    return (await import('../eventos/eventos.js')).ultimoEvento(dirDados());
  } catch {
    return null;
  }
}

// Como passoAprendizado em instalar-tudo.js: a prévia e o ligar com o código
// dela, no settings.json do usuário.
export async function ligarAprendizado() {
  try {
    const [{ arquivoSettings }, apr] = await Promise.all([import('../configuracao.js'), import('../aprendizado/ligar.js')]);
    const dir = dirDados();
    const settings = arquivoSettings();
    if (dir === null || !settings.ok) return { ok: false, motivo: dir === null ? 'sem-pasta' : settings.motivo };
    const base = { dir, arquivo: settings.arquivo };
    const p = apr.previa(base);
    if (!p.ok) return p;
    return await apr.ligar({ ...base, codigo: p.codigo, agoraMs: Date.now() });
  } catch {
    return erro();
  }
}

export async function desligarAprendizado() {
  try {
    const [{ arquivoSettings }, apr] = await Promise.all([import('../configuracao.js'), import('../aprendizado/ligar.js')]);
    const dir = dirDados();
    const settings = arquivoSettings();
    if (dir === null || !settings.ok) return { ok: false, motivo: dir === null ? 'sem-pasta' : settings.motivo };
    return apr.desligar({ dir, arquivo: settings.arquivo, agoraMs: Date.now() });
  } catch {
    return erro();
  }
}

// O resumo de 7 dias do roteamento (spec roteamento §8), como o passo do
// aprendizado o monta; null se o módulo faltar ou falhar.
export async function resumoRoteamento7d() {
  try {
    const [{ lerDespachos }, { resumoRoteamento }] = await Promise.all([
      import('../roteamento/registro.js'), import('../roteamento/retrabalho.js'),
    ]);
    return resumoRoteamento({ despachos: lerDespachos(dirDados(), Date.now()), respostasSubagente: [] });
  } catch {
    return null;
  }
}
