import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustar, desfazer, aprovar, recusar } from '../src/aprendizado/ajustar.js';
import { aprendizadoVazio, agregarRegistros, inicioSemana, LIMIARES } from '../src/aprendizado/agregar.js';
import { ajustesVazios, sugestoesVazias } from '../src/aprendizado/registro.js';
import { ITENS, valorDoItem } from '../src/aprendizado/arquivos.js';
import { textoSubirAgente } from '../src/aprendizado/mensagens.js';

// Decisor do aprendizado (spec aprendizado §4 e §8): puro, relógio por
// parâmetro. O teste de propriedade prova que nenhum ajuste automático
// afrouxa a guarda e que todo ajuste de conforto fica nos limites de §4.3.

const H = 3_600_000;
const D = 24 * H;
const M = 60_000;
const AGORA = new Date(2026, 9, 20, 15, 0).getTime(); // terça-feira, 15h local
const CONFIG = Object.freeze({ teto7d: 85, fableTetoPct: 90 });
const iso = (ms) => new Date(ms).toISOString();
const janela = (reset, max, extra = {}) => ({ reset, max, cruzou: {}, esgotou: null, disparou: false, ...extra });

// 10 dias de dados, 25 sessões, ativo às terças 10h (fora dela o intervalo sobe).
function apMaduro() {
  const ap = aprendizadoVazio(AGORA - 10 * D);
  ap.sessoes = 25;
  agregarRegistros(ap, [{ t: 'ativo', em: new Date(2026, 9, 20, 10).getTime(), segundos: 600 }]);
  return ap;
}
const rodar = (ap, aj, sug, agoraMs, config = CONFIG) => ajustar({ ap, aj, sug, config, agoraMs });

test('piso de §4.2: sem 7 dias ou sem 20 sessões nada muda, mas o perfil é atualizado', () => {
  const ap = apMaduro();
  ap.desde = AGORA - 6 * D;
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(r.novos, { ajustes: [], sugestoes: [] });
  assert.equal(r.aj.perfil.horasAtivas[1], 1 << 10);
  ap.desde = AGORA - 7 * D;
  ap.sessoes = 19;
  r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.novos.ajustes.length, 0);
  ap.sessoes = 20;
  r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(
    r.novos.ajustes.map((x) => [x.id, x.item, x.antes, x.depois, x.motivo, x.origem, x.em]),
    [['a1', 'painel.intervaloS', 30, 60, 'fora-do-horario', 'auto', iso(AGORA)]],
  );
});

test('um ajuste por item a cada 24 h, com passo de dobro até o alvo de 120 s', () => {
  const ap = apMaduro();
  const sug = sugestoesVazias();
  let r = rodar(ap, ajustesVazios(), sug, AGORA);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 60);
  r = rodar(ap, r.aj, sug, AGORA + 23 * H);
  assert.equal(r.novos.ajustes.length, 0);
  r = rodar(ap, r.aj, sug, AGORA + 24 * H);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 120);
  r = rodar(ap, r.aj, sug, AGORA + 48 * H);
  assert.equal(r.novos.ajustes.length, 0);
});

test('desfazer volta ao anterior, grava origem desfeito e bloqueia o item por 7 dias', () => {
  const ap = apMaduro();
  const sug = sugestoesVazias();
  const { aj } = rodar(ap, ajustesVazios(), sug, AGORA);
  const d = desfazer(aj, null, AGORA + H);
  assert.equal(d.ok, true);
  assert.deepEqual(
    [d.registro.id, d.registro.item, d.registro.antes, d.registro.depois, d.registro.motivo, d.registro.origem],
    ['a2', 'painel.intervaloS', 60, 30, 'desfazer', 'desfeito'],
  );
  assert.equal(d.aj.vigentes['painel.intervaloS'], 30);
  assert.equal(d.aj.bloqueios['painel.intervaloS'], AGORA + H + 7 * D);
  assert.deepEqual(desfazer(d.aj, null, AGORA + 2 * H), { ok: false, motivo: 'nada' });
  let r = rodar(ap, d.aj, sug, AGORA + 6 * D);
  assert.equal(r.novos.ajustes.length, 0);
  r = rodar(ap, r.aj, sug, AGORA + H + 7 * D);
  assert.equal(r.aj.vigentes['painel.intervaloS'], 60);
  assert.deepEqual(desfazer(r.aj, 'a1', AGORA + 8 * D), { ok: false, motivo: 'nao-e-o-ultimo' });
  assert.deepEqual(desfazer(r.aj, 'a99', AGORA + 8 * D), { ok: false, motivo: 'nao-achou' });
  assert.deepEqual(desfazer(ajustesVazios(), null, AGORA), { ok: false, motivo: 'nada' });
});

