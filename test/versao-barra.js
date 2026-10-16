// v0.5.3: a barra termina com " │ hadouken N.N.N", a versão do plugin.json ao
// lado do script que a imprime. Os testes que comparam a barra de antes tiram
// esse fim com semVersao; formato.test.js e statusline.test.js conferem o fim.
const FIM = / │ hadouken \d{1,4}\.\d{1,4}\.\d{1,4}$/;
export function semVersao(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(FIM, '');
}
