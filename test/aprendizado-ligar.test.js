import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhos, ligadoExiste } from '../src/aprendizado/arquivos.js';
import { FIXADO } from '../src/aprendizado/baixar.js';
import { caminhoBinario, lerPid, registrarInstalacao } from '../src/aprendizado/coletor.js';
import { desligar, ligar, previa, previaDesligar } from '../src/aprendizado/ligar.js';
import { lerLigado } from '../src/aprendizado/registro.js';
import { CHAVES_LIGAR } from '../src/aprendizado/settings-env.js';

// O ligar e o desligar de ponta a ponta (spec aprendizado §3.2, §6, R4),
// com download, extração, subida e parada falsos. Pasta de dados e
// settings.json temporários; ambiente vazio (nunca o process.env de quem roda
// o teste, que pode ter OTEL_* de verdade).

const [PLATAFORMA, ARCH] = Object.keys(FIXADO)[0].split('-');
const CHAVE = `${PLATAFORMA}-${ARCH}`;
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);
const ORIGINAL = '{\n  "model": "opus",\n  "env": {\n    "MINHA": "x"\n  }\n}\n';
const tmps = [];
after(() => {
  for (const d of tmps) {
    try { fs.chmodSync(path.join(d, 'settings.json'), 0o644); } catch { /* não existe */ }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function cenario() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hdk ligar ç '));
  tmps.push(raiz);
  const dir = path.join(raiz, 'hadouken');
  fs.mkdirSync(dir);
  const arquivo = path.join(raiz, 'settings.json');
  fs.writeFileSync(arquivo, ORIGINAL);
  return { raiz, dir, arquivo };
}
const listar = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : []);
const baixarOk = async ({ destino, chave }) => {
  assert.equal(chave, CHAVE);
  fs.writeFileSync(destino, 'tar.gz falso');
  return { ok: true, bytes: 12 };
};
function extrairOk({ dir, tarGz }) {
  assert.ok(fs.existsSync(tarGz), 'extrai do .tar.gz baixado');
  fs.writeFileSync(caminhoBinario(dir, PLATAFORMA), 'binário falso');
  return { ok: registrarInstalacao(dir, PLATAFORMA).ok };
}
const nuncaBaixar = async () => { throw new Error('não devia baixar'); };
const base = (c, extra = {}) => ({
  dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA, ambiente: {}, plataforma: PLATAFORMA, arch: ARCH,
  baixar: baixarOk, extrair: extrairOk, parar: () => ({ ok: true, motivo: 'sem-pid' }),
  // A Emenda A3 decide o padrão; aqui ele é fixo, e os dois testes que exigem
  // o Collector o ligam explicitamente com subir falso.
  exigirColetor: false,
  subir: () => { throw new Error('não devia subir'); },
  ...extra,
});
async function ligado(c, extra = {}) {
  const p = previa(base(c));
  assert.equal(p.ok, true);
  const r = await ligar(base(c, { codigo: p.codigo, ...extra }));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test('§3.2 passo 1 e R4: a prévia mostra o plano e o código e não grava nada', () => {
  const c = cenario();
  const antes = listar(c.raiz);
  const p = previa(base(c));
  assert.equal(p.ok, true);
  assert.match(p.codigo, /^[0-9a-f]{8}$/);
  assert.equal(p.plano.chave, CHAVE);
  assert.equal(p.plano.host, '127.0.0.1');
  assert.equal(p.plano.porta, 47318);
  assert.equal(p.plano.pasta, caminhos(c.dir).otel);
  assert.equal(p.plano.arquivo, c.arquivo);
  assert.equal(p.plano.baixar, true);
  assert.deepEqual(p.plano.adicionar, Object.keys(CHAVES_LIGAR));
  assert.deepEqual(listar(c.raiz), antes);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(previa(base(c)).codigo, p.codigo, 'o código é estável');
});

test('código errado ou settings.json mudado depois da prévia: recusa sem gravar', async () => {
  const c = cenario();
  const p = previa(base(c));
  assert.deepEqual(await ligar(base(c, { codigo: '00000000' })), { ok: false, motivo: 'codigo' });
  assert.deepEqual(await ligar(base(c)), { ok: false, motivo: 'codigo' });
  fs.writeFileSync(c.arquivo, ORIGINAL.replace('opus', 'sonnet'));
  assert.deepEqual(await ligar(base(c, { codigo: p.codigo })), { ok: false, motivo: 'codigo' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
});

test('§3.2: ligar baixa, extrai, apaga o .tar.gz, gera a configuração, grava ligado.json e o env', async () => {
  const c = cenario();
  const r = await ligado(c);
  const cm = caminhos(c.dir);
  assert.equal(fs.existsSync(path.join(cm.bin, FIXADO[CHAVE].arquivo)), false, 'o .tar.gz sai');
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.ok(fs.existsSync(cm.config));
  assert.ok(ligadoExiste(c.dir));
  assert.deepEqual(lerLigado(c.dir), { chaves: CHAVES_LIGAR, criouEnv: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(c.arquivo, 'utf8')).env, { MINHA: 'x', ...CHAVES_LIGAR });
  assert.equal(r.backup, `${c.arquivo}.bak-hadouken-${AGORA}`);
  assert.equal(previa(base(c)).motivo, 'ja-ligado');
});

test('§6 primeira linha: hash errado no download → nada fica, settings.json intacto', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, {
    codigo: p.codigo,
    baixar: async ({ destino }) => { fs.writeFileSync(destino, 'meio'); return { ok: false, motivo: 'hash' }; },
    extrair: () => { throw new Error('não devia extrair'); },
  }));
  assert.deepEqual(r, { ok: false, motivo: 'download', detalhe: 'hash' });
  assert.equal(fs.existsSync(path.join(caminhos(c.dir).bin, FIXADO[CHAVE].arquivo)), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('falha na extração → .tar.gz apagado e nada ligado', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, { codigo: p.codigo, extrair: () => ({ ok: false, motivo: 'extrair' }) }));
  assert.deepEqual(r, { ok: false, motivo: 'extrair' });
  assert.equal(fs.existsSync(path.join(caminhos(c.dir).bin, FIXADO[CHAVE].arquivo)), false);
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('R7: binário já instalado e conferido → não baixa de novo', async () => {
  const c = cenario();
  fs.mkdirSync(caminhos(c.dir).bin, { recursive: true });
  fs.writeFileSync(caminhoBinario(c.dir, PLATAFORMA), 'binário falso');
  assert.equal(registrarInstalacao(c.dir, PLATAFORMA).ok, true);
  const p = previa(base(c));
  assert.equal(p.plano.baixar, false);
  const r = await ligar(base(c, { codigo: p.codigo, baixar: nuncaBaixar }));
  assert.equal(r.ok, true);
});

test('§3.2 passo 5: conteúdo ligado no ambiente → recusa na prévia e no ligar', async () => {
  const c = cenario();
  const ambiente = { OTEL_LOG_USER_PROMPTS: '1' };
  assert.deepEqual(previa(base(c, { ambiente })), { ok: false, motivo: 'conteudo-ligado' });
  assert.deepEqual(await ligar(base(c, { ambiente, codigo: '00000000', baixar: nuncaBaixar })), { ok: false, motivo: 'conteudo-ligado' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
});

test('a gravação do settings.json falha → ligado.json sai e o Collector que subiu é parado', async () => {
  const c = cenario();
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: () => ({ ok: true, pid: 4242, evento: null }),
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
    aplicar: () => ({ ok: false, motivo: 'settings-mudou' }),
  }));
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou' });
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(parou, 1);
});

test('Emenda A3: com exigirColetor, sem RAM → não liga e não toca o settings.json', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, { codigo: p.codigo, exigirColetor: true, subir: () => ({ ok: false, motivo: 'pouca-ram', evento: null }) }));
  assert.deepEqual(r, { ok: false, motivo: 'coletor', detalhe: 'pouca-ram' });
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('desligar: tira as chaves, para o Collector, apaga ligado.json e mantém os dados', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  fs.writeFileSync(cm.aprendizado, '{}');
  let parou = 0;
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => { parou++; return { ok: true, motivo: 'parado' }; } });
  assert.equal(d.ok, true);
  assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR));
  assert.equal(d.parado, true);
  assert.equal(d.apagou, false);
  assert.equal(parou, 1);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
  assert.ok(fs.existsSync(cm.aprendizado));
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.equal(fs.existsSync(cm.trava), false, 'a trava sai');
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 2 }), { ok: false, motivo: 'desligado' });
});

