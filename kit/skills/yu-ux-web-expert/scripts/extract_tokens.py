#!/usr/bin/env python3
"""
extract_tokens.py — inventario do que a interface REALMENTE usa.

Este e o script que transforma "parece inconsistente" em "17 cinzas para 4
papeis semanticos". Critica estetica vira fato auditavel: contagem, agrupamento
por proximidade perceptual e lista de valores fora de escala.

Inventaria: cores (com o papel em que aparecem — texto, fundo, borda, sombra),
familias de fonte, tamanhos, pesos, alturas de linha, espacamentos (margin,
padding, gap), raios de canto e sombras. Tudo com contagem de ocorrencias.

Cores quase iguais caem no mesmo balde. A proximidade e medida em CIELAB
(DeltaE 76), nao em hex: #9AA0A6 e #9BA0A7 sao literalmente cores diferentes e
perceptualmente a mesma — e o segundo so existe porque alguem digitou errado.

Fontes: --url / --path (o que o navegador computa, incluindo CSS-in-JS e tema
aplicado em runtime) ou --css (um arquivo/pasta de CSS, quando so o codigo esta
disponivel). O modo navegador e o confiavel: e o unico que ve o valor final.

Saida: tokens.json.

Exemplos:
  python3 scripts/extract_tokens.py --url https://exemplo.com.br --out ./ux-audit
  python3 scripts/extract_tokens.py --path ./index.html
  python3 scripts/extract_tokens.py --css ./src/styles.css
"""

from __future__ import annotations

import argparse
import glob
import math
import os
import pathlib
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    ensure_out, goto_settled, header, import_playwright, new_page,
    parse_viewports, posix, run_safe,
)

TOOL = "extract_tokens"

# DeltaE 76 em CIELAB. ~2,3 e o limiar classico de diferenca "apenas
# perceptivel" (JND). Usamos 3,0: agrupa o que so um colorimetro distingue,
# sem fundir tons que o olho realmente separa.
DELTA_E_BUCKET = 3.0

# Acima disso, o inventario de um unico eixo deixa de ser sistema e vira
# acidente. Os numeros vem do que design systems maduros publicam: paletas
# funcionais raramente passam de ~12 tons neutros + acentos; escalas
# tipograficas ficam entre 6 e 10 degraus; escalas de espacamento, entre 6 e 12.
LIMITES_SAUDAVEIS = {
    "cores_apos_agrupamento": 20,
    "familias_de_fonte": 3,
    "tamanhos_de_fonte": 10,
    "pesos_de_fonte": 4,
    "espacamentos": 12,
    "raios": 5,
    "sombras": 5,
}

# Escalas de espacamento comuns (base 4 e base 8). Servem para dizer quais
# valores estao FORA da escala, nao para impor uma.
BASES_DE_ESCALA = (4, 8)

MAX_ELEMENTS = 4000  # paginas reais ficam bem abaixo; teto evita estouro em SPA gigante
MAX_EXAMPLES = 4     # 4 seletores de exemplo bastam para o humano achar o caso


# ------------------------------------------------------------------ cores
NAMED = {
    "black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0),
    "green": (0, 128, 0), "blue": (0, 0, 255), "gray": (128, 128, 128),
    "grey": (128, 128, 128), "silver": (192, 192, 192), "orange": (255, 165, 0),
    "yellow": (255, 255, 0), "purple": (128, 0, 128), "navy": (0, 0, 128),
    "teal": (0, 128, 128), "maroon": (128, 0, 0), "olive": (128, 128, 0),
    "lime": (0, 255, 0), "aqua": (0, 255, 255), "cyan": (0, 255, 255),
    "fuchsia": (255, 0, 255), "magenta": (255, 0, 255),
}


