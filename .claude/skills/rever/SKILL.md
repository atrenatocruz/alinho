---
name: rever
description: Rever o trabalho que está à espera de review no board Alinho — mostra o que espera, revê o código dessa task e registra o veredicto no cartão e no Slack. Usa quando o utilizador pergunta o que há para rever, diz "vamos rever", "faz review do #51", ou quer saber o que está a bloquear a promoção para main.
---

# /rever — fazer a review de uma task da equipa

Esta é a peça que faltava: sem ela, `Dev Done` significa ao mesmo tempo "acabei" e
"alguém tem de olhar", e ninguém sabe qual.

## Passos

1. **Mostrar a fila.** Lê `Code Review` — em todos os boards de `.claude/team/board.json`.
   Para cada cartão: número, nome, quem fez, há quantos dias está parado, link.
   Ordena pelo mais antigo — o que está parado há mais tempo é o que dói mais.

2. **Escolher.** O utilizador escolhe. Se ele disser "o mais antigo", avança com esse.
   Não revejas o teu próprio trabalho sem o dizer em voz alta ao utilizador.

3. **Reunir o diff real** dessa task:
   ```
   git fetch origin
   git log origin/main..origin/dev --oneline | grep -i "Trello #<n>"
   git diff origin/main...origin/dev -- <ficheiros relevantes>
   ```
   Se o cartão não tiver commits identificáveis, diz isso — é um problema de rastreio, não avances
   a fingir que revistes.

4. **Rever.** Corre a skill `/code-review` sobre esse diff. Além do que ela apanha, verifica
   explicitamente o que morde neste repo (ver `CLAUDE.md`):
   - **RLS**: se a mudança toca em dados, o que impede alguém de chamar a tabela/RPC directamente
     por fora da UI? Autorização em condicionais de render não conta.
   - **Migrações**: há ficheiro novo em `supabase/`? Foi corrido no Supabase? Se não, isto **não
     pode** ir para `main`.
   - **Confirmações em acções destrutivas** não removidas.
   - Nada de sinais de confiança inventados no copy (métricas, testemunhos).

5. **Registar o veredicto no cartão**, sempre — é o registo que a equipa lê:
   ```
   🔍 Review por <username> — <data>
   Veredicto: aprovado | aprovado com notas | devolvido
   Achados: <lista, cada um com ficheiro:linha>
   Migração pendente: <sim, ficheiro X / não>
   ```

6. **Encaminhar:**
   - **Devolvido** → mover para `In Development`, reatribuir a quem fez, e mensagem no
     `#dev-updates` a dizer o que tem de mudar.
   - **Aprovado** → mover para `Dev Done` e mensagem no `#dev-updates`:
     `👍 #<n> revisto e aprovado — pronto a promover dev→main (@Renato)`.
     Se houver migração pendente, a mensagem diz que a migração tem de correr **antes** da promoção.
   - Não movas nada para `Testing - QA`. Essa lista significa "está em `main`, em produção" e
     quem a preenche é o workflow do GitHub quando o commit chega lá de facto.
