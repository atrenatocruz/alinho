# Sistema de XP / assiduidade — design

Data: 2026-09-08. Pedido do Ruben: premiar dedicação (jogos, mixes, torneios futuros) com um escudo no avatar. Complementa o Elo sem competir: **Elo = nível (pode descer) · XP = dedicação (só sobe)** — o lar do sinal de assiduidade que o `total_points` media antes do Elo.

## Modelo

- **XP global** por pessoa (`profiles.xp`), com ledger append-only `xp_events` (evento → clube de origem; NULL = amigável) para derivar leaderboards por clube. `profiles.last_played_at` alimenta o brilho semanal sem subqueries.
- **Escritas só nos pontos de confiança**: `finalize_mix` e `confirm_private_match` (SECURITY DEFINER), num único statement atómico por fluxo; UNIQUEs parciais `(user_id, kind, source_*)` tornam qualquer re-run/backfill incapaz de duplicar. Sem policies de escrita para clientes.
- **Valores v1**: mix — participação 20, 5/jogo, vitória 30 (herda a exclusão de guests do `pcalc`); amigável — 10, vitória +5 (os 4 jogadores). `kind` extensível (torneios).
- **Retroativo**: sim — XP é aditivo/independente de ordem (`migration_xp_backfill.sql`, re-corrível).

## Curva de níveis (calibração do Ruben)

Âncora: **World Class = jogar ≥1 jogo/dia, 5 dias/semana, 3 anos** (~130 XP/semana) = **20.000 XP**. Baixos fáceis (sentido de progressão), topo geométrico:

sem escudo <50 · 1 Iniciado 50 · 2 Bronze 150 · 3 Prata 350 · 4 Ouro 700 · 5 Platina 1.300 · 6 Esmeralda 2.500 · 7 Rubi 4.500 · 8 Diamante 7.500 · 9 Lenda 12.000 · 10 World Class 20.000.

## Escudo

Anel no `Avatar` (props opcionais `xp`/`lastPlayedAt`; default null = sem escudo, call sites existentes intactos) com cor por nível + **brilho** (`GLOW_CLASS`) quando jogou nos últimos 7 dias — o brilho apaga-se, o material nunca desce. Curva e classes em `src/lib/xp.js` (espelha `elo.js`).

## Superfícies v1

Profile hero (escudo + barra de nível/progresso) · avatar da nav (Layout) · PlayerDetails hero (RPC `get_player_xp` — dedicado, em vez de estender o `get_player_profile` de 7 versões) · listas de participantes do GameDetails · tab **Assiduidade** nos Rankings (âmbito Global = `profiles.xp` / por clube = soma do ledger, via RPC `get_xp_rankings`). Diferido: ShareCard (avatar em canvas), PlayerSearch, tabs Elo (mantêm tiles).

## Deploy

`migration_xp_engagement.sql` → `migration_xp_backfill.sql` → merge (a web lê colunas/RPCs novos). As duas funções recriadas partiram das versões vivas (`finalize_mix` da migração Elo; `confirm_private_match` da migração private-match-elo) — diffar contra a BD ao correr se houver dúvida.