test('desligar dados: apaga agregados, ajustes, sugestões, cursor, eventos e a telemetria; fica o binário', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  for (const k of ['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']) fs.writeFileSync(cm[k], '{}');
  fs.writeFileSync(path.join(cm.otel, 'telemetria.jsonl'), '{}\n');
  fs.writeFileSync(path.join(cm.otel, 'telemetria-2026-10-01T00-00-00.000.jsonl'), '{}\n');
  fs.writeFileSync(path.join(c.dir, 'estado.json'), '{"v":1}');
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'dados', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(d.apagou, true);
  for (const k of ['aprendizado', 'ajustes', 'sugestoes', 'cursor', 'eventos']) assert.equal(fs.existsSync(cm[k]), false, k);
  assert.deepEqual(fs.readdirSync(cm.otel), ['bin']);
  assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)));
  assert.ok(fs.existsSync(path.join(c.dir, 'estado.json')), 'os arquivos da barra e da guarda ficam');
});

test('desligar tudo: a pasta otel inteira sai, inclusive o binário; funciona já desligado', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(fs.existsSync(cm.otel), false);
  const deNovo = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 2, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(deNovo.ok, true);
  assert.equal(deNovo.pasta, cm.otel);
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 3, apagar: 'metade' }), { ok: false, motivo: 'uso' });
});

