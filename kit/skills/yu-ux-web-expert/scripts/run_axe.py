#!/usr/bin/env python3
"""
run_axe.py — injeta axe-core na pagina e roda a analise de acessibilidade.

Roda em CADA viewport: problemas de reflow, alvo de toque e conteudo escondido
so aparecem em 360. Rodar so no desktop perde metade dos achados do publico
brasileiro, que e majoritariamente mobile.

Saida: axe.json (e stdout) com violations contendo id, impact, criterio WCAG,
selector CSS, html do no e failureSummary — os cinco dados que um achado do
relatorio precisa citar.

Lembrete de honestidade que o relatorio deve carregar: ferramenta automatizada
detecta cerca de 57% dos problemas de acessibilidade por volume de ocorrencias
(Deque, ~13.000 paginas). O resto exige teste manual.

Exemplos:
  python3 scripts/run_axe.py --url https://exemplo.com.br --out ./ux-audit
  python3 scripts/run_axe.py --path ./index.html --viewports 360x800
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    add_target_args, ensure_out, goto_settled, header, import_playwright,
    new_page, parse_viewports, posix, run_safe,
)

TOOL = "run_axe"

# Conjuntos de regras: WCAG 2.0/2.1/2.2 niveis A e AA + best-practice.
# AAA fica de fora porque a skill audita contra AA (o patamar exigivel) e
# incluir AAA inflaria o relatorio com achados que ninguem vai corrigir.
DEFAULT_TAGS = "wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice"

# Truncagem do HTML do no: 300 chars identificam o elemento sem transformar
# o JSON em copia da pagina.
HTML_SNIPPET_CHARS = 300


def find_axe() -> str | None:
    """Localiza axe.min.js: vendor/ da skill primeiro, depois node_modules
    proximos, depois o global do npm."""
    here = pathlib.Path(__file__).resolve().parent
    candidates = [
        here.parent / "vendor" / "node_modules" / "axe-core" / "axe.min.js",
        here.parent / "node_modules" / "axe-core" / "axe.min.js",
        here / "node_modules" / "axe-core" / "axe.min.js",
    ]
    for c in candidates:
        if c.exists():
            return posix(c)
    for base in [pathlib.Path.cwd()] + list(pathlib.Path.cwd().parents)[:4]:
        c = base / "node_modules" / "axe-core" / "axe.min.js"
        if c.exists():
            return posix(c)
    try:
        import shutil
        import subprocess
        # No Windows o npm e um .cmd: CreateProcess nao resolve "npm" sozinho
        # (FileNotFoundError silencioso) e um .cmd precisa do cmd /c. Sem isto
        # um axe-core instalado globalmente nunca era encontrado no Windows.
        npm = shutil.which("npm")
        if not npm:
            return None
        cmd = ["cmd", "/c", npm, "root", "-g"] if os.name == "nt" else [npm, "root", "-g"]
        root = subprocess.run(cmd, capture_output=True,
                              text=True, timeout=20).stdout.strip()
        if root:
            c = pathlib.Path(root) / "axe-core" / "axe.min.js"
            if c.exists():
                return posix(c)
    except Exception:
        pass
    return None


def wcag_criteria(tags):
    """Extrai os criterios WCAG dos tags do axe ('wcag143' -> '1.4.3')."""
    crits, levels = [], []
    for t in tags or []:
        if t.startswith("wcag") and t[4:].isdigit() and len(t) >= 7:
            d = t[4:]
            crits.append("%s.%s.%s" % (d[0], d[1], d[2:]))
        elif t in ("wcag2a", "wcag21a", "wcag22a"):
            levels.append("A")
        elif t in ("wcag2aa", "wcag21aa", "wcag22aa"):
            levels.append("AA")
        elif t in ("wcag2aaa", "wcag21aaa", "wcag22aaa"):
            levels.append("AAA")
    return sorted(set(crits)), sorted(set(levels))


def shrink(nodes):
    """Reduz os nodes do axe ao que o relatorio precisa citar."""
    out = []
    for n in nodes or []:
        out.append({
            "selector": (n.get("target") or [None])[0],
            "all_targets": n.get("target"),
            "html": (n.get("html") or "")[:HTML_SNIPPET_CHARS],
            "failureSummary": n.get("failureSummary"),
            "impact": n.get("impact"),
        })
    return out


def run_viewport(browser, url, w, h, axe_path, tags, timeout_ms):
    vp = "%dx%d" % (w, h)
    res = {"viewport": vp, "violations": [], "counts": {}, "incomplete": [],
           "passes_count": None, "inapplicable_count": None,
           "warnings": [], "error": None}
    ctx = page = None
    try:
        ctx, page = new_page(browser, w, h)
        # networkidle antes de injetar: axe analisa o DOM que existe no
        # momento da chamada; DOM meio-hidratado gera falso positivo.
        res["warnings"] += goto_settled(page, url, timeout_ms)
        page.add_script_tag(path=axe_path)
        raw = page.evaluate(
            """async (tags) => {
                const opts = { runOnly: { type: 'tag', values: tags },
                               resultTypes: ['violations', 'incomplete'] };
                const r = await axe.run(document, opts);
                return {
                  violations: r.violations, incomplete: r.incomplete,
                  passes: r.passes.length, inapplicable: r.inapplicable.length,
                  engine: r.testEngine
                };
            }""", tags)
        counts = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0, "sem_impacto": 0}
        for v in raw.get("violations", []):
            crits, levels = wcag_criteria(v.get("tags"))
            counts[v.get("impact") or "sem_impacto"] = counts.get(v.get("impact") or "sem_impacto", 0) + 1
            res["violations"].append({
                "id": v.get("id"),
                "impact": v.get("impact"),
                "wcag_criteria": crits,
                "wcag_levels": levels,
                "tags": v.get("tags"),
                "description": v.get("description"),
                "help": v.get("help"),
                "helpUrl": v.get("helpUrl"),
                "nodes_count": len(v.get("nodes") or []),
                "nodes": shrink(v.get("nodes")),
            })
        for i in raw.get("incomplete", []):
            crits, _ = wcag_criteria(i.get("tags"))
            res["incomplete"].append({
                "id": i.get("id"), "impact": i.get("impact"),
                "wcag_criteria": crits, "help": i.get("help"),
                "nodes_count": len(i.get("nodes") or []),
                "nodes": shrink(i.get("nodes"))[:5],  # 5 amostras bastam para o humano decidir
                "note": "'incomplete' = axe nao conseguiu decidir sozinho; exige verificacao manual.",
            })
        res["counts"] = counts
        res["passes_count"] = raw.get("passes")
        res["inapplicable_count"] = raw.get("inapplicable")
        res["engine"] = raw.get("engine")
    except Exception as exc:
        res["error"] = "%s: %s" % (type(exc).__name__, exc)
    finally:
        for obj in (page, ctx):
            try:
                if obj:
                    obj.close()
            except Exception:
                pass
    return res


def main(args):
    if args.url:
        url, label = args.url, args.url
    elif args.path:
        p = pathlib.Path(args.path).expanduser().resolve()
        if not p.exists():
            pay = header(TOOL, posix(p)); pay["error"] = "arquivo nao encontrado"; pay["results"] = []
            return pay
        url, label = p.as_uri(), posix(p)
    else:
        pay = header(TOOL, None); pay["error"] = "informe --url ou --path"; pay["results"] = []
        return pay

    ensure_out(args.out)
    viewports, bad = parse_viewports(args.viewports)
    tags = [t.strip() for t in (args.tags or DEFAULT_TAGS).split(",") if t.strip()]

    payload = header(TOOL, label, viewport=",".join("%dx%d" % v for v in viewports))
    payload["out_dir"] = posix(args.out)
    payload["ruleset_tags"] = tags
    payload["warnings"] = ["viewport ignorado: %s" % b for b in bad]
    payload["coverage_note"] = (
        "Analise automatizada detecta ~57% dos problemas de acessibilidade por volume "
        "de ocorrencias (Deque, ~13.000 paginas). O restante exige teste manual — "
        "ver assets/checklist-manual.md.")
    payload["results"] = []

    axe_path = find_axe()
    if not axe_path:
        payload["error"] = ("axe-core nao encontrado. Rode scripts/setup.sh "
                            "(instala axe-core em vendor/node_modules).")
        return payload
    payload["axe_path"] = axe_path

    sync_playwright, err = import_playwright()
    if err:
        payload["error"] = err
        return payload

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        except Exception as exc:
            payload["error"] = "nao foi possivel iniciar o Chromium (%s). Rode scripts/setup.sh." % exc
            return payload
        try:
            for (w, h) in viewports:
                payload["results"].append(
                    run_viewport(browser, url, w, h, axe_path, tags, args.timeout))
        finally:
            try:
                browser.close()
            except Exception:
                pass

    # Regras que aparecem em UM viewport so costumam ser reflow/alvo de toque —
    # destacar isso poupa o modelo de reler tudo.
    per_vp = {r["viewport"]: {v["id"] for v in r["violations"]} for r in payload["results"]}
    todos = set().union(*per_vp.values()) if per_vp else set()
    comuns = set.intersection(*per_vp.values()) if per_vp else set()
    # Regra que aparece em UM viewport so costuma ser reflow, alvo de toque ou
    # conteudo escondido no breakpoint — destacar isso poupa o modelo de reler tudo.
    so_em_um = {}
    for vp, ids in per_vp.items():
        outros = set().union(*[s for k, s in per_vp.items() if k != vp]) if len(per_vp) > 1 else set()
        exclusivas = sorted(ids - outros)
        if exclusivas:
            so_em_um[vp] = exclusivas
    payload["summary"] = {
        "viewports": list(per_vp.keys()),
        "regras_violadas_unicas": sorted(todos),
        "violadas_em_todos_viewports": sorted(comuns),
        "violadas_em_apenas_um_viewport": so_em_um,
        "total_violations_por_viewport": {r["viewport"]: len(r["violations"]) for r in payload["results"]},
        "total_incomplete_por_viewport": {r["viewport"]: len(r["incomplete"]) for r in payload["results"]},
    }
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="run_axe.py",
        description="Roda axe-core em cada viewport e emite violations com selector, html, "
                    "criterio WCAG, impacto e failureSummary.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/run_axe.py --url https://exemplo.com.br --out ./ux-audit\n"
               "  python3 scripts/run_axe.py --path ./index.html --viewports 360x800\n")
    add_target_args(ap)
    ap.add_argument("--tags", default=DEFAULT_TAGS,
                    help="Tags de regra do axe, separadas por virgula (padrao: %s)." % DEFAULT_TAGS)
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "axe.json"))
