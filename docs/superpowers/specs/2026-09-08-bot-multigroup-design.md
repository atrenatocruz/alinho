# Bot WhatsApp multi-grupo / multi-clube — design

Data: 2026-09-08. Pedido: card do Renato (7 set) — meter o bot no grupo do Pedro sem perder o grupo atual. Decisões do Ruben nesta sessão: **o grupo do Pedro é um clube separado** (organization própria, mixes/rankings próprios), e a v1 entra **já com o mapeamento grupo→nível**.

## O que muda

Hoje: um processo de bot = uma conta WhatsApp = um clube (`ORGANIZATION_ID`) = um grupo (`organizations.whatsapp_group_jid`, TEXT único; gate por igualdade em `commands.js`).

Passa a: **um processo de bot = uma conta WhatsApp = N grupos, cada grupo mapeado a um clube (e opcionalmente a níveis)**. O routing é por mensagem: o JID do grupo de onde vem o "In" determina o clube e o filtro de nível. O mesmo processo serve o clube atual e o do Pedro.

## Modelo de dados (migração `migration_whatsapp_groups.sql`, correr à mão)

```sql
whatsapp_groups (
  id UUID PK,
  organization_id UUID NOT NULL → organizations,
  group_jid TEXT NOT NULL UNIQUE,   -- um grupo WhatsApp pertence a exatamente um clube
  label TEXT,                       -- só para humanos ("Grupo principal", "M6 Almada")
  levels TEXT[] NULL,               -- NULL = vê todos os mixes do clube
  created_at
)
games.level TEXT NULL               -- nível opcional do mix (M6..M1); NULL = sem nível
```

- Seed automático: cada `organizations.whatsapp_group_jid` existente vira uma linha (`label='Grupo principal'`). O grupo do Pedro insere-se por SQL (documentado na migração) — a configuração de grupos continua manual, como sempre foi; UI de gestão fica para o plano club.
- `organizations.whatsapp_group_jid` fica como coluna legacy: o bot só a usa como fallback quando a tabela nova não existe/está vazia (deploy do bot e migração ficam independentes na ordem).
- RLS: tabela sem policies para clientes (deny-all) — só o service role do bot e SQL manual lhe tocam, exatamente como o campo antigo.

## Regra de visibilidade (filtro de nível)

Um mix aparece num grupo sse pertence ao clube do grupo **e** (`group.levels IS NULL` **ou** `game.level IS NULL` **ou** `game.level ∈ group.levels`). Mix sem nível aparece em todos os grupos do clube (default seguro); grupo sem filtro vê tudo.

## Bot (multi-org)

- `config.js`: `ORGANIZATION_ID` passa de obrigatório a **opcional/legacy** (só usado no fallback).
- `groups.js` (novo): cache 60 s do mapa `group_jid → {organizationId, levels, label}` + lista de orgs servidas. Fallback legacy: tabela inexistente (42P01) ou vazia → sintetiza um grupo a partir de `organizations.whatsapp_group_jid` + `config.organizationId`.
- `commands.js`: o gate `groupJid !== settings.whatsapp_group_jid` passa a lookup no mapa; todo o resto do handler usa o `organizationId` do grupo da mensagem (mixes abertos, resolução de perfil, criação de guest — `phone.js` ganha parâmetro de org).
- `roster.js`: `getOpenMixes(organizationId)` com cache por org; o conteúdo do roster é montado **por grupo** (mixes filtrados pelo nível do grupo).
- `sync.js`: o estado de repost (debounce leading+trailing, hash, tagAll, promovidos) passa de singletons de módulo a **mapas por grupo**. Eventos de `games` têm `organization_id` → repost só aos grupos desse clube; eventos de `participants` não têm org → lookup `game_id→organization_id` (fallback: todos os grupos; o hash por grupo engole no-ops). Tick de reconciliação percorre todos os grupos.
- `reminders.js` / `autostart.js`: os loops org-scoped passam a iterar as orgs servidas; cada anúncio vai aos grupos do clube do jogo, filtrado por nível; dedupe do digest passa a por-grupo.
- `wa.js`: sem alterações (já é parametrizado por JID; entrega mensagens de qualquer grupo em que a conta esteja).

## Web app

- Formulário de criar/editar mix (`GerirClube.jsx`): campo opcional **"Nível"** (Select: sem nível / M6…M1) gravado em `games.level`. Sem mais UI nesta fase.

## Fora de âmbito

- UI de gestão de grupos (adicionar/remover JIDs) — continua SQL manual; vem com o plano club.
- Bandas F/MX no select de nível do mix (acrescenta-se quando houver grupos femininos/mistos).
- Migrar contactos entre clubes; um número de telefone pode resolver para perfis com membership em cada clube — a resolução já é por (phone_hash, organization_id), mantém-se correta.
