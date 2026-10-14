#!/usr/bin/env python3
"""
build_report.py — consolida os JSONs da auditoria no template do relatorio.

Le o diretorio de artefatos, junta o que cada script mediu e preenche
assets/report-template.md. NAO inventa achado: preenche o que e medicao e deixa
marcador explicito onde o julgamento do modelo precisa entrar.

Regra de ouro deste script: se o dado nao existe no JSON, o campo sai como
"nao medido" — nunca estimado, nunca preenchido por analogia. Um relatorio com
numero inventado e pior que um relatorio incompleto, porque parece medicao.

Entradas esperadas em --in (todas opcionais; o que faltar vira "nao medido"):
  capture.json  axe.json  contrast.json  keyboard.json
  states.json   cwv.json  tokens.json

Saidas:
  <out>/relatorio.md            template preenchido, com marcadores de julgamento
  <out>/dados-consolidados.json indice unico dos fatos medidos (e o stdout)

Exemplos:
  python3 scripts/build_report.py --in ./ux-audit --out ./ux-audit
  python3 scripts/build_report.py --in ./ux-audit --template ./assets/report-template.md
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    SCRIPTS_VERSION, ensure_out, header, posix, run_safe,
)

TOOL = "build_report"

ARTEFATOS = {
    "capture": "capture.json",
    "axe": "axe.json",
    "contrast": "contrast.json",
    "keyboard": "keyboard.json",
    "states": "states.json",
    "cwv": "cwv.json",
    "tokens": "tokens.json",
}

MARCADOR_JULGAMENTO = ("_[PENDENTE — julgamento do modelo. Não preencher com estimativa: "
                       "use apenas o que está medido no anexo.]_")

# 12 linhas por tabela de anexo: o suficiente para o modelo escrever os achados
# sem que o relatorio vire despejo de JSON. O arquivo completo fica no diretorio.
MAX_LINHAS_TABELA = 12


def load(in_dir, name):
    """Carrega um artefato. Arquivo ausente ou corrompido nao derruba o relatorio."""
    p = os.path.join(in_dir, name)
    if not os.path.exists(p):
        return None, "ausente"
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh), None
    except Exception as exc:
        return None, "ilegivel: %s" % exc


def md_table(headers, rows):
    if not rows:
        return "_Sem dados._"
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows[:MAX_LINHAS_TABELA]:
        out.append("| " + " | ".join("" if c is None else str(c).replace("|", "\\|")
                                     for c in r) + " |")
    if len(rows) > MAX_LINHAS_TABELA:
        out.append("")
        out.append("_(%d linhas no total; as demais estão no JSON de origem.)_" % len(rows))
    return "\n".join(out)


def sec_axe(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/run_axe.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    linhas = []
    vistos = {}
    for r in d.get("results", []):
        for v in r.get("violations", []):
            k = v["id"]
            e = vistos.setdefault(k, {"impact": v.get("impact"),
                                      "wcag": ", ".join(v.get("wcag_criteria") or []) or "—",
                                      "nodes": 0, "vps": set(),
                                      "sel": (v.get("nodes") or [{}])[0].get("selector"),
                                      "help": v.get("help")})
            e["nodes"] += v.get("nodes_count") or 0
            e["vps"].add(r["viewport"])
    for k, e in sorted(vistos.items(), key=lambda kv: -(kv[1]["nodes"])):
        linhas.append([k, e["impact"], e["wcag"], e["nodes"],
                       ", ".join(sorted(e["vps"])), (e["sel"] or "")[:60]])
    corpo = md_table(["regra", "impacto", "WCAG", "nós", "viewports", "1º seletor"], linhas)
    resumo = d.get("summary") or {}
    extra = ("\n\n**Violações por viewport:** %s"
             % json.dumps(resumo.get("total_violations_por_viewport") or {}, ensure_ascii=False))
    if resumo.get("violadas_em_apenas_um_viewport"):
        extra += ("\n\n**Só em um viewport** (sinal de reflow ou alvo de toque): %s"
                  % json.dumps(resumo["violadas_em_apenas_um_viewport"], ensure_ascii=False))
    extra += "\n\n%s" % d.get("coverage_note", "")
    return corpo + extra


def sec_contrast(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/contrast_audit.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    linhas = [[p["viewport"], (p["selector"] or "")[:55], p["fg"], p["bg"],
               "%.2f:1" % p["ratio"], "%.1f:1" % p["required"]]
              for p in (d.get("piores_casos") or [])]
    corpo = md_table(["viewport", "seletor", "frente", "fundo", "medido", "mínimo AA"], linhas)
    nd = []
    for vp in d.get("results", []):
        for r in vp.get("results", []):
            if not r.get("determinable"):
                nd.append([vp["viewport"], (r.get("selector") or "")[:55],
                           (r.get("reason") or "")[:90]])
    corpo += "\n\n**Contagens:** %s" % json.dumps(d.get("summary") or {}, ensure_ascii=False)
    if nd:
        corpo += ("\n\n**Não determinável** (fundo em imagem ou gradiente — exige amostragem "
                  "visual, não estime):\n\n" + md_table(["viewport", "seletor", "motivo"], nd))
    return corpo


def sec_keyboard(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/keyboard_walk.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    partes = ["**Resumo por viewport:**\n\n```json\n%s\n```"
              % json.dumps(d.get("summary") or {}, ensure_ascii=False, indent=1)]
    linhas = []
    for r in d.get("results", []):
        for s in r.get("stops", []):
            if s.get("issues"):
                linhas.append([r["viewport"], s["index"], (s["selector"] or "")[:45],
                               (s.get("name") or "")[:25],
                               ", ".join(i["id"] for i in s["issues"]),
                               s.get("png") or ""])
    if linhas:
        partes.append("**Paradas com problema:**\n\n" +
                      md_table(["viewport", "#", "seletor", "nome", "problema", "evidência"], linhas))
    for r in d.get("results", []):
        if r.get("trap"):
            partes.append("**Armadilha de foco:** `%s` (parada %d) — %s"
                          % (r["trap"]["selector"], r["trap"]["parada"], r["trap"]["detalhe"]))
    return "\n\n".join(partes)


def sec_states(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/check_states.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    linhas = [[i.get("scheme"), i.get("id"), (i.get("selector") or "")[:45],
               (i.get("texto") or "")[:22], i.get("criterio"), i.get("impacto")]
              for i in (d.get("issues") or [])]
    return (md_table(["tema", "problema", "seletor", "texto", "critério", "impacto"], linhas)
            + "\n\n**Resumo:** %s" % json.dumps(d.get("summary") or {}, ensure_ascii=False))


def sec_cwv(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/measure_cwv.py`._" % err
    partes = []
    if d.get("error"):
        partes.append("_Erro geral: %s_" % d["error"])
    linhas = []
    for nome, c in (d.get("comparativo") or {}).items():
        linhas.append([nome,
                       "—" if c.get("lcp_ms") is None else "%.0f ms" % c["lcp_ms"],
                       c.get("lcp_rating") or "—",
                       "—" if c.get("cls") is None else "%.3f" % c["cls"],
                       "—" if c.get("tbt_ms") is None else "%.0f ms" % c["tbt_ms"],
                       "—" if c.get("ttfb_ms") is None else "%.0f ms" % c["ttfb_ms"],
                       c.get("error") or ""])
    partes.append(md_table(["perfil", "LCP", "faixa LCP", "CLS", "TBT", "TTFB", "erro"], linhas))
    for prof in (d.get("profiles") or []):
        m = prof.get("metrics") or {}
        sub = (m.get("lcp") or {}).get("subparts") or {}
        if sub.get("available"):
            partes.append("**Subpartes do LCP (%s):** `%s` — elemento: `%s`"
                          % (prof["profile"],
                             json.dumps(sub.get("phases"), ensure_ascii=False),
                             (sub.get("element") or {}).get("selector")))
        rw = (m.get("resource_weight") or {}).get("by_type") or {}
        if rw:
            partes.append("**Peso por recurso (%s):** total %s bytes — `%s`"
                          % (prof["profile"],
                             (m.get("resource_weight") or {}).get("total_transfer_bytes"),
                             json.dumps(rw, ensure_ascii=False)))
    inp = d.get("inp") or {}
    partes.append("**INP:** não medido. %s" % inp.get("reason", ""))
    if d.get("nota_metodologica"):
        partes.append("_%s_" % d["nota_metodologica"])
    return "\n\n".join(partes)


def sec_tokens(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/extract_tokens.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    partes = []
    diag = d.get("diagnostico") or []
    if diag:
        partes.append("**Diagnóstico quantitativo:**\n" + "\n".join("- %s" % x for x in diag))
    else:
        partes.append("_Nenhum indicador de inconsistência acima dos limites de referência._")
    dup = [b for b in ((d.get("cores") or {}).get("baldes") or []) if len(b.get("members", [])) > 1]
    if dup:
        partes.append("**Cores perceptualmente iguais com hex diferente:**\n\n" +
                      md_table(["representante", "membros", "ΔE máx", "ocorrências", "papéis"],
                               [[b["representante"], ", ".join(m["hex"] for m in b["members"]),
                                 b["max_delta_e"], b["count_total"],
                                 json.dumps(b.get("roles"), ensure_ascii=False)] for b in dup]))
    tipo = d.get("tipografia") or {}
    partes.append("**Tipografia:** %d famílias, %d tamanhos, %d pesos. Menor corpo: %s px."
                  % (len(tipo.get("familias") or []), len(tipo.get("tamanhos_px") or []),
                     len(tipo.get("pesos") or []), tipo.get("menor_tamanho_px")))
    esp = d.get("espacamento") or {}
    partes.append("**Espaçamento:** %s valores distintos; fora da escala 4/8: %s."
                  % (esp.get("distintos"),
                     ", ".join("%gpx" % v for v in (esp.get("fora_da_escala") or [])) or "nenhum"))
    if d.get("nota_de_julgamento"):
        partes.append("_%s_" % d["nota_de_julgamento"])
    return "\n\n".join(partes)


def sec_capture(d, err):
    if d is None:
        return "_Não medido (%s). Rode `scripts/capture.py`._" % err
    if d.get("error"):
        return "_Falhou: %s_" % d["error"]
    linhas = []
    for r in d.get("results", []):
        s = r.get("network_summary") or {}
        erros = len([c for c in (r.get("console") or []) if c.get("type") == "error"]) \
            + len(r.get("page_errors") or [])
        linhas.append([r["viewport"], s.get("total_requests"),
                       s.get("total_transfer_bytes"), erros,
                       (r.get("screenshots") or {}).get("full_page", "")])
    corpo = md_table(["viewport", "requisições", "bytes", "erros de console", "screenshot"], linhas)
    msgs = []
    for r in d.get("results", []):
        for c in (r.get("console") or []):
            if c.get("type") in ("error", "warning"):
                msgs.append([r["viewport"], c["type"], (c.get("text") or "")[:100]])
        for e in (r.get("page_errors") or []):
            msgs.append([r["viewport"], "pageerror", (e.get("message") or "")[:100]])
    if msgs:
        corpo += "\n\n**Console:**\n\n" + md_table(["viewport", "tipo", "mensagem"], msgs)

    # Riscos de layout: fatos deterministicos do DOM que o Lighthouse so acusa
    # quando o deslocamento acontece durante a medicao.
    sem_dim, over, alvos = [], [], []
    for r in d.get("results", []):
        lr = r.get("layout_risks") or {}
        for m in (lr.get("midia_sem_dimensao") or []):
            sem_dim.append([r["viewport"], (m.get("selector") or "")[:50], m.get("tag"),
                            "%sx%s" % (m["renderizado"]["w"], m["renderizado"]["h"]),
                            (m.get("src") or "")[:40]])
        eh = lr.get("estouro_horizontal") or {}
        if eh.get("estoura"):
            over.append([r["viewport"], eh.get("scrollWidth"), eh.get("clientWidth"),
                         ", ".join(c["selector"][:35] for c in (eh.get("culpados") or [])[:3])])
        for a in ((lr.get("alvos_de_toque_pequenos") or {}).get("itens") or []):
            alvos.append([r["viewport"], (a.get("selector") or "")[:45],
                          "%sx%s" % (a["w"], a["h"]), (a.get("texto") or "")[:25],
                          "sim" if a.get("inline") else "não"])
    if sem_dim:
        corpo += ("\n\n**Mídia sem dimensão reservada** (causa clássica de CLS em rede "
                  "lenta, mesmo quando o laboratório mede CLS 0):\n\n" +
                  md_table(["viewport", "seletor", "tag", "renderizado", "src"], sem_dim))
    if over:
        corpo += ("\n\n**Estouro horizontal:**\n\n" +
                  md_table(["viewport", "scrollWidth", "clientWidth", "primeiros culpados"], over))
    if alvos:
        corpo += ("\n\n**Alvos de toque abaixo de 24×24 px** (WCAG 2.2 — 2.5.8, AA; o critério "
                  "tem exceções para link em linha de texto e espaçamento equivalente — "
                  "confirme antes de reportar):\n\n" +
                  md_table(["viewport", "seletor", "tamanho", "texto", "inline"], alvos))
    return corpo


def repro_rows(dados):
    rows = []
    cap = dados.get("capture")
    if cap:
        rows.append(["capture.py + Playwright/Chromium", SCRIPTS_VERSION,
                     cap.get("viewport") or "—", "sem throttling (captura)",
                     cap.get("timestamp")])
    axe = dados.get("axe")
    if axe:
        eng = None
        for r in axe.get("results", []):
            eng = (r.get("engine") or {}).get("version") or eng
        rows.append(["run_axe.py + axe-core", eng or "—",
                     axe.get("viewport") or "—", "sem throttling", axe.get("timestamp")])
    con = dados.get("contrast")
    if con:
        rows.append(["contrast_audit.py", SCRIPTS_VERSION, con.get("viewport") or "—",
                     "sem throttling", con.get("timestamp")])
    kb = dados.get("keyboard")
    if kb:
        rows.append(["keyboard_walk.py", SCRIPTS_VERSION, kb.get("viewport") or "—",
                     "sem throttling", kb.get("timestamp")])
    st = dados.get("states")
    if st:
        rows.append(["check_states.py", SCRIPTS_VERSION, st.get("viewport") or "—",
                     "temas claro e escuro", st.get("timestamp")])
    cwv = dados.get("cwv")
    if cwv:
        for prof in (cwv.get("profiles") or []):
            t = prof.get("throttling") or {}
            ver = (((prof.get("metrics") or {}).get("environment") or {})
                   .get("lighthouse_version")) or "—"
            rows.append(["measure_cwv.py + Lighthouse (perfil %s)" % prof.get("profile"), ver,
                         prof.get("form_factor") or "—",
                         "RTT %sms · %s Kbps · CPU %sx" % (t.get("rttMs"),
                                                           t.get("throughputKbps"),
                                                           t.get("cpuSlowdownMultiplier")),
                         cwv.get("timestamp")])
    tk = dados.get("tokens")
    if tk:
        rows.append(["extract_tokens.py", SCRIPTS_VERSION, tk.get("viewport") or "—",
                     "modo: %s" % tk.get("modo"), tk.get("timestamp")])
    return rows


def nao_medido(dados, faltando):
    linhas = [
        "Ferramenta automatizada detecta cerca de **57% dos problemas de acessibilidade por "
        "volume de ocorrências** (Deque, ~13.000 páginas). O restante exige teste manual.",
        "",
        "**Fora do alcance dos scripts, sempre:**",
        "- Se o texto alternativo *descreve* a imagem (o script vê que existe, não se presta).",
        "- Se a ordem de leitura e a hierarquia visual fazem sentido para a tarefa do usuário.",
        "- Se a microcopy é clara, honesta e no tom certo.",
        "- Se o fluxo leva à conversão; se o formulário pede o que precisa pedir.",
        "- Se o conteúdo responde à dúvida real de quem chegou.",
        "- INP real (campo) — laboratório não interage. Ver CrUX/PageSpeed.",
        "- Leitor de tela de verdade (NVDA/VoiceOver): anúncio, foco e contexto.",
        "- Teste com usuário real: avaliação heurística encontra problemas, não descobre desejos.",
    ]
    if faltando:
        linhas += ["", "**Não rodou nesta auditoria:**"] + \
                  ["- `%s` (%s)" % (ARTEFATOS[k], v) for k, v in faltando.items()]
    con = dados.get("contrast")
    if con:
        nd = sum(1 for vp in con.get("results", []) for r in vp.get("results", [])
                 if not r.get("determinable"))
        if nd:
            linhas += ["", "- %d elemento(s) de texto sobre imagem ou gradiente: contraste "
                           "**não determinável** por cor computada. Precisa de amostragem "
                           "visual — não estime." % nd]
    return "\n".join(linhas)


def main(args):
    in_dir = posix(args.input)
    out_dir = ensure_out(args.out)
    dados, faltando = {}, {}
    for chave, arq in ARTEFATOS.items():
        d, err = load(in_dir, arq)
        if d is None:
            faltando[chave] = err
        else:
            dados[chave] = d

    alvo = args.target
    if not alvo:
        for k in ("capture", "axe", "contrast", "cwv", "tokens", "keyboard", "states"):
            if dados.get(k) and dados[k].get("url"):
                alvo = dados[k]["url"]
                break
    alvo = alvo or "(alvo não identificado nos artefatos)"

    payload = header(TOOL, alvo)
    payload["in_dir"] = in_dir
    payload["out_dir"] = out_dir
    payload["artefatos_encontrados"] = sorted(dados.keys())
    payload["artefatos_ausentes"] = faltando

    # Contagens objetivas — o que o modelo usa para escrever, sem recontar.
    fatos = {}
    if dados.get("axe"):
        fatos["axe"] = {
            "violacoes_por_viewport": (dados["axe"].get("summary") or {})
                .get("total_violations_por_viewport"),
            "regras_violadas": (dados["axe"].get("summary") or {}).get("regras_violadas_unicas"),
        }
    if dados.get("contrast"):
        fatos["contraste"] = {"por_viewport": dados["contrast"].get("summary"),
                              "piores": dados["contrast"].get("piores_casos")}
    if dados.get("keyboard"):
        fatos["teclado"] = dados["keyboard"].get("summary")
    if dados.get("states"):
        fatos["estados"] = dados["states"].get("summary")
    if dados.get("cwv"):
        fatos["performance"] = dados["cwv"].get("comparativo")
        fatos["inp"] = dados["cwv"].get("inp")
    if dados.get("tokens"):
        fatos["tokens"] = {"diagnostico": dados["tokens"].get("diagnostico"),
                           "cores": {k: v for k, v in (dados["tokens"].get("cores") or {}).items()
                                     if k in ("distintas", "apos_agrupamento", "neutros")}}
    if dados.get("capture"):
        fatos["captura"] = dados["capture"].get("summary")
    payload["fatos_medidos"] = fatos

    evid = []
    for pat in ("*.png", "*.html", "*.json"):
        evid.extend(posix(p) for p in sorted(glob.glob(os.path.join(in_dir, pat))))
    payload["evidencias"] = evid

    # --- preenche o template ---
    tpl_path = args.template
    if not tpl_path:
        tpl_path = posix(pathlib.Path(__file__).resolve().parent.parent /
                         "assets" / "report-template.md")
    try:
        with open(tpl_path, encoding="utf-8") as fh:
            tpl = fh.read()
    except Exception as exc:
        payload["error"] = ("template nao encontrado em %s (%s). Os fatos medidos estao "
                            "em 'fatos_medidos' e o relatorio pode ser escrito a partir "
                            "deles." % (tpl_path, exc))
        return payload
    payload["template"] = posix(tpl_path)

    subs = {
        "ALVO": alvo,
        "DATA": datetime.date.today().isoformat(),
        "VEREDITO": MARCADOR_JULGAMENTO,
        "NOTA_USABILIDADE": "", "NOTA_ACESSIBILIDADE": "", "NOTA_PERFORMANCE": "",
        "NOTA_VISUAL": "", "NOTA_CONTEUDO": "", "NOTA_CONVERSAO": "",
        "DISTRIBUICAO_SEVERIDADE": MARCADOR_JULGAMENTO,
        "POR_ONDE_COMECAR": MARCADOR_JULGAMENTO,
        "ACHADOS": (MARCADOR_JULGAMENTO + "\n\n<!-- Um achado por bloco, no formato do "
                    "template da skill, com os cinco elementos obrigatórios. "
                    "Fonte dos fatos: o anexo abaixo e dados-consolidados.json. -->"),
        "O_QUE_ESTA_BOM": MARCADOR_JULGAMENTO,
        "NAO_MEDIDO": nao_medido(dados, faltando),
        "TABELA_REPRODUTIBILIDADE": "\n".join(
            "| " + " | ".join("" if c is None else str(c) for c in r) + " |"
            for r in repro_rows(dados)) or "| — | — | — | — | — |",
        "EVIDENCIAS": ("%d arquivo(s) em `%s`" % (len(evid), in_dir)) if evid else "nenhuma",
        "RESUMO_AXE": sec_axe(dados.get("axe"), faltando.get("axe")),
        "RESUMO_CONTRASTE": sec_contrast(dados.get("contrast"), faltando.get("contrast")),
        "RESUMO_TECLADO": sec_keyboard(dados.get("keyboard"), faltando.get("keyboard")),
        "RESUMO_ESTADOS": sec_states(dados.get("states"), faltando.get("states")),
        "RESUMO_CWV": sec_cwv(dados.get("cwv"), faltando.get("cwv")),
        "RESUMO_TOKENS": sec_tokens(dados.get("tokens"), faltando.get("tokens")),
        "RESUMO_CAPTURA": sec_capture(dados.get("capture"), faltando.get("capture")),
    }
    md = tpl
    for k, v in subs.items():
        md = md.replace("{{%s}}" % k, str(v))

    # Placeholder que sobrou = campo do template que este script nao conhece.
    # Melhor apontar do que deixar {{X}} cru no relatorio entregue.
    import re as _re
    sobraram = sorted(set(_re.findall(r"\{\{([A-Z_]+)\}\}", md)))
    for k in sobraram:
        md = md.replace("{{%s}}" % k, MARCADOR_JULGAMENTO)
    payload["placeholders_nao_preenchidos"] = sobraram

    rel_path = posix(os.path.join(out_dir, "relatorio.md"))
    try:
        with open(rel_path, "w", encoding="utf-8") as fh:
            fh.write(md)
        payload["relatorio"] = rel_path
    except Exception as exc:
        payload["error"] = "nao foi possivel gravar o relatorio: %s" % exc

    try:
        with open(os.path.join(out_dir, "dados-consolidados.json"), "w", encoding="utf-8") as fh:
            json.dump({"alvo": alvo, "fatos_medidos": fatos,
                       "artefatos": sorted(dados.keys()),
                       "ausentes": faltando, "evidencias": evid},
                      fh, ensure_ascii=False, indent=2)
        payload["dados_consolidados"] = posix(
            os.path.join(out_dir, "dados-consolidados.json"))
    except Exception as exc:
        payload.setdefault("warnings", []).append(
            "nao foi possivel gravar dados-consolidados.json: %s" % exc)

    payload["proximo_passo"] = (
        "O relatorio esta com os fatos preenchidos e os blocos de julgamento marcados. "
        "Escreva Veredito, Placar, Por onde comecar, Achados e O que esta bom usando "
        "SOMENTE os numeros do anexo. Nao ha nenhum numero estimado neste arquivo.")
    return payload


def build_parser():
    ap = argparse.ArgumentParser(
        prog="build_report.py",
        description="Consolida os JSONs da auditoria e preenche o template do relatorio. "
                    "Nao inventa achado: organiza o medido e marca onde falta julgamento.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemplos:\n"
               "  python3 scripts/build_report.py --in ./ux-audit --out ./ux-audit\n"
               "  python3 scripts/build_report.py --in ./ux-audit --target https://exemplo.com.br\n")
    ap.add_argument("--in", dest="input", default="./ux-audit",
                    help="Diretorio com os JSONs dos outros scripts (padrao: ./ux-audit).")
    ap.add_argument("--out", default=None,
                    help="Diretorio de saida do relatorio (padrao: o mesmo de --in).")
    ap.add_argument("--template", default=None,
                    help="Caminho do template (padrao: assets/report-template.md da skill).")
    ap.add_argument("--target", default=None,
                    help="Rotulo do alvo no titulo. Sem isso, e deduzido dos artefatos.")
    return ap


if __name__ == "__main__":
    a = build_parser().parse_args()
    if not a.out:
        a.out = a.input
    sys.exit(run_safe(TOOL, main, a, a.out, "build_report.json"))
