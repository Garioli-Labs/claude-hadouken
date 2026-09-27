import { faixa5h, faixa7d } from './alerta.js';
import { barrinha } from './barrinha.js';
// Teto do trecho de sessões ativas (spec v0.2.0 §12.4): o de estado.sessoes,
// cuja casa única é estado.js; o outro nome o separa do MAX_SESSOES de
// agregacao.js. Import estático sem custo para o gate: formato.js só é
// carregado depois dele, no mesmo Promise.all que já carrega estado.js.
import { MAX_SESSOES as MAX_SESSOES_ATIVAS } from './estado.js';
import { horaLocal, diaHora, effortValido, GLIFOS_BARRA, janelaValida, numeroFinito, sanear } from './util.js';

// Linha da barra de status. Todo dado externo passa por aqui antes do terminal
// (spec 8.1, S2/S3): o nome do modelo passa por `sanear`; o effort vem de lista
// fixa; o resto são números validados, barrinhas (barrinha.js), horários
// formatados e rótulos do código. As únicas sequências ANSI da saída são as quatro cores abaixo, e só
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

// Previsão de estouro (spec v0.2.0 §12.3) que pode aparecer: instante em ms
// depois de agora e antes do reset da janela; o resto é null.
const estouro = (ms, resetsAt, agoraMs) => (numeroFinito(ms) && numeroFinito(agoraMs) && ms > agoraMs && ms < resetsAt * 1000 ? ms : null);

// "rótulo barrinha resto" (spec v0.2.0 §5): a barrinha usa o valor antes do
// piso. Quem chama já validou o valor em [0, 100]; se mesmo assim barrinha
// devolver null, o trecho sai sem ela, como na v0.1.0.
function indicador(rotulo, valor, resto, marca) {
  const b = barrinha(valor, marca === undefined ? undefined : { marca });
  return b === null ? `${rotulo} ${resto}` : `${rotulo} ${b} ${resto}`;
}

// Monta a linha "modelo·effort │ N sessões │ 5h │ 7d │ ctx │ cache", cada
// indicador com a sua barrinha (spec v0.2.0 §5). `limites` é a saída de
// limitesValidos (ou null); `agoraMs` alimenta o ritmo de 7 dias; `cor` liga as
// cores só se for exatamente true. Campo ausente ou fora do schema vira "—".
// Spec v0.2.0 §12: `sessoesAtivas` (sessoesAtivas de estado.js) põe o trecho
// "N sessões" logo depois do modelo, sem cor; `previsao` (preverEstouro de
// previsao.js) põe "→100% HH:MM" depois do reset da janela, em vermelho, só
// com o instante antes do reset. Nunca lança: uma falha interna devolve ''
// (spec 6.4, linha vazia).
export function formatarBarra(opcoes) {
  try {
    const { entrada, limites, agoraMs, cor, previsao, sessoesAtivas } = opcoes ?? {};
    const e = ehObjeto(entrada) ? entrada : {};
    const l = ehObjeto(limites) ? limites : {};
    const p = ehObjeto(previsao) ? previsao : {};
    const ligado = cor === true;

    const saneado = sanear(ehObjeto(e.model) ? e.model.display_name : undefined, MAX_MODELO);
    const nome = (saneado ?? '').replace(GLIFOS_BARRA, ' ').replace(/ {2,}/g, ' ').trim() || SEM_VALOR;
    // A mesma lista que estado.js usa ao gravar a sessão (util.EFFORTS_VALIDOS).
    const effort = effortValido(e.effort);
    const partes = [effort ? `${nome}·${effort}` : nome];
    // Trecho de sessões ativas (spec v0.2.0 §12.4): só um inteiro de 2 até o
    // teto de estado.sessoes; com 1 (a própria) o trecho não aparece.
    const n = sessoesAtivas;
    if (Number.isInteger(n) && n >= 2 && n <= MAX_SESSOES_ATIVAS) partes.push(`${n} sessões`);

    // Cada janela passa de novo por janelaValida (util.js), o schema de
    // estado.js: quem chama já passa a saída de limitesValidos, e a checagem
    // só garante que nenhum outro chamador faça a barra mostrar NaN ou uma
    // hora inválida. O nome do modelo perde os glifos da barra (GLIFOS_BARRA).
    const f5 = janelaValida(l.five_hour);
    if (f5) {
      const u = f5.used_percentage;
      const quando = estouro(p.five_hour, f5.resets_at, agoraMs);
      const alerta = quando === null ? '' : ` ${pinta(`→100% ${horaLocal(quando / 1000)}`, 'vermelho', ligado)}`;
      partes.push(pinta(indicador('5h', u, `${pct(u)} ↻${horaLocal(f5.resets_at)}`), COR_5H[faixa5h(u)], ligado) + alerta);
    } else {
      partes.push(`5h ${SEM_VALOR}`);
    }

    // 7d: a marca da barrinha é o esperado do ritmo linear (faixa7d); a
    // janela de 5 h não tem ritmo e fica sem marca.
    const f7 = janelaValida(l.seven_day);
    if (f7 && numeroFinito(agoraMs)) {
      const u = f7.used_percentage;
      const { faixa, esperado } = faixa7d({ usado: u, resetsAt: f7.resets_at, agoraMs });
      const quando = estouro(p.seven_day, f7.resets_at, agoraMs);
      const alerta = quando === null ? '' : ` ${pinta(`→100% ${diaHora(quando / 1000)}`, 'vermelho', ligado)}`;
      partes.push(pinta(indicador('7d', u, `${pct(u)}/${pct(esperado)}${ROTULO_7D[faixa]} ↻${diaHora(f7.resets_at)}`, esperado), COR_7D[faixa], ligado) + alerta);
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
