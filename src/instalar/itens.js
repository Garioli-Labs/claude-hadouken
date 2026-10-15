// Itens do resumo do instalador (spec v0.5.2 §7). Rótulos fixos deste
// projeto; nenhum texto de fora (saída do claude, winget, brew, pip) entra.
export const item = Object.freeze({
  ok: (nome, detalhe) => ({ nome, estado: 'ok', detalhe }),
  igual: (nome) => ({ nome, estado: 'igual', detalhe: 'já estava' }),
  pulado: (nome, motivo) => ({ nome, estado: 'pulado', detalhe: motivo }),
  falhou: (nome, motivo, conserto) => ({ nome, estado: 'falhou', detalhe: motivo, conserto }),
});

export function formatarResumo(itens) {
  const linhas = itens.map((i) => {
    if (i.estado === 'igual') return `= ${i.nome}: já estava`;
    if (i.estado === 'pulado') return `– ${i.nome}: pulado (${i.detalhe})`;
    if (i.estado === 'falhou') return `✗ ${i.nome}: falhou (${i.detalhe}${i.conserto ? `; ${i.conserto}` : ''})`;
    return `✓ ${i.nome}: ${i.detalhe}`;
  });
  linhas.push('', 'Abra uma sessão nova do Claude Code.');
  return linhas.join('\n');
}

export const codigoDeSaida = (itens) => (itens.some((i) => i.estado === 'falhou') ? 1 : 0);
