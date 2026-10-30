<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/logo-escuro.svg"><img src="assets/logo-claro.svg" alt="Hadouken" width="420"></picture></p>

<h1 align="center">Hadouken</h1>

<p align="center"><b>O Claude Code no ritmo certo: o consumo na tela, o Claude sabendo dele e nada de gastar a cota à toa.</b></p>

<p align="center">
  <a href="https://github.com/Garioli-Labs/claude-hadouken/releases/latest"><img alt="Versão" src="https://img.shields.io/github/v/release/Garioli-Labs/claude-hadouken?label=vers%C3%A3o&color=e8590c"></a>
  <a href="https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Garioli-Labs/claude-hadouken/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licença: MIT" src="https://img.shields.io/github/license/Garioli-Labs/claude-hadouken"></a>
  <br>
  <a href="README.en.md">English</a> · <b>Português</b>
</p>

> [!IMPORTANT]
> **Depois de atualizar, feche as sessões abertas com `/exit` e volte com `claude -c`.** Desde a v0.5.7 o Hadouken mantém o plugin, a extensão do VS Code e os atalhos na mesma versão em qualquer PC; o `/hadouken:saude` mostra o que estiver fora (linha `Instal.`).

## Recursos

| | |
|---|---|
| 📊 **Limites na tela** | Sessão de 5 horas, semana e semana do Fable num item da barra do VS Code, com a logo animada, sem gastar tokens. |
| 🧠 **Contexto e cache** | Quanto do contexto cada sessão usa e quanto veio do cache, na barra do Claude Code. |
| 🛡️ **Guarda de consumo** | Avisa o Claude quando o ritmo vai esgotar a janela e segura o despacho caro até você liberar (`/hadouken:liberar`, inclusive `noite`). |
| 🧭 **Roteamento** | Sugere modelo, effort e quando lançar agente, para não queimar Fable ou effort alto à toa. |
| 📈 **Relatório** | `/hadouken:consumo`: tokens por projeto e por modelo·effort, plano da conta (Pro, Max 5x, Max 20x) e minutos do GitHub Actions. |
| 🖥️ **Saúde do PC** | `/hadouken:saude`: RAM, temperaturas, bateria, disco, sessões paradas, modo leve e a instalação conferida. |
| ⚙️ **Janela no VS Code** | Todas as configurações num clique na barra: tetos, faixas, alertas, roteamento e proteções. |
| 🧰 **Kit e REA** | `hadouken-kit`, as skills do dia a dia com o mapa de qual usar; `hadouken-rea`, engenharia reversa (desligado por padrão). |

## Instalar

No terminal, fora do Claude Code:

```bash
curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
```

No Windows, no PowerShell:

```powershell
irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
```

Requisitos: **Node 20** ou mais novo e **Claude Code 2.1.251** ou mais novo, em Windows, Linux ou macOS. O instalador confere os dois e instala o plugin, a barra e o item do VS Code. Detalhes na [wiki](https://github.com/Garioli-Labs/claude-hadouken/wiki/Home#um-comando).

## Atualizar

O VS Code avisa a versão nova com o botão **Atualizar**. Sem o VS Code, rode o mesmo comando de instalação.

## Documentação

[Barra de status](https://github.com/Garioli-Labs/claude-hadouken/wiki/Barra-de-status) · [Painel e janela do VS Code](https://github.com/Garioli-Labs/claude-hadouken/wiki/Painel-e-janela-do-VS-Code) · [Avisos e alertas](https://github.com/Garioli-Labs/claude-hadouken/wiki/Avisos-e-alertas) · [Guarda de consumo](https://github.com/Garioli-Labs/claude-hadouken/wiki/Guarda-de-consumo) · [Limites](https://github.com/Garioli-Labs/claude-hadouken/wiki/Limites) · [Comandos](https://github.com/Garioli-Labs/claude-hadouken/wiki/Comandos) · [Relatório de consumo](https://github.com/Garioli-Labs/claude-hadouken/wiki/Relatorio-de-consumo) · [Aprendizado](https://github.com/Garioli-Labs/claude-hadouken/wiki/Aprendizado) · [Saúde do PC](https://github.com/Garioli-Labs/claude-hadouken/wiki/Saude-do-PC) · [Kit](https://github.com/Garioli-Labs/claude-hadouken/wiki/Kit) · [REA](https://github.com/Garioli-Labs/claude-hadouken/wiki/REA) · [Problemas comuns](https://github.com/Garioli-Labs/claude-hadouken/wiki/Problemas-comuns) · [Versões](https://github.com/Garioli-Labs/claude-hadouken/releases) · [Segurança](SECURITY.md)

## Licença

[MIT](LICENSE) © 2026 Lucas Garioli.
