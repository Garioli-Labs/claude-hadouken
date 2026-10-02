import path from 'node:path';
import { MODELO_VALIDO } from '../guarda/registros.js';
import { RAM_MIN_BYTES } from '../uso/painel.js';
import { decimal } from '../util.js';
import { BLOQUEIO_MS, PISO_MS, PISO_SESSOES } from './ajustar.js';
import { ITENS } from './arquivos.js';
import { HOST, PORTA } from './config-coletor.js';
import { ARQ_TELEMETRIA } from './otlp.js';
import { diaLocal, ORIGEM_VALIDA } from './registro.js';
import { CHAVES_LIGAR } from './settings-env.js';

// Textos do aprendizado (spec aprendizado §3.2 "Mensagens só de modelos
// fixos", §4.5, §4.6), como src/guarda/mensagens.js. Só entram números
// validados, rótulos deste arquivo, constantes do código e caminhos que o
// hadouken calculou (sem caractere de controle ou invisível). A única
// exceção, só no status e na sugestão de modelo (que só o usuário vê, pela
// `reason` do decision:block): nomes de modelo que casam MODELO_VALIDO e de
// subagente que casam SUBAGENTE, conferidos de novo aqui.

const CMD = '/claude-hadouken:aprender';
const DIA_MS = 86_400_000;
const DIAS_BLOQUEIO = Math.round(BLOQUEIO_MS / DIA_MS);
const INVISIVEL = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', '-']);
const SUBAGENTE = /^[A-Za-z0-9._-]{1,40}$/;

export const USO = `hadouken: uso: ${CMD} [status | ligar [código] | desligar [dados | tudo] [código] | desfazer [aN] | aprovar sN | recusar sN]. Nada foi mudado.`;
export const RECUSADO_ENTRYPOINT = 'hadouken: o aprendizado só aceita comandos digitados pelo usuário numa sessão interativa. Nada foi mudado.';
// Ruling I1 do preflight (o C1 da guarda): a expansão que não vem do comando
// digitado (command_source ou expansion_type fora da lista fechada).
export const RECUSADO_ORIGEM = 'hadouken: o aprendizado só aceita o comando digitado pelo usuário na conversa; tarefa agendada, /loop e ferramenta não valem. Nada foi mudado.';
export const DESLIGADO = `hadouken: o aprendizado está desligado. Para ligar: ${CMD} ligar.`;
export const OCUPADO = 'hadouken: o aprendizado está ocupado com outra sessão. Tente de novo em alguns segundos. Nada foi mudado.';
export const FALHOU = `hadouken: o comando falhou. Confira o estado com ${CMD} status.`;
export const NAO_GRAVADO = `hadouken: a mudança não pôde ser gravada. Confira o estado com ${CMD} status.`;
export const SEM_SUGESTAO = `hadouken: não há sugestão pendente com esse id. Veja ${CMD} status.`;
export const MUDOU = 'hadouken: essa sugestão não vale mais (o ajuste ou o config.json mudou desde ela) e foi retirada. Nada foi aplicado.';