test('desligar com settings.json somente leitura: recusa, ligado.json fica e o Collector não é parado', async () => {
  const c = cenario();
  await ligado(c);
  fs.chmodSync(c.arquivo, 0o444);
  let parou = 0;
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => { parou++; return { ok: true, motivo: 'parado' }; } });
  assert.deepEqual(d, { ok: false, motivo: 'settings-somente-leitura' });
  assert.equal(parou, 0);
  assert.ok(ligadoExiste(c.dir));
});

test('ligado.json inválido: desligar não mexe no settings.json e avisa', async () => {
  const c = cenario();
  await ligado(c);
  fs.writeFileSync(caminhos(c.dir).ligado, 'não é JSON');
  const antes = fs.readFileSync(c.arquivo);
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.equal(d.ligadoInvalido, true);
  assert.deepEqual(d.removidas, []);
  assert.deepEqual(fs.readFileSync(c.arquivo), antes);
  assert.equal(ligadoExiste(c.dir), false);
});

// ------------------------------------------------ além do brief (ruling da T10)

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('§6 última linha: previaDesligar mostra o que sai e a assinatura, sem gravar nada', async () => {
  const c = cenario();
  assert.deepEqual(previaDesligar({ dir: c.dir, arquivo: c.arquivo }), { ok: false, motivo: 'desligado' });
  await ligado(c);
  const antes = listar(c.raiz);
  const bytes = fs.readFileSync(c.arquivo);
  const p = previaDesligar({ dir: c.dir, arquivo: c.arquivo });
  assert.deepEqual(p, {
    ok: true, remover: Object.keys(CHAVES_LIGAR), removeEnv: false, assinatura: sha256(bytes), pasta: caminhos(c.dir).otel, ligadoInvalido: false,
  });
  assert.deepEqual(listar(c.raiz), antes, 'nem trava, nem cópia, nem nada');
  assert.deepEqual(fs.readFileSync(c.arquivo), bytes);
  assert.deepEqual(previaDesligar({ dir: 'hadouken', arquivo: c.arquivo }), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(previaDesligar({ dir: c.dir, arquivo: 'settings.json' }), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(previaDesligar(), { ok: false, motivo: 'argumentos' });
});

test('previaDesligar com settings.json somente leitura dá a recusa que o desligar daria', async () => {
  const c = cenario();
  await ligado(c);
  fs.chmodSync(c.arquivo, 0o444);
  assert.deepEqual(previaDesligar({ dir: c.dir, arquivo: c.arquivo }), { ok: false, motivo: 'settings-somente-leitura' });
});

test('desligar com o esperado da previaDesligar: igual ao desligar sem ele', async () => {
  const c = cenario();
  await ligado(c);
  const p = previaDesligar({ dir: c.dir, arquivo: c.arquivo });
  let parou = 0;
  const d = desligar({
    dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, esperado: p.assinatura, parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
  });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.registroFicou, false);
  assert.deepEqual(d.removidas, p.remover);
  assert.equal(d.backup, `${c.arquivo}.bak-hadouken-${AGORA + 1}`);
  assert.equal(parou, 1);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
});

test('§6 última linha: settings.json mudou depois da previaDesligar → settings-mudou, nada parado nem apagado', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  fs.writeFileSync(cm.aprendizado, '{}');
  const p = previaDesligar({ dir: c.dir, arquivo: c.arquivo });
  const mudado = fs.readFileSync(c.arquivo, 'utf8').replace('"opus"', '"sonnet"');
  fs.writeFileSync(c.arquivo, mudado);
  const antes = listar(c.raiz);
  let parou = 0;
  const d = desligar({
    dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', esperado: p.assinatura,
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
  });
  assert.deepEqual(d, { ok: false, motivo: 'settings-mudou' });
  assert.equal(parou, 0);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), mudado);
  assert.ok(ligadoExiste(c.dir));
  assert.deepEqual(listar(c.raiz), antes, 'nenhum arquivo saiu, e a trava foi solta');
});

test('ligado.json inválido com esperado: a assinatura é conferida mesmo sem chave para tirar', async () => {
  const c = cenario();
  await ligado(c);
  fs.writeFileSync(caminhos(c.dir).ligado, 'não é JSON');
  const p = previaDesligar({ dir: c.dir, arquivo: c.arquivo });
  assert.equal(p.ok, true);
  assert.deepEqual(p.remover, []);
  assert.equal(p.ligadoInvalido, true);
  fs.appendFileSync(c.arquivo, '\n');
  let parou = 0;
  const parar = () => { parou++; return { ok: true, motivo: 'sem-pid' }; };
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, esperado: p.assinatura, parar }), { ok: false, motivo: 'settings-mudou' });
  assert.equal(parou, 0);
  assert.ok(ligadoExiste(c.dir));
  const antes = fs.readFileSync(c.arquivo);
  const p2 = previaDesligar({ dir: c.dir, arquivo: c.arquivo });
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 2, esperado: p2.assinatura, parar });
  assert.equal(d.ok, true);
  assert.equal(d.ligadoInvalido, true);
  assert.deepEqual(d.removidas, []);
  assert.equal(d.backup, null);
  assert.deepEqual(fs.readFileSync(c.arquivo), antes);
  assert.equal(parou, 1);
});

