// As faixas da saúde, o segmento da barra e o atalho dos hooks (spec v0.5.5
// §6.B e §6.C). Folha sem import nenhum: a statusline a carrega a cada
// redesenho (saude/barra.js) e os hooks a cada prompt (hook.js), então o que
// é comum e barato mora aqui e avisos.js, mensagens.js e processos.js só
// carregam quando há o que dizer. Cada medida é conferida aqui mesmo (número
// finito e na faixa física), então serve também a leitura crua de saude.json.

export const TIPOS = Object.freeze(['ram', 'gpu', 'cpu', 'disco', 'bateria']);
const GB = 1024 ** 3;
const BARRA_MAX = 24;
const NOME_MAX = 60;
const SID = /^[A-Za-z0-9-]{1,16}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const entre = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
export const gbInteiro = (bytes) => Math.floor(bytes / GB);

// Controle C0/C1 e marcas de direção (bidi), que trocariam a ordem do texto
// mostrado ao usuário.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanearNome(nome) {
  if (typeof nome !== 'string') return '';
  return nome.replace(CONTROLE, '').trim().slice(0, NOME_MAX);
}

// A chave da sessão nos registros: 16 caracteres seguros, ou 'sem-sessao'.
export function sid(sessao) {
  const s = typeof sessao === 'string' ? sessao.slice(0, 16) : '';
  return SID.test(s) ? s : 'sem-sessao';
}
export const sidValido = (s) => typeof s === 'string' && SID.test(s);

// { tipo: { nivel, valor } } das medidas na faixa agora; nivel 2 = vermelho,
// 1 = amarelo (só a RAM tem).
export function medidasNaFaixa(l, c) {
  const fora = {};
  if (!ehObjeto(l) || !ehObjeto(c)) return fora;
  const ram = l.ram?.usadaPct;
  if (entre(ram, 0, 100) && ram >= c.ram?.vermelho) fora.ram = { nivel: 2, valor: ram };
  else if (entre(ram, 0, 100) && ram >= c.ram?.amarelo) fora.ram = { nivel: 1, valor: ram };
  const gpu = l.gpu?.tempC;
  if (entre(gpu, -50, 150) && gpu >= c.gpuMax) fora.gpu = { nivel: 2, valor: gpu };
  const cpu = l.cpu?.tempC;
  if (entre(cpu, -50, 150) && cpu >= c.cpuMax) fora.cpu = { nivel: 2, valor: cpu };
  const livres = [l.disco?.dadosLivreBytes, l.disco?.projetoLivreBytes].filter((b) => entre(b, 0, Number.MAX_SAFE_INTEGER));
  if (livres.length > 0 && Math.min(...livres) < c.discoMinGB * GB) fora.disco = { nivel: 2, valor: Math.min(...livres) };
  const b = l.bateria;
  if (ehObjeto(b) && b.naTomada === false && entre(b.pct, 0, 100) && b.pct <= c.bateriaMin) fora.bateria = { nivel: 2, valor: b.pct };
  return fora;
}

// Vermelho antes de amarelo; no mesmo nível, a ordem de TIPOS.
export const porGravidade = (fora) => TIPOS.filter((t) => fora[t]).sort((a, b) => fora[b].nivel - fora[a].nivel);

function barraTipo(tipo, valor) {
  switch (tipo) {
    case 'ram': return `PC: RAM ${valor}%`;
    case 'gpu':
    case 'cpu': return `PC: ${tipo.toUpperCase()} ${valor}°C`;
    case 'disco': return `PC: disco ${gbInteiro(valor)} GB`;
    case 'bateria': return `PC: bateria ${valor}%`;
    default: return null;
  }
}

// "PC: RAM 94%", "PC: GPU 89°C, leve", "leve" ou null. Vírgula, não '·': o
// ponto do meio é glifo da barra (util.GLIFOS_BARRA).
export function montarBarra(fora, leve) {
  const tipo = porGravidade(fora)[0];
  const partes = [];
  if (tipo !== undefined) partes.push(barraTipo(tipo, fora[tipo].valor));
  if (leve) partes.push('leve');
  const barra = partes.join(', ');
  return barra === '' ? null : barra.slice(0, BARRA_MAX);
}

// O atalho dos hooks: true quando decidirAvisos (avisos.js) não diria nada
// nem mudaria episódio algum, ou seja, nenhuma medida na faixa, nenhum
// episódio aberto no registro e o modo já anunciado a esta sessão como está.
// Na dúvida (registro estranho), false, e a decisão completa roda.
export function semNovidade({ leitura, config, registro, modo, sessao }) {
  if (!ehObjeto(config) || !config.ligado) return false;
  if (ehObjeto(leitura) && Object.keys(medidasNaFaixa(leitura, config)).length > 0) return false;
  if (registro !== undefined && !ehObjeto(registro)) return false;
  const r = registro ?? {};
  if (r.episodios !== undefined && !(ehObjeto(r.episodios) && Object.keys(r.episodios).length === 0)) return false;
  const leve = modo?.leve === true && Number.isFinite(modo.ateMs);
  const anunciado = ehObjeto(r.modoAnunciado) ? r.modoAnunciado[sid(sessao)] : undefined;
  return leve ? anunciado === 'leve' : anunciado !== 'leve';
}
