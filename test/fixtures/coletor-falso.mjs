// Processo falso no lugar do otelcol-contrib (spec aprendizado §8
// "Coletor"). Escreve no stderr, que o hadouken manda para otel/coletor.log,
// quantas variáveis OTEL_* chegaram, se SEGREDO_TESTE chegou e a mensagem do
// primeiro argumento; fica vivo pelo tempo do segundo (ms).
const [msg = '', ms = '3000'] = process.argv.slice(2);
const otel = Object.keys(process.env).filter((k) => k.startsWith('OTEL_')).length;
const segredo = process.env.SEGREDO_TESTE === undefined ? 'nao' : 'sim';
process.stderr.write(`falso otel:${otel} segredo:${segredo} ${msg}\n`);
setTimeout(() => process.exit(0), Number(ms));
