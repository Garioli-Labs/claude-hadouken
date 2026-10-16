import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aprendizadoVazio } from '../src/aprendizado/agregar.js';
import { caminhos } from '../src/aprendizado/arquivos.js';
import { caminhoBinario, registrarInstalacao } from '../src/aprendizado/coletor.js';
import { ARQ_TELEMETRIA } from '../src/aprendizado/otlp.js';
import { depoisDoFim, depoisDoInicio, linhasDoInicio, outrasSessoes, pararSemLigado, rodarPasso } from '../src/aprendizado/passo.js';
import {
  ajustesVazios, anexarEventoApr, gravarAjustes, gravarAprendizado, gravarLigado, gravarSugestoes, lerAprendizado, lerCursor, lerEventosApr,
} from '../src/aprendizado/registro.js';
import { gravarJsonAtomico } from '../src/estado.js';

// O passo de aprendizado (spec aprendizado §3.3, §4.6, §6, §7) e a vida do
// Collector nas sessões. Pasta de dados temporária; o Collector nunca sobe
// de verdade (executar, gerar e memLivre falsos), e os hooks rodam com
// HADOUKEN_SEM_PAINEL=1.

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = path.join(repo, 'test', 'fixtures', 'passo-paralelo.mjs');
const ATRASAR = path.join(repo, 'test', 'fixtures', 'atrasar-passo.mjs');
const H = 3_600_000;
const DIA = 24 * H;
// Meio-dia local de hoje: AGORA + 1 min nunca vira o dia (o anúncio e os
// avisos são por dia local), e AGORA + 24 h é sempre o dia seguinte.
const AGORA = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

function novoDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk passo ç '));
  tmps.push(d);
  return d;
}
const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) });
const attrs = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
function linhaPedido(ms) {
  const a = {
    'event.name': S('api_request'), model: S('claude-sonnet-5-5'), effort: S('high'), query_source: S('repl_main_thread'), cost_usd: { doubleValue: 0.01 },
    input_tokens: I(100), output_tokens: I(10), cache_read_tokens: I(1000), cache_creation_tokens: I(5), duration_ms: I(2000), ttft_ms: I(700),
  };
  return JSON.stringify({ resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: [{ timeUnixNano: `${BigInt(ms) * 1_000_000n}`, body: S('claude_code.api_request'), attributes: attrs(a) }] }] }] });
}
function escreverTelemetria(dir, linhas, { anexar = false } = {}) {
  fs.mkdirSync(caminhos(dir).otel, { recursive: true });
  const arq = path.join(caminhos(dir).otel, ARQ_TELEMETRIA);
  (anexar ? fs.appendFileSync : fs.writeFileSync)(arq, linhas.map((l) => `${l}\n`).join(''));
}
function pedidos(dir, agoraMs) {
  let n = 0;
  for (const s of lerAprendizado(dir, agoraMs).semanas) for (const v of Object.values(s.modelos)) n += v[0];
  return n;
}
function estadoCom(dir, sessoes) {
  gravarJsonAtomico(path.join(dir, 'estado.json'), {
    versao: 1, at: new Date(AGORA).toISOString(), five_hour: null, seven_day: null,
    sessoes: Object.fromEntries(Object.entries(sessoes).map(([id, ms]) => [id, { at: new Date(ms).toISOString() }])), historico: [],
  });
}
// Windows forçado, com tasklist e taskkill falsos: o PID 4242 é o Collector.
// tasklist: 'vivo' (o Collector), 'outro' (outro programa), 'morto' (nenhum
// processo com o PID) ou 'falha' (prazo); taskkill: 'ok' ou 'falha'; aoMatar
// roda no momento do taskkill.
const SEM_PROCESSO = 'INFO: No tasks are running which match the specified criteria.\r\n';
function coletorFalso({ tasklist = 'vivo', taskkill = 'ok', pid = 5151, aoMatar = () => {} } = {}) {
  const chamadas = [];
  return {
    chamadas,
    opcoes: {
      plataforma: 'win32', systemRoot: 'C:\\Windows', memLivre: () => 8 * 1024 ** 3, env: {},
      gerar: () => { chamadas.push('gerar'); return { pid, unref() {}, on() {} }; },
      executar: (arq, args) => {
        chamadas.push(`${path.win32.basename(arq)} ${args.join(' ')}`);
        if (arq.endsWith('tasklist.exe')) {
          if (tasklist === 'falha') throw Object.assign(new Error('tasklist: prazo'), { code: 'ETIMEDOUT' });
          if (tasklist === 'morto') return SEM_PROCESSO;
          return tasklist === 'vivo' ? '"otelcol-contrib.exe","4242","Console","1","50 000 K"\r\n' : '"notepad.exe","4242","Console","1","9 000 K"\r\n';
        }
        aoMatar();
        if (taskkill === 'falha') throw new Error('taskkill: acesso negado');
        return '';
      },
    },
  };
}
function gravarPid(dir, emMs) {
  fs.mkdirSync(caminhos(dir).otel, { recursive: true });
  gravarJsonAtomico(caminhos(dir).pid, { v: 1, pid: 4242, em: new Date(emMs).toISOString() });
}
const tiposDe = (dir, agoraMs = AGORA) => lerEventosApr(dir, agoraMs).map((e) => e.tipo);

