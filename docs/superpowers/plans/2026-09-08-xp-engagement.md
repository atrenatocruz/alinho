# Sistema de XP / assiduidade com escudo no avatar

## Contexto

Pedido do Ruben (8 set): recompensar dedicação — XP por cada jogo, participação em mixes, vitórias (torneios quando existirem) — com um escudo à volta do avatar. Complementa o Elo sem competir com ele: **Elo = nível (pode descer) · XP = dedicação (só sobe)**. É o lar natural do sinal de assiduidade que o `total_points` media. Greenfield confirmado (zero infra de rewards existente).

## Decisões fechadas

- **XP global** por pessoa (`profiles.xp`), com **ledger por evento** (`xp_events`, cada evento com org de origem; NULL = amigável) → leaderboards de assiduidade por clube deriváveis.
- **Valores v1**: participar num mix 20 · cada jogo do mix 5 · vencer o mix 30 · amigável confirmado 10 · vitória no amigável +5. Kinds extensíveis (torneios futuros).
- **10 níveis**, calibrados pelo Ruben: World Class = jogar ≥1 jogo/dia, 5 dias/semana, 3 anos (~130 XP/semana) = **20.000 XP**; níveis baixos fáceis (sentido de progressão), curva ~geométrica:

  | Nível | Nome | XP | Ritmo de referência |
  |---|---|---|---|
  | — | sem escudo | < 50 | ainda não jogou o suficiente |
  | 1 | Iniciado | 50 | primeira semana |
  | 2 | Bronze | 150 | ~2-3 semanas |
  | 3 | Prata | 350 | ~1 mês a 2x/semana |
  | 4 | Ouro | 700 | ~3 meses a 2x/semana |
  | 5 | Platina | 1.300 | ~6 meses a 2-3x/semana |
  | 6 | Esmeralda | 2.500 | ~8 meses a 3x/semana |
  | 7 | Rubi | 4.500 | ~1 ano a 3-4x/semana |
  | 8 | Diamante | 7.500 | ~1,5 anos a 4x/semana |
  | 9 | Lenda | 12.000 | ~2 anos a 4-5x/semana |
  | 10 | World Class | 20.000 | 3 anos a 5x/semana |
- **Escudo** = anel no Avatar com cor por nível (permanente) + **brilho** quando `last_played_at` < 7 dias (o "joga esta semana"). Sem punição — o brilho apaga, o material fica.
- **Display v1**: escudo nos avatares (Profile hero, nav, PlayerDetails, GameDetails, tab novo); barra de XP no Profile (nível, progresso p/ próximo); tab "Assiduidade" nos Rankings (Global + por clube). Diferido: ShareCard (canvas), PlayerSearch, tabs Elo (mantêm tiles).
- **Retroativo SIM**: XP é aditivo/independente de ordem — backfill de `mix_player_stats` + `private_match_stats` para os escudos significarem algo no dia 1.
- Guests: mixes seguem a exclusão `NOT is_guest` existente (herdada do `pcalc`); amigáveis premeiam os 4.

## Implementação

### 1. `supabase/migration_xp_engagement.sql`
- Tabela `xp_events` (user_id, organization_id NULL p/ amigáveis, kind CHECK in mix_participation/mix_games/mix_win/friendly_match/friendly_win, source_game_id/source_private_match_id, amount>0, occurred_at) com **UNIQUE parciais (user_id, kind, source_*)** — idempotência total; RLS: SELECT own-rows, sem policies de escrita (só SECURITY DEFINER).
- `profiles` + `xp INTEGER DEFAULT 0` + `last_played_at TIMESTAMPTZ` (protegidos por omissão pelos column grants existentes).
- **`finalize_mix`** (partir do corpo VIVO — diffar com a BD ao correr): CTEs extra `xp_rows` (a partir do `pcalc`, herda exclusão de guests) → `ins_xp` (ON CONFLICT DO NOTHING, RETURNING) → UPDATE atómico de `profiles.xp`/`last_played_at` (GREATEST com a data do jogo).
- **`confirm_private_match`** (corpo vivo de migration_private_match_elo.sql): WITH players/xp_rows/ins_xp → UPDATE profiles, org NULL.
- **`get_xp_rankings(p_organization_id DEFAULT NULL)`**: global lê `profiles.xp`; por clube soma `xp_events` da org; devolve user_id, name, avatar_url, xp, last_played_at; LIMIT 200; REVOKE/GRANT padrão.
- **`get_player_profile`** recriada (DROP — muda RETURNS) com `xp, last_played_at` no fim.