// Rótulo longo (status), artigo dele, rótulo curto (linha de §4.6), unidade
// e o que vem depois do valor na linha curta.
const ROTULO = Object.freeze({
  'painel.intervaloS': Object.freeze({ nome: 'intervalo do painel fora do horário', artigo: 'o', curto: 'painel', unidade: ' s', fim: ' fora do horário' }),
  'painel.amarelo': Object.freeze({ nome: 'faixa amarela do painel', artigo: 'a', curto: 'faixa amarela', unidade: '%', fim: '' }),
  'painel.vermelho': Object.freeze({ nome: 'faixa vermelha do painel', artigo: 'a', curto: 'faixa vermelha', unidade: '%', fim: '' }),
  'previsao.pesoPerfil': Object.freeze({ nome: 'peso do perfil por hora na previsão', artigo: 'o', curto: 'peso do perfil na previsão', unidade: '', fim: '' }),
  'guarda.fableTetoPct': Object.freeze({ nome: 'teto do Fable na guarda', artigo: 'o', curto: 'teto do Fable', unidade: '%', fim: '' }),
  'guarda.teto7d': Object.freeze({ nome: 'teto de 7d na guarda', artigo: 'o', curto: 'teto de 7d', unidade: '%', fim: '' }),
});
// "o teto…", "a faixa…"; no começo da frase, com maiúscula.
const comArtigo = (item) => `${ROTULO[item].artigo} ${ROTULO[item].nome}`;
const ComArtigo = (item) => `${ROTULO[item].artigo.toUpperCase()} ${ROTULO[item].nome}`;
// Motivo e origem de um registro, só os das tabelas (Minor 5 da rodada 1):
// lerAjustes já valida, mas este módulo não depende disso.
function porQue(r) {
  const partes = [];
  if (typeof r.motivo === 'string' && Object.hasOwn(MOTIVO_TXT, r.motivo)) partes.push(MOTIVO_TXT[r.motivo]);
  if (typeof r.origem === 'string' && Object.hasOwn(ORIGEM_REG, r.origem)) partes.push(ORIGEM_REG[r.origem]);
  return partes;
}
const MOTIVO_TXT = Object.freeze({
  'fora-do-horario': 'fora das horas ativas',
  'horario-mudou': 'as horas ativas mudaram',
  'faixa-historico': 'antecedência no seu histórico',
  'perfil-por-hora': 'ritmo por hora com cobertura',
  'perfil-insuficiente': 'ritmo por hora sem cobertura',
  'esgotou-2-de-3': 'esgotou em 2 das últimas 3 semanas',
  'sobra-4-semanas': 'sobra nas últimas 4 semanas',
  desfazer: 'desfeito pelo senhor',
});
const ORIGEM_REG = Object.freeze({ auto: 'automático', aprovado: 'aprovado', desfeito: 'desfeito' });
const EVENTO_TXT = Object.freeze({
  'porta-ocupada': 'porta ocupada',
  'pouca-ram': 'pouca memória',
  'coletor-hash': 'hash do Collector diferente',
  'coletor-falhou': 'Collector parou com erro',
  'coletor-ausente': 'binário do Collector ausente',
  'ajuste-fora': 'ajuste fora dos limites descartado',
  erro: 'erro no passo',
  'sem-otel': 'sem telemetria',
  orfao: 'Collector órfão reiniciado',
  'telemetria-corrompida': 'telemetria corrompida ignorada',
  'comando-recusado': 'comando recusado (não digitado pelo usuário)',
  'parar-falhou': 'Collector não parou',
});
const AVISO = Object.freeze({
  'porta-ocupada': `Aprendizado: o Collector não subiu porque a porta ${HOST}:${PORTA} está ocupada por outro programa. Segue só com os dados dos hooks.`,
  'pouca-ram': `Aprendizado: o Collector não subiu com menos de ${decimal(RAM_MIN_BYTES / 1024 ** 3, 1)} GiB de memória livre. Segue só com os dados dos hooks.`,
  'coletor-hash': `Aprendizado: o binário do Collector não confere com o hash registrado e não foi executado. Rode ${CMD} desligar tudo e ligue de novo.`,
  'coletor-ausente': `Aprendizado: o binário do Collector não está na pasta. Rode ${CMD} desligar tudo e ligue de novo.`,
  'coletor-falhou': 'Aprendizado: o Collector parou com erro na última subida. Segue só com os dados dos hooks.',
  'sem-otel': 'Aprendizado: ainda não chegou telemetria do Claude Code; ela vale a partir da sessão seguinte ao ligar. Segue com os dados dos hooks.',
  'parar-falhou': 'Aprendizado: o Collector não pôde ser parado; o hadouken tenta de novo na próxima sessão. Se o aviso continuar, encerre o processo otelcol-contrib.',
});
const SETTINGS_TXT = Object.freeze({
  'settings-link': 'o settings.json é um link; o hadouken não segue links',
  'settings-invalido': 'o settings.json não é um JSON válido',
  'settings-grande': 'o settings.json passa do tamanho que o hadouken aceita',
  'settings-ilegivel': 'o settings.json não pôde ser lido',
  'settings-somente-leitura': 'o settings.json está somente leitura',
  'settings-numero-impreciso': 'o settings.json tem um número que não voltaria igual depois de gravado',
  'settings-mudou': `o settings.json mudou no meio; rode ${CMD} de novo`,
  'backup-existe': 'já existe uma cópia com o mesmo instante; rode de novo',
  backup: 'a cópia de segurança do settings.json não pôde ser gravada',
  serializacao: 'o settings.json não pôde ser montado de novo para a gravação',
  'hadouken-settings-invalido': 'HADOUKEN_SETTINGS não é um caminho absoluto',
  'config-dir-invalido': 'CLAUDE_CONFIG_DIR não é um caminho absoluto',
  'sem-diretorio': 'não achei a pasta do usuário',
  'env-invalido': 'o env do settings.json não é um objeto',
});
const LIGAR_TXT = Object.freeze({
  'ja-ligado': `o aprendizado já está ligado. Veja ${CMD} status.`,
  plataforma: 'não há Collector fixado no código para esta plataforma. Nada foi mudado.',
  codigo: `o código não confere: o settings.json ou o plano mudou desde a prévia. Rode ${CMD} ligar de novo. Nada foi mudado.`,
  'conteudo-ligado': 'OTEL_LOG_USER_PROMPTS, OTEL_LOG_TOOL_DETAILS ou OTEL_LOG_RAW_API_BODIES está ligado (no env do settings.json ou no ambiente). O hadouken não liga com conteúdo na telemetria. Nada foi mudado.',
  'outro-endpoint': 'já há outro endpoint OTLP configurado. O hadouken não sobrescreve a telemetria que já existe. Nada foi mudado.',
  'env-conflito': 'o env do settings.json já tem uma chave de telemetria com outro valor. O hadouken não sobrescreve. Nada foi mudado.',
  'settings-mudou': `o settings.json foi mudado por outro programa entre a conferência e a gravação, e o hadouken não grava por cima. O settings.json ficou como o outro programa deixou. Rode ${CMD} ligar de novo para ver a prévia atual.`,
  ocupado: `o aprendizado está ocupado com outra sessão (um passo, outro ligar ou um desligar). O settings.json não mudou; o Collector já baixado fica na pasta. Tente de novo em alguns segundos com ${CMD} ligar, para ver a prévia atual.`,
  argumentos: 'a pasta de dados ou o caminho do settings.json não é um caminho absoluto válido. Nada foi mudado.',
  extrair: 'a extração com o tar do sistema falhou; o .tar.gz foi apagado e o settings.json não mudou.',
  config: 'a configuração do Collector não pôde ser gravada; o settings.json não mudou.',
  escrita: 'não deu para gravar o otel/ligado.json, a trava do aprendizado ou o settings.json; o settings.json ficou como estava.',
});
const DESLIGAR_TXT = Object.freeze({
  codigo: `o código não confere: o settings.json ou o aprendizado mudou desde a prévia. Rode ${CMD} desligar de novo para ver a prévia atual. Nada foi mudado.`,
  'settings-mudou': `o settings.json foi mudado por outro programa entre a prévia e a gravação, e o hadouken não grava por cima. Rode ${CMD} desligar de novo para ver a prévia atual. Nada foi mudado.`,
  ocupado: 'o aprendizado está ocupado com outra sessão (um passo, um ligar ou outro desligar). Tente de novo em alguns segundos. Nada foi mudado.',
  argumentos: 'a pasta de dados ou o caminho do settings.json não é um caminho absoluto válido. Nada foi mudado.',
  uso: `o alcance pedido não existe; use ${CMD} desligar, desligar dados ou desligar tudo. Nada foi mudado.`,
  escrita: `o settings.json não pôde ser gravado e ficou como estava. O aprendizado continua ligado; confira com ${CMD} status.`,
});
const DOWNLOAD_TXT = Object.freeze({
  rede: 'sem rede ou conexão interrompida',
  http: 'resposta inesperada do servidor',
  host: 'redirecionamento para um endereço fora da lista',
  grande: 'arquivo maior que o teto',
  prazo: 'passou do prazo',
  hash: 'o SHA-256 não confere com o fixado no código; o arquivo foi apagado',
  escrita: 'não deu para gravar na pasta',
  plataforma: 'sem versão fixada para esta plataforma',
});
const COLETOR_TXT = Object.freeze({
  'pouca-ram': 'pouca memória livre',
  subindo: 'outra sessão está subindo o Collector',
  'coletor-ausente': 'binário ausente',
  'coletor-hash': 'binário fora do hash',
  config: 'configuração não gravada',
});

