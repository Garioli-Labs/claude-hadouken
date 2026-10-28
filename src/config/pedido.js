import { ITEM } from './tabela.js';

// A gramática de /hadouken:limites (spec v0.5.3 VS Code §2.2), fechada:
// nada, `padrao`, `<item> padrao` ou `<item> <valor>`. Só os itens da
// guarda, da barra, dos alertas e das proteções (Emenda 3, §12.2); o
// aprendizado e o roteamento têm comandos próprios. Valor: inteiro de até 4
// dígitos, ou liga/desliga para os booleanos. A faixa de cada item quem
// confere é validar (ler.js).

export const GRUPOS_LIMITES = Object.freeze(['guarda', 'barra', 'alertas', 'protecoes', 'saude']);
const INVALIDO = Object.freeze({ acao: 'invalido' });

export function lerPedidoLimites(args) {
  if (typeof args !== 'string') return { ...INVALIDO };
  const texto = args.trim();
  if (texto === '') return { acao: 'mostrar' };
  if (!/^[\x21-\x7e]+(?: [\x21-\x7e]+)?$/.test(texto)) return { ...INVALIDO };
  const [id, valor] = texto.split(' ');
  if (valor === undefined) return id === 'padrao' ? { acao: 'padrao-tudo' } : { ...INVALIDO };
  if (!Object.hasOwn(ITEM, id) || !GRUPOS_LIMITES.includes(ITEM[id].grupo)) return { ...INVALIDO };
  if (valor === 'padrao') return { acao: 'padrao', id };
  if (ITEM[id].tipo === 'booleano') {
    if (valor === 'liga' || valor === 'desliga') return { acao: 'gravar', id, valor: valor === 'liga' };
    return { ...INVALIDO };
  }
  return /^\d{1,4}$/.test(valor) ? { acao: 'gravar', id, valor: Number(valor) } : { ...INVALIDO };
}