### 2. `supabase/migration_xp_backfill.sql`
INSERT…SELECT dos 5 kinds a partir de `mix_player_stats` (occurred_at = games.date) e `private_match_stats` (status='confirmed', occurred_at = confirmed_at), tudo ON CONFLICT DO NOTHING; depois recompute total de `profiles.xp` + `last_played_at` a partir do ledger. **Re-corrível sem duplicar.**

### 3. `src/lib/xp.js` (espelha `src/lib/elo.js` — display puro)
`XP_TIERS` (11 entradas: os 10 níveis + "sem escudo" <50) com labelKey + ringClass Tailwind (literais completos p/ o scanner): iniciado stone-400, bronze amber-600, prata slate-300, ouro yellow-400, platina cyan-300, esmeralda emerald-400, rubi rose-500, diamante sky-400, lenda violet-400, world-class lime-400. `tierFromXp(xp)` → {tier, nextMin, level 1-10, progressPct}; `isGlowing(lastPlayedAt)` (7 dias); `GLOW_CLASS`.

### 4. `src/components/ui.jsx` — Avatar
Props opcionais `xp`/`lastPlayedAt` (default null = sem escudo, 40+ call sites intactos); anel do tier + glow. Nota: quem já passa ring no `size` (PlayerAvatarRow) não passa xp.

### 5. Superfícies
- `Profile.jsx`: hero avatar com escudo; barra de XP sob a linha do rating (pill do nível + progress bar lime + "{{intoLevel}}/{{needed}} XP"). Dados já vêm (`select('*')` do AuthContext).
- `Layout.jsx:429`: avatar da nav com escudo.
- `PlayerDetails.jsx`: hero com escudo (via get_player_profile estendida).
- `GameDetails.jsx`: selects de participantes ganham `xp, last_played_at`; escudo nas listas/duplas principais.
- `Rankings.jsx`: tab **"Assiduidade"** (players) com Select de âmbito (Global + memberships), RPC `get_xp_rankings`, linhas com Avatar+escudo, nome + pill do nível, número grande = XP.

### 6. Locales pt/en
`rankings.tab_assiduity`, `rankings.xp_label`, scope/empty keys, `profile.xp_level`, `profile.xp_progress`, `xp.tier_*` (10 nomes; en: Beginner/Bronze/Silver/Gold/Platinum/Emerald/Ruby/Diamond/Legend/World Class).

### 7. Docs + rollout
Spec+plano em `docs/superpowers/` (curva de 10 níveis com a derivação do Ruben registada), FEATURES.md. Branch off **main** (não dev). **Ordem: migração engagement → backfill → merge para main** (a web nova lê colunas/RPCs novas).

## Verificação
- Build; espelho JS rápido da curva (thresholds/nível/progresso monotónicos).
- Pós-migrações: finalizar mix de teste → xp_events certos (sem guests), profiles.xp/last_played_at atualizados; confirmar amigável → 4+2 eventos org NULL; re-correr backfill → 0 novas linhas; cliente não consegue INSERT em xp_events nem UPDATE profiles.xp.
- UI: escudo+glow nas 5 superfícies, barra no perfil, tab Assiduidade global vs por clube (somas diferentes p/ multi-clube), pt/en.
