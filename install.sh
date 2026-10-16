#!/usr/bin/env bash
# Instalador de um comando do claude-hadouken, Mac e Linux (spec v0.5.2).
#   curl -fsSL https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.sh | bash
#   ... | bash -s -- --sim --sem-extras
# Passos 1 a 5: confere Node, git e claude; pergunta uma vez e instala o que
# falta; instala o plugin principal; chama o instalar-tudo.js do plugin. Só
# definições até a última linha: no `curl | bash`, nada roda antes de o bash
# ler o script inteiro. Perguntas pelo /dev/tty; sem tty, "não". Sem sudo.

NODE_MIN=20.0.0
CLAUDE_MIN=2.1.251
ID=claude-hadouken@claude-hadouken

aviso() {
  printf 'claude-hadouken: %s\n' "$1" >&2
}

# pergunta "texto" s|n -> 0 sim, 1 não. --sim responde sim; sem tty, não.
pergunta() {
  local r=""
  if [ "$SIM" = 1 ]; then return 0; fi
  if ! ( : </dev/tty ) 2>/dev/null; then return 1; fi
  printf '%s' "$1" >/dev/tty
  IFS= read -r r </dev/tty || r=""
  r=$(printf '%s' "$r" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  case "$r" in
    s|sim|y|yes) return 0 ;;
    "") [ "$2" = s ] ;;
    *) return 1 ;;
  esac
}

# x.y.z da primeira linha de "<cmd> --version"; vazio se não houver.
versao_de() {
  command -v "$1" >/dev/null 2>&1 || return 0
  "$1" --version 2>/dev/null | head -n 1 | sed -n -E 's/^[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p'
}