def parse_color(s):
    """Aceita hex, rgb(), rgba(), hsl(), hsla() e nomes basicos.
    Devolve (r,g,b,a) ou None. Transparente devolve alpha 0."""
    if not s:
        return None
    s = s.strip().lower()
    if s in ("transparent", "none", "currentcolor", "inherit", "initial", "unset"):
        return (0, 0, 0, 0.0) if s == "transparent" else None
    if s in NAMED:
        return NAMED[s] + (1.0,)
    if s.startswith("#"):
        h = s[1:]
        try:
            if len(h) in (3, 4):
                v = [int(c * 2, 16) for c in h]
                return (v[0], v[1], v[2], (v[3] / 255.0) if len(v) == 4 else 1.0)
            if len(h) in (6, 8):
                v = [int(h[i:i + 2], 16) for i in range(0, len(h), 2)]
                return (v[0], v[1], v[2], (v[3] / 255.0) if len(v) == 4 else 1.0)
        except Exception:
            return None
        return None
    m = re.match(r"^(rgba?|hsla?)\(([^)]*)\)$", s)
    if not m:
        return None
    kind, body = m.group(1), m.group(2)
    parts = [p.strip() for p in body.replace("/", " ").replace(",", " ").split() if p.strip()]
    try:
        if kind.startswith("rgb"):
            vals = []
            for p in parts[:3]:
                vals.append(float(p[:-1]) * 2.55 if p.endswith("%") else float(p))
            a = 1.0
            if len(parts) > 3:
                a = float(parts[3][:-1]) / 100.0 if parts[3].endswith("%") else float(parts[3])
            return (vals[0], vals[1], vals[2], a)
        # hsl -> rgb
        h = float(re.sub(r"(deg|turn|rad)$", "", parts[0]))
        if parts[0].endswith("turn"):
            h *= 360
        sat = float(parts[1].rstrip("%")) / 100.0
        lig = float(parts[2].rstrip("%")) / 100.0
        a = 1.0
        if len(parts) > 3:
            a = float(parts[3][:-1]) / 100.0 if parts[3].endswith("%") else float(parts[3])
        c = (1 - abs(2 * lig - 1)) * sat
        hp = (h % 360) / 60.0
        x = c * (1 - abs(hp % 2 - 1))
        r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][int(hp) % 6]
        m2 = lig - c / 2
        return ((r + m2) * 255, (g + m2) * 255, (b + m2) * 255, a)
    except Exception:
        return None


def to_hex(rgb):
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(c)))) for c in rgb[:3])


def srgb_to_lab(rgb):
    """sRGB -> CIELAB D65. Necessario porque distancia em hex nao tem relacao
    com distancia percebida."""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = [lin(v) for v in rgb[:3]]
    # Matriz sRGB -> XYZ (D65)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    # Branco de referencia D65
    xn, yn, zn = 0.95047, 1.00000, 1.08883
    def f(t):
        return t ** (1.0 / 3.0) if t > 0.008856 else (7.787 * t + 16.0 / 116.0)
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e76(lab1, lab2):
    return math.sqrt(sum((lab1[i] - lab2[i]) ** 2 for i in range(3)))


def is_neutral(rgb):
    """Cinza = canais quase iguais. Tolerancia de 12/255 cobre os 'cinzas
    quentes/frios' que design systems usam de proposito."""
    r, g, b = rgb[:3]
    return (max(r, g, b) - min(r, g, b)) <= 12


def cluster_colors(color_stats):
    """Agrupamento guloso por DeltaE. O representante do balde e o tom mais
    usado — e o candidato natural a virar token."""
    items = sorted(color_stats.items(), key=lambda kv: -kv[1]["count"])
    buckets = []
    for hexv, stat in items:
        lab = srgb_to_lab(stat["rgb"])
        placed = False
        for b in buckets:
            d = delta_e76(lab, b["_lab"])
            if d <= DELTA_E_BUCKET:
                b["members"].append({"hex": hexv, "count": stat["count"],
                                     "delta_e_do_representante": round(d, 2)})
                b["count_total"] += stat["count"]
                b["max_delta_e"] = max(b["max_delta_e"], round(d, 2))
                for role, n in stat["roles"].items():
                    b["roles"][role] = b["roles"].get(role, 0) + n
                placed = True
                break
        if not placed:
            buckets.append({
                "representante": hexv, "_lab": lab,
                "members": [{"hex": hexv, "count": stat["count"], "delta_e_do_representante": 0.0}],
                "count_total": stat["count"], "max_delta_e": 0.0,
                "roles": dict(stat["roles"]),
                "neutro": is_neutral(stat["rgb"]),
            })
    for b in buckets:
        b.pop("_lab", None)
        if len(b["members"]) > 1:
            b["aviso"] = ("%d tons distintos com DeltaE ate %.1f — perceptualmente o mesmo. "
                          "Provavel duplicacao acidental; candidato a um token unico."
                          % (len(b["members"]), b["max_delta_e"]))
    buckets.sort(key=lambda b: -b["count_total"])
    return buckets


