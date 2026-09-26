// Árvore de transcripts sintéticos dos benches (bench/transcripts.mjs e
// bench/consumo.mjs), sem dependências. O formato das linhas e a mistura de
// tamanhos estão descritos no cabeçalho de bench/transcripts.mjs.
//
// criarGerador(agora) devolve um gerador com estado próprio (PRNG de semente
// fixa e sequência de requestId): dois geradores criados com o mesmo `agora`
// escrevem os mesmos bytes, na mesma ordem. Os instantes das linhas ficam
// entre agora - 6,75 dias e agora - 1 min.
import fs from 'node:fs';
import path from 'node:path';

export const MB = 1024 * 1024;
export const DIA = 86_400_000;

// Por padrão 6 pastas de projeto x 12 sessões, cada sessão com 2
// agent-*.jsonl em <sessão>/subagents: 216 transcripts.
export const PROJETOS = 6;
export const SESSOES = 12;
export const AGENTES = 2;
export const ARQUIVOS_POR_PROJETO = SESSOES * (1 + AGENTES);

// PRNG determinístico (mulberry32): mesmo conteúdo a cada execução.
function prng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function criarGerador(agora) {
  const rnd = prng(20260925);
  const inteiro = (min, max) => min + Math.floor(rnd() * (max - min + 1));
  const LETRAS = 'abcdefghijklmnopqrstuvwxyz      ';
  const POOL = Array.from({ length: 256 * 1024 }, () => LETRAS[Math.floor(rnd() * LETRAS.length)]).join('');
  function texto(n) {
    if (n <= POOL.length) {
      const i = inteiro(0, POOL.length - n);
      return POOL.slice(i, i + n);
    }
    return POOL.repeat(Math.ceil(n / POOL.length)).slice(0, n);
  }
  const uuid = () => [8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, () => '0123456789abcdef'[inteiro(0, 15)]).join('')).join('-');

  let seqReq = 0;
  // Uma resposta completa (todas as linhas dela), como texto terminado em \n.
  function requisicao(ctx) {
    const req = `req_011CT${(seqReq++).toString(36).padStart(10, '0')}`;
    const msg = `msg_01${req.slice(9)}`;
    ctx.ts += inteiro(2_000, 60_000);
    const ts = () => new Date(Math.min(ctx.ts, agora - 60_000)).toISOString();
    const base = `"parentUuid":"${uuid()}","isSidechain":${ctx.sub},"userType":"external","cwd":"${ctx.cwd}","sessionId":"${ctx.sessao}","version":"2.5.0","gitBranch":"main"`;
    const linhas = [];
    linhas.push(`{${base},"type":"user","message":{"role":"user","content":"${texto(inteiro(500, 3_000))}"},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
    const blocos = inteiro(1, 3);
    const input = inteiro(1, 20);
    const cacheRead = inteiro(10_000, 180_000);
    const cacheCreate = inteiro(0, 20_000);
    let output = inteiro(10, 200);
    for (let b = 0; b < blocos; b++) {
      output += inteiro(0, 800);
      const conteudo = b % 2 === 0
        ? `[{"type":"text","text":"${texto(inteiro(300, 4_000))}"}]`
        : `[{"type":"tool_use","id":"toolu_${req.slice(9)}${b}","name":"Bash","input":{"command":"${texto(inteiro(50, 1_500))}"}}]`;
      linhas.push(`{${base},"message":{"id":"${msg}","type":"message","role":"assistant","model":"claude-opus-5-5","content":${conteudo},"stop_reason":null,"usage":{"input_tokens":${input},"cache_creation_input_tokens":${cacheCreate},"cache_read_input_tokens":${cacheRead},"output_tokens":${output},"output_tokens_details":{"thinking_tokens":${Math.floor(output / 3)}},"service_tier":"standard"}},"requestId":"${req}","type":"assistant","uuid":"${uuid()}","timestamp":"${ts()}","effort":"high","apiBlockIndex":${b}}`);
    }
    for (let k = 0; k < 4; k++) {
      linhas.push(`{${base},"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_${req.slice(9)}","type":"tool_result","content":"${texto(inteiro(500, 7_500))}"}]},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
    }
    if (seqReq % 20 === 0) {
      linhas.push(`{${base},"type":"user","message":{"role":"user","content":"ok"},"toolUseResult":{"status":"completed","usage":{"input_tokens":5,"output_tokens":900}},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
    }
    if (seqReq % 300 === 0) {
      linhas.push(`{${base},"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"${texto(inteiro(800_000, 1_200_000))}"}]},"uuid":"${uuid()}","timestamp":"${ts()}"}`);
    }
    return `${linhas.join('\n')}\n`;
  }

  // Escreve requisições em `arq` até `bytes`, em blocos de ~4 MB.
  function preencher(arq, ctx, bytes, flag) {
    const fd = fs.openSync(arq, flag);
    let total = 0;
    let pendente = [];
    let tamPendente = 0;
    try {
      while (total < bytes) {
        const t = requisicao(ctx);
        pendente.push(t);
        tamPendente += t.length;
        total += t.length;
        if (tamPendente >= 4 * MB) {
          fs.writeSync(fd, pendente.join(''));
          pendente = [];
          tamPendente = 0;
        }
      }
      if (pendente.length > 0) fs.writeSync(fd, pendente.join(''));
    } finally {
      fs.closeSync(fd);
    }
    return total;
  }

  // Cria a árvore sob `raiz` com cerca de `alvo` bytes (75 % nas sessões
  // principais, 25 % nos subagentes; cada arquivo leva ao menos uma
  // requisição) e alguns arquivos que a varredura deve pular. `projetos`
  // (padrão 6) só existe para testes rápidos: menos pastas, mesmo formato.
  // Devolve { arquivos, bytes, ativos }: `ativos` são até 8 arquivos (a
  // sessão mais recente de cada projeto e um subagente de cada um dos 2
  // primeiros) que o bench de transcripts estende na linha +1 %.
  function gerarArvore(raiz, alvo, projetos = PROJETOS) {
    const porPrincipal = (alvo * 0.75) / (projetos * SESSOES);
    const porAgente = (alvo * 0.25) / (projetos * SESSOES * AGENTES);
    const ativos = [];
    let bytes = 0;
    let arquivos = 0;
    for (let p = 0; p < projetos; p++) {
      const nomeProjeto = `C--Users-sintetico-proj-${p}`;
      const dirP = path.join(raiz, nomeProjeto);
      fs.mkdirSync(dirP, { recursive: true });
      fs.writeFileSync(path.join(dirP, 'notas.txt'), 'nao e transcript\n');
      for (let s = 0; s < SESSOES; s++) {
        const sessao = uuid();
        const cwd = `/home/sintetico/proj-${p}`;
        const ctx = { sessao, cwd, sub: false, ts: agora - 6.5 * DIA + (s * DIA) / 2 };
        const principal = path.join(dirP, `${sessao}.jsonl`);
        bytes += preencher(principal, ctx, porPrincipal, 'w');
        arquivos++;
        if (s === SESSOES - 1 && ativos.length < 8) ativos.push({ arq: principal, ctx });
        const dirSub = path.join(dirP, sessao, 'subagents');
        fs.mkdirSync(dirSub, { recursive: true });
        fs.writeFileSync(path.join(dirSub, 'agent-x.meta.json'), '{}\n');
        for (let a = 0; a < AGENTES; a++) {
          const ctxA = { sessao, cwd, sub: true, ts: ctx.ts - DIA / 4 };
          const arqA = path.join(dirSub, `agent-${uuid().slice(0, 17)}.jsonl`);
          bytes += preencher(arqA, ctxA, porAgente, 'w');
          arquivos++;
          if (s === SESSOES - 1 && p < 2 && a === 0) ativos.push({ arq: arqA, ctx: ctxA });
        }
      }
    }
    return { arquivos, bytes, ativos };
  }

  return { gerarArvore, preencher };
}
