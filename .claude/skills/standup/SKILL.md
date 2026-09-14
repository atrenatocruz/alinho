---
name: standup
description: Ponto de situação de toda a equipa — cruza o board Alinho com o git e o #dev-updates e produz o resumo do dia, opcionalmente publicado no Notion e no Slack. Usa quando o utilizador pede um standup, um resumo do dia ou da semana, "em que ponto está tudo", ou quer saber o que está encalhado.
---

# /standup — estado de tudo, num sítio

## Passos

1. **Board.** Lê `In Development`, `Code Review`, `Dev Done`, `Testing - QA`. Para cada cartão:
   número, nome, dono, dias desde a última actividade.

2. **Git.**
   ```
   git fetch origin
   git log origin/main..origin/dev --oneline
   ```
   Isto é a fila de promoção: o que está em `dev` e ainda não serve `alinho.pt`.

3. **Slack.** Últimas 24h (ou desde o último standup) do `#dev-updates` e do `#bugs`.

4. **Cruzar e apontar as discrepâncias** — é aqui que está o valor:
   - cartão em `In Development` sem actividade há ≥3 dias → encalhado;
   - cartão em `Code Review` há ≥2 dias → ninguém está a rever;
   - commit em `dev` com `(Trello #N)` cujo cartão ainda está em `Selected/Ready` ou `Backlog`
     → o board está atrasado em relação ao código;
   - cartão em `Dev Done` aprovado + migração pendente → bloqueado, e diz em quem;
   - cartão em `Testing - QA` cujos commits não estão em `origin/main` → falso positivo.

5. **Saída**, nesta forma:
   ```
   ## Em curso        <cartão — dono — há quantos dias>
   ## À espera de review   <cartão — quem fez — há quantos dias>
   ## À espera de promoção dev→main   <cartão — bloqueio, se houver>
   ## Encalhado       <cartão — porquê>
   ## Board desalinhado do código   <o que corrigir>
   ```

6. **Publicar** só se o utilizador pedir: página no Notion (uma por dia, dentro de uma página-mãe
   "Estado do trabalho — Alinho") e/ou resumo no `#dev-updates`. Por omissão, responde só no chat.

Não inventes progresso. Se um cartão não tiver sinal nenhum, o estado dele é "sem sinal".
