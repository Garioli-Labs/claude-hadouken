import path from 'node:path';
import { caminhoDoAmbiente } from '../base.js';
import { lerJson } from '../estado.js';
import { MOTIVOS_PAINEL } from '../hooks/linha-estado.js';

// v0.5.2: o motivo da última instalação do item do VS Code que falhou
// (tentativa.json, gravado por instalarPainel), quando a versão do plugin em
// uso ainda não está em instalado.json. Leve de propósito: o SessionStart o
// carrega em toda sessão, e o instalador (vsix, zlib) fica de fora. Só motivo
// da lista fixa; qualquer outra coisa é null. Nunca lança.

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function falhaPendente(opcoes) {
  try {
    const { dir, raizPlugin } = ehObjeto(opcoes) ? opcoes : {};
    const raiz = caminhoDoAmbiente(raizPlugin);
    if (raiz === null || typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
    const plugin = lerJson(path.join(raiz, '.claude-plugin', 'plugin.json'), 64 * 1024);
    const versao = plugin.ok && ehObjeto(plugin.valor) && typeof plugin.valor.version === 'string' ? plugin.valor.version : null;
    if (versao === null) return null;
    const instalado = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
    if (instalado.ok && ehObjeto(instalado.valor) && instalado.valor.versao === versao) return null;
    const tentativa = lerJson(path.join(dir, 'painel', 'tentativa.json'), 4096);
    const motivo = tentativa.ok && ehObjeto(tentativa.valor) ? tentativa.valor.motivo : undefined;
    return typeof motivo === 'string' && MOTIVOS_PAINEL.has(motivo) ? motivo : null;
  } catch {
    return null;
  }
}
