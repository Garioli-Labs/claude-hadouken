import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planoEfetivo, textoPlano } from '../conta/plano.js';
import { lerJson } from '../estado.js';
import { configSaude } from '../config/ler.js';
import { lerEventos } from '../guarda/registros.js';
import { dirConfigClaude } from '../guarda/despacho.js';
import { mapaDePlugins, resumirCusto } from '../custo-hooks.js';
import { lerHooksDoPlugin, lerInstalados, lerItensDoIndice } from '../indice-hooks.js';
import { respostasSubagenteDoIndice } from '../transcripts.js';
import { lerSaude } from './ler.js';
import { lerModo } from './modo.js';
import { abrirTetos } from './tetos.js';
import { sugerirFechar } from './processos.js';
import { paradas } from './ociosas.js';
import { medidasNaFaixa } from './faixas.js';
import { medirDados } from './limpeza.js';
import { conferirCompat, descreverItem } from './compat.js';
import { lerArquivoConflitos, lerConflitos } from './aviso-compat.js';
import { resumoEconomia } from './economia.js';
import { ROTULO_PARTE } from './mensagens.js';

// O texto do /hadouken:saude (spec v0.5.5 §6.D), no formato do terminal do
// protótipo: rótulos de 6 colunas. Só lê arquivos (os índices que já
// existem; nunca indexa). Vai só ao usuário (decision: block), então pode
// trazer nomes de app e de plugin, já saneados por quem os gravou e
// conferidos de novo pelos leitores. Cada seção no seu try: a que falha vira
// "não deu para ler" e o resto sai.

const SEMANA_MS = 7 * 86_400_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const PLUGINS_HOOKS_MAX = 4;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const decimal = (n) => n.toFixed(1).replace('.', ',');
const idade = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
const tamanho = (b) => (b >= MB ? `${decimal(b / MB)} MB` : `${decimal(b / 1024)} KB`);

function secao(rotulo, fn) {
  let t;
  try { t = fn(); } catch { t = 'não deu para ler agora'; }
  return `${rotulo.padEnd(6)} ${t}`;
}

function versaoPlugin(raizPlugin) {
  if (raizPlugin === null) return null;
  const r = lerJson(path.join(raizPlugin, '.claude-plugin', 'plugin.json'), 64 * 1024);
  const v = r.ok && ehObjeto(r.valor) ? r.valor.version : null;
  return typeof v === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v) ? v : null;
}

const NOMES_FONTE = { cpuTemp: 'temperatura da CPU', gpu: 'GPU', bateria: 'bateria', disco: 'disco', cpuCarga: 'carga da CPU', processos: 'lista de processos' };

function linhasPc(l, config) {
  const partes = [`RAM ${l.ram.usadaPct ?? '?'}% de ${l.ram.totalBytes === null ? '?' : Math.round(l.ram.totalBytes / GB)} GB`];
  if (l.cpu.cargaPct !== null) partes.push(`CPU ${Math.round(l.cpu.cargaPct)}%`);
  if (l.cpu.tempC !== null) partes.push(`CPU ${Math.round(l.cpu.tempC)} °C`);
  if (l.gpu.tempC !== null) partes.push(`GPU ${Math.round(l.gpu.tempC)} °C`);
  const livres = [l.disco.dadosLivreBytes, l.disco.projetoLivreBytes].filter((b) => b !== null);
  if (livres.length > 0) partes.push(`disco ${Math.floor(Math.min(...livres) / GB)} GB livres`);
  if (l.bateria !== null && l.bateria.pct !== null) partes.push(`bateria ${Math.round(l.bateria.pct)}%${l.bateria.naTomada === false ? ' fora da tomada' : ''}`);
  const linhas = [`PC     ${partes.join(' · ')}`];
  const faltam = Object.keys(NOMES_FONTE).filter((k) => l.fontes[k] !== 'ok').map((k) => NOMES_FONTE[k]);
  if (faltam.length > 0) linhas.push(`       indisponível neste PC: ${faltam.join(', ')} (o hadouken não pede admin)`);
  const p = paradas(l.ociosas, l.em);
  if (p.n > 0) {
    linhas.push(`       ${p.n === 1 ? '1 sessão do Claude parada' : `${p.n} sessões do Claude paradas`} há mais de 30 min: ${decimal(p.rssBytes / GB)} GB (fechar libera memória; quem fecha é você)`);
  }
  if (medidasNaFaixa(l, config).ram?.nivel === 2) {
    const apps = sugerirFechar(l.processos, { pidSessao: process.ppid });
    if (apps.length > 0) linhas.push('', 'Fechar libera memória (só sugestão; quem fecha é você):', ...apps.map((a) => `  - ${a.nome}: ${decimal(a.rssBytes / GB)} GB`));
  }
  return linhas;
}

