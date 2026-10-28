import os from 'node:os';
import path from 'node:path';
import { gravarJsonAtomico } from '../estado.js';
import { arquivoSettings, lerSettings, planejarStatusline } from '../configuracao.js';
import { mapaDePlugins, resumirCusto } from '../custo-hooks.js';
import { lerHooksDoPlugin, lerInstalados, lerItensDoIndice } from '../indice-hooks.js';
import { dirConfigClaude } from '../guarda/despacho.js';
import { acharConflitos } from './compat.js';
import { ARQ_CONFLITOS, lerArquivoConflitos, lerConflitos } from './aviso-compat.js';

// Conflitos com outros plugins (spec v0.5.5 §6.H), do lado da E/S. O coletor
// desanexado chama atualizarConflitos: no máximo uma vez a cada 24 h lê o
// settings.json, os plugins habilitados e o índice de custo dos hooks que já
// existe (nunca indexa: o índice passa de 6 MB e o SessionStart tem 40 ms) e
// grava conflitos.json. O SessionStart só lê, com lerConflitos.

const VALE_MS = 24 * 3600_000;
const USO_MS = 7 * 86_400_000;

export { ARQ_CONFLITOS, lerConflitos };

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function settingsReais() {
  const a = arquivoSettings();
  if (!a.ok) return null;
  const l = lerSettings(a.arquivo);
  return l.ok && l.existe ? l.settings : l.ok ? {} : null;
}

// Os plugins habilitados (enabledPlugins[chave] !== false no settings do
// usuário), com o hooks.json da primeira instalação de cada um.
function hooksDosHabilitados(instalados, settings) {
  const r = [];
  const plugins = ehObjeto(instalados) && ehObjeto(instalados.plugins) ? instalados.plugins : {};
  const ligados = ehObjeto(settings) && ehObjeto(settings.enabledPlugins) ? settings.enabledPlugins : {};
  for (const chave of Object.keys(plugins).slice(0, 200)) {
    if (ligados[chave] === false || !Array.isArray(plugins[chave])) continue;
    const inst = plugins[chave].find((i) => ehObjeto(i) && typeof i.installPath === 'string');
    if (inst === undefined) continue;
    r.push({ plugin: chave.split('@')[0], hooks: lerHooksDoPlugin(inst.installPath) });
  }
  return r;
}

const situacaoBarra = (settings) => {
  const p = planejarStatusline(settings);
  if (!p.ok) return 'nenhuma';
  return p.acao === 'conflito' ? 'outra' : p.acao === 'instalar' ? 'nenhuma' : 'nossa';
};

// deps: dir, agoraMs, dirConfig (a pasta do Claude Code), lerSettingsFn
// (devolve o objeto do settings.json, {} sem arquivo, null ilegível). Com
// conflitos.json de menos de 24 h, não lê nada. Devolve { lido, itens }.
// Nunca lança.
export function atualizarConflitos({
  dir, agoraMs = Date.now(), dirConfig = dirConfigClaude(process.env, os.homedir()), lerSettingsFn = settingsReais,
}) {
  try {
    const atual = lerArquivoConflitos(dir);
    if (atual !== null && atual.em <= agoraMs && agoraMs - atual.em < VALE_MS) return { lido: false, itens: atual.itens };
    const settings = lerSettingsFn();
    const instalados = lerInstalados(dirConfig);
    const itensIdx = typeof dirConfig === 'string' ? lerItensDoIndice(path.join(dirConfig, 'projects'), agoraMs - USO_MS, dir) : null;
    const custos = itensIdx === null ? [] : resumirCusto(itensIdx, mapaDePlugins(instalados, lerHooksDoPlugin), agoraMs - USO_MS).plugins;
    const itens = acharConflitos({
      statusLine: settings === null ? 'nenhuma' : situacaoBarra(settings),
      pluginsHooks: hooksDosHabilitados(instalados, settings),
      custos,
    });
    gravarJsonAtomico(path.join(dir, ARQ_CONFLITOS), { v: 1, em: agoraMs, itens }, { compacto: true });
    return { lido: true, itens };
  } catch {
    return { lido: false, itens: [] };
  }
}
