import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolverExecutavel } from '../executavel.js';

// O adaptador real da costura `executar` do coletor (spec v0.5.5 §6.A). Só
// roda os leitores da lista, por caminho absoluto (nunca pelo cwd), sem
// shell, escondido, com prazo (mata no estouro) e com teto de saída. O cwd
// do filho é a pasta temporária: o PowerShell sem perfil grava cache no cwd.
// Nunca lança.

const SAIDA_MAX = 2 * 1024 * 1024;
const ESPERA_KILL_MS = 1000;

function existe(arq) {
  try { return fs.statSync(arq).isFile(); } catch { return false; }
}

function caminhoDe(nome) {
  const win = process.platform === 'win32';
  if (nome === 'powershell') {
    if (!win) return null;
    const p = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return existe(p) ? p : null;
  }
  if (nome === 'ps') return win ? null : ['/bin/ps', '/usr/bin/ps'].find(existe) ?? resolverExecutavel('ps');
  if (nome === 'pmset') return process.platform === 'darwin' && existe('/usr/bin/pmset') ? '/usr/bin/pmset' : null;
  if (nome === 'nvidia-smi') {
    const achado = resolverExecutavel('nvidia-smi');
    if (achado !== null || !win) return achado;
    const p = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe');
    return existe(p) ? p : null;
  }
  return null;
}

// Exportado para os testes: roda um arquivo com prazo e teto de saída.
export function rodarArquivo(arquivo, args, { prazoMs, maxBytes = SAIDA_MAX }) {
  return new Promise((resolve) => {
    let feito = false;
    let relogio = null;
    const fim = (r) => {
      if (feito) return;
      feito = true;
      if (relogio !== null) clearTimeout(relogio);
      resolve(r);
    };
    const falha = (motivo) => ({ ok: false, stdout: '', motivo });
    let filho;
    try {
      filho = spawn(arquivo, args, { cwd: os.tmpdir(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      fim(falha('erro'));
      return;
    }
    const partes = [];
    let total = 0;
    let motivoMorte = null;
    const matar = (motivo) => {
      if (motivoMorte !== null) return;
      motivoMorte = motivo;
      try { filho.kill('SIGKILL'); } catch { /* já saiu */ }
      // Se nem o exit chegar, o prazo extra resolve.
      relogio = setTimeout(() => fim(falha(motivo)), ESPERA_KILL_MS);
    };
    relogio = setTimeout(() => matar('prazo'), prazoMs);
    filho.on('error', () => fim(falha(motivoMorte ?? 'erro')));
    filho.stdout.on('error', () => { /* o close ou o prazo decidem */ });
    filho.stdout.on('data', (pedaco) => {
      total += pedaco.length;
      if (total > maxBytes) {
        matar('grande');
        return;
      }
      partes.push(pedaco);
    });
    filho.on('close', (codigo) => {
      if (motivoMorte !== null) fim(falha(motivoMorte));
      else if (codigo !== 0) fim(falha('erro'));
      else fim({ ok: true, stdout: Buffer.concat(partes).toString('utf8') });
    });
  });
}

export async function executar(nome, args, { prazoMs }) {
  try {
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string') || !Number.isFinite(prazoMs)) return { ok: false, stdout: '', motivo: 'erro' };
    const arquivo = caminhoDe(nome);
    if (arquivo === null) return { ok: false, stdout: '', motivo: 'erro' };
    return await rodarArquivo(arquivo, args, { prazoMs });
  } catch {
    return { ok: false, stdout: '', motivo: 'erro' };
  }
}
