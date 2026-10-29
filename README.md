<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-escuro.svg">
    <img src="assets/logo-claro.svg" alt="hadouken" width="420">
  </picture>
</p>

# hadouken

[English](README.en.md) · **Português**

[![CI](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml/badge.svg)](https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/github/license/Garioli-Labs/claude-hadouken)](LICENSE)

> [!IMPORTANT]
> **Atualizou para a v0.5.2 e a barra sumiu, ou apareceu `claude-hadouken not found`?** O plugin mudou de nome, de `claude-hadouken` para `hadouken`. No terminal, rode `claude plugin install hadouken@claude-hadouken` e abra uma sessão nova, ou rode o comando de instalação abaixo de novo.

**Seu consumo do Claude Code na tela, com referência de ritmo, e o Claude sabendo disso também.**

- os limites da conta (**sessão de 5 horas**, **semana** e **semana do Fable**) num item da barra de status do VS Code, sem gastar tokens;
- **contexto** e **cache** de cada sessão na barra do Claude Code;
- avisos ao Claude quando o ritmo vai esgotar a janela, e uma **guarda** que segura o despacho caro até o senhor liberar;
- uma **janela no VS Code** com todas as configurações: tetos, faixas, alertas, roteamento, aprendizado e proteções;
- o relatório `/hadouken:consumo`, com tokens por projeto, por modelo·effort e o GitHub Actions;
- a **saúde do PC** (`/hadouken:saude`): RAM, temperaturas, bateria e disco, com aviso, sugestão do que fechar, sessões do Claude paradas há 30 min e um modo leve que orienta o Claude a pegar mais leve;
- o **plano da conta** (Pro, Max 5x ou Max 20x) nos relatórios, e `/hadouken:liberar noite` para deixar um trabalho rodando até as 7h.

## Instalar

No terminal, fora do Claude Code:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

No Windows, no PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Requisitos: **Node 20** ou mais novo e **Claude Code 2.1.251** ou mais novo. O instalador confere os dois, instala o plugin, a barra e o item do VS Code. Opções e o passo a passo manual estão na [wiki](https://github.com/Garioli-Labs/claude-hadouken/wiki/Home#um-comando).

## Atualizar

Quando sai uma versão nova, o VS Code avisa com o botão **Atualizar**. Sem o VS Code, rode o mesmo comando de instalação.

## Documentação

- [Barra de status](https://github.com/Garioli-Labs/claude-hadouken/wiki/Barra-de-status) · [Painel e janela do VS Code](https://github.com/Garioli-Labs/claude-hadouken/wiki/Painel-e-janela-do-VS-Code) · [Avisos e alertas](https://github.com/Garioli-Labs/claude-hadouken/wiki/Avisos-e-alertas)
- [Guarda de consumo e roteamento](https://github.com/Garioli-Labs/claude-hadouken/wiki/Guarda-de-consumo) · [Limites e proteções](https://github.com/Garioli-Labs/claude-hadouken/wiki/Limites) · [Comandos](https://github.com/Garioli-Labs/claude-hadouken/wiki/Comandos)
- [Relatório de consumo](https://github.com/Garioli-Labs/claude-hadouken/wiki/Relatorio-de-consumo) · [Aprendizado](https://github.com/Garioli-Labs/claude-hadouken/wiki/Aprendizado) · [Saúde do PC](https://github.com/Garioli-Labs/claude-hadouken/wiki/Saude-do-PC)
- [hadouken-kit](https://github.com/Garioli-Labs/claude-hadouken/wiki/Kit) · [REA](https://github.com/Garioli-Labs/claude-hadouken/wiki/REA) · [Problemas comuns](https://github.com/Garioli-Labs/claude-hadouken/wiki/Problemas-comuns)
- [Versões](https://github.com/Garioli-Labs/claude-hadouken/releases) · [Segurança](SECURITY.md)

## Licença

[MIT](LICENSE) © 2026 Lucas Garioli.
