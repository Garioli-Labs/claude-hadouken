#!/usr/bin/env bash
# setup.sh — prepara as dependências dos scripts da skill yu-ux-web-expert.
#
# Idempotente: detecta o que já existe e não reinstala.
# Tolerante: NUNCA falha o processo inteiro por causa de um componente.
#   Sai sempre com 0 e imprime um resumo do que ficou disponível e do que faltou,
#   porque um setup que aborta no meio deixa a auditoria sem saber o que dá pra rodar.
#
# Uso:
#   bash scripts/setup.sh              # instala o que falta
#   bash scripts/setup.sh --check      # só verifica, não instala
#   bash scripts/setup.sh --force      # reinstala mesmo o que já existe
#
# Instala: Chromium do Playwright, axe-core (npm local), lighthouse (npm local).

set -u  # sem -e de propósito: cada etapa trata seu próprio erro
# sem pipefail: um `| head` fechando o pipe não pode derrubar o setup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DIR="${SKILL_DIR}/vendor"   # node_modules locais ficam aqui, fora do projeto do usuário

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --force) MODE="force" ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "aviso: argumento ignorado: $arg" ;;
  esac
done

OK_LIST=()
MISS_LIST=()

note_ok()   { OK_LIST+=("$1"); }
note_miss() { MISS_LIST+=("$1"); }

echo "== yu-ux-web-expert :: setup =="
echo "skill_dir: ${SKILL_DIR}"
echo "vendor_dir: ${VENDOR_DIR}"
echo "modo: ${MODE}"
echo

# ---------------------------------------------------------------- 1. Python
echo "-- [1/5] Python + playwright (pacote)"
PY_BIN=""
# No Windows "python" e "python3" costumam ser interpretadores DIFERENTES
# (instalador oficial vs. Microsoft Store). Prefira o que ja importa
# playwright; so depois caia para o primeiro que existir.
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import playwright" >/dev/null 2>&1; then
    PY_BIN="$cand"; break
  fi
done
if [ -z "$PY_BIN" ]; then
  for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then PY_BIN="$cand"; break; fi
  done
fi
if [ -z "$PY_BIN" ]; then
  echo "   FALTOU: nenhum interpretador python3 no PATH"
  note_miss "python3"
else
  echo "   ok: $("$PY_BIN" --version 2>&1)"
  note_ok "python3"
  if "$PY_BIN" -c "import playwright" >/dev/null 2>&1; then
    echo "   ok: pacote python 'playwright' ja importa"
    note_ok "playwright (python)"
  else
    if [ "$MODE" = "check" ]; then
      echo "   FALTOU: pacote python 'playwright' (rode sem --check para instalar)"
      note_miss "playwright (python)"
    else
      echo "   instalando pacote python 'playwright'..."
      if "$PY_BIN" -m pip install --quiet playwright >/dev/null 2>&1; then
        echo "   ok: playwright instalado"; note_ok "playwright (python)"
      else
        echo "   FALTOU: pip install playwright falhou (rede ou permissao)"
        note_miss "playwright (python)"
      fi
    fi
  fi
fi

# ------------------------------------------------------- 2. Chromium do PW
echo
echo "-- [2/5] Chromium do Playwright"
chromium_present() {
  [ -n "$PY_BIN" ] && "$PY_BIN" - <<'PYCHK' >/dev/null 2>&1
from playwright.sync_api import sync_playwright
import sys, os
with sync_playwright() as p:
    path = p.chromium.executable_path
    sys.exit(0 if path and os.path.exists(path) else 1)
PYCHK
}
if [ -z "$PY_BIN" ]; then
  echo "   pulado: sem python"
  note_miss "chromium (playwright)"
elif [ "$MODE" != "force" ] && chromium_present; then
  echo "   ok: binario do Chromium ja baixado"
  note_ok "chromium (playwright)"
elif [ "$MODE" = "check" ]; then
  echo "   FALTOU: Chromium nao baixado"
  note_miss "chromium (playwright)"
else
  echo "   baixando Chromium (pode levar alguns minutos)..."
  # --with-deps precisa de root; se falhar, tentamos sem as libs de sistema,
  # porque em container ja provisionado o binario sozinho costuma bastar.
  if "$PY_BIN" -m playwright install --with-deps chromium >/dev/null 2>&1 \
     || "$PY_BIN" -m playwright install chromium >/dev/null 2>&1; then
    if chromium_present; then
      echo "   ok: Chromium disponivel"; note_ok "chromium (playwright)"
    else
      echo "   FALTOU: install rodou mas o binario nao foi encontrado"
      note_miss "chromium (playwright)"
    fi
  else
    echo "   FALTOU: download do Chromium falhou (provavelmente sem rede)"
    note_miss "chromium (playwright)"
  fi
fi

# ------------------------------------------------------------------ 3. Node
echo
echo "-- [3/5] Node + npm"
HAS_NPM=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "   ok: node $(node -v), npm $(npm -v)"
  note_ok "node/npm"; HAS_NPM=1
else
  echo "   FALTOU: node e/ou npm nao encontrados no PATH"
  note_miss "node/npm"
fi

