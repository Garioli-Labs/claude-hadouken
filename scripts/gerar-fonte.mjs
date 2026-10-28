// Gera vscode/icones/hadouken.woff a partir de vscode/icones/svg (spec v0.5.3
// VS Code §4.5), sem dependências. Ferramenta só de desenvolvimento: a
// instalação nunca a roda, usa o .woff commitado. Os SVGs são pixel art de
// 16x16 feita só de <rect> inteiros, então cada retângulo vira um contorno de
// 4 pontos numa fonte TrueType (1 px = 64 unidades, em de 1024), embrulhada em
// WOFF 1.0 com zlib. Os caracteres saem de scripts/fonte.json (U+E001 a
// U+E009, na ordem de contributes.icons em vscode/package.json). A saída é
// determinística: sem data nem nada que dependa do relógio.
// Uso, da raiz do repositório: node scripts/gerar-fonte.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_SVG = path.join(raiz, 'vscode', 'icones', 'svg');
const SAIDA = path.join(raiz, 'vscode', 'icones', 'hadouken.woff');
const { codepoints } = JSON.parse(fs.readFileSync(path.join(raiz, 'scripts', 'fonte.json'), 'utf8'));
const UPM = 1024;
const PX = 64;
const NOME = 'hadouken';

// Retângulos [x, y, w, h] de um SVG, em pixels.
function retangulos(nome) {
  const t = fs.readFileSync(path.join(PASTA_SVG, `${nome}.svg`), 'utf8');
  const r = [...t.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)].map((m) => m.slice(1, 5).map(Number));
  if (r.length === 0) throw new Error(`${nome}.svg sem <rect>`);
  return r;
}

// Glifo simples: um contorno horário por retângulo (y da fonte sobe).
function glifo(rects) {
  const pontos = [];
  const fins = [];
  for (const [x, y, w, h] of rects) {
    const x0 = x * PX;
    const x1 = (x + w) * PX;
    const yTopo = (16 - y) * PX;
    const yBase = (16 - y - h) * PX;
    pontos.push([x0, yBase], [x0, yTopo], [x1, yTopo], [x1, yBase]);
    fins.push(pontos.length - 1);
  }
  const xs = pontos.map((p) => p[0]);
  const ys = pontos.map((p) => p[1]);
  const caixa = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const b = Buffer.alloc(10 + 2 * fins.length + 2 + pontos.length + 4 * pontos.length);
  let o = 0;
  b.writeInt16BE(fins.length, o); o += 2;
  for (const v of caixa) { b.writeInt16BE(v, o); o += 2; }
  for (const f of fins) { b.writeUInt16BE(f, o); o += 2; }
  b.writeUInt16BE(0, o); o += 2;
  for (let i = 0; i < pontos.length; i++) b[o++] = 0x01;
  let ant = 0;
  for (const [x] of pontos) { b.writeInt16BE(x - ant, o); o += 2; ant = x; }
  ant = 0;
  for (const [, y] of pontos) { b.writeInt16BE(y - ant, o); o += 2; ant = y; }
  return { dados: b, caixa, pontos: pontos.length, contornos: fins.length };
}

const pad4 = (b) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));
function somaVerificacao(b) {
  const p = pad4(b);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s;
}

const nomes = Object.keys(codepoints);
const cps = nomes.map((n) => codepoints[n]);
for (let i = 1; i < cps.length; i++) if (cps[i] !== cps[0] + i) throw new Error('codepoints precisam ser contíguos');
const glifos = [{ dados: Buffer.alloc(0), caixa: [0, 0, 0, 0], pontos: 0, contornos: 0 }, ...nomes.map((n) => glifo(retangulos(n)))];
const n = glifos.length;

// glyf e loca (formato longo).
const partes = [];
const loca = Buffer.alloc(4 * (n + 1));
let pos = 0;
glifos.forEach((g, i) => {
  loca.writeUInt32BE(pos, 4 * i);
  const d = pad4(g.dados);
  partes.push(d);
  pos += d.length;
});
loca.writeUInt32BE(pos, 4 * n);
const glyf = Buffer.concat(partes);
const comCaixa = glifos.slice(1);
const caixaFonte = [
  Math.min(...comCaixa.map((g) => g.caixa[0])), Math.min(...comCaixa.map((g) => g.caixa[1])),
  Math.max(...comCaixa.map((g) => g.caixa[2])), Math.max(...comCaixa.map((g) => g.caixa[3])),
];

