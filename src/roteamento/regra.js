// Regra curta do roteamento (spec roteamento §2): sempre no contexto do
// SessionStart, no máximo 6 linhas; a tabela inteira mora na skill
// hadouken:roteamento, carregada na hora de despachar.
export const LINHAS_REGRA = Object.freeze([
  'Roteamento: antes de lançar um agente, carregue hadouken:roteamento.',
  'Busca e leitura ampla: hadouken:busca. Mecânico com instrução exata: hadouken:mecanico.',
  'Tarefa especificada: hadouken:executor. Doc ou versão na web: hadouken:pesquisa.',
  'Revisão: hadouken:revisor; Fable (hadouken:revisor-critico) só para segurança, autenticação, dinheiro e arquitetura.',
  'Cabe em poucas chamadas sobre arquivos conhecidos: faça direto, sem agente.',
]);