test('§5.3 e Foco 2: o passo não conta duas vezes e segue o arquivo que cresce', () => {
  const d = novoDir();
  escreverTelemetria(d, [linhaPedido(AGORA - 3000), linhaPedido(AGORA - 2000)]);
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA }).ok, true);
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA }).ok, true);
  assert.equal(pedidos(d, AGORA), 2);
  escreverTelemetria(d, [linhaPedido(AGORA - 1000)], { anexar: true });
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(pedidos(d, AGORA), 3);
  assert.equal(fs.existsSync(caminhos(d).trava), false, 'a trava sai');
});

test('Foco de revisão 3: dois passos em paralelo não contam em dobro, e só um vencedor lê os registros', async () => {
  const d = novoDir();
  escreverTelemetria(d, Array.from({ length: 2000 }, (_, i) => linhaPedido(AGORA - 10_000 + i)));
  const rodar = () => new Promise((resolver) => {
    const p = spawn(process.execPath, [FIXTURE, d, String(AGORA)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let saida = '';
    p.stdout.on('data', (b) => { saida += b; });
    p.on('close', () => resolver(JSON.parse(saida)));
  });
  const [a, b] = await Promise.all([rodar(), rodar()]);
  assert.ok(a.ok || b.ok);
  for (const r of [a, b]) if (!r.ok) assert.equal(r.motivo, 'ocupada', JSON.stringify(r));
  // O vencedor é quem pegou a trava primeiro: lê os 2000. O outro ou achou a
  // trava ocupada, ou rodou depois e não achou nada novo depois do cursor.
  const vencedores = [a, b].filter((r) => r.ok && r.lidos > 0);
  assert.equal(vencedores.length, 1, JSON.stringify([a, b]));
  assert.equal(vencedores[0].lidos, 2000);
  for (const r of [a, b]) if (r.ok && r !== vencedores[0]) assert.equal(r.lidos, 0);
  assert.equal(pedidos(d, AGORA), 2000);
  assert.equal(fs.existsSync(caminhos(d).trava), false, 'a trava sai nos dois processos');
});

test('§6: linha corrompida vira evento, o resto conta e nenhum ajuste sai daquela leitura', () => {
  const d = novoDir();
  escreverTelemetria(d, ['{quebrado', linhaPedido(AGORA - 1000)]);
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(pedidos(d, AGORA), 1);
  assert.deepEqual(tiposDe(d), ['telemetria-corrompida']);
  assert.equal(fs.existsSync(caminhos(d).ajustes), false, 'ajustar não rodou');
  rodarPasso({ dir: d, agoraMs: AGORA });
  assert.equal(fs.existsSync(caminhos(d).ajustes), true, 'a leitura seguinte, limpa, ajusta');
});

test('§4.1: janela do Fable pela leitura oficial, disparo da guarda e limite atingido', () => {
  const d = novoDir();
  const reset = AGORA + 3 * DIA;
  gravarJsonAtomico(path.join(d, 'uso-oficial.json'), { versao: 1, lidoEm: new Date(AGORA - 60_000).toISOString(), modelos: { fable: { pct: 72, resetsAtMs: reset } } });
  gravarJsonAtomico(path.join(d, 'guarda-eventos.json'), { v: 1, eventos: [
    { at: new Date(AGORA - 30_000).toISOString(), tipo: 'disparo', detalhe: 'G7' },
    { at: new Date(AGORA - 20_000).toISOString(), tipo: 'disparo', detalhe: 'G9' },
    { at: new Date(AGORA - 20_000).toISOString(), tipo: 'negado', detalhe: 'G6' },
  ] });
  gravarJsonAtomico(path.join(d, 'limites-atingidos.json'), { v: 1, fable: AGORA - 10_000 });
  rodarPasso({ dir: d, agoraMs: AGORA });
  const [j] = lerAprendizado(d, AGORA).janelas.fable;
  assert.equal(j.reset, reset);
  assert.equal(j.disparou, true);
  assert.equal(j.esgotou, AGORA - 10_000);
  assert.equal(j.max, 100);
  assert.deepEqual(lerAprendizado(d, AGORA).janelas.h5, []);
});

test('§4.1: pontos novos do histórico entram na janela de 5h com o reset da leitura atual', () => {
  const d = novoDir();
  const resetS = Math.floor((AGORA + 2 * H) / 1000);
  const ponto = (ms, h5) => ({ at: new Date(ms).toISOString(), h5, d7: 40 });
  gravarJsonAtomico(path.join(d, 'estado.json'), {
    versao: 1, at: new Date(AGORA - 60_000).toISOString(),
    five_hour: { used_percentage: 81, resets_at: resetS, at: new Date(AGORA - 60_000).toISOString() }, seven_day: null,
    sessoes: {}, historico: [ponto(AGORA - 20 * 60_000, 58), ponto(AGORA - 15 * 60_000, 66), ponto(AGORA - 10 * 60_000, 76)],
  });
  rodarPasso({ dir: d, agoraMs: AGORA });
  const [j] = lerAprendizado(d, AGORA).janelas.h5;
  assert.equal(j.max, 81);
  assert.equal(j.cruzou['65'], AGORA - 15 * 60_000);
  assert.equal(j.cruzou['75'], AGORA - 10 * 60_000);
  assert.equal(j.cruzou['80'], AGORA - 60_000);
});

test('R11: só o SessionStart startup conta sessão', () => {
  const d = novoDir();
  rodarPasso({ dir: d, agoraMs: AGORA, inicio: true });
  rodarPasso({ dir: d, agoraMs: AGORA, inicio: false });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 1);
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 's2', source: 'resume', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 1);
  depoisDoInicio({ dir: d, sessionId: 's3', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.equal(lerAprendizado(d, AGORA).sessoes, 2);
});

// Maduro (10 dias, 25 sessões) com 2 das 3 últimas semanas esgotadas: a
// guarda apertaria o teto7d de 72 para 67, abaixo do piso de 70 (ajuste-fora).
function maduroComForaNaGuarda(d) {
  const ap = aprendizadoVazio(AGORA - 10 * DIA);
  ap.sessoes = 25;
  const janela = (reset, max, esgotou = null) => ({ reset, max, cruzou: {}, esgotou, disparou: false });
  ap.janelas.d7 = [janela(AGORA - 15 * DIA, 100, AGORA - 16 * DIA), janela(AGORA - 8 * DIA, 60), janela(AGORA - DIA, 100, AGORA - 2 * DIA)];
  assert.equal(gravarAprendizado(d, ap).ok, true);
  gravarJsonAtomico(path.join(d, 'config.json'), { guarda: { teto7d: 72 } });
}

test('§6 e ruling da Task 5: ajuste-fora vira evento no máximo uma vez por item por dia local', () => {
  const d = novoDir();
  maduroComForaNaGuarda(d);
  const fora = () => tiposDe(d, AGORA + 2 * DIA).filter((t) => t === 'ajuste-fora').length;
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA }).ok, true);
  assert.equal(fora(), 1);
  rodarPasso({ dir: d, agoraMs: AGORA + 60_000 });
  rodarPasso({ dir: d, agoraMs: AGORA + 2 * 60_000 });
  assert.equal(fora(), 1, 'no mesmo dia, o mesmo item não repete');
  assert.equal(lerCursor(d, AGORA + DIA).fora['guarda.teto7d'], lerCursor(d, AGORA).fora['guarda.teto7d']);
  rodarPasso({ dir: d, agoraMs: AGORA + DIA });
  assert.equal(fora(), 2, 'no dia seguinte, de novo');
});

