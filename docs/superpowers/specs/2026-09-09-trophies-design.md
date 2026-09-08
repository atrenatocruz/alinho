# Estante de Troféus — design

Data: 2026-09-09. Pedido do Ruben: troféus por jogos, antiguidade, kudos, progressão Elo/XP e eventos patrocinados, com tiers de raridade e "imensos" (47 no lançamento), nomes pt-PT com sabor a padel. Referências: Strava (trophy case, 4 recentes no perfil), PSN (4 tiers + % de jogadores que o têm), boas práticas de achievement design (escadas de progressão).

## Arquitetura

**Motor = função pura do estado.** Todos os critérios derivam de dados existentes (mix_player_stats, private_match_stats, mix_kudos, matches/teams, profiles, games.date). `check_and_award_trophies(user)` é idempotente (`ON CONFLICT DO NOTHING`) → backfill retroativo grátis (corre no fim da migração). Chamado em `finalize_mix` (todos os jogadores), `confirm_private_match` (os 4) e `give_mix_kudos` (recipient + votante, por causa do Fair Play). Sem rules-engine data-driven: cada troféu é uma linha booleana num VALUES.

- `trophies` (catálogo: key, category, rarity, sort, active — nomes/descrições nos locales) — SELECT público a autenticados (a estante mostra bloqueados).
- `player_trophies` (UNIQUE user+key) — SELECT próprio + colegas de clube (`shares_org_with`); escrita só via SECURITY DEFINER.
- `get_player_trophies(user)` → ganhos + `rarity_pct` PSN-style (% de perfis com rating que o têm, ao vivo).
- `admin_award_trophy(user, key)` — platform-admin, para a categoria `evento` (patrocinados, entregues à mão até existir entidade de eventos).

## Catálogo (47) e raridades

4 tiers — comum (cinza) / raro (azul) / épico (roxo) / lendário (dourado). Lista completa no plano `docs/superpowers/plans/` e no seed da migração; escadas por grupo: presença (Primeira Bola → Centurião do Vidro, + hábitos: Ritual de Segunda, Coruja do Padel, Madrugador, Mês Cheio), vitórias (Primeiro Grito → Dinastia, Noite Perfeita/Bis!, Remontada), amigáveis, Elo (Calibrado → Gigante), XP (Primeiro Escudo → World Class), kudos (Primeiro Aplauso → Ídolo da Bancada, MVP da Noite, Fair Play), antiguidade (Sócio Fundador ≤ set/2026, Meio Ano/Um Ano/Velha Guarda, Embaixador multi-clube).

## UI

`TrophyCard` (ui.jsx): moldura/cores por raridade, ícone lucide por key (`src/lib/trophies.js`, com fallback), nome/desc dos locales, pill de raridade + "%N têm"; bloqueado = silhueta com cadeado e critério visível. Profile: secção "Estante de troféus" (4 recentes à Strava → expandir para grelha completa por categoria com bloqueados). PlayerDetails: só ganhos, com a gate de privacidade das stats. Fail-soft: sem migração, a secção não aparece.

## Fora de âmbito v1

Animação de conquista/toast no momento (v2); linha de troféus no bot WhatsApp; entidade de eventos.