test('faixas de §4.3: amarelo e vermelho vão ao limiar com antecedência mediana suficiente; sem limiar possível, ajuste-fora', () => {
  const ap = apMaduro();
  const antecedencia = { 60: 120, 65: 90, 70: 50, 75: 30, 80: 20, 85: 16, 90: 10, 95: 5 };
  for (let i = 5; i >= 1; i--) {
    const reset = AGORA - i * 5 * H;
    const esg = reset - H;
    const cruzou = Object.fromEntries(Object.entries(antecedencia).map(([T, min]) => [T, esg - min * M]));
    ap.janelas.h5.push(janela(reset, 100, { esgotou: esg, cruzou }));
  }
  const r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.aj.vigentes['painel.amarelo'], 70);
  assert.equal(r.aj.vigentes['painel.vermelho'], 85);
  assert.ok(r.novos.ajustes.filter((x) => x.item.startsWith('painel.') && x.item !== 'painel.intervaloS').every((x) => x.motivo === 'faixa-historico'));

  const curto = apMaduro();
  for (let i = 5; i >= 1; i--) {
    const reset = AGORA - i * 5 * H;
    const esg = reset - H;
    curto.janelas.h5.push(janela(reset, 100, { esgotou: esg, cruzou: Object.fromEntries(LIMIARES.map((T) => [String(T), esg - 5 * M])) }));
  }
  const f = rodar(curto, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.deepEqual(f.fora.sort(), ['painel.amarelo', 'painel.vermelho']);
  assert.equal(f.aj.vigentes['painel.amarelo'], 75);
  assert.equal(f.aj.vigentes['painel.vermelho'], 90);
});

test('peso do perfil por hora: sobe 0,1 por dia com cobertura ≥ 80%, desce sem ela', () => {
  const ap = apMaduro();
  ap.ritmo.h5[10] = [3, 3];
  const sug = sugestoesVazias();
  let r = rodar(ap, ajustesVazios(), sug, AGORA);
  assert.equal(r.aj.vigentes['previsao.pesoPerfil'], 0.1);
  r = rodar(ap, r.aj, sug, AGORA + D);
  assert.equal(r.aj.vigentes['previsao.pesoPerfil'], 0.2);
  ap.ritmo.h5[10] = [0, 0];
  r = rodar(ap, r.aj, sug, AGORA + 2 * D);
  const reg = r.novos.ajustes.find((x) => x.item === 'previsao.pesoPerfil');
  assert.deepEqual([reg.antes, reg.depois, reg.motivo], [0.2, 0.1, 'perfil-insuficiente']);
});

test('guarda de §4.4: aperta −5 com 2 de 3 semanas esgotadas, uma vez por evidência; piso 70 dá ajuste-fora', () => {
  const ap = apMaduro();
  ap.janelas.d7 = [
    janela(AGORA - 15 * D, 100, { esgotou: AGORA - 16 * D }),
    janela(AGORA - 8 * D, 60),
    janela(AGORA - D, 100, { esgotou: AGORA - 2 * D }),
  ];
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  const reg = r.novos.ajustes.find((x) => x.item === 'guarda.teto7d');
  assert.deepEqual([reg.antes, reg.depois, reg.motivo, reg.origem], [null, 80, 'esgotou-2-de-3', 'auto']);
  r = rodar(ap, r.aj, r.sug, AGORA + 2 * D);
  assert.equal(r.aj.vigentes['guarda.teto7d'], 80);
  assert.equal(r.novos.ajustes.filter((x) => x.item === 'guarda.teto7d').length, 0);
  const p = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA, { ...CONFIG, teto7d: 72 });
  assert.equal(p.aj.vigentes['guarda.teto7d'], null);
  assert.ok(p.fora.includes('guarda.teto7d'));
});

test('guarda de §4.4: afrouxar é só sugestão, com 4 semanas de sobra depois do aperto; aprovar vai até o config.json', () => {
  const ap = apMaduro();
  const aj = ajustesVazios();
  aj.vigentes['guarda.teto7d'] = 80;
  aj.seq = 1;
  aj.registros.push({ id: 'a1', item: 'guarda.teto7d', antes: null, depois: 80, motivo: 'esgotou-2-de-3', em: iso(AGORA - 30 * D), origem: 'auto' });
  ap.janelas.d7 = [22, 15, 8, 1].map((n) => janela(AGORA - n * D, 50));
  let r = rodar(ap, aj, sugestoesVazias(), AGORA);
  assert.equal(r.aj.vigentes['guarda.teto7d'], 80);
  assert.deepEqual(
    r.novos.sugestoes.map((s) => [s.id, s.tipo, s.item, s.de, s.para, s.estado]),
    [['s1', 'afrouxar', 'guarda.teto7d', 80, 85, 'pendente']],
  );
  r = rodar(ap, r.aj, r.sug, AGORA + D);
  assert.equal(r.novos.sugestoes.length, 0);

  const comDisparo = structuredClone(ap);
  comDisparo.janelas.d7[3].disparou = true;
  assert.equal(rodar(comDisparo, structuredClone(aj), sugestoesVazias(), AGORA).novos.sugestoes.length, 0);

  const acima = aprovar(structuredClone(r.aj), structuredClone(r.sug), 's1', { ...CONFIG, teto7d: 90 }, AGORA + D);
  assert.equal(acima.aj.vigentes['guarda.teto7d'], 85);
  const a = aprovar(r.aj, r.sug, 's1', CONFIG, AGORA + D);
  assert.equal(a.ok, true);
  assert.equal(a.tipo, 'afrouxar');
  assert.deepEqual([a.registro.antes, a.registro.depois, a.registro.motivo, a.registro.origem], [80, null, 'sobra-4-semanas', 'aprovado']);
  assert.equal(a.aj.vigentes['guarda.teto7d'], null);
  assert.deepEqual(a.sug.lista, []);
  assert.deepEqual(aprovar(a.aj, a.sug, 's1', CONFIG, AGORA + D), { ok: false, motivo: 'nao-achou' });
});

