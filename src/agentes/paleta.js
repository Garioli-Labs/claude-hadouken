// Paleta de dez agentes do plugin (spec v0.6.0 §4 Fatia 3). Fonte única do
// nome, do model·effort, das ferramentas e do "use para" de cada agente: os
// arquivos agents/*.md, o texto de roteamento do SessionStart e a regra A1/A2
// leem daqui. Um teste confere que agents/*.md e esta lista andam juntos.
//
// ferramentas: lista (campo `tools` do agente), 'todas' (sem restrição) ou
// 'todas-menos-escrita' (`disallowedTools: Write, Edit, NotebookEdit`).
// substituto: quem faz o trabalho quando o agente está inativo; null = o
// principal faz direto.
const agente = (nome, model, effort, ferramentas, substituto, uso, naoUsar) => Object.freeze({
  nome, model, effort, ferramentas, substituto, uso, naoUsar,
});

export const PALETA = Object.freeze([
  agente('busca', 'haiku', 'low', Object.freeze(['Read', 'Grep', 'Glob']), 'varredor', 'achar arquivo e símbolo, ler e resumir trecho', 'decidir, revisar, editar'),
  agente('varredor', 'haiku', 'medium', 'todas-menos-escrita', 'busca', 'varredura do repo, inventário, número de fonte primária (query só leitura, API)', 'editar, decidir'),
  agente('pesquisa', 'sonnet', 'low', Object.freeze(['WebSearch', 'WebFetch', 'Read']), null, 'doc, API e versão na web, com a URL', 'opinião, arquitetura'),
  agente('mecanico', 'haiku', 'low', Object.freeze(['Read', 'Edit', 'Write', 'Grep', 'Glob']), 'implementador-mecanico', 'edição com instrução exata', 'escolher abordagem'),
  agente('implementador-mecanico', 'sonnet', 'medium', 'todas', 'implementador', 'fatia mecânica provada por teste', 'julgamento de negócio ou de arquitetura'),
  agente('implementador', 'sonnet', 'high', 'todas', 'implementador-mecanico', 'fatia com spec e plano fechados, teste primeiro', 'decidir arquitetura'),
  agente('revisor', 'sonnet', 'high', Object.freeze(['Read', 'Grep', 'Glob', 'Bash']), 'auditor', 'review de fatia contra spec, plano e convenções; defeito com arquivo:linha', 'opinião de estilo'),
  agente('auditor', 'fable', 'high', 'todas-menos-escrita', 'revisor', 'auditoria adversarial de spec ou plano com impacto em produção, migração de dados, segurança, autenticação ou dinheiro, contra código vivo', 'estilo, review comum'),
  agente('e2e', 'sonnet', 'high', 'todas', 'implementador', 'e2e onde o usuário vê e tarefas de operação; artefatos com o prefixo de teste do projeto, limpos ao final', 'implementar'),
  agente('redator', 'sonnet', 'medium', Object.freeze(['Read', 'Grep', 'Glob']), null, 'texto para terceiros, devolvido sem publicar', 'decidir'),
]);

// Agentes que saíram na 0.6.0 e quem os substitui.
export const REMOVIDOS = Object.freeze({ executor: 'implementador', 'revisor-critico': 'auditor' });

// Agentes de revisão: fora dos avisos A1 (Fable ou effort max) e A2 (busca em
// Opus/Fable) do roteamento.
export const AGENTES_REVISAO = Object.freeze(['revisor', 'auditor']);

// A paleta com o override da config. Sem a chave `agentes` implementada
// (Fatia 4), é sempre o padrão.
export function paletaEfetiva(_agentes = {}) {
  return PALETA.map((p) => ({ nome: p.nome, model: p.model, effort: p.effort, ativo: true, override: false }));
}
