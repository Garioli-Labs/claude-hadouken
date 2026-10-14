#!/usr/bin/env python3
"""
measure_cwv.py — Core Web Vitals de laboratorio, em dois perfis.

Roda o Lighthouse duas vezes:
  1) "default"  — throttling padrao do Lighthouse (1.638 Kbps / 150ms RTT / CPU 4x).
                  E o numero que o cliente ve no PageSpeed Insights. Nao fuja dele.
  2) "brasil"   — CPU 6x e RTT 250ms. Representa Android de entrada em rede movel
                  fora do eixo SP, que e o publico real das paginas auditadas.
                  Fonte do parametro: pesquisa/03 §9.3.

INP NAO E MEDIVEL EM LABORATORIO. O JSON declara isso explicitamente em
"inp": {"measured": false, ...}. TBT entra como proxy imperfeito de
responsividade, com a ressalva junto. Inventar um INP seria pior que omitir.

Saida: cwv.json (e stdout) com LCP e suas subpartes, CLS, TBT, FCP, TTFB,
Speed Index e peso por tipo de recurso, para cada perfil.

Exemplos:
  python3 scripts/measure_cwv.py --url https://exemplo.com.br --out ./ux-audit
  python3 scripts/measure_cwv.py --url https://exemplo.com.br --profiles default
  python3 scripts/measure_cwv.py --url https://exemplo.com.br --form-factor desktop
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    ensure_out, header, posix, run_safe,
)

TOOL = "measure_cwv"

# Throttling padrao do Lighthouse (mobile). Fonte:
# https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md
LH_DEFAULT_RTT_MS = 150
LH_DEFAULT_THROUGHPUT_KBPS = 1638.4   # 1,6 Mbps
LH_DEFAULT_CPU = 4

# Perfil Brasil: CPU 6x porque o dispositivo mediano brasileiro penaliza mais
# em CPU do que em banda, e RTT 250ms (faixa 200-300ms) para regioes distantes
# dos PoPs de CDN concentrados em Sao Paulo. Banda mantida no padrao para que a
# unica variavel entre os dois perfis seja o que muda de fato no Brasil.
BR_RTT_MS = 250
BR_CPU = 6

# 240s por execucao: Lighthouse com CPU 6x em pagina pesada passa de 2 minutos.
# Abaixo disso, o run e cortado no meio e o resultado seria enganoso.
LH_TIMEOUT_S = 240

# Limiares oficiais (p75 de campo). Em laboratorio servem so como referencia
# de faixa — o veredito real vem do CrUX. Fonte: https://web.dev/vitals/
THRESHOLDS = {
    "lcp_ms": {"good": 2500, "needs_improvement": 4000},
    "cls":    {"good": 0.1,  "needs_improvement": 0.25},
    "inp_ms": {"good": 200,  "needs_improvement": 500},
    "tbt_ms": {"good": 200,  "needs_improvement": 600},   # TBT e metrica de lab, nao CWV
    "fcp_ms": {"good": 1800, "needs_improvement": 3000},
    "ttfb_ms": {"good": 800, "needs_improvement": 1800},
}


def classify(metric_key, value):
    t = THRESHOLDS.get(metric_key)
    if t is None or value is None:
        return None
    if value <= t["good"]:
        return "bom"
    if value <= t["needs_improvement"]:
        return "precisa melhorar"
    return "ruim"


def find_lighthouse():
    """Localiza o CLI do Lighthouse: vendor/ da skill primeiro, depois o PATH."""
    here = pathlib.Path(__file__).resolve().parent
    for c in [here.parent / "vendor" / "node_modules" / "lighthouse" / "cli" / "index.js",
              here.parent / "node_modules" / "lighthouse" / "cli" / "index.js"]:
        if c.exists():
            return ["node", posix(c)]
    for base in [pathlib.Path.cwd()] + list(pathlib.Path.cwd().parents)[:4]:
        c = base / "node_modules" / "lighthouse" / "cli" / "index.js"
        if c.exists():
            return ["node", posix(c)]
    exe = shutil.which("lighthouse")
    if exe:
        return [exe]
    return None


def find_chrome():
    """Chrome para o Lighthouse: reaproveita o Chromium que o Playwright baixou."""
    if os.environ.get("CHROME_PATH") and os.path.exists(os.environ["CHROME_PATH"]):
        return os.environ["CHROME_PATH"]
    # O caminho do Chromium sai de um processo filho de proposito: subir o
    # driver do Playwright so para ler executable_path deixava, no shutdown do
    # interpretador, um "Task was destroyed / TargetClosedError" no stderr do
    # processo principal — ruido que parece falha DEPOIS de a medicao ter dado
    # certo. No filho esse ruido morre junto com o processo.
    try:
        probe = (
            "from playwright.sync_api import sync_playwright\n"
            "with sync_playwright() as p:\n"
            "    print(p.chromium.executable_path)\n"
        )
        r = subprocess.run([sys.executable, "-c", probe],
                           capture_output=True, text=True, timeout=60)
        path = (r.stdout or "").strip().splitlines()[-1] if r.stdout.strip() else ""
        if path and os.path.exists(path):
            return path
    except Exception:
        pass
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        exe = shutil.which(name)
        if exe:
            return exe
    return None


def audit_value(lhr, audit_id, field="numericValue"):
    try:
        a = lhr["audits"][audit_id]
        v = a.get(field)
        return v
    except Exception:
        return None


def _walk_items(node, depth=0):
    """Percorre a arvore de 'details' do Lighthouse. A estrutura muda entre
    versoes (tabela solta, lista de tabelas, insight); percorrer em vez de
    indexar posicao evita quebrar a cada upgrade do Lighthouse."""
    if depth > 6 or node is None:
        return
    if isinstance(node, list):
        for n in node:
            yield from _walk_items(n, depth + 1)
        return
    if isinstance(node, dict):
        yield node
        for key in ("items", "details", "value"):
            if key in node:
                yield from _walk_items(node[key], depth + 1)


def lcp_subparts(lhr):
    """Subpartes do LCP: TTFB, atraso de descoberta do recurso, tempo de carga
    do recurso e atraso de renderizacao. E o que diz ONDE atacar — otimizar a
    subparte errada nao move o LCP.

    Aceita o audit novo ('lcp-breakdown-insight', Lighthouse 12+) e o antigo
    ('largest-contentful-paint-element'), porque o id mudou entre versoes."""
    out = {"available": False, "phases": {}, "element": None, "source_audit": None,
           "note": "Quando o LCP e texto, as fases de carga de recurso sao 0 por definicao."}
    for audit_id in ("lcp-breakdown-insight", "largest-contentful-paint-element"):
        a = (lhr.get("audits") or {}).get(audit_id)
        if not a:
            continue
        for row in _walk_items(a.get("details")):
            label = row.get("subpart") or row.get("phase") or row.get("label")
            dur = row.get("duration", row.get("timing"))
            if label and isinstance(dur, (int, float)):
                out["phases"][str(label)] = round(float(dur), 1)
                out["available"] = True
                out["source_audit"] = audit_id
            if row.get("type") == "node" or (row.get("selector") and row.get("snippet")):
                if out["element"] is None:
                    out["element"] = {
                        "selector": row.get("selector"),
                        "snippet": (row.get("snippet") or "")[:240],
                        "nodeLabel": (row.get("nodeLabel") or "")[:160],
                    }
            node = row.get("node")
            if isinstance(node, dict) and out["element"] is None:
                out["element"] = {
                    "selector": node.get("selector"),
                    "snippet": (node.get("snippet") or "")[:240],
                    "nodeLabel": (node.get("nodeLabel") or "")[:160],
                }
        if out["available"]:
            break
    return out


def cls_culprits(lhr):
    """Elementos que causaram deslocamento de layout. O id do audit mudou entre
    versoes do Lighthouse; tentamos os tres conhecidos."""
    out, src = [], None
    for audit_id in ("layout-shift-elements", "layout-shifts", "cls-culprits-insight"):
        a = (lhr.get("audits") or {}).get(audit_id)
        if not a:
            continue
        for row in _walk_items(a.get("details")):
            node = row.get("node") if isinstance(row.get("node"), dict) else None
            sel = (node or {}).get("selector") or (
                row.get("selector") if row.get("type") == "node" else None)
            score = row.get("score", row.get("value"))
            if sel:
                out.append({"node": sel, "score": score,
                            "snippet": ((node or row).get("snippet") or "")[:160]})
                src = audit_id
        if out:
            break
    # 8 culpados bastam: acima disso o problema e sistemico, nao pontual.
    return out[:8], src


def resource_weight(lhr):
    """Peso por tipo de recurso — o orcamento de bytes vive aqui."""
    out = {"by_type": {}, "total_transfer_bytes": None, "total_requests": None}
    try:
        items = lhr["audits"]["resource-summary"]["details"]["items"]
        for it in items:
            key = it.get("resourceType") or it.get("label") or "other"
            entry = {"requests": it.get("requestCount"),
                     "transfer_bytes": it.get("transferSize")}
            if key == "total":
                out["total_transfer_bytes"] = it.get("transferSize")
                out["total_requests"] = it.get("requestCount")
            else:
                out["by_type"][key] = entry
    except Exception:
        pass
    return out


def top_opportunities(lhr, limit=8):
    """Oportunidades com economia estimada. 8 e o que cabe numa secao de
    'por onde comecar' sem virar lista de compras."""
    out = []
    try:
        for aid, a in lhr.get("audits", {}).items():
            details = a.get("details") or {}
            saving = details.get("overallSavingsMs")
            bytes_saving = details.get("overallSavingsBytes")
            if a.get("score") is not None and a.get("score") < 1 and (saving or bytes_saving):
                out.append({"audit": aid, "title": a.get("title"),
                            "savings_ms": saving, "savings_bytes": bytes_saving,
                            "score": a.get("score")})
    except Exception:
        pass
    out.sort(key=lambda x: (-(x.get("savings_ms") or 0), -(x.get("savings_bytes") or 0)))
    return out[:limit]


def failing_diagnostics(lhr, limit=12):
    """Audits que reprovam SEM economia estimada em ms ou bytes — imagens sem
    dimensao, cache mal configurado, DOM excessivo. Ficam de fora de
    'opportunities' justamente por nao terem numero de economia, e sao onde
    moram varios problemas estruturais. 12 cabe num anexo."""
    out = []
    try:
        for aid, a in (lhr.get("audits") or {}).items():
            score = a.get("score")
            det = a.get("details") or {}
            if score is not None and score < 1 and not (
                    det.get("overallSavingsMs") or det.get("overallSavingsBytes")):
                out.append({"audit": aid, "title": a.get("title"), "score": score,
                            "itens": len((det.get("items") or []))})
    except Exception:
        pass
    out.sort(key=lambda x: (x["score"], -x["itens"]))
    return out[:limit]


def extract(lhr):
    lcp = audit_value(lhr, "largest-contentful-paint")
    cls = audit_value(lhr, "cumulative-layout-shift")
    tbt = audit_value(lhr, "total-blocking-time")
    fcp = audit_value(lhr, "first-contentful-paint")
    si = audit_value(lhr, "speed-index")
    ttfb = audit_value(lhr, "server-response-time")
    tti = audit_value(lhr, "interactive")
    culprits, culprits_src = cls_culprits(lhr)

    return {
        "lcp": {"value_ms": lcp, "rating": classify("lcp_ms", lcp),
                "subparts": lcp_subparts(lhr)},
        "cls": {"value": cls, "rating": classify("cls", cls),
                "shift_elements": culprits, "source_audit": culprits_src},
        "tbt": {"value_ms": tbt, "rating": classify("tbt_ms", tbt),
                "note": "TBT e metrica de laboratorio; correlaciona com responsividade "
                        "mas NAO e INP."},
        "fcp": {"value_ms": fcp, "rating": classify("fcp_ms", fcp)},
        "ttfb": {"value_ms": ttfb, "rating": classify("ttfb_ms", ttfb),
                 "source_audit": "server-response-time"},
        "speed_index": {"value_ms": si},
        "tti": {"value_ms": tti},
        "inp": {
            "measured": False,
            "value_ms": None,
            "reason": ("INP e uma metrica de CAMPO: depende de interacoes reais do usuario "
                       "ao longo da visita. Laboratorio nao gera essas interacoes, entao "
                       "nenhum valor de INP e reportado aqui. Para INP real, use CrUX / "
                       "PageSpeed Insights (dados de campo) ou RUM proprio. TBT em "
                       "'tbt' e o proxy de laboratorio disponivel — proxy, nao substituto."),
            "proxy": {"metric": "TBT", "value_ms": tbt, "rating": classify("tbt_ms", tbt)},
            "field_source_recomendada": "https://developer.chrome.com/docs/crux/",
        },
        "scores": {
            "performance": ((lhr.get("categories", {}).get("performance") or {}).get("score")),
            "accessibility": ((lhr.get("categories", {}).get("accessibility") or {}).get("score")),
            "best_practices": ((lhr.get("categories", {}).get("best-practices") or {}).get("score")),
            "seo": ((lhr.get("categories", {}).get("seo") or {}).get("score")),
            "note": "Score do Lighthouse e um indice ponderado de laboratorio. "
                    "100 no Lighthouse nao significa site rapido para o usuario real.",
        },
        "resource_weight": resource_weight(lhr),
        "opportunities": top_opportunities(lhr),
        "diagnosticos_reprovados": failing_diagnostics(lhr),
        "environment": {
            "lighthouse_version": lhr.get("lighthouseVersion"),
            "user_agent": lhr.get("userAgent"),
            "fetch_time": lhr.get("fetchTime"),
            "throttling": (lhr.get("configSettings") or {}).get("throttling"),
            "form_factor": (lhr.get("configSettings") or {}).get("formFactor"),
        },
        "runtime_error": lhr.get("runtimeError"),
    }


def run_profile(lh_cmd, chrome_path, url, name, rtt, cpu, throughput, form_factor,
                out_dir, categories):
    prof = {"profile": name,
            "throttling": {"rttMs": rtt, "throughputKbps": throughput,
                           "cpuSlowdownMultiplier": cpu, "method": "simulate"},
            "form_factor": form_factor, "metrics": None, "error": None,
            "report_json": None}
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".json", prefix="lh-%s-" % name)
        os.close(fd)
        cmd = list(lh_cmd) + [
            url,
            "--output=json", "--output-path=%s" % tmp,
            "--quiet", "--no-enable-error-reporting",
            "--only-categories=%s" % categories,
            "--form-factor=%s" % form_factor,
            # simulate: throttling em nivel de pacote, recomendado pela doc do
            # Lighthouse por ter menor variancia que o modo devtools.
            "--throttling-method=simulate",
            "--throttling.rttMs=%d" % rtt,
            "--throttling.throughputKbps=%s" % throughput,
            "--throttling.cpuSlowdownMultiplier=%d" % cpu,
            # requestLatencyMs=0 deixa o simulador derivar a latencia do rttMs
            # em vez de somar duas latencias.
            "--throttling.requestLatencyMs=0",
            "--throttling.downloadThroughputKbps=0",
            "--throttling.uploadThroughputKbps=0",
            "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu",
        ]
        if form_factor == "mobile":
            cmd.append("--screenEmulation.mobile")
        else:
            cmd.append("--screenEmulation.disabled")
        env = dict(os.environ)
        if chrome_path:
            env["CHROME_PATH"] = chrome_path
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=LH_TIMEOUT_S, env=env)
        if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
            prof["error"] = ("Lighthouse nao produziu relatorio (exit %s). stderr: %s"
                             % (p.returncode, (p.stderr or "")[-600:]))
            return prof
        with open(tmp, encoding="utf-8") as fh:
            lhr = json.load(fh)
        dest = posix(os.path.join(out_dir, "lighthouse-%s.json" % name))
        try:
            shutil.copyfile(tmp, dest)
            prof["report_json"] = dest
        except Exception:
            pass
        prof["metrics"] = extract(lhr)
        if prof["metrics"].get("runtime_error"):
            prof["error"] = "Lighthouse runtimeError: %s" % prof["metrics"]["runtime_error"]
    except subprocess.TimeoutExpired:
        prof["error"] = ("Lighthouse excedeu %ds no perfil '%s'. Pagina muito pesada "
                         "ou rede indisponivel." % (LH_TIMEOUT_S, name))
    except Exception as exc:
        prof["error"] = "%s: %s" % (type(exc).__name__, exc)
    finally:
        try:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
    return prof


def main(args):
    url = args.url
    if not url and args.path:
        p = pathlib.Path(args.path).expanduser().resolve()
        url = p.as_uri() if p.exists() else None
    out_dir = ensure_out(args.out)

    payload = header(TOOL, url, viewport=args.form_factor)
    payload["out_dir"] = out_dir
    payload["inp"] = {
        "measured": False,
        "reason": ("INP so existe com interacao real do usuario; laboratorio nao a produz. "
                   "Este script nunca reporta valor de INP. Use CrUX/PageSpeed (campo) ou RUM."),
    }
    payload["profiles"] = []
    payload["thresholds"] = THRESHOLDS

    if not url:
        payload["error"] = "informe --url (ou --path para um arquivo existente)"
        return payload

    lh_cmd = find_lighthouse()
    if not lh_cmd:
        payload["error"] = ("lighthouse nao encontrado. Rode scripts/setup.sh. "
                            "Alternativa manual: PageSpeed Insights.")
        return payload
    chrome_path = find_chrome()
    if not chrome_path:
        payload["warnings"] = ["Chrome/Chromium nao localizado; o Lighthouse vai tentar "
                               "descobrir sozinho e pode falhar. Rode scripts/setup.sh."]
    payload["lighthouse_cmd"] = " ".join(lh_cmd)
    payload["chrome_path"] = chrome_path

    wanted = [s.strip() for s in (args.profiles or "default,brasil").split(",") if s.strip()]
    specs = {
        "default": (LH_DEFAULT_RTT_MS, LH_DEFAULT_CPU, LH_DEFAULT_THROUGHPUT_KBPS),
        "brasil": (BR_RTT_MS, BR_CPU, LH_DEFAULT_THROUGHPUT_KBPS),
    }
    for name in wanted:
        if name not in specs:
            payload.setdefault("warnings", []).append("perfil desconhecido ignorado: %s" % name)
            continue
        rtt, cpu, thr = specs[name]
        payload["profiles"].append(
            run_profile(lh_cmd, chrome_path, url, name, rtt, cpu, thr,
                        args.form_factor, out_dir, args.categories))

    # Comparativo: a distancia entre os perfis e o achado. Se o default passa e
    # o Brasil reprova, o problema e CPU/latencia, nao bytes.
    comp = {}
    for prof in payload["profiles"]:
        m = prof.get("metrics") or {}
        comp[prof["profile"]] = {
            "lcp_ms": (m.get("lcp") or {}).get("value_ms"),
            "lcp_rating": (m.get("lcp") or {}).get("rating"),
            "cls": (m.get("cls") or {}).get("value"),
            "tbt_ms": (m.get("tbt") or {}).get("value_ms"),
            "fcp_ms": (m.get("fcp") or {}).get("value_ms"),
            "ttfb_ms": (m.get("ttfb") or {}).get("value_ms"),
            "performance_score": (m.get("scores") or {}).get("performance"),
            "error": prof.get("error"),
        }
    payload["comparativo"] = comp
    payload["nota_metodologica"] = (
        "Medicao de laboratorio, execucao unica por perfil. Variancia entre execucoes "
        "e real (TBT e o mais instavel). Para decisao de negocio, confirme com dados de "
        "campo (CrUX). Score do Lighthouse nao e CWV.")
    if payload["profiles"] and all(p.get("error") for p in payload["profiles"]):
        payload["error"] = "todos os perfis falharam; ver 'error' de cada perfil."
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="measure_cwv.py",
        description="Roda o Lighthouse em perfil padrao e em perfil Brasil (CPU 6x, RTT 250ms) "
                    "e emite LCP com subpartes, CLS, TBT, FCP, TTFB e peso por recurso. "
                    "Declara explicitamente que INP nao e medivel em laboratorio.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/measure_cwv.py --url https://exemplo.com.br --out ./ux-audit\n"
               "  python3 scripts/measure_cwv.py --url https://exemplo.com.br --profiles brasil\n")
    ap.add_argument("--url", help="URL a medir (http/https).")
    ap.add_argument("--path", help="Arquivo HTML local (file://). Util so para smoke test: "
                                   "sem rede real, TTFB e transferencia nao sao representativos.")
    ap.add_argument("--out", default="./ux-audit", help="Diretorio de artefatos (padrao: ./ux-audit).")
    ap.add_argument("--profiles", default="default,brasil",
                    help="Perfis a rodar: default,brasil (padrao: ambos).")
    ap.add_argument("--form-factor", default="mobile", choices=["mobile", "desktop"],
                    help="Emulacao de dispositivo (padrao: mobile — o publico auditado e mobile).")
    ap.add_argument("--categories", default="performance",
                    help="Categorias do Lighthouse (padrao: performance).")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    sys.exit(run_safe(TOOL, main, a, a.out, "cwv.json"))
