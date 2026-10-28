import { lerConfiguracao } from '../config/ler.js';

// Os interruptores das proteções fixas (Emenda 3 da spec v0.5.3 VS Code,
// §12.2): cada hook pergunta pelo seu antes de negar. Desligar é afrouxar,
// então na dúvida (sem pasta de dados, config.json ausente, ilegível ou com o
// item inválido, exceção) a proteção vale. O config.json fica na pasta de
// dados, que a P5 ligada protege: o Claude não desliga nada por edição.

export const PROTECOES = Object.freeze(['protecoes.sessaoFilha', 'protecoes.arquivos', 'protecoes.hooks', 'protecoes.agenda']);

export function protecaoLigada(dir, id) {
  try {
    if (typeof dir !== 'string' || !PROTECOES.includes(id)) return true;
    return lerConfiguracao(dir).itens.find((i) => i.id === id)?.valor !== false;
  } catch {
    return true;
  }
}
