import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caminhos, ligadoExiste } from '../src/aprendizado/arquivos.js';
import { FIXADO } from '../src/aprendizado/baixar.js';
import { caminhoBinario, registrarInstalacao } from '../src/aprendizado/coletor.js';
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

test('desligar com a parada sem resposta (erro): o arquivo de PID fica, também em dados e tudo', async () => {
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
    assert.deepEqual(fs.readdirSync(cm.otel).sort(), alcance === 'tudo' ? ['coletor.pid'] : ['bin', 'coletor.pid'], alcance);
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

test('outro ligar terminou durante o download: ja-ligado, e o ligado.json dele fica', async () => {
  const c = cenario();
  const p = previa(base(c));
  const outro = '{"v":1,"chaves":{},"criouEnv":false,"em":"2026-10-08T15:00:00.000Z"}';
  const r = await ligar(base(c, {
    codigo: p.codigo,
    baixar: async (o) => { fs.writeFileSync(caminhos(c.dir).ligado, outro); return baixarOk(o); },
    aplicar: () => { throw new Error('não devia gravar o settings.json'); },
  }));
  assert.deepEqual(r, { ok: false, motivo: 'ja-ligado' });
  assert.equal(fs.readFileSync(caminhos(c.dir).ligado, 'utf8'), outro);
  assert.equal(fs.readFileSync(c.arquivo, 'utf8'), ORIGINAL);
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