# ------------------------------------------------- numeros e escalas
def px_of(value):
    """Extrai o numero de um valor em px. Ignora %, em, auto, etc — o
    computado do navegador ja vem em px na maioria dos casos."""
    if not value:
        return None
    m = re.match(r"^(-?\d+(?:\.\d+)?)px$", str(value).strip())
    return float(m.group(1)) if m else None


def off_scale(values, bases=BASES_DE_ESCALA):
    """Quais valores nao sao multiplos de nenhuma base da escala.
    Tolerancia de 0,5px absorve arredondamento de rem para px."""
    out = []
    for v in values:
        if v == 0:
            continue
        if not any(abs(v % b) < 0.5 or abs(b - (v % b)) < 0.5 for b in bases):
            out.append(v)
    return sorted(set(out))


# ------------------------------------------------------- coleta no browser
COLLECT_JS = r"""
(max) => {
  const cssPath = (n) => {
    if (n.id) return '#' + CSS.escape(n.id);
    const parts = []; let node = n, depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/)
        .filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      part += cls; parts.unshift(part); node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  };
  const els = Array.from(document.querySelectorAll('*')).slice(0, max);
  const out = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    const temTexto = Array.from(el.childNodes).some(
      n => n.nodeType === 3 && n.textContent.trim().length > 0);
    out.push({
      sel: cssPath(el), tag: el.tagName.toLowerCase(), temTexto: temTexto,
      area: Math.round(r.width * r.height),
      color: cs.color, backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      borderTopColor: cs.borderTopColor, borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor, borderLeftColor: cs.borderLeftColor,
      borderTopWidth: cs.borderTopWidth, borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth, borderLeftWidth: cs.borderLeftWidth,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      marginTop: cs.marginTop, marginRight: cs.marginRight,
      marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
      paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
      rowGap: cs.rowGap, columnGap: cs.columnGap,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomLeftRadius: cs.borderBottomLeftRadius,
      borderBottomRightRadius: cs.borderBottomRightRadius,
      boxShadow: cs.boxShadow, textShadow: cs.textShadow,
      transitionDuration: cs.transitionDuration
    });
  }
  // Variaveis CSS declaradas no :root — se ja existe um sistema de tokens,
  // ele aparece aqui, e a comparacao com o uso real e o achado.
  const rootVars = {};
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules || [])) {
        if (rule.style && rule.selectorText &&
            /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) {
          for (const p of Array.from(rule.style)) {
            if (p.startsWith('--')) rootVars[p] = rule.style.getPropertyValue(p).trim();
          }
        }
      }
    }
  } catch (e) {}
  return { items: out, rootVars: rootVars, total: document.querySelectorAll('*').length };
}
"""


def collect_from_browser(url, viewports, timeout_ms, warnings):
    sync_playwright, err = import_playwright()
    if err:
        warnings.append(err)
        return None, {}, None
    data, root_vars, total = [], {}, None
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        except Exception as exc:
            warnings.append("nao foi possivel iniciar o Chromium (%s). Rode scripts/setup.sh." % exc)
            return None, {}, None
        try:
            for (w, h) in viewports:
                ctx = page = None
                try:
                    ctx, page = new_page(browser, w, h)
                    # networkidle antes de ler: tema, webfont e CSS-in-JS entram
                    # depois da primeira pintura e mudam TODO o inventario.
                    warnings.extend(goto_settled(page, url, timeout_ms))
                    raw = page.evaluate(COLLECT_JS, MAX_ELEMENTS)
                    for it in raw["items"]:
                        it["_viewport"] = "%dx%d" % (w, h)
                    data.extend(raw["items"])
                    root_vars.update(raw.get("rootVars") or {})
                    total = raw.get("total")
                    if total and total > MAX_ELEMENTS:
                        warnings.append("pagina tem %d elementos; inventario limitado aos "
                                        "primeiros %d." % (total, MAX_ELEMENTS))
                except Exception as exc:
                    warnings.append("coleta falhou em %dx%d: %s" % (w, h, exc))
                finally:
                    for obj in (page, ctx):
                        try:
                            if obj:
                                obj.close()
                        except Exception:
                            pass
        finally:
            try:
                browser.close()
            except Exception:
                pass
    return data, root_vars, total


