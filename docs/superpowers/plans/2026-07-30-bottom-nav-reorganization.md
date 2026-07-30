# Bottom Nav Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the bottom nav from 3 items (Jogos/Ranking/Perfil) to 5 (Jogos/Comunidade/Clubes/Rankings/Perfil) for members, add the two new pages behind it, reorder Rankings' tabs, and show the user's real avatar in the nav instead of a generic icon.

**Architecture:** Two new lightweight page components (`Comunidade.jsx` wrapping the existing `PlayerSearch` component, `Clubes.jsx` as an empty-state placeholder) plumbed through two new `MemberRoute`-gated routes in `App.jsx`. `Layout.jsx`'s `navItems` array grows to 5 entries and its render swaps in the real `Avatar` for the Perfil item. `Rankings.jsx`'s `TABS` array is reordered/relabeled with no change to tab content. One new icon component ports Google's Material Symbols "padel" glyph for the Clubes nav icon.

**Tech Stack:** React 18, react-router-dom v6, lucide-react, Tailwind, Supabase — plain JSX, no TypeScript, no test runner configured in this repo (no vitest/jest, no existing test files).

## Global Constraints

- Nav order for members: Jogos, Comunidade, Clubes, Rankings, Perfil (left to right).
- Guests keep exactly today's 2 items (Jogos, Perfil) — no change to guest gating.
- Admin's extra nav item stays appended after Perfil, unchanged.
- No new Supabase RPCs, no changes to `PlayerDetails.jsx` — this plan does not absorb the separate, still-unimplemented `docs/superpowers/specs/2026-07-30-player-search-unified-profile-design.md` spec.
- Rankings' internal tab `key` values (`geral`, `mensal`, `mixes`, `global`) do not change — only `label` and array order change, plus the default `useState('geral')` becomes `useState('global')`.
- No test framework exists in this repo. Verification per task is (a) `npm run build` to catch compile/import errors, and (b) a manual check via `npm run dev` in the browser — every task's steps spell out exactly what to click/type and what to expect.
- Follow existing conventions exactly: pages wrapped in `Layout` render their content as `<div className="space-y-5">` with an `<h2 className="text-3xl text-ink-900">Title</h2>` heading (see `Rankings.jsx:200-205`) — no page renders its own `<header>`, `Layout` already provides one.

---

### Task 1: Comunidade page + route

**Files:**
- Create: `src/pages/Comunidade.jsx`
- Modify: `src/App.jsx` (add import at top with other page imports, add route between `/rankings` and `/jogador/:id`)

