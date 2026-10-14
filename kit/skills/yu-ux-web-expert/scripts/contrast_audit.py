#!/usr/bin/env python3
"""
contrast_audit.py — contraste real, medido, par a par.

Percorre os elementos com texto visivel, resolve a cor computada de frente e a
cor de fundo subindo a arvore quando o fundo e transparente, e calcula o ratio
WCAG 2.x. Quando o fundo e imagem ou gradiente, marca "determinable": false —
nao chuta. Um contraste estimado no olho e pior que nenhum, porque parece
medicao.

Reporta tambem o Lc do APCA como INFORMACAO SECUNDARIA. APCA nao e criterio de
conformidade: WCAG 2.2 continua sendo 1.4.3 / 1.4.11 com ratio. O Lc entra
porque explica casos em que o ratio passa e a leitura ainda e ruim (texto fino
claro sobre escuro, por exemplo).

Saida: contrast.json (e stdout).

Exemplos:
  python3 scripts/contrast_audit.py --url https://exemplo.com.br --out ./ux-audit
  python3 scripts/contrast_audit.py --path ./index.html --selector ".btn-primary"
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

TOOL = "contrast_audit"

# --- Limiares WCAG 2.x (1.4.3 Contrast Minimum, nivel AA) --------------------
# Texto normal: 4,5:1. Texto grande: 3:1.
# "Grande" = >= 24px (18pt), ou >= 18.66px (14pt) quando bold (>= 700).
# Fonte: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
RATIO_NORMAL = 4.5
RATIO_LARGE = 3.0
LARGE_PX = 24.0
LARGE_PX_BOLD = 18.66
BOLD_WEIGHT = 700

# AAA (1.4.6) entra so como informacao: a skill audita contra AA.
RATIO_NORMAL_AAA = 7.0
RATIO_LARGE_AAA = 4.5

# Teto de elementos inspecionados. 1200 cobre paginas reais inteiras sem
# fazer o evaluate estourar memoria em SPA gigante; acima disso truncamos e
# avisamos, em vez de travar a auditoria.
MAX_ELEMENTS = 1200

# Amostra de texto guardada por elemento: identifica o achado no relatorio
# sem copiar a pagina para dentro do JSON.
TEXT_SAMPLE_CHARS = 80


# --------------------------------------------------------------- WCAG 2.x
def srgb_to_lin(c: float) -> float:
    """Canal sRGB 0..1 -> linear. Curva oficial da sRGB."""
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb) -> float:
    r, g, b = [srgb_to_lin(v / 255.0) for v in rgb[:3]]
    # Coeficientes de luminancia da recomendacao WCAG 2.x.
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg, bg) -> float:
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    # +0.05 e o termo de reflexao ambiente da formula WCAG.
    return (l1 + 0.05) / (l2 + 0.05)


# ------------------------------------------------------------------- APCA
# APCA 0.98G-4g (constantes publicadas em WCAG 3 / SAPC). Secundario, nunca
# usado para dizer "passa" ou "reprova" — WCAG 2.2 e o criterio vigente.
APCA_TRC = 2.4
APCA_R, APCA_G, APCA_B = 0.2126729, 0.7151522, 0.0721750
APCA_NORM_BG, APCA_NORM_TXT = 0.56, 0.57
APCA_REV_BG, APCA_REV_TXT = 0.65, 0.62
APCA_BLK_THRS, APCA_BLK_CLMP = 0.022, 1.414
APCA_SCALE = 1.14
APCA_LO_OFFSET = 0.027
APCA_DELTA_Y_MIN = 0.0005
APCA_LO_CLIP = 0.1


def apca_y(rgb) -> float:
    r, g, b = [(v / 255.0) ** APCA_TRC for v in rgb[:3]]
    y = APCA_R * r + APCA_G * g + APCA_B * b
    # Soft clamp do preto: compensa flare em tons muito escuros.
    return y if y >= APCA_BLK_THRS else y + (APCA_BLK_THRS - y) ** APCA_BLK_CLMP


def apca_lc(text_rgb, bg_rgb) -> float:
    """Lc do APCA. Sinal indica polaridade: positivo = texto escuro sobre claro."""
    ytxt, ybg = apca_y(text_rgb), apca_y(bg_rgb)
    if abs(ybg - ytxt) < APCA_DELTA_Y_MIN:
        return 0.0
    if ybg > ytxt:  # texto escuro sobre fundo claro
        sapc = (ybg ** APCA_NORM_BG - ytxt ** APCA_NORM_TXT) * APCA_SCALE
        out = 0.0 if sapc < APCA_LO_CLIP else sapc - APCA_LO_OFFSET
    else:           # texto claro sobre fundo escuro
        sapc = (ybg ** APCA_REV_BG - ytxt ** APCA_REV_TXT) * APCA_SCALE
        out = 0.0 if sapc > -APCA_LO_CLIP else sapc + APCA_LO_OFFSET
    return round(out * 100.0, 1)


def apca_reading(lc, font_px, weight):
    """Leitura qualitativa do Lc. Baseada nas faixas de uso do APCA:
    Lc 90 = texto fluente; 75 = texto de corpo; 60 = conteudo maior;
    45 = texto grande/negrito; 30 = minimo para qualquer texto; 15 = nao-texto."""
    a = abs(lc)
    if a >= 90:
        return "Lc>=90: adequado ate para texto fino e corpo pequeno"
    if a >= 75:
        return "Lc>=75: adequado para texto de corpo (>=16px regular)"
    if a >= 60:
        return "Lc>=60: adequado para conteudo maior, nao para corpo fino"
    if a >= 45:
        return "Lc>=45: so para texto grande ou negrito"
    if a >= 30:
        return "Lc>=30: piso do APCA para qualquer texto; leitura sofrivel"
    if a >= 15:
        return "Lc>=15: aceitavel apenas para elemento nao-textual"
    return "Lc<15: invisivel na pratica"


# ---------------------------------------------------------------- helpers
def parse_css_color(s):
    """'rgb(1, 2, 3)' / 'rgba(1,2,3,0.5)' -> (r,g,b,a). None se nao reconhecido."""
    if not s:
        return None
    s = s.strip().lower()
    if s in ("transparent",):
        return (0, 0, 0, 0.0)
    if s.startswith("rgb"):
        try:
            inner = s[s.index("(") + 1:s.rindex(")")]
            parts = [p.strip() for p in inner.replace("/", " ").replace(",", " ").split() if p.strip()]
            r, g, b = [float(parts[i]) for i in range(3)]
            a = float(parts[3]) if len(parts) > 3 else 1.0
            return (r, g, b, a)
        except Exception:
            return None
    if s.startswith("#"):
        h = s[1:]
        try:
            if len(h) == 3:
                return tuple(int(c * 2, 16) for c in h) + (1.0,)
            if len(h) == 6:
                return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
        except Exception:
            return None
    return None


def composite(fg_rgba, bg_rgb):
    """Alpha compositing "source-over": cor com transparencia sobre um fundo opaco."""
    a = fg_rgba[3]
    return tuple(fg_rgba[i] * a + bg_rgb[i] * (1 - a) for i in range(3))


def to_hex(rgb) -> str:
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


# JS de coleta. Devolve dados crus; a matematica fica em Python, onde da para
# comentar cada constante.
COLLECT_JS = r"""
(params) => {
  const { selector, maxElements, textChars } = params;
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el, depth = 0;
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
      parts.unshift(part);
      node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  };

  const hasDirectText = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 0) return true;
    }
    return false;
  };

  const roots = selector ? Array.from(document.querySelectorAll(selector))
                         : Array.from(document.body.querySelectorAll('*'));
  // Quando o usuario passa --selector, tambem olhamos os descendentes dele:
  // o texto costuma estar num filho, nao no proprio no do seletor.
  let pool = roots;
  if (selector) {
    const set = new Set(roots);
    roots.forEach(r => r.querySelectorAll('*').forEach(d => set.add(d)));
    pool = Array.from(set);
  }

  const out = [];
  let truncated = false;
  for (const el of pool) {
    if (out.length >= maxElements) { truncated = true; break; }
    if (!hasDirectText(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Cadeia de fundo: sobe ate achar cor opaca ou chegar no html.
    const chain = [];
    let node = el, guard = 0;
    let effOpacity = 1;
    while (node && guard < 40) {
      const s = getComputedStyle(node);
      const op = parseFloat(s.opacity);
      if (!isNaN(op)) effOpacity *= op;
      chain.push({
        tag: node.tagName.toLowerCase(),
        selector: cssPath(node),
        backgroundColor: s.backgroundColor,
        backgroundImage: s.backgroundImage,
        opacity: s.opacity
      });
      node = node.parentElement; guard++;
    }
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    const bodyBg = getComputedStyle(document.body).backgroundColor;

    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, textChars),
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      textShadow: cs.textShadow,
      effectiveOpacity: effOpacity,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y),
              w: Math.round(rect.width), h: Math.round(rect.height) },
      inViewport: rect.top < innerHeight && rect.bottom > 0,
      chain: chain,
      htmlBg: htmlBg, bodyBg: bodyBg
    });
  }
  return { items: out, truncated: truncated, poolSize: pool.length };
}
"""


def weight_to_num(w):
    try:
        return int(float(w))
    except Exception:
        return {"bold": 700, "bolder": 700, "normal": 400, "lighter": 300}.get(str(w).lower(), 400)


def resolve_background(item):
    """Sobe a cadeia compondo alfas. Devolve (rgb, determinable, motivo, cadeia_usada)."""
    used, acc = [], []  # acc = camadas semi-transparentes pendentes, do topo para baixo
    for node in item["chain"]:
        bimg = (node.get("backgroundImage") or "none").strip()
        col = parse_css_color(node.get("backgroundColor"))
        if bimg and bimg != "none":
            kind = ("gradiente" if "gradient" in bimg else "imagem")
            used.append(node["selector"])
            return (None, False,
                    "fundo e %s em '%s' (background-image: %s) — o valor varia pixel a pixel; "
                    "medir por amostragem de imagem, nao por cor computada."
                    % (kind, node["selector"], bimg[:120]), used)
        used.append(node["selector"])
        if col and col[3] > 0:
            if col[3] >= 0.999:
                base = (col[0], col[1], col[2])
                for layer in reversed(acc):
                    base = composite(layer, base)
                return (base, True, None, used)
            acc.append(col)
    # Nada opaco na cadeia: sobra o canvas do navegador.
    canvas = parse_css_color(item.get("htmlBg")) or parse_css_color(item.get("bodyBg"))
    if canvas and canvas[3] >= 0.999:
        base = (canvas[0], canvas[1], canvas[2])
    else:
        # Canvas padrao do navegador e branco quando ninguem pinta nada.
        base = (255.0, 255.0, 255.0)
    for layer in reversed(acc):
        base = composite(layer, base)
    return (base, True, None, used)


def evaluate_item(item):
    fg_rgba = parse_css_color(item.get("color"))
    size = float(item.get("fontSize") or 0)
    weight = weight_to_num(item.get("fontWeight"))
    is_large = size >= LARGE_PX or (weight >= BOLD_WEIGHT and size >= LARGE_PX_BOLD)
    required = RATIO_LARGE if is_large else RATIO_NORMAL
    required_aaa = RATIO_LARGE_AAA if is_large else RATIO_NORMAL_AAA

    rec = {
        "selector": item.get("selector"),
        "tag": item.get("tag"),
        "text_sample": item.get("text"),
        "font_size_px": size,
        "font_weight": weight,
        "font_family": (item.get("fontFamily") or "")[:120],
        "is_large_text": is_large,
        "required_ratio_aa": required,
        "in_viewport": item.get("inViewport"),
        "rect": item.get("rect"),
        "foreground": None,
        "background": None,
        "background_chain": None,
        "determinable": False,
        "reason": None,
        "ratio": None,
        "pass_aa": None,
        "pass_aaa": None,
        "apca_lc": None,
        "apca_reading": None,
        "warnings": [],
    }

    bg_rgb, determinable, reason, chain = resolve_background(item)
    rec["background_chain"] = chain
    if not determinable:
        rec["reason"] = reason
        return rec
    if not fg_rgba:
        rec["reason"] = "cor de texto nao interpretavel: %r" % item.get("color")
        return rec

    fg_rgb = composite(fg_rgba, bg_rgb) if fg_rgba[3] < 0.999 else (fg_rgba[0], fg_rgba[1], fg_rgba[2])
    if fg_rgba[3] < 0.999:
        rec["warnings"].append("cor do texto tem alpha %.2f; composta sobre o fundo resolvido." % fg_rgba[3])

    eff_op = float(item.get("effectiveOpacity") or 1.0)
    if eff_op < 0.999:
        # opacity herdada afeta o pixel final; compomos e avisamos, porque o
        # devtools mostra a cor "antes" e o usuario ve a cor "depois".
        fg_rgb = composite((fg_rgb[0], fg_rgb[1], fg_rgb[2], eff_op), bg_rgb)
        rec["warnings"].append("opacity efetiva %.2f na cadeia; cor final composta." % eff_op)

    ratio = contrast_ratio(fg_rgb, bg_rgb)
    rec["foreground"] = to_hex(fg_rgb)
    rec["background"] = to_hex(bg_rgb)
    rec["determinable"] = True
    rec["ratio"] = round(ratio, 2)
    rec["pass_aa"] = ratio >= required
    rec["pass_aaa"] = ratio >= required_aaa
    lc = apca_lc(fg_rgb, bg_rgb)
    rec["apca_lc"] = lc
    rec["apca_reading"] = apca_reading(lc, size, weight)
    if (item.get("textShadow") or "none") != "none":
        rec["warnings"].append("elemento tem text-shadow; o contraste real pode diferir do calculado.")
    return rec


def audit_viewport(browser, url, w, h, selector, timeout_ms, only_fail):
    vp = "%dx%d" % (w, h)
    res = {"viewport": vp, "checked": 0, "results": [], "counts": {},
           "warnings": [], "error": None}
    ctx = page = None
    try:
        ctx, page = new_page(browser, w, h)
        # networkidle antes de ler cores: tema escuro, webfont e CSS-in-JS
        # entram tarde e mudam a cor computada.
        res["warnings"] += goto_settled(page, url, timeout_ms)
        raw = page.evaluate(COLLECT_JS, {"selector": selector,
                                         "maxElements": MAX_ELEMENTS,
                                         "textChars": TEXT_SAMPLE_CHARS})
        if raw.get("truncated"):
            res["warnings"].append(
                "pagina excedeu %d elementos com texto; analise truncada." % MAX_ELEMENTS)
        recs = [evaluate_item(it) for it in raw.get("items", [])]
        res["checked"] = len(recs)
        counts = {
            "determinaveis": sum(1 for r in recs if r["determinable"]),
            "nao_determinaveis": sum(1 for r in recs if not r["determinable"]),
            "reprovam_aa": sum(1 for r in recs if r["determinable"] and not r["pass_aa"]),
            "passam_aa": sum(1 for r in recs if r["determinable"] and r["pass_aa"]),
        }
        res["counts"] = counts
        res["results"] = [r for r in recs
                          if (not only_fail) or (not r["determinable"]) or (not r["pass_aa"])]
        # Piores casos primeiro: e por onde o relatorio comeca.
        res["results"].sort(key=lambda r: (r["ratio"] if r["ratio"] is not None else 99))
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
    payload = header(TOOL, label, viewport=",".join("%dx%d" % v for v in viewports))
    payload["out_dir"] = posix(args.out)
    payload["selector"] = args.selector
    payload["criteria"] = {
        "wcag": "2.2 — 1.4.3 Contrast (Minimum), nivel AA",
        "normal_text": RATIO_NORMAL, "large_text": RATIO_LARGE,
        "large_text_definition": ">=%.0fpx, ou >=%.2fpx com peso >=%d" % (
            LARGE_PX, LARGE_PX_BOLD, BOLD_WEIGHT),
        "apca": "Lc reportado como informacao secundaria; nao e criterio de conformidade.",
    }
    payload["limitacoes"] = [
        "Texto sobre imagem ou gradiente sai como determinable=false — exige amostragem visual.",
        "Texto sobre <video>, <canvas> ou elemento sobreposto por posicionamento nao e resolvido pela cadeia de ancestrais.",
        "Nao cobre 1.4.11 (contraste de elemento nao-textual: borda de input, icone) — isso e do run_axe.py e do checklist manual.",
    ]
    payload["warnings"] = ["viewport ignorado: %s" % b for b in bad]
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
            for (w, h) in viewports:
                payload["results"].append(
                    audit_viewport(browser, url, w, h, args.selector, args.timeout, args.only_fail))
        finally:
            try:
                browser.close()
            except Exception:
                pass

    payload["summary"] = {
        vp["viewport"]: vp["counts"] for vp in payload["results"] if not vp["error"]
    }
    piores = []
    for vp in payload["results"]:
        for r in vp["results"]:
            if r["determinable"] and not r["pass_aa"]:
                piores.append({"viewport": vp["viewport"], "selector": r["selector"],
                               "ratio": r["ratio"], "required": r["required_ratio_aa"],
                               "fg": r["foreground"], "bg": r["background"]})
    piores.sort(key=lambda x: x["ratio"])
    payload["piores_casos"] = piores[:10]  # 10 e o que cabe num relatorio sem virar planilha
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="contrast_audit.py",
        description="Mede contraste WCAG 2.x real (cor computada de frente e fundo, subindo a "
                    "arvore) e reporta Lc do APCA como informacao secundaria. Fundo em imagem "
                    "ou gradiente sai como determinable=false, sem chute.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/contrast_audit.py --url https://exemplo.com.br --out ./ux-audit\n"
               "  python3 scripts/contrast_audit.py --path ./index.html --selector '.btn-primary'\n"
               "  python3 scripts/contrast_audit.py --url https://x.com --only-fail\n")
    add_target_args(ap)
    ap.add_argument("--selector", default=None,
                    help="Restringe a analise a um seletor CSS e seus descendentes.")
    ap.add_argument("--only-fail", action="store_true",
                    help="Lista apenas o que reprova em AA ou nao e determinavel (contagens vem completas).")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "contrast.json"))
