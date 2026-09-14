---
name: pegar
description: Claimar uma task do board Alinho antes de começar a trabalhar — verifica que ninguém já está nela, atribui-te o cartão, move-o para In Development, cria a branch e avisa o #dev-updates. Usa quando o utilizador quer começar uma task nova, diz "vamos pegar no cartão X", "o que há para fazer", ou pede para escolher trabalho do board.
---

# /pegar — claimar uma task

O objectivo é que o board reflicta a realidade **no momento em que o trabalho começa**, não no fim.
Sem isto, dois Claudes da equipa pegam na mesma task sem saber.

IDs do board e dos canais: `.claude/team/board.json`. Lê-o primeiro.

## Passos

1. **Ver o que já está tomado.** Lê as listas `In Development`, `Code Review` e `Dev Done`.
   Mostra ao utilizador quem está em quê. Se o cartão que ele quer já tiver outro membro
   atribuído, **para e diz** — não continues sem ele confirmar que quer mesmo duplicar.

2. **Escolher o cartão.**
   - Se o utilizador nomeou um cartão (por número `#51`, nome ou link), usa esse.
   - Se não nomeou, lista `Selected/Ready` e `Bugs` e pede-lhe para escolher. Não escolhas por ele.
   - Se não existir cartão para o trabalho que ele descreve, cria um em `Selected/Ready`
     (ou `Bugs`, se for defeito) e usa esse.

3. **Claimar.** No cartão:
   - atribui o utilizador como membro (é isto que marca o claim para os outros);
   - move para `In Development`;
   - comentário: `🔧 Começado por <username> — branch \`<branch>\` — <data>` e uma linha
     com o que se vai fazer.

4. **Criar a branch.** A partir de `dev` actualizado:
   ```
   git checkout dev && git pull --ff-only origin dev
   git checkout -b <tipo>/<slug>
   ```
   `<tipo>` é `feat` ou `fix` conforme o cartão (a convenção que o repo já usa).

5. **Avisar a equipa.** Mensagem no Slack `#dev-updates`:
   ```
   🔧 A começar #<n> <nome do cartão>
   <link do cartão>
   branch: <branch>
   ```

6. **Confirmar ao utilizador** em duas linhas: cartão claimado, branch criada, e o que vem a seguir.

## Não faças

- Não claimes mais de um cartão de uma vez — uma task em `In Development` por pessoa.
- Não toques em `main`.
- Se o utilizador disser que está com poucos tokens, salta os passos 3 e 5 e diz que saltaste.