**Interfaces:**
- Consumes: `PlayerSearch` default export from `src/components/PlayerSearch.jsx`, props `{ label, selected, onSelect, onClear, excludeIds }` (all already exist, no changes to this file); `useNavigate` from `react-router-dom`.
- Produces: `Comunidade` default export, mounted at route `/comunidade` (used by Task 3's nav update).

- [ ] **Step 1: Write `src/pages/Comunidade.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import PlayerSearch from '../components/PlayerSearch'

export default function Comunidade() {
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">Procura outros padeleiros pelo nome</p>
      </div>

      <PlayerSearch
        label="Procurar jogador..."
        selected={null}
        onSelect={(player) => navigate(`/jogador/${player.id}`)}
        onClear={() => {}}
      />
    </div>
  )
}
```

- [ ] **Step 2: Add the route in `src/App.jsx`**

Add the import alongside the other page imports (`src/App.jsx:11`, right after `import Profile from './pages/Profile'`):

```js
import Comunidade from './pages/Comunidade'
```

Add the route inside `<Routes>` (`src/App.jsx`, right after the `/rankings` route which ends at line 119):

```jsx
      <Route
        path="/comunidade"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <Comunidade />
            </Layout>
          </MemberRoute>
        }
      />
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors (Vite would fail loudly on the bad import/JSX if something's wrong).

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev`, then in the browser:
1. Log in as a non-guest member.
2. Navigate directly to `http://localhost:5173/comunidade`.
3. Confirm the page renders with the "Comunidade" heading and a search input, no console errors.
4. Type at least 2 characters of an existing player's name.
5. Confirm a result row (avatar + name) appears below the input.
6. Click the result row.
7. Confirm the browser navigates to `/jogador/<that player's id>` and `PlayerDetails` renders (unchanged page, just confirming the navigation wiring works).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Comunidade.jsx src/App.jsx
git commit -m "feat: add Comunidade page for player search"
```

---

### Task 2: Clubes placeholder page + route

**Files:**
- Create: `src/pages/Clubes.jsx`
- Modify: `src/App.jsx` (add import, add route)

**Interfaces:**
- Consumes: `EmptyState` named export from `src/components/ui.jsx` (props `{ icon, title, subtitle, action }`, all optional except it renders fine with just `title`).
- Produces: `Clubes` default export, mounted at route `/clubes` (used by Task 3's nav update).

- [ ] **Step 1: Write `src/pages/Clubes.jsx`**

```jsx
import { EmptyState } from '../components/ui'

export default function Clubes() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Clubes & Cortes</h2>
      </div>

      <EmptyState
        title="Em breve"
        subtitle="Informação de clubes e cortes vai aparecer aqui."
      />
    </div>
  )
}
```

- [ ] **Step 2: Add the route in `src/App.jsx`**

Add the import next to the `Comunidade` import added in Task 1:

```js
import Clubes from './pages/Clubes'
```

Add the route right after the `/comunidade` route added in Task 1:

```jsx
      <Route
        path="/clubes"
        element={
          <MemberRoute showSplash={showSplash}>
            <Layout>
              <Clubes />
            </Layout>
          </MemberRoute>
        }
      />
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev`, then in the browser:
1. Log in as a non-guest member.
2. Navigate directly to `http://localhost:5173/clubes`.
3. Confirm the page renders with the "Clubes & Cortes" heading and the "Em breve" empty-state card, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Clubes.jsx src/App.jsx
git commit -m "feat: add Clubes placeholder page"
```

---

### Task 3: PadelIcon component + Layout nav update (5 items, real avatar)

**Files:**
- Create: `src/components/icons/PadelIcon.jsx`
- Modify: `src/components/Layout.jsx` (imports, `navItems` array, nav render loop)

**Interfaces:**
- Consumes: `Avatar` named export from `../ui` (props `{ name, url, size, colorClass }`, already used identically in `Profile.jsx:260`); `profile` from `useAuth()` (already destructured in `Layout.jsx:130`, has `.name` and `.avatar_url` — confirmed via `Profile.jsx:42,260`); `/comunidade` and `/clubes` routes from Tasks 1–2.
- Produces: `PadelIcon` default export, a React component accepting `{ size = 24, className }` and rendering `<svg>` with `fill="currentColor"`.

- [ ] **Step 1: Write `src/components/icons/PadelIcon.jsx`**

This is Google's Material Symbols "padel" glyph (Apache-2.0, from
`google/material-design-icons`), used as-is since it's a filled shape
(cutout-hole design), not a stroke icon like lucide's — restyling it
into a stroke icon would mean hand-redrawing an inaccurate glyph.

```jsx
export default function PadelIcon({ size = 24, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M744-80 511-312l-28 28q-23 23-52.5 35T370-237q-31 0-61-12t-53-35L87-454q-23-23-35-52.5T40-567q0-31 12-60.5T87-680l113-113q23-23 52.5-35t60.5-12q31 0 60.5 12t52.5 35l170 169q23 23 35 53t12 61q0 31-12 60.5T596-397l-28 28 232 233-56 56ZM370-317q15 0 29.5-5.5T426-340l114-114q12-11 17.5-26t5.5-30q0-15-5.5-30T540-567L370-736q-11-12-26-18t-30-6q-15 0-30 6t-27 18L144-623q-12 12-17.5 26.5T121-567q0 15 5.5 30t17.5 27l170 170q11 12 26 17.5t30 5.5ZM207-516q13 0 21.5-8.5T237-546q0-13-8.5-21.5T207-576q-13 0-21.5 8.5T177-546q0 13 8.5 21.5T207-516Zm64-63q13 0 21.5-8.5T301-609q0-13-8.5-21.5T271-639q-13 0-21.5 8.5T241-609q0 13 8.5 21.5T271-579Zm7 134q13 0 21.5-8.5T308-475q0-13-8.5-21.5T278-505q-13 0-21.5 8.5T248-475q0 13 8.5 21.5T278-445Zm56-198q13 0 21.5-8.5T364-673q0-13-8.5-21.5T334-703q-13 0-21.5 8.5T304-673q0 13 8.5 21.5T334-643Zm8 135q13 0 21.5-8.5T372-538q0-13-8.5-21.5T342-568q-13 0-21.5 8.5T312-538q0 13 8.5 21.5T342-508Zm6 134q13 0 21.5-8.5T378-404q0-13-8.5-21.5T348-434q-13 0-21.5 8.5T318-404q0 13 8.5 21.5T348-374Zm57-198q13 0 21.5-8.5T435-602q0-13-8.5-21.5T405-632q-13 0-21.5 8.5T375-602q0 13 8.5 21.5T405-572Zm7 134q13 0 21.5-8.5T442-468q0-13-8.5-21.5T412-498q-13 0-21.5 8.5T382-468q0 13 8.5 21.5T412-438Zm64-64q13 0 21.5-8.5T506-532q0-13-8.5-21.5T476-562q-13 0-21.5 8.5T446-532q0 13 8.5 21.5T476-502Zm304-98q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T840-740q0-25-17.5-42.5T780-800q-25 0-42.5 17.5T720-740q0 25 17.5 42.5T780-680ZM342-538Zm438-202Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Update imports in `src/components/Layout.jsx`**

Change line 3 from:

```js
import { Home, Trophy, User, Settings, LogOut, HelpCircle, Phone, X } from 'lucide-react'
```

to:

```js
import { Home, Users, Trophy, User, Settings, LogOut, HelpCircle, Phone, X } from 'lucide-react'
```

Change line 5 from:

```js
import { LevelBadge, PrimaryButton } from './ui'
```

to:

```js
import { LevelBadge, PrimaryButton, Avatar } from './ui'
```

Add a new import for the icon, right after the `hashPhone` import (line 6):

```js
import PadelIcon from './icons/PadelIcon'
```

- [ ] **Step 3: Update the `navItems` array (`src/components/Layout.jsx:150-159`)**

Replace:

```js
  // Guests only see Jogos + Perfil
  const navItems = isGuest
    ? [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/perfil', icon: User, label: 'Perfil' },
      ]
    : [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/rankings', icon: Trophy, label: 'Ranking' },
        { path: '/perfil', icon: User, label: 'Perfil' },
      ]
```

with:

```js
  // Guests only see Jogos + Perfil
  const navItems = isGuest
    ? [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/perfil', icon: User, label: 'Perfil' },
      ]
    : [
        { path: '/', icon: Home, label: 'Jogos' },
        { path: '/comunidade', icon: Users, label: 'Comunidade' },
        { path: '/clubes', icon: PadelIcon, label: 'Clubes' },
        { path: '/rankings', icon: Trophy, label: 'Rankings' },
        { path: '/perfil', icon: User, label: 'Perfil' },
      ]
```

- [ ] **Step 4: Render the real avatar for the Perfil item (`src/components/Layout.jsx:212-227`)**

Replace:

```jsx
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path
            return (
              <Link
                key={path}
                to={path}
                aria-current={isActive ? 'page' : undefined}
                aria-label={label}
                className={`flex items-center justify-center gap-1.5 h-12 rounded-full
                            transition-all duration-base ${
                  isActive
                    ? 'bg-white/15 text-lime-400 px-4'
                    : 'text-ink-200 hover:text-white w-12'
                }`}
              >
                <Icon size={20} strokeWidth={2} className="shrink-0" />
```

with:

```jsx
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path
            const isPerfil = path === '/perfil'
            return (
              <Link
                key={path}
                to={path}
                aria-current={isActive ? 'page' : undefined}
                aria-label={label}
                className={`flex items-center justify-center gap-1.5 h-12 rounded-full
                            transition-all duration-base ${
                  isActive
                    ? 'bg-white/15 text-lime-400 px-4'
                    : 'text-ink-200 hover:text-white w-12'
                }`}
              >
                {isPerfil ? (
                  <Avatar
                    name={profile?.name}
                    url={profile?.avatar_url}
                    size="w-6 h-6 text-[10px]"
                    colorClass="bg-ink-700 text-white"
                  />
                ) : (
                  <Icon size={20} strokeWidth={2} className="shrink-0" />
                )}
```

(The rest of the `.map()` body — the `<span>` label — stays exactly as-is.)

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Manual check in the browser**

Run: `npm run dev`, then in the browser:
1. Log in as a non-guest member with an avatar photo already set (or set one first via `/perfil` if none exists).
2. Confirm the bottom nav pill now shows 5 icons in order: house (Jogos), people (Comunidade), padel racket (Clubes), trophy (Rankings), the user's own photo (Perfil) — not a generic silhouette.
3. Tap each of the 5 icons in turn; confirm each navigates to its route (`/`, `/comunidade`, `/clubes`, `/rankings`, `/perfil`) and shows the active-state pill (background highlight + label text) correctly, including for the avatar item.
4. Log out and log back in as a guest (or check with `isGuest` test data); confirm the guest nav still shows only Jogos + Perfil, unchanged.
5. If testing with an admin account, confirm the Admin icon still appears appended after Perfil.

- [ ] **Step 7: Commit**

```bash
git add src/components/icons/PadelIcon.jsx src/components/Layout.jsx
git commit -m "feat: expand bottom nav to 5 items and show real avatar for Perfil"
```

---

### Task 4: Rankings tab reorder/rename

**Files:**
- Modify: `src/pages/Rankings.jsx` (lines 10-19 only)

**Interfaces:**
- No new interfaces — this task only changes the `TABS` array contents/order and the initial `useState` value. All `tab === 'geral'`, `tab === 'mensal'`, `tab === 'mixes'`, `tab === 'global'` conditionals elsewhere in the file (lines 223, 329, 397, 414) are unchanged and keep working since the `key` values are untouched.

- [ ] **Step 1: Update the `TABS` array (`src/pages/Rankings.jsx:10-15`)**

Replace:

```js
const TABS = [
  { key: 'geral', label: 'Geral' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'mixes', label: 'Mixes' },
  { key: 'global', label: 'Global' },
]
```

with:

```js
const TABS = [
  { key: 'global', label: 'Geral' },
  { key: 'geral', label: 'Por Clube' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'mixes', label: 'Mixes' },
]
```

- [ ] **Step 2: Update the default tab (`src/pages/Rankings.jsx:19`)**

Replace:

```js
  const [tab, setTab] = useState('geral')
```

with:

```js
  const [tab, setTab] = useState('global')
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev`, then in the browser:
1. Log in as a non-guest member.
2. Navigate to `/rankings` (or tap the Rankings nav item from Task 3).
3. Confirm the tab bar shows, in order: "Geral", "Por Clube", "Mensal", "Mixes".
4. Confirm "Geral" is selected by default and shows the same cross-club data the old "Global" tab showed (rows without club-points/private-points breakdown unaffected — this is a pure relabel, verify the content matches what "Global" used to show before this change).
5. Click "Por Clube"; confirm it shows the same club-scoped season ranking the old "Geral" tab showed.
6. Click "Mensal" and "Mixes"; confirm both are unchanged from before.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Rankings.jsx
git commit -m "feat: reorder and relabel Rankings tabs (Geral/Por Clube first)"
```

---

## Self-Review Notes

- **Spec coverage:** All 5 spec sections have a task — nav items 1&5 (Jogos/Perfil unchanged content, Task 3 handles the avatar swap and item ordering), Comunidade (Task 1), Clubes/Cortes (Task 2), Rankings reorder (Task 4), guests/admin unchanged (verified in Task 3 step 6). "Out of scope" items are deliberately not tasked.
- **Placeholder scan:** No TBD/TODO; Clubes' "Em breve" is the spec's intended placeholder content, not an unfinished plan step.
- **Type/signature consistency:** `PadelIcon` is used as `icon: PadelIcon` in `navItems` and rendered via `<Icon size={20} strokeWidth={2} .../>` in the existing loop for non-Perfil items — `PadelIcon` ignores an unused `strokeWidth` prop harmlessly (extra prop on a function component, no runtime error) and honors `size`, so no signature mismatch. `Avatar`'s prop names (`name`, `url`, `size`, `colorClass`) match its existing definition in `ui.jsx:435` exactly.
