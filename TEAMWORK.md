# Como a equipa (e os Claudes da equipa) se coordena

O problema que isto resolve: cada pessoa corre o seu Claude na sua máquina, sem memória
partilhada. Nenhum Claude sabe o que os outros estão a fazer. A coordenação só existe se houver
**uma fonte de verdade externa** e **o mesmo protocolo instalado em todas as máquinas**.

A fonte de verdade é o board Trello. O protocolo é este ficheiro, e está executável em
`.claude/skills/` e `.claude/hooks/` — versionado no repo, por isso chega a todos com um `git pull`.

## Quem sabe o quê

| Camada | Onde | O que responde |
|---|---|---|
| Estado | Trello — board [Alinho](https://trello.com/b/mG5oDWNM/alinho) | quem está em que task, e em que fase |
| Evidência | GitHub (`dev`, `main`, commits) | o que existe de facto em código |
| Sinal | Slack `#dev-updates` | o que mudou agora, para quem não está a olhar |
| Leitura humana | Notion | histórico e digest (fase 2) |

A cola entre as camadas é **uma linha na mensagem de commit**: `(Trello #51)`. É a convenção que
o repo já usava; agora é ela que permite a qualquer automação juntar código ao cartão. Um commit
sem ela é um commit que o board não vê.

## O ciclo de uma task

```
Selected/Ready ──/pegar──▶ In Development ──/entregar──▶ Code Review ──/rever──▶ Dev Done
                                                              │                     │
                                                       (devolvido)          (Renato promove
                                                              ▼             dev→main)
                                                    In Development                  ▼
                                                                            Testing - QA ──▶ Done
```

O que cada lista significa, sem ambiguidade:

- **In Development** — alguém está a trabalhar nisto **agora**, e está atribuído ao cartão.
  Se tem dono, não pegues.
- **Code Review** — o código está em `dev` e espera que outra pessoa olhe. Esta é a lista que
  responde à pergunta "onde é preciso fazer review".
- **Dev Done** — revisto e aprovado, à espera da promoção `dev`→`main`. Só o Renato promove.
- **Testing - QA** — está em `main`, logo serve `alinho.pt`, logo há o que testar.
  **Quem põe cartões aqui é o workflow do GitHub**, quando o commit chega lá de facto — não uma pessoa.

## Os comandos

Corre-se no Claude, dentro do repo. Todos escrevem no Trello e (onde faz sentido) no Slack.

| Comando | Quando | O que faz |
|---|---|---|
| `/pegar` | antes de começar | mostra o que já está tomado, atribui-te o cartão, move para In Development, cria a branch, avisa o #dev-updates |
| `/ponto` | a meio, ou ao parar | comentário de progresso no cartão (não move nada, não faz commits) |
| `/entregar` | task pronta | `npm run build`, commit com `(Trello #N)`, push para `dev`, cartão → Code Review, pede review no #dev-updates |
| `/rever` | há review para fazer | lista a fila por antiguidade, revê o diff, registra o veredicto no cartão, aprova ou devolve |
| `/standup` | de manhã, ou "em que ponto está tudo" | cruza board + git + Slack e aponta o que está encalhado e onde o board mente |

O passo que mudou o comportamento: **`/pegar` acontece no início**. A regra antiga só actualizava
o Trello no fim, e é por isso que ninguém sabia o que estava em curso.

## O que é automático (não depende de ninguém se lembrar)

**Ao arrancar a sessão** (`SessionStart` → `.claude/hooks/team-brief.mjs`): o Claude recebe no
contexto quem está em quê, o que espera review, e que cartões estão parados há 3+ dias.

**Ao fazer push** (`PostToolUse` → `.claude/hooks/git-guard.mjs`): lembra o Claude de fechar o
ciclo no Trello e no Slack antes de dar a task como acabada.

**Ao tentar push para `main`** (`PreToolUse`): recusado. A regra "só o Renato promove" deixou de
ser um parágrafo de documentação e passou a ser aplicada.

**Ao chegar código a `dev` ou `main`** (GitHub Actions → `.github/workflows/trello-sync.yml`):
lê os `(Trello #N)` dos commits, avança o cartão (nunca o recua) e avisa o `#dev-updates`.
Um push para `main` sem referência a cartão dá aviso no Slack — é como se apanha trabalho invisível.

## Instalar (uma vez, por pessoa)

Nada a fazer além de `git pull`, com duas excepções:

1. **Node no PATH** — os hooks correm com `node`. Confirma com `node --version`.
2. **Credenciais do Trello no `.env`** (opcional, mas é o que faz o briefing de arranque ser
   automático em vez de o Claude ter de ir buscar o board):
   ```
   TRELLO_API_KEY=...
   TRELLO_TOKEN=...
   ```
   A chave e o token pedem-se em https://trello.com/power-ups/admin (o `.env` é gitignored).
   Sem eles, o briefing continua a funcionar — o Claude lê o board pelo conector MCP.

## Instalar (uma vez, no repo — Renato)

Em **Settings → Secrets and variables → Actions**, criar:

| Secret | Onde se obtém |
|---|---|
| `TRELLO_API_KEY` | https://trello.com/power-ups/admin |
| `TRELLO_TOKEN` | token gerado a partir dessa chave, com permissão de escrita no board |
| `SLACK_BOT_TOKEN` | Slack app com `chat:write`, convidada ao `#dev-updates` |

E criar a lista **Code Review** no board, entre `Dev Done` e `Testing - QA`, pondo o id dela em
`.claude/team/board.json` (`"Code Review"`). Enquanto for `null`, as skills usam `Dev Done` e
escrevem "à espera de review" em texto — funciona, mas perde-se a distinção.

## Fase 2 (não instalado)

- **Watchdog diário** no GitHub Actions: cartão em Code Review há 2+ dias, ou em In Development
  há 3+ dias, dá ping no `#dev-updates`.
- **Digest no Notion**: tarefa agendada que corre `/standup` e escreve a página do dia.
- **Ligação ao `#bugs`**: mensagem nova no canal cria cartão na lista `Bugs`.
