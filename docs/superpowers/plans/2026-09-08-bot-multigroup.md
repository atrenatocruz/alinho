# Bot multi-grupo / multi-clube — plano

Spec: `docs/superpowers/specs/2026-09-08-bot-multigroup-design.md`. Branch: `feat/bot-multigroup`.

1. `supabase/migration_whatsapp_groups.sql` — tabela `whatsapp_groups` + `games.level` + seed do JID legacy + exemplo comentado de INSERT para um clube novo (Pedro). Correr à mão.
2. `whatsapp-bot/src/config.js` — `ORGANIZATION_ID` opcional.
3. `whatsapp-bot/src/groups.js` — novo: `getGroupMap()` / `getServedOrgIds()` / `getGroupsForOrg(orgId)` com cache 60 s + fallback legacy + `mixVisibleToGroup(game, group)`.
4. `whatsapp-bot/src/phone.js` — `resolveProfileByPhoneJid(phoneJid, organizationId)` e `createGuestProfile(phoneJid, name, organizationId)`.
5. `whatsapp-bot/src/roster.js` — `getOpenMixes(organizationId)` (cache por org).
6. `whatsapp-bot/src/commands.js` — gate por lookup no mapa; org da mensagem em todo o handler; lista de mixes filtrada por nível do grupo.
7. `whatsapp-bot/src/sync.js` — estado por grupo (Map), repost por grupo com conteúdo filtrado, targeting por org nos eventos, reconcile a todos os grupos.
8. `whatsapp-bot/src/reminders.js` + `autostart.js` — loops multi-org, envio aos grupos do clube do jogo com filtro de nível, dedupe do digest por grupo.
9. `src/pages/GerirClube.jsx` — campo "Nível" no form de mix (`games.level`).
10. `whatsapp-bot/README.md` — secção de configuração de grupos (INSERT em `whatsapp_groups`, JIDs no log de arranque).
11. `node --check` a todos os ficheiros do bot; `npm run build` da web app; review.

## Deploy — ORDEM OBRIGATÓRIA

1. **Correr `migration_whatsapp_groups.sql` ANTES do merge para `main`.** A web app auto-deploya no merge e passa a escrever `games.level` / `game_recurrences.level` em todos os creates/updates de mixes — sem a migração, criar/editar mixes em produção parte com "column does not exist". (O bot é o contrário: backwards-safe em qualquer ordem, via fallback legacy.)
2. Merge para `main` (web deploya sozinha).
3. Redeploy manual do bot; adicionar a conta WhatsApp ao grupo do Pedro; capturar o JID no log de arranque; INSERT em `whatsapp_groups` com a org do Pedro (exemplo na migração).

## Multi-processo (vários bots, uma BD)

Cada processo só serve a interseção de `whatsapp_groups` com os grupos em que a **sua** conta WhatsApp está (wa.js `getParticipatingGroupJids` → groups.js) — vários bots/números partilham a tabela sem competir. Regra operacional: **não dividir os grupos de um mesmo clube por contas/bots diferentes** — os reminders e o auto-start são por clube, e dois processos a servirem o mesmo clube competiam nesses timers.

## Limitações conhecidas (aceites na v1)

- A gestão de grupos é SQL manual; a UI não valida se o nível escolhido num mix está coberto por algum grupo do clube — um mix com nível sem grupo correspondente não aparece em nenhum grupo WhatsApp (In/Out via app continuam a funcionar). O CHECK nas colunas trava typos/case.
- O auto-start continua a arrancar o mix mesmo que nenhum grupo o veja — o anúncio das duplas é que fica silencioso (comportamento igual ao antigo com JID vazio).
- Estado por grupo em memória nunca é limpo quando um grupo sai da tabela — crescimento negligível à escala atual.