function hooks({ dir, agoraMs, dirConfig, config }) {
  const partes = [];
  const itens = typeof dirConfig === 'string' ? lerItensDoIndice(path.join(dirConfig, 'projects'), agoraMs - SEMANA_MS, dir) : null;
  if (itens !== null) {
    const resumo = resumirCusto(itens, mapaDePlugins(lerInstalados(dirConfig), lerHooksDoPlugin), agoraMs - SEMANA_MS);
    const com = resumo.plugins.filter((p) => p.p95 !== null).sort((a, b) => b.p95 - a.p95).slice(0, PLUGINS_HOOKS_MAX);
    if (com.length > 0) partes.push(com.map((p) => `${p.plugin} p95 ${p.p95} ms`).join('; '));
  }
  if (partes.length === 0) partes.push('sem medida nos últimos 7 dias');
  const desligadas = abrirTetos(dir, agoraMs, { config }).desligadas();
  if (desligadas.length > 0) partes.push(`desligada por 24 h: ${desligadas.map((d) => `${ROTULO_PARTE[d.nome]}, até ${hhmm(d.ateMs)}`).join('; ')}`);
  return partes.join(' · ');
}

function reparos(dir, agoraMs) {
  const r = lerEventos(dir, agoraMs)
    .filter((e) => e.tipo === 'reparo' && e.detalhe !== null && !e.detalhe.startsWith('teto:') && agoraMs - Date.parse(e.at) <= SEMANA_MS)
    .map((e) => e.detalhe);
  return r.length === 0 ? 'nenhum' : `${r.length} nos últimos 7 dias: ${r.slice(-5).join('; ')}`;
}

function compat({ dir, raizPlugin, versaoNode, versaoClaude, config }) {
  if (!config.compat) return 'conferência desligada (saude.compat)';
  const plugin = versaoPlugin(raizPlugin);
  const pkg = raizPlugin === null ? { ok: false } : lerJson(path.join(raizPlugin, 'package.json'), 64 * 1024);
  const minimos = pkg.ok && ehObjeto(pkg.valor) ? pkg.valor.compat : null;
  const inst = lerJson(path.join(dir, 'painel', 'instalado.json'), 4096);
  const extensao = inst.ok && ehObjeto(inst.valor) && typeof inst.valor.versao === 'string' ? inst.valor.versao : null;
  const itens = conferirCompat({ node: versaoNode, claudeCode: versaoClaude, extensao, plugin }, minimos);
  if (itens.length > 0) return itens.map(descreverItem).join('; ');
  const node = String(versaoNode).replace(/^v/, '');
  return `em dia (Node ${node}${plugin === null ? '' : `, plugin ${plugin}`}${extensao === null ? '' : `, extensão ${extensao}`})`;
}

// v0.5.6 (Task 6): o .vsix que a instalação do painel deixa na pasta de
// dados, para instalar em outro PC. Só com o arquivo regular presente; o
// relatório é decision: block, então o caminho vai só ao usuário. O nome é o
// de ID_EXTENSAO (painel/vsix.js), repetido para não carregar o zlib aqui.
function vsixDoPainel(dir, versao) {
  try {
    if (typeof dir !== 'string' || versao === null) return null;
    const vsix = path.join(dir, 'painel', `claude-hadouken-painel-${versao}.vsix`);
    return fs.lstatSync(vsix).isFile() ? vsix : null;
  } catch {
    return null;
  }
}

function conflitos(dir, agoraMs, config) {
  if (!config.conflitos) return 'conferência desligada (saude.conflitos)';
  if (lerArquivoConflitos(dir) === null) return 'ainda não conferido (o coletor confere uma vez por dia)';
  const itens = lerConflitos(dir, agoraMs);
  return itens.length === 0 ? 'nenhum' : itens.map(descreverItem).join('; ');
}

function dados(dir, config, { comMaiores = true } = {}) {
  const m = medirDados(dir);
  if (m.totalBytes === null) return 'não deu para medir';
  const teto = config.limpeza?.ligada ? ` de ${config.limpeza.mb} MB` : ' (limpeza desligada)';
  const maiores = !comMaiores || m.maiores.length === 0 ? '' : ` (maiores: ${m.maiores.map((a) => `${a.nome} ${tamanho(a.bytes)}`).join(', ')})`;
  return `${tamanho(m.totalBytes)}${teto}${maiores}`;
}