test('§6 (revisão M2): com o aprendizado.json sem gravar, o ajuste-fora não repete e o cursor do arquivo não anda', (t) => {
  const d = novoDir();
  maduroComForaNaGuarda(d);
  escreverTelemetria(d, [linhaPedido(AGORA - 1000)]);
  const destino = path.resolve(caminhos(d).aprendizado);
  const original = fs.renameSync;
  // O rename final do aprendizado.json falha (EIO, sem nova tentativa).
  t.mock.method(fs, 'renameSync', (de, para) => {
    if (path.resolve(String(para)) === destino) throw Object.assign(new Error('falha de disco simulada'), { code: 'EIO' });
    return original(de, para);
  });
  assert.deepEqual(rodarPasso({ dir: d, agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  assert.deepEqual(rodarPasso({ dir: d, agoraMs: AGORA + 60_000 }), { ok: false, motivo: 'erro' });
  const fora = () => tiposDe(d, AGORA + 2 * DIA).filter((x) => x === 'ajuste-fora').length;
  assert.equal(fora(), 1, 'a falha não repete o evento');
  assert.equal(lerCursor(d, AGORA).arquivo, null, 'o cursor da telemetria não andou: a leitura se refaz');
  t.mock.restoreAll();
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA + 2 * 60_000 }).ok, true);
  assert.equal(fora(), 1);
  assert.equal(pedidos(d, AGORA), 1, 'o pedido conta uma vez, depois da falha');
});