const temRotulo = (item) => typeof item === 'string' && Object.hasOwn(ROTULO, item);
const caminhoTxt = (p) => (typeof p === 'string' && p.length > 0 && p.length <= 1024 && !INVISIVEL.test(p) ? p : '(caminho com caractere de controle; confira a pasta à mão)');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const numero = (n) => (Number.isInteger(n) ? String(n) : decimal(n, 1));
const dia = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? diaLocal(t) : '?';
};

function numeroDoItem(item, v) {
  if (v === null) return 'config.json';
  return ITENS[item].decimal ? decimal(v, 1) : String(v);
}

function valorTxt(item, v) {
  return v === null ? 'o valor do config.json' : `${numeroDoItem(item, v)}${ROTULO[item].unidade}`;
}

function curto(r) {
  const d = ROTULO[r.item];
  const depois = r.depois === null ? 'config.json' : `${numeroDoItem(r.item, r.depois)}${d.unidade}`;
  return `${d.curto} ${numeroDoItem(r.item, r.antes)}→${depois}${d.fim}`;
}

// §4.6: no máximo uma vez por dia (quem decide é passo.js).
export function anuncio(registros, nSugestoes) {
  const lista = Array.isArray(registros) ? registros.filter((r) => temRotulo(r?.item)) : [];
  const n = Number.isSafeInteger(nSugestoes) && nSugestoes > 0 ? nSugestoes : 0;
  const partes = [];
  if (lista.length > 0) {
    const mais = lista.length > 1 ? ` e mais ${lista.length - 1}` : '';
    partes.push(`${plural(lista.length, 'ajuste novo', 'ajustes novos')} (${curto(lista[lista.length - 1])}${mais})`);
  }
  if (n > 0) partes.push(plural(n, 'sugestão', 'sugestões'));
  return partes.length === 0 ? null : `Aprendizado: ${partes.join(', ')} (use ${CMD} status).`;
}

