#!/usr/bin/env python3
"""
check_states.py — varredura combinatoria de estados de componentes interativos.

Para cada elemento interativo, captura default, hover, focus-visible, active e
disabled, em prefers-color-scheme claro E escuro, e registra o que mudou
visualmente em cada transicao. E varredura combinatoria: o script faz bem, o
modelo faz mal e caro.

O que isso pega e o olho nao pega sozinho:
  - estado de foco que nao muda nada (WCAG 2.2 — 2.4.7 Focus Visible, nivel AA)
  - afordancia so no hover, invisivel para teclado e toque
  - estado disabled indistinguivel do habilitado (usuario clica e nada acontece)
  - estado que existe no tema claro e some no escuro

Os pseudo-estados sao forcados via CDP (CSS.forcePseudoState), que e a unica
forma confiavel de capturar :active e :focus-visible sem depender de timing de
mouse. Se o CDP falhar, o script cai para hover real do mouse e avisa.

Saida: states.json + PNG por elemento/estado/tema.

Exemplos:
  python3 scripts/check_states.py --path ./index.html --out ./ux-audit
  python3 scripts/check_states.py --url https://exemplo.com.br --selectors ".btn,.card a"
"""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    add_target_args, ensure_out, goto_settled, header, import_playwright,
    new_page, parse_viewports, posix, run_safe,
)

TOOL = "check_states"

# Seletores de "interativo" na ausencia de --selectors. Cobre o que recebe
# foco por padrao mais os falsos-botoes (div com onclick), que sao justamente
# os que costumam nao ter estado nenhum.
AUTO_SELECTOR = (
    "a[href], button, input:not([type=hidden]), select, textarea, summary, "
    "[role=button], [role=link], [role=tab], [role=menuitem], [role=switch], "
    "[tabindex]:not([tabindex='-1']), [onclick], [contenteditable='true']"
)

# Teto de elementos: 24 combinacoes ja geram 24*5*2 = 240 screenshots. Acima
# disso o custo de tempo supera o valor — o padrao de um design system aparece
# nos primeiros exemplares de cada tipo.
MAX_ELEMENTS = 24

# Propriedades que definem "este estado e visivelmente diferente".
# Sao as que carregam a afordancia; mudar so o cursor nao conta.
WATCHED_PROPS = [
    "backgroundColor", "color", "borderColor", "borderWidth", "borderStyle",
    "outlineColor", "outlineStyle", "outlineWidth", "outlineOffset",
    "boxShadow", "opacity", "textDecorationLine", "transform", "filter",
    "backgroundImage", "fontWeight", "cursor",
]

# Estados capturados, na ordem em que o usuario os encontra.
STATES = ["default", "hover", "focus-visible", "active", "disabled"]


COLLECT_TARGETS_JS = r"""
(params) => {
  const { selector, max } = params;
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = []; let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/)
        .filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(part); node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  };
  const els = Array.from(document.querySelectorAll(selector));
  const out = []; const seenSignature = new Set();
  for (const el of els) {
    if (out.length >= max) break;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Deduplica por "assinatura visual": 10 botoes iguais ensinam o mesmo
    // que 1. Guardamos um exemplar por combinacao tag+classe+tipo.
    const sig = el.tagName + '|' + (el.getAttribute('class') || '') + '|' +
                (el.getAttribute('type') || '') + '|' + (el.getAttribute('role') || '');
    if (seenSignature.has(sig)) continue;
    seenSignature.add(sig);
    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      text: (el.textContent || '').trim().slice(0, 60),
      accessible_name_guess: (el.getAttribute('aria-label') ||
                              el.getAttribute('title') ||
                              (el.textContent || '').trim()).slice(0, 60),
      supports_disabled: ('disabled' in el),
      is_natively_focusable: ['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY']
                              .includes(el.tagName) || el.hasAttribute('tabindex'),
      has_onclick: el.hasAttribute('onclick'),
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      occurrences: els.filter(e => (e.tagName + '|' + (e.getAttribute('class') || '') + '|' +
        (e.getAttribute('type') || '') + '|' + (e.getAttribute('role') || '')) === sig).length
    });
  }
  return out;
}
"""