# ------------------------------------------------------------ modo --css
DECL_RE = re.compile(r"([-a-zA-Z]+)\s*:\s*([^;{}]+)[;}]")
VAR_DECL_RE = re.compile(r"(--[\w-]+)\s*:\s*([^;{}]+)[;}]")


def collect_from_css(paths, warnings):
    """Le declaracoes de arquivos CSS. Menos confiavel que o navegador: nao
    resolve cascata, variaveis, media query ativa nem CSS-in-JS. Serve quando
    so o codigo existe."""
    items, root_vars, files = [], {}, []
    for pattern in paths:
        matched = glob.glob(pattern, recursive=True)
        if not matched and os.path.isdir(pattern):
            matched = glob.glob(os.path.join(pattern, "**", "*.css"), recursive=True)
        if not matched:
            matched = [pattern]
        for f in matched:
            if os.path.isdir(f):
                continue
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except Exception as exc:
                warnings.append("nao foi possivel ler %s: %s" % (posix(f), exc))
                continue
            files.append(posix(f))
            text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
            for m in VAR_DECL_RE.finditer(text):
                root_vars[m.group(1)] = m.group(2).strip()
            for m in DECL_RE.finditer(text):
                prop = m.group(1).strip()
                val = m.group(2).strip()
                items.append({"prop": prop, "value": val, "file": posix(f)})

    # Resolve var(--x) usando as variaveis declaradas. Duas passadas cobrem
    # token que aponta para token (--btn-bg: var(--azul)); mais que isso e raro
    # e o custo de resolver em profundidade nao se paga num modo ja degradado.
    if root_vars:
        for _ in range(2):
            for k, v in list(root_vars.items()):
                root_vars[k] = resolve_vars(v, root_vars)
        for it in items:
            it["value"] = resolve_vars(it["value"], root_vars)
    return items, root_vars, files


VAR_USE_RE = re.compile(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)")


def resolve_vars(value, root_vars):
    """Troca var(--x) pelo valor declarado no :root; sem declaracao, usa o
    fallback da propria expressao. Nao simula cascata — e uma aproximacao
    explicita do modo --css."""
    def sub(m):
        name, fallback = m.group(1), (m.group(2) or "").strip()
        return root_vars.get(name, fallback or m.group(0))
    try:
        return VAR_USE_RE.sub(sub, value)
    except Exception:
        return value


CSS_PROP_MAP = {
    "color": ("color", "texto"),
    "background-color": ("backgroundColor", "fundo"),
    "background": ("backgroundColor", "fundo"),
    "border-color": ("borderColor", "borda"),
    "border": ("borderColor", "borda"),
    "outline-color": ("borderColor", "borda"),
    "fill": ("color", "texto"),
    "stroke": ("borderColor", "borda"),
}


def build_inventory_from_css(items):
    colors = defaultdict(lambda: {"count": 0, "roles": Counter(), "rgb": None, "examples": []})
    fonts, sizes, weights, spacings, radii, shadows, line_heights = (
        Counter(), Counter(), Counter(), Counter(), Counter(), Counter(), Counter())
    for it in items:
        prop, val = it["prop"].lower(), it["value"]
        if prop in CSS_PROP_MAP:
            for token in re.findall(r"#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b", val):
                c = parse_color(token)
                if c and c[3] > 0:
                    hx = to_hex(c)
                    colors[hx]["count"] += 1
                    colors[hx]["rgb"] = c[:3]
                    colors[hx]["roles"][CSS_PROP_MAP[prop][1]] += 1
                    if len(colors[hx]["examples"]) < MAX_EXAMPLES:
                        colors[hx]["examples"].append("%s (%s)" % (prop, it["file"]))
        elif prop in ("font-family",):
            fonts[val.strip()] += 1
        elif prop in ("font-size",):
            v = px_of(val)
            sizes[v if v is not None else val.strip()] += 1
        elif prop in ("font-weight",):
            weights[val.strip()] += 1
        elif prop in ("line-height",):
            line_heights[val.strip()] += 1
        elif prop.startswith("margin") or prop.startswith("padding") or prop in ("gap", "row-gap", "column-gap"):
            for tok in val.split():
                v = px_of(tok)
                if v is not None:
                    spacings[v] += 1
        elif prop.startswith("border") and "radius" in prop:
            for tok in val.split():
                v = px_of(tok)
                if v is not None:
                    radii[v] += 1
        elif prop in ("box-shadow", "text-shadow"):
            shadows[re.sub(r"\s+", " ", val.strip())] += 1
    return colors, fonts, sizes, weights, spacings, radii, shadows, line_heights