export function avisoColetor(tipo) {
  return typeof tipo === 'string' && Object.hasOwn(AVISO, tipo) ? AVISO[tipo] : null;
}

function modeloTxt(m) {
  if (m === null || typeof m !== 'object' || typeof m.modelo !== 'string' || !MODELO_VALIDO.test(m.modelo) || INVISIVEL.test(m.modelo)) return null;
  if (!EFFORTS.has(m.effort)) return null;
  return m.effort === '-' ? m.modelo : `${m.modelo}·${m.effort}`;
}

function origemTxt(o) {
  if (typeof o !== 'string' || !ORIGEM_VALIDA.test(o)) return null;
  if (o === 'principal') return 'os pedidos da sessão principal';
  if (o === 'sub') return 'os pedidos de subagentes';
  if (o === 'outro') return 'os pedidos de outras origens';
  const nome = o.slice(4);
  return SUBAGENTE.test(nome) ? `os pedidos do subagente ${nome}` : null;
}

// §4.5, o texto fixo da spec: "a medida é indireta".
export function textoModelo(s) {
  const de = modeloTxt(s?.de);
  const para = modeloTxt(s?.para);
  const origem = origemTxt(s?.origem);
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1000;
  if (de === null || para === null || origem === null || !ok(s.razao) || !ok(s.erroDe) || !ok(s.erroPara)) return null;
  return `No seu uso, ${origem} com ${para} custaram ${numero(s.razao)}× menos que com ${de}, com erros parecidos (${numero(s.erroPara)}% contra ${numero(s.erroDe)}%). É um indício pelo custo e pelos erros, não uma medida de qualidade.`;
}