test('menor M-1 do portão v0.4.0: cursor sem gravar volta o aprendizado e o pedido conta uma vez', (t) => {
  const d = novoDir();
  maduroComForaNaGuarda(d);
  escreverTelemetria(d, [linhaPedido(AGORA - 1000)]);
  const destino = path.resolve(caminhos(d).cursor);
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (de, para) => {
    if (path.resolve(String(para)) === destino) throw Object.assign(new Error('falha de disco simulada'), { code: 'EIO' });
    return original(de, para);
  });
  assert.deepEqual(rodarPasso({ dir: d, agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  t.mock.restoreAll();
  assert.ok(tiposDe(d, AGORA + 1000).includes('erro'));
  assert.equal(pedidos(d, AGORA), 0, 'o aprendizado voltou ao de antes');
  assert.equal(rodarPasso({ dir: d, agoraMs: AGORA + 60_000 }).ok, true);
  assert.equal(pedidos(d, AGORA), 1, 'o pedido conta uma vez, depois da falha');
});

test('§4.6: o anúncio sai uma vez por dia e só com novidade, no texto da spec', () => {
  const d = novoDir();
  const ontem = new Date(AGORA - DIA).toISOString();
  const aj = ajustesVazios();
  aj.seq = 1;
  aj.vigentes['painel.intervaloS'] = 60;
  aj.registros.push({ id: 'a1', item: 'painel.intervaloS', antes: 30, depois: 60, motivo: 'fora-do-horario', em: ontem, origem: 'auto' });
  gravarAjustes(d, aj);
  gravarSugestoes(d, { v: 1, seq: 1, lista: [{ id: 's1', estado: 'pendente', em: ontem, tipo: 'afrouxar', item: 'guarda.teto7d', de: 80, para: 85 }] });
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA }), [
    'Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /hadouken:aprender status).',
  ]);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA }), [], 'no mesmo dia, nada');
  aj.seq = 2;
  aj.vigentes['painel.amarelo'] = 70;
  aj.registros.push({ id: 'a2', item: 'painel.amarelo', antes: 75, depois: 70, motivo: 'faixa-historico', em: new Date(AGORA).toISOString(), origem: 'auto' });
  gravarAjustes(d, aj);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 60_000 }), [], 'novidade no mesmo dia espera o dia seguinte');
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA }), [
    'Aprendizado: 1 ajuste novo (faixa amarela 75→70%) (use /hadouken:aprender status).',
  ]);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 2 * DIA }), [], 'sem novidade, nada');
});

test('§6: o aviso do Collector sai uma vez por dia, só com evento das últimas 24 h', () => {
  const d = novoDir();
  anexarEventoApr(d, 'porta-ocupada', AGORA - 1000);
  const [linha] = linhasDoInicio({ dir: d, agoraMs: AGORA });
  assert.match(linha, /^Aprendizado: o Collector não subiu porque a porta 127\.0\.0\.1:47318 está ocupada/);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 1000 }), []);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA + 1000 }), [], 'o evento de ontem não repete');
  anexarEventoApr(d, 'pouca-ram', AGORA + DIA);
  assert.match(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA + 2000 })[0], /memória livre/);
});

test('R2: outras sessões ativas, fora a que está encerrando', () => {
  const estado = { sessoes: { s1: { at: new Date(AGORA - 60_000).toISOString() }, s2: { at: new Date(AGORA - 2 * H).toISOString() } } };
  assert.deepEqual(outrasSessoes(estado, 's1', AGORA), { recente: false, ultimaMs: AGORA - 2 * H });
  assert.deepEqual(outrasSessoes(estado, 's2', AGORA), { recente: true, ultimaMs: AGORA - 60_000 });
  assert.deepEqual(outrasSessoes(null, 's1', AGORA), { recente: false, ultimaMs: null });
});

