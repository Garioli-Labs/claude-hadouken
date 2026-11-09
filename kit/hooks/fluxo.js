// SessionStart do hadouken-kit (spec §5.2): imprime uma constante e, desde a
// v0.6.0 (Fatia 1), um aviso de cópia em dobro. Este arquivo não lê stdin,
// arquivo nem ambiente e não importa nada de forma estática: a avaliação das
// dependências mora em ./dependencias.js, carregada com import() dentro de
// try. Qualquer exceção (módulo ausente, leitura, avaliação) → só o
// additionalContext de sempre, sem aviso.
// Até 1 600 caracteres e 5 linhas (o teste confere): cada skill do Matt
// Pocock que o superpowers não cobre vai com o seu momento, para o Claude
// acioná-la sozinho (pedido do Sr. Garioli, 2026-10-14). As que têm
// disable-model-invocation vão com / e viram sugestão ao usuário (C1 da
// revisão final: o modelo não consegue acioná-las). v0.5.1: mattpocock-skills
// 1.3.1 (sem resolving-merge-conflicts; com pr e wizard).
const TEXTO = [
  'hadouken-kit: acione as skills sozinho, no momento certo; as citadas com / só o usuário aciona: no momento delas, sugira que ele digite o comando (tabela: hadouken-kit:fluxo). Processo: ideia → superpowers:brainstorming; plano → superpowers:writing-plans; execução → superpowers:subagent-driven-development; teste → superpowers:test-driven-development; bug → superpowers:systematic-debugging.',
  'Matt Pocock: plano ou decisão a pôr à prova → mattpocock-skills:grilling (/mattpocock-skills:grill-with-docs se há glossário/ADRs); conversar não resolve → mattpocock-skills:prototype; conversa já decidiu tudo → /mattpocock-skills:to-spec; trabalho vai para um tracker → /mattpocock-skills:to-tickets; não cabe numa sessão → /mattpocock-skills:wayfinder.',
  'Contexto longo ou troca de sessão → /mattpocock-skills:handoff; corpo de PR → mattpocock-skills:pr; passo só do usuário (credencial, segredo de CI) → mattpocock-skills:wizard; lentidão ou regressão de desempenho → mattpocock-skills:diagnosing-bugs; antes do merge, o branch inteiro → mattpocock-skills:code-review.',
  'Interface ou costura de módulo → mattpocock-skills:codebase-design; o mesmo atrito se repete → /mattpocock-skills:improve-codebase-architecture; termo novo ou decisão de arquitetura → mattpocock-skills:domain-modeling; fato de doc/API a confirmar → mattpocock-skills:research; issues/PRs a separar → /mattpocock-skills:triage; o usuário quer aprender → /mattpocock-skills:teach.',
  'Web: hadouken-kit:yu-ux-web-expert. Grafo do código: hadouken-kit:graphify. Antes de etapa cara (Fable, muitos subagentes, Workflow), leia a linha de consumo.',
].join('\n');

let aviso = null;
try {
  aviso = (await import('./dependencias.js')).avisoDaSessao();
} catch { /* sem aviso */ }

const saida = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: TEXTO } };
if (typeof aviso === 'string' && aviso !== '') saida.systemMessage = aviso;
process.stdout.write(JSON.stringify(saida));
