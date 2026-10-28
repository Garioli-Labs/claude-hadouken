import { gbInteiro } from './faixas.js';

// Os textos fixos da saúde (spec v0.5.5 §6.B e §6.C). Ao Claude vão só
// números já validados e estes rótulos: nome de processo nunca entra no
// contexto dele. Ao usuário, os nomes vão saneados (processos.js) e o texto
// inteiro cabe em 300 caracteres.

export const USUARIO_MAX = 300;
const ACAO = '/hadouken:saude leve alivia o PC por 4 h; /hadouken:saude mostra o que fechar.';

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const gbDecimal = (bytes) => (bytes / 1024 ** 3).toFixed(1).replace('.', ',');

// Ao Claude, por tipo e nível (2 = vermelho; 1 = amarelo, só a RAM tem).
export function linhaClaude(tipo, nivel, valor) {
  switch (tipo) {
    case 'ram':
      return nivel >= 2
        ? `hadouken: RAM do PC em ${valor}%. Até baixar: testes com concorrência 1, sem subagentes em paralelo, sem build em watch; prefira ler trechos a arquivos inteiros.`
        : `hadouken: RAM do PC em ${valor}%. Prefira testes e subagentes em série enquanto durar.`;
    case 'gpu':
    case 'cpu':
      return `hadouken: ${tipo.toUpperCase()} a ${valor} °C. Evite tarefas pesadas em paralelo (builds, testes e subagentes ao mesmo tempo); faça em série.`;
    case 'disco':
      return `hadouken: disco com ${gbInteiro(valor)} GB livres. Evite gerar arquivos grandes (builds, caches, logs) até liberar espaço.`;
    case 'bateria':
      return `hadouken: bateria em ${valor}%, fora da tomada. Evite tarefas pesadas e longas até ligar o carregador.`;
    default:
      return null;
  }
}

export function resumoUsuario(tipo, valor) {
  switch (tipo) {
    case 'ram': return `RAM do PC em ${valor}%`;
    case 'gpu':
    case 'cpu': return `${tipo.toUpperCase()} a ${valor} °C`;
    case 'disco': return `disco com ${gbInteiro(valor)} GB livres`;
    case 'bateria': return `bateria em ${valor}%, fora da tomada`;
    default: return null;
  }
}

// O resumo e, na RAM vermelha, os aplicativos que mais liberam, até caber.
export function avisoUsuario(resumo, sugestoes = []) {
  const fim = `. ${ACAO}`;
  let texto = `hadouken: ${resumo}`;
  let lista = '';
  for (const s of sugestoes) {
    const item = `${s.nome} ${gbDecimal(s.rssBytes)} GB`;
    const nova = lista === '' ? `; dá para fechar: ${item}` : `${lista}, ${item}`;
    if ((texto + nova + fim).length > USUARIO_MAX) break;
    lista = nova;
  }
  texto = texto + lista + fim;
  return texto.length <= USUARIO_MAX ? texto : texto.slice(0, USUARIO_MAX);
}

export const linhaModoLeve = (ateMs) =>
  `hadouken: modo leve até ${hhmm(ateMs)}. Um subagente por vez, effort mínimo necessário, Haiku/Sonnet para busca, sem Fable nem Workflow sem pedido explícito, testes com concorrência 1.`;
export const LINHA_MODO_NORMAL = 'hadouken: modo leve encerrado; ritmo normal de trabalho.';

// Spec §6.F: o aviso único ao usuário quando o teto desliga uma parte.
export const ROTULO_PARTE = Object.freeze({
  aprendizado: 'o aprendizado', versao: 'a conferência de versões e conflitos', painel: 'a instalação do painel', previsao: 'a previsão de estouro',
  coletor: 'o disparo do coletor de saúde', 'roteamento-otimizacoes': 'as sugestões do roteamento', economia: 'o resumo semanal de economia',
});
// "fica fora": a frase não depende do gênero do rótulo.
export const linhaTetoDesligado = (nome) => (ROTULO_PARTE[nome]
  ? `hadouken: lentidão nos hooks; ${ROTULO_PARTE[nome]} fica fora por 24 h, para não atrasar seus prompts. /hadouken:saude mostra os detalhes.`
  : null);
