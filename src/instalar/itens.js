// Itens do resumo do instalador (spec v0.5.2 §7). Rótulos fixos deste
// projeto; nenhum texto de fora (saída do claude, winget, brew, pip) entra.
export const item = Object.freeze({
  ok: (nome, detalhe) => ({ nome, estado: 'ok', detalhe }),
  igual: (nome) => ({ nome, estado: 'igual', detalhe: 'já estava' }),
  pulado: (nome, motivo) => ({ nome, estado: 'pulado', detalhe: motivo }),
  falhou: (nome, motivo, conserto) => ({ nome, estado: 'falhou', detalhe: motivo, conserto }),
  // v0.5.9: skill de terceiro que falta; não é falha.
  sugerido: (nome, comando) => ({ nome, estado: 'sugerido', detalhe: 'sugerido', conserto: comando }),
});

export function formatarResumo(itens) {
  const linhas = itens.map((i) => {
    if (i.estado === 'igual') return `= ${i.nome}: ${i.detalhe}`;
    if (i.estado === 'sugerido') return `○ ${i.nome}: sugerido (rode ${i.conserto})`;
    if (i.estado === 'pulado') return `– ${i.nome}: pulado (${i.detalhe})`;
    if (i.estado === 'falhou') return `✗ ${i.nome}: falhou (${i.detalhe}${i.conserto ? `; ${i.conserto}` : ''})`;
    return `✓ ${i.nome}: ${i.detalhe}`;
  });
  linhas.push('', 'Abra uma sessão nova do Claude Code.');
  return linhas.join('\n');
}

export const codigoDeSaida = (itens) => (itens.some((i) => i.estado === 'falhou') ? 1 : 0);

// v0.5.9: as skills de terceiros (e o REA) não são mais instaladas: o
// instalador só confere se existem e, faltando, sugere o comando.
export const SUGERIDAS = Object.freeze([
  { nome: 'superpowers', comando: 'claude plugin install superpowers@claude-plugins-official' },
  { nome: 'mattpocock-skills', comando: 'claude plugin install mattpocock-skills@claude-hadouken' },
  { nome: 'poka-yoke', comando: 'claude plugin install poka-yoke@claude-hadouken' },
  { nome: 'fullstack-dev-skills', comando: 'claude plugin install fullstack-dev-skills@claude-hadouken' },
  { nome: 'ui-ux-pro-max', comando: 'claude plugin install ui-ux-pro-max@claude-hadouken' },
  { nome: 'hadouken-rea', comando: 'claude plugin install hadouken-rea@claude-hadouken' },
]);