test('§3.3: Collector órfão (vivo, sem sessão há mais de 30 min) é parado e o evento registrado', () => {
  const d = novoDir();
  gravarPid(d, AGORA - 2 * H);
  estadoCom(d, { velha: AGORA - H });
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  // Revisão (foco 4): a consulta do coletorVivo vale para a parada, sem
  // segunda consulta antes do taskkill.
  assert.deepEqual(c.chamadas, ['tasklist.exe /FI PID eq 4242 /FO CSV /NH', 'taskkill.exe /pid 4242 /t /f']);
  const tipos = tiposDe(d);
  assert.ok(tipos.includes('orfao'));
  assert.ok(tipos.includes('coletor-ausente'), 'sem binário, a subida registra o motivo');
});

test('§3.3: Collector vivo e não órfão fica, sem segunda subida', () => {
  const d = novoDir();
  gravarPid(d, AGORA - 10 * 60_000);
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.deepEqual(c.chamadas, ['tasklist.exe /FI PID eq 4242 /FO CSV /NH'], 'uma consulta só, nada morto, nada gerado');
  assert.deepEqual(tiposDe(d), []);
  assert.ok(fs.existsSync(caminhos(d).pid));
});

test('Task 8: consulta que falha não apaga o PID, não trata como órfão nem sobe outro Collector', () => {
  const d = novoDir();
  gravarPid(d, AGORA - 2 * H);
  estadoCom(d, { velha: AGORA - H });
  const c = coletorFalso({ tasklist: 'falha' });
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.deepEqual(c.chamadas, ['tasklist.exe /FI PID eq 4242 /FO CSV /NH'], 'só a consulta: sem taskkill, sem segunda consulta, sem gerar');
  assert.ok(fs.existsSync(caminhos(d).pid), 'o PID fica');
  assert.ok(!tiposDe(d).includes('orfao'));
  assert.equal(lerAprendizado(d, AGORA).sessoes, 1, 'o passo roda do mesmo jeito');
});

test('Task 8 e revisão: parar o órfão com erro vira o evento parar-falhou, sem nova tentativa nem subida, em no máximo 3 chamadas', () => {
  const d = novoDir();
  gravarPid(d, AGORA - 2 * H);
  const c = coletorFalso({ taskkill: 'falha' });
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  // O pior caso do órfão: coletorVivo, taskkill e a consulta depois do
  // taskkill que falhou, 3 × 1,5 s (CONSULTA_PRAZO_MS).
  assert.deepEqual(c.chamadas, ['tasklist.exe /FI PID eq 4242 /FO CSV /NH', 'taskkill.exe /pid 4242 /t /f', 'tasklist.exe /FI PID eq 4242 /FO CSV /NH']);
  assert.deepEqual(tiposDe(d), ['orfao', 'parar-falhou']);
  assert.ok(fs.existsSync(caminhos(d).pid), 'o PID fica para a próxima sessão');
});

test('Task 8: subida com erro vira coletor-falhou, um evento por sessão e um aviso por dia', () => {
  const d = novoDir();
  fs.mkdirSync(caminhos(d).bin, { recursive: true });
  fs.writeFileSync(caminhoBinario(d, 'win32'), 'binário falso');
  assert.equal(registrarInstalacao(d, 'win32').ok, true);
  const c = coletorFalso({ pid: 0 });
  depoisDoInicio({ dir: d, sessionId: 'a', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.deepEqual(c.chamadas, ['gerar']);
  assert.deepEqual(tiposDe(d), ['coletor-falhou']);
  assert.match(linhasDoInicio({ dir: d, agoraMs: AGORA + 1000 })[0], /^Aprendizado: o Collector parou com erro/);
  depoisDoInicio({ dir: d, sessionId: 'b', source: 'resume', agoraMs: AGORA + 2000, opcoesColetor: c.opcoes });
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 3000 }), [], 'o aviso não repete no mesmo dia');
});

test('§3.3 e R2: SessionEnd para o Collector só sem outra sessão nos últimos 5 min', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  estadoCom(d, { saindo: AGORA - 10_000, outra: AGORA - 60_000 });
  const c1 = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c1.opcoes });
  assert.ok(!c1.chamadas.some((x) => x.startsWith('taskkill')), 'outra sessão ativa: fica');
  estadoCom(d, { saindo: AGORA - 10_000, outra: AGORA - 20 * 60_000 });
  const c2 = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c2.opcoes });
  assert.ok(c2.chamadas.includes('taskkill.exe /pid 4242 /t /f'));
});

