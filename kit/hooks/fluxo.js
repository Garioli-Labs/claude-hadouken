// SessionStart do hadouken-kit (spec §5.2): só imprime uma constante.
// Não lê stdin, arquivo nem ambiente; não importa módulo nenhum.
// Até 1 600 caracteres e 5 linhas (o teste confere): cada skill do Matt
// Pocock que o superpowers não cobre vai com o seu momento, para o Claude
// acioná-la sozinho (pedido do Sr. Garioli, 2026-10-14). As que têm
// disable-model-invocation vão com / e viram sugestão ao usuário (C1 da
// revisão final: o modelo não consegue acioná-las).
const TEXTO = [
  'hadouken-kit: acione as skills sozinho, no momento certo, sem esperar o pedido; as citadas com / só o usuário aciona: no momento delas, sugira que ele digite o comando (tabela e desempates: hadouken-kit:fluxo). Processo: ideia → superpowers:brainstorming; plano → superpowers:writing-plans; execução → superpowers:subagent-driven-development; teste → superpowers:test-driven-development; bug → superpowers:systematic-debugging.',
  'Matt Pocock: plano ou decisão a pôr à prova → mattpocock-skills:grilling (/mattpocock-skills:grill-with-docs se há glossário/ADRs); conversar não resolve → mattpocock-skills:prototype; conversa já decidiu tudo → /mattpocock-skills:to-spec; trabalho vai para um tracker → /mattpocock-skills:to-tickets; não cabe numa sessão → /mattpocock-skills:wayfinder.',
  'Contexto longo ou troca de sessão → /mattpocock-skills:handoff; conflito de merge/rebase → mattpocock-skills:resolving-merge-conflicts; lentidão ou regressão de desempenho → mattpocock-skills:diagnosing-bugs; antes do merge, o branch inteiro → mattpocock-skills:code-review.',
  'Interface ou costura de módulo → mattpocock-skills:codebase-design; o mesmo atrito se repete → /mattpocock-skills:improve-codebase-architecture; termo novo ou decisão de arquitetura → mattpocock-skills:domain-modeling; fato de doc/API a confirmar → mattpocock-skills:research; issues/PRs a separar → /mattpocock-skills:triage; o usuário quer aprender → /mattpocock-skills:teach.',
  'Web: hadouken-kit:yu-ux-web-expert. Grafo do código: hadouken-kit:graphify. Antes de etapa cara (Fable, muitos subagentes, Workflow), leia a linha de consumo.',
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: TEXTO },
}));