function textoSugestao(s) {
  if (s.tipo === 'afrouxar' && temRotulo(s.item)) {
    return `afrouxar ${comArtigo(s.item)} de ${valorTxt(s.item, s.de)} para ${valorTxt(s.item, s.para)} (nunca acima do config.json).`;
  }
  if (s.tipo === 'modelo') {
    const t = textoModelo(s);
    return t === null ? null : `${t} Aprovar só registra; a troca de modelo é sua.`;
  }
  return null;
}

export function status({ ligado, ap, aj, sug, eventos, vivo, agoraMs } = {}) {
  if (ligado !== true) return DESLIGADO;
  const l = ['hadouken: aprendizado ligado.'];
  const dias = Math.max(0, Math.floor((agoraMs - ap.desde) / DIA_MS));
  const noPiso = agoraMs - ap.desde >= PISO_MS && ap.sessoes >= PISO_SESSOES;
  const piso = noPiso ? '' : ` Ajustes e sugestões começam com ${Math.round(PISO_MS / DIA_MS)} dias e ${PISO_SESSOES} sessões.`;
  l.push(`Dados: ${plural(dias, 'dia', 'dias')} e ${plural(ap.sessoes, 'sessão', 'sessões')}.${piso}`);
  l.push(vivo ? `Collector: rodando em ${HOST}:${PORTA}.` : 'Collector: parado; sobe no próximo início de sessão.');
  l.push('Ajustes em vigor:');
  const mudados = Object.keys(ITENS).filter((item) => aj.vigentes[item] !== ITENS[item].padrao);
  if (mudados.length === 0) l.push('- nenhum; tudo nos valores de fábrica e do config.json.');
  for (const item of mudados) {
    const r = [...aj.registros].reverse().find((x) => x.item === item);
    const origem = r && typeof r.origem === 'string' && Object.hasOwn(ORIGEM_REG, r.origem) ? `, ${ORIGEM_REG[r.origem]}` : '';
    l.push(`- ${ROTULO[item].nome}: ${valorTxt(item, aj.vigentes[item])}${r ? ` (${r.id}${origem})` : ''}`);
  }
  l.push('Sugestões pendentes:');
  const pendentes = sug.lista.filter((s) => s.estado === 'pendente').map((s) => [s.id, textoSugestao(s)]).filter(([, t]) => t !== null);
  if (pendentes.length === 0) l.push('- nenhuma.');
  for (const [id, t] of pendentes) l.push(`- ${id}: ${t} Aprovar: ${CMD} aprovar ${id}. Recusar: ${CMD} recusar ${id}.`);
  const ultimos = aj.registros.slice(-5).reverse();
  if (ultimos.length > 0) {
    l.push('Últimos registros:');
    for (const r of ultimos) {
      const partes = porQue(r);
      l.push(`- ${r.id} ${dia(r.em)}: ${ROTULO[r.item].nome} ${valorTxt(r.item, r.antes)} → ${valorTxt(r.item, r.depois)}${partes.length > 0 ? ` (${partes.join('; ')})` : ''}.`);
    }
  }
  const recentes = (Array.isArray(eventos) ? eventos : []).slice(-5).reverse().filter((e) => Object.hasOwn(EVENTO_TXT, e.tipo));
  if (recentes.length > 0) l.push(`Eventos recentes: ${recentes.map((e) => `${EVENTO_TXT[e.tipo]} (${dia(e.at)})`).join(', ')}.`);
  l.push(`Desfazer o último ajuste: ${CMD} desfazer. Desligar: ${CMD} desligar.`);
  return l.join('\n');
}

