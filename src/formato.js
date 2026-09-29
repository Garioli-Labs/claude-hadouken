import { barrinha } from './barrinha.js';
import { effortValido, GLIFOS_BARRA, numeroFinito, sanear } from './util.js';

// Linha da barra de status. Desde a E6 (emenda 2026-09-29 da spec do
// guardião) ela fica só com o que é desta sessão: modelo·effort, ctx e cache.
// 5h, 7d, a previsão e "N sessões" foram para o painel do VS Code; o 5h e o
// 7d continuam gravados em estado.json pela statusline (atualizarEstado).
// Todo dado externo passa por aqui antes do terminal (spec 8.1, S2/S3): o nome
// do modelo passa por `sanear`; o effort vem de lista fixa; o resto são
// números validados, barrinhas (barrinha.js) e rótulos do código. As únicas
// sequências ANSI da saída são as quatro cores abaixo, e só com `cor === true`.

const COR = { verde: '\x1b[32m', amarelo: '\x1b[33m', vermelho: '\x1b[31m', fim: '\x1b[0m' };
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

// As partes da linha, na ordem (E6). Só documenta: formatarBarra não a lê.
export const PARTES_BARRA = Object.freeze(['modelo', 'ctx', 'cache']);

// "rótulo barrinha resto" (spec v0.2.0 §5): a barrinha usa o valor antes do
// piso. Quem chama já validou o valor em [0, 100]; se mesmo assim barrinha
// devolver null, o trecho sai sem ela, como na v0.1.0.
function indicador(rotulo, valor, resto) {
  const b = barrinha(valor);
  return b === null ? `${rotulo} ${resto}` : `${rotulo} ${b} ${resto}`;
}

// Monta a linha "modelo·effort │ ctx │ cache" (E6), ctx e cache com a sua
// barrinha (spec v0.2.0 §5). `cor` liga as cores só se for exatamente true.
// As opções antigas `limites`, `agoraMs`, `previsao` e `sessoesAtivas` seguem
// aceitas, para não quebrar quem chama, mas nem são lidas. Campo ausente ou
// fora do schema vira "—". Nunca lança: uma falha interna devolve '' (spec
// 6.4, linha vazia).
export function formatarBarra(opcoes) {
  try {
    const { entrada, cor } = opcoes ?? {};
    const e = ehObjeto(entrada) ? entrada : {};
    const ligado = cor === true;

    // O nome do modelo perde os glifos da barra (GLIFOS_BARRA), para nunca
    // forjar um segmento, uma barrinha ou o effort.
    const saneado = sanear(ehObjeto(e.model) ? e.model.display_name : undefined, MAX_MODELO);
    const nome = (saneado ?? '').replace(GLIFOS_BARRA, ' ').replace(/ {2,}/g, ' ').trim() || SEM_VALOR;
    // A mesma lista que estado.js usa ao gravar a sessão (util.EFFORTS_VALIDOS).
    const effort = effortValido(e.effort);
    const partes = [effort ? `${nome}·${effort}` : nome];

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
