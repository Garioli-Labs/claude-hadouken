# Auditoria de interface — {{ALVO}} — {{DATA}}

<!--
  Template preenchido por scripts/build_report.py.
  Os campos {{...}} que o script consegue preencher com MEDIÇÃO já vêm preenchidos.
  Os blocos marcados com JULGAMENTO exigem o modelo. O script não inventa achado:
  ele organiza o que os JSONs contêm e deixa o resto explicitamente vazio.
-->

## Veredito

<!-- JULGAMENTO — 3 a 5 frases. O maior risco, a maior oportunidade e o julgamento
     honesto de quão longe isto está de "profissional". Sem suavizar. Nenhum número
     aqui que não esteja medido nos dados consolidados. -->
{{VEREDITO}}

## Placar

| Eixo | Nota /10 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Usabilidade e heurísticas | {{NOTA_USABILIDADE}} | | | | |
| Acessibilidade | {{NOTA_ACESSIBILIDADE}} | | | | |
| Performance | {{NOTA_PERFORMANCE}} | | | | |
| Hierarquia visual e sistema | {{NOTA_VISUAL}} | | | | |
| Conteúdo e microcopy | {{NOTA_CONTEUDO}} | | | | |
| Conversão | {{NOTA_CONVERSAO}} | | | | |

<!-- JULGAMENTO — as notas e a distribuição por severidade são do modelo.
     Regra anti-inflação: se mais de 5 achados forem P0, reavalie. Declare abaixo
     quantos achados existem por nível. -->
**Distribuição:** {{DISTRIBUICAO_SEVERIDADE}}

## Por onde começar

<!-- JULGAMENTO — ordem por (impacto × alcance) / esforço, NÃO por severidade pura.
     Máximo 7 itens, cada um com estimativa de esforço. Se esta lista sair igual à
     ordem de severidade, provavelmente o custo/benefício não foi pensado. -->
{{POR_ONDE_COMECAR}}

## Achados

<!-- Cada achado precisa dos CINCO elementos, ou não entra:
     1. localização  2. medição  3. impacto no usuário  4. correção concreta
     5. comando de re-verificação.
     Quando o achado envolve erro do usuário (formulário, acao destrutiva, envio,
     pagamento, publicacao), anote tambem o NIVEL DE DEFESA atual e o nivel que a
     correcao alcanca — ex: 'P1 · defesa atual nivel 0 · correcao leva a nivel 1'.
     Nivel 1 Controle · 2 Aviso · 3 Deteccao · 0 Depende de leitura.
     Os fatos medidos disponíveis estão no anexo "Medições brutas" e em
     dados-consolidados.json. Escreva os achados a partir dali. -->
{{ACHADOS}}

## O que está bom

<!-- JULGAMENTO — crédito explícito e específico. Relatório só-negativo é descartado
     inteiro por quem recebe, e leva junto o feedback que importava. -->
{{O_QUE_ESTA_BOM}}

## O que não pôde ser medido

{{NAO_MEDIDO}}

## Reprodutibilidade

| Ferramenta | Versão | Viewports | Rede/CPU | Timestamp |
|---|---|---|---|---|
{{TABELA_REPRODUTIBILIDADE}}

**Evidências em arquivo:** {{EVIDENCIAS}}

---

## Anexo — Medições brutas

<!-- Preenchido pelo script. É a matéria-prima dos achados, não os achados. -->

### Acessibilidade automatizada (axe-core)
{{RESUMO_AXE}}

### Contraste
{{RESUMO_CONTRASTE}}

### Teclado
{{RESUMO_TECLADO}}

### Estados de componentes
{{RESUMO_ESTADOS}}

### Performance
{{RESUMO_CWV}}

### Inventário de tokens
{{RESUMO_TOKENS}}

### Console e rede
{{RESUMO_CAPTURA}}
