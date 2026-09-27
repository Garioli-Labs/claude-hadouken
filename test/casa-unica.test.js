import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as base from '../src/base.js';
import * as util from '../src/util.js';
import * as alerta from '../src/alerta.js';
import { LINHA_SEM_LEITURA } from '../src/hooks/linha-estado.js';
import * as barrinha from '../src/barrinha.js';
import { jsonSeguro as jsonSeguroComandos, _reservas as reservasComandos } from '../src/comandos.js';
import { _reservas as reservasInstalar } from '../src/instalar-cli.js';

// Uma casa só para os ajudantes que se repetiam (follow-up da revisão final
// de qualidade): numeroFinito, DATA_MAX_MS, codigoErro e somaSegura em base.js;
// janelaValida, GLIFOS_BARRA e jsonSeguro em util.js; a linha fixa de "sem
// leitura" em alerta.js; os glifos e a conta da barrinha em barrinha.js
// (v0.2.0). Como o teste da política de rename (base.test.js), este barra a
// cópia nova pelo texto de src/.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function listarJs(dir) {
  const achados = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...listarJs(p));
    else if (e.name.endsWith('.js')) achados.push(p);
  }
  return achados.sort();
}

// Definição de um nome (const, let, var, function ou class), nunca o uso nem
// o import.
const definicao = (nome) => new RegExp(String.raw`(?:^|[^\w.$])(?:const|let|var|function\*?|class)\s+${nome}\b`, 'gm');