def build_inventory_from_dom(items):
    colors = defaultdict(lambda: {"count": 0, "roles": Counter(), "rgb": None, "examples": []})
    fonts, sizes, weights, spacings, radii, shadows, line_heights, letter = (
        Counter(), Counter(), Counter(), Counter(), Counter(), Counter(), Counter(), Counter())

    def add_color(value, role, sel):
        c = parse_color(value)
        if not c or c[3] <= 0:
            return
        hx = to_hex(c)
        colors[hx]["count"] += 1
        colors[hx]["rgb"] = c[:3]
        colors[hx]["roles"][role] += 1
        if len(colors[hx]["examples"]) < MAX_EXAMPLES and sel not in colors[hx]["examples"]:
            colors[hx]["examples"].append(sel)

    for it in items:
        sel = it.get("sel")
        # Cor de texto so conta quando ha texto: senao herdamos a cor de mil
        # <div> e o inventario mente sobre o que o usuario ve.
        if it.get("temTexto"):
            add_color(it.get("color"), "texto", sel)
            f = (it.get("fontFamily") or "").strip()
            if f:
                fonts[f] += 1
            v = px_of(it.get("fontSize"))
            if v:
                sizes[v] += 1
            w = (it.get("fontWeight") or "").strip()
            if w:
                weights[w] += 1
            lh = (it.get("lineHeight") or "").strip()
            if lh:
                line_heights[lh] += 1
            ls = (it.get("letterSpacing") or "").strip()
            if ls and ls != "normal":
                letter[ls] += 1
        # Fundo so conta se pintado (alpha > 0): 'rgba(0,0,0,0)' e ausencia.
        add_color(it.get("backgroundColor"), "fundo", sel)
        for side in ("Top", "Right", "Bottom", "Left"):
            if (px_of(it.get("border%sWidth" % side)) or 0) > 0:
                add_color(it.get("border%sColor" % side), "borda", sel)
        for k in ("marginTop", "marginRight", "marginBottom", "marginLeft",
                  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
                  "rowGap", "columnGap"):
            v = px_of(it.get(k))
            if v is not None and v > 0:
                spacings[v] += 1
        for k in ("borderTopLeftRadius", "borderTopRightRadius",
                  "borderBottomLeftRadius", "borderBottomRightRadius"):
            v = px_of(it.get(k))
            if v is not None and v > 0:
                radii[v] += 1
        for k in ("boxShadow", "textShadow"):
            sh = (it.get(k) or "none").strip()
            if sh and sh != "none":
                shadows[re.sub(r"\s+", " ", sh)] += 1
                for tok in re.findall(r"#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)", sh):
                    add_color(tok, "sombra", sel)
    return colors, fonts, sizes, weights, spacings, radii, shadows, line_heights, letter


def counter_to_list(c, key="valor"):
    return [{key: k, "ocorrencias": n} for k, n in
            sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0])))]