// §3.2 passo 1 e R4: o que será feito e o código da confirmação.
export function previa(plano, codigo) {
  const bin = caminhoTxt(path.join(plano.pasta, 'bin'));
  const l = ['hadouken: prévia do aprendizado local. Nada foi mudado ainda.'];
  l.push(plano.baixar
    ? `1. Baixar o otelcol-contrib ${plano.versao} (${plano.chave}) de ${plano.url}, até ${decimal(plano.tamanhoMax / 1024 ** 2, 0)} MiB, conferir o SHA-256 fixado no código, extrair só o binário para ${bin} com o tar do sistema e apagar o .tar.gz.`
    : `1. O otelcol-contrib ${plano.versao} já está em ${bin} e confere com o hash registrado: nada será baixado.`);
  l.push(`2. Gerar a configuração do Collector: recebe só em ${plano.host}:${plano.porta} (HTTP, sem gRPC), apaga os campos de identidade e grava em ${caminhoTxt(path.join(plano.pasta, ARQ_TELEMETRIA))}.`);
  const chaves = plano.adicionar.filter((k) => Object.hasOwn(CHAVES_LIGAR, k));
  const arq = caminhoTxt(plano.arquivo);
  if (chaves.length === 0) {
    l.push(`3. O env de ${arq} já tem todas as chaves: nada será acrescentado.`);
  } else {
    l.push(`3. Acrescentar ao env de ${arq}${plano.criaEnv ? ' (criando o env)' : ''}, com cópia de segurança ao lado (settings.json.bak-hadouken-<instante>), sem tocar em mais nada:`);
    for (const k of chaves) l.push(`   + ${k}=${CHAVES_LIGAR[k]}`);
  }
  l.push('4. A telemetria vale a partir da próxima sessão. Prompts, detalhes de ferramentas e respostas continuam fora dela.');
  l.push(`Para confirmar: ${CMD} ligar ${codigo}`);
  return l.join('\n');
}

