import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec v0.5.3 VS Code §4 (Task 10): os arquivos da janela lidos como texto.
// O comportamento com o `vscode` falso fica em extensao.test.js.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(repo, 'vscode', 'janela');
const ler = (n) => fs.readFileSync(path.join(pasta, n), 'utf8');
const HTML = ler('index.html');
const CSS = ler('janela.css');
const JS = ler('janela.js');

// Regras do CSS como [seletor, corpo], sem comentários; @media entra inteira.
function regras(css) {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

// Luminância relativa e razão de contraste (WCAG 2.2, 1.4.3).
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('index.html: CSP com os marcadores, nada da internet', () => {
  assert.match(HTML, /<meta http-equiv="Content-Security-Policy" content="\{\{csp\}\}">/);
  assert.match(HTML, /<script nonce="\{\{nonce\}\}" src="\{\{js\}\}"><\/script>/);
  assert.doesNotMatch(HTML, /https?:\/\//);
  assert.doesNotMatch(HTML, /<script>|style=/);
  assert.match(HTML, /role="tablist"/);
  assert.match(HTML, /aria-live="polite"/);
});

test('janela.js: nada entra como HTML, nada de eval', () => {
  for (const proibido of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /new Function/, /document\.write/]) {
    assert.doesNotMatch(JS, proibido, String(proibido));
  }
  assert.doesNotMatch(JS, /https?:\/\//);
  for (const tipo of ['pronto', 'salvar', 'voltarPadrao', 'desfazer', 'atualizarUso', 'atualizarHadouken', 'ligarAprendizado', 'desligarAprendizado']) {
    assert.match(JS, new RegExp(`tipo: '${tipo}'|'${tipo}'`), tipo);
  }
  assert.match(JS, /prefers-reduced-motion: reduce/);
  assert.match(JS, /addEventListener\('blur'/);
  assert.match(JS, /role: 'switch'/);
  assert.match(JS, /'Home'/);
  assert.match(JS, /'End'/);
});

test('janela.css: movimento reduzido zera animações e transições; alto contraste usa --vscode-*', () => {
  const reduzido = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(reduzido, 'sem o bloco de movimento reduzido');
  assert.match(reduzido[1], /animation: none !important/);
  assert.match(reduzido[1], /transition: none !important/);
  for (const classe of ['vscode-high-contrast', 'vscode-high-contrast-light']) {
    const r = regras(CSS).find(([sel]) => sel.split(',').map((s) => s.trim()).includes(`body.${classe}`));
    assert.ok(r, classe);
    assert.match(r[1], /var\(--vscode-/, classe);
  }
});

test('contraste: texto e destaque com 4,5:1 ou mais sobre o fundo; #2563EB nunca em color', () => {
  assert.ok(contraste('#E6F7FF', '#111A2E') >= 4.5);
  assert.ok(contraste('#38BDF8', '#111A2E') >= 4.5);
  // Os tokens do :root são estes.
  for (const [nome, valor] of [['--fundo', '#111A2E'], ['--texto', '#E6F7FF'], ['--destaque', '#38BDF8'], ['--feixe-de', '#2563EB']]) {
    assert.match(CSS, new RegExp(`${nome}: ${valor};`), nome);
  }
  for (const [sel, corpo] of regras(CSS)) {
    for (const decl of corpo.split(';')) {
      const [prop, ...resto] = decl.split(':');
      if (prop.trim() !== 'color') continue;
      assert.doesNotMatch(resto.join(':'), /#2563EB|--feixe-de/i, sel);
    }
  }
});

test('estilo 8 bits: fonte pixel só em títulos, botões, abas e números; keyframes só com steps()', () => {
  for (const [sel, corpo] of regras(CSS)) {
    if (!/Pixel/.test(corpo) || sel.startsWith('@font-face')) continue;
    const seletores = sel.split(',').map((s) => s.trim());
    for (const s of seletores) assert.ok(['h1', 'h2', 'button', '[role=tab]', '.numero-grande'].includes(s), s);
  }
  assert.match(CSS, /url\('pixel\.woff2'\) format\('woff2'\)/);
  const animacoes = [...CSS.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(animacoes.length >= 2);
  for (const a of animacoes) assert.ok(a.startsWith('none') || /steps\(\d\)/.test(a), a);
  for (const nome of ['disparo', 'acende']) {
    const uso = animacoes.find((a) => a.startsWith(`${nome} `));
    assert.ok(uso, nome);
    assert.ok(Number(/(\d+)ms/.exec(uso)[1]) <= 600, uso);
  }
  assert.match(CSS, /\.bola \{[^}]*image-rendering: pixelated/);
  assert.match(CSS, /outline: 2px solid var\(--destaque\); outline-offset: 2px/);
  assert.match(CSS, /opacity: 0\.0[0-6];/);
  assert.match(CSS, /repeating-linear-gradient\(90deg, var\(--feixe-de\) 0 6px, transparent 6px 8px\)/);
});

test('pixel.woff2 (Press Start 2P) e OFL.txt na pasta da janela', () => {
  const fonte = fs.readFileSync(path.join(pasta, 'pixel.woff2'));
  assert.equal(fonte.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(ler('OFL.txt'), /SIL Open Font License, Version 1\.1/);
  assert.match(ler('OFL.txt'), /Press Start 2P/);
  assert.match(ler('bola.svg'), /^<svg [^>]*shape-rendering="crispEdges"/);
});

test('v0.5.5 Task 13: seção "PC agora" com status anunciado, botão fixo, aba Saúde e textos só por textContent', () => {
  assert.match(HTML, /<section id="secao-pc" aria-labelledby="t-pc" hidden><h2 id="t-pc">PC agora /);
  assert.match(HTML, /<p id="pc-modo" role="status" aria-live="polite"><\/p>/);
  assert.match(HTML, /<button id="pc-botao-leve" type="button" aria-describedby="pc-dica-leve" hidden><\/button>/);
  assert.match(HTML, /quem fecha é você/);
  // A seção vem depois do Uso e antes da Configuração.
  assert.ok(HTML.indexOf('id="t-uso"') < HTML.indexOf('id="t-pc"') && HTML.indexOf('id="t-pc"') < HTML.indexOf('id="t-config"'));
  assert.match(JS, /\['saude', 'Saúde'\]/);
  assert.match(JS, /tipo: acaoLeve === 'ligar' \? 'ligarLeve' : 'desligarLeve'/);
  assert.match(JS, /montarSaude\(m\.saude\)/);
  // A urgência também vai em texto, não só na cor.
  assert.match(JS, /urgente: ' · acima do limite'/);
  for (const classe of ['.pill', '.sugestao']) assert.ok(regras(CSS).some(([sel]) => sel === classe), classe);
});

test('Emenda 3 §12.2: aba Proteções com a consequência de cada interruptor', async () => {
  const { PROTECOES } = await import('../src/guarda/protecoes.js');
  assert.match(JS, /\['protecoes', 'Proteções'\]/);
  for (const id of PROTECOES) assert.match(JS, new RegExp(`'${id.replace('.', '\\.')}': 'Desligado: `));
  assert.match(JS, /consequencia-\$\{i\.id\}/);
});
