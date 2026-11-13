import os from 'node:os';

// Memória que dá para usar agora. No macOS o os.freemem() conta só as páginas
// livres e deixa de fora o cache reaproveitável (~0,08 GB numa máquina de
// 24 GB com 4 GB de folga), então ali vale process.availableMemory(), que no
// Node 20 só existe a partir da 20.13 (engines pede >=20). Sem a função, com
// valor inválido ou se ela lançar, e em qualquer outra plataforma, o
// resultado é o os.freemem() de sempre.
export function memoriaDisponivel({
  plataforma = process.platform,
  livre = os.freemem,
  disponivel = process.availableMemory,
} = {}) {
  if (plataforma === 'darwin' && typeof disponivel === 'function') {
    try {
      const v = disponivel();
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    } catch {
      // cai no livre
    }
  }
  return livre();
}