// Rodada 2 da revisão da Task 12 (passeio manual com o Collector real): o
// estado.sessoes não é limpo no SessionEnd, então uma sessão que acabou de
// fechar contava como aberta por 5 min e o fim da última sessão não parava o
// Collector. A sessão encerrada fica marcada (otel/encerradas) e sai da
// conta de outrasSessoes.
test('rodada 2: A e depois B fecham em menos de 5 min; o fim de B (a última) para o Collector', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  const fimA = AGORA - 4 * 60_000;
  estadoCom(d, { a: fimA - 5000, b: fimA - 20_000 });
  const ca = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'a', agoraMs: fimA, opcoesColetor: ca.opcoes });
  assert.ok(!ca.chamadas.some((x) => x.startsWith('taskkill')), 'B ainda aberta: o fim de A não para');
  estadoCom(d, { a: fimA - 5000, b: AGORA - 6000 });
  const cb = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'b', agoraMs: AGORA, opcoesColetor: cb.opcoes });
  assert.ok(cb.chamadas.includes('taskkill.exe /pid 4242 /t /f'), 'A já fechou: o fim de B para o Collector');
});

test('rodada 2: A aberta e B fechando; o Collector fica', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  estadoCom(d, { a: AGORA - 60_000, b: AGORA - 5000 });
  const c = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'b', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.ok(!c.chamadas.some((x) => x.startsWith('taskkill')));
});

test('rodada 2: a sessão encerrada que volta (resume) conta de novo como aberta', () => {
  const d = novoDir();
  gravarPid(d, AGORA - 10 * 60_000);
  const fimA = AGORA - 3 * 60_000;
  estadoCom(d, { a: fimA - 5000, b: fimA - 10_000 });
  depoisDoFim({ dir: d, sessionId: 'a', agoraMs: fimA, opcoesColetor: coletorFalso().opcoes });
  // A volta: o SessionStart dela tira a marca.
  depoisDoInicio({ dir: d, sessionId: 'a', source: 'resume', agoraMs: fimA + 30_000, opcoesColetor: coletorFalso().opcoes });
  estadoCom(d, { a: fimA - 5000, b: AGORA - 5000 });
  const c = coletorFalso();
  depoisDoFim({ dir: d, sessionId: 'b', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.ok(!c.chamadas.some((x) => x.startsWith('taskkill')), 'A voltou: o fim de B não para');
});

test('rodada 2: marca de fim mais velha que a barra da sessão (voltou sem SessionStart do aprendizado) não vale', () => {
  const fimA = AGORA - 4 * 60_000;
  const encerradas = new Map([['a', fimA]]);
  const voltou = { sessoes: { a: { at: new Date(AGORA - 30_000).toISOString() } } };
  assert.deepEqual(outrasSessoes(voltou, 'b', AGORA, encerradas), { recente: true, ultimaMs: AGORA - 30_000 });
  const fechou = { sessoes: { a: { at: new Date(fimA - 5000).toISOString() } } };
  assert.deepEqual(outrasSessoes(fechou, 'b', AGORA, encerradas), { recente: false, ultimaMs: null });
});

test('rodada 2: a regra do órfão ignora a sessão encerrada', () => {
  const fimVelha = AGORA - 10 * 60_000;
  // Sem marca (sessão que caiu sem SessionEnd), a velha ainda segura o
  // Collector, como antes.
  const d0 = novoDir();
  gravarPid(d0, AGORA - 2 * H);
  estadoCom(d0, { velha: fimVelha - 5000 });
  const c0 = coletorFalso();
  depoisDoInicio({ dir: d0, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c0.opcoes });
  assert.ok(!c0.chamadas.some((x) => x.startsWith('taskkill')), 'sem marca: não é órfão');
  // Com a marca do fim, só conta a outra, parada há 40 min: órfão.
  const d = novoDir();
  gravarPid(d, AGORA - 2 * H);
  estadoCom(d, { velha: fimVelha - 5000, outra: fimVelha - 60_000 });
  depoisDoFim({ dir: d, sessionId: 'velha', agoraMs: fimVelha, opcoesColetor: coletorFalso().opcoes });
  estadoCom(d, { velha: fimVelha - 5000, outra: AGORA - 40 * 60_000 });
  const c = coletorFalso();
  depoisDoInicio({ dir: d, sessionId: 'nova', source: 'startup', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.ok(c.chamadas.includes('taskkill.exe /pid 4242 /t /f'), 'a velha encerrada não segura o órfão');
  assert.ok(tiposDe(d).includes('orfao'));
});

test('§3.3 (ruling I2): o SessionEnd para o Collector antes do passo', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  escreverTelemetria(d, [linhaPedido(AGORA - 1000)]);
  let passoJaRodou = null;
  const c = coletorFalso({ aoMatar: () => { passoJaRodou = fs.existsSync(caminhos(d).aprendizado); } });
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.equal(passoJaRodou, false, 'o taskkill veio antes do passo');
  assert.equal(pedidos(d, AGORA), 1, 'e o passo rodou depois');
});

test('§3.3 (ruling I2): parar com erro no SessionEnd vira o evento parar-falhou e o passo roda', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  const c = coletorFalso({ tasklist: 'falha' });
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: c.opcoes });
  assert.ok(!c.chamadas.some((x) => x.startsWith('taskkill')));
  assert.deepEqual(tiposDe(d), ['parar-falhou']);
  assert.ok(fs.existsSync(caminhos(d).pid));
  assert.ok(fs.existsSync(caminhos(d).aprendizado));
});

