// Os textos de /hadouken:limites. Fixos ou montados só com a tabela
// (tabela.js) e com números: o argumento digitado nunca volta no texto.

const USO = 'Use /hadouken:limites para ver a tabela, /hadouken:limites <item> <valor>, /hadouken:limites <item> padrao ou /hadouken:limites padrao.';

export const RECUSADO_ENTRYPOINT = 'hadouken: nada mudado. /hadouken:limites só vale digitado numa sessão normal, não em -p nem no SDK.';
export const RECUSADO_ORIGEM = 'hadouken: nada mudado. /hadouken:limites só vale digitado pelo usuário.';
export const INVALIDO = `hadouken: nada mudado. ${USO}`;
export const MUDOU = 'hadouken: nada mudado. O config.json mudou durante a gravação; rode o comando de novo.';
export const NAO_GRAVADO = 'hadouken: nada mudado. A configuração não pôde ser gravada.';
export const PADRAO_TUDO = 'hadouken: guarda, barra, alertas e proteções voltaram ao padrão.';
export const AFROUXADO = 'Afrouxado: vale agora e desfaz o aperto do aprendizado neste item.';

const valorTexto = (item, v) => (item.tipo === 'booleano' ? (v ? 'ligada' : 'desligada') : `${v} ${item.unidade}`);
const faixaTexto = (item) => (item.tipo === 'booleano' ? 'liga/desliga' : `${item.min}–${item.max}`);

export function recusado(erros) {
  return `hadouken: nada mudado. ${erros.map((e) => e.texto).join('; ')}.`;
}

export function gravado(item, valor, afrouxouAperto) {
  const base = `hadouken: ${item.rotulo} agora é ${valorTexto(item, valor)}.`;
  return afrouxouAperto ? `${base} ${AFROUXADO}` : base;
}

export function padrao(item) {
  return `hadouken: ${item.rotulo} voltou ao padrão (${valorTexto(item, item.padrao)}).`;
}

// itens = lerConfiguracao(dir).itens, já filtrados aos grupos do comando.
export function tabela(itens, avisos) {
  const linhas = [
    'hadouken: limites atuais.', '',
    '| item | atual | padrão | faixa | aprendizado |',
    '| --- | --- | --- | --- | --- |',
    ...itens.map((i) => {
      const apertado = i.aperto !== null && i.aperto < i.valor ? `apertado pelo aprendizado: ${valorTexto(i, i.aperto)}` : '—';
      return `| ${i.id} | ${valorTexto(i, i.valor)} | ${valorTexto(i, i.padrao)} | ${faixaTexto(i)} | ${apertado} |`;
    }),
    '', USO,
  ];
  if (avisos.length > 0) linhas.push('', ...avisos.map((a) => `Aviso: ${a}`));
  return linhas.join('\n');
}
