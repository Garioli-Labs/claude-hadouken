// Gera as imagens do README a partir do código real do plugin.
//
//   node docs/imagens/gerar.mjs
//
// Nada aqui é desenho à mão: cada linha das imagens é a saída de
// formatarBarra (src/formato.js), avaliarAlertas (src/alerta.js), linhaEstado
// (src/hooks/linha-estado.js), estadoPainel (src/uso/painel.js) e
// formatarMarkdown (src/relatorio.js), rodados sobre dados sintéticos. Os
// nomes são genéricos (meu-projeto, outro-projeto, sua-org) e os ids de sessão
// são inventados. O script só converte o texto (com as cores ANSI da barra)
// em SVG com cara de janela de terminal, e o estado do painel em SVG com cara
// de barra de status do VS Code, desenhado como vscode/extension.cjs o
// desenha: "$(pulse) " + texto, a cor de fundo pelo nível e a dica em
// Markdown (negrito e um parágrafo por linha).
//
// O relógio e o fuso são fixos para as imagens serem reprodutíveis:
// sábado, 26/09/2026, 12:00 em America/Sao_Paulo (UTC-3, sem horário de
// verão). A janela de 7 dias começou na segunda anterior às 22:00 e reinicia
// na segunda seguinte às 22:00; a de 5 horas reinicia às 15:30.
//
// SVG sem script, sem link externo e sem fonte baixada: só <rect>, <circle>,
// <path> e <text>, com pilhas de fontes do sistema (monoespaçada no
// terminal, a de interface no VS Code).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.TZ = 'America/Sao_Paulo';

const { formatarBarra } = await import('../../src/formato.js');
const { avaliarAlertas } = await import('../../src/alerta.js');
const { faixa5h, faixa7d } = await import('../../src/alerta.js');
const { linhaEstado } = await import('../../src/hooks/linha-estado.js');
const { formatarMarkdown } = await import('../../src/relatorio.js');
const { estadoPainel } = await import('../../src/uso/painel.js');

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const epoch = (iso) => Date.parse(iso) / 1000;

const AGORA_MS = Date.parse('2026-09-26T12:00:00-03:00');
const RESET_5H = epoch('2026-09-26T15:30:00-03:00');
const RESET_7D = epoch('2026-09-28T22:00:00-03:00');
const INICIO_7D = epoch('2026-09-21T22:00:00-03:00');

// ------------------------------------------------------------------ SVG

const FONTE = "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
const TAM = 14;
const LARGURA_CHAR = TAM * 0.6;
const ALTURA_LINHA = 21;
const MARGEM_X = 20;
const MARGEM_Y = 16;
const ALTURA_TITULO = 34;

const CORES = {
  fundo: '#0D1117',
  titulo: '#161B22',
  borda: '#30363D',
  texto: '#E6EDF3',
  apagado: '#8B949E',
  verde: '#3FB950',
  amarelo: '#D29922',
  vermelho: '#F85149',
  destaque: '#79C0FF',
};
const ANSI = { 31: CORES.vermelho, 32: CORES.verde, 33: CORES.amarelo };

const escapar = (t) => t
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const largura = (t) => [...t].length;

