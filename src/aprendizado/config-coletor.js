import { caminhoAceito } from '../configuracao.js';

// Primeira barreira (spec aprendizado §5.1): a configuração do Collector,
// gerada aqui e regravada a cada subida (coletor.js), nunca editada pelo
// usuário. Receptor só http em 127.0.0.1 (sem gRPC); memory_limiter, depois
// os deletes em resource e attributes (as chaves de SENSIVEIS e todo vcs.*
// por padrão), depois batch; um único exportador `file` com rotação;
// telemetria própria desligada; sem extensões; sem pipeline de traces (§2).
// O caminho entra no YAML entre aspas simples, só depois de passar por
// caminhoAceito (a lista do comando da barra, sem aspas, $, barra invertida
// nem quebra de linha). Nunca lança.

export const PORTA = 47318;
export const HOST = '127.0.0.1';
export const SENSIVEIS = Object.freeze([
  'user.email', 'user.account_uuid', 'user.account_id', 'user.id', 'organization.id', 'workspace.host_paths',
]);
export const PADRAO_VCS = '^vcs\\..*';
export const ROTACAO = Object.freeze({ max_megabytes: 5, max_days: 30, max_backups: 3 });
export const MEMORIA_MIB = 64;
const PROCESSADORES = '[memory_limiter, resource/hadouken, attributes/hadouken, batch]';

function deletes(recuo) {
  const linhas = [];
  for (const k of SENSIVEIS) linhas.push(`${recuo}- key: ${k}`, `${recuo}  action: delete`);
  linhas.push(`${recuo}- pattern: ${PADRAO_VCS}`, `${recuo}  action: delete`);
  return linhas;
}

export function configColetor(opcoes) {
  try {
    const bruto = opcoes?.arquivoTelemetria;
    if (typeof bruto !== 'string') return { ok: false, motivo: 'caminho-inseguro' };
    const arquivo = bruto.replaceAll('\\', '/');
    if (!caminhoAceito(arquivo)) return { ok: false, motivo: 'caminho-inseguro' };
    const linhas = [
      'receivers:',
      '  otlp:',
      '    protocols:',
      '      http:',
      `        endpoint: ${HOST}:${PORTA}`,
      'processors:',
      '  memory_limiter:',
      '    check_interval: 1s',
      `    limit_mib: ${MEMORIA_MIB}`,
      '    spike_limit_mib: 16',
      '  resource/hadouken:',
      '    attributes:',
      ...deletes('      '),
      '  attributes/hadouken:',
      '    actions:',
      ...deletes('      '),
      '  batch: {}',
      'exporters:',
      '  file:',
      `    path: '${arquivo}'`,
      '    format: json',
      '    rotation:',
      `      max_megabytes: ${ROTACAO.max_megabytes}`,
      `      max_days: ${ROTACAO.max_days}`,
      `      max_backups: ${ROTACAO.max_backups}`,
      'service:',
      '  telemetry:',
      '    metrics:',
      '      level: none',
      '    logs:',
      '      level: error',
      '  pipelines:',
      '    metrics:',
      '      receivers: [otlp]',
      `      processors: ${PROCESSADORES}`,
      '      exporters: [file]',
      '    logs:',
      '      receivers: [otlp]',
      `      processors: ${PROCESSADORES}`,
      '      exporters: [file]',
      '',
    ];
    return { ok: true, texto: linhas.join('\n') };
  } catch {
    return { ok: false, motivo: 'caminho-inseguro' };
  }
}