// Rodada 2 da revisão da Task 10: o Collector pode estar de pé, então o
// binário fica também em tudo (nunca se apaga o binário de um processo vivo).
test('desligar com a parada sem resposta (erro): o arquivo de PID e o binário ficam, também em dados e tudo', async () => {
  for (const alcance of ['nada', 'dados', 'tudo']) {
    const c = cenario();
    await ligado(c);
    const cm = caminhos(c.dir);
    fs.writeFileSync(cm.pid, '{"v":1,"pid":4242,"em":"2026-10-08T15:00:00.000Z"}');
    fs.writeFileSync(cm.aprendizado, '{}');
    fs.writeFileSync(path.join(cm.otel, 'telemetria.jsonl'), '{}\n');
    const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar: () => ({ ok: false, motivo: 'erro' }) });
    assert.equal(d.ok, true, alcance);
    assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR), alcance);
    assert.equal(d.parado, false, alcance);
    assert.equal(d.apagou, false, `${alcance}: o PID ficou, então nem tudo saiu`);
    assert.ok(fs.existsSync(cm.pid), alcance);
    assert.equal(ligadoExiste(c.dir), false, alcance);
    if (alcance === 'nada') continue;
    assert.equal(fs.existsSync(cm.aprendizado), false, alcance);
    assert.deepEqual(fs.readdirSync(cm.otel).sort(), ['bin', 'coletor.pid'], alcance);
  }
});

test('desligar tudo com o PID de outro programa (já apagado pela parada): a pasta otel sai inteira', async () => {
  const c = cenario();
  await ligado(c);
  const cm = caminhos(c.dir);
  const parar = ({ dir }) => { fs.rmSync(caminhos(dir).pid, { force: true }); return { ok: false, motivo: 'outro-processo' }; };
  fs.writeFileSync(cm.pid, '{"v":1,"pid":4242,"em":"2026-10-08T15:00:00.000Z"}');
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar });
  assert.equal(d.ok, true);
  assert.equal(d.parado, false);
  assert.equal(d.apagou, true);
  assert.equal(fs.existsSync(cm.otel), false);
});

test('ligar chama o download só com destino e chave e antes apaga as sobras velhas (.parte, .tar.gz); as novas ficam', async () => {
  const c = cenario();
  const cm = caminhos(c.dir);
  fs.mkdirSync(cm.bin, { recursive: true });
  const destino = path.join(cm.bin, FIXADO[CHAVE].arquivo);
  const velha = `${destino}.123.456.parte`;
  const velhoTar = path.join(cm.bin, 'otelcol-contrib_0.161.0_windows_amd64.tar.gz');
  const nova = `${destino}.789.999.parte`;
  for (const a of [velha, velhoTar, nova]) fs.writeFileSync(a, 'sobra');
  const onzeMinAtras = (Date.now() - 11 * 60_000) / 1000;
  for (const a of [velha, velhoTar]) fs.utimesSync(a, onzeMinAtras, onzeMinAtras);
  const p = previa(base(c));
  let viu = null;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    baixar: async (o) => {
      viu = { chaves: Object.keys(o).sort(), destino: o.destino, velha: fs.existsSync(velha), velhoTar: fs.existsSync(velhoTar), nova: fs.existsSync(nova) };
      return baixarOk(o);
    },
  }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(viu, { chaves: ['chave', 'destino'], destino, velha: false, velhoTar: false, nova: true });
  assert.ok(fs.existsSync(nova), 'um download de menos de 10 min pode ser de outro ligar vivo');
});

