"""
Utilidades compartilhadas pelos scripts da skill yu-ux-web-expert.

Não é um script executável — é o módulo que garante o CONTRATO comum:
  - cabeçalho JSON estável (tool, version, url, viewport, timestamp)
  - falha nunca estoura para o modelo: sempre sai JSON válido no stdout
  - --out DIR sempre honrado
  - caminhos sempre com "/"

Se este arquivo não puder ser importado, cada script tem fallback próprio e
ainda assim emite JSON com "error" — nenhuma quebra silenciosa.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import sys
import traceback

# Windows abre o stdout em cp1252; qualquer "×", "→" ou acento no JSON
# estourava UnicodeEncodeError DEPOIS de o arquivo já estar gravado e o
# modelo recebia traceback em vez de resultado. Forçar UTF-8 aqui vale para
# todos os scripts sem depender de PYTHONUTF8 no ambiente.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    except (AttributeError, ValueError):
        pass

# Versão do CONJUNTO de scripts. Sobe junto quando o contrato de saída muda,
# para que relatórios antigos continuem interpretáveis.
SCRIPTS_VERSION = "1.0.0"

# Viewports padrão da skill:
#   360x800  -> Android de entrada, a base instalada dominante no Brasil
#   768x1024 -> tablet / breakpoint intermediário onde layouts costumam quebrar
#   1440x900 -> notebook comum, o que o cliente usa para "aprovar" a página
DEFAULT_VIEWPORTS = "360x800,768x1024,1440x900"

# 30s cobre carga em rede móvel simulada sem travar a auditoria inteira
# quando a página nunca fica ociosa (SPA com polling, chat widget, etc.).
DEFAULT_TIMEOUT_MS = 30000

# networkidle nem sempre chega (analytics com long-polling). Depois desse
# tempo seguimos com o que temos e registramos em "warnings" — auditoria
# parcial vale mais que auditoria nenhuma.
NETWORKIDLE_TIMEOUT_MS = 15000


def now_iso() -> str:
    """Timestamp UTC ISO-8601 — comparável entre execuções e máquinas."""
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def posix(p) -> str:
    """Todo caminho no JSON sai com '/' — regra de arquitetura da skill."""
    return str(pathlib.PurePath(str(p)).as_posix())


def header(tool: str, url, viewport=None, **extra) -> dict:
    """Cabeçalho obrigatório do contrato. Sempre os mesmos nomes de campo."""
    h = {
        "tool": tool,
        "version": SCRIPTS_VERSION,
        "url": url,
        "viewport": viewport,
        "timestamp": now_iso(),
    }
    h.update(extra)
    return h


def ensure_out(out_dir: str) -> str:
    """Cria o diretório de artefatos. Falha aqui vira aviso, não exceção."""
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception:
        pass
    return posix(out_dir)


def parse_viewports(spec: str):
    """'360x800,1440x900' -> [(360,800),(1440,900)]. Entrada inválida é ignorada
    com aviso em vez de derrubar o script."""
    out, bad = [], []
    for token in (spec or "").split(","):
        token = token.strip().lower()
        if not token:
            continue
        try:
            w, h = token.split("x")
            out.append((int(w), int(h)))
        except Exception:
            bad.append(token)
    if not out:
        out = [(360, 800), (768, 1024), (1440, 900)]
    return out, bad


def target_from_args(args):
    """Resolve --url ou --path em (url_para_o_browser, rotulo_legivel)."""
    if getattr(args, "url", None):
        return args.url, args.url
    if getattr(args, "path", None):
        p = pathlib.Path(args.path).expanduser().resolve()
        return p.as_uri(), posix(p)
    return None, None


def add_target_args(ap: argparse.ArgumentParser, viewports: bool = True):
    """Argumentos comuns a todos os scripts que abrem uma página."""
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--url", help="URL da pagina a auditar (http/https).")
    g.add_argument("--path", help="Caminho de arquivo HTML local a auditar.")
    ap.add_argument("--out", default="./ux-audit",
                    help="Diretorio onde os artefatos sao persistidos (padrao: ./ux-audit).")
    if viewports:
        ap.add_argument("--viewports", default=DEFAULT_VIEWPORTS,
                        help="Lista LARGURAxALTURA separada por virgula (padrao: %s)." % DEFAULT_VIEWPORTS)
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MS,
                    help="Timeout de navegacao em ms (padrao: %d)." % DEFAULT_TIMEOUT_MS)
    return ap


def emit(payload: dict, out_dir: str = None, filename: str = None) -> None:
    """Imprime o JSON no stdout e, quando pedido, persiste em disco.
    Se a serialização falhar, degrada para uma versão textual — o modelo
    nunca recebe stdout vazio."""
    try:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    except Exception as exc:
        text = json.dumps({
            "tool": payload.get("tool", "unknown") if isinstance(payload, dict) else "unknown",
            "version": SCRIPTS_VERSION,
            "timestamp": now_iso(),
            "error": "falha ao serializar resultado: %s" % exc,
        }, ensure_ascii=False, indent=2)
    if out_dir and filename:
        try:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, filename), "w", encoding="utf-8") as fh:
                fh.write(text)
        except Exception:
            pass  # persistência é bônus; stdout é o contrato
    sys.stdout.write(text + "\n")


def run_safe(tool: str, main_fn, args, out_dir: str, filename: str):
    """Executa main_fn e garante que QUALQUER exceção vire JSON com 'error'.
    Um script que estoura trava a auditoria inteira — isso é inaceitável."""
    try:
        payload = main_fn(args)
    except Exception as exc:
        payload = header(tool, getattr(args, "url", None) or getattr(args, "path", None))
        payload["error"] = "%s: %s" % (type(exc).__name__, exc)
        payload["traceback"] = traceback.format_exc(limit=6).splitlines()[-6:]
        payload["results"] = []
    emit(payload, out_dir, filename)
    # Sempre exit 0: o erro viaja DENTRO do JSON, não no código de saída.
    return 0


def import_playwright():
    """Importa o Playwright sincrono. Devolve (modulo, erro_legivel)."""
    try:
        from playwright.sync_api import sync_playwright  # noqa
        return sync_playwright, None
    except Exception as exc:
        return None, ("playwright indisponivel (%s). Rode scripts/setup.sh." % exc)


def new_page(browser, width, height, dark=False, extra_ctx=None):
    """Contexto + página com viewport e device scale coerentes com mobile real."""
    opts = {
        "viewport": {"width": width, "height": height},
        # DPR 2 em telas estreitas: é o que o Android de entrada entrega, e
        # muda quais imagens o srcset escolhe.
        "device_scale_factor": 2 if width <= 480 else 1,
        "is_mobile": width <= 480,
        "has_touch": width <= 480,
        "locale": "pt-BR",
        "color_scheme": "dark" if dark else "light",
    }
    if extra_ctx:
        opts.update(extra_ctx)
    ctx = browser.new_context(**opts)
    return ctx, ctx.new_page()


def goto_settled(page, url, timeout_ms=DEFAULT_TIMEOUT_MS):
    """Navega e ESPERA A REDE ficar ociosa antes de qualquer inspeção.

    Isto não é detalhe de estilo: sem wait_for_load_state('networkidle'), o DOM
    de app dinâmico (React/Next hidratando, conteúdo vindo de fetch) é lido
    ainda incompleto, e a auditoria reporta problemas que não existem — ou
    perde os que existem. Todo script desta skill que inspeciona a página passa
    por aqui.

    Devolve lista de avisos (nunca levanta por causa do networkidle).
    """
    warnings = []
    page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    try:
        page.wait_for_load_state("networkidle", timeout=NETWORKIDLE_TIMEOUT_MS)
    except Exception:
        warnings.append(
            "networkidle nao foi atingido em %dms; a pagina pode ter conexao "
            "persistente (analytics, chat, websocket). Inspecao seguiu com o "
            "DOM disponivel." % NETWORKIDLE_TIMEOUT_MS)
    try:
        # 400ms cobre a última pintura pós-hidratação sem custo relevante.
        page.wait_for_timeout(400)
    except Exception:
        pass
    return warnings