READ_STYLE_JS = r"""
(params) => {
  const el = document.querySelector(params.selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const o = {};
  for (const p of params.props) o[p] = cs[p];
  o.__matchesFocusVisible = (() => { try { return el.matches(':focus-visible'); } catch(e) { return null; } })();
  o.__isActiveElement = (document.activeElement === el);
  return o;
}
"""


def cdp_force(cdp, node_id, pseudos):
    """Forca pseudo-classes via CDP. Lista vazia limpa o estado."""
    cdp.send("CSS.forcePseudoState", {"nodeId": node_id, "forcedPseudoClasses": pseudos})


def state_pseudos(state):
    return {
        "default": [],
        "hover": ["hover"],
        # focus + focus-visible juntos: alguns CSS estilizam :focus, outros
        # :focus-visible; forcar so um esconderia metade dos casos.
        "focus-visible": ["focus", "focus-visible"],
        "active": ["hover", "active"],
        "disabled": [],  # disabled nao e pseudo forcavel: mexemos no atributo
    }[state]


def diff_styles(a, b):
    """Propriedades que mudaram entre dois snapshots."""
    if not a or not b:
        return {}
    out = {}
    for p in WATCHED_PROPS:
        if a.get(p) != b.get(p):
            out[p] = {"de": a.get(p), "para": b.get(p)}
    return out


def meaningful(diff):
    """Mudanca so no cursor nao e afordancia visual — o usuario de toque e o de
    teclado nunca veem o cursor."""
    return any(k != "cursor" for k in diff.keys())


