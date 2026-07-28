# Mixs Ativos / Terminados tabs — design

## Problem

The "Próximos jogos" screen (`src/pages/Home.jsx`) shows every non-cancelled
game in one flat list, ordered by date ascending. As the history of finished
mixes grows, it pushes the actually-relevant upcoming mixes further down the
page and mixes "what do I still need to act on" with "what already happened."

## Goal

Split the list into two tabs:

- **Mixs Ativos 🟢** — mixes that haven't finished yet (open, closed, or
  in progress), soonest date first.
- **Mixs Terminados 🏁** — finished mixes (completed/finished), most recent
  date first, acting as history.

Scope: `src/pages/Home.jsx` only. `Admin.jsx` has its own separate games list
for a different audience/purpose and is not part of this change.

## Data

No new query. `loadGames()` already fetches all non-cancelled games for the
org via a single Supabase query ordered by `date` ascending. That result is
split client-side:

- `activeGames` — `status` in `open | closed | in_progress`, keep ascending
  order (already correct from the query).
- `finishedGames` — `status` in `completed | finished`, reversed to
  descending (most recent first).

Games with any other/unexpected status fall into `activeGames` by exclusion
(i.e. anything not finished/completed is treated as active) — this matches
the existing `isDone` check pattern in `src/components/ui.jsx` and avoids a
mix silently disappearing from both tabs if a new status value shows up later.

## UI

Reuse the segmented-tab pattern already used in `src/pages/Rankings.jsx`:

```
<div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
  {TABS.map(t => (
    <button className={active ? 'bg-surface text-ink-900 shadow-card' : 'text-muted hover:text-ink-900'}>
      {t.label}
    </button>
  ))}
</div>
```

- Tabs: `Mixs Ativos 🟢` (default/initial tab) and `Mixs Terminados 🏁`.
- Placed directly under the "Próximos jogos" heading, above the card list.
- Each tab renders its own `EmptyState` when its list is empty:
  - Ativos empty: reuse existing "Campo livre… por agora" empty state.
  - Terminados empty: new copy, e.g. "Ainda não há mixs terminados" /
    "O histórico de mixs aparece aqui assim que houver um terminado."
- No change to `MixCard` itself — same card renders in both tabs.

## Out of scope

- No change to `Admin.jsx`.
- No change to the Supabase query or realtime subscription — still one
  fetch, split client-side.
- No pagination/infinite scroll on the Terminados history — not requested;
  can be revisited later if the list grows large.
