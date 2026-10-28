import fs from 'node:fs';
import path from 'node:path';
import { gravarJsonAtomico, lerJson } from '../estado.js';
import { anexarEvento } from '../guarda/registros.js';

// Autorreparo dos JSON de estado (spec v0.5.5 §6.C). Arquivo regular que não
// é JSON vai para quarentena, `<nome>.corrompido-<AAAA-MM-DD-HHmm>`, com no
// máximo 3 cópias por arquivo. Nada é recriado: o ausente já é o padrão
// seguro de cada leitor. Cada reparo vira o evento 'reparo' da guarda.
//
// guarda.json fica de fora de propósito: ilegível ele vale como trava
// disparada (fail-closed, guarda/travas.js), e tirá-lo do lugar soltaria a
// guarda. Só a liberação o reescreve. Nunca lança.

export const ARQUIVOS_ESTADO = Object.freeze([
  'estado.json', 'liberacao.json', 'guarda-eventos.json', 'alertas.json', 'projecao.json',
  'uso-oficial.json', 'config.json', 'saude-avisos.json', 'tetos.json', 'saude-modo.json',
]);
const COPIAS_MAX = 3;
export const MARCA_QUARENTENA = '.corrompido-';

const doisDig = (n) => String(n).padStart(2, '0');
function carimbo(agoraMs) {
  const d = new Date(agoraMs);
  return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}-${doisDig(d.getUTCDate())}-${doisDig(d.getUTCHours())}${doisDig(d.getUTCMinutes())}`;
}

function ehArquivoRegular(arq) {
  try { return fs.lstatSync(arq).isFile(); } catch { return false; }
}

function nomeLivre(dir, base) {
  if (!fs.existsSync(path.join(dir, base))) return base;
  for (let i = 2; i < 100; i++) if (!fs.existsSync(path.join(dir, `${base}-${i}`))) return `${base}-${i}`;
  return null;
}

// Do mais novo para o mais velho, pelo nome (o carimbo ordena), e apaga o resto.
function podarCopias(dir, nome) {
  const prefixo = nome + MARCA_QUARENTENA;
  const copias = fs.readdirSync(dir)
    .filter((n) => n.startsWith(prefixo) && ehArquivoRegular(path.join(dir, n)))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const velha of copias.slice(COPIAS_MAX)) {
    try { fs.unlinkSync(path.join(dir, velha)); } catch { /* fica para a próxima */ }
  }
}

export function repararDados(dir, agoraMs) {
  const reparos = [];
  try {
    if (typeof dir !== 'string' || !Number.isFinite(agoraMs)) return reparos;
    for (const nome of ARQUIVOS_ESTADO) {
      const arq = path.join(dir, nome);
      if (lerJson(arq).motivo !== 'invalido' || !ehArquivoRegular(arq)) continue;
      const copia = nomeLivre(dir, nome + MARCA_QUARENTENA + carimbo(agoraMs));
      if (copia === null) continue;
      try {
        fs.renameSync(arq, path.join(dir, copia));
      } catch {
        continue;
      }
      reparos.push({ arquivo: nome, copia });
      try { podarCopias(dir, nome); } catch { /* poda é melhor esforço */ }
    }
    // Depois de mover tudo: guarda-eventos.json pode ter sido um dos reparados.
    for (const r of reparos) anexarEvento(dir, 'reparo', r.arquivo, agoraMs);
  } catch {
    // o que já foi movido fica na lista
  }
  if (reparos.length > 0) guardarParaAvisar(dir, reparos.map((r) => r.arquivo));
  return reparos;
}

// O aviso único ao usuário (spec §6.E): o coletor não fala com ninguém, então
// guarda os nomes em reparos-avisar.json e o SessionStart seguinte avisa uma
// vez e apaga. Só nomes da lista fixa entram no texto.
export const ARQ_REPAROS_AVISAR = 'reparos-avisar.json';

function lerParaAvisar(dir) {
  const r = lerJson(path.join(dir, ARQ_REPAROS_AVISAR), 4096);
  const lista = r.ok && Array.isArray(r.valor?.arquivos) ? r.valor.arquivos : [];
  return ARQUIVOS_ESTADO.filter((n) => lista.includes(n));
}

function guardarParaAvisar(dir, nomes) {
  try {
    const todos = [...new Set([...lerParaAvisar(dir), ...nomes])];
    gravarJsonAtomico(path.join(dir, ARQ_REPAROS_AVISAR), { v: 1, arquivos: todos }, { compacto: true });
  } catch { /* sem aviso; o /hadouken:saude ainda mostra */ }
}

const listaNomes = (n) => (n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} e ${n.at(-1)}`);

// O texto ao usuário, ou null. Só avisa se conseguiu apagar o arquivo (senão
// avisaria em toda sessão). Nunca lança.
export function avisoReparos(dir) {
  try {
    if (typeof dir !== 'string') return null;
    const arq = path.join(dir, ARQ_REPAROS_AVISAR);
    if (!fs.existsSync(arq)) return null;
    const nomes = lerParaAvisar(dir);
    fs.unlinkSync(arq);
    const outros = nomes.filter((n) => n !== 'config.json');
    const linhas = [];
    if (outros.length > 0) {
      const um = outros.length === 1;
      linhas.push(`hadouken: ${listaNomes(outros)} ${um ? 'estava corrompido; foi posto' : 'estavam corrompidos; foram postos'} de lado (cópia .corrompido-<data> na pasta de dados) e o padrão seguro vale no lugar. /hadouken:saude mostra os detalhes.`);
    }
    if (nomes.includes('config.json')) {
      linhas.push('hadouken: config.json estava corrompido: a configuração voltou ao padrão (guarda e proteções ligadas). O arquivo antigo ficou na pasta de dados como config.json.corrompido-<data>, se quiser recuperar algum ajuste.');
    }
    return linhas.length > 0 ? linhas.join('\n') : null;
  } catch {
    return null;
  }
}