const head = Buffer.alloc(54);
head.writeUInt32BE(0x00010000, 0);
head.writeUInt32BE(0x00010000, 4);
head.writeUInt32BE(0, 8); // checkSumAdjustment, preenchido no fim
head.writeUInt32BE(0x5f0f3cf5, 12);
head.writeUInt16BE(0x000b, 16);
head.writeUInt16BE(UPM, 18);
// created e modified: zero (bytes 20 a 35).
caixaFonte.forEach((v, i) => head.writeInt16BE(v, 36 + 2 * i));
head.writeUInt16BE(0, 44);
head.writeUInt16BE(8, 46);
head.writeInt16BE(2, 48);
head.writeInt16BE(1, 50);
head.writeInt16BE(0, 52);

const hhea = Buffer.alloc(36);
hhea.writeUInt32BE(0x00010000, 0);
hhea.writeInt16BE(UPM, 4);
hhea.writeInt16BE(0, 6);
hhea.writeInt16BE(0, 8);
hhea.writeUInt16BE(UPM, 10);
hhea.writeInt16BE(caixaFonte[0], 12);
hhea.writeInt16BE(UPM - caixaFonte[2], 14);
hhea.writeInt16BE(caixaFonte[2], 16);
hhea.writeInt16BE(1, 18);
hhea.writeUInt16BE(n, 34);

const maxp = Buffer.alloc(32);
maxp.writeUInt32BE(0x00010000, 0);
maxp.writeUInt16BE(n, 4);
maxp.writeUInt16BE(Math.max(...glifos.map((g) => g.pontos)), 6);
maxp.writeUInt16BE(Math.max(...glifos.map((g) => g.contornos)), 8);
maxp.writeUInt16BE(2, 14);

const hmtx = Buffer.alloc(4 * n);
glifos.forEach((g, i) => {
  hmtx.writeUInt16BE(UPM, 4 * i);
  hmtx.writeInt16BE(g.caixa[0], 4 * i + 2);
});

// cmap: um subtable formato 4 (Windows, Unicode BMP) com um segmento.
const cmap = Buffer.alloc(4 + 8 + 32);
cmap.writeUInt16BE(0, 0);
cmap.writeUInt16BE(1, 2);
cmap.writeUInt16BE(3, 4);
cmap.writeUInt16BE(1, 6);
cmap.writeUInt32BE(12, 8);
const f4 = 12;
cmap.writeUInt16BE(4, f4);
cmap.writeUInt16BE(32, f4 + 2);
cmap.writeUInt16BE(0, f4 + 4);
cmap.writeUInt16BE(4, f4 + 6);
cmap.writeUInt16BE(4, f4 + 8);
cmap.writeUInt16BE(1, f4 + 10);
cmap.writeUInt16BE(0, f4 + 12);
cmap.writeUInt16BE(cps.at(-1), f4 + 14);
cmap.writeUInt16BE(0xffff, f4 + 16);
cmap.writeUInt16BE(0, f4 + 18);
cmap.writeUInt16BE(cps[0], f4 + 20);
cmap.writeUInt16BE(0xffff, f4 + 22);
cmap.writeUInt16BE((1 - cps[0]) & 0xffff, f4 + 24);
cmap.writeUInt16BE(1, f4 + 26);
cmap.writeUInt16BE(0, f4 + 28);
cmap.writeUInt16BE(0, f4 + 30);

const os2 = Buffer.alloc(96);
os2.writeUInt16BE(4, 0);
os2.writeInt16BE(UPM, 2);
os2.writeUInt16BE(400, 4);
os2.writeUInt16BE(5, 6);
os2.writeUInt16BE(0, 8);
[650, 700, 0, 140, 650, 700, 0, 480].forEach((v, i) => os2.writeInt16BE(v, 10 + 2 * i));
os2.writeInt16BE(50, 26);
os2.writeInt16BE(300, 28);
os2.writeUInt32BE(1 << 28, 46); // ulUnicodeRange2, bit 60: área de uso privado
os2.write('HDKN', 58, 'latin1');
os2.writeUInt16BE(0x40, 62);
os2.writeUInt16BE(cps[0], 64);
os2.writeUInt16BE(cps.at(-1), 66);
os2.writeInt16BE(UPM, 68);
os2.writeInt16BE(0, 70);
os2.writeInt16BE(0, 72);
os2.writeUInt16BE(UPM, 74);
os2.writeUInt16BE(0, 76);
os2.writeUInt32BE(1, 78);