mkdir -p "${VENDOR_DIR}" 2>/dev/null
if [ "$HAS_NPM" = "1" ] && [ ! -f "${VENDOR_DIR}/package.json" ]; then
  # package.json mínimo e privado: evita que o npm suba a árvore procurando um
  # projeto do usuário e instale coisas no lugar errado.
  printf '{\n  "name": "yu-ux-web-expert-vendor",\n  "private": true,\n  "version": "1.0.0",\n  "description": "Dependencias locais da skill yu-ux-web-expert"\n}\n' > "${VENDOR_DIR}/package.json"
fi

# npm_have <nome-do-pacote> — presente em vendor/node_modules?
npm_have() { [ -d "${VENDOR_DIR}/node_modules/$1" ]; }

# npm_install_local <nome-do-pacote> <rotulo>
# Le a versao a partir de dentro de vendor/: um require() com caminho
# absoluto do Git Bash ("/c/Users/...") nao resolve no Node do Windows e
# imprimia "?" mesmo com o pacote instalado.
npm_pkg_version() {
  (cd "${VENDOR_DIR}" && node -p "try{require('./node_modules/$1/package.json').version}catch(e){'?'}" 2>/dev/null) || echo "?"
}

# npm_install_local <nome-do-pacote> <rotulo> [faixa-semver]
# A faixa fixa um PISO seguro: correcoes de bug entram, a proxima major nao.
# Sem isso, uma major nova do lighthouse muda flags do CLI e quebra o
# measure_cwv.py na maquina de quem recebeu a skill, sem aviso. O nome nu
# continua sendo usado para achar o diretorio em vendor/node_modules.
npm_install_local() {
  pkg="$1"; label="$2"; range="${3:-}"
  spec="$pkg"; [ -n "$range" ] && spec="${pkg}@${range}"
  if [ "$HAS_NPM" != "1" ]; then
    echo "   pulado: sem npm"; note_miss "$label"; return
  fi
  if [ "$MODE" != "force" ] && npm_have "$pkg"; then
    ver="$(npm_pkg_version "$pkg")"
    echo "   ok: ${pkg}@${ver} ja instalado em vendor/"
    note_ok "${label} (${ver})"
    return
  fi
  if [ "$MODE" = "check" ]; then
    echo "   FALTOU: ${pkg} nao instalado"; note_miss "$label"; return
  fi
  echo "   instalando ${spec} em vendor/ ..."
  # --no-audit --no-fund: reduz ruido e tempo; --prefix mantem tudo local.
  if (cd "${VENDOR_DIR}" && npm install --no-audit --no-fund --silent "$spec" >/dev/null 2>&1); then
    if npm_have "$pkg"; then
      ver="$(npm_pkg_version "$pkg")"
      echo "   ok: ${pkg}@${ver}"; note_ok "${label} (${ver})"
    else
      echo "   FALTOU: npm terminou mas ${pkg} nao apareceu"; note_miss "$label"
    fi
  else
    echo "   FALTOU: npm install ${spec} falhou (provavelmente sem rede)"
    note_miss "$label"
  fi
}

echo
echo "-- [4/5] axe-core (motor de acessibilidade)"
npm_install_local "axe-core" "axe-core" "^4.13"

echo
echo "-- [5/5] lighthouse (Core Web Vitals de laboratorio)"
npm_install_local "lighthouse" "lighthouse" "^13"

# ---------------------------------------------------------------- resumo
echo
echo "================ RESUMO ================"
if [ -n "$PY_BIN" ]; then
  # Grava o interpretador certo para os outros scripts e para o modelo:
  # no Windows, "python" e "python3" podem ser instalacoes diferentes e so
  # uma delas tem o playwright.
  printf '%s\n' "$PY_BIN" > "${SKILL_DIR}/scripts/.python_bin" 2>/dev/null || true
  echo "Interpretador com playwright: ${PY_BIN}   (use-o nos passos 3-9 e 14 do checklist)"
fi
echo "Disponivel:"
if [ ${#OK_LIST[@]} -eq 0 ]; then
  echo "  (nada)"
else
  for i in "${OK_LIST[@]}"; do echo "  + $i"; done
fi
echo "Faltou:"
if [ ${#MISS_LIST[@]} -eq 0 ]; then
  echo "  (nada)"
else
  for i in "${MISS_LIST[@]}"; do echo "  - $i"; done
fi
echo
echo "Impacto do que faltou:"
[ ${#MISS_LIST[@]} -eq 0 ] && echo "  nenhum — todos os scripts podem rodar."
for i in "${MISS_LIST[@]:-}"; do
  case "$i" in
    chromium*|playwright*|python3)
      echo "  * sem '$i': capture/run_axe/contrast_audit/check_states/keyboard_walk/extract_tokens (modo URL) nao rodam." ;;
    axe-core)
      echo "  * sem 'axe-core': run_axe.py cai para modo degradado e reporta 'error' no JSON." ;;
    lighthouse)
      echo "  * sem 'lighthouse': measure_cwv.py reporta 'error'; use PageSpeed Insights manualmente." ;;
    node/npm)
      echo "  * sem 'node/npm': run_axe.py e measure_cwv.py indisponiveis." ;;
  esac
done
echo "========================================"
# Sai 0 sempre: quem chama decide o que fazer com o que faltou.
exit 0