test('ligar e prévia com argumentos ruins: argumentos, sem gravar nada', async () => {
  const c = cenario();
  const p = previa(base(c));
  for (const agoraMs of [undefined, -1, 1.5, Number.NaN, '1']) {
    assert.deepEqual(await ligar(base(c, { codigo: p.codigo, agoraMs, baixar: nuncaBaixar })), { ok: false, motivo: 'argumentos' }, String(agoraMs));
  }
  for (const dir of [undefined, '', 'hadouken', 'a\0b']) {
    assert.deepEqual(previa(base(c, { dir })), { ok: false, motivo: 'argumentos' }, String(dir));
    assert.deepEqual(await ligar(base(c, { dir, codigo: p.codigo, baixar: nuncaBaixar })), { ok: false, motivo: 'argumentos' }, String(dir));
  }
  assert.deepEqual(previa(base(c, { arquivo: 'settings.json' })), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(await ligar(), { ok: false, motivo: 'argumentos' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('desligar com argumentos ruins: argumentos, sem apagar nada (pasta relativa nunca vira rm no cwd)', async () => {
  const c = cenario();
  await ligado(c);
  const antes = listar(c.raiz);
  const parar = () => { throw new Error('não devia parar'); };
  for (const dir of [undefined, '', 'hadouken', 'a\0b']) {
    assert.deepEqual(desligar({ dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar }), { ok: false, motivo: 'argumentos' }, String(dir));
  }
  assert.deepEqual(desligar({ dir: c.dir, arquivo: 'settings.json', agoraMs: AGORA + 1, parar }), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: -1, parar }), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(desligar(), { ok: false, motivo: 'argumentos' });
  assert.deepEqual(listar(c.raiz), antes);
});

test('Emenda A3: subir com erro vira coletor/erro; Collector já vivo segue e não é parado na volta atrás', async () => {
  const c = cenario();
  const p = previa(base(c));
  let parou = 0;
  const parar = () => { parou++; return { ok: true, motivo: 'parado' }; };
  const r = await ligar(base(c, { codigo: p.codigo, exigirColetor: true, parar, subir: () => ({ ok: false, motivo: 'erro', evento: null }) }));
  assert.deepEqual(r, { ok: false, motivo: 'coletor', detalhe: 'erro' });
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
  assert.equal(ligadoExiste(c.dir), false);
  const p2 = previa(base(c));
  const r2 = await ligar(base(c, {
    codigo: p2.codigo, exigirColetor: true, parar, subir: () => ({ ok: false, motivo: 'vivo', evento: null }), aplicar: () => ({ ok: false, motivo: 'settings-mudou' }),
  }));
  assert.deepEqual(r2, { ok: false, motivo: 'settings-mudou' });
  assert.equal(parou, 0, 'o Collector que já estava de pé não foi este ligar que subiu');
  assert.equal(ligadoExiste(c.dir), false);
});

const OUTRO_LIGADO = '{"v":1,"chaves":{},"criouEnv":false,"em":"2026-10-08T15:00:00.000Z"}';
const subirOk = () => ({ ok: true, pid: 4242, evento: null });
const naoAplicar = () => { throw new Error('não devia gravar o settings.json'); };
// Simula um ligado.json que o unlink não tira (pasta não vazia no lugar dele).
function trocarPorPasta(arq) {
  fs.rmSync(arq, { force: true });
  fs.mkdirSync(arq);
  fs.writeFileSync(path.join(arq, 'preso'), 'x');
}

test('outro ligar terminou durante o download: ja-ligado, o ligado.json dele fica e o Collector não é parado', async () => {
  const c = cenario();
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: subirOk,
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
    baixar: async (o) => { fs.writeFileSync(caminhos(c.dir).ligado, OUTRO_LIGADO); return baixarOk(o); },
    aplicar: naoAplicar,
  }));
  assert.deepEqual(r, { ok: false, motivo: 'ja-ligado' });
  assert.equal(fs.readFileSync(caminhos(c.dir).ligado, 'utf8'), OUTRO_LIGADO);
  assert.equal(parou, 0, 'o outro ligar pode estar usando este Collector');
  assert.equal(fs.existsSync(caminhos(c.dir).trava), false, 'a trava foi solta');
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('trava ocupada na hora de gravar: ocupado, nada gravado e o Collector que este ligar subiu é parado', async () => {
  const c = cenario();
  const cm = caminhos(c.dir);
  fs.writeFileSync(cm.trava, 'token de outro');
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo, exigirColetor: true, subir: subirOk, parar: () => { parou++; return { ok: true, motivo: 'parado' }; }, aplicar: naoAplicar,
  }));
  assert.deepEqual(r, { ok: false, motivo: 'ocupado' });
  assert.equal(parou, 1);
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(fs.readFileSync(cm.trava, 'utf8'), 'token de outro', 'a trava de quem a tem fica');
  assert.equal(fs.existsSync(path.join(cm.bin, FIXADO[CHAVE].arquivo)), false, 'o .tar.gz sai');
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('trava ocupada por outro ligar que já gravou o ligado.json: ocupado, o ligado.json dele fica e o Collector não é parado', async () => {
  const c = cenario();
  const cm = caminhos(c.dir);
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: subirOk,
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
    baixar: async (o) => { fs.writeFileSync(cm.ligado, OUTRO_LIGADO); fs.writeFileSync(cm.trava, 'token de outro'); return baixarOk(o); },
    aplicar: naoAplicar,
  }));
  assert.deepEqual(r, { ok: false, motivo: 'ocupado' });
  assert.equal(parou, 0);
  assert.equal(fs.readFileSync(cm.ligado, 'utf8'), OUTRO_LIGADO);
  assert.equal(fs.readFileSync(cm.trava, 'utf8'), 'token de outro');
});

test('gravarLigado falha: escrita, o que estava no lugar fica (não é deste ligar) e o Collector que subiu é parado', async () => {
  const c = cenario();
  const cm = caminhos(c.dir);
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: () => { trocarPorPasta(cm.ligado); return subirOk(); },
    parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
    aplicar: naoAplicar,
  }));
  assert.deepEqual(r, { ok: false, motivo: 'escrita' });
  assert.equal(parou, 1);
  assert.ok(fs.existsSync(path.join(cm.ligado, 'preso')));
  assert.equal(fs.existsSync(cm.trava), false);
});