def main(args):
    warnings = []
    out_dir = ensure_out(args.out)
    modo = "css" if args.css else ("navegador" if (args.url or args.path) else None)

    if modo is None:
        pay = header(TOOL, None)
        pay["error"] = "informe --url, --path ou --css"
        return pay

    if modo == "navegador":
        if args.url:
            url, label = args.url, args.url
        else:
            p = pathlib.Path(args.path).expanduser().resolve()
            if not p.exists():
                pay = header(TOOL, posix(p)); pay["error"] = "arquivo nao encontrado"
                return pay
            url, label = p.as_uri(), posix(p)
        viewports, _ = parse_viewports(args.viewports)
        payload = header(TOOL, label, viewport=",".join("%dx%d" % v for v in viewports))
        items, root_vars, total = collect_from_browser(url, viewports, args.timeout, warnings)
        if items is None:
            payload["out_dir"] = out_dir
            payload["warnings"] = warnings
            payload["error"] = warnings[-1] if warnings else "coleta no navegador falhou"
            return payload
        colors, fonts, sizes, weights, spacings, radii, shadows, lhs, letter = \
            build_inventory_from_dom(items)
        payload["elementos_inspecionados"] = len(items)
        payload["elementos_na_pagina"] = total
    else:
        label = ",".join(args.css)
        payload = header(TOOL, label, viewport=None)
        items, root_vars, files = collect_from_css(args.css, warnings)
        colors, fonts, sizes, weights, spacings, radii, shadows, lhs = \
            build_inventory_from_css(items)
        letter = Counter()
        payload["arquivos_lidos"] = files
        payload["declaracoes_lidas"] = len(items)
        warnings.append("Modo --css: valores declarados, nao computados. Nao resolve cascata, "
                        "variaveis, media query ativa nem CSS-in-JS. Para o inventario real, "
                        "use --url ou --path.")

    payload["modo"] = modo
    payload["out_dir"] = out_dir

    color_stats = {k: {"count": v["count"], "rgb": v["rgb"],
                       "roles": dict(v["roles"]), "exemplos": v["examples"]}
                   for k, v in colors.items() if v["rgb"] is not None}
    buckets = cluster_colors(color_stats)
    neutros = [b for b in buckets if b.get("neutro")]
    duplicadas = [b for b in buckets if len(b["members"]) > 1]

    sp_vals = sorted(spacings.keys())
    fora_escala = off_scale(sp_vals)

    payload["cores"] = {
        "distintas": len(color_stats),
        "apos_agrupamento": len(buckets),
        "delta_e_do_balde": DELTA_E_BUCKET,
        "metrica": "CIELAB DeltaE 76 (D65)",
        "baldes": [{k: v for k, v in b.items()} for b in buckets],
        "inventario_bruto": [
            {"hex": k, "ocorrencias": v["count"], "papeis": v["roles"], "exemplos": v["exemplos"]}
            for k, v in sorted(color_stats.items(), key=lambda kv: -kv[1]["count"])],
        "neutros": {
            "baldes": len(neutros),
            "tons_distintos": sum(len(b["members"]) for b in neutros),
            "papeis_cobertos": sorted({r for b in neutros for r in b["roles"]}),
        },
    }
    payload["tipografia"] = {
        "familias": counter_to_list(fonts, "familia"),
        "tamanhos_px": counter_to_list(sizes, "px"),
        "pesos": counter_to_list(weights, "peso"),
        "alturas_de_linha": counter_to_list(lhs, "line_height"),
        "letter_spacing": counter_to_list(letter, "letter_spacing"),
        "menor_tamanho_px": min([s for s in sizes if isinstance(s, (int, float))], default=None),
    }
    payload["espacamento"] = {
        "valores_px": counter_to_list(spacings, "px"),
        "distintos": len(sp_vals),
        "bases_testadas": list(BASES_DE_ESCALA),
        "fora_da_escala": fora_escala,
        "nota": "'fora_da_escala' = nao e multiplo de 4 nem de 8. Nao e erro por si; "
                "e o sintoma de valor digitado a mao em vez de token.",
    }
    payload["raios"] = {"valores_px": counter_to_list(radii, "px"), "distintos": len(radii)}
    payload["sombras"] = {"valores": counter_to_list(shadows, "sombra"), "distintas": len(shadows)}
    payload["variaveis_css_no_root"] = root_vars
    payload["warnings"] = warnings

    # Diagnostico: e o que vira frase no relatorio.
    diag = []
    if len(buckets) > LIMITES_SAUDAVEIS["cores_apos_agrupamento"]:
        diag.append("%d cores distintas mesmo apos agrupar as perceptualmente iguais "
                    "(referencia de sistema maduro: ate %d)."
                    % (len(buckets), LIMITES_SAUDAVEIS["cores_apos_agrupamento"]))
    if duplicadas:
        total_dup = sum(len(b["members"]) for b in duplicadas)
        diag.append("%d tons colapsam em %d cores perceptualmente identicas — duplicacao "
                    "acidental, nao decisao de design." % (total_dup, len(duplicadas)))
    if neutros:
        papeis = sorted({r for b in neutros for r in b["roles"]})
        tons = sum(len(b["members"]) for b in neutros)
        diag.append("%d tons neutros (cinzas) para %d papeis semanticos (%s)."
                    % (tons, len(papeis), ", ".join(papeis)))
    if len(fonts) > LIMITES_SAUDAVEIS["familias_de_fonte"]:
        diag.append("%d familias de fonte em uso (referencia: ate %d)."
                    % (len(fonts), LIMITES_SAUDAVEIS["familias_de_fonte"]))
    if len(sizes) > LIMITES_SAUDAVEIS["tamanhos_de_fonte"]:
        diag.append("%d tamanhos de fonte distintos (escala tipografica tipica: 6 a %d degraus)."
                    % (len(sizes), LIMITES_SAUDAVEIS["tamanhos_de_fonte"]))
    if len(weights) > LIMITES_SAUDAVEIS["pesos_de_fonte"]:
        diag.append("%d pesos de fonte distintos (referencia: ate %d)."
                    % (len(weights), LIMITES_SAUDAVEIS["pesos_de_fonte"]))
    if len(sp_vals) > LIMITES_SAUDAVEIS["espacamentos"]:
        diag.append("%d valores de espacamento distintos (escala tipica: ate %d)."
                    % (len(sp_vals), LIMITES_SAUDAVEIS["espacamentos"]))
    if fora_escala:
        diag.append("%d valores de espacamento fora de qualquer escala 4/8: %s."
                    % (len(fora_escala), ", ".join("%gpx" % v for v in fora_escala[:12])))
    if len(radii) > LIMITES_SAUDAVEIS["raios"]:
        diag.append("%d raios de canto distintos (referencia: ate %d)."
                    % (len(radii), LIMITES_SAUDAVEIS["raios"]))
    if len(shadows) > LIMITES_SAUDAVEIS["sombras"]:
        diag.append("%d sombras distintas (referencia: ate %d) — elevacao sem sistema."
                    % (len(shadows), LIMITES_SAUDAVEIS["sombras"]))
    if root_vars:
        diag.append("Existem %d variaveis CSS no :root: compare o que esta declarado com o "
                    "que e efetivamente usado acima — token que ninguem usa e documentacao "
                    "morta." % len(root_vars))
    payload["diagnostico"] = diag
    payload["limites_de_referencia"] = LIMITES_SAUDAVEIS
    payload["nota_de_julgamento"] = (
        "Estes numeros descrevem, nao condenam. Um e-commerce com categorias coloridas "
        "legitimamente usa mais cores que um painel administrativo. O sinal forte de "
        "problema e o balde com varios membros (mesma cor digitada de formas diferentes) "
        "e o valor fora de escala — nao a contagem alta em si.")
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="extract_tokens.py",
        description="Inventaria cores, fontes, tamanhos, pesos, espacamentos, raios e sombras "
                    "efetivamente usados, com contagem e agrupamento por proximidade "
                    "perceptual (CIELAB DeltaE). Transforma 'parece inconsistente' em numero.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/extract_tokens.py --url https://exemplo.com.br --out ./ux-audit\n"
               "  python3 scripts/extract_tokens.py --path ./index.html\n"
               "  python3 scripts/extract_tokens.py --css 'src/**/*.css'\n")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--url", help="URL a inventariar.")
    g.add_argument("--path", help="Arquivo HTML local a inventariar.")
    g.add_argument("--css", nargs="+", help="Arquivo(s), pasta ou glob de CSS. Modo degradado: "
                                            "le o declarado, nao o computado.")
    ap.add_argument("--out", default="./ux-audit", help="Diretorio de artefatos (padrao: ./ux-audit).")
    ap.add_argument("--viewports", default="360x800,1440x900",
                    help="Viewports a inspecionar no modo navegador (padrao: 360x800,1440x900) — "
                         "dois bastam: o inventario muda com media query.")
    ap.add_argument("--timeout", type=int, default=30000, help="Timeout de navegacao em ms.")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "tokens.json"))
