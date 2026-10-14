#!/usr/bin/env python3
"""
capture.py — captura multi-viewport de uma pagina: screenshots, DOM, console e rede.

E o primeiro script de toda auditoria: produz as evidencias que os achados do
relatorio vao citar. Roda em varios viewports porque o mesmo layout falha de
formas diferentes em 360 e em 1440.

Artefatos por viewport (em --out):
  <vp>-full.png    screenshot da pagina inteira
  <vp>-fold.png    apenas a primeira dobra (above-the-fold)
  <vp>-dom.html    HTML serializado DEPOIS da hidratacao
  console.json     mensagens de console + erros de pagina, por viewport
  network.json     requisicoes, status, tipo e tamanho, por viewport
  capture.json     indice de tudo, tambem impresso no stdout

Exemplos:
  python3 scripts/capture.py --url https://exemplo.com.br --out ./ux-audit
  python3 scripts/capture.py --path ./index.html --viewports 360x800
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    add_target_args, emit, ensure_out, goto_settled, header, import_playwright,
    new_page, parse_viewports, posix, run_safe,
)

TOOL = "capture"

# Above-the-fold: o recorte e exatamente a altura do viewport. E o unico
# pedaco da pagina que o usuario ve sem agir, e onde a decisao de ficar ou
# sair acontece.
FOLD_CLIP_FULL_PAGE = False


# JS de riscos de layout. Sao fatos deterministicos do DOM que nenhuma outra
# ferramenta da bateria pega: o Lighthouse so acusa CLS quando o deslocamento
# ACONTECE na medicao, e imagem lenta em rede movel desloca em campo mesmo
# quando nao desloca no laboratorio.
LAYOUT_RISKS_JS = r"""
() => {
  const cssPath = (n) => {
    if (n.id) return '#' + CSS.escape(n.id);
    const parts = []; let node = n, depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/)
        .filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      part += cls; parts.unshift(part); node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  };

  // 1) Midia sem dimensao reservada -> causa classica de CLS.
  const semDimensao = [];
  for (const el of Array.from(document.querySelectorAll('img, iframe, video, embed, object'))) {
    const cs = getComputedStyle(el);
    const temAttr = el.hasAttribute('width') && el.hasAttribute('height');
    const temAspect = cs.aspectRatio && cs.aspectRatio !== 'auto';
    const temAltura = cs.height && cs.height !== 'auto' && parseFloat(cs.height) > 0 &&
                      (el.style.height || cs.minHeight !== '0px');
    const r = el.getBoundingClientRect();
    if (!temAttr && !temAspect && !temAltura && r.width * r.height > 0) {
      semDimensao.push({
        selector: cssPath(el), tag: el.tagName.toLowerCase(),
        src: (el.getAttribute('src') || '').slice(0, 120),
        alt: el.getAttribute('alt'),
        loading: el.getAttribute('loading'),
        renderizado: { w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  }

  // 2) Estouro horizontal: em 360px e o defeito que mais denuncia layout nao
  // testado em celular. 1px de tolerancia absorve arredondamento de subpixel.
  const doc = document.documentElement;
  const estoura = doc.scrollWidth > doc.clientWidth + 1;
  const culpados = [];
  if (estoura) {
    for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 2000)) {
      const r = el.getBoundingClientRect();
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        culpados.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(),
                        direita: Math.round(r.right), largura: Math.round(r.width) });
      }
      if (culpados.length >= 10) break;  // 10 culpados bastam; costuma ser um so
    }
  }

  // 3) Alvos de toque menores que 24x24 CSS px (WCAG 2.2 - 2.5.8 Target Size
  //    Minimum, AA). Aqui so o fato geometrico; excecoes do criterio (inline,
  //    espacamento equivalente) precisam de julgamento humano.
  const alvosPequenos = [];
  for (const el of Array.from(document.querySelectorAll(
      'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [onclick]'))) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || r.width === 0) continue;
    if (r.width < 24 || r.height < 24) {
      alvosPequenos.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(),
                           w: Math.round(r.width), h: Math.round(r.height),
                           texto: (el.textContent || '').trim().slice(0, 40),
                           inline: cs.display.includes('inline') });
    }
    if (alvosPequenos.length >= 30) break;
  }

  return {
    midia_sem_dimensao: semDimensao,
    estouro_horizontal: {
      estoura: estoura, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
      culpados: culpados
    },
    alvos_de_toque_pequenos: {
      criterio: "WCAG 2.2 - 2.5.8 Target Size (Minimum), AA: 24x24 CSS px",
      itens: alvosPequenos,
      nota: "O criterio tem excecoes (link em linha de texto, espacamento equivalente, "
            + "controle do agente de usuario). Confirme antes de reportar como violacao."
    }
  };
}
"""


def classify_resource(req_type: str, url: str) -> str:
    """Agrupa por tipo para o orcamento de peso por recurso."""
    t = (req_type or "other").lower()
    if t in ("stylesheet", "script", "image", "font", "document", "media", "xhr", "fetch"):
        return {"xhr": "xhr/fetch", "fetch": "xhr/fetch"}.get(t, t)
    return "other"


def capture_one(browser, url, label, w, h, out_dir, timeout_ms):
    """Captura um viewport. Erros ficam contidos neste viewport."""
    vp = "%dx%d" % (w, h)
    result = {
        "viewport": vp, "screenshots": {}, "dom": None,
        "console": [], "page_errors": [], "network": [],
        "network_summary": {}, "warnings": [], "error": None,
        "page_title": None, "final_url": None,
    }
    ctx = page = None
    try:
        ctx, page = new_page(browser, w, h)
        console_msgs, page_errors, requests = [], [], {}

        page.on("console", lambda m: console_msgs.append({
            "type": m.type,
            "text": (m.text or "")[:500],  # 500 chars: identifica a mensagem sem inflar o JSON
            "location": getattr(m, "location", None),
        }))
        page.on("pageerror", lambda e: page_errors.append({"message": str(e)[:500]}))

        def on_response(resp):
            try:
                r = resp.request
                requests[resp.url] = {
                    "url": resp.url[:400],
                    "status": resp.status,
                    "type": classify_resource(r.resource_type, resp.url),
                    "from_cache": bool(resp.from_service_worker),
                }
            except Exception:
                pass

        page.on("response", on_response)

        # SEMPRE espera networkidle antes de inspecionar: em app dinamico
        # (React/Next hidratando, conteudo por fetch) o DOM lido antes disso
        # vem incompleto e a auditoria reporta problema que nao existe.
        result["warnings"] += goto_settled(page, url, timeout_ms)

        result["page_title"] = page.title()
        result["final_url"] = page.url

        full_png = posix(os.path.join(out_dir, "%s-full.png" % vp))
        fold_png = posix(os.path.join(out_dir, "%s-fold.png" % vp))
        try:
            page.screenshot(path=full_png, full_page=True)
            result["screenshots"]["full_page"] = full_png
        except Exception as exc:
            result["warnings"].append("screenshot full-page falhou: %s" % exc)
        try:
            page.screenshot(path=fold_png, full_page=FOLD_CLIP_FULL_PAGE)
            result["screenshots"]["above_the_fold"] = fold_png
        except Exception as exc:
            result["warnings"].append("screenshot above-the-fold falhou: %s" % exc)

        dom_path = posix(os.path.join(out_dir, "%s-dom.html" % vp))
        try:
            html = page.content()
            with open(dom_path, "w", encoding="utf-8") as fh:
                fh.write(html)
            result["dom"] = dom_path
            result["dom_bytes"] = len(html.encode("utf-8"))
        except Exception as exc:
            result["warnings"].append("serializacao do DOM falhou: %s" % exc)

        # Tamanho por recurso vem do Performance Timeline: transferSize e o
        # que trafega na rede (ja comprimido), que e o numero que importa
        # para orcamento em rede movel.
        try:
            # Inclui a entrada de NAVEGACAO junto com os recursos: o documento
            # principal nao aparece em getEntriesByType('resource'), e sem ele o
            # peso total da pagina sai sem o HTML — justamente o recurso que
            # bloqueia a primeira pintura.
            entries = page.evaluate("""() => {
                const map = e => ({
                  name: e.name, initiatorType: e.initiatorType || 'navigation',
                  transferSize: e.transferSize || 0,
                  decodedBodySize: e.decodedBodySize || 0,
                  duration: Math.round(e.duration)
                });
                return performance.getEntriesByType('resource').map(map)
                  .concat(performance.getEntriesByType('navigation').map(map));
            }""")
        except Exception:
            entries = []
        by_url = {e["name"]: e for e in entries}

        net, summary = [], {}
        for u, meta in requests.items():
            e = by_url.get(u, {})
            transfer = int(e.get("transferSize") or 0)
            item = dict(meta)
            item["transfer_bytes"] = transfer
            item["decoded_bytes"] = int(e.get("decodedBodySize") or 0)
            item["duration_ms"] = e.get("duration")
            net.append(item)
            b = summary.setdefault(item["type"], {"count": 0, "transfer_bytes": 0})
            b["count"] += 1
            b["transfer_bytes"] += transfer
        result["network"] = net
        result["network_summary"] = {
            "by_type": summary,
            "total_requests": len(net),
            "total_transfer_bytes": sum(v["transfer_bytes"] for v in summary.values()),
            "note": "transfer_bytes vem de PerformanceResourceTiming.transferSize; "
                    "recursos cross-origin sem Timing-Allow-Origin reportam 0.",
        }
        try:
            result["layout_risks"] = page.evaluate(LAYOUT_RISKS_JS)
        except Exception as exc:
            result["warnings"].append("analise de riscos de layout falhou: %s" % exc)
        result["console"] = console_msgs
        result["page_errors"] = page_errors
    except Exception as exc:
        result["error"] = "%s: %s" % (type(exc).__name__, exc)
    finally:
        for obj in (page, ctx):
            try:
                if obj:
                    obj.close()
            except Exception:
                pass
    return result


def main(args):
    url, label = None, None
    if args.url:
        url, label = args.url, args.url
    elif args.path:
        import pathlib
        p = pathlib.Path(args.path).expanduser().resolve()
        if not p.exists():
            payload = header(TOOL, posix(p))
            payload["error"] = "arquivo nao encontrado: %s" % posix(p)
            payload["results"] = []
            return payload
        url, label = p.as_uri(), posix(p)

    out_dir = ensure_out(args.out)
    if not url:
        payload = header(TOOL, None)
        payload["error"] = "informe --url ou --path"
        payload["results"] = []
        return payload

    viewports, bad = parse_viewports(args.viewports)
    payload = header(TOOL, label, viewport=",".join("%dx%d" % v for v in viewports))
    payload["out_dir"] = out_dir
    payload["warnings"] = (["viewport ignorado (formato invalido): %s" % b for b in bad])
    payload["results"] = []

    sync_playwright, err = import_playwright()
    if err:
        payload["error"] = err
        return payload

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        except Exception as exc:
            payload["error"] = ("nao foi possivel iniciar o Chromium (%s). "
                                "Rode scripts/setup.sh." % exc)
            return payload
        try:
            for (w, h) in viewports:
                payload["results"].append(
                    capture_one(browser, url, label, w, h, out_dir, args.timeout))
        finally:
            try:
                browser.close()
            except Exception:
                pass

    # console.json e network.json separados: o relatorio referencia direto.
    try:
        import json
        with open(os.path.join(out_dir, "console.json"), "w", encoding="utf-8") as fh:
            json.dump({"tool": TOOL, "url": label, "by_viewport": {
                r["viewport"]: {"console": r["console"], "page_errors": r["page_errors"]}
                for r in payload["results"]}}, fh, ensure_ascii=False, indent=2)
        with open(os.path.join(out_dir, "network.json"), "w", encoding="utf-8") as fh:
            json.dump({"tool": TOOL, "url": label, "by_viewport": {
                r["viewport"]: {"requests": r["network"], "summary": r["network_summary"]}
                for r in payload["results"]}}, fh, ensure_ascii=False, indent=2)
    except Exception as exc:
        payload["warnings"].append("nao foi possivel gravar console/network: %s" % exc)

    ok = [r for r in payload["results"] if not r["error"]]
    payload["summary"] = {
        "viewports_capturados": len(ok),
        "viewports_com_erro": len(payload["results"]) - len(ok),
        "erros_de_console_total": sum(
            len([c for c in r["console"] if c["type"] == "error"]) + len(r["page_errors"])
            for r in payload["results"]),
        "midia_sem_dimensao": {
            r["viewport"]: len(((r.get("layout_risks") or {}).get("midia_sem_dimensao") or []))
            for r in payload["results"]},
        "estouro_horizontal": {
            r["viewport"]: ((r.get("layout_risks") or {}).get("estouro_horizontal") or {}).get("estoura")
            for r in payload["results"]},
        "alvos_de_toque_pequenos": {
            r["viewport"]: len((((r.get("layout_risks") or {}).get("alvos_de_toque_pequenos") or {})
                                .get("itens") or []))
            for r in payload["results"]},
    }
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="capture.py",
        description="Captura screenshots (full-page e above-the-fold), DOM, console e rede "
                    "em multiplos viewports. Sempre espera networkidle antes de inspecionar.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/capture.py --url https://exemplo.com.br --out ./ux-audit\n"
               "  python3 scripts/capture.py --path ./index.html --viewports 360x800,1440x900\n")
    return add_target_args(ap)


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "capture.json"))