// §3.2 "desligar pergunta" e §6 última linha: o desligar também é em dois
// tempos. `p` vem de previaDesligar (ligar.js) mais `arquivo` e `ligado`
// (false quando o aprendizado já está desligado e só os dados que ficaram
// serão apagados). Só as chaves de CHAVES_LIGAR são nomeadas; uma chave
// forjada no otel/ligado.json entra só na contagem.
export function previaDesligar(p, alcance, codigo) {
  const arq = caminhoTxt(p.arquivo);
  const pasta = caminhoTxt(p.pasta);
  const remover = Array.isArray(p.remover) ? p.remover : [];
  const l = ['hadouken: prévia do desligar. Nada foi mudado ainda.'];
  if (p.ligado !== true) {
    l.push('1. O aprendizado já está desligado: o settings.json não muda.');
  } else if (p.ligadoInvalido) {
    l.push(`1. O otel/ligado.json está ilegível: nada sai do settings.json; confira o env de ${arq} à mão.`);
  } else if (remover.length > 0) {
    l.push(`1. Tirar do env de ${arq}, com cópia de segurança ao lado (settings.json.bak-hadouken-<instante>), só as chaves que o ligar pôs e que ainda têm o valor dele:`);
    const nossas = remover.filter((k) => typeof k === 'string' && Object.hasOwn(CHAVES_LIGAR, k));
    for (const k of nossas) l.push(`   - ${k}`);
    const outras = remover.length - nossas.length;
    if (outras > 0) l.push(`   - e mais ${plural(outras, 'chave gravada', 'chaves gravadas')} no otel/ligado.json`);
    if (p.removeEnv) l.push('   O env fica vazio e sai inteiro, porque foi o ligar que o criou.');
  } else if (p.removeEnv) {
    l.push(`1. O env de ${arq} está vazio e foi o ligar que o criou: ele sai inteiro, com cópia de segurança ao lado.`);
  } else {
    l.push(`1. O env de ${arq} não tem chaves do hadouken com o valor dele: nada sai do settings.json.`);
  }
  l.push('2. Parar o Collector, se estiver rodando.');
  if (alcance === 'tudo') {
    l.push(`3. Apagar os dados do aprendizado (aprendizado.json, ajustes.json, sugestoes.json, o cursor e os eventos) e a pasta ${pasta} inteira, com o binário do Collector.`);
  } else if (alcance === 'dados') {
    l.push(`3. Apagar os dados do aprendizado (aprendizado.json, ajustes.json, sugestoes.json, o cursor e os eventos) e o que está em ${pasta}, fora o binário.`);
  } else {
    l.push(`3. Nada é apagado: os dados e o binário ficam em ${pasta}. Para apagar junto: ${CMD} desligar dados (ou desligar tudo, com o binário).`);
  }
  l.push('4. A telemetria para a partir da próxima sessão.');
  l.push(`Para confirmar: ${CMD} desligar ${alcance === 'dados' || alcance === 'tudo' ? `${alcance} ` : ''}${codigo}`);
  return l.join('\n');
}

export function ligado(r) {
  const copia = typeof r.backup === 'string' ? ` Cópia do settings.json de antes: ${caminhoTxt(r.backup)}.` : '';
  return `hadouken: aprendizado ligado. O Collector ${r.plano.versao} está em ${caminhoTxt(path.join(r.plano.pasta, 'bin'))}.${copia} A telemetria vale a partir da próxima sessão; prompts, detalhes de ferramentas e respostas continuam fora dela. Status: ${CMD} status.`;
}

export function falhaSettings(motivo) {
  return `hadouken: ${Object.hasOwn(SETTINGS_TXT, motivo) ? SETTINGS_TXT[motivo] : 'falha inesperada'}. Nada foi mudado.`;
}

// registroFicou (ligar.js): a volta atrás não conseguiu apagar o
// otel/ligado.json que este ligar gravou.
const FICOU_LIGAR = ` O otel/ligado.json não pôde ser apagado: o aprendizado pode constar como ligado sem as chaves no env. Rode ${CMD} desligar para limpar.`;

export function falhaLigar(r) {
  const m = r?.motivo;
  let t;
  if (m === 'download') {
    t = `o download falhou (${Object.hasOwn(DOWNLOAD_TXT, r.detalhe) ? DOWNLOAD_TXT[r.detalhe] : 'motivo desconhecido'}). Nada foi instalado e o settings.json não mudou.`;
  } else if (m === 'coletor') {
    t = `o Collector não subiu (${Object.hasOwn(COLETOR_TXT, r.detalhe) ? COLETOR_TXT[r.detalhe] : 'falha ao subir'}); com ele fora do ar o Claude Code atrapalha, então o settings.json não mudou.`;
  } else if (typeof m === 'string' && Object.hasOwn(LIGAR_TXT, m)) {
    t = LIGAR_TXT[m];
  } else if (typeof m === 'string' && Object.hasOwn(SETTINGS_TXT, m)) {
    t = `${SETTINGS_TXT[m]}. O settings.json não mudou.`;
  } else {
    t = `falha inesperada. Confira com ${CMD} status.`;
  }
  return `hadouken: não ligou: ${t}${r?.registroFicou === true ? FICOU_LIGAR : ''}`;
}

