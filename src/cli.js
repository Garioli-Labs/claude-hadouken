import { rodarCli } from './comandos.js';

// CLI do plugin: `consumo [--json]` e `instalar [--aplicar] [--substituir]
// [--remover]`. O shim estável <dirDados>/bin/cli.mjs importa este arquivo,
// então ele roda ao ser carregado; a lógica mora em comandos.js, testada em
// processo. rodarCli escreve, espera a escrita e chama process.exit.
await rodarCli(process.argv.slice(2));
