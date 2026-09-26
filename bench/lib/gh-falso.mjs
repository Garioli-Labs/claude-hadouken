// Executor falso do gh para bench/consumo.mjs: responde em memória, sem
// processo e sem rede, os endpoints que src/github.js pede para um repo com
// atividade moderada (30 execuções em 30 dias, 3 jobs cada, um por sistema).
// As respostas têm a forma da API real, com campos que o coletor não lê
// (nomes, branch, ator, steps), para que o custo de ler o JSON seja o de uma
// resposta de verdade. Endpoint desconhecido: HTTP 404.

export const REPO_FALSO = 'exemplo/app-sintetico';
export const RUNS_FALSOS = 30;
export const JOBS_POR_RUN = 3;
export const BYTES_CACHE_FALSO = 1_610_612_736;
// Chamadas de uma coleta sem cache: a página 1 das execuções (o total cabe
// nela), o uso de cache e os jobs de cada execução. A visibilidade vem nas
// execuções (repository.private), então repos/<repo> não é pedido.
export const CHAMADAS_FRIO = 2 + RUNS_FALSOS;

const MIN = 60_000;
const HORA = 60 * MIN;
const ID_BASE = 17_000_000_000;
const EVENTOS = ['push', 'pull_request', 'push', 'schedule', 'push', 'workflow_dispatch'];
const SISTEMAS = [['ubuntu-latest', 3], ['windows-latest', 5], ['macos-latest', 4]];
const iso = (ms) => new Date(ms).toISOString();

// Execução i: criada há (22 i + 1) h, a mais velha há ~27 dias.
function execucoes(agoraMs) {
  return Array.from({ length: RUNS_FALSOS }, (_, i) => {
    const criada = agoraMs - (22 * i + 1) * HORA;
    return {
      id: ID_BASE + i,
      name: 'CI',
      display_title: `commit sintetico ${i}`,
      head_branch: i % 4 === 1 ? `feat/ramo-${i}` : 'main',
      head_sha: (ID_BASE + i).toString(16).padStart(40, '0'),
      path: '.github/workflows/ci.yml',
      event: EVENTOS[i % EVENTOS.length],
      status: 'completed',
      conclusion: i % 9 === 4 ? 'failure' : i % 13 === 7 ? 'cancelled' : 'success',
      run_attempt: i % 10 === 6 ? 2 : 1,
      created_at: iso(criada),
      updated_at: iso(criada + 12 * MIN),
      run_started_at: iso(criada),
      actor: { login: 'autor-sintetico', id: 1, type: 'User' },
      repository: { id: 42, name: 'app-sintetico', full_name: REPO_FALSO, private: true },
    };
  });
}

// Jobs da execução i: um por sistema, com duração que varia com i.
function jobs(agoraMs, i) {
  const criada = agoraMs - (22 * i + 1) * HORA;
  return SISTEMAS.map(([rotulo, base], k) => {
    const inicio = criada + 30_000;
    const fim = inicio + (base + ((i + k) % 4)) * MIN + 17_000;
    return {
      id: (ID_BASE + i) * 10 + k,
      run_id: ID_BASE + i,
      name: `testes (${rotulo})`,
      status: 'completed',
      conclusion: 'success',
      started_at: iso(inicio),
      completed_at: iso(fim),
      labels: [rotulo],
      runner_name: `GitHub Actions ${k + 1}`,
      runner_group_name: 'GitHub Actions',
      steps: ['Set up job', 'Checkout', 'Setup Node', 'Testes', 'Complete job'].map((nome, n) => ({
        name: nome, status: 'completed', conclusion: 'success', number: n + 1, started_at: iso(inicio), completed_at: iso(fim),
      })),
    };
  });
}

// Executor (args, sinal) no contrato de src/github.js, mais `chamadas()`, o
// número de endpoints pedidos até agora.
export function criarGhFalso(agoraMs) {
  const base = `repos/${REPO_FALSO}`;
  const lista = execucoes(agoraMs);
  let chamadas = 0;
  const ok = (v) => ({ ok: true, stdout: JSON.stringify(v) });
  const gh = async (args) => {
    chamadas++;
    const ep = Array.isArray(args) ? args[1] : undefined;
    if (typeof ep !== 'string') return { ok: false, motivo: 'HTTP 404' };
    if (ep === base) return ok({ id: 42, full_name: REPO_FALSO, private: true, visibility: 'private' });
    if (ep.startsWith(`${base}/actions/runs?`)) {
      const pagina = Number(new URLSearchParams(ep.split('?')[1]).get('page'));
      return ok({ total_count: lista.length, workflow_runs: pagina === 1 ? lista : [] });
    }
    const m = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/.exec(ep);
    if (m !== null && ep.startsWith(`${base}/`)) {
      const i = Number(m[1]) - ID_BASE;
      if (Number.isInteger(i) && i >= 0 && i < lista.length) {
        const j = jobs(agoraMs, i);
        return ok({ total_count: j.length, jobs: j });
      }
    }
    if (ep === `${base}/actions/cache/usage`) return ok({ full_name: REPO_FALSO, active_caches_size_in_bytes: BYTES_CACHE_FALSO, active_caches_count: 14 });
    return { ok: false, motivo: 'HTTP 404' };
  };
  return { gh, chamadas: () => chamadas };
}
