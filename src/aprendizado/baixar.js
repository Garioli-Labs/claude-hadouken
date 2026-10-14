import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { apagar } from '../base.js';

// Download do otelcol-contrib (spec aprendizado §3.2 passo 2 e §6). É o
// ÚNICO módulo com rede do plugin (test/aprendizado-fronteiras.test.js), e só
// o `ligar` confirmado o chama. Versão e SHA-256 do .tar.gz fixados no
// código, por plataforma (R7). Só https na porta padrão e só os hosts do
// release, conferidos em cada salto; no máximo 5 redirecionamentos, teto de
// tamanho e prazo. Baixa num .parte ao lado do destino e só renomeia depois
// de conferir o hash; qualquer falha apaga o .parte. Nunca rejeita.

// >>> bloco da Task 1, Step 1 ($S\fixado.js), colado sem edição
export const VERSAO_COLETOR = '0.162.0';
export const FIXADO = Object.freeze({
  'win32-x64': Object.freeze({ arquivo: 'otelcol-contrib_0.162.0_windows_amd64.tar.gz', sha256: 'b371829181e89947a1a6570b8b6c38c20d85e2d215b76bf042f89b365b9e5c3d' }),
  'linux-x64': Object.freeze({ arquivo: 'otelcol-contrib_0.162.0_linux_amd64.tar.gz', sha256: 'fcc063749f730f8c21fe29f2d340ff174f5f1c5885bd3156fb6c985a3036fcc3' }),
  'linux-arm64': Object.freeze({ arquivo: 'otelcol-contrib_0.162.0_linux_arm64.tar.gz', sha256: 'ecf6a917e2b53beb1703b19a84bc4e112a2fcaba549639cf6b0ba58446bfd7d2' }),
  'darwin-x64': Object.freeze({ arquivo: 'otelcol-contrib_0.162.0_darwin_amd64.tar.gz', sha256: '91a6e7a0f5e1981986c897db4535de5ba8d7fc45d4205809aecb9ebebf68c71c' }),
  'darwin-arm64': Object.freeze({ arquivo: 'otelcol-contrib_0.162.0_darwin_arm64.tar.gz', sha256: 'd5e11974d2e4adac3cc001a25137aad52f6e77ec3034ba7735cac7c219a5f97a' }),
});
// <<<

