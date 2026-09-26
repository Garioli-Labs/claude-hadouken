import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O pouco que o caminho curto da barra precisa antes do gate (spec 8.2):
// diretório de dados e validador de id de sessão, mais o validador de
// instante que os dados em disco usam. Fica fora de estado.js para que a
// barra de uma sessão não registrada não carregue a camada de estado inteira;
// estado.js reexporta os três. Mora aqui também a varredura limitada de
// temporários que shim.js e estado.js dividem (varrerTmpVelhos, não
// reexportada): o caminho curto nunca a chama, e node:fs já vem carregado por
// ativas.js, então ela não pesa na barra de uma sessão não registrada.
//
// fs é usado pelo objeto padrão de node:fs, nunca desestruturado: os testes
// trocam opendirSync e lstatSync nesse objeto para contar a varredura.
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

// Temporários da escrita atômica deixados por um processo morto entre a
// escrita e o rename (bin/ de shim.js, a pasta de dados de estado.js): saem
// depois de 1 h. Roda a cada gravação de estado.json (o redesenho da barra
// registrada) e a cada sincronização de shims (o SessionStart), então o custo
// por chamada é limitado (shim.js N-2, estado.js O-1): opendir lido entrada a
// entrada, nunca a listagem inteira, e para no primeiro limite atingido
// (TMP_LER_MAX entradas, TMP_CHECAR_MAX lstat, TMP_REMOVER_MAX remoções). Uma
// pasta inundada não atrasa ninguém; o que passar do limite espera a próxima
// chamada. Só sai arquivo regular cujo nome passa em `ehTmp` e com mtime de
// mais de TMP_VELHO_MS; nada de pasta ou link, e unlink nunca segue link. O
// Dir é sempre fechado. Melhor esforço: nunca lança.
const TMP_VELHO_MS = 3_600_000;
const TMP_LER_MAX = 256;
const TMP_CHECAR_MAX = 64;
const TMP_REMOVER_MAX = 20;

export function varrerTmpVelhos(pasta, ehTmp) {
  let d;
  try {
    d = fs.opendirSync(pasta);
    const corte = Date.now() - TMP_VELHO_MS;
    let checados = 0;
    let removidos = 0;
    for (let lidos = 0; lidos < TMP_LER_MAX && checados < TMP_CHECAR_MAX && removidos < TMP_REMOVER_MAX; lidos++) {
      const entrada = d.readSync();
      if (entrada === null) break;
      if (!ehTmp(entrada.name)) continue;
      checados++;
      const caminho = path.join(pasta, entrada.name);
      try {
        const info = fs.lstatSync(caminho);
        if (!info.isFile() || info.mtimeMs >= corte) continue;
        fs.unlinkSync(caminho);
        removidos++;
      } catch { /* sumiu ou sem permissão: segue */ }
    }
  } catch {
    /* pasta ilegível: fica para a próxima chamada */
  } finally {
    if (d !== undefined) {
      try { d.closeSync(); } catch { /* já fechada */ }
    }
  }
}