test('sugestão de modelo de §4.5: mesma origem, 20 amostras, custo ≤ metade, erros até 2 pontos pior; nunca aplicada', () => {
  const ap = apMaduro();
  const s = ap.semanas[0];
  const linha = (pedidos, custo, erros, ferramentas, falhas) => [pedidos, custo, 0, 0, 0, 0, 0, 0, 0, erros, ferramentas, falhas];
  s.modelos['claude-opus-5-5|high|sub:revisor'] = linha(40, 40, 1, 10, 0);
  s.modelos['claude-sonnet-5-5|high|sub:revisor'] = linha(25, 7.5, 1, 10, 0);
  s.modelos['claude-haiku-5|-|sub:revisor'] = linha(19, 1, 0, 0, 0);
  s.modelos['claude-sonnet-5-5|high|principal'] = linha(30, 3, 0, 0, 0);
  const vigentesAntes = { ...ajustesVazios().vigentes };
  let r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.novos.sugestoes.length, 1);
  const x = r.novos.sugestoes[0];
  assert.deepEqual({ ...x, em: undefined }, {
    id: 's1', tipo: 'modelo', origem: 'sub:revisor', estado: 'pendente', em: undefined,
    de: { modelo: 'claude-opus-5-5', effort: 'high' }, para: { modelo: 'claude-sonnet-5-5', effort: 'high' },
    razao: 3.3, erroDe: 2.5, erroPara: 4,
  });
  assert.deepEqual({ ...r.aj.vigentes, 'painel.intervaloS': 30 }, vigentesAntes);
  r = rodar(ap, r.aj, r.sug, AGORA + D);
  assert.equal(r.novos.sugestoes.length, 0);

  const rec = recusar(r.sug, r.aj, 's1', AGORA + D);
  assert.equal(rec.ok, true);
  assert.equal(rec.aj.bloqueios['modelo:sub:revisor|claude-opus-5-5|high|claude-sonnet-5-5|high'], AGORA + 8 * D);
  assert.deepEqual(rec.sug.lista, []);
  r = rodar(ap, rec.aj, rec.sug, AGORA + 2 * D);
  assert.equal(r.novos.sugestoes.length, 0);
  r = rodar(ap, r.aj, r.sug, AGORA + 8 * D + 1);
  assert.equal(r.novos.sugestoes[0].id, 's2');

  const n = r.aj.registros.length;
  const ap2 = aprovar(r.aj, r.sug, 's2', CONFIG, AGORA + 8 * D + 2);
  assert.deepEqual([ap2.ok, ap2.tipo, ap2.sug.lista[0].estado, ap2.aj.registros.length], [true, 'modelo', 'aprovada', n]);
  r = rodar(ap, ap2.aj, ap2.sug, AGORA + 9 * D);
  assert.equal(r.novos.sugestoes.length, 0);
  assert.deepEqual(recusar(r.sug, r.aj, 's2', AGORA + 9 * D), { ok: false, motivo: 'nao-achou' });
});

// Estado com o vermelho subido (a1) e depois o amarelo (a2) até 85.
function faixasEmPe() {
  const aj = ajustesVazios();
  aj.seq = 2;
  aj.vigentes['painel.amarelo'] = 85;
  aj.vigentes['painel.vermelho'] = 90;
  aj.registros.push({ id: 'a1', item: 'painel.vermelho', antes: 85, depois: 90, motivo: 'faixa-historico', em: iso(AGORA - 2 * D), origem: 'auto' });
  aj.registros.push({ id: 'a2', item: 'painel.amarelo', antes: 80, depois: 85, motivo: 'faixa-historico', em: iso(AGORA - D), origem: 'auto' });
  return aj;
}

