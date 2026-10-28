#!/usr/bin/env bash
# Publica wiki/*.md na wiki do GitHub. Roda à mão, por quem mantém o repo,
# depois do merge e da tag: pede a palavra "publicar" digitada, clona o
# .wiki.git numa pasta temporária, copia as páginas, faz o commit e o push.
# pares.json fica de fora: ele só serve aos testes.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
# Caminho relativo: no Git Bash o pwd dá /c/..., que o node do Windows não acha.
versao="$(cd "$raiz" && node -p "require('./package.json').version")"
url="${HADOUKEN_WIKI_URL:-https://github.com/Garioli-Labs/claude-hadouken.wiki.git}"

echo "Vai publicar ${raiz}/wiki/*.md em ${url} (v${versao})."
read -r -p 'Digite publicar para seguir: ' resposta
if [ "$resposta" != "publicar" ]; then
  echo 'Nada publicado.'
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 "$url" "$tmp/wiki"
cp "$raiz"/wiki/*.md "$tmp/wiki/"
cd "$tmp/wiki"
git add -A
if git diff --cached --quiet; then
  echo 'A wiki já está igual. Nada publicado.'
  exit 0
fi
# O clone temporário não herda o autor do repo; sem config global, o commit falharia.
git -c user.name="$(git -C "$raiz" config user.name)" -c user.email="$(git -C "$raiz" config user.email)" \
  commit -m "docs: wiki da v${versao}"
git push
echo "Wiki publicada (v${versao})."
