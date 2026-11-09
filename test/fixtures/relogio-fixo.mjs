// Pré-carga (node --import) dos testes da janela de trabalho: congela o
// relógio do hook em HADOUKEN_TESTE_AGORA_MS (Date.now e new Date() sem
// argumento). Os hooks calculam tudo a partir de Date.now(); sem isto, um
// teste de "sexta 20:00" só passaria numa sexta às 20:00.
const FIXO = Number(process.env.HADOUKEN_TESTE_AGORA_MS);
const Real = Date;
if (Number.isFinite(FIXO)) {
  class DataFixa extends Real {
    constructor(...args) {
      if (args.length === 0) super(FIXO);
      else super(...args);
    }

    static now() { return FIXO; }
  }
  globalThis.Date = DataFixa;
}