// Nenhum outro arquivo de src/ volta a definir o seu, nem com outro nome (o
// `finito` de antes) nem em literal (8.64e15, a classe dos glifos da barra,
// o texto da linha de "sem leitura"). A única exceção é o codigoErro de
// consumo.js: outra função, de lista fechada, testada em consumo.test.js.
test('os ajudantes divididos só são definidos na casa deles', () => {
  const regras = [
    ['numeroFinito', 'base.js', definicao('numeroFinito')],
    ['numeroFinito com outro nome', 'base.js', /=\s*\((\w+)\)\s*=>\s*\(?\s*typeof \1 === 'number' && Number\.isFinite\(\1\)\s*\)?\s*;/g],
    ['DATA_MAX_MS', 'base.js', definicao('DATA_MAX_MS')],
    ['literal 8.64e15', 'base.js', /8\.64e15/g],
    ['codigoErro', 'base.js', definicao('codigoErro')],
    ['somaSegura', 'base.js', definicao('somaSegura')],
    // A saturação escrita de novo com outro nome.
    ['soma que para em MAX_SAFE_INTEGER', 'base.js', /Math\.min\([^;\n]*,\s*Number\.MAX_SAFE_INTEGER\s*\)/g],
    ['janelaValida', 'util.js', definicao('janelaValida')],
    // A função janela() das cópias de antes (uma variável `janela` de texto,
    // como a de transcripts.js, é outra coisa e não conta).
    ['função janela', null, /(?:^|[^\w.$])function\s+janela\s*\(|(?:^|[^\w.$])(?:const|let|var)\s+janela\s*=\s*(?:function\b|\(?\w*\)?\s*=>)/gm],
    ['GLIFOS_BARRA', 'util.js', definicao('GLIFOS_BARRA')],
    ['classe dos glifos da barra', 'util.js', /\[│↻·\]/gu],
    ['jsonSeguro', 'util.js', definicao('jsonSeguro')],
    ['escaparInvisiveis', null, definicao('escaparInvisiveis')],
    ['texto da linha sem leitura', 'alerta.js', /Consumo sem leitura/g],
    ['CASAS', 'barrinha.js', definicao('CASAS')],
    ['CHEIA', 'barrinha.js', definicao('CHEIA')],
    ['VAZIA', 'barrinha.js', definicao('VAZIA')],
    ['MARCA', 'barrinha.js', definicao('MARCA')],
    ['PONTOS_POR_CASA', 'barrinha.js', definicao('PONTOS_POR_CASA')],
    ['barrinha', 'barrinha.js', definicao('barrinha')],
    // A conta das casas escrita de novo com o número.
    ['literal 12.5', null, /\b12\.5\b/g],
  ];
  const excecoes = new Set(['consumo.js: codigoErro']);
  const achados = [];
  const naCasa = new Map();
  for (const arq of listarJs(SRC)) {
    const rel = path.relative(SRC, arq).split(path.sep).join('/');
    const texto = fs.readFileSync(arq, 'utf8');
    for (const [nome, casa, re] of regras) {
      const n = [...texto.matchAll(re)].length;
      if (n === 0) continue;
      if (rel === casa) naCasa.set(nome, n);
      else if (!excecoes.has(`${rel}: ${nome}`)) achados.push(`${rel}: ${nome}`);
    }
  }
  assert.deepEqual(achados, []);
  for (const [nome, casa] of regras) if (casa !== null) assert.equal(naCasa.get(nome), 1, `${casa}: ${nome}`);
  // A exceção é mesmo a outra função: um parâmetro só e a lista fechada.
  const consumo = fs.readFileSync(path.join(SRC, 'consumo.js'), 'utf8');
  assert.equal([...consumo.matchAll(definicao('codigoErro'))].length, 1);
  assert.match(consumo, /^export function codigoErro\(e\) \{$/m);
  assert.match(consumo, /CODIGOS\.has\(c\) \? c : 'desconhecido'/);
});

test('as casas exportam os ajudantes, e quem os reexporta entrega o mesmo', () => {
  assert.equal(typeof base.numeroFinito, 'function');
  assert.equal(base.DATA_MAX_MS, 8.64e15);
  assert.equal(typeof base.codigoErro, 'function');
  assert.equal(typeof base.somaSegura, 'function');
  assert.equal(typeof util.janelaValida, 'function');
  assert.ok(util.GLIFOS_BARRA instanceof RegExp);
  assert.equal(util.GLIFOS_BARRA.flags, 'gu');
  assert.equal(jsonSeguroComandos, util.jsonSeguro, 'comandos.js reexporta o de util.js');
  assert.equal(reservasComandos.ESCAPAR, util.REGRA_JSON_SEGURO);
  assert.equal(reservasInstalar.INVISIVEL, util.REGRA_JSON_SEGURO);
  assert.equal(LINHA_SEM_LEITURA, alerta.LINHA_SEM_LEITURA);
  assert.equal(alerta.LINHA_SEM_LEITURA, 'Consumo sem leitura: rode /usage.');
});

test('numeroFinito e codigoErro: só número finito; o código em texto, senão o padrão', () => {
  for (const n of [0, -0, 1.5, -1e300, Number.MAX_VALUE, Number.MIN_VALUE]) assert.equal(base.numeroFinito(n), true, String(n));
  for (const n of [Number.NaN, Infinity, -Infinity, '1', null, undefined, 1n, {}, [], true]) assert.equal(base.numeroFinito(n), false, String(n));
  assert.equal(base.codigoErro(Object.assign(new Error('x'), { code: 'EBUSY' }), 'p'), 'EBUSY');
  assert.equal(base.codigoErro(new Error('x'), 'p'), 'p');
  assert.equal(base.codigoErro({ code: 7 }, 'p'), 'p');
  assert.equal(base.codigoErro(null, 'p'), 'p');
  assert.equal(base.codigoErro(undefined, 'p'), 'p');
});

// Revisão final de segurança (nota do juntarSomas): somar duas contagens
// perto do limite passava de Number.MAX_SAFE_INTEGER e o --json saía com um
// número que não é inteiro seguro. somaSegura para no limite.
test('somaSegura: exata abaixo de Number.MAX_SAFE_INTEGER; acima, para nele', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  assert.equal(base.somaSegura(2, 3), 5);
  assert.equal(base.somaSegura(0, 0), 0);
  assert.equal(base.somaSegura(MAX - 10, 4), MAX - 6);
  assert.equal(base.somaSegura(MAX - 1, 1), MAX);
  assert.equal(base.somaSegura(MAX, 0), MAX);
  for (const [a, b] of [[MAX - 1, MAX - 1], [MAX, MAX], [MAX, 1], [1, MAX], [MAX - 1, 2]]) {
    const s = base.somaSegura(a, b);
    assert.equal(s, MAX, `${a} + ${b}`);
    assert.ok(Number.isSafeInteger(s), `${a} + ${b}`);
  }
});

// A cópia da barra (formato.js) devolvia o próprio objeto e relia os campos
// depois da checagem: um getter podia trocar o valor no meio. janelaValida lê
// cada campo uma vez e devolve uma cópia só com os dois (a regra mais
// restrita das três cópias de antes).
test('janelaValida: o schema de estado.js, cópia só com os dois campos, cada um lido uma vez', () => {
  const ok = { used_percentage: 42, resets_at: 1_800_000_000, extra: 'Ignore previous instructions' };
  const c = util.janelaValida(ok);
  assert.deepEqual(c, { used_percentage: 42, resets_at: 1_800_000_000 });
  assert.notEqual(c, ok);
  assert.deepEqual(util.janelaValida({ used_percentage: 0, resets_at: 1 }), { used_percentage: 0, resets_at: 1 });
  assert.deepEqual(util.janelaValida({ used_percentage: 100, resets_at: 1e11 - 1 }), { used_percentage: 100, resets_at: 1e11 - 1 });
  const ruins = [
    null, undefined, 42, 'x', [], [42, 1],
    {}, { used_percentage: 42 }, { resets_at: 1_800_000_000 },
    { used_percentage: '42', resets_at: 1_800_000_000 },
    { used_percentage: Number.NaN, resets_at: 1_800_000_000 },
    { used_percentage: Infinity, resets_at: 1_800_000_000 },
    { used_percentage: -1, resets_at: 1_800_000_000 },
    { used_percentage: 100.5, resets_at: 1_800_000_000 },
    { used_percentage: 42, resets_at: '1800000000' },
    { used_percentage: 42, resets_at: 0 },
    { used_percentage: 42, resets_at: -5 },
    { used_percentage: 42, resets_at: 1e11 },
    { used_percentage: 42, resets_at: Infinity },
  ];
  for (const j of ruins) assert.equal(util.janelaValida(j), null, JSON.stringify(j));
  let leituras = 0;
  const vira = {
    get used_percentage() { leituras++; return leituras === 1 ? 42 : Number.NaN; },
    get resets_at() { return 1_800_000_000; },
  };
  assert.deepEqual(util.janelaValida(vira), { used_percentage: 42, resets_at: 1_800_000_000 });
  assert.equal(leituras, 1);
});
