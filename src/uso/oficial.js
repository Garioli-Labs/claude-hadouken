import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { numeroFinito } from '../base.js';

// Leitura oficial do uso pelo próprio Claude Code (spec, emenda E2 e E3):
// `claude -p /usage` é comando local, sem modelo e sem tokens, e traz as
// mesmas linhas da aba Uso do claude.ai, inclusive a do Fable. O plugin não
// lê credencial nem fala com endpoint nenhum: só roda o comando e interpreta
// o texto (E8, S26). Nenhuma função daqui lança; rodarUso nunca rejeita.

// Prazo e teto de saída da leitura (E8, S26).
export const PRAZO_USO_MS = 30_000;
export const MAX_SAIDA_BYTES = 64 * 1024;
// Teto do texto de `result` (a saída real tem uns 400 bytes).
const MAX_RESULT_BYTES = 16 * 1024;

// Modo enxuto (E3): sem sessão gravada, sem MCP, sem Chrome, sem as
// configurações do usuário e sem hooks. `--bare` não serve, porque desliga o
// OAuth e o /usage falha. Congelado: quem chama não altera os argumentos.
const ARGS_USO = Object.freeze(['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--no-chrome', '--setting-sources', '', '--settings', '{"disableAllHooks":true}']);

export function argsUso() {
  return ARGS_USO;
}

// Cópia do ambiente SEM CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, em
// qualquer caixa (E3, emenda da noite): com ela, o /usage não busca a
// utilização e devolve o cache de ~/.claude.json (cachedUsageUtilization),
// que pode ter horas (medido em 29/09: 25% com reinício 17:20 às 18:04,
// contra 5% frescos sem ela). Ambiente que não é objeto, ou com getter que
// lança, vira objeto vazio.
const TRAFEGO = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
export function ambienteUso(env) {
  let copia = {};
  try {
    if (env !== null && typeof env === 'object') copia = { ...env };
  } catch {
    copia = {};
  }
  for (const k of Object.keys(copia)) if (k.toUpperCase() === TRAFEGO) delete copia[k];
  return copia;
}

// Diretório absoluto completo para a plataforma dada: no win32, só com letra
// de unidade (C:\ ou C:/). Mais restrito que absolutoCompleto de base.js, que
// segue a plataforma do processo e aceita UNC: o executável do painel nunca
// vem de um compartilhamento de rede, e a regra vale para qualquer
// `plataforma` (os testes do win32 rodam também no POSIX).
function dirAbsoluto(d, win) {
  if (typeof d !== 'string' || d.includes('\0')) return false;
  return win ? /^[A-Za-z]:[\\/]/.test(d) : d.startsWith('/');
}

function homeOuNull() {
  try {
    return os.homedir();
  } catch {
    return null;
  }
}

