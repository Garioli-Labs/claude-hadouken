import os from 'node:os';
import path from 'node:path';

// O pouco que o caminho curto da barra precisa antes do gate (spec 8.2):
// diretório de dados e validador de id de sessão, mais o validador de
// instante que os dados em disco usam. Fica fora de estado.js para que a
// barra de uma sessão não registrada não carregue a camada de estado inteira;
// estado.js reexporta tudo daqui.
//
// os.homedir é chamado pelo objeto padrão de node:os, nunca desestruturado:
// os testes de "sem home" trocam os.homedir nesse objeto, e uma cópia feita
// no import não veria a troca (dirDados devolveria o ~/.claude/hadouken de
// verdade de quem roda os testes).

// Tolerância para relógio adiantado: um `at` até 5 min no futuro ainda vale.
const FUTURO_MAX_MS = 5 * 60_000;
// Um instante ISO tem 24 caracteres; texto maior que isto nem vai ao Date.parse.
const MAX_AT_CHARS = 64;
const ID_SESSAO = /^[A-Za-z0-9_-]{1,64}$/;

const numeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);

// Diretório de dados, sempre absoluto: HADOUKEN_HOME (resolvido contra o cwd
// no momento da chamada, para que caminhos derivados, como shims e o comando
// da statusline, não dependam do cwd de quem os usa depois) ou
// ~/.claude/hadouken. Sem home conhecida (os.homedir() lança ou não devolve
// caminho absoluto) devolve null, nunca um diretório compartilhado: todo
// chamador trata null como "sem leitura" e não faz I/O (contrato de T6, T7 e
// T10). Nunca lança.
export function dirDados() {
  try {
    const configurado = process.env.HADOUKEN_HOME;
    if (configurado) return path.resolve(configurado);
    const home = os.homedir();
    return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.claude', 'hadouken') : null;
  } catch {
    return null;
  }
}

// Instante gravado em texto: string de até 64 caracteres que o Date.parse
// entende e que não está mais que 5 min à frente de `agoraMs`. Devolve o
// instante em ms ou null. O passado não é recusado aqui: a idade máxima é
// decisão de quem chama (LIMITE_VELHO_MS, SESSAO_MAX_MS). Nunca lança.
export function instante(valor, agoraMs) {
  if (!numeroFinito(agoraMs)) return null;
  if (typeof valor !== 'string' || valor.length > MAX_AT_CHARS) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) && t <= agoraMs + FUTURO_MAX_MS ? t : null;
}

// Id de sessão aceitável como chave: ^[A-Za-z0-9_-]{1,64}$ e, além do padrão,
// nunca um membro de Object.prototype (__proto__, constructor, toString...),
// que casa com a regex mas, num objeto comum, faria a busca devolver o membro
// herdado. Mesmo validador para estado.json, o registro de ativação (ativas/)
// e os hooks. Nunca lança.
export const idValido = (id) => typeof id === 'string' && ID_SESSAO.test(id) && !(id in Object.prototype);