test('Task 10 e revisão I1: desligado com PID, o Collector vivo é parado uma vez; morto ou de outro programa, o PID sai; sem resposta, nada', () => {
  const Q = 'tasklist.exe /FI PID eq 4242 /FO CSV /NH';
  const K = 'taskkill.exe /pid 4242 /t /f';
  const d = novoDir();
  gravarPid(d, AGORA - H);
  const vivo = coletorFalso();
  pararSemLigado({ dir: d, agoraMs: AGORA, opcoesColetor: vivo.opcoes });
  assert.deepEqual(vivo.chamadas, [Q, K], 'uma consulta só antes do taskkill');
  assert.equal(fs.existsSync(caminhos(d).pid), false);
  assert.equal(fs.existsSync(caminhos(d).eventos), false, 'sucesso não grava evento');

  gravarPid(d, AGORA - H);
  const outro = coletorFalso({ tasklist: 'outro' });
  pararSemLigado({ dir: d, agoraMs: AGORA, opcoesColetor: outro.opcoes });
  assert.ok(!outro.chamadas.includes(K), 'PID de outro programa: não mata');
  assert.equal(fs.existsSync(caminhos(d).pid), false, 'e o PID que não é do Collector sai');

  gravarPid(d, AGORA - H);
  const morto = coletorFalso({ tasklist: 'morto' });
  pararSemLigado({ dir: d, agoraMs: AGORA, opcoesColetor: morto.opcoes });
  assert.ok(!morto.chamadas.includes(K));
  assert.equal(fs.existsSync(caminhos(d).pid), false, 'o PID de um processo morto sai');
  assert.equal(fs.existsSync(caminhos(d).eventos), false);

  gravarPid(d, AGORA - H);
  const mudo = coletorFalso({ tasklist: 'falha' });
  pararSemLigado({ dir: d, agoraMs: AGORA, opcoesColetor: mudo.opcoes });
  assert.deepEqual(mudo.chamadas, [Q], 'sem resposta: nada mais');
  assert.ok(fs.existsSync(caminhos(d).pid), 'o PID fica');
  assert.equal(fs.existsSync(caminhos(d).eventos), false);

  const teimoso = coletorFalso({ taskkill: 'falha' });
  pararSemLigado({ dir: d, agoraMs: AGORA, opcoesColetor: teimoso.opcoes });
  assert.deepEqual(teimoso.chamadas, [Q, K, Q], 'uma tentativa, no máximo 3 chamadas');
  assert.ok(fs.existsSync(caminhos(d).pid));
  assert.deepEqual(tiposDe(d), ['parar-falhou']);
});

test('revisão: a parada que falha vira aviso uma vez por dia, no texto fixo', () => {
  const d = novoDir();
  gravarPid(d, AGORA - H);
  const teimoso = coletorFalso({ taskkill: 'falha' });
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA, opcoesColetor: teimoso.opcoes });
  assert.deepEqual(tiposDe(d), ['parar-falhou']);
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 1000 }), [
    'Aprendizado: o Collector não pôde ser parado; o hadouken tenta de novo na próxima sessão. Se o aviso continuar, encerre o processo otelcol-contrib.',
  ]);
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA + 2000, opcoesColetor: teimoso.opcoes });
  assert.deepEqual(linhasDoInicio({ dir: d, agoraMs: AGORA + 3000 }), [], 'no mesmo dia, nada');
  depoisDoFim({ dir: d, sessionId: 'saindo', agoraMs: AGORA + DIA, opcoesColetor: teimoso.opcoes });
  assert.equal(linhasDoInicio({ dir: d, agoraMs: AGORA + DIA + 1000 }).length, 1, 'no dia seguinte, de novo');
});