const textos = [[1, NOME], [2, 'Regular'], [3, NOME], [4, NOME], [5, 'Version 1.0'], [6, NOME]];
const cadeias = textos.map(([, t]) => Buffer.from(t, 'utf16le').swap16());
const name = Buffer.alloc(6 + 12 * textos.length);
name.writeUInt16BE(0, 0);
name.writeUInt16BE(textos.length, 2);
name.writeUInt16BE(name.length, 4);
let off = 0;
textos.forEach(([id], i) => {
  const o = 6 + 12 * i;
  name.writeUInt16BE(3, o);
  name.writeUInt16BE(1, o + 2);
  name.writeUInt16BE(0x409, o + 4);
  name.writeUInt16BE(id, o + 6);
  name.writeUInt16BE(cadeias[i].length, o + 8);
  name.writeUInt16BE(off, o + 10);
  off += cadeias[i].length;
});
const nameTab = Buffer.concat([name, ...cadeias]);

const post = Buffer.alloc(32);
post.writeUInt32BE(0x00030000, 0);
post.writeInt16BE(-100, 8);
post.writeInt16BE(50, 10);

const tabelas = [
  ['OS/2', os2], ['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea],
  ['hmtx', hmtx], ['loca', loca], ['maxp', maxp], ['name', nameTab], ['post', post],
];

// checkSumAdjustment do head: o mesmo valor no sfnt e no WOFF (spec WOFF 1.0).
function sfnt() {
  const nt = tabelas.length;
  const cab = Buffer.alloc(12 + 16 * nt);
  cab.writeUInt32BE(0x00010000, 0);
  cab.writeUInt16BE(nt, 4);
  const sr = 16 * 2 ** Math.floor(Math.log2(nt));
  cab.writeUInt16BE(sr, 6);
  cab.writeUInt16BE(Math.floor(Math.log2(nt)), 8);
  cab.writeUInt16BE(16 * nt - sr, 10);
  let o = cab.length;
  const corpos = [];
  tabelas.forEach(([tag, d], i) => {
    const e = 12 + 16 * i;
    cab.write(tag, e, 'latin1');
    cab.writeUInt32BE(somaVerificacao(d), e + 4);
    cab.writeUInt32BE(o, e + 8);
    cab.writeUInt32BE(d.length, e + 12);
    corpos.push(pad4(d));
    o += pad4(d).length;
  });
  return Buffer.concat([cab, ...corpos]);
}
head.writeUInt32BE((0xb1b0afba - somaVerificacao(sfnt())) >>> 0, 8);
const totalSfnt = sfnt().length;

// WOFF 1.0.
const nt = tabelas.length;
const cabWoff = Buffer.alloc(44 + 20 * nt);
cabWoff.write('wOFF', 0, 'latin1');
cabWoff.writeUInt32BE(0x00010000, 4);
cabWoff.writeUInt16BE(nt, 12);
cabWoff.writeUInt32BE(totalSfnt, 16);
cabWoff.writeUInt16BE(1, 20);
let o = cabWoff.length;
const blocos = [];
tabelas.forEach(([tag, d], i) => {
  const z = zlib.deflateSync(d, { level: 9 });
  const usado = z.length < d.length ? z : d;
  const e = 44 + 20 * i;
  cabWoff.write(tag, e, 'latin1');
  cabWoff.writeUInt32BE(o, e + 4);
  cabWoff.writeUInt32BE(usado.length, e + 8);
  cabWoff.writeUInt32BE(d.length, e + 12);
  cabWoff.writeUInt32BE(somaVerificacao(d), e + 16);
  blocos.push(pad4(usado));
  o += pad4(usado).length;
});
cabWoff.writeUInt32BE(o, 8);
fs.writeFileSync(SAIDA, Buffer.concat([cabWoff, ...blocos]));
console.log(`ok: ${path.relative(raiz, SAIDA)} (${o} bytes, ${nomes.length} ícones)`);
