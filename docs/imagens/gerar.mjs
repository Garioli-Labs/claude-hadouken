// Gera as imagens do README a partir do código real do plugin.
//
//   node docs/imagens/gerar.mjs
//
// Nada aqui é desenho à mão: cada linha das imagens é a saída de
// formatarBarra (src/formato.js), avaliarAlertas (src/alerta.js), linhaEstado
// (src/hooks/linha-estado.js) e formatarMarkdown (src/relatorio.js), rodados
// sobre dados sintéticos. Os nomes são genéricos (meu-projeto, outro-projeto,
// sua-org) e os ids de sessão são inventados. O script só converte o texto
// (com as cores ANSI da barra) em SVG com cara de janela de terminal.
//
// O relógio e o fuso são fixos para as imagens serem reprodutíveis:
// sábado, 26/09/2026, 12:00 em America/Sao_Paulo (UTC-3, sem horário de
// verão). A janela de 7 dias começou na segunda anterior às 22:00 e reinicia
// na segunda seguinte às 22:00; a de 5 horas reinicia às 15:30.
//
// SVG sem script, sem link externo e sem fonte baixada: só <rect>, <circle>
// e <text> com uma pilha de fontes monoespaçadas do sistema.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.TZ = 'America/Sao_Paulo';

const { formatarBarra } = await import('../../src/formato.js');
const { avaliarAlertas } = await import('../../src/alerta.js');
const { faixa5h, faixa7d } = await import('../../src/alerta.js');
const { linhaEstado } = await import('../../src/hooks/linha-estado.js');
const { formatarMarkdown } = await import('../../src/relatorio.js');

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

// A entrada é o JSON que o Claude Code manda para a statusline; os limites são
// o que estado.js devolveria depois de validar a leitura. `extra` leva o que
// a statusline passa além disso (spec v0.2.0 §12): sessoesAtivas (de
// estado.js) e previsao (de previsao.js), com instantes em ms.
const sessao = { model: { display_name: 'Opus 5.5' }, effort: 'high', context_window: { used_percentage: 37 }, prompt_cache: { hit_ratio: 0.92 } };
const limites = (u5, u7) => ({
  five_hour: u5 === null ? null : { used_percentage: u5, resets_at: RESET_5H },
  seven_day: u7 === null ? null : { used_percentage: u7, resets_at: RESET_7D },
});
const barra = (entrada, lim, extra = {}) => formatarBarra({ entrada, limites: lim, agoraMs: AGORA_MS, cor: true, ...extra });
const ESTOURO_5H = Date.parse('2026-09-26T13:10:00-03:00');
const ESTOURO_7D = Date.parse('2026-09-27T18:00:00-03:00');

const calma = barra(sessao, limites(42, 59));
gravar('barra-calma.svg', janela({
  titulo: 'barra de status do Claude Code',
  descricao: 'Barra de status do claude-hadouken: Opus 5.5·high; 5h com barrinha em 42% e reset às 15:30; 7d com barrinha em 59%, marca no esperado de 65% e reset segunda 22:00; contexto em 37% e acerto de cache em 92%, cada um com a sua barrinha; tudo em verde.',
  linhas: [deAnsi(calma)],
}));

const estados = [
  ['# 5h passou de 70%: faixa atenção (amarelo)', barra(sessao, limites(74, 59))],
  ['# 5h passou de 80%: faixa serializar (vermelho)', barra(sessao, limites(82, 59))],
  ['# 5h passou de 90%: faixa fechar (vermelho)', barra(sessao, limites(93, 59))],
  ['# 7d mais de 10 pontos acima do esperado: econ (amarelo)', barra(sessao, limites(42, 78))],
  ['# 7d mais de 10 pontos abaixo do esperado: folga (verde)', barra(sessao, limites(42, 50))],
  ['# 7d em 90% ou mais, reset a mais de 24 h: só leitura (vermelho)', barra(sessao, limites(42, 91))],
  ['# ctx em 85% ou mais: contexto quase cheio (vermelho)', barra({ ...sessao, context_window: { used_percentage: 88 } }, limites(42, 59))],
  ['# acerto de cache entre 50% e 79% (amarelo)', barra({ ...sessao, prompt_cache: { hit_ratio: 0.64 } }, limites(42, 59))],
  ['# 3 sessões abertas ao mesmo tempo: o trecho de sessões, logo depois do modelo', barra(sessao, limites(42, 59), { sessoesAtivas: 3 })],
  ['# no ritmo atual, 5h chega a 100% às 13:10, antes do reset: previsão (vermelho)', barra(sessao, limites(82, 59), { sessoesAtivas: 3, previsao: { five_hour: ESTOURO_5H, seven_day: null } })],
  ['# no ritmo atual, 7d chega a 100% no domingo às 18:00, antes do reset de segunda', barra(sessao, limites(42, 84), { previsao: { five_hour: null, seven_day: ESTOURO_7D } })],
  ['# sessão nova, antes da primeira resposta: ainda sem dado', barra({ model: { display_name: 'Opus 5.5' }, effort: 'high' }, null)],
];
const linhasEstados = [];
for (const [i, [nota, linha]] of estados.entries()) {
  if (i > 0) linhasEstados.push([]);
  linhasEstados.push(comentario(nota), deAnsi(linha));
}
gravar('barra-estados.svg', janela({
  titulo: 'a mesma barra em outras situações',
  descricao: 'Doze estados da barra, cada um com as barrinhas: 5h 74% em amarelo; 5h 82% em vermelho; 5h 93% em vermelho; 7d 78%/65% econ em amarelo; 7d 50%/65% folga em verde; 7d 91%/65% só leitura em vermelho; ctx 88% em vermelho; cache 64% em amarelo; 3 sessões abertas, com o trecho 3 sessões depois do modelo; 5h em 82% com a previsão de chegar a 100% às 13:10, em vermelho; 7d em 84% com a previsão de chegar a 100% no domingo às 18:00, em vermelho; e uma sessão sem dado ainda, com travessões e sem barrinha.',
  linhas: linhasEstados,
}));

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
  descricao: 'Linhas que o Claude recebe: o estado no início da sessão e um aviso a cada mudança de faixa (5h em 74%: atenção; 5h em 83%: serializar; 7d 78% contra 65%: modo econômico). Depois, com 3 sessões ativas, o aviso de projeção: a 5h chega a 100% às 12:50, antes do reset das 15:30; na mesma faixa de 60 minutos nada se repete; a 25 minutos do estouro, um aviso novo. Um prompt na mesma faixa não gera linha.',
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
