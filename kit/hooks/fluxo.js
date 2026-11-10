// SessionStart do hadouken-kit (spec §5.2): imprime o additionalContext e, desde
// a v0.6.0, os avisos do kit (cópia em dobro de dependência, Fatia 1; régua de
// desenvolvimento, Fatia 7). Este arquivo não lê stdin, arquivo nem ambiente e
// não importa nada de forma estática: a avaliação das dependências mora em
// ./dependencias.js e a régua em ./regua.js, carregados com import() dentro de
// try, sem sintaxe que exija ESM (funciona como CommonJS). Qualquer exceção
// (módulo ausente, leitura, avaliação) → o additionalContext com a régua padrão
// embutida abaixo, sem aviso.
// Até 2 400 caracteres e 5 linhas (o teste confere): a linha de abertura, a
// régua (até 2 000 caracteres, prefixo incluído) e a linha de Web/Grafo/consumo.
// As citadas com / só o usuário aciona (disable-model-invocation no autor do
// plugin): o modelo as sugere, não as aciona (C1 da revisão final).
const ABERTURA = 'hadouken-kit: acione as skills sozinho, no momento certo; as citadas com / só o usuário aciona: no momento delas, sugira que ele digite o comando (tabela: hadouken-kit:fluxo).';
const FINAL = 'Web: hadouken-kit:yu-ux-web-expert. Grafo do código: hadouken-kit:graphify. Antes de etapa cara (Fable, muitos subagentes, Workflow), leia a linha de consumo.';

// A régua padrão (kit/regua-padrao.json) já renderizada: vale quando o regua.js
// não carrega. test/kit-regua.test.js garante que é igual à renderizada.
const REGUA_RESERVA = 'Régua (padrão): Ideia → superpowers:brainstorming (alt.: mattpocock-skills:grilling — plano ou decisão a pôr à prova | /mattpocock-skills:grill-with-docs — projeto tem glossário/ADRs); Protótipo → mattpocock-skills:prototype (alt.: /mattpocock-skills:handoff — contexto longo ou troca de sessão); Registrar a forma → superpowers:brainstorming (alt.: /mattpocock-skills:to-spec — a conversa já decidiu tudo); Auditoria da spec → agente hadouken:auditor; Quebrar o trabalho → superpowers:writing-plans (alt.: /mattpocock-skills:to-tickets — vai para um tracker | /mattpocock-skills:wayfinder — não cabe numa sessão); Executar → superpowers:subagent-driven-development; Teste e bug → superpowers:test-driven-development, superpowers:systematic-debugging (alt.: mattpocock-skills:diagnosing-bugs — lentidão ou regressão); Revisar → superpowers:requesting-code-review, mattpocock-skills:code-review; Mutação → hadouken-kit:mutacao; Auditoria do diff → agente hadouken:auditor; Transversais: mattpocock-skills:codebase-design — interface ou costura de módulo; /mattpocock-skills:improve-codebase-architecture — o mesmo atrito se repete; mattpocock-skills:domain-modeling — termo novo ou decisão de arquitetura; mattpocock-skills:research — fato de doc/API a confirmar; /mattpocock-skills:triage — issues/PRs a separar; /mattpocock-skills:teach — o usuário quer aprender; mattpocock-skills:pr — corpo de PR; mattpocock-skills:wizard — passo só do usuário; poka-yoke:audit — segurança; poka-yoke:retro — depois de incidente';

// IIFE async, não await de topo: sem o package.json do kit ao lado, o Node
// lê este arquivo como CommonJS, e await de topo seria erro de sintaxe (hook
// sem saída). O import() cobre também os módulos (ESM) não carregarem.
(async () => {
  let aviso = null;
  let regua = null;
  try {
    aviso = (await import('./dependencias.js')).avisoDaSessao();
  } catch { /* sem aviso */ }
  try {
    regua = (await import('./regua.js')).reguaDaSessao();
  } catch { /* régua padrão embutida */ }
  const texto = typeof regua?.texto === 'string' && regua.texto !== '' ? regua.texto : REGUA_RESERVA;
  const avisos = [aviso, ...(Array.isArray(regua?.avisos) ? regua.avisos : [])].filter((a) => typeof a === 'string' && a !== '');
  const saida = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [ABERTURA, texto, FINAL].join('\n') } };
  if (avisos.length > 0) saida.systemMessage = avisos.join('\n');
  process.stdout.write(JSON.stringify(saida));
})();
