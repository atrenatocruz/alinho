---
name: entregar
description: Fechar uma task — valida o build, faz commit com a referência do cartão, push para dev, move o cartão para Code Review e avisa o #dev-updates que está pronto a rever. Usa quando o utilizador diz que a task está pronta, "podes entregar", "fecha isto", ou quando o trabalho está acabado e falta a papelada.
---

# /entregar — fechar a task e pedir review

Substitui o "no fim actualiza o Trello e o Slack" por passos que acontecem sempre e na mesma ordem.
Nunca promove para `main` — isso é decisão do Renato.

## Passos

1. **Identificar o cartão** (branch, `git log`, ou perguntar). Precisas do número curto (`#51`)
   e do link — vão para a mensagem de commit e para o Slack.

2. **Portão de qualidade.** Este repo não tem testes; o build é o portão:
   ```
   npm run build
   ```
   Se falhar, **para aqui** e arranja. Não entregues com o build vermelho.
   Se a mudança tocar em dados, verifica também: há migração nova em `supabase/`? Se sim, ela
   **não está a correr** só por existir no repo — diz isso explicitamente no cartão e no Slack.

3. **Commit** na branch de trabalho, com a referência que o repo já usa:
   ```
   <tipo>: <descrição em pt-PT> (Trello #<n>)
   ```

4. **Push para `dev`** (merge da branch para `dev`, ou push da branch e merge — segue o que o
   utilizador costuma fazer). **Nunca** `git push origin main`, em nenhuma variante.

5. **Cartão** → mover para `Code Review` e comentar:
   ```
   ✅ Dev feito — à espera de review
   O que mudou: <resumo em termos de desenvolvimento>
   Commits: <shas curtos>
   Migração a correr no Supabase: <sim, ficheiro X / não>
   Testar assim: <passos para quem revê>
   ```

6. **Slack `#dev-updates`**:
   ```
   ✅ #<n> <nome do cartão> — dev feito, à espera de review
   <link do cartão>
   <resumo em 1-2 linhas>
   Migração pendente: <sim/não>
   ```
   Se houver migração pendente, diz na mensagem que **não pode ir para `main`** antes de a correr.

7. Diz ao utilizador o que ficou por fazer da parte dele: nada, ou "o Renato tem de promover
   dev→main" / "a migração X tem de ser corrida no Supabase".

## Qual o board

`.claude/team/board.json` pode ter vários boards, cada um com o seu prefixo de commit.
Usa `defaultBoard`, a não ser que o utilizador nomeie outro ou que os ficheiros tocados
correspondam a `paths` de outro board. O prefixo do board escolhido é o que vai na mensagem de
commit — `(Trello #51)` para o board da app.