// Uma linha colorida da barra (texto com ANSI) em segmentos { texto, cor }.
function deAnsi(linha) {
  const segs = [];
  let cor = CORES.texto;
  for (const parte of linha.split(/(\x1b\[\d+m)/)) {
    const m = /^\x1b\[(\d+)m$/.exec(parte);
    if (m) cor = ANSI[m[1]] ?? CORES.texto;
    else if (parte !== '') segs.push({ texto: parte, cor });
  }
  return segs;
}

const simples = (texto, cor = CORES.texto, negrito = false) => [{ texto, cor, negrito }];
const comentario = (texto) => simples(texto, CORES.apagado);

// linhas: lista de listas de segmentos { texto, cor, negrito }.
function janela({ titulo, descricao, linhas }) {
  const colunas = Math.max(largura(titulo) + 12, ...linhas.map((l) => largura(l.map((s) => s.texto).join(''))));
  const w = Math.ceil(MARGEM_X * 2 + colunas * LARGURA_CHAR);
  const h = ALTURA_TITULO + MARGEM_Y * 2 + linhas.length * ALTURA_LINHA;
  const corpo = linhas.map((segs, i) => {
    const y = ALTURA_TITULO + MARGEM_Y + (i + 1) * ALTURA_LINHA - 6;
    const spans = segs.map((s) => `<tspan fill="${s.cor}"${s.negrito ? ' font-weight="700"' : ''}>${escapar(s.texto)}</tspan>`).join('');
    return `    <text x="${MARGEM_X}" y="${y}" xml:space="preserve">${spans}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapar(descricao)}">
  <title>${escapar(descricao)}</title>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${CORES.fundo}" stroke="${CORES.borda}"/>
  <path d="M0.5 ${ALTURA_TITULO} V8.5 a8 8 0 0 1 8 -8 H${w - 8.5} a8 8 0 0 1 8 8 V${ALTURA_TITULO} Z" fill="${CORES.titulo}" stroke="${CORES.borda}"/>
  <circle cx="18" cy="17" r="5" fill="#484F58"/>
  <circle cx="34" cy="17" r="5" fill="#484F58"/>
  <circle cx="50" cy="17" r="5" fill="#484F58"/>
  <text x="${w / 2}" y="22" text-anchor="middle" font-family="${FONTE}" font-size="12" fill="${CORES.apagado}">${escapar(titulo)}</text>
  <g font-family="${FONTE}" font-size="${TAM}">
${corpo}
  </g>
</svg>
`;
}

function gravar(nome, svg) {
  writeFileSync(path.join(PASTA, nome), svg, { encoding: 'utf8' });
  console.log(`gravado docs/imagens/${nome}`);
}

// ------------------------------------------------------------------ barra

// A entrada é o JSON que o Claude Code manda para a statusline. Desde a v0.3.0
// (E6) a barra só mostra modelo·effort, ctx e cache: os limites da conta foram
// para o painel do VS Code (abaixo), e formatarBarra nem os lê.
const sessao = { model: { display_name: 'Opus 5.5' }, effort: 'high', context_window: { used_percentage: 37 }, prompt_cache: { hit_ratio: 0.92 } };
const limites = (u5, u7) => ({
  five_hour: u5 === null ? null : { used_percentage: u5, resets_at: RESET_5H },
  seven_day: u7 === null ? null : { used_percentage: u7, resets_at: RESET_7D },
});
const barra = (entrada) => formatarBarra({ entrada, cor: true });

const calma = barra(sessao);
gravar('barra-calma.svg', janela({
  titulo: 'barra de status do Claude Code',
  descricao: 'Barra de status do claude-hadouken: Opus 5.5·high; contexto em 37% e acerto de cache em 92%, cada um com a sua barrinha, os dois em verde.',
  linhas: [deAnsi(calma)],
}));

const estados = [
  ['# ctx de 70% a 84%: contexto enchendo (amarelo)', barra({ ...sessao, context_window: { used_percentage: 76 } })],
  ['# ctx em 85% ou mais: contexto quase cheio (vermelho)', barra({ ...sessao, context_window: { used_percentage: 88 } })],
  ['# acerto de cache de 50% a 79% (amarelo)', barra({ ...sessao, prompt_cache: { hit_ratio: 0.64 } })],
  ['# acerto de cache abaixo de 50%: começo de sessão ou troca de modelo (vermelho)', barra({ ...sessao, context_window: { used_percentage: 4 }, prompt_cache: { hit_ratio: 0.31 } })],
  ['# effort fora dos cinco níveis conhecidos: só o nome do modelo', barra({ ...sessao, effort: undefined })],
  ['# sessão nova, antes da primeira resposta: ainda sem dado', barra({ model: { display_name: 'Opus 5.5' }, effort: 'high' })],
];
const linhasEstados = [];
for (const [i, [nota, linha]] of estados.entries()) {
  if (i > 0) linhasEstados.push([]);
  linhasEstados.push(comentario(nota), deAnsi(linha));
}
gravar('barra-estados.svg', janela({
  titulo: 'a mesma barra em outras situações',
  descricao: 'Seis estados da barra: ctx 76% em amarelo; ctx 88% em vermelho; cache 64% em amarelo; cache 31% em vermelho, com ctx 4%, no começo de uma sessão; um effort desconhecido, com só o nome do modelo; e uma sessão sem dado ainda, com travessões e sem barrinha.',
  linhas: linhasEstados,
}));

// ------------------------------------------------------------------ painel

// O painel lê dois arquivos da pasta de dados: estado.json (gravado pela
// statusline, com 5h, semana e as sessões) e uso-oficial.json (gravado pela
// leitura de `claude -p /usage`, com o Fable). Aqui os dois são sintéticos,
// numa pasta temporária apagada em seguida, e estadoPainel roda sobre eles
// com o mesmo relógio fixo.
const S_A = '3f2a9c1e-7b4d-4e21-9a0c-5d6e7f8a9b01';
const S_B = '8c41d7b2-2e9f-4a63-b1d5-0f7e3c9a6d24';
const iso = (ms) => new Date(ms).toISOString();
function painel({ p5 = 42, p7 = 59, fable = 71, comEstado = true, comUso = true, ultimoMotivo } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hadouken-imagens-'));
  try {
    const at = AGORA_MS - 20_000;
    const lido = AGORA_MS - 12_000;
    const jan = (p, r) => ({ used_percentage: p, resets_at: r, at: iso(at) });
    if (comEstado) {
      writeFileSync(path.join(dir, 'estado.json'), JSON.stringify({
        versao: 1, at: iso(at), five_hour: jan(p5, RESET_5H), seven_day: jan(p7, RESET_7D),
        sessoes: { [S_A]: { at: iso(at) }, [S_B]: { at: iso(AGORA_MS - 90_000) } },
      }));
    }
    if (comUso) {
      writeFileSync(path.join(dir, 'uso-oficial.json'), JSON.stringify({
        versao: 1, lidoEm: iso(lido),
        sessao: { pct: p5, resetsAtMs: RESET_5H * 1000 },
        semana: { pct: p7, resetsAtMs: RESET_7D * 1000 },
        modelos: { fable: { pct: fable, resetsAtMs: RESET_7D * 1000 } },
        estado: { motivo: 'ok', em: iso(lido) }, bloqueado: null,
      }));
    }
    return estadoPainel({ dir, agoraMs: AGORA_MS, ...(ultimoMotivo === undefined ? {} : { ultimoMotivo }) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// O texto que a extensão mostra sem o módulo do plugin (nenhuma sessão abriu
// com o plugin nesta máquina), lido da própria extensão: ela faz
// require('vscode'), então não dá para importá-la aqui.
const fonteExtensao = readFileSync(path.join(PASTA, '..', '..', 'vscode', 'extension.cjs'), 'utf8');
const TEXTO_SEM_MODULO = /^const TEXTO_SEM_MODULO = '([^'\n]+)';$/m.exec(fonteExtensao)?.[1];
if (TEXTO_SEM_MODULO === undefined) throw new Error('TEXTO_SEM_MODULO não encontrado em vscode/extension.cjs');

// Cores do tema Dark Modern do VS Code: barra de status, fundo de aviso e de
// erro dos itens (statusBarItem.warningBackground e errorBackground, que a
// extensão usa pelo nível) e a caixa da dica.
const VS = {
  fonte: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Ubuntu, 'Droid Sans', sans-serif",
  editor: '#1F1F1F',
  barra: '#181818',
  bordaBarra: '#2B2B2B',
  texto: '#CCCCCC',
  realce: '#F1F1F133',
  aviso: '#7A6400',
  erro: '#C72E0F',
  textoFundo: '#FFFFFF',
  dica: '#202020',
  bordaDica: '#454545',
  forte: '#E8E8E8',
  apagado: '#8B949E',
};
// Largura estimada de um caractere da fonte de interface, em em. A fonte
// muda de sistema para sistema, então cada linha leva textLength com essa
// estimativa (lengthAdjust="spacing": só o espaço entre as letras se ajusta),
// e as caixas ficam do tamanho certo em qualquer fonte da pilha. O negrito
// ocupa um pouco mais.
const LARG_UI = 0.5;
const LARG_NEGRITO = 0.56;
const TAM_BARRA = 12;
const ALT_BARRA = 22;

// O ícone $(pulse) (codicon), como um traço de batimento.
const pulso = (x, y, cor) => `<path d="M${x} ${y} h3 l2 -5 l3 10 l2 -7 l1.5 2 h3" fill="none" stroke="${cor}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>`;

// Item da barra de status com o texto de estadoValido (extension.cjs):
// "$(pulse) " + texto; o fundo segue o nível. `realcado`: com o mouse em cima.
// Devolve { svg, largura }, alinhado à direita em `xDir`.
function itemBarra({ texto, nivel, xDir, yTopo, realcado = false, icone = true }) {
  const larguraTexto = Math.ceil(largura(texto) * TAM_BARRA * LARG_UI);
  const w = 10 + (icone ? 20 : 0) + larguraTexto;
  const x = xDir - w;
  const fundo = nivel === 'aviso' ? VS.aviso : nivel === 'erro' ? VS.erro : realcado ? VS.realce : null;
  const cor = nivel === 'aviso' || nivel === 'erro' ? VS.textoFundo : VS.texto;
  const partes = [];
  if (fundo !== null) partes.push(`<rect x="${x}" y="${yTopo}" width="${w}" height="${ALT_BARRA}" fill="${fundo}"/>`);
  if (icone) partes.push(pulso(x + 5, yTopo + ALT_BARRA / 2, cor));
  partes.push(`<text x="${x + 5 + (icone ? 20 : 0)}" y="${yTopo + 15}" font-family="${VS.fonte}" font-size="${TAM_BARRA}" fill="${cor}" textLength="${larguraTexto}" lengthAdjust="spacing" xml:space="preserve">${escapar(texto)}</text>`);
  return { svg: partes.join('\n  '), largura: w };
}

// A dica é Markdown com um parágrafo por linha e só "**rótulo:**" em negrito.
function linhaDica(linha) {
  const m = /^\*\*(.+?)\*\*(.*)$/.exec(linha);
  return m === null ? [{ texto: linha, negrito: false }] : [{ texto: m[1], negrito: true }, { texto: m[2], negrito: false }];
}

function imagemPainel(estado, descricao) {
  const TAM_DICA = 13;
  const ALT_PARAGRAFO = 26;
  const paragrafos = estado.dica.split('\n\n').map(linhaDica);
  const larguraLinha = (p) => Math.ceil(p.reduce((soma, s) => soma + largura(s.texto) * TAM_DICA * (s.negrito ? LARG_NEGRITO : LARG_UI), 0));
  const larguraDica = 24 + Math.max(...paragrafos.map(larguraLinha));
  const altDica = 16 + paragrafos.length * ALT_PARAGRAFO;
  const margemDireita = 64;
  const w = Math.max(560, larguraDica + margemDireita + 24);
  const yDica = 16;
  const yBarra = yDica + altDica + 10;
  const h = yBarra + ALT_BARRA;
  const xDica = w - margemDireita - larguraDica;
  const item = itemBarra({ texto: estado.texto, nivel: estado.nivel, xDir: w - margemDireita, yTopo: yBarra, realcado: true });
  const texto = paragrafos.map((p, i) => {
    const y = yDica + 8 + i * ALT_PARAGRAFO + 18;
    const spans = p.map((s) => `<tspan fill="${s.negrito ? VS.forte : VS.texto}"${s.negrito ? ' font-weight="700"' : ''}>${escapar(s.texto)}</tspan>`).join('');
    return `    <text x="${xDica + 12}" y="${y}" textLength="${larguraLinha(p)}" lengthAdjust="spacing" xml:space="preserve">${spans}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapar(descricao)}">
  <title>${escapar(descricao)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${VS.editor}"/>
  <rect x="${xDica + 0.5}" y="${yDica + 0.5}" width="${larguraDica - 1}" height="${altDica - 1}" rx="3" fill="${VS.dica}" stroke="${VS.bordaDica}"/>
  <g font-family="${VS.fonte}" font-size="${TAM_DICA}">
${texto}
  </g>
  <rect x="0" y="${yBarra}" width="${w}" height="${ALT_BARRA}" fill="${VS.barra}"/>
  <path d="M0 ${yBarra + 0.5} H${w}" stroke="${VS.bordaBarra}"/>
  ${item.svg}
</svg>
`;
}

const painelCalmo = painel();
gravar('painel.svg', imagemPainel(painelCalmo, `Item do claude-hadouken na barra de status do VS Code, com o mouse em cima: ${painelCalmo.texto}. A dica mostra, por janela, a porcentagem, o reinício e a previsão: sessão de 5h em 42%, reinicia às 15:30 e, nesse ritmo, esgota por volta das 14:04; semana de todos os modelos em 59%, não esgota antes do reinício de segunda às 22:00; semana do Fable em 71%, esgota segunda de manhã. Depois, 2 sessões ativas, a idade da leitura oficial (12 s) e a fonte: statusline do Claude Code e claude /usage, sem tokens.`));

// Estados do item: cada linha é um comentário e a barra de status com o item.
const estadosPainel = [
  ['# todas as janelas abaixo de 75%: sem cor', painelCalmo],
  ['# pior janela de 75% a 89%: fundo de aviso', painel({ p5: 78 })],
  ['# pior janela em 90% ou mais: fundo de erro', painel({ fable: 92 })],
  ['# antes da primeira leitura oficial: o Fable fica em —', painel({ comUso: false })],
  ['# nenhuma leitura válida', painel({ comEstado: false, comUso: false })],
  ['# nenhuma sessão do Claude Code abriu com o plugin nesta máquina', { texto: null, nivel: undefined }],
];
{
  const TAM_NOTA = 13;
  const ALT_NOTA = 22;
  const larguraNotas = Math.max(...estadosPainel.map(([n]) => largura(n))) * TAM_NOTA * LARG_UI;
  const larguraItens = Math.max(...estadosPainel.map(([, e]) => largura(e.texto ?? TEXTO_SEM_MODULO.replace('$(pulse) ', '')))) * TAM_BARRA * LARG_UI + 30;
  const w = Math.ceil(Math.max(larguraNotas, larguraItens) + 2 * MARGEM_X + 60);
  const passo = ALT_NOTA + ALT_BARRA + 14;
  const h = MARGEM_Y + estadosPainel.length * passo;
  const corpo = estadosPainel.map(([nota, e], i) => {
    const y = MARGEM_Y + i * passo;
    // Sem o módulo, a extensão põe o texto fixo, com o ícone já nele.
    const texto = e.texto === null ? TEXTO_SEM_MODULO.replace('$(pulse) ', '') : e.texto;
    const item = itemBarra({ texto, nivel: e.nivel, xDir: w - 40, yTopo: y + ALT_NOTA });
    return `  <text x="${MARGEM_X}" y="${y + 15}" font-family="${FONTE}" font-size="${TAM_NOTA}" fill="${VS.apagado}" xml:space="preserve">${escapar(nota)}</text>
  <rect x="0" y="${y + ALT_NOTA}" width="${w}" height="${ALT_BARRA}" fill="${VS.barra}"/>
  <path d="M0 ${y + ALT_NOTA + 0.5} H${w}" stroke="${VS.bordaBarra}"/>
  ${item.svg}`;
  }).join('\n');
  const descricao = `Seis estados do item do painel na barra de status do VS Code: ${estadosPainel.map(([, e]) => (e.texto === null ? TEXTO_SEM_MODULO.replace('$(pulse) ', '') : e.texto) + (e.nivel === 'aviso' ? ' (fundo amarelo)' : e.nivel === 'erro' ? ' (fundo vermelho)' : '')).join('; ')}.`;
  gravar('painel-estados.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapar(descricao)}">
  <title>${escapar(descricao)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${VS.editor}"/>
${corpo}
</svg>
`);
}

// ------------------------------------------------------------------ avisos

// Uma manhã em sequência: início de sessão e três prompts, cada um com a
// leitura que o Claude Code acabou de mandar. A memória de avisos passa de um
// prompt para o outro, como em alertas.json.
const passos = [
  ['# prompt com 5h em 74%', limites(74, 59)],
  ['# prompt seguinte, ainda em 76%: mesma faixa, nada é injetado', limites(76, 59)],
  ['# prompt com 5h em 83%', limites(83, 59)],
  ['# prompt com 7d em 78% (esperado 65%)', limites(83, 78)],
  ['# 3 sessões ativas; no ritmo atual, 5h chega a 100% às 12:50 (daqui a 50 min)', limites(83, 78), { five_hour: Date.parse('2026-09-26T12:50:00-03:00'), seven_day: null }],
  ['# prompt seguinte, previsão às 12:45: mesma faixa (60 min), nada é injetado', limites(83, 78), { five_hour: Date.parse('2026-09-26T12:45:00-03:00'), seven_day: null }],
  ['# previsão às 12:25 (daqui a 25 min): faixa de 30 min, novo aviso', limites(83, 78), { five_hour: Date.parse('2026-09-26T12:25:00-03:00'), seven_day: null }],
];
const linhasAvisos = [comentario('# início da sessão (SessionStart)'), simples(linhaEstado(limites(42, 59), AGORA_MS))];
let anteriores = null;
({ novos: anteriores } = avaliarAlertas({ limites: limites(42, 59), anteriores, sessionId: 's1', agoraMs: AGORA_MS }));
for (const [nota, lim, previsao] of passos) {
  const extra = previsao ? { previsao, sessoesAtivas: 3 } : {};
  const { linhas, novos } = avaliarAlertas({ limites: lim, anteriores, sessionId: 's1', agoraMs: AGORA_MS, ...extra });
  anteriores = novos;
  linhasAvisos.push([], comentario(nota));
  if (linhas.length === 0) linhasAvisos.push(simples('(nenhuma linha)', CORES.apagado));
  for (const l of linhas) linhasAvisos.push(simples(l));
}
gravar('avisos.svg', janela({
  titulo: 'o que o Claude recebe no contexto',
  descricao: 'Linhas que o Claude recebe: o consumo no início da sessão (5h 42% com reset às 15:30, 7d 59% com reset segunda 22:00 e, nesse ritmo, não esgota antes do reinício) e um aviso a cada mudança de faixa (5h em 74%: atenção; 5h em 83%: serializar; 7d 78% contra 65%: modo econômico). Depois, com 3 sessões ativas, o aviso de projeção: a 5h chega a 100% às 12:50, antes do reset das 15:30; na mesma faixa de 60 minutos nada se repete; a 25 minutos do estouro, um aviso novo. Um prompt na mesma faixa não gera linha.',
  linhas: linhasAvisos,
}));

// ------------------------------------------------------------------ relatório

const CAMPOS = ['respostas', 'input', 'output', 'cacheRead', 'cacheCreate', 'cacheCreate1h', 'cacheCreate5m', 'cacheCreateSemDetalhe'];
const zero = () => Object.fromEntries(CAMPOS.map((c) => [c, 0]));
function fechar(s) {
  const den = s.input + s.cacheRead + s.cacheCreate;
  return { ...s, acertoCache: den > 0 ? Math.round((s.cacheRead / den) * 1000) / 1000 : null };
}
function somar(a, b) {
  const s = { ...a };
  for (const c of CAMPOS) s[c] += b[c];
  return s;
}
const peca = (respostas, input, c1h, c5m, lido, saida) => ({
  respostas, input, output: saida, cacheRead: lido, cacheCreate: c1h + c5m, cacheCreate1h: c1h, cacheCreate5m: c5m, cacheCreateSemDetalhe: 0,
});
const escala = (p, f) => Object.fromEntries(CAMPOS.map((c) => [c, Math.round(p[c] * f)]));

const S1 = '3f2a9c1e-7b4d-4e21-9a0c-5d6e7f8a9b01';
const S2 = '8c41d7b2-2e9f-4a63-b1d5-0f7e3c9a6d24';
const S3 = 'b7e05f93-61ac-4d8e-9f27-3a1c5e8d0b46';

// Cada pedaço: projeto, modelo·effort, origem, sessão e a soma.
function pecasDo(fator) {
  const p = [
    ['meu-projeto', 'claude-opus-5-5·high', 'principal', S1, peca(30, 280, 48_000, 0, 1_410_000, 33_000)],
    ['meu-projeto', 'claude-haiku-4-5·low', 'subagente', S1, peca(12, 100, 2_000, 7_800, 410_000, 8_500)],
    ['outro-projeto', 'claude-opus-5-5·high', 'principal', S2, peca(12, 96, 18_400, 2_100, 402_000, 9_800)],
  ];
  if (fator > 1) p.push(['outro-projeto', 'claude-opus-5-5·medium', 'principal', S3, peca(40, 310, 52_000, 0, 1_650_000, 27_000)]);
  return p.map(([pr, mo, or, se, s]) => [pr, mo, or, se, fator > 1 ? escala(s, fator) : s]);
}

function agregado(pecas) {
  let total = zero();
  const porProjeto = {};
  const porModeloEffort = {};
  const pvs = { principal: zero(), subagente: zero() };
  const porSessao = {};
  for (const [projeto, modelo, origem, sessaoId, s] of pecas) {
    total = somar(total, s);
    porProjeto[projeto] = somar(porProjeto[projeto] ?? zero(), s);
    porModeloEffort[modelo] = somar(porModeloEffort[modelo] ?? zero(), s);
    pvs[origem] = somar(pvs[origem], s);
    const antes = porSessao[sessaoId] ?? { ...zero(), projetos: [], modelos: [] };
    const nomeModelo = modelo.slice(0, modelo.lastIndexOf('·'));
    porSessao[sessaoId] = {
      ...somar(antes, s),
      projetos: [...new Set([...antes.projetos, projeto])],
      modelos: [...new Set([...antes.modelos, nomeModelo])],
    };
  }
  const fecharMapa = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fechar(v)]));
  return {
    total: fechar(total),
    porProjeto: fecharMapa(porProjeto),
    porModeloEffort: fecharMapa(porModeloEffort),
    principalVsSubagente: { principal: fechar(pvs.principal), subagente: fechar(pvs.subagente) },
    porSessao: Object.fromEntries(Object.entries(porSessao).map(([k, v]) => [k, { ...fechar(v), projetos: v.projetos, modelos: v.modelos }])),
    sessoesOmitidas: 0,
    detalheIncoerente: 0,
  };
}

const r7 = faixa7d({ usado: 59, resetsAt: RESET_7D, agoraMs: AGORA_MS });
const relatorio = {
  versao: 1,
  limites: {
    idade_min: 2,
    five_hour: { used_percentage: 42, resets_at: RESET_5H, faixa: faixa5h(42), idade_min: 2 },
    seven_day: { used_percentage: 59, resets_at: RESET_7D, esperado: r7.esperado, desvio: r7.desvio, modo: r7.faixa, idade_min: 2 },
  },
  limites_motivo: null,
  claude: {
    hoje: agregado(pecasDo(1)),
    sete_dias: agregado(pecasDo(4.6)),
    semana: agregado(pecasDo(3.9)),
    hoje_desde: new Date(Date.parse('2026-09-26T00:00:00-03:00')).toISOString(),
    sete_dias_desde: new Date(AGORA_MS - 7 * 24 * 3600_000).toISOString(),
    semana_desde: new Date(INICIO_7D * 1000).toISOString(),
    semana_origem: 'janela_7d',
    linhasInvalidas: 0,
    arquivos: 5,
    ilegiveis: 0,
    truncado: false,
  },
  github: {
    'sua-org/meu-projeto': {
      publico: false,
      runs7: { total: 9, porEvento: { push: 6, pull_request: 2, schedule: 1 } },
      runs30: { total: 34, porEvento: { push: 22, pull_request: 7, schedule: 4, workflow_dispatch: 1 } },
      conclusoes30: { success: 29, failure: 4, cancelled: 1 },
      minutos30: { linux: 212, windows: 48, macos: 0, ponderado: 212 + 48 * 1.67 },
      naoClassificado: { jobs: 0, minutos: 0 },
      cache: { bytes: Math.round(1.2 * 1024 ** 3), limiteBytes: 10 * 1024 ** 3 },
      totalApi30: 34,
      truncado: false,
      pendentes: 0,
    },
    'sua-org/outro-projeto': { indisponivel: 'HTTP 404' },
  },
  avisos: [],
  // Sessões com resposta na última hora (spec v0.2.0 §12.6): tokens são
  // entrada + cache criado + cache lido + saída; parte, a fração do total da
  // hora, com piso em 3 casas.
  sessoesAbertas: [
    { id: S1, projeto: 'meu-projeto', modelos: ['claude-opus-5-5', 'claude-haiku-4-5'], tokens: 612_400, parte: 0.745 },
    { id: S2, projeto: 'outro-projeto', modelos: ['claude-opus-5-5'], tokens: 208_900, parte: 0.254 },
  ],
};

const markdown = formatarMarkdown(relatorio);
writeFileSync(path.join(PASTA, 'relatorio-exemplo.md'), `${markdown}\n`, { encoding: 'utf8' });
console.log('gravado docs/imagens/relatorio-exemplo.md');

// Alinha as tabelas markdown (só espaços a mais, como o terminal as mostra
// em colunas) e pinta títulos e bordas. O conteúdo das células não muda.
function alinhar(linhas) {
  const saida = [];
  let i = 0;
  while (i < linhas.length) {
    if (!linhas[i].startsWith('|')) { saida.push(linhas[i]); i++; continue; }
    const bloco = [];
    while (i < linhas.length && linhas[i].startsWith('|')) bloco.push(linhas[i++]);
    const celulas = bloco.map((l) => l.slice(1, -1).split(' | ').map((c) => c.trim()));
    // A linha separadora (|---|---:|) diz o alinhamento de cada coluna: com
    // ':' no fim, número (à direita); sem, texto (à esquerda).
    const direita = bloco[1].slice(1, -1).split('|').map((c) => c.trim().endsWith(':'));
    const larg = celulas[0].map((_, c) => Math.max(...celulas.map((row, r) => (r === 1 ? 3 : largura(row[c] ?? '')))));
    for (const [r, row] of celulas.entries()) {
      if (r === 1) saida.push(`|${larg.map((w, k) => (direita[k] ? `${'-'.repeat(w + 1)}:` : '-'.repeat(w + 2))).join('|')}|`);
      else saida.push(`| ${row.map((c, k) => (direita[k] ? c.padStart(larg[k]) : c.padEnd(larg[k]))).join(' | ')} |`);
    }
  }
  return saida;
}

// Corta, para a imagem caber na largura do README: a tabela de sessões de hoje
// e as tabelas dos dois períodos longos. Fica o título de cada período e uma
// marca [...] no lugar do que saiu; a seção de sessões abertas fica inteira.
// O texto completo está em relatorio-exemplo.md. A cerca ``` do painel de
// limites também sai: é marcação, e o Claude Code mostra só o conteúdo do
// bloco.
function cortar(linhas) {
  const saida = [];
  let pulando = false;
  let secao = '';
  for (const l of linhas) {
    if (l === '```') continue;
    if (!pulando && secao.startsWith('### Hoje') && l.startsWith('| Sessão ')) {
      pulando = true;
      saida.push('[… tabela Sessão: as 10 sessões de maior consumo, com projeto e modelos …]', '');
      continue;
    }
    if (l.startsWith('### ')) {
      secao = l;
      pulando = !l.startsWith('### Hoje') && !l.startsWith('### Sessões abertas');
      saida.push(l);
      if (pulando) saida.push('', '[… as mesmas quatro tabelas, com os números deste período …]', '');
      continue;
    }
    if (l.startsWith('## ')) pulando = false;
    if (!pulando) saida.push(l);
  }
  return saida;
}

function pintar(l) {
  if (l.startsWith('#')) return simples(l, CORES.destaque, true);
  if (l.startsWith('[…')) return comentario(l);
  if (l.startsWith('|')) {
    const segs = [];
    for (const parte of l.split(/(\|)/)) if (parte !== '') segs.push({ texto: parte, cor: parte === '|' || /^-+:?$/.test(parte) ? CORES.borda : CORES.texto });
    return segs;
  }
  if (l.startsWith('Os nomes de projeto')) return comentario(l);
  return simples(l);
}

const linhasRel = alinhar(cortar(markdown.split('\n')));
gravar('relatorio.svg', janela({
  titulo: '/claude-hadouken:consumo',
  descricao: 'Trecho do relatório /claude-hadouken:consumo: o painel de limites e ritmo com uma barrinha por janela, as duas sessões com resposta na última hora (parte do total da hora, projeto, modelos e tokens), as quatro tabelas de hoje (projeto, modelo·effort, origem e sessão) com a coluna parte do total em barrinha, respostas, entrada, cache criado 1 h e 5 min, cache lido, saída e acerto de cache, e a seção do GitHub com execuções, conclusões, minutos por sistema e cache.',
  linhas: linhasRel.map(pintar),
}));
