import { CAMPOS, PADRAO_GUARDA } from '../guarda/config.js';
import { PADRAO_ROTEAMENTO } from '../roteamento/config.js';

// A configuração inteira do hadouken num lugar só (spec v0.5.3 VS Code §2.1):
// cada item com o id do /hadouken:limites, o caminho no config.json, o
// rótulo (o nome que aparece em erro e aviso vem daqui, nunca do arquivo), a
// faixa e o padrão. `frouxo` diz para que lado o item afrouxa: 'maior',
// 'menor', 'desligar' (true → false) ou null (nunca conta como afrouxar).

const GUARDA = Object.freeze({
  teto5h: ['Teto da janela de 5 h', '%', 'maior'],
  horizonte5hMin: ['Horizonte da projeção de 5 h', 'min', 'menor'],
  margemReset5hMin: ['Margem antes do reset de 5 h', 'min', 'menor'],
  teto7d: ['Teto da semana', '%', 'maior'],
  horizonte7dH: ['Horizonte da projeção da semana', 'h', 'menor'],
  fableDespachosMax: ['Despachos Fable por janela', 'despachos', 'maior'],
  fableDespachosHoras: ['Janela dos despachos Fable', 'h', 'menor'],
  liberacaoPadraoH: ['Liberação padrão', 'h', 'maior'],
  liberacaoMaxH: ['Liberação máxima', 'h', 'maior'],
  liberacaoTetoPontos7d: ['Pontos de liberação na semana', 'pontos', 'maior'],
  fableTetoPct: ['Teto da semana do Fable', '%', 'maior'],
});

const inteiro = (id, caminho, grupo, rotulo, unidade, min, max, padrao, frouxo) => Object.freeze({
  id, caminho: Object.freeze(caminho), grupo, rotulo, unidade, tipo: 'inteiro', min, max, padrao, frouxo,
});
const booleano = (id, caminho, grupo, rotulo, padrao, frouxo = null) => Object.freeze({
  id, caminho: Object.freeze(caminho), grupo, rotulo, unidade: '', tipo: 'booleano', padrao, frouxo,
});

export const ITENS = Object.freeze([
  booleano('guarda.ligada', ['guarda', 'ligada'], 'guarda', 'Guarda ligada', PADRAO_GUARDA.ligada, 'desligar'),
  ...CAMPOS.map(([chave, caminho, rotulo, min, max]) => {
    const [nome, unidade, frouxo] = GUARDA[chave];
    return inteiro(`guarda.${rotulo}`, ['guarda', ...caminho], 'guarda', nome, unidade, min, max, PADRAO_GUARDA[chave], frouxo);
  }),
  inteiro('barra.ctx.amarelo', ['barra', 'ctx', 'amarelo'], 'barra', 'Contexto: amarelo a partir de', '%', 30, 95, 70, 'maior'),
  inteiro('barra.ctx.vermelho', ['barra', 'ctx', 'vermelho'], 'barra', 'Contexto: vermelho a partir de', '%', 40, 99, 85, 'maior'),
  inteiro('barra.cache.amarelo', ['barra', 'cache', 'amarelo'], 'barra', 'Cache: amarelo abaixo de', '%', 10, 90, 50, 'menor'),
  inteiro('barra.cache.verde', ['barra', 'cache', 'verde'], 'barra', 'Cache: verde a partir de', '%', 20, 99, 80, 'menor'),
  inteiro('alertas.projecao5hMin.0', ['alertas', 'projecao5hMin', 0], 'alertas', 'Projeção de 5 h: primeiro aviso', 'min', 10, 180, 60, 'menor'),
  inteiro('alertas.projecao5hMin.1', ['alertas', 'projecao5hMin', 1], 'alertas', 'Projeção de 5 h: segundo aviso', 'min', 5, 120, 30, 'menor'),
  inteiro('alertas.projecao7dH', ['alertas', 'projecao7dH'], 'alertas', 'Projeção da semana: aviso', 'h', 1, 72, 24, 'menor'),
  booleano('painel.avisarVersaoNova', ['painel', 'avisarVersaoNova'], 'painel', 'Avisar versão nova', true),
  booleano('painel.animarLogo', ['painel', 'animarLogo'], 'painel', 'Animar o logo', true),
  booleano('aprendizado.ligado', ['aprendizado', 'ligado'], 'aprendizado', 'Aprendizado ligado', true),
  booleano('roteamento.negarN1', ['roteamento', 'negarN1'], 'roteamento', 'Roteamento: negar N1', PADRAO_ROTEAMENTO.negarN1),
  booleano('roteamento.negarN2', ['roteamento', 'negarN2'], 'roteamento', 'Roteamento: negar N2', PADRAO_ROTEAMENTO.negarN2),
  booleano('roteamento.avisos', ['roteamento', 'avisos'], 'roteamento', 'Roteamento: avisos', PADRAO_ROTEAMENTO.avisos),
  booleano('roteamento.sugerirSessao', ['roteamento', 'sugerirSessao'], 'roteamento', 'Roteamento: sugerir sessão', PADRAO_ROTEAMENTO.sugerirSessao),
]);

// Pares que precisam de ordem: [menor, maior, estrito]. Um par incoerente no
// arquivo volta inteiro ao padrão; na validação, vira erro.
export const PARES = Object.freeze([
  Object.freeze(['barra.ctx.amarelo', 'barra.ctx.vermelho', true]),
  Object.freeze(['barra.cache.amarelo', 'barra.cache.verde', true]),
  Object.freeze(['alertas.projecao5hMin.1', 'alertas.projecao5hMin.0', true]),
  Object.freeze(['guarda.liberacao.padraoH', 'guarda.liberacao.maxH', false]),
]);

export const ITEM = Object.freeze(Object.fromEntries(ITENS.map((i) => [i.id, i])));
