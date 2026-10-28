'use strict';

// Janela do hadouken (spec v0.5.3 VS Code §4). Tudo é montado com
// createElement e textContent: nada que vem do config.json, do painel ou do
// GitHub entra como HTML (§4.4). A validação de verdade é a do plugin
// (gravarConfiguracao); aqui a janela restringe pelo controle (min, max,
// switches), avisa no blur e explica por que o Salvar está desligado (§4.3).

(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const GRUPOS = [
    ['guarda', 'Guarda'], ['barra', 'Barra'], ['alertas', 'Alertas'],
    ['aprendizado', 'Aprendizado'], ['painel', 'Painel'], ['roteamento', 'Roteamento'],
  ];
  // [menor, maior, estrito], os mesmos pares de src/config/tabela.js.
  const PARES = [
    ['barra.ctx.amarelo', 'barra.ctx.vermelho', true],
    ['barra.cache.amarelo', 'barra.cache.verde', true],
    ['alertas.projecao5hMin.1', 'alertas.projecao5hMin.0', true],
    ['guarda.liberacao.padraoH', 'guarda.liberacao.maxH', false],
  ];
  const FEIXES = [['h5', 'Sessão (5h)'], ['d7', 'Semana (todos os modelos)'], ['fable', 'Semana (Fable)']];
  const DESFAZER_MS = 15000;
  const AVISO_FROUXO = 'Mais frouxo que o atual. Vale na hora e desfaz o aperto do aprendizado neste item.';

  const salvo = vscode.getState() || {};
  let rascunho = salvo.rascunho && typeof salvo.rascunho === 'object' ? salvo.rascunho : {};
  let aba = GRUPOS.some(([g]) => g === salvo.aba) ? salvo.aba : 'guarda';
  let estado = null;
  let config = null;
  let versaoMontada = null;
  let pctsAntes = {};
  let primeiroEstado = true;
  let gravando = false;
  let relogioDesfazer = null;
  const tocados = new Set();

  const guardar = () => vscode.setState({ rascunho, aba });
  const movimentoPermitido = () => !(estado && estado.movimentoReduzido) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function efeito(el, classe) {
    if (!el || !movimentoPermitido()) return;
    el.classList.remove(classe);
    void el.offsetWidth;
    el.classList.add(classe);
  }
  function criar(tag, atributos, texto) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(atributos || {})) el.setAttribute(k, v);
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  const itens = () => (config && Array.isArray(config.itens) ? config.itens : []);
  const item = (id) => itens().find((i) => i.id === id);

  // Valor em edição: o do rascunho, ou o gravado.
  function atual(i) {
    return Object.prototype.hasOwnProperty.call(rascunho, i.id) ? rascunho[i.id] : i.valor;
  }

  // Faixa do controle, com a coerência dos pares (o min do vermelho acompanha o amarelo).
  function faixa(i) {
    let min = i.min;
    let max = i.max;
    for (const [menor, maior, estrito] of PARES) {
      const d = estrito ? 1 : 0;
      if (i.id === maior) {
        const v = Number(atual(item(menor) || {}));
        if (Number.isInteger(v)) min = Math.max(min, v + d);
      }
      if (i.id === menor) {
        const v = Number(atual(item(maior) || {}));
        if (Number.isInteger(v)) max = Math.min(max, v - d);
      }
    }
    return [min, max];
  }

  function erroDe(i) {
    if (i.tipo !== 'inteiro') return null;
    const v = atual(i);
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    const [min, max] = faixa(i);
    if (String(v).trim() === '' || !Number.isInteger(n) || n < min || n > max) return `${i.rotulo} fora da faixa ${min}–${max}`;
    return null;
  }

  function frouxo(i) {
    const efetivo = i.aperto !== null && i.aperto !== undefined ? i.aperto : i.valor;
    const v = atual(i);
    if (i.frouxo === 'desligar') return efetivo === true && v === false;
    const n = Number(v);
    if (!Number.isInteger(n) || !Number.isInteger(efetivo)) return false;
    return (i.frouxo === 'maior' && n > efetivo) || (i.frouxo === 'menor' && n < efetivo);
  }

  // As mudanças de verdade: só o que difere do gravado, já em número.
  function mudancas() {
    const m = {};
    for (const i of itens()) {
      if (!Object.prototype.hasOwnProperty.call(rascunho, i.id) || i.id === 'aprendizado.ligado') continue;
      const v = i.tipo === 'inteiro' ? Number(rascunho[i.id]) : rascunho[i.id];
      if (v !== i.valor) m[i.id] = v;
    }
    return m;
  }

  function atualizarSalvar() {
    const botao = $('salvar');
    const motivo = $('motivo-salvar');
    const invalido = itens().map(erroDe).find((e) => e !== null);
    let texto = '';
    if (invalido) texto = invalido;
    else if (Object.keys(mudancas()).length === 0) texto = 'Nada mudou';
    botao.disabled = gravando || texto !== '';
    if (!gravando) motivo.textContent = texto;
  }

  function mostrarErro(i) {
    const campo = $(`campo-${i.id}`);
    const p = $(`erro-${i.id}`);
    if (!campo || !p) return;
    const e = tocados.has(i.id) ? erroDe(i) : null;
    p.textContent = e || '';
    p.hidden = !e;
    campo.setAttribute('aria-invalid', e ? 'true' : 'false');
  }

  function mostrarFrouxo(i) {
    const p = $(`frouxo-${i.id}`);
    if (!p) return;
    const sim = frouxo(i);
    p.textContent = sim ? AVISO_FROUXO : '';
    p.hidden = !sim;
  }

  function atualizarFaixas() {
    for (const i of itens()) {
      if (i.tipo !== 'inteiro') continue;
      const campo = $(`campo-${i.id}`);
      if (!campo) continue;
      const [min, max] = faixa(i);
      campo.min = String(min);
      campo.max = String(max);
    }
  }

  function campoInteiro(i) {
    const caixa = criar('div', { class: 'campo' });
    const id = `campo-${i.id}`;
    const unidade = i.unidade ? ` (${i.unidade})` : '';
    caixa.append(criar('label', { for: id }, `${i.rotulo}${unidade}`));
    const [min, max] = faixa(i);
    const campo = criar('input', {
      id, type: 'number', min: String(min), max: String(max), step: '1',
      inputmode: 'numeric', 'aria-describedby': `dica-${i.id} erro-${i.id} frouxo-${i.id}`, 'aria-invalid': 'false',
    });
    campo.value = String(atual(i));
    campo.addEventListener('input', () => {
      rascunho[i.id] = campo.value;
      guardar();
      atualizarFaixas();
      mostrarFrouxo(i);
      atualizarSalvar();
    });
    campo.addEventListener('blur', () => {
      tocados.add(i.id);
      mostrarErro(i);
      atualizarSalvar();
    });
    caixa.append(campo);
    caixa.append(criar('p', { id: `dica-${i.id}`, class: 'dica' }, `padrão ${i.padrao} · faixa ${i.min}–${i.max}`));
    const erro = criar('p', { id: `erro-${i.id}`, class: 'erro' });
    erro.hidden = true;
    caixa.append(erro);
    const aviso = criar('p', { id: `frouxo-${i.id}`, class: 'frouxo' });
    aviso.hidden = true;
    caixa.append(aviso);
    return caixa;
  }

  function campoSwitch(i, aoMudar) {
    const caixa = criar('div', { class: 'campo' });
    const ligado = atual(i) === true;
    const botao = criar('button', {
      type: 'button', role: 'switch', id: `campo-${i.id}`, 'aria-checked': String(ligado),
      'aria-describedby': `dica-${i.id} frouxo-${i.id}`,
    }, `${i.rotulo}: ${ligado ? 'ligado' : 'desligado'}`);
    botao.addEventListener('click', () => {
      const novo = botao.getAttribute('aria-checked') !== 'true';
      botao.setAttribute('aria-checked', String(novo));
      botao.textContent = `${i.rotulo}: ${novo ? 'ligado' : 'desligado'}`;
      aoMudar(novo);
    });
    caixa.append(botao);
    caixa.append(criar('p', { id: `dica-${i.id}`, class: 'dica' }, `padrão ${i.padrao ? 'ligado' : 'desligado'}`));
    const aviso = criar('p', { id: `frouxo-${i.id}`, class: 'frouxo' });
    aviso.hidden = true;
    caixa.append(aviso);
    return caixa;
  }

  function switchDeRascunho(i) {
    return campoSwitch(i, (novo) => {
      rascunho[i.id] = novo;
      guardar();
      mostrarFrouxo(i);
      atualizarSalvar();
    });
  }

  function painelAprendizado(painel) {
    const i = item('aprendizado.ligado');
    if (i) {
      // Ligar e desligar o aprendizado mexem no settings.json: vão na hora,
      // fora do Salvar.
      painel.append(campoSwitch(i, (novo) => vscode.postMessage({ tipo: novo ? 'ligarAprendizado' : 'desligarAprendizado' })));
    }
    painel.append(criar('h3', {}, 'Apertos atuais'));
    const apertados = itens().filter((x) => x.aperto !== null && x.aperto !== undefined);
    if (apertados.length === 0) {
      painel.append(criar('p', {}, 'Nenhum aperto do aprendizado agora.'));
      return;
    }
    const lista = criar('ul');
    for (const x of apertados) lista.append(criar('li', {}, `${x.rotulo}: ${x.aperto}${x.unidade ? ` ${x.unidade}` : ''}`));
    painel.append(lista);
  }

  function tabelaRoteamento(painel) {
    painel.append(criar('h3', {}, 'Últimos 7 dias'));
    const r = estado && estado.roteamento;
    const linhas = r && Array.isArray(r.porAgente) ? r.porAgente : [];
    if (linhas.length === 0) {
      painel.append(criar('p', {}, 'Sem dados de roteamento ainda.'));
      return;
    }
    const tabela = criar('table');
    const cab = criar('tr');
    for (const t of ['Agente', 'Despachos', 'Negados', 'Retrabalho']) cab.append(criar('th', { scope: 'col' }, t));
    tabela.append(cab);
    for (const l of linhas.slice(0, 30)) {
      const tr = criar('tr');
      for (const v of [l.agente, l.despachos, l.negados, l.retrabalhos]) tr.append(criar('td', {}, String(v)));
      tabela.append(tr);
    }
    painel.append(tabela);
  }

  function selecionarAba(nova, focar) {
    aba = nova;
    guardar();
    for (const b of document.querySelectorAll('[role=tab]')) {
      const sim = b.dataset.grupo === nova;
      b.setAttribute('aria-selected', String(sim));
      b.tabIndex = sim ? 0 : -1;
      if (sim && focar) b.focus();
    }
    for (const p of document.querySelectorAll('[role=tabpanel]')) p.hidden = p.dataset.grupo !== nova;
  }

  function montarConfig() {
    const abas = $('abas');
    const paineis = $('paineis');
    abas.replaceChildren();
    paineis.replaceChildren();
    for (const [grupo, nome] of GRUPOS) {
      const botao = criar('button', {
        type: 'button', role: 'tab', id: `aba-${grupo}`, 'aria-controls': `painel-${grupo}`,
        'aria-selected': 'false', tabindex: '-1', 'data-grupo': grupo,
      }, nome);
      botao.addEventListener('click', () => selecionarAba(grupo, false));
      abas.append(botao);
      const painel = criar('div', { role: 'tabpanel', id: `painel-${grupo}`, 'aria-labelledby': `aba-${grupo}`, 'data-grupo': grupo, tabindex: '0' });
      if (grupo === 'aprendizado') painelAprendizado(painel);
      else {
        for (const i of itens().filter((x) => x.grupo === grupo)) painel.append(i.tipo === 'inteiro' ? campoInteiro(i) : switchDeRascunho(i));
        if (grupo === 'roteamento') tabelaRoteamento(painel);
      }
      paineis.append(painel);
    }
    selecionarAba(aba, false);
    for (const i of itens()) {
      mostrarErro(i);
      mostrarFrouxo(i);
    }
    atualizarSalvar();
  }

  $('abas').addEventListener('keydown', (ev) => {
    const ordem = GRUPOS.map(([g]) => g);
    const k = ordem.indexOf(aba);
    let nova = null;
    if (ev.key === 'ArrowRight') nova = ordem[(k + 1) % ordem.length];
    else if (ev.key === 'ArrowLeft') nova = ordem[(k - 1 + ordem.length) % ordem.length];
    else if (ev.key === 'Home') nova = ordem[0];
    else if (ev.key === 'End') nova = ordem[ordem.length - 1];
    if (nova === null) return;
    ev.preventDefault();
    selecionarAba(nova, true);
  });

  // Detalhe de cada janela: o texto da dica do painel depois do rótulo.
  function detalhes(dica) {
    const d = {};
    for (const linha of String(dica || '').split('\n\n')) {
      const m = /^\*\*(.+?):\*\* (.*)$/.exec(linha);
      if (m) d[m[1]] = m[2];
    }
    return d;
  }

  function montarFeixes() {
    const caixa = $('feixes');
    caixa.replaceChildren();
    const p = estado.painel || {};
    const pcts = p.pcts || {};
    const d = detalhes(p.dica);
    for (const [chave, rotulo] of FEIXES) {
      const pct = typeof pcts[chave] === 'number' ? pcts[chave] : null;
      const urgencia = pct === null ? 'calma' : pct >= 90 ? 'urgente' : pct >= 75 ? 'atencao' : 'calma';
      const feixe = criar('div', { class: 'feixe', 'data-urgencia': urgencia });
      const cab = criar('div', { class: 'feixe-rotulo' });
      cab.append(criar('span', {}, rotulo), criar('span', { class: 'numero-grande' }, pct === null ? '—' : `${pct}%`));
      const trilho = criar('div', {
        class: 'feixe-trilho', role: 'meter', 'aria-label': rotulo,
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct === null ? 0 : Math.min(100, pct)),
      });
      const cheio = criar('div', { class: 'feixe-cheio' });
      cheio.style.width = `${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%`;
      trilho.append(cheio);
      feixe.append(cab, trilho, criar('p', { class: 'feixe-detalhe' }, d[rotulo] || 'sem leitura'));
      caixa.append(feixe);
      if (!primeiroEstado && pctsAntes[chave] !== pct) efeito(cheio, 'acende');
      pctsAntes[chave] = pct;
    }
  }

  function receberEstado(m) {
    estado = m;
    $('versao').textContent = typeof m.versaoInstalada === 'string' ? m.versaoInstalada : '';
    const faixaVersao = $('faixa-versao');
    faixaVersao.hidden = typeof m.versaoNova !== 'string';
    $('texto-versao').textContent = typeof m.versaoNova === 'string' ? `hadouken ${m.versaoNova} disponível` : '';
    montarFeixes();
    if (m.config && Array.isArray(m.config.itens)) {
      const versaoAntes = versaoMontada;
      config = m.config;
      // Só remonta quando o config.json mudou, para não roubar o foco de quem edita.
      if (versaoAntes !== config.versao || document.querySelector('[role=tab]') === null) {
        versaoMontada = config.versao;
        montarConfig();
      }
    }
    if (primeiroEstado) {
      primeiroEstado = false;
      efeito(document.querySelector('.bola'), 'disparo');
    }
  }

  function mostrarDesfazer(ate) {
    const barra = $('desfazer-barra');
    barra.hidden = false;
    clearTimeout(relogioDesfazer);
    const ms = typeof ate === 'number' ? Math.max(0, Math.min(DESFAZER_MS, ate - Date.now())) : DESFAZER_MS;
    relogioDesfazer = setTimeout(() => { barra.hidden = true; }, ms || DESFAZER_MS);
  }

  function fimDaGravacao() {
    gravando = false;
    $('salvar').classList.remove('carregando');
  }

  const MOTIVOS = {
    mudou: 'A configuração mudou em outro lugar. Os valores novos foram carregados; seu rascunho ficou.',
    invalido: 'Algum valor não foi aceito.',
    erro: 'Não deu para salvar agora.',
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.tipo === 'estado') receberEstado(m);
    else if (m.tipo === 'salvo') {
      fimDaGravacao();
      rascunho = {};
      tocados.clear();
      guardar();
      versaoMontada = null;
      atualizarSalvar();
      mostrarDesfazer(m.desfazerAte);
      efeito(document.querySelector('.bola'), 'disparo');
    } else if (m.tipo === 'recusado') {
      fimDaGravacao();
      if (m.config && Array.isArray(m.config.itens)) {
        config = m.config;
        versaoMontada = config.versao;
        montarConfig();
      }
      atualizarSalvar();
      const erros = Array.isArray(m.erros) ? m.erros.map((e) => e && e.texto).filter((t) => typeof t === 'string') : [];
      $('motivo-salvar').textContent = erros.length > 0 ? erros.join(' · ') : MOTIVOS[m.motivo] || MOTIVOS.erro;
    }
  });

  $('salvar').addEventListener('click', () => {
    const m = mudancas();
    if (gravando || Object.keys(m).length === 0 || !config) return;
    gravando = true;
    $('salvar').classList.add('carregando');
    $('salvar').disabled = true;
    $('motivo-salvar').textContent = 'Salvando…';
    vscode.postMessage({ tipo: 'salvar', mudancas: m, versao: config.versao });
  });
  $('padrao').addEventListener('click', () => {
    if (!config || gravando) return;
    const ids = itens().filter((i) => i.grupo === aba && i.id !== 'aprendizado.ligado').map((i) => i.id);
    if (ids.length === 0) return;
    for (const id of ids) delete rascunho[id];
    guardar();
    vscode.postMessage({ tipo: 'voltarPadrao', ids, versao: config.versao });
  });
  $('desfazer').addEventListener('click', () => {
    $('desfazer-barra').hidden = true;
    vscode.postMessage({ tipo: 'desfazer' });
  });
  $('atualizar-uso').addEventListener('click', () => vscode.postMessage({ tipo: 'atualizarUso' }));
  $('atualizar-hadouken').addEventListener('click', () => vscode.postMessage({ tipo: 'atualizarHadouken' }));

  vscode.postMessage({ tipo: 'pronto' });
}());