function arquivoRegular(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Caminho do `claude` (E8, S26): primeiro ~/.local/bin (onde o instalador
// nativo o põe), depois cada diretório absoluto do PATH, na ordem. Entrada
// vazia, ".", relativa e, no win32, sem unidade ficam de fora; no win32, um
// par de aspas em volta da entrada é tirado, como o próprio Windows faz. No
// win32 só claude.exe: .cmd e .bat exigiriam um shell, e execFile não os
// roda sem ele. `existe(p)` diz se é arquivo regular. Devolve o primeiro
// que existir, ou null.
export function acharClaude(opcoes) {
  try {
    const {
      home = homeOuNull(),
      pathEnv = process.env.PATH ?? process.env.Path,
      plataforma = process.platform,
      existe = arquivoRegular,
    } = opcoes ?? {};
    const win = plataforma === 'win32';
    const p = win ? path.win32 : path.posix;
    const nome = win ? 'claude.exe' : 'claude';
    const dirs = [];
    if (dirAbsoluto(home, win)) dirs.push(p.join(home, '.local', 'bin'));
    if (typeof pathEnv === 'string') {
      for (const cru of pathEnv.split(win ? ';' : ':')) {
        const e = win && cru.length >= 2 && cru.startsWith('"') && cru.endsWith('"') ? cru.slice(1, -1) : cru;
        if (dirAbsoluto(e, win)) dirs.push(e);
      }
    }
    for (const d of dirs) {
      const candidato = p.join(d, nome);
      if (existe(candidato) === true) return candidato;
    }
    return null;
  } catch {
    return null;
  }
}

const MESES = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const RESET = /^resets (?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?(am|pm)(?: \([^)]{1,64}\))?$/;
const DIA_MS = 24 * 60 * 60_000;
// O texto traz só hora e minuto: um reinício "5:19pm" visto às 17:19:30
// ainda é o de hoje, e só passa para amanhã quando o minuto inteiro passou.
const TOLERANCIA_MINUTO_MS = 60_000;

// Date local válido para o dia pedido, ou null (Feb 30 normaliza para março).
function dataLocal(ano, mes, dia, h, min) {
  const d = new Date(ano, mes, dia, h, min);
  if (d.getFullYear() !== ano || d.getMonth() !== mes || d.getDate() !== dia) return null;
  const ms = d.getTime();
  return numeroFinito(ms) ? ms : null;
}

// Instante (ms epoch) de um "resets ..." do /usage, na hora local. O fuso
// entre parênteses é ignorado: o Claude Code já formata no fuso do sistema.
// Sem mês, hoje ou, se já passou, amanhã; com mês, o ano corrente ou, se
// ficou mais de 1 dia no passado, o seguinte. Hora fora de 1–12, minuto
// acima de 59 ou dia inválido dão null.
export function interpretarReset(texto, agoraMs) {
  try {
    if (typeof texto !== 'string' || !numeroFinito(agoraMs)) return null;
    const m = RESET.exec(texto);
    if (m === null) return null;
    const [, mesTxt, diaTxt, hTxt, minTxt, ampm] = m;
    const h = Number(hTxt);
    const min = minTxt === undefined ? 0 : Number(minTxt);
    if (h < 1 || h > 12 || min > 59) return null;
    const h24 = (h % 12) + (ampm === 'pm' ? 12 : 0);
    const agora = new Date(agoraMs);
    if (!numeroFinito(agora.getTime())) return null;
    if (mesTxt === undefined) {
      const hoje = dataLocal(agora.getFullYear(), agora.getMonth(), agora.getDate(), h24, min);
      if (hoje === null) return null;
      if (hoje + TOLERANCIA_MINUTO_MS > agoraMs) return hoje;
      const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
      return dataLocal(amanha.getFullYear(), amanha.getMonth(), amanha.getDate(), h24, min);
    }
    const mes = MESES[mesTxt];
    const dia = Number(diaTxt);
    const ano = agora.getFullYear();
    const esteAno = dataLocal(ano, mes, dia, h24, min);
    if (esteAno === null) return null;
    if (esteAno >= agoraMs - DIA_MS) return esteAno;
    return dataLocal(ano + 1, mes, dia, h24, min);
  } catch {
    return null;
  }
}

// As três linhas da aba Uso, casadas inteiras (E8, S26). O separador " · " é
// U+00B7. A porcentagem aceita até duas casas decimais; qualquer outra forma
// (sinal, três casas, texto antes ou depois) não casa e vira "sem leitura".
const PCT = String.raw`(\d{1,3}(?:\.\d{1,2})?)% used(?: · (resets .{1,80}))?$`;
const LINHAS = Object.freeze({
  sessao: new RegExp(String.raw`^Current session: ${PCT}`, 'gm'),
  semana: new RegExp(String.raw`^Current week \(all models\): ${PCT}`, 'gm'),
  fable: new RegExp(String.raw`^Current week \(Fable\): ${PCT}`, 'gm'),
});

// Janela de uma linha, ou null: a linha tem de aparecer uma vez só (duas
// seriam ambíguas) e a porcentagem, estar em [0, 100]. O reinício que não se
// interpreta vira null sem derrubar a porcentagem.
function janelaDaLinha(texto, re, agoraMs) {
  const achados = [...texto.matchAll(re)];
  if (achados.length !== 1) return null;
  const [, pctTxt, resetTxt] = achados[0];
  const pct = Number(pctTxt);
  if (!numeroFinito(pct) || pct < 0 || pct > 100) return null;
  const resetsAtMs = resetTxt === undefined ? null : interpretarReset(resetTxt, agoraMs);
  return { pct, resetsAtMs };
}

const FORMATO = Object.freeze({ ok: false, motivo: 'formato' });
const CUSTO = Object.freeze({ ok: false, motivo: 'custo' });

// Interpreta o stdout do `claude -p /usage --output-format json` (E2).
// Trava de custo: turnos ou custo que não sejam exatamente 0 (inclusive
// ausentes ou de outro tipo) querem dizer que o comando passou a chamar o
// modelo, e a resposta é `custo`. Com zero turnos e custo zero, um resultado
// que não venha do comando local `usage` (erro de login, por exemplo) é
// `formato`: nada foi gasto, e travar 24 h por ele seria um falso positivo
// (portão Fable da v0.3.0, item 5). Nenhuma das três linhas com número
// válido: `formato`.
export function interpretarSaida(stdout, agoraMs) {
  try {
    if (typeof stdout !== 'string') return { ...FORMATO };
    let obj;
    try {
      obj = JSON.parse(stdout);
    } catch {
      return { ...FORMATO };
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || obj.type !== 'result') return { ...FORMATO };
    if (obj.num_turns !== 0 || obj.total_cost_usd !== 0) return { ...CUSTO };
    if (obj.local_command !== 'usage') return { ...FORMATO };
    const texto = obj.result;
    if (typeof texto !== 'string' || Buffer.byteLength(texto, 'utf8') > MAX_RESULT_BYTES) return { ...FORMATO };
    const sessao = janelaDaLinha(texto, LINHAS.sessao, agoraMs);
    const semana = janelaDaLinha(texto, LINHAS.semana, agoraMs);
    const fable = janelaDaLinha(texto, LINHAS.fable, agoraMs);
    if (sessao === null && semana === null && fable === null) return { ...FORMATO };
    const modelos = {};
    if (fable !== null) modelos.fable = fable;
    return { ok: true, uso: { sessao, semana, modelos } };
  } catch {
    return { ...FORMATO };
  }
}

const executarPadrao = (exe, args, opcoes, cb) => execFile(exe, args, opcoes, cb);

// O prazo do execFile é a reserva: o nosso vence antes e mata a árvore.
const RESERVA_PRAZO_MS = 5_000;

// Mata o `claude` e o que ele abriu (portão Fable da v0.3.0, item 2). No
// Windows o timeout do execFile encerra só o claude.exe; um neto com o
// stdout herdado seguraria o 'close' e deixaria processos órfãos. O
// taskkill vem do System32, por caminho absoluto, com /t (árvore) e /f.
// Fora do Windows, SIGKILL no filho. Nunca lança.
export function matarArvore(filho, { plataforma = process.platform, executar = executarPadrao, systemRoot = process.env.SystemRoot } = {}) {
  try {
    const pid = filho?.pid;
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (plataforma === 'win32') {
      const raiz = typeof systemRoot === 'string' && /^[A-Za-z]:[\\/]/.test(systemRoot) && !systemRoot.includes('\0') ? systemRoot : 'C:\\Windows';
      executar(path.win32.join(raiz, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { windowsHide: true, timeout: 10_000 }, () => {});
    } else {
      filho.kill('SIGKILL');
    }
  } catch {
    /* processo já saiu */
  }
}

// Motivo de um erro do execFile, ou null quando há stdout para interpretar.
// O teto de saída vem antes do prazo: ao passar do maxBuffer o execFile mata
// o filho, e o erro chega também com `killed` e `signal`.
function motivoDoErro(erro, stdout) {
  if (erro?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'saida';
  if (erro?.killed === true || (typeof erro?.signal === 'string' && erro.signal !== '') || erro?.code === 'ETIMEDOUT') return 'tempo';
  if (stdout === '') return 'erro';
  return null;
}

// Roda o `claude` no modo enxuto e interpreta a saída (E3, S26). Argumentos
// fixos, prazo de 30 s, saída de até 64 KiB, sem shell e sem janela. O
// ambiente sempre passa por ambienteUso. No prazo, a promessa resolve com
// `tempo` na hora, sem esperar o 'close', e a árvore do filho é morta
// (matarArvore); o timeout do execFile, 5 s depois, fica de reserva.
// `executar`, `matar` e `prazoMs` trocam o execFile, a morte da árvore e o
// prazo nos testes. Nunca rejeita.
export function rodarUso(opcoes) {
  return new Promise((resolver) => {
    let feito = false;
    let relogio = null;
    const fim = (r) => {
      if (feito) return;
      feito = true;
      if (relogio !== null) clearTimeout(relogio);
      resolver(r);
    };
    try {
      const { exe, cwd, env, agoraMs = Date.now(), executar = executarPadrao, matar = matarArvore, prazoMs = PRAZO_USO_MS } = opcoes ?? {};
      if (typeof exe !== 'string' || exe === '') {
        fim({ ok: false, motivo: 'sem-claude' });
        return;
      }
      const prazo = numeroFinito(prazoMs) && prazoMs > 0 && prazoMs <= PRAZO_USO_MS ? prazoMs : PRAZO_USO_MS;
      const opcoesFilho = {
        cwd,
        env: ambienteUso(env ?? process.env),
        timeout: prazo + RESERVA_PRAZO_MS,
        maxBuffer: MAX_SAIDA_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      };
      const filho = executar(exe, [...ARGS_USO], opcoesFilho, (erro, stdout) => {
        try {
          const saida = typeof stdout === 'string' ? stdout : Buffer.isBuffer(stdout) ? stdout.toString('utf8') : '';
          if (erro) {
            const motivo = motivoDoErro(erro, saida);
            if (motivo !== null) {
              fim({ ok: false, motivo });
              return;
            }
          }
          fim(interpretarSaida(saida, agoraMs));
        } catch {
          fim({ ok: false, motivo: 'erro' });
        }
      });
      if (!feito) {
        relogio = setTimeout(() => {
          if (feito) return;
          fim({ ok: false, motivo: 'tempo' });
          try {
            if (typeof matar === 'function') matar(filho);
          } catch {
            /* nada a fazer */
          }
        }, prazo);
        relogio.unref?.();
      }
    } catch {
      fim({ ok: false, motivo: 'erro' });
    }
  });
}
