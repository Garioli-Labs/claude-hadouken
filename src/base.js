import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O pouco que o caminho curto da barra precisa antes do gate (spec 8.2):
// diretório de dados e validador de id de sessão, mais o validador de
// instante que os dados em disco usam. Fica fora de estado.js para que a
// barra de uma sessão não registrada não carregue a camada de estado inteira;
// estado.js reexporta os três. Moram aqui também as partes da escrita atômica
// que estado.js, shim.js e configuracao.js dividem (a varredura limitada de
// temporários varrerTmpVelhos, a política de retentativa do rename e quatro
// ajudantes pequenos; nada disso é reexportado): o caminho curto nunca as
// chama, e node:fs já vem carregado por ativas.js, então elas não pesam na
// barra de uma sessão não registrada.
//
// fs é usado pelo objeto padrão de node:fs, nunca desestruturado: os testes
// trocam métodos nesse objeto (opendirSync e lstatSync para contar a
// varredura, entre outros), e uma cópia feita no import não veria a troca.
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
// escrita e o rename (bin/ de shim.js, a pasta de dados de estado.js, a pasta
// do settings.json de configuracao.js): saem depois de 1 h. Roda a cada
// gravação de estado.json (o redesenho da barra registrada), a cada
// sincronização de shims (o SessionStart) e depois de cada gravação do
// settings.json pelo instalador, então o custo por chamada é limitado
// (shim.js N-2, estado.js O-1): opendir lido entrada a entrada, nunca a
// listagem inteira, e para no primeiro limite atingido (TMP_LER_MAX
// entradas, TMP_CHECAR_MAX lstat, TMP_REMOVER_MAX remoções). Uma pasta
// inundada não atrasa ninguém; o que passar do limite espera a próxima
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
        // Hard link: o unlink no Windows (libuv 1.46) mexe no outro nome; nunca remove.
        if (!info.isFile() || info.nlink !== 1 || info.mtimeMs >= corte) continue;
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

// Política de retentativa do rename que os três gravadores atômicos dividem.
// Só a política e os ajudantes abaixo são comuns: cada módulo mantém o
// próprio temporário e o próprio laço de rename, porque as garantias diferem
// (estado.json: nome previsível criado com 'wx' na pasta de dados; shims:
// nome sorteado, lstat antes do 'wx' e liberação do shim somente leitura
// entre as tentativas; settings.json: nome sorteado, modo do original, fsync,
// backup e nova conferência pelo lstat antes de cada tentativa).
//
// No Windows um antivírus, um indexador, um leitor concorrente ou o próprio
// Claude Code pode segurar o destino (ou um .mjs recém-escrito) por
// instantes, e o rename falha com EPERM, EACCES ou EBUSY: até
// RENOMEAR_TENTATIVAS tentativas, com RENOMEAR_ESPERA_MS entre elas. Outros
// erros não melhoram tentando de novo. O conjunto de códigos fica privado:
// quem chama pergunta a renomearDeNovo, e nenhum módulo consegue alargá-lo
// para os outros.
export const RENOMEAR_TENTATIVAS = 3;
export const RENOMEAR_ESPERA_MS = 20;
const RENOMEAR_TRANSITORIOS = new Set(['EPERM', 'EACCES', 'EBUSY']);

// O rename que falhou com `e` na tentativa `tentativa` (contada a partir de 1)
// merece outra: erro passageiro e tentativas ainda abaixo de
// RENOMEAR_TENTATIVAS. Valor lançado sem `code` (até null) não é passageiro.
export const renomearDeNovo = (e, tentativa) => tentativa < RENOMEAR_TENTATIVAS && RENOMEAR_TRANSITORIOS.has(e?.code);

// Espera síncrona entre duas tentativas (os gravadores são síncronos). Se a
// espera falhar, segue sem esperar. Nunca lança.
export const esperar = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue sem esperar */ }
};

// Apaga a entrada (unlink nunca segue link) e ignora a que já sumiu. Nunca lança.
export const apagar = (arquivo) => { try { fs.unlinkSync(arquivo); } catch { /* já não existe */ } };

// Fecha o descritor e ignora o que já estava fechado. Nunca lança.
export const fechar = (fd) => { try { fs.closeSync(fd); } catch { /* já fechado */ } };

// Erro com `code`, para uma recusa própria (EEXIST, 'tmp_invalido',
// 'shim_invalido') seguir o mesmo caminho dos erros de sistema.
export const erroComCodigo = (code) => Object.assign(new Error(code), { code });
