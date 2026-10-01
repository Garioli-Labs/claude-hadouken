import { lerSemLink } from './arquivo.js';
import { TETO, caminhos, ligadoExiste, valorDoItem } from '../aprendizado/arquivos.js';

// Aperto aprendido da guarda (spec aprendizado §4.4). A guarda lê
// min(config.json, aperto), e só esse mínimo: o aperto nunca afrouxa nada.
// Aprendizado desligado (sem otel/ligado.json), ajustes.json ausente,
// inválido, acima de 64 KiB ou link: sem aperto, e a guarda usa o
// config.json puro, que o próprio usuário escolheu (§10, limite registrado
// no SECURITY.md). Sem rede e sem processo filho, como todo src/guarda/**;
// só importa o módulo leve de nomes do aprendizado.

const ITEM_DO_CAMPO = Object.freeze({ fableTetoPct: 'guarda.fableTetoPct', teto7d: 'guarda.teto7d' });
const nenhum = () => ({ fableTetoPct: null, teto7d: null });

export function lerAperto(dir) {
  try {
    if (!ligadoExiste(dir)) return nenhum();
    const l = lerSemLink(caminhos(dir).ajustes, TETO.ajustes);
    const vig = l.ok && l.valor !== null && typeof l.valor === 'object' && l.valor.v === 1 ? l.valor.vigentes : null;
    if (vig === null || typeof vig !== 'object' || Array.isArray(vig)) return nenhum();
    const r = nenhum();
    for (const [campo, item] of Object.entries(ITEM_DO_CAMPO)) {
      if (!Object.hasOwn(vig, item)) continue;
      const v = valorDoItem(item, vig[item]);
      if (Number.isInteger(v)) r[campo] = v;
    }
    return r;
  } catch {
    return nenhum();
  }
}

export function aplicarAperto(config, aperto) {
  const c = { ...config };
  for (const campo of Object.keys(ITEM_DO_CAMPO)) {
    const v = aperto?.[campo];
    if (Number.isInteger(v) && v < c[campo]) c[campo] = v;
  }
  return c;
}
