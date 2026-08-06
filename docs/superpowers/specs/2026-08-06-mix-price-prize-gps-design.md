# Mix price, prize, and GPS link — design

## Context

The inscription card for a mix (padel game event) currently shows title, date, location (plain text), format summary, and player list, but nothing about cost or prizes, and the location isn't tappable. Many mixes charge a per-player fee and many have a prize for winners; users currently have to find this out elsewhere. Location text also isn't linked to a map, so users can't tap through for directions.

This adds two new optional attributes to a mix — price per player and prize — and makes the existing location field open Google Maps.

## Scope

- Applies to the **detail-page hero card** in `src/pages/GameDetails.jsx` (the card directly above the "Ações de inscrição" join buttons) only. The compact list card (`MixCard` in `src/components/ui.jsx`, shown on `Home.jsx`) is unchanged — keeps just title/date/location/players, no price/prize.
- `ShareCard.jsx` (the rasterized Instagram-story share image) is out of scope for this change; it can be revisited separately if price/prize should appear there too.

## 1. Data model

Add two new nullable columns to the `games` table (mixes have no dedicated table — see `supabase/schema.sql`):

```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS price_per_player NUMERIC(6,2);
ALTER TABLE games ADD COLUMN IF NOT EXISTS prize TEXT;
```

- New migration file `supabase/migration_price_prize.sql`, following the existing additive pattern used by `supabase/migration_mixes.sql`.
- `supabase/schema.sql` also updated so it stays the authoritative full-schema reference.
- No new column for GPS/location — the existing `location TEXT` column is reused (see §4).
- Both columns are nullable/optional: a mix with no price is treated as free/unspecified; a mix with no prize simply has none.

## 2. Admin form (`src/pages/Admin.jsx`)

Two new optional fields added to the create/edit mix form, placed directly after the existing "Local" field (same pattern: `<div><label>…</label><input .../></div>`):

- **Preço por jogador (€)** — `<input type="number" step="0.5" min="0">`, placeholder `"ex: 5"`.
- **Prémio** — `<input type="text">`, placeholder `"ex: Vouchers para os vencedores"`.

Changes required:
- `EMPTY_GAME_FORM` gets `price_per_player: ''` and `prize: ''`.
- The edit-prefill logic (where `editingGame` populates `gameForm`) gets `price_per_player: game.price_per_player ?? ''` and `prize: game.prize || ''`, matching the existing `location: game.location || ''` pattern.
- No changes needed to `handleCreateGame`/`handleUpdateGame` submission logic — both already spread `...gameForm` directly into the Supabase insert/update call.

## 3. Display on the hero card (`src/pages/GameDetails.jsx`)

Two new conditional rows added to the hero card block, following the existing `<Icon size={..} className="text-ink-700 shrink-0" /><span>{value}</span>` row pattern used for date/location/format:

- **Preço** — rendered only when `game.price_per_player` is truthy and `> 0`. Icon: `Euro` (lucide-react). Text: `` `${game.price_per_player}€ / jogador` ``.
- **Prémio** — rendered only when `game.prize` is a non-empty string. Icon: `Trophy` (lucide-react). Text: `` `Prémio: ${game.prize}` ``.

`Euro` and `Trophy` are added to the existing `lucide-react` import in this file.

## 4. GPS link on location

The existing `MapPin` icon + `game.location` row in the hero card becomes a tappable link, wrapped in:

```jsx
<a
  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.location)}`}
  target="_blank"
  rel="noopener noreferrer"
>
  {/* existing MapPin + location markup, unchanged visually */}
</a>
```

- No new field or DB column — derived from the existing free-text `location` string at render time.
- Works retroactively for all existing mixes without any data migration.
- Only applied in the `GameDetails.jsx` hero card, per the scope decision in §Scope. `MixCard` location text stays non-interactive.

## Out of scope / explicitly not doing

- No structured/geocoded location (no lat/lng column, no map embed/preview).
- No dedicated "paste a Google Maps link" admin field — the auto-generated search-query link was chosen over this for zero admin overhead and instant coverage of existing mixes.
- No price shown on the compact list card (`MixCard`) — detail card only.
- No changes to `ShareCard.jsx`.
- No currency other than €; no per-mix-total price mode (price is always per-player).