// Sem dirConfig (a janela), não lê o índice dos transcripts: só as contagens,
// sem a estimativa de tokens.
function semana({ dir, agoraMs, dirConfig, config }) {
  if (!config.economia) return 'resumo desligado (saude.economia)';
  const respostas = typeof dirConfig === 'string' ? respostasSubagenteDoIndice(path.join(dirConfig, 'projects'), agoraMs - SEMANA_MS, dir, agoraMs) : [];
  return resumoEconomia({ dir, agoraMs, respostasSubagente: respostas }).texto ?? 'nada a contar';
}

// A linha de baixo da seção "PC agora" na janela do VS Code (Task 13): hooks,
// reparos, compat, conflitos, dados (sem os maiores) e economia (sem tokens),
// sem ler índice nenhum (a janela pede a cada 5 s). Hooks aqui são só as
// partes desligadas pelo teto. Nunca lança.
export function resumoCurto({ dir, agoraMs = Date.now(), config, raizPlugin = null, versaoNode = process.version, versaoClaude }) {
  const ctx = { dir, agoraMs, raizPlugin, versaoNode, versaoClaude, config };
  const parte = (rotulo, fn) => {
    try { return `${rotulo}: ${fn()}`; } catch { return `${rotulo}: não deu para ler agora`; }
  };
  return [
    parte('Hooks', () => {
      const d = abrirTetos(dir, agoraMs, { config }).desligadas();
      return d.length === 0 ? 'no tempo' : `desligada por 24 h: ${d.map((x) => `${ROTULO_PARTE[x.nome]}, até ${hhmm(x.ateMs)}`).join('; ')}`;
    }),
    parte('Reparos', () => reparos(dir, agoraMs)),
    parte('Compat', () => compat(ctx)),
    parte('Conflitos', () => conflitos(dir, agoraMs, config)),
    parte('Dados', () => dados(dir, config, { comMaiores: false })),
    parte('Economia', () => semana({ dir, agoraMs, dirConfig: null, config })),
    parte('Plano', () => textoPlano(planoEfetivo(dir))),
  ].join(' · ');
}

// opções: dir, agoraMs, config (configSaude), raizPlugin, dirConfig (a pasta
// do Claude Code), versaoNode, versaoClaude. Devolve o texto. Nunca lança.
export function relatorioSaude(opcoes) {
  const {
    dir, agoraMs = Date.now(), versaoNode = process.version, versaoClaude = process.env.CLAUDE_CODE_VERSION,
  } = opcoes;
  let config;
  try { config = opcoes.config ?? configSaude(dir); } catch { config = {}; }
  const raizPlugin = typeof opcoes.raizPlugin === 'string' && path.isAbsolute(opcoes.raizPlugin) ? opcoes.raizPlugin : null;
  let dirConfig = opcoes.dirConfig;
  if (dirConfig === undefined) {
    try { dirConfig = dirConfigClaude(process.env, os.homedir()); } catch { dirConfig = null; }
  }
  const ctx = { dir, agoraMs, raizPlugin, dirConfig, versaoNode, versaoClaude, config };
  const plugin = (() => { try { return versaoPlugin(raizPlugin); } catch { return null; } })();
  const titulo = `hadouken${plugin === null ? '' : ` ${plugin}`} · saúde`;
  const L = [];
  try {
    const { leitura, idadeMs } = lerSaude(dir, agoraMs);
    if (leitura !== null) L.push(`${titulo} (leitura de ${idade(idadeMs)} atrás)`, '', ...linhasPc(leitura, config));
    else if (idadeMs !== null) L.push(`${titulo}: a última leitura do PC tem ${idade(idadeMs)}; a próxima vem em instantes.`);
    else L.push(`${titulo}: a primeira leitura do PC vem em instantes.`);
  } catch {
    L.push(`${titulo}: não deu para ler a saúde do PC agora.`);
  }
  L.push('', secao('Modo', () => {
    const m = lerModo(dir, agoraMs);
    return m.leve ? `leve até ${hhmm(m.ateMs)} (/hadouken:saude normal para voltar)` : 'normal (/hadouken:saude leve para aliviar o PC por 4 h)';
  }));
  L.push(secao('Hooks', () => hooks(ctx)));
  L.push(secao('Reparo', () => reparos(dir, agoraMs)));
  L.push(secao('Compat', () => compat(ctx)));
  const painel = vsixDoPainel(dir, plugin);
  if (painel !== null) L.push(secao('Painel', () => `${painel} (outro PC: code --install-extension <esse arquivo>)`));
  L.push(secao('Confl.', () => conflitos(dir, agoraMs, config)));
  L.push(secao('Dados', () => dados(dir, config)));
  L.push(secao('Semana', () => semana(ctx)));
  L.push(secao('Plano', () => textoPlano(planoEfetivo(dir))));
  return L.join('\n');
}