# ver_ge A B: A >= B (x.y.z decimais).
ver_ge() {
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  [ $((10#$a1)) -ne $((10#$b1)) ] && { [ $((10#$a1)) -gt $((10#$b1)) ]; return; }
  [ $((10#$a2)) -ne $((10#$b2)) ] && { [ $((10#$a2)) -gt $((10#$b2)) ]; return; }
  [ $((10#$a3)) -ge $((10#$b3)) ]
}

node_ok() {
  local v
  v=$(versao_de node)
  [ -n "$v" ] && ver_ge "$v" "$NODE_MIN"
}

claude_estado() {
  local v
  v=$(versao_de claude)
  if [ -z "$v" ]; then echo instalar; elif ver_ge "$v" "$CLAUDE_MIN"; then echo ok; else echo atualizar; fi
}

# brew no PATH ou nos dois lugares de sempre (Apple Silicon e Intel).
achar_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  local b
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then
      eval "$("$b" shellenv)"
      return 0
    fi
  done
  return 1
}

# installPath do plugin principal (escopo user) em `claude plugin list --json`.
pasta_plugin() {
  "$CLAUDE" plugin list --json 2>/dev/null | node -e '
    let t = "";
    process.stdin.on("data", (d) => { t += d; }).on("end", () => {
      try {
        const p = JSON.parse(t).find((x) => x && x.id === process.argv[1] && (x.scope === undefined || x.scope === "user"));
        if (p && typeof p.installPath === "string") process.stdout.write(p.installPath);
      } catch {}
    });' "$ID"
}

main() {
  set -u
  SIM=0
  local sem_extras=0 a
  REPASSE=()
  for a in "$@"; do
    case "$a" in
      --sim) SIM=1; REPASSE+=("$a") ;;
      --sem-extras) sem_extras=1; REPASSE+=("$a") ;;
      --substituir-barra|--com-aprendizado) REPASSE+=("$a") ;;
      *) aviso "opção desconhecida; as opções são --sim, --sem-extras, --com-aprendizado e --substituir-barra"; return 2 ;;
    esac
  done

  local so tem_brew=0
  so=$(uname -s)
  if [ "$so" = Darwin ] && achar_brew; then tem_brew=1; fi
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) PATH="$PATH:$HOME/.local/bin"; export PATH ;;
  esac

  # 1. Confere o PC.
  local falta_node=0 falta_git=0 claude_acao
  node_ok || falta_node=1
  git --version >/dev/null 2>&1 || falta_git=1
  claude_acao=$(claude_estado)

  # 2 e 3. Pergunta uma vez e instala o que falta.
  if [ "$falta_node$falta_git" != 00 ] || [ "$claude_acao" != ok ]; then
    echo "Falta para o claude-hadouken:"
    [ "$falta_node" = 1 ] && echo "  - Node 20 ou mais novo"
    [ "$falta_git" = 1 ] && echo "  - git"
    [ "$claude_acao" = instalar ] && echo "  - Claude Code"
    [ "$claude_acao" = atualizar ] && echo "  - Claude Code $CLAUDE_MIN ou mais novo (claude update)"
    if [ "$falta_node$falta_git" != 00 ] && [ "$tem_brew" = 0 ]; then
      aviso "instale o Node 20+ (https://nodejs.org/) e o git pelo gerenciador do seu sistema e rode o comando de novo"
      return 1
    fi
    if ! pergunta "Instalar agora? [s/N] " n; then
      aviso "nada instalado. Node: https://nodejs.org/ ; Claude Code: curl -fsSL https://claude.ai/install.sh | bash"
      return 1
    fi
    if [ "$falta_node" = 1 ]; then
      brew install node || { aviso "brew install node falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    if [ "$falta_git" = 1 ]; then
      brew install git || { aviso "brew install git falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    if [ "$claude_acao" = instalar ]; then
      curl -fsSL https://claude.ai/install.sh | bash || { aviso "o instalador do Claude Code falhou; rode curl -fsSL https://claude.ai/install.sh | bash"; return 1; }
    elif [ "$claude_acao" = atualizar ]; then
      claude update || { aviso "claude update falhou; rode-o e depois o comando de novo"; return 1; }
    fi
    hash -r
    node_ok || { aviso "o Node 20+ não ficou disponível; abra um terminal novo e rode o comando de novo"; return 1; }
    [ "$(claude_estado)" = ok ] || { aviso "o Claude Code $CLAUDE_MIN+ não ficou disponível; abra um terminal novo e rode o comando de novo"; return 1; }
  fi

  # Extras de pacote (Python e gh); o pip e o setup.sh ficam no instalar-tudo.
  if [ "$sem_extras" = 0 ]; then
    echo "Extras: Python 3 (~100 MiB), graphify (pip), Playwright com Chromium, axe-core e lighthouse da yu-ux (~150 MiB) e o gh."
    if pergunta "Instalar também os extras? [S/n] " s; then
      local pacotes=""
      python3 --version >/dev/null 2>&1 || pacotes="python"
      command -v gh >/dev/null 2>&1 || pacotes="$pacotes gh"
      if [ -n "$pacotes" ]; then
        if [ "$tem_brew" = 1 ]; then
          # shellcheck disable=SC2086
          brew install $pacotes || aviso "brew install$pacotes falhou; os outros extras seguem"
        else
          echo "Para os extras, instale pelo gerenciador do seu sistema:$pacotes (python3 com pip)."
        fi
      fi
    else
      REPASSE+=(--sem-extras)
    fi
  fi

  # 4. O plugin principal.
  CLAUDE=$(command -v claude) || { aviso "claude não encontrado no PATH"; return 1; }
  "$CLAUDE" plugin marketplace add Garioli-Labs/claude-hadouken >/dev/null 2>&1 || true
  "$CLAUDE" plugin marketplace update claude-hadouken >/dev/null 2>&1 || true
  local raiz
  raiz=$(pasta_plugin)
  if [ -n "$raiz" ]; then "$CLAUDE" plugin update "$ID" || true; else "$CLAUDE" plugin install "$ID" || true; fi

  # 5. A pasta do plugin e o resto em Node.
  raiz=$(pasta_plugin)
  if [ -z "$raiz" ] || [ ! -f "$raiz/src/instalar-tudo.js" ]; then
    aviso "o plugin não instalou; rode claude plugin install $ID"
    return 1
  fi
  local py="" codigo
  if python3 --version >/dev/null 2>&1; then py=$(command -v python3); fi
  HADOUKEN_CLAUDE="$CLAUDE" HADOUKEN_PYTHON="$py" node "$raiz/src/instalar-tudo.js" ${REPASSE[@]+"${REPASSE[@]}"}
  codigo=$?
  if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
    echo "Próximo passo, para a seção do GitHub no relatório: gh auth login"
  fi
  echo "Os limites de 5 h e 7 dias aparecem nos planos Pro e Max."
  return "$codigo"
}

main "$@"
