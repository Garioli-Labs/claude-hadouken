import fs from 'node:fs';
import path from 'node:path';
import { MARCA_QUARENTENA } from './reparo.js';

// A pasta de dados não cresce sem fim (spec v0.5.5 §6.C). Só arquivos do
// hadouken no primeiro nível, por nome; o venv (graphify) nunca é tocado, nem
// para medir. Na ordem:
// - quarentena (*.corrompido-<data>) com mais de 30 dias, pela data do nome
//   (o rename mantém a data do arquivo original);
// - indice-*.json acima de 10 MB: apagado, porque se reconstrói;
// - historico.jsonl acima de 5 MB (o giro do SessionEnd falhou): fica nos
//   últimos 4 MB, em linha inteira;
// - total acima do teto: primeiro o histórico velho, depois o atual.
// Nunca lança.

const MB = 1024 * 1024;
const DIA_MS = 86_400_000;
const QUARENTENA_DIAS = 30;
const INDICE_MAX = 10 * MB;
const HISTORICO_MAX = 5 * MB;
const HISTORICO_ALVO = 4 * MB;
const HISTORICO = 'historico.jsonl';
const HISTORICO_VELHO = 'historico.1.jsonl';
const INDICE = /^indice-[\w-]{1,60}\.json$/;
const QUARENTENA = /\.corrompido-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?$/;
const FORA = new Set(['venv']);
const ENTRADAS_MAX = 2000;

function tamanhoRegular(arq) {
  try {
    const st = fs.lstatSync(arq);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function apagar(dir, nome, cortes) {
  const arq = path.join(dir, nome);
  const antes = tamanhoRegular(arq);
  if (antes === null) return;
  try {
    fs.unlinkSync(arq);
    cortes.push({ arquivo: nome, antesBytes: antes, depoisBytes: 0 });
  } catch { /* preso: fica para a próxima */ }
}

// Mantém os últimos `alvo` bytes, começando numa linha inteira, gravando ao
// lado e renomeando (nunca deixa o arquivo pela metade).
function cortarCauda(dir, nome, alvo, cortes) {
  const arq = path.join(dir, nome);
  const antes = tamanhoRegular(arq);
  if (antes === null || antes <= alvo) return;
  let fd;
  let resto;
  try {
    fd = fs.openSync(arq, 'r');
    const inicio = antes - alvo;
    const buf = Buffer.alloc(alvo + 1);
    const lidos = fs.readSync(fd, buf, 0, alvo + 1, inicio - 1);
    const pedaco = buf.subarray(0, lidos);
    // O byte antes do corte é '\n': o corte já cai numa linha inteira.
    const nl = pedaco.indexOf(0x0a);
    resto = nl === -1 ? Buffer.alloc(0) : pedaco.subarray(nl + 1);
  } catch {
    return;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* já fechado */ }
  }
  const tmp = `${arq}.${process.pid}.${Date.now()}.limpeza.tmp`;
  try {
    fs.writeFileSync(tmp, resto, { flag: 'wx' });
    fs.renameSync(tmp, arq);
    cortes.push({ arquivo: nome, antesBytes: antes, depoisBytes: resto.length });
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* não nasceu */ }
  }
}

// Soma do que é do hadouken: primeiro nível e um nível de subpasta, fora o venv.
function totalBytes(dir) {
  let total = 0;
  let vistos = 0;
  const somar = (d, fundo) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (++vistos > ENTRADAS_MAX) return;
      if (ent.isFile()) total += tamanhoRegular(path.join(d, ent.name)) ?? 0;
      else if (ent.isDirectory() && fundo === 0 && !FORA.has(ent.name)) {
        try { somar(path.join(d, ent.name), 1); } catch { /* sem acesso */ }
      }
    }
  };
  somar(dir, 0);
  return total;
}

// Para o /hadouken:saude: o total (o mesmo que o teto mede) e os 3 maiores
// arquivos do primeiro nível. Nunca lança.
export function medirDados(dir) {
  try {
    const maiores = [];
    for (const nome of fs.readdirSync(dir).slice(0, ENTRADAS_MAX)) {
      const bytes = tamanhoRegular(path.join(dir, nome));
      if (bytes !== null) maiores.push({ nome, bytes });
    }
    maiores.sort((a, b) => b.bytes - a.bytes || (a.nome < b.nome ? -1 : 1));
    return { totalBytes: totalBytes(dir), maiores: maiores.slice(0, 3) };
  } catch {
    return { totalBytes: null, maiores: [] };
  }
}

function quarentenaVelha(nome, agoraMs) {
  if (!nome.includes(MARCA_QUARENTENA)) return false;
  const m = QUARENTENA.exec(nome);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(t) && agoraMs - t > QUARENTENA_DIAS * DIA_MS;
}

export function limparDados(dir, { tetoMb, agoraMs } = {}) {
  const cortes = [];
  try {
    if (typeof dir !== 'string' || !Number.isFinite(agoraMs)) return { cortes };
    const nomes = fs.readdirSync(dir).slice(0, ENTRADAS_MAX).sort();
    for (const nome of nomes) if (quarentenaVelha(nome, agoraMs)) apagar(dir, nome, cortes);
    for (const nome of nomes) {
      if (INDICE.test(nome) && (tamanhoRegular(path.join(dir, nome)) ?? 0) > INDICE_MAX) apagar(dir, nome, cortes);
    }
    if ((tamanhoRegular(path.join(dir, HISTORICO)) ?? 0) > HISTORICO_MAX) cortarCauda(dir, HISTORICO, HISTORICO_ALVO, cortes);

    if (Number.isFinite(tetoMb) && tetoMb > 0) {
      let excesso = totalBytes(dir) - tetoMb * MB;
      if (excesso > 0 && tamanhoRegular(path.join(dir, HISTORICO_VELHO)) !== null) {
        const antes = tamanhoRegular(path.join(dir, HISTORICO_VELHO));
        apagar(dir, HISTORICO_VELHO, cortes);
        excesso -= antes;
      }
      const atual = tamanhoRegular(path.join(dir, HISTORICO));
      if (excesso > 0 && atual !== null) cortarCauda(dir, HISTORICO, Math.max(0, atual - excesso), cortes);
    }
  } catch {
    // o que já foi cortado fica na lista
  }
  return { cortes };
}
