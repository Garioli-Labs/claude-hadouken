import { faixa5h, faixa7d } from './alerta.js';
import { horaLocal, diaHora, effortValido, GLIFOS_BARRA, janelaValida, numeroFinito, sanear } from './util.js';

// Linha da barra de status. Todo dado externo passa por aqui antes do terminal
// (spec 8.1, S2/S3): o nome do modelo passa por `sanear`; o effort vem de lista
// fixa; o resto são números validados e rótulos do código. As únicas
// sequências ANSI da saída são as quatro cores abaixo, e só com `cor === true`.

const COR = { verde: '\x1b[32m', amarelo: '\x1b[33m', vermelho: '\x1b[31m', fim: '\x1b[0m' };
const COR_5H = { ok: 'verde', atencao: 'amarelo', serializar: 'vermelho', fechar: 'vermelho' };
const COR_7D = { normal: 'verde', folga: 'verde', economico: 'amarelo', 'so-leitura': 'vermelho' };
const ROTULO_7D = { normal: '', folga: ' folga', economico: ' econ', 'so-leitura': ' só leitura' };
const MAX_MODELO = 40;
const SEM_VALOR = '—';
const SEPARADOR = ' │ ';
const noIntervalo = (n, min, max) => numeroFinito(n) && n >= min && n <= max;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pinta = (texto, cor, ligado) => (ligado ? `${COR[cor]}${texto}${COR.fim}` : texto);
// Piso, nunca arredondamento (decisão (c) da Task 3): 89.6 aparece como 89%,
// e não como um 90% que contradiria a faixa ainda abaixo de 90.
const pct = (x) => `${Math.floor(x)}%`;

// Razão de acerto 0–1 em percentual inteiro por piso. O arredondamento em 6
// casas antes do piso tira o ruído do double (0.57 * 100 = 56.99999999999999),
// que de outro modo mostraria 56%.
const pctRazao = (r) => pct(Math.round(r * 1e6) / 1e4);

// Monta a linha "modelo·effort │ 5h │ 7d │ ctx │ cache". `limites` é a saída de
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
    partes.push(f5
      ? pinta(`5h ${pct(f5.used_percentage)} ↻${horaLocal(f5.resets_at)}`, COR_5H[faixa5h(f5.used_percentage)], ligado)
      : `5h ${SEM_VALOR}`);

    const f7 = janelaValida(l.seven_day);
    if (f7 && numeroFinito(agoraMs)) {
      const { faixa, esperado } = faixa7d({ usado: f7.used_percentage, resetsAt: f7.resets_at, agoraMs });
      partes.push(pinta(`7d ${pct(f7.used_percentage)}/${pct(esperado)}${ROTULO_7D[faixa]} ↻${diaHora(f7.resets_at)}`, COR_7D[faixa], ligado));
    } else {
      partes.push(`7d ${SEM_VALOR}`);
    }

    const ctx = ehObjeto(e.context_window) ? e.context_window.used_percentage : undefined;
    partes.push(noIntervalo(ctx, 0, 100) ? `ctx ${pct(ctx)}` : `ctx ${SEM_VALOR}`);

    // V1 (2026-09-25): a statusline não traz tokens acumulados da sessão; o
    // acerto de cache (prompt_cache.hit_ratio) é o sinal de desperdício ao vivo.
    const hr = ehObjeto(e.prompt_cache) ? e.prompt_cache.hit_ratio : undefined;
    partes.push(noIntervalo(hr, 0, 1) ? `cache ${pctRazao(hr)}` : `cache ${SEM_VALOR}`);

    return partes.join(SEPARADOR);
  } catch {
    return '';
  }
}