test('volta atrás que não consegue apagar o ligado.json: registroFicou', async () => {
  const c = cenario();
  const p = previa(base(c));
  const r = await ligar(base(c, {
    codigo: p.codigo,
    aplicar: () => { trocarPorPasta(caminhos(c.dir).ligado); return { ok: false, motivo: 'settings-mudou' }; },
  }));
  assert.deepEqual(r, { ok: false, motivo: 'settings-mudou', registroFicou: true });
});

test('desligar que não consegue apagar o ligado.json: registroFicou; dados e tudo o tiram na limpeza', async () => {
  for (const alcance of ['nada', 'dados', 'tudo']) {
    const c = cenario();
    await ligado(c);
    const parar = ({ dir }) => { trocarPorPasta(caminhos(dir).ligado); return { ok: true, motivo: 'sem-pid' }; };
    const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar });
    assert.equal(d.ok, true, alcance);
    assert.equal(d.registroFicou, alcance === 'nada', alcance);
    assert.equal(fs.existsSync(caminhos(c.dir).ligado), alcance === 'nada', alcance);
  }
});

test('R4: o plano muda sem o settings.json mudar (a integridade passa a pedir download) → codigo', async () => {
  const c = cenario();
  const p = previa(base(c, { integridade: () => ({ ok: true }) }));
  assert.equal(p.plano.baixar, false);
  const r = await ligar(base(c, { codigo: p.codigo, integridade: () => ({ ok: false, motivo: 'coletor-hash' }), baixar: nuncaBaixar }));
  assert.deepEqual(r, { ok: false, motivo: 'codigo' });
  assert.equal(fs.existsSync(caminhos(c.dir).otel), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

test('volta atrás com o aplicarLigar de verdade: settings.json mudado ou somente leitura durante o download', async () => {
  for (const caso of ['settings-mudou', 'settings-somente-leitura']) {
    const c = cenario();
    const mudado = ORIGINAL.replace('opus', 'sonnet');
    const p = previa(base(c));
    let parou = 0;
    const r = await ligar(base(c, {
      codigo: p.codigo,
      exigirColetor: true,
      subir: subirOk,
      parar: () => { parou++; return { ok: true, motivo: 'parado' }; },
      baixar: async (o) => {
        if (caso === 'settings-mudou') fs.writeFileSync(c.arquivo, mudado);
        else fs.chmodSync(c.arquivo, 0o444);
        return baixarOk(o);
      },
    }));
    assert.deepEqual(r, { ok: false, motivo: caso }, caso);
    assert.equal(parou, 1, caso);
    assert.equal(ligadoExiste(c.dir), false, caso);
    assert.equal(fs.readFileSync(c.arquivo, 'utf8'), caso === 'settings-mudou' ? mudado : ORIGINAL, caso);
    assert.deepEqual(fs.readdirSync(c.raiz).filter((n) => n.includes('.bak-hadouken-')), [], `${caso}: nenhuma cópia, nada foi gravado`);
  }
});

test('desligar tudo com otel/ como junção (ou link de pasta): só o link sai, o alvo fica', async (t) => {
  const c = cenario();
  const fora = path.join(c.raiz, 'fora');
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(fora, 'precioso.txt'), 'x');
  try {
    fs.symlinkSync(fora, caminhos(c.dir).otel, 'junction');
  } catch (e) {
    if (e.code === 'EPERM') { t.skip('sem permissão para criar link'); return; }
    throw e;
  }
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'sem-pid' }) });
  assert.equal(d.ok, true);
  assert.ok(fs.existsSync(path.join(fora, 'precioso.txt')), 'nunca segue o link');
  assert.equal(d.apagou, fs.lstatSync(caminhos(c.dir).otel, { throwIfNoEntry: false }) === undefined);
});

test('ligar que lança no meio (aplicar falso): volta atrás e para o Collector que subiu', async () => {
  const c = cenario();
  const p = previa(base(c));
  let parou = 0;
  const r = await ligar(base(c, {
    codigo: p.codigo,
    exigirColetor: true,
    subir: () => ({ ok: true, pid: 4242, evento: null }),
    parar: () => { parou++; throw new Error('parar falso que lança'); },
    aplicar: () => { throw new Error('aplicar falso que lança'); },
  }));
  assert.deepEqual(r, { ok: false, motivo: 'erro-interno' });
  assert.equal(parou, 1);
  assert.equal(ligadoExiste(c.dir), false);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
});

