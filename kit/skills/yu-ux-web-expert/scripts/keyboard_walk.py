#!/usr/bin/env python3
"""
keyboard_walk.py — percurso real por Tab, parada a parada.

Pressiona Tab ate o foco repetir (ciclo completo) ou ate o teto de paradas, e
em cada parada registra: qual elemento recebeu o foco, se o indicador de foco e
visivel, se o elemento esta oculto, se esta fora da viewport, se esta obscurecido
por outro elemento (barra fixa, cookie banner), e se a ordem de foco acompanha a
ordem visual. Detecta armadilha de foco e presenca de skip link.

Criterios cobertos (WCAG 2.2):
  2.1.1 Keyboard (A) · 2.1.2 No Keyboard Trap (A) · 2.4.1 Bypass Blocks (A)
  2.4.3 Focus Order (A) · 2.4.7 Focus Visible (AA) · 2.4.11 Focus Not Obscured (AA)

Visibilidade do foco e decidida por DUAS evidencias independentes: mudanca no
estilo computado (outline/box-shadow/borda/fundo) e diferenca de pixels entre o
screenshot antes e depois do foco. Uma so das duas produz falso resultado —
outline transparente engana o CSS, animacao engana o pixel.

Saida: keyboard.json + PNG de cada parada.

Exemplos:
  python3 scripts/keyboard_walk.py --path ./index.html --out ./ux-audit
  python3 scripts/keyboard_walk.py --url https://exemplo.com.br --max-stops 60
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

TOOL = "keyboard_walk"

# 80 paradas cobrem uma pagina densa (menu + grade de produtos + rodape) sem
# transformar o teste num loop infinito em pagina com carrossel infinito.
MAX_STOPS = 80

# Diferenca de pixels acima da qual consideramos que ALGO mudou visualmente.
# 0,05% dos pixels da regiao: acima do ruido de antialiasing, abaixo de um
# outline fino de 1px numa area pequena.
PIXEL_DIFF_THRESHOLD = 0.0005

# Margem em px ao redor do elemento no recorte de comparacao: o indicador de
# foco costuma ficar FORA da caixa do elemento (outline-offset).
FOCUS_CLIP_PADDING = 8

FOCUS_PROPS = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset",
               "boxShadow", "borderColor", "borderWidth", "backgroundColor",
               "color", "textDecorationLine", "filter", "transform"]

ACTIVE_INFO_JS = r"""
(props) => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return { none: true, tag: el ? el.tagName.toLowerCase() : null };
  }
  const cssPath = (n) => {
    if (n.id) return '#' + CSS.escape(n.id);
    const parts = []; let node = n, depth = 0;
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
  const cs = getComputedStyle(el);
  const style = {}; for (const p of props) style[p] = cs[p];
  const r = el.getBoundingClientRect();

  // Nome acessivel aproximado. Nao substitui a arvore de acessibilidade, mas
  // e o bastante para o humano reconhecer a parada no relatorio.
  const name = (el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') &&
      (document.getElementById(el.getAttribute('aria-labelledby'))||{}).textContent) ||
    (el.labels && el.labels[0] && el.labels[0].textContent) ||
    el.getAttribute('title') || el.getAttribute('alt') ||
    (el.textContent || '').trim() || el.getAttribute('placeholder') || '').trim();

  // Oculto: display/visibility, tamanho zero, ou fora da tela por
  // posicionamento (padrao classico de skip link mal implementado que nunca
  // aparece nem no foco).
  // innerWidth/innerHeight sao a area REALMENTE visivel em px CSS. Sob emulacao
  // movel com shrink-to-fit (pagina que estoura na horizontal), o navegador
  // renderiza uma area CSS maior dentro do mesmo viewport de dispositivo, e
  // documentElement.clientWidth/Height passa a mentir. A escala do screenshot
  // tambem sai daqui: largura_da_imagem / VW.
  const VW = window.innerWidth || document.documentElement.clientWidth;
  const VH = window.innerHeight || document.documentElement.clientHeight;
  const hidden = cs.display === 'none' || cs.visibility === 'hidden' ||
                 parseFloat(cs.opacity) === 0 || r.width < 1 || r.height < 1 ||
                 el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true';
  const offscreen = r.bottom < 0 || r.right < 0 || r.top > VH || r.left > VW;

  // Obscurecido (2.4.11): o ponto central do elemento pertence a ele ou a um
  // descendente? Se pertence a outro elemento, algo esta por cima.
  let obscuredBy = null;
  if (!hidden && !offscreen) {
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), VW - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), VH - 1);
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      obscuredBy = cssPath(top);
    }
  }

  return {
    none: false,
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    type: el.getAttribute('type'),
    href: el.getAttribute('href'),
    tabindex: el.getAttribute('tabindex'),
    name: name.slice(0, 80),
    style: style,
    rect: { x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
            top_abs: Math.round(r.top + scrollY), left_abs: Math.round(r.left + scrollX) },
    visible_viewport_css: { w: VW, h: VH },
    shrink_to_fit: (document.documentElement.clientWidth !== VW),
    hidden: hidden, offscreen: offscreen, obscuredBy: obscuredBy,
    inDialog: !!el.closest('[role=dialog], dialog, [aria-modal=true]')
  };
}
"""

SKIP_LINK_JS = r"""
() => {
  // Skip link = primeiro link focavel da pagina apontando para ancora interna.
  const links = Array.from(document.querySelectorAll('a[href^="#"]')).slice(0, 5);
  const allAnchors = Array.from(document.querySelectorAll('a'));
  // Um skip link de verdade e um dos primeiros links do documento, aponta para
  // uma ancora existente, e ou tem texto de "pular para" ou fica escondido ate
  // receber foco. Qualquer <a href="#..."> no rodape nao e skip link.
  const SKIP_TXT = /(pular|ir para|saltar|skip)\s+(para\s+)?(o\s+)?(conte|main|nav|menu|content)/i;
  const out = [];
  for (const a of links) {
    const target = a.getAttribute('href').slice(1);
    const cs = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    out.push({
      text: (a.textContent || '').trim().slice(0, 60),
      href: a.getAttribute('href'),
      target_exists: !!(target && document.getElementById(target)),
      visually_hidden_by_default: (r.width < 2 || r.height < 2 ||
                                   cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
                                   parseFloat(cs.opacity) === 0 ||
                                   r.top + scrollY < -50),
      index_in_dom: allAnchors.indexOf(a),
      is_probable_skip_link: (() => {
        const idx = allAnchors.indexOf(a);
        const txt = (a.textContent || '').trim();
        const hidden = (r.width < 2 || r.height < 2 ||
                        cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
                        parseFloat(cs.opacity) === 0 || r.top + scrollY < -50);
        return idx <= 2 && !!(target && document.getElementById(target)) &&
               (SKIP_TXT.test(txt) || hidden);
      })()
    });
  }
  return out;
}
"""


def focus_pixel_diff(png_focused: bytes, png_blurred: bytes, rect, visible_vp):
    """Compara os dois screenshots da viewport SO na regiao do elemento (mais
    folga para o outline, que mora fora da caixa).

    A escala entre CSS px e pixel de imagem e derivada da propria imagem
    (largura_da_imagem / largura_visivel_em_css). Isso sobrevive a
    device_scale_factor, a emulacao mobile e a shrink-to-fit — calcular na mao
    a partir dos argumentos --viewports da errado justamente nas paginas que
    estouram na horizontal."""
    try:
        from PIL import Image, ImageChops
        import io
        a = Image.open(io.BytesIO(png_focused)).convert("RGB")
        b = Image.open(io.BytesIO(png_blurred)).convert("RGB")
        if a.size != b.size:
            return None
        vw = float(visible_vp.get("w") or a.size[0]) or 1.0
        scale = a.size[0] / vw
        x0 = int(max(0, (rect["x"] - FOCUS_CLIP_PADDING) * scale))
        y0 = int(max(0, (rect["y"] - FOCUS_CLIP_PADDING) * scale))
        x1 = int(min(a.size[0], (rect["x"] + rect["w"] + FOCUS_CLIP_PADDING) * scale))
        y1 = int(min(a.size[1], (rect["y"] + rect["h"] + FOCUS_CLIP_PADDING) * scale))
        if x1 - x0 < 2 or y1 - y0 < 2:
            return None
        ca, cb = a.crop((x0, y0, x1, y1)), b.crop((x0, y0, x1, y1))
        diff = ImageChops.difference(ca, cb)
        if diff.getbbox() is None:
            return 0.0
        # histogram() do canal de luminancia: o bucket 0 sao os pixels iguais.
        hist = diff.convert("L").histogram()
        changed = sum(hist[1:])
        return changed / float(ca.size[0] * ca.size[1])
    except Exception:
        return None


def style_changed(before, after):
    if not before or not after:
        return {}, False
    d = {p: {"de": before.get(p), "para": after.get(p)}
         for p in FOCUS_PROPS if before.get(p) != after.get(p)}
    # outline-style 'none' -> 'none' com cor diferente nao produz indicador.
    real = False
    for p, v in d.items():
        if p == "outlineStyle" and v["para"] not in ("none", None):
            real = True
        elif p in ("boxShadow", "backgroundColor", "borderColor", "borderWidth",
                   "color", "textDecorationLine", "filter", "transform", "outlineWidth"):
            real = True
        elif p == "outlineColor" and (after.get("outlineStyle") not in ("none", None)):
            real = True
    return d, real


def walk(browser, url, w, h, out_dir, timeout_ms, max_stops, shots):
    res = {"viewport": "%dx%d" % (w, h), "stops": [], "skip_links": [],
           "trap": None, "warnings": [], "error": None,
           "cycle_completed": False, "visual_order_violations": []}
    ctx = page = None
    try:
        ctx, page = new_page(browser, w, h)
        # networkidle antes de tabular: em SPA, metade dos focaveis nem existe
        # antes da hidratacao terminar.
        res["warnings"] += goto_settled(page, url, timeout_ms)

        try:
            res["skip_links"] = page.evaluate(SKIP_LINK_JS)
        except Exception as exc:
            res["warnings"].append("deteccao de skip link falhou: %s" % exc)

        # Comeca do topo do documento para que a primeira parada seja de fato a
        # primeira parada — nao a que estiver perto de onde o mouse parou.
        page.evaluate("() => { window.scrollTo(0,0); document.body.focus(); "
                      "if (document.activeElement !== document.body) "
                      "document.activeElement.blur(); }")

        seen = {}
        prev_selector = None
        stalled = 0
        for i in range(max_stops):
            before_style = None
            before_png = None
            # Estado ANTES do Tab, no recorte do proximo elemento: so da para
            # saber depois de focar, entao capturamos o "antes" logo apos o
            # Tab, com o foco removido temporariamente. Alternativa mais barata
            # e comparar com o mesmo recorte sem foco:
            page.keyboard.press("Tab")
            page.wait_for_timeout(60)  # 60ms cobre transicao CSS curta de foco
            info = page.evaluate(ACTIVE_INFO_JS, FOCUS_PROPS)
            scrolled = False
            # O Chromium nem sempre rola sozinho ate o elemento focado sob
            # emulacao movel (o viewport de layout e menor que o bloco contentor
            # inicial). Rolamos explicitamente e relemos: so continua "fora da
            # viewport" o que NAO da para trazer para a tela — esse sim e achado.
            if (not info.get("none")) and info.get("offscreen"):
                try:
                    page.evaluate("() => document.activeElement && "
                                  "document.activeElement.scrollIntoView({block:'center'})")
                    page.wait_for_timeout(80)  # 80ms cobre o scroll suave curto
                    info = page.evaluate(ACTIVE_INFO_JS, FOCUS_PROPS)
                    scrolled = True
                except Exception:
                    pass
            if info.get("none"):
                res["warnings"].append(
                    "parada %d: o foco saiu para o navegador (barra de endereco) — "
                    "fim do ciclo de foco da pagina." % (i + 1))
                res["cycle_completed"] = True
                break

            sel = info["selector"]
            stop = {
                "index": i + 1, "selector": sel, "tag": info["tag"],
                "role": info.get("role"), "type": info.get("type"),
                "name": info.get("name"), "href": info.get("href"),
                "tabindex": info.get("tabindex"),
                "rect": info["rect"], "hidden": info["hidden"],
                "offscreen": info["offscreen"], "obscured_by": info.get("obscuredBy"),
                "in_dialog": info.get("inDialog"),
                "rolado_para_ver": scrolled,
                "shrink_to_fit": info.get("shrink_to_fit"),
                "focus_visible": None, "focus_evidence": {},
                "png": None, "issues": [],
            }

            # Evidencia 1: estilo. Tiramos o foco, lemos o estilo do MESMO
            # elemento sem foco, e comparamos.
            try:
                unfocused = page.evaluate(
                    """(args) => {
                        const el = document.querySelector(args.sel);
                        if (!el) return null;
                        const active = document.activeElement;
                        el.blur();
                        const cs = getComputedStyle(el);
                        const o = {}; for (const p of args.props) o[p] = cs[p];
                        if (active && active.focus) active.focus();
                        return o;
                    }""", {"sel": sel, "props": FOCUS_PROPS})
            except Exception:
                unfocused = None
            diff, real = style_changed(unfocused, info["style"])
            stop["focus_evidence"]["style_diff"] = diff
            stop["focus_evidence"]["style_indicates_focus"] = real

            # Evidencia 2: pixels. Recorte com folga, com e sem foco.
            ratio = None
            if shots and not info["hidden"] and not info["offscreen"]:
                try:
                    lv = info.get("visible_viewport_css") or {"w": w, "h": h}
                    focused_png = page.screenshot()
                    page.evaluate("() => document.activeElement && document.activeElement.blur()")
                    page.wait_for_timeout(60)
                    blurred_png = page.screenshot()
                    # Recoloca o foco antes de qualquer outra coisa: o proximo Tab
                    # precisa continuar de onde parou, ou a ordem sai errada.
                    page.evaluate("(s) => { const e = document.querySelector(s); "
                                  "if (e && e.focus) e.focus(); }", sel)
                    ratio = focus_pixel_diff(focused_png, blurred_png, info["rect"], lv)
                    png_path = posix(os.path.join(out_dir, "kb-%02d.png" % (i + 1)))
                    with open(png_path, "wb") as fh:
                        fh.write(focused_png)
                    stop["png"] = png_path
                    page.wait_for_timeout(30)
                except Exception as exc:
                    stop["issues"].append({"id": "screenshot-falhou", "detalhe": str(exc)[:200]})
            stop["focus_evidence"]["pixel_diff_ratio"] = ratio
            stop["focus_evidence"]["pixel_threshold"] = PIXEL_DIFF_THRESHOLD
            pixel_says = (ratio is not None and ratio > PIXEL_DIFF_THRESHOLD)
            stop["focus_evidence"]["pixel_indicates_focus"] = (
                pixel_says if ratio is not None else None)

            if ratio is None:
                stop["focus_visible"] = real
                stop["focus_evidence"]["metodo"] = "somente estilo computado (sem Pillow ou sem recorte)"
            else:
                stop["focus_visible"] = bool(real or pixel_says)
                stop["focus_evidence"]["metodo"] = "estilo computado + diferenca de pixels"

            if not stop["focus_visible"]:
                stop["issues"].append({
                    "id": "foco-nao-visivel",
                    "criterio": "WCAG 2.2 — 2.4.7 Focus Visible (AA)",
                    "impacto": "serious",
                    "detalhe": "nada muda visualmente quando este elemento recebe foco.",
                })
            if info["hidden"]:
                stop["issues"].append({
                    "id": "foco-em-elemento-oculto",
                    "criterio": "WCAG 2.2 — 2.4.3 Focus Order (A)",
                    "impacto": "serious",
                    "detalhe": "o foco entra em elemento invisivel; a navegacao por teclado "
                               "'some' sem explicacao.",
                })
            if info.get("obscuredBy"):
                stop["issues"].append({
                    "id": "foco-obscurecido",
                    "criterio": "WCAG 2.2 — 2.4.11 Focus Not Obscured (Minimum) (AA)",
                    "impacto": "serious",
                    "detalhe": "o elemento focado esta coberto por '%s' (barra fixa, banner "
                               "ou overlay)." % info["obscuredBy"],
                })
            if info["offscreen"] and not info["hidden"]:
                stop["issues"].append({
                    "id": "foco-fora-da-viewport",
                    "criterio": "WCAG 2.2 — 2.4.3 / 2.4.11",
                    "impacto": "moderate",
                    "detalhe": "o elemento focado continua fora da area visivel mesmo apos "
                               "scrollIntoView — provavelmente esta posicionado fora da tela "
                               "sem estar oculto, e quem navega por teclado perde a referencia.",
                })

            res["stops"].append(stop)

            # Armadilha de foco: o mesmo seletor recebe foco varias vezes
            # seguidas apesar do Tab. 3 repeticoes consecutivas descartam a
            # coincidencia de um unico re-render.
            if sel == prev_selector:
                stalled += 1
                if stalled >= 3:
                    res["trap"] = {
                        "selector": sel, "parada": i + 1,
                        "criterio": "WCAG 2.2 — 2.1.2 No Keyboard Trap (A)",
                        "impacto": "critical",
                        "detalhe": "o foco nao avanca deste elemento apos 3 Tabs; "
                                   "quem usa teclado fica preso.",
                    }
                    break
            else:
                stalled = 0
            prev_selector = sel

            # Ciclo fechado: voltamos ao primeiro elemento ja visitado.
            if sel in seen and i > 0:
                res["cycle_completed"] = True
                res["ciclo_fechou_em"] = {"parada": i + 1, "repete_a_parada": seen[sel]}
                res["stops"].pop()  # a parada repetida nao e uma parada nova
                break
            seen[sel] = i + 1

        if len(res["stops"]) >= max_stops:
            res["warnings"].append(
                "teto de %d paradas atingido sem fechar o ciclo; a pagina pode ter mais "
                "focaveis do que o percorrido." % max_stops)

        # Clicavel mas ausente do percurso: <div onclick>, <span role=button>
        # sem tabindex. Nao aparece como parada — a AUSENCIA e o achado, e por
        # isso precisa ser procurada explicitamente.
        try:
            visitados = [s0["selector"] for s0 in res["stops"]]
            res["clicaveis_nao_focaveis"] = page.evaluate(
                r"""(visitados) => {
                    const cssPath = (n) => {
                      if (n.id) return '#' + CSS.escape(n.id);
                      const parts = []; let node = n, depth = 0;
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
                    const NATIVOS = ['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY','DETAILS','LABEL','OPTION'];
                    const cand = Array.from(document.querySelectorAll(
                      '[onclick], [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]'));
                    const out = [];
                    for (const el of cand) {
                      const nativo = NATIVOS.includes(el.tagName);
                      const ti = el.getAttribute('tabindex');
                      const focavel = (nativo && !el.disabled && !(el.tagName === 'A' && !el.hasAttribute('href')))
                                      || (ti !== null && ti !== '-1');
                      const sel = cssPath(el);
                      if (!focavel && !visitados.includes(sel)) {
                        const cs = getComputedStyle(el);
                        out.push({
                          selector: sel, tag: el.tagName.toLowerCase(),
                          role: el.getAttribute('role'),
                          tem_onclick: el.hasAttribute('onclick'),
                          tabindex: ti, cursor: cs.cursor,
                          texto: (el.textContent || '').trim().slice(0, 60)
                        });
                      }
                    }
                    return out.slice(0, 30);
                }""", visitados)
        except Exception as exc:
            res["clicaveis_nao_focaveis"] = []
            res["warnings"].append("deteccao de clicavel-nao-focavel falhou: %s" % exc)

        # Ordem de foco x ordem visual (2.4.3). Comparamos a sequencia de
        # posicoes absolutas: um retrocesso grande no eixo Y indica que a ordem
        # de DOM/tabindex nao acompanha o que o olho le.
        prev_y = None
        for s in res["stops"]:
            y = s["rect"]["top_abs"]
            if prev_y is not None and y < prev_y - 100:  # 100px: tolera colunas lado a lado
                res["visual_order_violations"].append({
                    "parada": s["index"], "selector": s["selector"],
                    "y_anterior": prev_y, "y_atual": y,
                    "criterio": "WCAG 2.2 — 2.4.3 Focus Order (A)",
                    "detalhe": "o foco subiu mais de 100px na pagina em relacao a parada "
                               "anterior; confirme visualmente se a ordem faz sentido "
                               "(layout em colunas pode justificar).",
                })
            prev_y = y
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
    payload = header(TOOL, label, viewport=",".join("%dx%d" % v for v in viewports))
    payload["out_dir"] = out_dir
    payload["max_stops"] = args.max_stops
    payload["criterios"] = ["2.1.1", "2.1.2", "2.4.1", "2.4.3", "2.4.7", "2.4.11"]
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
                    walk(browser, url, w, h, out_dir, args.timeout,
                         args.max_stops, not args.no_screenshots))
        finally:
            try:
                browser.close()
            except Exception:
                pass

    resumo = {}
    for r in payload["results"]:
        stops = r["stops"]
        sk = [s for s in (r["skip_links"] or []) if s.get("is_probable_skip_link")]
        cnf = r.get("clicaveis_nao_focaveis") or []
        resumo[r["viewport"]] = {
            "paradas": len(stops),
            "ciclo_fechou": r["cycle_completed"],
            "armadilha_de_foco": bool(r["trap"]),
            "sem_indicador_de_foco": [s["selector"] for s in stops if s["focus_visible"] is False],
            "foco_em_oculto": [s["selector"] for s in stops if s["hidden"]],
            "foco_obscurecido": [s["selector"] for s in stops if s["obscured_by"]],
            "skip_link_presente": bool(sk),
            "skip_link_detalhe": sk[:2],
            "clicaveis_sem_acesso_por_teclado": [c["selector"] for c in cnf],
            "possiveis_quebras_de_ordem": len(r["visual_order_violations"]),
            "erro": r["error"],
        }
    payload["summary"] = resumo
    for r in payload["results"]:
        for c in (r.get("clicaveis_nao_focaveis") or []):
            r.setdefault("issues", []).append({
                "id": "clicavel-nao-focavel",
                "selector": c["selector"],
                "criterio": "WCAG 2.2 — 2.1.1 Keyboard (A)",
                "impacto": "critical",
                "detalhe": "elemento com comportamento de clique que nunca recebe foco por "
                           "Tab: a acao so existe para quem usa mouse.",
            })
    payload["nota"] = ("Ordem de foco 'estranha' precisa de confirmacao humana: layout em "
                       "colunas produz retrocesso legitimo no eixo Y. O script marca o "
                       "candidato, nao decide.")
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="keyboard_walk.py",
        description="Percorre a pagina por Tab ate repetir o foco. Registra ordem, "
                    "visibilidade do indicador de foco (estilo + diferenca de pixels), "
                    "armadilhas, skip link, foco em elemento oculto ou obscurecido.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/keyboard_walk.py --path ./index.html --out ./ux-audit\n"
               "  python3 scripts/keyboard_walk.py --url https://x.com.br --viewports 360x800\n")
    add_target_args(ap)
    ap.add_argument("--max-stops", type=int, default=MAX_STOPS,
                    help="Teto de paradas por viewport (padrao: %d)." % MAX_STOPS)
    ap.add_argument("--no-screenshots", action="store_true",
                    help="Nao gera PNG nem compara pixels; decide so pelo estilo computado.")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "keyboard.json"))