test('desfazer recusa com conflito, sem mudar nada, quando deixaria amarelo ≥ vermelho', () => {
  const aj = faixasEmPe();
  const copia = structuredClone(aj);
  assert.deepEqual(desfazer(aj, 'a1', AGORA), { ok: false, motivo: 'conflito' });
  assert.deepEqual(aj, copia);
  // Sem id, o alvo é o mais novo; se ele cruzaria as faixas, também recusa.
  const inv = ajustesVazios();
  inv.seq = 2;
  inv.vigentes['painel.amarelo'] = 85;
  inv.vigentes['painel.vermelho'] = 90;
  inv.registros.push({ id: 'a1', item: 'painel.amarelo', antes: 80, depois: 85, motivo: 'faixa-historico', em: iso(AGORA - 2 * D), origem: 'auto' });
  inv.registros.push({ id: 'a2', item: 'painel.vermelho', antes: 85, depois: 90, motivo: 'faixa-historico', em: iso(AGORA - D), origem: 'auto' });
  const copiaInv = structuredClone(inv);
  assert.deepEqual(desfazer(inv, null, AGORA), { ok: false, motivo: 'conflito' });
  assert.deepEqual(inv, copiaInv);
  // Desfazer o amarelo primeiro libera o vermelho.
  const d = desfazer(aj, 'a2', AGORA);
  assert.equal(d.ok, true);
  assert.equal(d.aj.vigentes['painel.amarelo'], 80);
  assert.equal(desfazer(d.aj, 'a1', AGORA).aj.vigentes['painel.vermelho'], 85);
});

// Três janelas de 7 dias, duas esgotadas: evidência de aperto em AGORA.
const comEvidencia = (ap) => {
  ap.janelas.d7 = [
    janela(AGORA - 15 * D, 100, { esgotou: AGORA - 16 * D }),
    janela(AGORA - 8 * D, 60),
    janela(AGORA - D, 100, { esgotou: AGORA - 2 * D }),
  ];
  return ap;
};

test('desfazer um aperto da guarda volta ao config.json, bloqueia 7 dias e a mesma evidência não aperta de novo', () => {
  const ap = comEvidencia(apMaduro());
  const { aj, sug } = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(aj.vigentes['guarda.teto7d'], 80);
  const d = desfazer(aj, null, AGORA + H);
  assert.equal(d.ok, true);
  assert.deepEqual(
    [d.registro.item, d.registro.antes, d.registro.depois, d.registro.motivo, d.registro.origem],
    ['guarda.teto7d', 80, null, 'desfazer', 'desfeito'],
  );
  assert.equal(d.aj.vigentes['guarda.teto7d'], null);
  assert.equal(d.aj.bloqueios['guarda.teto7d'], AGORA + H + 7 * D);
  let r = rodar(ap, d.aj, sug, AGORA + 2 * D);
  assert.equal(r.aj.vigentes['guarda.teto7d'], null);
  assert.ok(!r.fora.includes('guarda.teto7d'));
  r = rodar(ap, r.aj, r.sug, AGORA + 8 * D);
  assert.equal(r.aj.vigentes['guarda.teto7d'], null, 'a evidência anterior ao desfazer não conta de novo');
  ap.janelas.d7.push(janela(AGORA + 7 * D, 100, { esgotou: AGORA + 6 * D }));
  r = rodar(ap, r.aj, r.sug, AGORA + 8 * D);
  assert.equal(r.aj.vigentes['guarda.teto7d'], 80, 'evidência nova depois do desfazer aperta');
});

test('vigente acima do config.json: o aperto parte do config.json e o afrouxar não é sugerido', () => {
  const ap = comEvidencia(apMaduro());
  const aj = ajustesVazios();
  aj.vigentes['guarda.teto7d'] = 95;
  const r = rodar(ap, aj, sugestoesVazias(), AGORA);
  const reg = r.novos.ajustes.find((x) => x.item === 'guarda.teto7d');
  assert.deepEqual([reg.antes, reg.depois], [95, 80]);

  const sobra = apMaduro();
  sobra.janelas.d7 = [22, 15, 8, 1].map((n) => janela(AGORA - n * D, 50));
  const alto = ajustesVazios();
  alto.vigentes['guarda.teto7d'] = 90;
  const s = rodar(sobra, alto, sugestoesVazias(), AGORA);
  assert.equal(s.novos.sugestoes.length, 0);
  assert.equal(s.aj.vigentes['guarda.teto7d'], 90);
});

// Teto 7d apertado para 80 há 30 dias e 4 semanas de sobra depois disso.
function comSobra() {
  const ap = apMaduro();
  ap.janelas.d7 = [22, 15, 8, 1].map((n) => janela(AGORA - n * D, 50));
  const aj = ajustesVazios();
  aj.vigentes['guarda.teto7d'] = 80;
  aj.seq = 1;
  aj.registros.push({ id: 'a1', item: 'guarda.teto7d', antes: null, depois: 80, motivo: 'esgotou-2-de-3', em: iso(AGORA - 30 * D), origem: 'auto' });
  return { ap, aj };
}

