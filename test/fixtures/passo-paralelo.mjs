// Foco de revisão 3: dois processos rodam o passo ao mesmo tempo sobre a
// mesma pasta. Imprime o resultado de rodarPasso (com `lidos`, os registros
// novos que este processo contou).
import { rodarPasso } from '../../src/aprendizado/passo.js';

const [dir, agora] = process.argv.slice(2);
process.stdout.write(JSON.stringify(rodarPasso({ dir, agoraMs: Number(agora), inicio: false })));
