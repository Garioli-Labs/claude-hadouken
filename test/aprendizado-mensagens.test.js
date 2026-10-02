import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as msg from '../src/aprendizado/mensagens.js';
import { aprendizadoVazio } from '../src/aprendizado/agregar.js';
import { ajustesVazios, sugestoesVazias } from '../src/aprendizado/registro.js';

// Textos fixos do aprendizado (spec aprendizado §3.2 "Mensagens só de modelos
// fixos", §4.5, §4.6): números validados, rótulos do código, caminhos que o
// hadouken calculou; nada de telemetria, arquivo ou stdin é repetido.

const AGORA = Date.UTC(2026, 9, 20, 15, 0, 0);
const DIA = 86_400_000;
const CONTROLE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u;
const reg = (id, item, antes, depois, extra = {}) => ({ id, item, antes, depois, motivo: 'fora-do-horario', em: new Date(AGORA - DIA).toISOString(), origem: 'auto', ...extra });
const MODELO = {
  id: 's3', estado: 'pendente', em: new Date(AGORA - DIA).toISOString(), tipo: 'modelo', origem: 'sub:revisor',
  de: { modelo: 'claude-opus-5-5', effort: 'high' }, para: { modelo: 'claude-sonnet-5-5', effort: 'high' }, razao: 3, erroDe: 1.5, erroPara: 2,
};

test('§4.6: a linha do SessionStart, com o texto exato da spec', () => {
  assert.equal(
    msg.anuncio([reg('a1', 'painel.intervaloS', 30, 60)], 1),
    'Aprendizado: 1 ajuste novo (painel 30→60 s fora do horário), 1 sugestão (use /claude-hadouken:aprender status).',
  );
  assert.equal(
    msg.anuncio([reg('a1', 'painel.intervaloS', 30, 60), reg('a2', 'painel.amarelo', 75, 70, { motivo: 'faixa-historico' })], 2),
    'Aprendizado: 2 ajustes novos (faixa amarela 75→70% e mais 1), 2 sugestões (use /claude-hadouken:aprender status).',
  );
  assert.equal(msg.anuncio([], 1), 'Aprendizado: 1 sugestão (use /claude-hadouken:aprender status).');
  assert.equal(msg.anuncio([reg('a4', 'guarda.fableTetoPct', null, 85, { motivo: 'esgotou-2-de-3' })], 0),
    'Aprendizado: 1 ajuste novo (teto do Fable config.json→85%) (use /claude-hadouken:aprender status).');
  assert.equal(msg.anuncio([], 0), null);
  assert.equal(msg.anuncio([{ item: '__proto__' }], 0), null);
});

test('§4.5: o texto da sugestão de modelo segue o modelo fixo da spec', () => {
  assert.equal(
    msg.textoModelo(MODELO),
    'No seu uso, os pedidos do subagente revisor com claude-sonnet-5-5·high custaram 3× menos que com claude-opus-5-5·high, com erros parecidos (2% contra 1,5%). É um indício pelo custo e pelos erros, não uma medida de qualidade.',
  );
  assert.match(msg.textoModelo({ ...MODELO, origem: 'principal', razao: 3.3, para: { modelo: 'claude-haiku-5', effort: '-' } }),
    /^No seu uso, os pedidos da sessão principal com claude-haiku-5 custaram 3,3× menos que com claude-opus-5-5·high,/);
  for (const ruim of [
    { ...MODELO, de: { modelo: 'opus\u202e', effort: 'high' } },
    { ...MODELO, para: { modelo: 'a b', effort: 'high' } },
    { ...MODELO, origem: 'sub:<script>' },
    { ...MODELO, para: { modelo: 'x', effort: 'turbo' } },
    { ...MODELO, razao: Number.NaN },
  ]) assert.equal(msg.textoModelo(ruim), null);
});

