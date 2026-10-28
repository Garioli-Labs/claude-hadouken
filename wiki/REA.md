# REA

[English](REA-en)

## hadouken-rea: engenharia reversa

O `hadouken-rea` é um plugin opcional do marketplace `claude-hadouken`. Ele liga o servidor MCP do pacote `rea-agents`, que dá ao Claude ferramentas de engenharia reversa para inspecionar binários e aplicativos.

- **Ligar:** o instalador de um comando o liga na primeira instalação, se o Node servir. À mão: `claude plugin install hadouken-rea@claude-hadouken` e `claude plugin enable hadouken-rea@claude-hadouken`. Desligado por você, continua desligado.
- **Requisitos:** Node 22.19+, 24.11+ ou 26+.
- **Primeira vez:** o `npx` baixa o pacote (uns 20 a 30 s) e o `/mcp` pode acusar tempo esgotado; reconecte pelo `/mcp` ou abra uma sessão nova.
- **Versão fixa:** o plugin abre uma versão exata do `rea-agents`; o robô semanal do kit a atualiza só com a suíte verde em Linux, Windows e macOS.
- **Isolamento:** o servidor roda com o cwd na pasta do plugin, nunca no projeto aberto, para um `node_modules` ou `.npmrc` do repositório não entrar. Passe caminhos absolutos ao REA.

> [!WARNING]
> O REA **executa os programas analisados com as permissões do seu usuário**. Analise só o que o senhor rodaria na própria máquina, ou use uma máquina virtual.

Mais detalhes, junto com o hadouken-kit, em [hadouken-kit e hadouken-rea](Kit).

---