test('recusar um afrouxar bloqueia a mesma sugestão por 7 dias', () => {
  const { ap, aj } = comSobra();
  let r = rodar(ap, aj, sugestoesVazias(), AGORA);
  assert.equal(r.novos.sugestoes[0].tipo, 'afrouxar');
  const rec = recusar(r.sug, r.aj, 's1', AGORA);
  assert.equal(rec.ok, true);
  assert.equal(rec.aj.bloqueios['afrouxar:guarda.teto7d'], AGORA + 7 * D);
  assert.deepEqual(rec.sug.lista, []);
  assert.equal(rec.aj.vigentes['guarda.teto7d'], 80);
  r = rodar(ap, rec.aj, rec.sug, AGORA + 6 * D);
  assert.equal(r.novos.sugestoes.length, 0);
  r = rodar(ap, r.aj, r.sug, AGORA + 7 * D);
  assert.deepEqual(r.novos.sugestoes.map((s) => [s.id, s.tipo, s.de, s.para]), [['s2', 'afrouxar', 80, 85]]);
});

test('aprovar um afrouxar cujo vigente mudou devolve mudou, tira a sugestão e não grava registro', () => {
  const { ap, aj } = comSobra();
  const r = rodar(ap, aj, sugestoesVazias(), AGORA);
  r.aj.vigentes['guarda.teto7d'] = 75;
  const n = r.aj.registros.length;
  const a = aprovar(r.aj, r.sug, 's1', CONFIG, AGORA + H);
  assert.deepEqual([a.ok, a.motivo], [false, 'mudou']);
  assert.deepEqual(a.sug.lista, []);
  assert.equal(a.aj.registros.length, n);
  assert.equal(a.aj.vigentes['guarda.teto7d'], 75);
});

test('afrouxar pendente obsoleto (de ≠ vigente) sai no ajustar, e o atual pode nascer no mesmo passo', () => {
  const { ap, aj } = comSobra();
  aj.vigentes['guarda.teto7d'] = 75;
  aj.registros[0].depois = 75;
  const sug = sugestoesVazias();
  sug.seq = 1;
  sug.lista.push({ id: 's1', tipo: 'afrouxar', item: 'guarda.teto7d', de: 80, para: 85, estado: 'pendente', em: iso(AGORA - 2 * D) });
  const r = rodar(ap, aj, sug, AGORA);
  assert.deepEqual(r.sug.lista.map((s) => [s.id, s.de, s.para]), [['s2', 75, 80]]);
  // Abaixo do piso também poda: é limpeza, não ajuste.
  const novo = apMaduro();
  novo.desde = AGORA - D;
  const sug2 = sugestoesVazias();
  sug2.lista.push({ id: 's1', tipo: 'afrouxar', item: 'guarda.fableTetoPct', de: 80, para: 85, estado: 'pendente', em: iso(AGORA - D) });
  assert.deepEqual(rodar(novo, ajustesVazios(), sug2, AGORA).sug.lista, []);
});

test('ajuste-fora só sai quando o item pode mudar (fora das 24 h e sem bloqueio)', () => {
  const curto = apMaduro();
  for (let i = 5; i >= 1; i--) {
    const reset = AGORA - i * 5 * H;
    const esg = reset - H;
    curto.janelas.h5.push(janela(reset, 100, { esgotou: esg, cruzou: Object.fromEntries(LIMIARES.map((T) => [String(T), esg - 5 * M])) }));
  }
  comEvidencia(curto);
  const aj = ajustesVazios();
  aj.seq = 1;
  aj.registros.push({ id: 'a1', item: 'painel.amarelo', antes: 75, depois: 75, motivo: 'faixa-historico', em: iso(AGORA - H), origem: 'auto' });
  aj.bloqueios['painel.vermelho'] = AGORA + D;
  aj.bloqueios['guarda.teto7d'] = AGORA + D;
  const r = rodar(curto, aj, sugestoesVazias(), AGORA, { ...CONFIG, teto7d: 72 });
  assert.deepEqual(r.fora, []);
  const livre = rodar(curto, ajustesVazios(), sugestoesVazias(), AGORA, { ...CONFIG, teto7d: 72 });
  assert.deepEqual(livre.fora.sort(), ['guarda.teto7d', 'painel.amarelo', 'painel.vermelho']);
});

test('erro e falha por pedido ficam em no máximo 100 na sugestão de modelo', () => {
  const ap = apMaduro();
  const s = ap.semanas[0];
  // Erros e falhas acima do total (dado incoerente): a taxa satura em 100.
  s.modelos['claude-opus-5-5|-|principal'] = [40, 40, 0, 0, 0, 0, 0, 0, 0, 60, 10, 20];
  s.modelos['claude-sonnet-5-5|-|principal'] = [25, 5, 0, 0, 0, 0, 0, 0, 0, 30, 10, 30];
  const r = rodar(ap, ajustesVazios(), sugestoesVazias(), AGORA);
  assert.equal(r.novos.sugestoes.length, 1);
  assert.deepEqual([r.novos.sugestoes[0].erroDe, r.novos.sugestoes[0].erroPara], [100, 100]);
});

// Gerador com semente fixa (mulberry32): o mesmo conjunto de casos em toda máquina.
function mulberry32(semente) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const escolher = (r, lista) => lista[Math.floor(r() * lista.length)];
const inteiro = (r, min, max) => min + Math.floor(r() * (max - min + 1));

