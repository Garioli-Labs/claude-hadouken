import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comandoAtualizar } from '../src/atualizacao/versao.js';

// A documentação longa mora em wiki/ (spec v0.5.3 VS Code, Task 13); os
// READMEs ficam curtos e apontam para ela. A wiki é publicada à mão por
// scripts/publicar-wiki.sh.

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = path.join(repo, 'wiki');
const URL_WIKI = 'https://github.com/Garioli-Labs/claude-hadouken/wiki/';
const ler = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const pares = JSON.parse(ler('wiki/pares.json'));
const paginas = fs.readdirSync(WIKI).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3));
const ESPECIAIS = ['_Sidebar'];

// Títulos fora de blocos de código.
function titulos(texto) {
  const r = [];
  let cerca = false;
  for (const linha of texto.split('\n')) {
    if (/^\s*(```|~~~)/.test(linha)) cerca = !cerca;
    else if (!cerca) {
      const m = linha.match(/^(#{1,6}) +(.+?) *#*$/);
      if (m) r.push(m[2]);
    }
  }
  return r;
}

// A âncora que o GitHub gera para um título, com o sufixo -N das repetidas.
function ancoras(texto) {
  const vistas = new Map();
  return titulos(texto).map((t) => {
    const base = t.replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
    const n = vistas.get(base) ?? 0;
    vistas.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}

const textoDe = (pagina) => fs.readFileSync(path.join(WIKI, `${pagina}.md`), 'utf8');

function conferirAlvo(pagina, ancora, origem) {
  assert.ok(paginas.includes(pagina), `${origem}: a página ${pagina} não existe em wiki/`);
  if (ancora) assert.ok(ancoras(textoDe(pagina)).includes(decodeURIComponent(ancora)), `${origem}: ${pagina}#${ancora} não existe`);
}

test('README: cada link para a wiki tem a página e a âncora', () => {
  for (const rel of ['README.md', 'README.en.md']) {
    const links = [...ler(rel).matchAll(/\]\((https:\/\/github\.com\/Garioli-Labs\/claude-hadouken\/wiki\/[^)\s]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length >= 10, `${rel}: poucos links para a wiki`);
    for (const url of links) {
      const [pagina, ancora] = url.slice(URL_WIKI.length).split('#');
      conferirAlvo(pagina, ancora, rel);
    }
  }
});

test('wiki: cada página tem a irmã na outra língua e está no mapa', () => {
  const noMapa = new Set([...Object.keys(pares), ...Object.values(pares)]);
  for (const [pt, en] of Object.entries(pares)) {
    assert.ok(paginas.includes(pt), `falta wiki/${pt}.md`);
    assert.ok(paginas.includes(en), `falta wiki/${en}.md`);
    assert.match(textoDe(pt), new RegExp(`\\[English\\]\\(${en}\\)`), `${pt} sem link para ${en}`);
    assert.match(textoDe(en), new RegExp(`\\[Português\\]\\(${pt}\\)`), `${en} sem link para ${pt}`);
  }
  for (const p of paginas) if (!ESPECIAIS.includes(p)) assert.ok(noMapa.has(p), `wiki/${p}.md fora de pares.json`);
});

test('wiki: os links entre páginas apontam para página e âncora que existem', () => {
  for (const p of paginas) {
    const texto = textoDe(p);
    const proprias = ancoras(texto);
    for (const m of texto.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      const alvo = m[1];
      if (/^(https?:|mailto:)/.test(alvo)) continue;
      if (alvo.startsWith('#')) {
        assert.ok(proprias.includes(decodeURIComponent(alvo.slice(1))), `${p}: âncora ${alvo} não existe`);
        continue;
      }
      const [pagina, ancora] = alvo.split('#');
      conferirAlvo(pagina, ancora, p);
    }
  }
});

test('README curto: aviso, os dois comandos de instalação, requisitos e licença', () => {
  const comandos = [comandoAtualizar('win32').texto, comandoAtualizar('linux').texto];
  for (const rel of ['README.md', 'README.en.md']) {
    const t = ler(rel);
    assert.ok(t.trimEnd().split('\n').length <= 60, `${rel} passou de 60 linhas`);
    assert.match(t, /> \[!IMPORTANT\]/);
    for (const c of comandos) assert.ok(t.includes(c), `${rel} sem ${c}`);
    assert.match(t, /Node 20/);
    assert.match(t, /2\.1\.251/);
    assert.match(t, /\[MIT\]\(LICENSE\)/);
  }
});

test('nenhuma seção do README antigo se perdeu: cada título está na wiki ou no README novo', () => {
  const secoes = JSON.parse(ler('test/fixtures/readme-secoes.json'));
  const norm = (t) => t.replace(/ \((opcional|optional)\)$/, '').trim();
  const lingua = { pt: [...Object.keys(pares), '_Sidebar'], en: Object.values(pares) };
  for (const [l, lista] of Object.entries(secoes)) {
    const existentes = new Set([
      ...lingua[l].flatMap((p) => titulos(textoDe(p))),
      ...titulos(ler(l === 'pt' ? 'README.md' : 'README.en.md')),
    ].map(norm));
    const faltam = lista.filter((t) => !existentes.has(norm(t)));
    assert.deepEqual(faltam, [], `títulos (${l}) que sumiram`);
  }
});

test('publicar-wiki.sh: pede a palavra, clona o .wiki.git e nunca roda sozinho', () => {
  const s = ler('scripts/publicar-wiki.sh');
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /set -euo pipefail/);
  assert.match(s, /publicar/);
  assert.match(s, /claude-hadouken\.wiki\.git/);
  assert.match(s, /docs: wiki da v/);
});
