#!/usr/bin/env bash
# Publica wiki/*.md na wiki do GitHub. Roda à mão, por quem mantém o repo,
# depois do merge e da tag: pede a palavra "publicar" digitada, clona o
# .wiki.git numa pasta temporária, copia as páginas, faz o commit e o push.
# pares.json fica de fora: ele só serve aos testes.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
versao="$(node -p "require('$raiz/package.json').version")"
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
git commit -m "docs: wiki da v${versao}"
git push
echo "Wiki publicada (v${versao})."