function casoAleatorio(r) {
  const agoraMs = AGORA + inteiro(r, 0, 60) * D + inteiro(r, 0, 23) * H;
  const ap = aprendizadoVazio(agoraMs - inteiro(r, 0, 30) * D);
  ap.sessoes = inteiro(r, 0, 60);
  const semana = { inicio: inicioSemana(agoraMs), modelos: {}, ativo: Array.from({ length: 168 }, () => (r() < 0.2 ? inteiro(r, 0, 60) : 0)) };
  for (let i = 0; i < 4; i++) {
    semana.modelos[`m${i}|${escolher(r, ['high', 'max', '-'])}|${escolher(r, ['principal', 'sub:x'])}`] = [
      inteiro(r, 0, 60), r() * 50, 0, 0, 0, 0, 0, 0, 0, inteiro(r, 0, 5), inteiro(r, 0, 20), inteiro(r, 0, 5),
    ];
  }
  ap.semanas.push(semana);
  for (let h = 0; h < 24; h++) ap.ritmo.h5[h] = [r(), inteiro(r, 0, 5)];
  // Viés (revisão da Task 5): por tipo de janela, um modo calmo (nunca
  // esgota, máximo abaixo de 70, quase sem disparo: semanas de sobra) ou
  // esgotar com 5%, 50% ou 90%; na janela esgotada, cada limiar é cruzado
  // com uma antecedência que cresce para baixo. Sem isso, 2 de 3 janelas
  // esgotadas, 5 janelas de 5 h esgotadas e 4 semanas de sobra quase nunca
  // saem, e os ramos da guarda e das faixas ficam sem caso (ver os mínimos
  // no fim do teste de propriedade).
  for (const tipo of ['h5', 'd7', 'fable']) {
    const dur = tipo === 'h5' ? 5 * H : 7 * D;
    const pEsgota = escolher(r, [0, 0.05, 0.5, 0.9]);
    const escala = tipo === 'h5' ? inteiro(r, 1, 240) * M : inteiro(r, 1, 96) * H;
    for (let i = 8; i >= 0; i--) {
      const reset = agoraMs - i * dur + inteiro(r, 0, 59) * M;
      const esgota = r() < pEsgota;
      const max = esgota ? 100 : inteiro(r, 0, pEsgota === 0 ? 69 : 99);
      const esgotou = esgota ? reset - inteiro(r, 1, 300) * M : null;
      const fator = 0.5 + r();
      const cruzou = {};
      for (const T of LIMIARES) {
        if (max < T) continue;
        cruzou[String(T)] = esgota
          ? Math.max(reset - dur, esgotou - Math.round(escala * ((100 - T) / 40) * fator))
          : reset - dur + Math.floor(r() * dur * 0.9);
      }
      ap.janelas[tipo].push(janela(reset, max, { cruzou, esgotou, disparou: r() < (pEsgota === 0 ? 0.02 : 0.2) }));
    }
  }
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = escolher(r, [30, 45, 60, 120, 240, 300]);
  aj.vigentes['painel.amarelo'] = escolher(r, [60, 65, 70, 75, 80, 85]);
  aj.vigentes['painel.vermelho'] = escolher(r, [85, 90, 95]);
  if (aj.vigentes['painel.amarelo'] >= aj.vigentes['painel.vermelho']) aj.vigentes['painel.vermelho'] = 90;
  aj.vigentes['previsao.pesoPerfil'] = escolher(r, [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  for (const item of ['guarda.teto7d', 'guarda.fableTetoPct']) aj.vigentes[item] = r() < 0.5 ? null : inteiro(r, 70, 100);
  if (r() < 0.5) {
    const item = escolher(r, [...Object.keys(ITENS), 'painel.amarelo', 'painel.vermelho']);
    aj.seq = 1;
    // `antes` sorteado no domínio do item: desfazer a1 pode cruzar as faixas.
    const antesPossiveis = {
      'painel.intervaloS': [30, 60, 120], 'painel.amarelo': [60, 80, 85, 85], 'painel.vermelho': [85, 85, 90, 95],
      'previsao.pesoPerfil': [0, 0.3, 0.5], 'guarda.teto7d': [null, 75, 90], 'guarda.fableTetoPct': [null, 75, 90],
    };
    aj.registros.push({ id: 'a1', item, antes: escolher(r, antesPossiveis[item]), depois: aj.vigentes[item], motivo: 'faixa-historico', em: iso(agoraMs - inteiro(r, 0, 72) * H), origem: 'auto' });
  }
  if (r() < 0.3) aj.bloqueios[escolher(r, Object.keys(ITENS))] = agoraMs + inteiro(r, 1, 7 * 24) * H;
  const sug = sugestoesVazias();
  if (r() < 0.3) {
    const de = inteiro(r, 70, 95);
    sug.seq = 1;
    sug.lista.push({ id: 's1', tipo: 'afrouxar', item: escolher(r, ['guarda.teto7d', 'guarda.fableTetoPct']), de, para: de + 5, estado: 'pendente', em: iso(agoraMs - D) });
  }
  const config = { teto7d: inteiro(r, 50, 100), fableTetoPct: inteiro(r, 50, 100) };
  return { ap, aj, sug, config, agoraMs };
}

// Mesmo critério de ajustar.js: bloqueado, ou com registro há menos de 24 h.
const travado = (aj, item, agoraMs) =>
  (Object.hasOwn(aj.bloqueios, item) && aj.bloqueios[item] > agoraMs)
  || aj.registros.some((x) => x.item === item && agoraMs - Date.parse(x.em) < D);

const efetivo = (vig, cfg) => (vig === null ? cfg : Math.min(vig, cfg));

test('propriedade de §8 (1.000 casos): nunca aperto acima do config.json, nunca afrouxamento automático, conforto nos limites', (t) => {
  const r = mulberry32(20261020);
  const ramos = { apertoGuarda: 0, faixaHistorico: 0, foraGuarda: 0, foraFaixa: 0, afrouxar: 0, podadas: 0, conflito: 0 };
  for (let caso = 0; caso < 1000; caso++) {
    const { ap, aj, sug, config, agoraMs } = casoAleatorio(r);
    const antes = structuredClone(aj.vigentes);
    const travadosAntes = new Set(Object.keys(ITENS).filter((item) => travado(aj, item, agoraMs)));
    const pendentesAntes = sug.lista.length;
    const res = ajustar({ ap, aj, sug, config, agoraMs });
    for (const x of res.novos.ajustes) {
      if (ITENS[x.item].tipo === 'guarda') ramos.apertoGuarda += 1;
      if (x.motivo === 'faixa-historico') ramos.faixaHistorico += 1;
    }
    for (const item of res.fora) {
      if (ITENS[item].tipo === 'guarda') ramos.foraGuarda += 1;
      else ramos.foraFaixa += 1;
      assert.ok(!travadosAntes.has(item), `caso ${caso}: ajuste-fora de ${item} travado (24 h ou bloqueio)`);
    }
    assert.equal(new Set(res.fora).size, res.fora.length, `caso ${caso}: ajuste-fora repetido`);
    ramos.afrouxar += res.novos.sugestoes.filter((s) => s.tipo === 'afrouxar').length;
    if (pendentesAntes > 0 && !res.sug.lista.some((s) => s.id === 's1')) ramos.podadas += 1;
    for (const s of res.sug.lista) {
      if (s.tipo === 'afrouxar') assert.equal(s.de, res.aj.vigentes[s.item], `caso ${caso}: afrouxar pendente obsoleto`);
    }
    const itens = res.novos.ajustes.map((x) => x.item);
    assert.equal(new Set(itens).size, itens.length, `caso ${caso}: mais de um ajuste por item`);
    for (const x of res.novos.ajustes) {
      assert.equal(x.origem, 'auto', `caso ${caso}`);
      const d = ITENS[x.item];
      if (d.tipo === 'guarda') {
        const cfg = config[d.campo];
        assert.ok(Number.isInteger(x.depois) && x.depois >= 70 && x.depois <= cfg, `caso ${caso}: aperto ${x.depois} > ${cfg}`);
        assert.ok(x.depois < efetivo(x.antes, cfg), `caso ${caso}: ${x.item} afrouxou`);
      } else {
        assert.notEqual(valorDoItem(x.item, x.depois), undefined, `caso ${caso}: ${x.item}=${x.depois} fora dos limites`);
        if (x.item === 'painel.intervaloS') assert.ok(x.depois <= x.antes * 2 && x.depois >= Math.ceil(x.antes / 2), `caso ${caso}`);
        else if (x.item === 'previsao.pesoPerfil') assert.ok(Math.abs(x.depois - x.antes) <= 0.1 + 1e-9, `caso ${caso}`);
        else assert.ok(Math.abs(x.depois - x.antes) <= 5, `caso ${caso}`);
      }
    }
    for (const item of ['guarda.teto7d', 'guarda.fableTetoPct']) {
      const cfg = config[ITENS[item].campo];
      assert.ok(efetivo(res.aj.vigentes[item], cfg) <= efetivo(antes[item], cfg), `caso ${caso}: ${item} afrouxou`);
    }
    for (const item of ['painel.intervaloS', 'painel.amarelo', 'painel.vermelho', 'previsao.pesoPerfil']) {
      assert.notEqual(valorDoItem(item, res.aj.vigentes[item]), undefined, `caso ${caso}: ${item}`);
    }
    assert.ok(res.aj.vigentes['painel.amarelo'] < res.aj.vigentes['painel.vermelho'], `caso ${caso}: amarelo >= vermelho`);
    for (const s of res.novos.sugestoes) {
      if (s.tipo !== 'afrouxar') continue;
      assert.equal(s.de, res.aj.vigentes[s.item], `caso ${caso}`);
      assert.ok(s.para <= config[ITENS[s.item].campo] && s.para > s.de, `caso ${caso}: sugestão acima do config.json`);
    }
    // Desfazer (o mais novo ou cada registro) nunca deixa amarelo >=
    // vermelho: ou desfaz, ou recusa com 'conflito' sem mexer em nada.
    for (const id of [null, ...res.aj.registros.map((x) => x.id)]) {
      const copia = structuredClone(res.aj);
      const d = desfazer(copia, id, agoraMs + H);
      if (d.ok) assert.ok(d.aj.vigentes['painel.amarelo'] < d.aj.vigentes['painel.vermelho'], `caso ${caso}: desfazer ${id} cruzou as faixas`);
      else if (d.motivo === 'conflito') {
        ramos.conflito += 1;
        assert.deepEqual(copia, res.aj, `caso ${caso}: conflito em ${id} mudou o estado`);
      }
    }
  }
  // Os ramos que importam precisam de caso de verdade, senão as asserções
  // acima ficam vácuas (revisão da Task 5).
  t.diagnostic(`ramos: ${JSON.stringify(ramos)}`);
  for (const ramo of ['apertoGuarda', 'faixaHistorico', 'foraGuarda', 'foraFaixa', 'afrouxar', 'podadas', 'conflito']) {
    assert.ok(ramos[ramo] >= 20, `ramo ${ramo} com só ${ramos[ramo]} casos: ${JSON.stringify(ramos)}`);
  }
});

// Task 13 da v0.5.3 (spec roteamento §8): subir um agente do plugin com
// retrabalho ≥ 20% em ≥ 10 despachos na semana. Só sugestão; o decisor não
// grava nada e nunca muda um vigente por causa dela.
const linhaRot = (extra = {}) => ({ agente: 'hadouken:mecanico', familia: 'haiku', despachos: 12, negados: 0, avisados: 0, retrabalhoPct: 25, ...extra });
const rot = (...linhas) => ({ porAgente: linhas, porRegra: { N1: 0, N2: 0, A1: 0, A2: 0, A3: 0 }, custoEvitado: null });
const subidas = (r) => r.novos.sugestoes.filter((x) => x.tipo === 'subir-agente');

test('subir agente: 25% em 12 despachos sugere; 8 despachos ou 15% não; agente fora da lista nem família errada', () => {
  const comRot = (roteamento, sug = sugestoesVazias()) => ajustar({ ap: apMaduro(), aj: ajustesVazios(), sug, config: CONFIG, agoraMs: AGORA, roteamento });
  const r = comRot(rot(linhaRot()));
  assert.deepEqual(subidas(r).map(({ id, em, ...x }) => x), [{ tipo: 'subir-agente', agente: 'hadouken:mecanico', de: 'haiku', para: 'sonnet', retrabalhoPct: 25, estado: 'pendente' }]);
  assert.equal(textoSubirAgente(subidas(r)[0]), 'hadouken:mecanico teve 25% de retrabalho em 7 dias; subir para Sonnet?');
  assert.deepEqual(r.aj.vigentes, comRot(rot()).aj.vigentes, 'nenhum vigente muda por causa dela');
  assert.deepEqual(subidas(comRot(rot(linhaRot({ despachos: 8 })))), []);
  assert.deepEqual(subidas(comRot(rot(linhaRot({ retrabalhoPct: 15 })))), []);
  assert.deepEqual(subidas(comRot(rot(linhaRot({ retrabalhoPct: 20, despachos: 10 })))).length, 1);
  assert.deepEqual(subidas(comRot(rot(linhaRot({ agente: 'Explore' })))), []);
  assert.deepEqual(subidas(comRot(rot(linhaRot({ familia: 'sonnet' })))), []);
  assert.deepEqual(subidas(comRot(undefined)), []);
  // Pendente não repete; recusada fica bloqueada 7 dias.
  const sug = r.sug;
  assert.deepEqual(subidas(comRot(rot(linhaRot()), sug)), []);
  const rec = recusar(sug, r.aj, subidas(r)[0].id, AGORA);
  const depois = ajustar({ ap: apMaduro(), aj: rec.aj, sug: rec.sug, config: CONFIG, agoraMs: AGORA + D, roteamento: rot(linhaRot()) });
  assert.deepEqual(subidas(depois), []);
});

test('aprovar subir agente só a marca e devolve o que gravar; o decisor não grava', () => {
  const r = ajustar({ ap: apMaduro(), aj: ajustesVazios(), sug: sugestoesVazias(), config: CONFIG, agoraMs: AGORA, roteamento: rot(linhaRot()) });
  const s = subidas(r)[0];
  const a = aprovar(r.aj, r.sug, s.id, CONFIG, AGORA);
  assert.equal(a.ok, true);
  assert.equal(a.tipo, 'subir-agente');
  assert.deepEqual([a.sugestao.agente, a.sugestao.para], ['hadouken:mecanico', 'sonnet']);
  assert.deepEqual(a.sug.lista.filter((x) => x.tipo === 'subir-agente'), []);
});