const REPO = 'open-telemetry/opentelemetry-collector-releases';
// Emenda A2: os hosts por onde o download do release passa (medido:
// github.com → 302 → release-assets.githubusercontent.com).
export const HOSTS = Object.freeze(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
// Emenda A2: o maior .tar.gz (linux-amd64, 107,1 MiB) × 2, arredondado para
// cima.
export const TAMANHO_MAX = 215 * 1024 * 1024;
// Decisão do Sr. Garioli: 268 s medidos (win-amd64, 98,5 MiB) dão 1,7×;
// 450 s + 120 s da extração ≤ 600 s do hook (R5). Numa conexão mais lenta,
// sai o motivo 'prazo'.
export const PRAZO_MS = 450_000;
export const REDIRECIONAMENTOS_MAX = 5;
export const SHA_VALIDO = /^[0-9a-f]{64}$/;
const REDIRECIONA = new Set([301, 302, 303, 307, 308]);

export function plataformaAtual(plataforma = process.platform, arch = process.arch) {
  const chave = `${plataforma}-${arch}`;
  return Object.hasOwn(FIXADO, chave) ? chave : null;
}

export function urlDoColetor(chave) {
  return `https://github.com/${REPO}/releases/download/v${VERSAO_COLETOR}/${FIXADO[chave].arquivo}`;
}

function transferir({ url, sha, hosts, protocolos, prazoMs, tamanhoMax, parte }) {
  return new Promise((resolver) => {
    let fim = false;
    let pedido = null;
    let saida = null;
    const terminar = (r) => {
      if (fim) return;
      fim = true;
      clearTimeout(relogio);
      try { pedido?.destroy(); } catch { /* já fechado */ }
      // No Windows o arquivo aberto não se apaga: espera o fechamento.
      if (saida === null || saida.closed) {
        resolver(r);
        return;
      }
      saida.once('close', () => resolver(r));
      saida.destroy();
    };
    const relogio = setTimeout(() => terminar({ ok: false, motivo: 'prazo' }), prazoMs);
    const pedir = (alvo, saltos) => {
      let u;
      try {
        u = new URL(alvo);
      } catch {
        terminar({ ok: false, motivo: 'host' });
        return;
      }
      // https só na porta padrão (`port` vazio, também para :443 escrito).
      const portaRuim = u.protocol === 'https:' && u.port !== '';
      if (!protocolos.includes(u.protocol) || !hosts.includes(u.hostname) || portaRuim || u.username !== '' || u.password !== '') {
        terminar({ ok: false, motivo: 'host' });
        return;
      }
      const cliente = u.protocol === 'https:' ? https : http;
      pedido = cliente.get(u, { headers: { 'user-agent': 'claude-hadouken' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECIONA.has(status)) {
          res.resume();
          const destino = res.headers.location;
          if (typeof destino !== 'string' || saltos >= REDIRECIONAMENTOS_MAX) {
            terminar({ ok: false, motivo: 'http' });
            return;
          }
          let proximo;
          try {
            proximo = new URL(destino, u).href;
          } catch {
            terminar({ ok: false, motivo: 'host' });
            return;
          }
          pedir(proximo, saltos + 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          terminar({ ok: false, motivo: 'http' });
          return;
        }
        const declarado = Number(res.headers['content-length']);
        if (Number.isFinite(declarado) && declarado > tamanhoMax) {
          terminar({ ok: false, motivo: 'grande' });
          return;
        }
        try {
          saida = fs.createWriteStream(parte, { flags: 'wx' });
        } catch {
          terminar({ ok: false, motivo: 'escrita' });
          return;
        }
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        saida.on('error', () => terminar({ ok: false, motivo: 'escrita' }));
        res.on('error', () => terminar({ ok: false, motivo: 'rede' }));
        res.on('aborted', () => terminar({ ok: false, motivo: 'rede' }));
        res.on('data', (pedaco) => {
          bytes += pedaco.length;
          if (bytes > tamanhoMax) terminar({ ok: false, motivo: 'grande' });
          else hash.update(pedaco);
        });
        saida.on('close', () => {
          if (fim) return;
          if (!res.complete) {
            terminar({ ok: false, motivo: 'rede' });
            return;
          }
          terminar(hash.digest('hex') === sha ? { ok: true, bytes } : { ok: false, motivo: 'hash' });
        });
        res.pipe(saida);
      });
      pedido.on('error', () => terminar({ ok: false, motivo: 'rede' }));
    };
    pedir(url, 0);
  });
}

export async function baixarColetor(opcoes) {
  let parte = null;
  try {
    const o = opcoes ?? {};
    const fixo = typeof o.chave === 'string' && Object.hasOwn(FIXADO, o.chave) ? FIXADO[o.chave] : null;
    const url = o.url ?? (fixo === null ? null : urlDoColetor(o.chave));
    const sha = o.sha256 ?? fixo?.sha256 ?? null;
    if (typeof url !== 'string' || typeof sha !== 'string' || !SHA_VALIDO.test(sha)) return { ok: false, motivo: 'plataforma' };
    if (typeof o.destino !== 'string' || !path.isAbsolute(o.destino)) return { ok: false, motivo: 'escrita' };
    try {
      fs.mkdirSync(path.dirname(o.destino), { recursive: true });
    } catch {
      return { ok: false, motivo: 'escrita' };
    }
    parte = `${o.destino}.${process.pid}.${Date.now()}.parte`;
    const r = await transferir({
      url, sha, parte,
      hosts: o.hosts ?? HOSTS,
      protocolos: o.protocolos ?? ['https:'],
      prazoMs: o.prazoMs ?? PRAZO_MS,
      tamanhoMax: o.tamanhoMax ?? TAMANHO_MAX,
    });
    if (!r.ok) return r;
    fs.renameSync(parte, o.destino);
    parte = null;
    return r;
  } catch {
    return { ok: false, motivo: 'escrita' };
  } finally {
    if (parte !== null) apagar(parte);
  }
}