def probe_element(page, cdp, doc_root, target, scheme, out_dir, shots):
    sel = target["selector"]
    rec = {"selector": sel, "tag": target["tag"], "text": target["text"],
           "occurrences": target.get("occurrences"),
           "scheme": scheme, "states": {}, "issues": [], "warnings": [], "error": None}
    node_id = None
    if cdp is not None:
        try:
            node_id = cdp.send("DOM.querySelector",
                               {"nodeId": doc_root, "selector": sel}).get("nodeId")
            if not node_id:
                node_id = None
        except Exception as exc:
            rec["warnings"].append("CDP nao resolveu o no (%s); usando fallback de mouse." % exc)

    try:
        loc = page.locator(sel).first
        for state in STATES:
            entry = {"captured": False, "style": None, "png": None, "note": None}
            try:
                if state == "disabled":
                    if not target.get("supports_disabled"):
                        entry["note"] = ("elemento nao suporta o atributo disabled "
                                         "(nao e controle de formulario nativo); "
                                         "estado desabilitado precisa ser verificado a mao.")
                        rec["states"][state] = entry
                        continue
                    page.evaluate(
                        "(s) => { const e = document.querySelector(s); "
                        "e.dataset.__uxWasDisabled = e.disabled ? '1' : '0'; e.disabled = true; }", sel)
                elif node_id is not None:
                    cdp_force(cdp, node_id, state_pseudos(state))
                else:
                    # Fallback sem CDP: so hover e focus sao reproduziveis.
                    if state == "hover":
                        loc.hover(timeout=3000)
                    elif state == "focus-visible":
                        # Pressionar Tab antes define a modalidade de entrada como
                        # teclado; sem isso o Chromium nao aplica :focus-visible
                        # a foco programatico em <button>.
                        page.keyboard.press("Tab")
                        loc.focus(timeout=3000)
                    elif state == "active":
                        entry["note"] = "sem CDP nao ha como forcar :active de forma confiavel."
                        rec["states"][state] = entry
                        continue

                style = page.evaluate(READ_STYLE_JS, {"selector": sel, "props": WATCHED_PROPS})
                entry["style"] = style
                entry["captured"] = style is not None
                if shots:
                    # hash estavel do seletor: hash() do Python e aleatorizado
                    # por processo (PYTHONHASHSEED), e o relatorio precisa que o
                    # nome do arquivo de evidencia seja o mesmo entre execucoes.
                    # 8 hexdigits = 4 bilhoes de valores, colisao irrelevante
                    # para as ~24 combinacoes por pagina.
                    slug = hashlib.md5(sel.encode("utf-8")).hexdigest()[:8]
                    png = posix(os.path.join(
                        out_dir, "state-%s-%s-%s.png" % (scheme, state, slug)))
                    try:
                        loc.screenshot(path=png, timeout=5000)
                        entry["png"] = png
                    except Exception as exc:
                        entry["note"] = "screenshot falhou: %s" % exc
            except Exception as exc:
                entry["note"] = "%s: %s" % (type(exc).__name__, exc)
            finally:
                try:
                    if state == "disabled" and target.get("supports_disabled"):
                        page.evaluate(
                            "(s) => { const e = document.querySelector(s); "
                            "e.disabled = e.dataset.__uxWasDisabled === '1'; "
                            "delete e.dataset.__uxWasDisabled; }", sel)
                    elif node_id is not None:
                        cdp_force(cdp, node_id, [])
                    else:
                        page.mouse.move(0, 0)
                except Exception:
                    pass
            rec["states"][state] = entry

        base = (rec["states"].get("default") or {}).get("style")
        for state in ("hover", "focus-visible", "active", "disabled"):
            st = rec["states"].get(state) or {}
            if not st.get("captured"):
                continue
            d = diff_styles(base, st.get("style"))
            st["diff_vs_default"] = d
            st["visualmente_distinguivel"] = meaningful(d)

        fv = rec["states"].get("focus-visible") or {}
        if fv.get("captured") and not fv.get("visualmente_distinguivel"):
            rec["issues"].append({
                "id": "foco-sem-indicador",
                "criterio": "WCAG 2.2 — 2.4.7 Focus Visible (AA)",
                "impacto": "critical",
                "detalhe": "nenhuma propriedade visual muda no foco de teclado; "
                           "quem navega por Tab nao sabe onde esta.",
            })
        hv = rec["states"].get("hover") or {}
        if (hv.get("captured") and hv.get("visualmente_distinguivel")
                and fv.get("captured") and not fv.get("visualmente_distinguivel")):
            rec["issues"].append({
                "id": "afordancia-so-no-hover",
                "criterio": "WCAG 2.2 — 2.4.7 / equivalencia de entrada",
                "impacto": "serious",
                "detalhe": "o elemento reage ao mouse mas nao ao teclado; "
                           "toque e teclado ficam sem retorno.",
            })
        dis = rec["states"].get("disabled") or {}
        if dis.get("captured") and not dis.get("visualmente_distinguivel"):
            rec["issues"].append({
                "id": "disabled-indistinguivel",
                "criterio": "Heuristica de Nielsen #1 — visibilidade do estado do sistema",
                "impacto": "moderate",
                "detalhe": "o estado desabilitado tem a mesma aparencia do habilitado; "
                           "o usuario clica e nada acontece, sem explicacao.",
            })
        if target.get("has_onclick") and not target.get("is_natively_focusable"):
            rec["issues"].append({
                "id": "elemento-clicavel-nao-focavel",
                "criterio": "WCAG 2.2 — 2.1.1 Keyboard (A)",
                "impacto": "critical",
                "detalhe": "elemento com onclick que nao recebe foco por teclado: "
                           "a acao existe so para quem usa mouse.",
            })
    except Exception as exc:
        rec["error"] = "%s: %s" % (type(exc).__name__, exc)
    return rec


