# Bottom nav reorganization — design

## Problem

Today's bottom nav (`src/components/Layout.jsx`) has 3 items for members
(Jogos, Ranking, Perfil) and 2 for guests (Jogos, Perfil). The product
direction (see mockup, `menu.jpeg`) calls for 5 items for members: Jogos,
Comunidade, Clubes/Cortes, Rankings, Perfil — matching a "dynamic island"
pill with icons in that order.

This spec covers navigation/IA only: which routes exist, what each nav
item points to, and the minimum content needed for two new routes to not
be blank. It does not design Torneios, "jogos em aberto" as a feature, or
the eventual content of Clubes/Cortes — those are explicitly deferred.

## Nav items (members — 5 total)

| # | Label | Route | Icon | Behavior |
|---|-------|-------|------|----------|
| 1 | Jogos | `/` | lucide `Home` | Unchanged — existing `Home.jsx` |
| 2 | Comunidade | `/comunidade` (new) | lucide `Users` | New page, search-only (see below) |
| 3 | Clubes/Cortes | `/clubes` (new) | custom `PadelIcon` (see below) | Placeholder page, empty state only |
| 4 | Rankings | `/rankings` | lucide `Trophy` | Existing `Rankings.jsx`, tabs reordered/renamed (see below) |
| 5 | Perfil | `/perfil` | user's avatar photo (see below) | Unchanged — existing `Profile.jsx` |

Order in the `navItems` array (and visually) matches this table, matching
the mockup's left-to-right order.

## Guests (unchanged, 2 items)

Guests keep exactly today's behavior: `Jogos` + `Perfil` only, gated by
the existing `MemberRoute`/`ProtectedRoute` pattern. Comunidade,
Clubes/Cortes, and Rankings all become new `MemberRoute`-gated routes,
consistent with how Rankings is gated today.

## Admin

Unchanged. The existing conditional push of an `Admin` nav item
(`{ path: '/admin', icon: Settings, label: 'Admin' }`) after Perfil stays
as-is, appended after the 5 member items.

## New page: Comunidade (`src/pages/Comunidade.jsx`, route `/comunidade`)

Minimal wrapper page: renders the existing `PlayerSearch` component
(added in commit `4df9a50`, not yet used in any page) to search/list
players. No new RPCs, no changes to `PlayerSearch` itself, no player
profile rework — this explicitly does **not** absorb the scope of the
separate, still-unimplemented
`docs/superpowers/specs/2026-07-30-player-search-unified-profile-design.md`
spec (a "Jogadores" page with cross-club player profiles and new RPCs).
That spec is parked; if/when it's picked up, it's a distinct effort that
may replace or extend this page later.

## New page: Clubes/Cortes (`src/pages/Clubes.jsx`, route `/clubes`)

Placeholder only: reuses the existing empty-state pattern already used
elsewhere in the app (e.g. Rankings' "Sem mixes" empty state), with a
title like "Em breve" and no data fetching. Content (club info, court
list, switching active club) is deferred to a future spec.

### New icon: `src/components/icons/PadelIcon.jsx`

lucide-react has no padel-racket glyph. Port Google's Material Symbols
"padel" glyph as a standalone SVG React component, restyled to match
lucide's stroke conventions (`stroke="currentColor"`, `strokeWidth={2}`,
`fill="none"`, 24×24 viewBox) so it sits visually consistent with the
other nav icons, which are all lucide components.

## Rankings (`src/pages/Rankings.jsx`) — tab reorder/rename only

Current tab array:

```js
{ key: 'geral', label: 'Geral' }      // club-scoped season ranking
{ key: 'mensal', label: 'Mensal' }
{ key: 'mixes', label: 'Mixes' }
{ key: 'global', label: 'Global' }    // cross-club, private-match-based
```

New tab array — same 4 tabs, first two renamed and swapped, `mensal`/
`mixes` unchanged in content, position, and `key`:

```js
{ key: 'global', label: 'Geral' }     // was "Global" — now first, labeled "Geral"
{ key: 'geral', label: 'Por Clube' }  // was "Geral" — now second, labeled "Por Clube"
{ key: 'mensal', label: 'Mensal' }
{ key: 'mixes', label: 'Mixes' }
```

Internal `key` values stay the same as today's (`geral`, `global`, etc.)
to avoid touching the data-loading logic keyed off them — only the
array's order and `label` strings change, plus the default `useState`
initial tab becomes `'global'` (so "Geral"/cross-club is what's shown by
default, matching its new first position).

No changes to what each tab queries or renders internally.

## Perfil — avatar in nav

`Layout.jsx`'s nav currently renders the generic lucide `User` icon for
the Perfil item. This changes to the user's actual avatar photo (already
available via the same avatar data `Profile.jsx` reads), falling back to
existing initials/generic-silhouette handling when no photo is set —
reusing whatever fallback pattern `Profile.jsx` or `PlayerDetails.jsx`
already use for missing avatars, rather than introducing a new one.

## Out of scope

- Torneios and "jogos em aberto" as features distinct from Mixs/Jogos
  Privados — nav only points Jogos at the existing `Home.jsx`.
- Clubes/Cortes real content (club info, switching active club/org) —
  placeholder only.
- The `player-search-unified-profile` spec's RPCs, `PlayerDetails.jsx`
  rewrite, and Global-tab-links-again change — untouched, separate effort.
- Mensal/Mixes tab content or becoming sub-filters of Por Clube — deferred,
  no change beyond keeping them as-is.
- Admin nav item layout/overflow handling with now 5-6 total items —
  not addressed, existing behavior kept.