// Rodada 2 da revisão da Task 10: o taskkill /t /f volta antes de o processo
// sair e soltar os arquivos, e o `desligar tudo` deixava a otel/ para trás.
// Parada falsa como a de verdade (apaga o arquivo de PID e diz 'parado');
// consulta, espera e rmSync falsos: nenhum processo e nenhum relógio de verdade.
const EM_PID = '2026-10-08T15:00:00.000Z';
const pararComoTaskkill = ({ dir }) => { fs.rmSync(caminhos(dir).pid, { force: true }); return { ok: true, motivo: 'parado' }; };
async function comColetor(c) {
  await ligado(c);
  const cm = caminhos(c.dir);
  fs.writeFileSync(cm.pid, JSON.stringify({ v: 1, pid: 4242, em: EM_PID }));
  fs.writeFileSync(cm.aprendizado, '{}');
  fs.writeFileSync(path.join(cm.otel, 'telemetria.jsonl'), '{}\n');
  return cm;
}
const ocupado = (code) => Object.assign(new Error(`${code}: arquivo preso`), { code });

test('desligar dados e tudo depois do taskkill: consulta a saída a cada 200 ms e só apaga quando o processo sumiu; nada fica', async () => {
  for (const alcance of ['dados', 'tudo']) {
    const c = cenario();
    const cm = await comColetor(c);
    const consultas = [];
    const esperas = [];
    // De pé nas 3 primeiras consultas; enquanto isso nada foi apagado.
    const saiu = (pid) => {
      consultas.push({ pid, telemetria: fs.existsSync(path.join(cm.otel, 'telemetria.jsonl')) });
      return consultas.length > 3;
    };
    const d = desligar({
      dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar: pararComoTaskkill, saiu, esperar: (ms) => esperas.push(ms),
    });
    assert.equal(d.ok, true, alcance);
    assert.equal(d.parado, true, alcance);
    assert.equal(d.apagou, true, alcance);
    assert.deepEqual(consultas, Array(4).fill({ pid: 4242, telemetria: true }), alcance);
    assert.deepEqual(esperas, [200, 200, 200], alcance);
    assert.equal(fs.existsSync(cm.aprendizado), false, alcance);
    if (alcance === 'tudo') assert.equal(fs.existsSync(cm.otel), false);
    else assert.deepEqual(fs.readdirSync(cm.otel), ['bin']);
  }
  // Sem nada a apagar (alcance nada) ou sem PID antes da parada: nenhuma consulta.
  const c = cenario();
  await comColetor(c);
  const saiu = () => { throw new Error('não devia consultar'); };
  const d = desligar({ dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, parar: pararComoTaskkill, saiu, esperar: () => { throw new Error('não devia esperar'); } });
  assert.equal(d.parado, true);
  const c2 = cenario();
  await ligado(c2);
  const d2 = desligar({ dir: c2.dir, arquivo: c2.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar: () => ({ ok: true, motivo: 'parado' }), saiu });
  assert.equal(d2.apagou, true);
});

test('desligar com o Collector que não sai no prazo (~5 s) ou sem resposta da consulta: o PID volta, o binário fica, apagou false, sem travar', async () => {
  const casos = [
    { nome: 'não sai', saiu: () => false, consultas: 25, esperas: 24 },
    { nome: 'consulta sem resposta', saiu: () => null, consultas: 1, esperas: 0 },
    { nome: 'consulta que lança', saiu: () => { throw new Error('consulta falsa que lança'); }, consultas: 1, esperas: 0 },
  ];
  for (const caso of casos) {
    for (const alcance of ['dados', 'tudo']) {
      const rotulo = `${caso.nome}, ${alcance}`;
      const c = cenario();
      const cm = await comColetor(c);
      let consultas = 0;
      const esperas = [];
      const d = desligar({
        dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar: pararComoTaskkill,
        saiu: (pid) => { consultas++; assert.equal(pid, 4242); return caso.saiu(); }, esperar: (ms) => esperas.push(ms),
      });
      assert.equal(d.ok, true, rotulo);
      assert.deepEqual(d.removidas, Object.keys(CHAVES_LIGAR), rotulo);
      assert.equal(d.parado, false, `${rotulo}: a saída não foi confirmada`);
      assert.equal(d.apagou, false, rotulo);
      assert.equal(consultas, caso.consultas, rotulo);
      assert.deepEqual(esperas, Array(caso.esperas).fill(200), rotulo);
      assert.deepEqual(lerPid(c.dir), { pid: 4242, emMs: Date.parse(EM_PID) }, `${rotulo}: o PID volta para a próxima sessão parar`);
      assert.deepEqual(fs.readdirSync(cm.otel).sort(), ['bin', 'coletor.pid'], rotulo);
      assert.ok(fs.existsSync(caminhoBinario(c.dir, PLATAFORMA)), rotulo);
      assert.equal(fs.existsSync(cm.aprendizado), false, rotulo);
      assert.equal(ligadoExiste(c.dir), false, rotulo);
    }
  }
});