test('nenhuma das funções lança, mesmo sem pasta válida', () => {
  assert.deepEqual(rodarPasso({ dir: undefined, agoraMs: AGORA }), { ok: false, motivo: 'erro' });
  assert.deepEqual(linhasDoInicio({ dir: undefined, agoraMs: AGORA }), []);
  assert.doesNotThrow(() => depoisDoInicio({ dir: undefined, sessionId: 'x', source: 'startup', agoraMs: AGORA }));
  assert.doesNotThrow(() => depoisDoFim({ dir: undefined, sessionId: 'x', agoraMs: AGORA }));
  assert.doesNotThrow(() => pararSemLigado({ dir: undefined, agoraMs: AGORA }));
});

function ambienteDoHook(home) {
  assert.ok(home.startsWith(os.tmpdir()));
  return {
    ...process.env, HADOUKEN_HOME: home, CLAUDE_PLUGIN_ROOT: repo, HADOUKEN_SEM_PAINEL: '1',
    HADOUKEN_SETTINGS: path.join(home, 'settings.json'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  };
}
function hook(nome, home, entrada) {
  const r = spawnSync(process.execPath, [path.join(repo, 'src', 'hooks', nome)], { input: JSON.stringify(entrada), env: ambienteDoHook(home), encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
// O hook com a pré-carga atrasar-passo.mjs: devolve o stdout e o instante em
// que o primeiro byte dele chegou aqui.
function hookComAtraso(nome, home, entrada, registro) {
  return new Promise((resolver, rejeitar) => {
    const p = spawn(process.execPath, ['--import', pathToFileURL(ATRASAR).href, path.join(repo, 'src', 'hooks', nome)], {
      env: { ...ambienteDoHook(home), HADOUKEN_TESTE_ORDEM: registro }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let saida = '';
    let erro = '';
    let primeiroMs = null;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (x) => { if (primeiroMs === null) primeiroMs = Date.now(); saida += x; });
    p.stderr.on('data', (x) => { erro += x; });
    p.on('error', rejeitar);
    p.on('close', (status) => (status === 0 ? resolver({ saida, primeiroMs }) : rejeitar(new Error(`status ${status}: ${erro}`))));
    p.stdin.end(JSON.stringify(entrada));
  });
}

test('R13: ligado, o SessionStart manda o aviso por systemMessage, fora do contexto; o SessionEnd roda o passo', async () => {
  const d = novoDir();
  gravarLigado(d, { chaves: {}, criouEnv: false }, AGORA);
  const inicio = { session_id: 'sessao-a', hook_event_name: 'SessionStart', source: 'startup' };
  // Revisão M3: com o passo atrasado de propósito, a saída chega antes de o
  // passo gravar o aprendizado.json.
  const registro = path.join(d, 'ordem.txt');
  const r = await hookComAtraso('session-start.js', d, inicio, registro);
  const primeira = JSON.parse(r.saida);
  assert.equal(primeira.systemMessage, undefined, 'nada a anunciar ainda');
  assert.ok(fs.existsSync(caminhos(d).aprendizado), 'o passo rodou');
  const gravouMs = Number(fs.readFileSync(registro, 'utf8').trim().split('\n')[0]);
  assert.ok(r.primeiroMs !== null && r.primeiroMs < gravouMs, `a saída (${r.primeiroMs}) chega antes da gravação do passo (${gravouMs})`);
  // Sem binário (ou sem RAM), a subida deixou um evento que vira aviso.
  const segunda = JSON.parse(hook('session-start.js', d, { ...inicio, source: 'resume' }));
  assert.match(segunda.systemMessage, /^Aprendizado: /);
  assert.doesNotMatch(segunda.hookSpecificOutput.additionalContext, /Aprendizado/);
  escreverTelemetria(d, [linhaPedido(Date.now() - 1000)]);
  assert.equal(hook('session-end.js', d, { session_id: 'sessao-a', hook_event_name: 'SessionEnd', reason: 'exit' }), '');
  assert.equal(pedidos(d, Date.now()), 1);
});

test('§11: desligado, os hooks de sessão não criam nenhum arquivo do aprendizado', () => {
  const d = novoDir();
  const saida = JSON.parse(hook('session-start.js', d, { session_id: 'sessao-b', hook_event_name: 'SessionStart', source: 'startup' }));
  assert.equal(saida.systemMessage, undefined);
  hook('session-end.js', d, { session_id: 'sessao-b', hook_event_name: 'SessionEnd', reason: 'exit' });
  const c = caminhos(d);
  for (const k of ['otel', 'aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos', 'trava']) assert.equal(fs.existsSync(c[k]), false, k);
});
