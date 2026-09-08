# Kudos — o 👍 da noite — design

Data: 2026-09-09. Ideia do Ruben: cada jogador de um mix pode dar 1 thumbs up a um colega no fim, +1 XP por kudos recebido, visível no mix e no perfil (à Strava).

## Porquê

Terceiro eixo do sistema: Elo mede nível, XP mede presença, **kudos mede o que os colegas viram** — a boa onda, o carry, o novato que surpreendeu. +1 XP é simbólico de propósito (uma noite de mix ≈ 45 XP): o valor está no gesto visível, não na economia.

## Regras (todas impostas no Postgres — `migration_kudos.sql`)

- 1 kudos por (mix, votante) — `UNIQUE(game_id, voter_id)`; voto final, sem trocas.
- Nunca em si próprio (`CHECK`); votante e destinatário têm de ser participantes confirmados do mix; só com o mix `finished`; janela de **48h após a data do mix**.
- XP: evento único `kind='kudos'` por (jogador, mix) no ledger com `amount` incremental (o UNIQUE parcial do ledger não permitiria N linhas) + `profiles.xp += 1`.
- Leituras via RPCs (`get_mix_kudos` — pódio + flag do meu voto, visível a membros do clube; tabela deny-all).

## UI

- **GameDetails (mix terminado)**: cartão "👍 da noite" — durante a janela, lista dos colegas com botão 👍 (1 clique, sem confirmação — é reversivelmente irrelevante e a janela fecha sozinha); depois, pódio com contagens e realce do meu voto.
- **Perfil próprio**: tile "Kudos" nas estatísticas (só quando >0).
- **Perfil público**: contador 👍 junto aos amigos (via `get_player_xp`, que passou a devolver `kudos`).
- Bot WhatsApp (linha "👍 da noite" no fecho): fica para uma 2ª ronda.