test('desligar com o Windows segurando arquivos (EBUSY, EPERM) por um tempo: tenta de novo a cada 250 ms e apaga', async () => {
  for (const alcance of ['dados', 'tudo']) {
    const c = cenario();
    const cm = await comColetor(c);
    // Em tudo a otel/ sai de uma vez; em dados, arquivo por arquivo.
    const preso = alcance === 'tudo' ? cm.otel : path.join(cm.otel, 'telemetria.jsonl');
    const esperas = [];
    let falhas = 0;
    const rm = (alvo, opcoes) => {
      if (alvo === preso && falhas < 3) throw ocupado(falhas++ % 2 === 0 ? 'EBUSY' : 'EPERM');
      return fs.rmSync(alvo, opcoes);
    };
    const d = desligar({
      dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar: pararComoTaskkill, saiu: () => true, esperar: (ms) => esperas.push(ms), rm,
    });
    assert.equal(d.apagou, true, alcance);
    assert.equal(falhas, 3, alcance);
    assert.deepEqual(esperas, [250, 250, 250], alcance);
    if (alcance === 'tudo') assert.equal(fs.existsSync(cm.otel), false);
    else assert.deepEqual(fs.readdirSync(cm.otel), ['bin']);
  }
});

test('desligar tudo com o arquivo preso para sempre: desiste depois de 20 tentativas e avisa; erro que não é de arquivo preso não repete', async () => {
  for (const code of ['EBUSY', 'EIO']) {
    const c = cenario();
    const cm = await comColetor(c);
    const esperas = [];
    let tentativas = 0;
    const rm = (alvo, opcoes) => {
      if (alvo === cm.otel) { tentativas++; throw ocupado(code); }
      return fs.rmSync(alvo, opcoes);
    };
    const d = desligar({
      dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: 'tudo', parar: pararComoTaskkill, saiu: () => true, esperar: (ms) => esperas.push(ms), rm,
    });
    assert.equal(d.ok, true, code);
    assert.equal(d.apagou, false, code);
    assert.equal(tentativas, code === 'EBUSY' ? 20 : 1, code);
    assert.deepEqual(esperas, Array(code === 'EBUSY' ? 19 : 0).fill(250), code);
    assert.ok(fs.existsSync(cm.otel), code);
  }
});

// Ruling do controlador (follow-up de 527ca3f): coletorPendente só quando uma
// parada foi tentada num Collector vivo e a saída não foi confirmada (os
// mesmos casos em que o coletor.pid fica ou volta). Nada rodando (sem-pid,
// morto, outro-processo) e saída confirmada: false. `parado` não muda.
test('desligar: coletorPendente só com a saída do Collector vivo não confirmada', async () => {
  const pararMorto = ({ dir }) => { fs.rmSync(caminhos(dir).pid, { force: true }); return { ok: true, motivo: 'morto' }; };
  const pararOutro = ({ dir }) => { fs.rmSync(caminhos(dir).pid, { force: true }); return { ok: false, motivo: 'outro-processo' }; };
  const semEspera = () => {};
  const casos = [
    { nome: 'sem-pid', comPid: false, parar: () => ({ ok: true, motivo: 'sem-pid' }), parado: false, pendente: false },
    { nome: 'morto', comPid: true, parar: pararMorto, parado: false, pendente: false },
    { nome: 'outro-processo', comPid: true, parar: pararOutro, parado: false, pendente: false },
    { nome: 'saída confirmada', comPid: true, parar: pararComoTaskkill, saiu: () => true, parado: true, pendente: false },
    { nome: 'prazo da saída esgotado', comPid: true, parar: pararComoTaskkill, saiu: () => false, parado: false, pendente: true, soComDados: true },
    { nome: 'consulta da saída falhou', comPid: true, parar: pararComoTaskkill, saiu: () => null, parado: false, pendente: true, soComDados: true },
    { nome: 'parada com erro', comPid: true, parar: () => ({ ok: false, motivo: 'erro' }), parado: false, pendente: true },
    { nome: 'parada que lança', comPid: true, parar: () => { throw new Error('parada falsa que lança'); }, parado: false, pendente: true },
  ];
  for (const caso of casos) {
    for (const alcance of ['nada', 'dados', 'tudo']) {
      const rotulo = `${caso.nome}, ${alcance}`;
      const c = cenario();
      if (caso.comPid) await comColetor(c);
      else await ligado(c);
      const d = desligar({
        dir: c.dir, arquivo: c.arquivo, agoraMs: AGORA + 1, apagar: alcance, parar: caso.parar,
        saiu: caso.saiu ?? (() => { throw new Error('não devia consultar'); }), esperar: semEspera,
      });
      assert.equal(d.ok, true, rotulo);
      // No alcance nada a saída não é esperada: a parada que respondeu basta.
      const pendente = caso.soComDados && alcance === 'nada' ? false : caso.pendente;
      const parado = caso.soComDados && alcance === 'nada' ? true : caso.parado;
      assert.equal(d.coletorPendente, pendente, rotulo);
      assert.equal(d.parado, parado, rotulo);
      assert.equal(fs.existsSync(caminhos(c.dir).pid), pendente, `${rotulo}: o coletor.pid fica se e só se pendente`);
    }
  }
});