def run_scheme(browser, url, w, h, scheme, selectors, out_dir, timeout_ms, shots, max_elements):
    res = {"scheme": scheme, "viewport": "%dx%d" % (w, h), "elements": [],
           "warnings": [], "error": None}
    ctx = page = None
    try:
        ctx, page = new_page(browser, w, h, dark=(scheme == "dark"))
        # networkidle antes de ler estilo: tema e CSS-in-JS chegam tarde.
        res["warnings"] += goto_settled(page, url, timeout_ms)
        targets = page.evaluate(COLLECT_TARGETS_JS,
                                {"selector": selectors, "max": max_elements})
        if not targets:
            res["warnings"].append("nenhum elemento interativo casou com o seletor.")
        cdp, doc_root = None, None
        try:
            cdp = ctx.new_cdp_session(page)
            cdp.send("DOM.enable")
            cdp.send("CSS.enable")
            doc_root = cdp.send("DOM.getDocument").get("root", {}).get("nodeId")
        except Exception as exc:
            cdp, doc_root = None, None
            res["warnings"].append(
                "CDP indisponivel (%s): :active e :focus-visible caem para fallback." % exc)
        for t in targets:
            res["elements"].append(
                probe_element(page, cdp, doc_root, t, scheme, out_dir, shots))
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

    out_dir = ensure_out(args.out)
    viewports, _ = parse_viewports(args.viewports)
    w, h = viewports[0]  # estados nao mudam por viewport; um basta e economiza tempo
    selectors = args.selectors or AUTO_SELECTOR
    schemes = [s.strip() for s in (args.schemes or "light,dark").split(",") if s.strip()]

    payload = header(TOOL, label, viewport="%dx%d" % (w, h))
    payload["out_dir"] = out_dir
    payload["selectors"] = selectors
    payload["selectors_auto"] = args.selectors is None
    payload["states_capturados"] = STATES
    payload["propriedades_observadas"] = WATCHED_PROPS
    payload["results"] = []

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
            for scheme in schemes:
                payload["results"].append(
                    run_scheme(browser, url, w, h, scheme, selectors, out_dir,
                               args.timeout, not args.no_screenshots, args.max_elements))
        finally:
            try:
                browser.close()
            except Exception:
                pass

    issues = []
    for r in payload["results"]:
        for el in r["elements"]:
            for i in el["issues"]:
                issues.append({"scheme": r["scheme"], "selector": el["selector"],
                               "texto": el["text"], **i})
    payload["issues"] = issues
    payload["summary"] = {
        "elementos_por_tema": {r["scheme"]: len(r["elements"]) for r in payload["results"]},
        "total_issues": len(issues),
        "issues_por_id": {i["id"]: sum(1 for x in issues if x["id"] == i["id"]) for i in issues},
        "nota": "Elementos foram deduplicados por assinatura visual (tag+classe+tipo+role); "
                "'occurrences' diz quantas vezes o padrao aparece na pagina.",
    }
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="check_states.py",
        description="Captura hover, focus-visible, active e disabled de componentes "
                    "interativos em prefers-color-scheme claro e escuro, e sinaliza estados "
                    "que nao se distinguem do padrao.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/check_states.py --path ./index.html --out ./ux-audit\n"
               "  python3 scripts/check_states.py --url https://x.com.br --selectors '.btn,a.card'\n")
    add_target_args(ap)
    ap.add_argument("--selectors", default=None,
                    help="Seletores CSS separados por virgula. Sem isso, detecta interativos "
                         "automaticamente.")
    ap.add_argument("--schemes", default="light,dark",
                    help="Temas a testar (padrao: light,dark).")
    ap.add_argument("--max-elements", type=int, default=MAX_ELEMENTS,
                    help="Teto de elementos distintos (padrao: %d)." % MAX_ELEMENTS)
    ap.add_argument("--no-screenshots", action="store_true",
                    help="So mede estilo, sem gerar PNG (mais rapido).")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "states.json"))