export function desligado(r, alcance) {
  const l = ['hadouken: aprendizado desligado.'];
  if (r.ligadoInvalido) l.push('O otel/ligado.json estava ilegível: nenhuma chave foi tirada do settings.json; confira o env dele à mão.');
  else if (r.removidas.length > 0) l.push(`${plural(r.removidas.length, 'chave saiu', 'chaves saíram')} do env do settings.json${typeof r.backup === 'string' ? ` (cópia em ${caminhoTxt(r.backup)})` : ''}.`);
  else l.push('O env do settings.json não tinha chaves do hadouken com o valor dele para tirar.');
  if (r.parado) l.push('O Collector foi parado.');
  const pasta = caminhoTxt(r.pasta);
  if (alcance === 'dados' || alcance === 'tudo') {
    l.push(r.apagou
      ? (alcance === 'tudo' ? `Os dados do aprendizado e a pasta ${pasta} foram apagados.` : `Os dados do aprendizado foram apagados; o binário fica em ${pasta}.`)
      : `Alguns arquivos não puderam ser apagados; confira ${pasta}.`);
  } else {
    l.push(`Os dados e o binário ficam em ${pasta}. Para apagar: ${CMD} desligar dados (ou desligar tudo, com o binário).`);
  }
  if (r.registroFicou === true) {
    l.push(`O otel/ligado.json não pôde ser apagado: para o hadouken o aprendizado ainda consta como ligado. Rode ${CMD} desligar de novo para tirá-lo.`);
  }
  l.push('A telemetria para a partir da próxima sessão.');
  return l.join(' ');
}

export function falhaDesligar(r) {
  const m = r?.motivo;
  if (typeof m === 'string' && Object.hasOwn(DESLIGAR_TXT, m)) return `hadouken: não desligou: ${DESLIGAR_TXT[m]}`;
  if (typeof m === 'string' && Object.hasOwn(SETTINGS_TXT, m)) {
    return `hadouken: não desligou: ${SETTINGS_TXT[m]}. O aprendizado continua ligado; confira com ${CMD} status.`;
  }
  return `hadouken: não desligou: falha inesperada. Confira o estado com ${CMD} status.`;
}

export function desfeito(registro) {
  return `hadouken: desfeito. ${ComArtigo(registro.item)} volta a ${valorTxt(registro.item, registro.depois)} (${registro.id}) e não muda ${ROTULO[registro.item].artigo === 'a' ? 'sozinha' : 'sozinho'} por ${DIAS_BLOQUEIO} dias.`;
}

export function falhaDesfazer(motivo) {
  if (motivo === 'nada') return 'hadouken: não há ajuste para desfazer.';
  if (motivo === 'nao-e-o-ultimo') return `hadouken: esse ajuste já foi substituído ou desfeito; só o mais novo de cada item se desfaz. Veja ${CMD} status.`;
  if (motivo === 'conflito') {
    return `hadouken: desfazer esse ajuste deixaria a faixa amarela do painel igual ou acima da vermelha. Desfaça antes o ajuste da outra faixa (veja ${CMD} status). Nada foi mudado.`;
  }
  return `hadouken: não há ajuste com esse id. Veja ${CMD} status.`;
}

export function aprovadoAfrouxar(registro) {
  return `hadouken: aprovado. ${ComArtigo(registro.item)} passa de ${valorTxt(registro.item, registro.antes)} para ${valorTxt(registro.item, registro.depois)} (${registro.id}). Desfazer: ${CMD} desfazer ${registro.id}.`;
}

export function aprovadoModelo(s) {
  return `hadouken: sugestão ${s.id} marcada como aprovada. O hadouken nunca troca o modelo sozinho: a troca é sua, no /model ou na definição do subagente.`;
}

export function recusado(s) {
  return `hadouken: sugestão ${s.id} recusada. A mesma sugestão não volta por ${DIAS_BLOQUEIO} dias.`;
}
