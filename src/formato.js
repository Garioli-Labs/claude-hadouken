import { faixa5h, faixa7d } from './alerta.js';
import { barrinha } from './barrinha.js';
import { horaLocal, diaHora, effortValido, GLIFOS_BARRA, janelaValida, numeroFinito, sanear } from './util.js';

// Linha da barra de status. Todo dado externo passa por aqui antes do terminal
// (spec 8.1, S2/S3): o nome do modelo passa por `sanear`; o effort vem de lista
// fixa; o resto são números validados, barrinhas (barrinha.js) e rótulos do
// código. As únicas sequências ANSI da saída são as quatro cores abaixo, e só
// com `cor === true`.

const COR = { verde: '\x1b[32m', amarelo: '\x1b[33m', vermelho: '\x1b[31m', fim: '\x1b[0m' };
const COR_5H = { ok: 'verde', atencao: 'amarelo', serializar: 'vermelho', fechar: 'vermelho' };
const COR_7D = { normal: 'verde', folga: 'verde', economico: 'amarelo', 'so-leitura': 'vermelho' };
const ROTULO_7D = { normal: '', folga: ' folga', economico: ' econ', 'so-leitura': ' só leitura' };
// Faixas só visuais de ctx e cache (spec v0.2.0 §5): não geram aviso nem
// mudam alerta.js. Comparam o inteiro exibido (piso), para a cor nunca
// contradizer o número. Casa única (test/casa-unica.test.js).
const FAIXAS_CTX = Object.freeze({ amarelo: 70, vermelho: 85 });
const FAIXAS_CACHE = Object.freeze({ amarelo: 50, verde: 80 });
const corCtx = (n) => (n >= FAIXAS_CTX.vermelho ? 'vermelho' : n >= FAIXAS_CTX.amarelo ? 'amarelo' : 'verde');
const corCache = (n) => (n >= FAIXAS_CACHE.verde ? 'verde' : n >= FAIXAS_CACHE.amarelo ? 'amarelo' : 'vermelho');
const MAX_MODELO = 40;
const SEM_VALOR = '—';
const SEPARADOR = ' │ ';
const noIntervalo = (n, min, max) => numeroFinito(n) && n >= min && n <= max;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pinta = (texto, cor, ligado) => (ligado ? `${COR[cor]}${texto}${COR.fim}` : texto);
// Piso, nunca arredondamento (decisão (c) da Task 3): 89.6 aparece como 89%,
// e não como um 90% que contradiria a faixa ainda abaixo de 90.
const pct = (x) => `${Math.floor(x)}%`;

// Razão de acerto 0–1 em pontos (0–100). O arredondamento em 6 casas tira o
// ruído do double (0.57 * 100 = 56.99999999999999), que de outro modo
// mostraria 56% depois do piso; a barrinha usa o mesmo valor.
const emPontos = (r) => Math.round(r * 1e6) / 1e4;

// "rótulo barrinha resto" (spec v0.2.0 §5): a barrinha usa o valor antes do
// piso. Quem chama já validou o valor em [0, 100]; se mesmo assim barrinha
// devolver null, o trecho sai sem ela, como na v0.1.0.
function indicador(rotulo, valor, resto, marca) {
  const b = barrinha(valor, marca === undefined ? undefined : { marca });
  return b === null ? `${rotulo} ${resto}` : `${rotulo} ${b} ${resto}`;
}

// Monta a linha "modelo·effort │ 5h │ 7d │ ctx │ cache", cada indicador com a
// sua barrinha (spec v0.2.0 §5). `limites` é a saída de
// limitesValidos (ou null); `agoraMs` alimenta o ritmo de 7 dias; `cor` liga as
// cores só se for exatamente true. Campo ausente ou fora do schema vira "—".
// Nunca lança: uma falha interna devolve '' (spec 6.4, linha vazia).
export function formatarBarra(opcoes) {
  try {
    const { entrada, limites, agoraMs, cor } = opcoes ?? {};
    const e = ehObjeto(entrada) ? entrada : {};
    const l = ehObjeto(limites) ? limites : {};
    const ligado = cor === true;

    const saneado = sanear(ehObjeto(e.model) ? e.model.display_name : undefined, MAX_MODELO);
    const nome = (saneado ?? '').replace(GLIFOS_BARRA, ' ').replace(/ {2,}/g, ' ').trim() || SEM_VALOR;
    // A mesma lista que estado.js usa ao gravar a sessão (util.EFFORTS_VALIDOS).
    const effort = effortValido(e.effort);
    const partes = [effort ? `${nome}·${effort}` : nome];

    // Cada janela passa de novo por janelaValida (util.js), o schema de
    // estado.js: quem chama já passa a saída de limitesValidos, e a checagem
    // só garante que nenhum outro chamador faça a barra mostrar NaN ou uma
    // hora inválida. O nome do modelo perde os glifos da barra (GLIFOS_BARRA).
    const f5 = janelaValida(l.five_hour);
    if (f5) {
      const u = f5.used_percentage;
      partes.push(pinta(indicador('5h', u, `${pct(u)} ↻${horaLocal(f5.resets_at)}`), COR_5H[faixa5h(u)], ligado));
    } else {
      partes.push(`5h ${SEM_VALOR}`);
    }

    // 7d: a marca da barrinha é o esperado do ritmo linear (faixa7d); a
    // janela de 5 h não tem ritmo e fica sem marca.
    const f7 = janelaValida(l.seven_day);
    if (f7 && numeroFinito(agoraMs)) {
      const u = f7.used_percentage;
      const { faixa, esperado } = faixa7d({ usado: u, resetsAt: f7.resets_at, agoraMs });
      partes.push(pinta(indicador('7d', u, `${pct(u)}/${pct(esperado)}${ROTULO_7D[faixa]} ↻${diaHora(f7.resets_at)}`, esperado), COR_7D[faixa], ligado));
    } else {
      partes.push(`7d ${SEM_VALOR}`);
    }

    const ctx = ehObjeto(e.context_window) ? e.context_window.used_percentage : undefined;
    partes.push(noIntervalo(ctx, 0, 100)
      ? pinta(indicador('ctx', ctx, pct(ctx)), corCtx(Math.floor(ctx)), ligado)
      : `ctx ${SEM_VALOR}`);

    // V1 (2026-09-25): a statusline não traz tokens acumulados da sessão; o
    // acerto de cache (prompt_cache.hit_ratio) é o sinal de desperdício ao vivo.
    const hr = ehObjeto(e.prompt_cache) ? e.prompt_cache.hit_ratio : undefined;
    if (noIntervalo(hr, 0, 1)) {
      const pontos = emPontos(hr);
      partes.push(pinta(indicador('cache', pontos, pct(pontos)), corCache(Math.floor(pontos)), ligado));
    } else {
      partes.push(`cache ${SEM_VALOR}`);
    }

    return partes.join(SEPARADOR);
  } catch {
    return '';
  }
}