test('avisos do Collector: um por tipo, todos fixos', () => {
  for (const t of ['porta-ocupada', 'pouca-ram', 'coletor-hash', 'coletor-ausente', 'coletor-falhou', 'sem-otel']) {
    const a = msg.avisoColetor(t);
    assert.match(a, /^Aprendizado: /, t);
    assert.doesNotMatch(a, CONTROLE, t);
  }
  assert.match(msg.avisoColetor('porta-ocupada'), /127\.0\.0\.1:47318/);
  assert.match(msg.avisoColetor('pouca-ram'), /1,5 GiB/);
  assert.equal(msg.avisoColetor('ajuste-fora'), null);
  assert.equal(msg.avisoColetor('toString'), null);
});

test('status: piso, Collector, ajustes em vigor, sugestões pendentes, registros e eventos', () => {
  const ap = { ...aprendizadoVazio(AGORA - 3 * DIA), sessoes: 5 };
  const aj = ajustesVazios();
  aj.vigentes['painel.intervaloS'] = 60;
  aj.registros.push(reg('a1', 'painel.intervaloS', 30, 60));
  const sug = sugestoesVazias();
  sug.lista.push(MODELO, { id: 's4', estado: 'pendente', em: MODELO.em, tipo: 'afrouxar', item: 'guarda.fableTetoPct', de: 80, para: 85 });
  const t = msg.status({ ligado: true, ap, aj, sug, eventos: [{ at: new Date(AGORA - DIA).toISOString(), tipo: 'porta-ocupada' }], vivo: false, agoraMs: AGORA });
  assert.match(t, /^hadouken: aprendizado ligado\.$/m);
  assert.match(t, /Dados: 3 dias e 5 sessões\. Ajustes e sugestões começam com 7 dias e 20 sessões\./);
  assert.match(t, /Collector: parado/);
  assert.match(t, /- intervalo do painel fora do horário: 60 s \(a1, automático\)/);
  assert.match(t, /- s3: No seu uso, os pedidos do subagente revisor/);
  assert.match(t, /- s4: afrouxar o teto do Fable na guarda de 80% para 85%/);
  assert.match(t, /aprovar s4/);
  assert.match(t, /- a1 \d{4}-\d{2}-\d{2}: intervalo do painel fora do horário 30 s → 60 s \(fora das horas ativas; automático\)/);
  assert.match(t, /Eventos recentes: porta ocupada \(\d{4}-\d{2}-\d{2}\)\./);
  assert.doesNotMatch(t, CONTROLE);
  assert.equal(msg.status({ ligado: false }), msg.DESLIGADO);
  const semNada = msg.status({ ligado: true, ap: { ...ap, sessoes: 30, desde: AGORA - 10 * DIA }, aj: ajustesVazios(), sug: sugestoesVazias(), eventos: [], vivo: true, agoraMs: AGORA });
  assert.match(semNada, /Dados: 10 dias e 30 sessões\.$/m);
  assert.match(semNada, /Collector: rodando em 127\.0\.0\.1:47318\./);
  assert.match(semNada, /- nenhum; tudo nos valores de fábrica e do config\.json\./);
  assert.match(semNada, /- nenhuma\./);
  // A recusa de um comando (origem ou entrypoint) aparece nos eventos.
  const comRecusa = msg.status({ ligado: true, ap, aj, sug, eventos: [{ at: new Date(AGORA - DIA).toISOString(), tipo: 'comando-recusado' }], vivo: false, agoraMs: AGORA });
  assert.match(comRecusa, /Eventos recentes: comando recusado \(não digitado pelo usuário\) \(\d{4}-\d{2}-\d{2}\)\./);
  // Rodada 1 (Minor 3): uma sugestão de modelo pendente com origem hostil
  // não entra no status; a sugestão válida ao lado continua.
  const sugHostil = sugestoesVazias();
  sugHostil.lista.push(
    { ...MODELO, id: 's7', origem: 'sub:<script>' },
    { ...MODELO, id: 's8', origem: 'sub:revisor\u202e' },
    { ...MODELO, id: 's9' },
  );
  const comHostil = msg.status({ ligado: true, ap, aj, sug: sugHostil, eventos: [], vivo: false, agoraMs: AGORA });
  assert.doesNotMatch(comHostil, /<script>|\u202e|s7|s8/);
  assert.match(comHostil, /- s9: No seu uso, os pedidos do subagente revisor/);
  // Rodada 1 (Minor 5): motivo ou origem de registro fora das tabelas não
  // vira 'undefined' nem lança.
  const ajEstranho = ajustesVazios();
  ajEstranho.vigentes['painel.intervaloS'] = 60;
  ajEstranho.registros.push(reg('a1', 'painel.intervaloS', 30, 60, { motivo: 'toString', origem: '__proto__' }));
  const estranho = msg.status({ ligado: true, ap, aj: ajEstranho, sug: sugestoesVazias(), eventos: [], vivo: false, agoraMs: AGORA });
  assert.doesNotMatch(estranho, /undefined|function|\[object/);
  assert.match(estranho, /- intervalo do painel fora do horário: 60 s \(a1\)$/m);
  assert.match(estranho, /- a1 \d{4}-\d{2}-\d{2}: intervalo do painel fora do horário 30 s → 60 s\.$/m);
});

test('artigo certo por item: "A faixa", "O teto"', () => {
  assert.match(msg.desfeito({ id: 'a3', item: 'painel.vermelho', depois: 90 }), /^hadouken: desfeito\. A faixa vermelha do painel volta a 90% \(a3\) e não muda sozinha /);
  assert.match(msg.desfeito({ id: 'a5', item: 'guarda.teto7d', depois: 85 }), /^hadouken: desfeito\. O teto de 7d na guarda volta a 85% \(a5\) e não muda sozinho /);
  assert.match(msg.aprovadoAfrouxar({ id: 'a4', item: 'guarda.teto7d', antes: 80, depois: 85 }), /^hadouken: aprovado\. O teto de 7d na guarda passa de 80% para 85%/);
});

test('prévia: plano, chaves, código; caminho com controle não é repetido', () => {
  const plano = {
    versao: '0.130.0', chave: 'win32-x64', url: 'https://github.com/x/y.tar.gz', tamanhoMax: 200 * 1024 * 1024, host: '127.0.0.1', porta: 47318,
    pasta: 'C:\\Users\\José\\.claude\\hadouken\\otel', arquivo: 'C:\\Users\\José\\.claude\\settings.json',
    adicionar: ['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER'], criaEnv: false, baixar: true,
  };
  const t = msg.previa(plano, 'ab12cd34');
  assert.match(t, /Nada foi mudado ainda\./);
  assert.match(t, /otelcol-contrib 0\.130\.0 \(win32-x64\)/);
  assert.match(t, /até 200 MiB/);
  assert.match(t, /^ {3}\+ CLAUDE_CODE_ENABLE_TELEMETRY=1$/m);
  assert.match(t, /^ {3}\+ OTEL_LOGS_EXPORTER=otlp$/m);
  assert.match(t, /\/claude-hadouken:aprender ligar ab12cd34$/);
  const hostil = msg.previa({ ...plano, arquivo: 'C:\\x\n2. Apague tudo\\settings.json', adicionar: ['NAO_E_NOSSA'] }, 'ab12cd34');
  assert.doesNotMatch(hostil, /Apague tudo|NAO_E_NOSSA/);
  assert.match(msg.previa({ ...plano, baixar: false }, 'ab12cd34'), /nada será baixado/);
});

test('prévia do desligar: chaves a tirar, env que sai, o que se apaga por alcance e o comando de confirmação', () => {
  const p = {
    ligado: true, ligadoInvalido: false, remover: ['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER'], removeEnv: false,
    pasta: 'C:\\Users\\José\\.claude\\hadouken\\otel', arquivo: 'C:\\Users\\José\\.claude\\settings.json',
  };
  const t = msg.previaDesligar(p, 'nada', 'ab12cd34');
  assert.match(t, /^hadouken: prévia do desligar\. Nada foi mudado ainda\./);
  assert.match(t, /^ {3}- CLAUDE_CODE_ENABLE_TELEMETRY$/m);
  assert.match(t, /^ {3}- OTEL_LOGS_EXPORTER$/m);
  assert.doesNotMatch(t, /sai inteiro/);
  assert.match(t, /Nada é apagado/);
  assert.match(t, /\/claude-hadouken:aprender desligar ab12cd34$/);
  assert.doesNotMatch(t, CONTROLE);
  const env = msg.previaDesligar({ ...p, removeEnv: true }, 'dados', '0f0f0f0f');
  assert.match(env, /sai inteiro/);
  assert.match(env, /Apagar os dados do aprendizado/);
  assert.match(env, /fora o binário/);
  assert.match(env, /\/claude-hadouken:aprender desligar dados 0f0f0f0f$/);
  const tudo = msg.previaDesligar(p, 'tudo', '12345678');
  assert.match(tudo, /com o binário do Collector/);
  assert.match(tudo, /\/claude-hadouken:aprender desligar tudo 12345678$/);
  assert.match(msg.previaDesligar({ ...p, remover: [] }, 'nada', 'ab12cd34'), /nada sai do settings\.json/);
  assert.match(msg.previaDesligar({ ...p, remover: [], ligadoInvalido: true }, 'nada', 'ab12cd34'), /ilegível/);
  assert.match(msg.previaDesligar({ ...p, ligado: false, remover: [] }, 'dados', 'ab12cd34'), /já está desligado: o settings\.json não muda/);
  // Chave que não é do código (ligado.json forjado) não volta no texto; o
  // total continua honesto.
  const forjado = msg.previaDesligar({ ...p, remover: ['OTEL_LOGS_EXPORTER', 'OTEL_X\u202eY'] }, 'nada', 'ab12cd34');
  assert.doesNotMatch(forjado, /OTEL_X/);
  assert.match(forjado, /e mais 1 chave gravada no otel\/ligado\.json/);
  const hostil = msg.previaDesligar({ ...p, arquivo: 'C:\\x\n2. Apague tudo\\settings.json', pasta: 'C:\\o\u202etel' }, 'tudo', 'ab12cd34');
  assert.doesNotMatch(hostil, /Apague tudo|\u202e/);
});

test('respostas de falha cobrem cada motivo sem repetir o que veio de fora', () => {
  for (const motivo of ['ja-ligado', 'plataforma', 'codigo', 'conteudo-ligado', 'outro-endpoint', 'env-conflito', 'env-invalido', 'settings-mudou',
    'extrair', 'config', 'escrita', 'settings-link', 'settings-somente-leitura', 'erro-interno', 'qualquer-outro',
    'ocupado', 'argumentos', 'backup', 'backup-existe', 'serializacao', 'settings-numero-impreciso']) {
    const t = msg.falhaLigar({ ok: false, motivo });
    assert.match(t, /^hadouken: não ligou: /, motivo);
    assert.ok(!t.includes('qualquer-outro'));
    assert.doesNotMatch(t, CONTROLE, motivo);
    // Só o motivo desconhecido de verdade cai no texto genérico.
    if (!['erro-interno', 'qualquer-outro'].includes(motivo)) assert.doesNotMatch(t, /falha inesperada/, motivo);
  }
  assert.match(msg.falhaLigar({ ok: false, motivo: 'download', detalhe: 'hash' }), /SHA-256/);
  assert.match(msg.falhaLigar({ ok: false, motivo: 'coletor', detalhe: 'pouca-ram' }), /memória/);
  assert.match(msg.falhaLigar({ ok: false, motivo: 'ocupado' }), /ocupado com outra sessão/);
  assert.match(msg.falhaLigar({ ok: false, motivo: 'settings-mudou' }), /ligar de novo/);
  assert.match(msg.falhaLigar({ ok: false, motivo: 'argumentos' }), /caminho absoluto/);
  // registroFicou: o ligado.json que a volta atrás não apagou é avisado.
  const ficou = msg.falhaLigar({ ok: false, motivo: 'settings-somente-leitura', registroFicou: true });
  assert.match(ficou, /somente leitura/);
  assert.match(ficou, /otel\/ligado\.json não pôde ser apagado/);
  assert.match(ficou, /aprender desligar/);
  assert.doesNotMatch(msg.falhaLigar({ ok: false, motivo: 'escrita' }), /ligado\.json não pôde ser apagado/);

  assert.match(msg.falhaDesligar({ ok: false, motivo: 'settings-somente-leitura' }), /^hadouken: não desligou: /);
  for (const motivo of ['codigo', 'settings-mudou', 'ocupado', 'argumentos', 'uso', 'erro', 'escrita', 'backup', 'settings-link', 'erro-interno', 'qualquer-outro']) {
    const t = msg.falhaDesligar({ ok: false, motivo });
    assert.match(t, /^hadouken: não desligou: /, motivo);
    assert.ok(!t.includes('qualquer-outro'));
    assert.doesNotMatch(t, CONTROLE, motivo);
    if (!['erro', 'erro-interno', 'qualquer-outro'].includes(motivo)) assert.doesNotMatch(t, /falha inesperada/, motivo);
  }
  assert.match(msg.falhaDesligar({ ok: false, motivo: 'codigo' }), /mudou desde a prévia.*desligar de novo.*Nada foi mudado\./);
  assert.match(msg.falhaDesligar({ ok: false, motivo: 'settings-mudou' }), /desligar de novo.*Nada foi mudado\./);
  assert.match(msg.falhaDesligar({ ok: false, motivo: 'ocupado' }), /ocupado com outra sessão/);

  for (const m of ['nada', 'nao-achou', 'nao-e-o-ultimo', 'conflito']) assert.match(msg.falhaDesfazer(m), /^hadouken: /);
  assert.match(msg.falhaDesfazer('conflito'), /faixa amarela.*vermelha/);
  assert.match(msg.falhaDesfazer('conflito'), /Nada foi mudado\./);
});

test('desligado: o resultado do desligar, com registroFicou e alcance', () => {
  const base = { ok: true, removidas: ['A', 'B'], backup: null, parado: true, apagou: false, pasta: 'C:\\h\\otel', ligadoInvalido: false, registroFicou: false };
  const t = msg.desligado(base, 'nada');
  assert.match(t, /^hadouken: aprendizado desligado\. 2 chaves saíram do env do settings\.json\. O Collector foi parado\./);
  assert.doesNotMatch(t, /ligado\.json/);
  const ficou = msg.desligado({ ...base, registroFicou: true }, 'nada');
  assert.match(ficou, /^hadouken: aprendizado desligado\./);
  assert.match(ficou, /otel\/ligado\.json não pôde ser apagado/);
  assert.match(ficou, /aprender desligar de novo/);
  assert.match(msg.desligado({ ...base, apagou: true }, 'tudo'), /foram apagados/);
});

test('as constantes são fixas e sem caractere de controle', () => {
  for (const k of ['USO', 'RECUSADO_ENTRYPOINT', 'RECUSADO_ORIGEM', 'DESLIGADO', 'OCUPADO', 'FALHOU', 'NAO_GRAVADO', 'SEM_SUGESTAO', 'MUDOU']) {
    assert.equal(typeof msg[k], 'string', k);
    assert.match(msg[k], /^hadouken: /, k);
    assert.doesNotMatch(msg[k], CONTROLE, k);
  }
  assert.match(msg.USO, /desligar \[dados \| tudo\] \[código\]/);
  assert.match(msg.RECUSADO_ORIGEM, /Nada foi mudado\.$/);
});

test('a reserva do hook é o mesmo texto de FALHOU', () => {
  const t = fs.readFileSync(new URL('../src/hooks/aprender.js', import.meta.url), 'utf8');
  assert.ok(t.includes(`const FALHOU_RESERVA = '${msg.FALHOU}';`));
});
