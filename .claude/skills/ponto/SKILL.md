---
name: ponto
description: Ponto de situação a meio de uma task — escreve o progresso no cartão Trello sem fechar nada, para a equipa ver onde está o trabalho. Usa quando o utilizador vai parar por hoje, quando o trabalho fica a meio, quando alguém pergunta "em que ponto está isto", ou quando uma task já vai longa.
---

# /ponto — actualizar o estado sem fechar

Uma task que fica dois dias em `In Development` sem sinal é indistinguível de uma task abandonada.
Isto resolve-se com um comentário no cartão. Não move o cartão nem faz commits.

## Passos

1. Descobre o cartão: pela branch actual (`git branch --show-current`), pelos commits recentes
   (`git log --oneline -10`, procura `(Trello #N)`), ou pergunta.

2. Recolhe o estado real, não uma narrativa:
   ```
   git branch --show-current
   git log dev..HEAD --oneline
   git status --short
   ```

3. Comentário no cartão, curto e concreto:
   ```
   ⏳ Ponto de situação — <data>
   Feito: <o que já funciona>
   A faltar: <o que falta, em pontos>
   Bloqueios: <se houver, ou "nenhum">
   branch: <branch> (<n> commits, <n> ficheiros não commitados)
   ```

4. Só manda mensagem ao `#dev-updates` se houver **bloqueio** ou se o utilizador pedir.
   Um ponto de situação normal vive no cartão; o Slack é para o que os outros precisam de saber já.

5. Se `git status` mostrar trabalho não commitado e o utilizador estiver a parar, sugere um
   commit WIP na branch dele (não em `dev`) para nada se perder.
