# Liga entre Clubes — Fase 1 (liga por jornadas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clubes inscrevem-se numa liga (comunitária ou Liga Alinho), jogam encontros por jornadas, submetem/confirmam/contestam resultados, e a tabela, o ranking e o XP atualizam-se — tudo na Home e numa página de liga, sem separador novo.

**Architecture:** Entidade nova em Postgres (`leagues` + 9 tabelas), todas as escritas por RPCs `SECURITY DEFINER` com a autorização lá dentro; leitura pública por RPCs que devolvem só colunas seguras. Lógica pura em `src/lib/league*.js` (vitest): o calendário calcula-se em JS e o servidor **valida-o** antes de gravar; a tabela calcula-se em JS a partir **só** dos encontros oficiais que o servidor devolve (ninguém grava a tabela). O ranking reaproveita `apply_elo_pairing` com o mesmo padrão de reverter/reaplicar de `migration_group_matches.sql`.

**Tech Stack:** Vite + React 18 + React Router + Tailwind, Supabase (Postgres/RLS/RPC, `pg_cron`), vitest, react-i18next (pt + en).

**Spec:** `docs/superpowers/specs/2026-10-16-liga-entre-clubes-design.md` · Mockups: https://claude.ai/artifact/6nJGNezXkoQxU4B2dDLjqx · Desenho: `DESIGN.md` (16 out).

## Global Constraints

- Trabalho só no branch `feature/liga-entre-clubes` (worktree `C:\Users\Renato Cruz\padeleirosrobot-liga`). **Nunca** fazer push para `dev` nem `main` — Renato decide quando.
- Cada migração `supabase/migration_liga_*.sql` é corrida **à mão** pelo Renato no SQL Editor da **alinho-dev**. Um ficheiro no repo não é uma migração corrida: cada tarefa de SQL termina com o pedido explícito para a correr e com o script de teste a correr depois.
- A liga é uma entidade nova: não tocar em `games`, `tournament_*`, `group_matches`.
- Nomes de tabelas/colunas em inglês; textos da app em pt-PT (com `en.json` ao lado); comentários no estilo do repo (pt-PT, com data e quem decidiu).
- Copy: «Liga Alinho» (nunca «Oficial»); «ranking»/«nível», nunca «Elo»; «A decorrer», nunca «ao vivo»; etiquetas de 1 a 3 palavras; aspas «»; sem abreviaturas («meia-final 2», não «MF2»).
- Desenho (`DESIGN.md`): fundo `#F1F2EE`, cartões brancos; **uma** ação lima por ecrã (a de quem joga); ações de quem organiza a preto; secundária em contorno; botões empilhados a toda a largura; vermelho só para destruir (texto sublinhado → `ConfirmSheet` com `danger`); «é contigo» = borda lima de 2 px + pastilha «✓ …»; cor do tipo `league` (`KIND_COLORS.league`) nunca num botão.
- Tipo `league` já existe em `src/lib/kindColors.js`, `KIND_HERO.league`, `KIND_STYLE.league` e `agenda.kind_league` — reaproveitar, não recriar.
- Género nas categorias usa os mesmos valores dos torneios: `'masculino' | 'feminino' | 'misto'`; nível 1–7 (7 = Iniciante) e `categoryCode()` de `src/lib/tournaments.js`.
- Jogos da liga contam para o ranking global (`profiles.rating`) e para `player_stats` do clube que o jogador representa (Renato, 16 out).
- Mockups e testes só com dados fictícios (Maré Alta Padel, Serra Azul Padel, Rita Figueira, Tiago Lopes…).

## Review Focus

1. **A mesma pessoa é admin dos dois clubes de um encontro** → não pode submeter e confirmar sozinha; tem de ir para o organizador (`conflict_of_interest`). Teste em Task 9.
2. **Duas candidaturas aprovadas ao mesmo tempo para o último lugar** → só uma passa (`category_full`); a lotação lê-se com a categoria trancada (`FOR UPDATE`). Teste em Task 7.
3. **Resultado corrigido pelo organizador depois de oficial** → o ranking é revertido e reaplicado uma vez só; a tabela muda sem pontos duplicados; o XP não é retirado (é monotónico) e não duplica. Teste em Task 9.
4. **Jogador que é membro de dois clubes** → só pode estar no plantel de um clube por liga (`already_in_league`), mesmo se tentarem pelos dois lados ao mesmo tempo (índice único). Teste em Task 7.
5. **Pessoa sem sessão abre o link da liga** → vê nome, categorias, equipas aprovadas, calendário e tabela; nunca emails, telefones, Elo exato ou candidaturas pendentes. Teste em Task 10.

---

## File Structure

**Lógica pura (vitest)**
- `src/lib/leagueSchedule.js` — todos contra todos (método do círculo), casa e fora, janelas das jornadas.
- `src/lib/leagueResult.js` — validar sets, vencedor da partida, totais do encontro.
- `src/lib/leagueStandings.js` — tabela + desempates + sorteio determinístico.
- `src/lib/leagueEligibility.js` — género, nível com tolerância, problemas de plantel e de escalação.
- `src/lib/leagueConfig.js` — regras da categoria válidas.
- `src/lib/leagueApi.js` — chamadas às RPCs (sem lógica).
- `src/lib/leagueAgenda.js` — encontros e ligas para a Home.

**SQL (corrido à mão, por esta ordem)**
- `supabase/migration_liga_1_base.sql` — tabelas, índices, RLS, funções de acesso, `organizations.district`.
- `supabase/migration_liga_2_ciclo.sql` — criar/editar/publicar/cancelar, categorias, organizadores, avisos.
- `supabase/migration_liga_3_inscricoes.sql` — candidaturas, capitães, plantel.
- `supabase/migration_liga_4_calendario.sql` — gravar calendário validado, marcar data.
- `supabase/migration_liga_5_resultados.sql` — resultado, confirmar/contestar/resolver, ranking + XP, fechar categoria.
- `supabase/migration_liga_6_leitura.sql` — RPCs de leitura (página, encontro, equipa, Home) + lembretes `pg_cron`.
- `supabase/tests/liga_*.sql` — testes corridos na alinho-dev dentro de `BEGIN … ROLLBACK`.

**UI**
- `src/pages/LeaguePage.jsx` (`/liga/:slug`), `src/pages/LeagueEncounterPage.jsx` (`/liga/:slug/encontro/:id`), `src/pages/LeagueResultPage.jsx` (`/liga/:slug/encontro/:id/resultado`), `src/pages/LeagueTeamPage.jsx` (`/liga/:slug/equipa/:teamId`), `src/pages/LeagueManagePage.jsx` (`/liga/:slug/gerir`), `src/pages/CreateLeaguePage.jsx` (`/gerir/:slug/criar/liga`).
- `src/components/league/StandingsTable.jsx`, `EncounterRow.jsx`, `LeagueEventCard.jsx`, `LeagueNoticeRow.jsx`.
- Alterados: `src/App.jsx`, `src/lib/agenda.js`, `src/pages/Home.jsx`, `src/components/home/ForYouLine.jsx`, `src/components/gerir/CreateKindSheet.jsx` (+ quem a chama), `src/components/Layout.jsx`, `src/locales/pt.json`, `src/locales/en.json`, `FEATURES.md`.

---

### Task 1: Calendário — todos contra todos

**Files:**
- Create: `src/lib/leagueSchedule.js`
- Test: `src/lib/leagueSchedule.test.js`

**Interfaces:**
- Produces: `roundRobin(teamIds: string[], { homeAway?: boolean }) → Array<Array<{ home: string, away: string }>>`; `roundWindows(count: number, firstStart: 'AAAA-MM-DD', days: number) → Array<{ number, start, end }>` (datas 'AAAA-MM-DD', `end` incluído).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueSchedule.test.js
import { describe, it, expect } from 'vitest'
import { roundRobin, roundWindows } from './leagueSchedule'

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`)
const pairKey = ({ home, away }) => [home, away].sort().join('|')

describe('todos contra todos', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 11, 12])('com %i equipas: cada par joga uma vez e ninguém joga duas vezes na mesma jornada', (n) => {
    const rounds = roundRobin(ids(n))
    expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n)
    const seen = new Set()
    for (const r of rounds) {
      const inRound = r.flatMap((p) => [p.home, p.away])
      expect(new Set(inRound).size).toBe(inRound.length)
      for (const p of r) { expect(seen.has(pairKey(p))).toBe(false); seen.add(pairKey(p)) }
    }
    expect(seen.size).toBe((n * (n - 1)) / 2)
  })

  it('equilibra os jogos em casa: no máximo 1 de diferença entre casa e fora', () => {
    for (const n of [4, 6, 8, 10]) {
      const home = {}, games = {}
      for (const r of roundRobin(ids(n))) for (const p of r) {
        home[p.home] = (home[p.home] || 0) + 1
        games[p.home] = (games[p.home] || 0) + 1
        games[p.away] = (games[p.away] || 0) + 1
      }
      for (const t of ids(n)) expect(Math.abs(2 * (home[t] || 0) - games[t])).toBeLessThanOrEqual(1)
    }
  })

  it('com número ímpar há uma equipa de folga por jornada', () => {
    for (const r of roundRobin(ids(5))) expect(r).toHaveLength(2)
  })

  it('casa e fora: a segunda volta repete os jogos com casa e fora trocados', () => {
    const rounds = roundRobin(ids(4), { homeAway: true })
    expect(rounds).toHaveLength(6)
    const ordered = new Set(rounds.flat().map((p) => `${p.home}>${p.away}`))
    expect(ordered.size).toBe(12)
    expect(rounds[3]).toEqual(rounds[0].map((p) => ({ home: p.away, away: p.home })))
  })

  it('menos de 2 equipas não dá calendário', () => {
    expect(roundRobin(['t1'])).toEqual([])
  })
})

describe('janelas das jornadas', () => {
  it('jornadas seguidas de N dias, com o último dia incluído', () => {
    expect(roundWindows(3, '2026-11-03', 14)).toEqual([
      { number: 1, start: '2026-11-03', end: '2026-11-16' },
      { number: 2, start: '2026-11-17', end: '2026-11-30' },
      { number: 3, start: '2026-12-01', end: '2026-12-14' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/leagueSchedule.test.js`
Expected: FAIL — `Failed to resolve import "./leagueSchedule"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/leagueSchedule.js
// O calendário de uma categoria da liga (Liga entre Clubes, Fase 1 — spec
// 2026-10-16). Método do círculo: uma equipa fica parada e as outras rodam.
// Calcula-se aqui e o servidor (save_league_schedule) só VALIDA o que recebe:
// cada par joga uma vez (duas em casa e fora) e ninguém joga duas vezes na
// mesma jornada. Verificado de 2 a 14 equipas: a diferença casa/fora nunca
// passa de 1.

/** Jornadas: [[{ home, away }, …], …]. Com número ímpar, uma folga por jornada. */
export function roundRobin(teamIds, { homeAway = false } = {}) {
  const ids = [...teamIds]
  if (ids.length < 2) return []
  if (ids.length % 2 === 1) ids.push(null) // a folga
  const n = ids.length
  let arr = ids.slice()
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a === null || b === null) continue
      // A equipa parada alterna casa e fora; as outras ficam equilibradas
      // pela própria rotação.
      const swap = i === 0 && r % 2 === 1
      pairs.push(swap ? { home: b, away: a } : { home: a, away: b })
    }
    rounds.push(pairs)
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)]
  }
  if (!homeAway) return rounds
  return [...rounds, ...rounds.map((pairs) => pairs.map(({ home, away }) => ({ home: away, away: home })))]
}

const addDays = (dayKey, days) => {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** As janelas: a jornada N começa N-1 períodos depois da primeira. */
export function roundWindows(count, firstStart, days) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    start: addDays(firstStart, i * days),
    end: addDays(firstStart, (i + 1) * days - 1),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/leagueSchedule.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leagueSchedule.js src/lib/leagueSchedule.test.js
git commit -m "Liga: calendário todos contra todos (casa e fora, folgas, janelas)"
```

---

### Task 2: Resultado de partidas e encontros

**Files:**
- Create: `src/lib/leagueResult.js`
- Test: `src/lib/leagueResult.test.js`

**Interfaces:**
- Produces: `setProblem(set: [number, number], decider?: boolean) → string|null`; `matchWinner(sets) → { winner: 'home'|'away' } | { problem: string }`; `encounterTotals(matches: Array<{ sets }>) → { homeMatches, awayMatches, homeSets, awaySets, homeGames, awayGames }`.
- Códigos de problema (iguais aos do SQL da Task 9): `set_invalid`, `sets_count`, `sets_after_win`, `no_winner`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueResult.test.js
import { describe, it, expect } from 'vitest'
import { setProblem, matchWinner, encounterTotals } from './leagueResult'

describe('sets', () => {
  it('aceita 6–0 a 6–4, 7–5 e 7–6', () => {
    for (const s of [[6, 0], [6, 4], [4, 6], [7, 5], [6, 7]]) expect(setProblem(s)).toBeNull()
  })
  it('recusa 6–5, 7–3, 8–6 e números estranhos', () => {
    for (const s of [[6, 5], [7, 3], [8, 6], [-1, 6], [6.5, 3], [6]]) expect(setProblem(s)).toBe('set_invalid')
  })
  it('o 3.º set pode ser super tie-break a 10, com 2 de diferença', () => {
    expect(setProblem([10, 8], true)).toBeNull()
    expect(setProblem([12, 10], true)).toBeNull()
    expect(setProblem([10, 9], true)).toBe('set_invalid')
    expect(setProblem([13, 10], true)).toBe('set_invalid')
    expect(setProblem([10, 8], false)).toBe('set_invalid')
  })
})

describe('partida', () => {
  it('ganha quem faz 2 sets', () => {
    expect(matchWinner([[6, 4], [6, 3]])).toEqual({ winner: 'home' })
    expect(matchWinner([[6, 4], [3, 6], [8, 10]])).toEqual({ winner: 'away' })
  })
  it('recusa sets a mais, a menos ou sem vencedor', () => {
    expect(matchWinner([[6, 4]])).toEqual({ problem: 'sets_count' })
    expect(matchWinner([[6, 4], [6, 3], [6, 1]])).toEqual({ problem: 'sets_after_win' })
    expect(matchWinner([[6, 4], [3, 6]])).toEqual({ problem: 'no_winner' })
  })
})

describe('encontro', () => {
  it('soma partidas, sets e jogos; o super tie-break vale 1 jogo', () => {
    const t = encounterTotals([
      { sets: [[4, 6], [3, 6]] },
      { sets: [[6, 3], [4, 6], [10, 8]] },
      { sets: [[5, 7], [2, 6]] },
    ])
    expect(t).toEqual({ homeMatches: 1, awayMatches: 2, homeSets: 2, awaySets: 5, homeGames: 25, awayGames: 34 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/leagueResult.test.js`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/leagueResult.js
// O resultado de uma partida e de um encontro (Liga entre Clubes, Fase 1).
// Uma partida é à melhor de 3 sets; o 3.º pode ser super tie-break (a 10).
// Um set é [jogos da casa, jogos de fora]. O servidor faz a mesma validação
// em league_match_winner (migration_liga_5_resultados.sql) — os códigos de
// erro são os mesmos dos dois lados.

/** O problema de um set, ou null. `decider`: é o 3.º set. */
export function setProblem(set, decider = false) {
  if (!Array.isArray(set) || set.length !== 2) return 'set_invalid'
  const [h, a] = set
  if (![h, a].every((x) => Number.isInteger(x) && x >= 0)) return 'set_invalid'
  const hi = Math.max(h, a)
  const lo = Math.min(h, a)
  if (decider && hi >= 10) return hi - lo >= 2 && (hi === 10 || hi - lo === 2) ? null : 'set_invalid'
  if (hi === 6 && lo <= 4) return null
  if (hi === 7 && (lo === 5 || lo === 6)) return null
  return 'set_invalid'
}

/** { winner: 'home'|'away' } ou { problem }. */
export function matchWinner(sets) {
  if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) return { problem: 'sets_count' }
  let h = 0
  let a = 0
  for (let i = 0; i < sets.length; i++) {
    if (h === 2 || a === 2) return { problem: 'sets_after_win' }
    const p = setProblem(sets[i], i === 2)
    if (p) return { problem: p }
    if (sets[i][0] > sets[i][1]) h++
    else a++
  }
  if (h < 2 && a < 2) return { problem: 'no_winner' }
  return { winner: h > a ? 'home' : 'away' }
}

/** Os totais de um encontro (partidas já validadas). O super tie-break conta
 *  como set e como 1 jogo para quem o ganha. */
export function encounterTotals(matches) {
  const t = { homeMatches: 0, awayMatches: 0, homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0 }
  for (const m of matches) {
    const { winner } = matchWinner(m.sets)
    if (winner === 'home') t.homeMatches++
    else if (winner === 'away') t.awayMatches++
    m.sets.forEach(([h, a], i) => {
      if (h > a) t.homeSets++
      else t.awaySets++
      if (i === 2 && Math.max(h, a) >= 10) {
        if (h > a) t.homeGames++
        else t.awayGames++
      } else {
        t.homeGames += h
        t.awayGames += a
      }
    })
  }
  return t
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/leagueResult.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leagueResult.js src/lib/leagueResult.test.js
git commit -m "Liga: validar sets e somar partidas, sets e jogos de um encontro"
```

---

### Task 3: Tabela e desempates

**Files:**
- Create: `src/lib/leagueStandings.js`
- Test: `src/lib/leagueStandings.test.js`

**Interfaces:**
- Consumes: `encounterTotals` (Task 2).
- Produces: `leagueStandings(teams, results, rules, seed) → Array<Row>` com `Row = { teamId, name, played, won, drawn, lost, matchesFor, matchesAgainst, setsFor, setsAgainst, gamesFor, gamesAgainst, points, position, decidedBy: null|'h2h'|'matches'|'sets'|'games'|'lot' }`; `resultsFromEncounters(encounters, matchesPerEncounter) → results[]` (converte o que `get_league_page` devolve); `TIEBREAK_ORDER`; `lotKey(seed, teamId) → number`.
- `encounters` vindos do servidor: `{ home_team_id, away_team_id, status, walkover_team_id, sets: Array<sets>|null }`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueStandings.test.js
import { describe, it, expect } from 'vitest'
import { leagueStandings, resultsFromEncounters, lotKey } from './leagueStandings'

const R = { win: 3, draw: 1, loss: 0, walkover: -1 }
const res = (h, a, hm, am) => ({
  homeId: h, awayId: a, homeMatches: hm, awayMatches: am,
  homeSets: hm * 2, awaySets: am * 2, homeGames: hm * 12, awayGames: am * 12,
  walkoverTeamId: null, matchesPerEncounter: 3,
})
const teams = (...ids) => ids.map((id) => ({ id, name: id }))

describe('tabela', () => {
  it('vitória 3, empate 1, derrota 0', () => {
    const s = leagueStandings(teams('A', 'B', 'C'),
      [res('A', 'B', 2, 1), { ...res('B', 'C', 1, 1), matchesPerEncounter: 2 }], R, 'cat')
    expect(s[0]).toMatchObject({ teamId: 'A', points: 3, won: 1, played: 1 })
    expect(s.find((r) => r.teamId === 'B')).toMatchObject({ points: 1, drawn: 1, lost: 1, played: 2 })
  })

  it('confronto direto vence a diferença de partidas', () => {
    const s = leagueStandings(teams('A', 'B', 'C', 'D'), [
      res('A', 'C', 3, 0), res('A', 'D', 3, 0), res('B', 'A', 2, 1), res('C', 'B', 3, 0), res('B', 'D', 2, 1),
    ], R, 'cat')
    expect(s.map((r) => r.teamId)).toEqual(['B', 'A', 'C', 'D'])
    expect(s[0].decidedBy).toBe('h2h')
    expect(s[2].decidedBy).toBeNull()
  })

  it('empate a três com confronto direto igual passa à diferença de partidas', () => {
    const s = leagueStandings(teams('A', 'B', 'C'), [res('A', 'C', 3, 0), res('B', 'A', 2, 1), res('C', 'B', 2, 1)], R, 'cat')
    expect(s.map((r) => r.teamId)).toEqual(['A', 'B', 'C'])
    expect(s.every((r) => r.decidedBy === 'matches')).toBe(true)
  })

  it('falta de comparência: quem faltou leva -1 e o outro ganha todas as partidas', () => {
    const s = leagueStandings(teams('A', 'B'), [{ ...res('A', 'B', 0, 0), walkoverTeamId: 'B' }], R, 'cat')
    expect(s.find((r) => r.teamId === 'A')).toMatchObject({ points: 3, matchesFor: 3 })
    expect(s.find((r) => r.teamId === 'B')).toMatchObject({ points: -1, matchesAgainst: 3 })
  })

  it('tudo igual: sorteio sempre igual para a mesma categoria', () => {
    const a = leagueStandings(teams('A', 'B', 'C'), [], R, 'x').map((r) => r.teamId)
    const b = leagueStandings(teams('C', 'A', 'B'), [], R, 'x').map((r) => r.teamId)
    expect(a).toEqual(b)
    expect(lotKey('x', 'A')).toBe(lotKey('x', 'A'))
  })
})

describe('do servidor para a tabela', () => {
  it('só entram encontros oficiais, com totais calculados das partidas', () => {
    const r = resultsFromEncounters([
      { home_team_id: 'A', away_team_id: 'B', status: 'oficial', walkover_team_id: null, sets: [[[6, 4], [6, 4]], [[4, 6], [4, 6]], [[6, 1], [6, 1]]] },
      { home_team_id: 'B', away_team_id: 'A', status: 'submetido', walkover_team_id: null, sets: null },
      { home_team_id: 'C', away_team_id: 'A', status: 'oficial', walkover_team_id: 'C', sets: null },
    ], 3)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ homeId: 'A', awayId: 'B', homeMatches: 2, awayMatches: 1 })
    expect(r[1]).toMatchObject({ homeId: 'C', walkoverTeamId: 'C', matchesPerEncounter: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/leagueStandings.test.js`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/leagueStandings.js
// A tabela de uma categoria da liga (Fase 1, spec 2026-10-16). Só entra o
// que é oficial — get_league_page só manda as partidas dos encontros com
// status 'oficial'. Ninguém grava a tabela: calcula-se sempre daqui, por isso
// corrigir um resultado nunca deixa pontos a mais nem a menos.
//
// Desempate (spec): pontos → confronto direto (só entre as empatadas) →
// diferença de partidas → de sets → de jogos → sorteio que dá sempre o mesmo
// resultado para a mesma categoria.
import { encounterTotals } from './leagueResult'

export const TIEBREAK_ORDER = ['points', 'h2h', 'matches', 'sets', 'games', 'lot']

/** FNV-1a de 32 bits: o «sorteio» determinístico. */
export function lotKey(seed, teamId) {
  let h = 0x811c9dc5
  const s = `${seed}:${teamId}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const blank = (team) => ({
  teamId: team.id, name: team.name, played: 0, won: 0, drawn: 0, lost: 0,
  matchesFor: 0, matchesAgainst: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0,
  points: 0, decidedBy: null,
})

function applyResult(row, r, side, rules) {
  const other = side === 'home' ? 'away' : 'home'
  row.played++
  if (r.walkoverTeamId) {
    if (r.walkoverTeamId === row.teamId) {
      row.lost++
      row.points += rules.walkover
      row.matchesAgainst += r.matchesPerEncounter
    } else {
      row.won++
      row.points += rules.win
      row.matchesFor += r.matchesPerEncounter
    }
    return
  }
  const mf = r[`${side}Matches`]
  const ma = r[`${other}Matches`]
  row.matchesFor += mf
  row.matchesAgainst += ma
  row.setsFor += r[`${side}Sets`]
  row.setsAgainst += r[`${other}Sets`]
  row.gamesFor += r[`${side}Games`]
  row.gamesAgainst += r[`${other}Games`]
  if (mf > ma) { row.won++; row.points += rules.win } else if (mf < ma) { row.lost++; row.points += rules.loss } else { row.drawn++; row.points += rules.draw }
}

function table(teams, results, rules) {
  const rows = new Map(teams.map((t) => [t.id, blank(t)]))
  for (const r of results) {
    if (rows.has(r.homeId)) applyResult(rows.get(r.homeId), r, 'home', rules)
    if (rows.has(r.awayId)) applyResult(rows.get(r.awayId), r, 'away', rules)
  }
  return rows
}

export function leagueStandings(teams, results, rules, seed) {
  const all = table(teams, results, rules)
  const key = {
    points: (row) => row.points,
    matches: (row) => row.matchesFor - row.matchesAgainst,
    sets: (row) => row.setsFor - row.setsAgainst,
    games: (row) => row.gamesFor - row.gamesAgainst,
    lot: (row) => lotKey(seed, row.teamId),
  }
  const order = (group, idx) => {
    if (group.length < 2 || idx >= TIEBREAK_ORDER.length) return group
    const name = TIEBREAK_ORDER[idx]
    let score = key[name]
    if (name === 'h2h') {
      const ids = new Set(group.map((g) => g.teamId))
      const mini = table(group.map((g) => ({ id: g.teamId, name: g.name })),
        results.filter((r) => ids.has(r.homeId) && ids.has(r.awayId)), rules)
      score = (row) => mini.get(row.teamId).points
    }
    const buckets = new Map()
    for (const row of group) {
      const k = score(row)
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(row)
    }
    const keys = [...buckets.keys()].sort((a, b) => b - a)
    if (idx > 0 && keys.length > 1) for (const row of group) row.decidedBy ??= name
    return keys.flatMap((k) => order(buckets.get(k), idx + 1))
  }
  return order([...all.values()], 0).map((row, i) => ({ ...row, position: i + 1 }))
}

/** Os encontros de get_league_page → resultados para a tabela. */
export function resultsFromEncounters(encounters, matchesPerEncounter) {
  return encounters
    .filter((e) => e.status === 'oficial')
    .map((e) => ({
      homeId: e.home_team_id,
      awayId: e.away_team_id,
      walkoverTeamId: e.walkover_team_id || null,
      matchesPerEncounter,
      ...(e.walkover_team_id
        ? { homeMatches: 0, awayMatches: 0, homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0 }
        : encounterTotals((e.sets || []).map((sets) => ({ sets })))),
    }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/leagueStandings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leagueStandings.js src/lib/leagueStandings.test.js
git commit -m "Liga: tabela com confronto direto, diferenças e sorteio determinístico"
```

---

### Task 4: Elegibilidade e regras da categoria

**Files:**
- Create: `src/lib/leagueEligibility.js`, `src/lib/leagueConfig.js`
- Test: `src/lib/leagueEligibility.test.js`, `src/lib/leagueConfig.test.js`

**Interfaces:**
- Produces (eligibility): `maxRatingForLevel(level: 1..7) → number` (Infinity no nível 1); `playerProblem(category, player, { inLeague }) → null|'already_in_league'|'gender_missing'|'gender'|'level'` com `category = { gender, level, rating_tolerance }`, `player = { gender, rating }`; `lineupProblem(category, lineups, { rosterIds, genders }) → null|'incomplete'|'not_in_roster'|'player_twice'|'pair_gender'` com `lineups = [{ p1, p2 }]` de um lado.
- Produces (config): `CATEGORY_DEFAULTS`; `categoryProblem(cat) → null|código`. Códigos iguais aos do SQL (Task 6): `level_invalid`, `tolerance_invalid`, `matches_invalid`, `points_invalid`, `roster_max_invalid`, `lock_round_invalid`.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/leagueEligibility.test.js
import { describe, it, expect } from 'vitest'
import { maxRatingForLevel, playerProblem, lineupProblem } from './leagueEligibility'

const M4 = { gender: 'masculino', level: 4, rating_tolerance: 50 }
const MX4 = { gender: 'misto', level: 4, rating_tolerance: 50 }

describe('nível', () => {
  it('o teto de cada nível é o início do nível de cima (bandas do ranking)', () => {
    expect(maxRatingForLevel(4)).toBe(1400)
    expect(maxRatingForLevel(6)).toBe(1000)
    expect(maxRatingForLevel(7)).toBe(700)
    expect(maxRatingForLevel(1)).toBe(Infinity)
  })
  it('entra até ao teto mais a tolerância (estrito)', () => {
    expect(playerProblem(M4, { gender: 'masculino', rating: 1449 }, { inLeague: false })).toBeNull()
    expect(playerProblem(M4, { gender: 'masculino', rating: 1450 }, { inLeague: false })).toBe('level')
    expect(playerProblem(M4, { gender: 'masculino', rating: 800 }, { inLeague: false })).toBeNull()
  })
})

describe('jogador', () => {
  it('um clube por liga', () => {
    expect(playerProblem(M4, { gender: 'masculino', rating: 1200 }, { inLeague: true })).toBe('already_in_league')
  })
  it('género', () => {
    expect(playerProblem(M4, { gender: 'feminino', rating: 1200 }, { inLeague: false })).toBe('gender')
    expect(playerProblem(M4, { gender: null, rating: 1200 }, { inLeague: false })).toBe('gender_missing')
    expect(playerProblem(MX4, { gender: 'feminino', rating: 1200 }, { inLeague: false })).toBeNull()
  })
})

describe('escalação de um lado', () => {
  const opts = { rosterIds: new Set(['a', 'b', 'c', 'd', 'e', 'f']), genders: { a: 'masculino', b: 'feminino', c: 'masculino', d: 'feminino', e: 'masculino', f: 'masculino' } }
  it('3 duplas completas, todas do plantel, ninguém repetido', () => {
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'c' }, { p1: 'e', p2: 'f' }], { ...opts, rosterIds: opts.rosterIds })).toBeNull()
  })
  it('apanha falta de jogador, fora do plantel e repetidos', () => {
    expect(lineupProblem(M4, [{ p1: 'a', p2: null }], opts)).toBe('incomplete')
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'z' }], opts)).toBe('not_in_roster')
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'c' }, { p1: 'a', p2: 'e' }], opts)).toBe('player_twice')
  })
  it('misto: um homem e uma mulher em cada dupla', () => {
    expect(lineupProblem(MX4, [{ p1: 'a', p2: 'b' }], opts)).toBeNull()
    expect(lineupProblem(MX4, [{ p1: 'a', p2: 'c' }], opts)).toBe('pair_gender')
  })
})
```

```js
// src/lib/leagueConfig.test.js
import { describe, it, expect } from 'vitest'
import { CATEGORY_DEFAULTS, categoryProblem } from './leagueConfig'

const ok = { ...CATEGORY_DEFAULTS, gender: 'masculino', level: 4 }

describe('regras da categoria', () => {
  it('os valores por omissão são válidos', () => {
    expect(categoryProblem(ok)).toBeNull()
  })
  it('recusa combinações impossíveis', () => {
    expect(categoryProblem({ ...ok, level: 8 })).toBe('level_invalid')
    expect(categoryProblem({ ...ok, rating_tolerance: 300 })).toBe('tolerance_invalid')
    expect(categoryProblem({ ...ok, matches_per_encounter: 4 })).toBe('matches_invalid')
    expect(categoryProblem({ ...ok, points_win: 1, points_draw: 1 })).toBe('points_invalid')
    expect(categoryProblem({ ...ok, points_loss: 0, points_walkover: 1 })).toBe('points_invalid')
    // o plantel tem de dar para 3 partidas (6 jogadores)
    expect(categoryProblem({ ...ok, matches_per_encounter: 3, roster_max: 5 })).toBe('roster_max_invalid')
    expect(categoryProblem({ ...ok, roster_locks_at_round: 0 })).toBe('lock_round_invalid')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/leagueEligibility.test.js src/lib/leagueConfig.test.js`
Expected: FAIL — imports não resolvem.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/leagueEligibility.js
// Quem pode jogar numa categoria da liga (Fase 1, spec 2026-10-16). O mesmo
// é verificado no servidor (add_to_roster, league_save_matches): aqui é só
// para o ecrã dizer porquê antes de tentar.
//
// Nível: o ranking do jogador NO DIA em que entra no plantel (fica gravado em
// league_roster.rating_at_entry) tem de estar abaixo do início do nível de
// cima, mais a tolerância da categoria. Quem sobe durante a liga continua.

// Os inícios das bandas (src/lib/elo.js, BANDS): nível N acaba onde começa N-1.
const LEVEL_CEILING = { 2: 1800, 3: 1600, 4: 1400, 5: 1200, 6: 1000, 7: 700 }

export const maxRatingForLevel = (level) => (level <= 1 ? Infinity : LEVEL_CEILING[level])

/** O problema de pôr este jogador no plantel, ou null. */
export function playerProblem(category, player, { inLeague }) {
  if (inLeague) return 'already_in_league'
  if (!player.gender) return 'gender_missing'
  if (category.gender !== 'misto' && player.gender !== category.gender) return 'gender'
  const rating = player.rating ?? 900
  if (rating >= maxRatingForLevel(category.level) + (category.rating_tolerance ?? 0)) return 'level'
  return null
}

/** O problema das duplas de UM lado de um encontro, ou null. */
export function lineupProblem(category, lineups, { rosterIds, genders }) {
  const used = new Set()
  for (const { p1, p2 } of lineups) {
    if (!p1 || !p2 || p1 === p2) return 'incomplete'
    if (!rosterIds.has(p1) || !rosterIds.has(p2)) return 'not_in_roster'
    if (used.has(p1) || used.has(p2)) return 'player_twice'
    used.add(p1)
    used.add(p2)
    const g = [genders[p1], genders[p2]]
    if (category.gender === 'misto' ? !(g.includes('masculino') && g.includes('feminino')) : g.some((x) => x !== category.gender)) return 'pair_gender'
  }
  return null
}
```

```js
// src/lib/leagueConfig.js
// As regras de uma categoria da liga (Fase 1). Os mesmos limites estão em
// upsert_league_category (migration_liga_2_ciclo.sql) — o servidor manda.

export const CATEGORY_DEFAULTS = {
  rating_tolerance: 50,
  matches_per_encounter: 3,
  home_away: false,
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  points_walkover: -1,
  roster_max: 12,
  roster_locks_at_round: 3,
}

export function categoryProblem(c) {
  if (!Number.isInteger(c.level) || c.level < 1 || c.level > 7) return 'level_invalid'
  if (!Number.isInteger(c.rating_tolerance) || c.rating_tolerance < 0 || c.rating_tolerance > 200) return 'tolerance_invalid'
  if (![1, 2, 3, 5].includes(c.matches_per_encounter)) return 'matches_invalid'
  if (!(c.points_win > c.points_draw && c.points_draw >= c.points_loss && c.points_loss >= c.points_walkover)) return 'points_invalid'
  if (!Number.isInteger(c.roster_max) || c.roster_max < c.matches_per_encounter * 2 || c.roster_max > 40) return 'roster_max_invalid'
  if (!Number.isInteger(c.roster_locks_at_round) || c.roster_locks_at_round < 1) return 'lock_round_invalid'
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/leagueEligibility.test.js src/lib/leagueConfig.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leagueEligibility.js src/lib/leagueEligibility.test.js src/lib/leagueConfig.js src/lib/leagueConfig.test.js
git commit -m "Liga: quem pode jogar (género, nível congelado, um clube por liga) e regras da categoria"
```

---

### Task 5: Base de dados — tabelas, RLS e funções de acesso

**Files:**
- Create: `supabase/migration_liga_1_base.sql`
- Test: `supabase/tests/liga_1_base.sql`

**Interfaces:**
- Produces (SQL, usadas por todas as migrações seguintes): tabelas `leagues`, `league_organizers`, `league_categories`, `league_teams`, `league_captains`, `league_roster`, `league_rounds`, `league_encounters`, `league_matches`, `league_events`; funções `league_is_platform_admin() → bool`, `league_is_owner(uuid) → bool`, `can_manage_league(uuid) → bool`, `represents_league_team(uuid) → bool`, `league_band(numeric) → int`.

- [ ] **Step 1: Write the test script (fails while the migration hasn't run)**

```sql
-- supabase/tests/liga_1_base.sql
-- Correr no SQL Editor da alinho-dev DEPOIS de migration_liga_1_base.sql.
-- Tudo dentro de BEGIN … ROLLBACK: não deixa nada escrito.
-- Imprime uma linha OK/ERRO por caso.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
GRANT ALL ON _r TO authenticated, anon;

-- Sem RPC não se escreve nada: authenticated não tem INSERT em nenhuma tabela.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
DO $$ BEGIN
  INSERT INTO leagues (slug, name, kind, created_by) VALUES ('x', 'Liga X', 'alinho', auth.uid());
  INSERT INTO _r VALUES (false, 'insert direto em leagues devia falhar');
EXCEPTION WHEN insufficient_privilege OR others THEN INSERT INTO _r VALUES (true, 'insert direto em leagues recusado');
END $$;
RESET ROLE;

-- O check do tipo: comunitária precisa de clube dono, Liga Alinho não pode ter.
DO $$ BEGIN
  INSERT INTO leagues (slug, name, kind, owner_org_id, created_by)
  VALUES ('y', 'Liga Y', 'alinho', (SELECT id FROM organizations LIMIT 1), (SELECT id FROM profiles LIMIT 1));
  INSERT INTO _r VALUES (false, 'Liga Alinho com clube dono devia falhar');
EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES (true, 'Liga Alinho sem clube dono');
END $$;

-- Bandas.
INSERT INTO _r SELECT league_band(1450) = 3 AND league_band(1399) = 4 AND league_band(650) = 7, 'league_band';

-- anon não lê tabelas.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM leagues LIMIT 1;
  INSERT INTO _r VALUES (false, 'anon a ler leagues devia falhar');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'anon sem acesso a leagues');
END $$;
RESET ROLE;

SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration_liga_1_base.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 1: tabelas, índices, RLS e funções de
-- acesso. Spec: docs/superpowers/specs/2026-10-16-liga-entre-clubes-design.md
--
-- Regra que manda em tudo (igual aos torneios): a liga é uma entidade nova.
-- Nenhuma escrita direta: authenticated só LÊ (e só o que lhe toca); tudo o
-- que muda passa por RPCs SECURITY DEFINER (migrações 2 a 5). anon não lê
-- tabelas — a página pública usa get_league_page (migração 6).
--
-- Correr na alinho-dev e depois supabase/tests/liga_1_base.sql.
-- ════════════════════════════════════════════════════════════════════════

-- Distrito do clube (18 distritos + Açores + Madeira), para «perto de ti».
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS district TEXT;

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('comunitaria', 'alinho')),
  owner_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'regional', 'nacional')),
  district TEXT,
  season_label TEXT,
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'inscricoes', 'a_decorrer', 'terminada', 'cancelada')),
  applications_close_at TIMESTAMPTZ,
  max_teams_per_category INTEGER CHECK (max_teams_per_category IS NULL OR max_teams_per_category BETWEEN 2 AND 64),
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Comunitária tem sempre clube dono; Liga Alinho nunca tem (é da plataforma).
  CHECK ((kind = 'comunitaria') = (owner_org_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS league_organizers (
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS league_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  gender TEXT NOT NULL CHECK (gender IN ('masculino', 'feminino', 'misto')),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 7),
  rating_tolerance INTEGER NOT NULL DEFAULT 50 CHECK (rating_tolerance BETWEEN 0 AND 200),
  matches_per_encounter INTEGER NOT NULL DEFAULT 3 CHECK (matches_per_encounter IN (1, 2, 3, 5)),
  home_away BOOLEAN NOT NULL DEFAULT FALSE,
  points_win INTEGER NOT NULL DEFAULT 3,
  points_draw INTEGER NOT NULL DEFAULT 1,
  points_loss INTEGER NOT NULL DEFAULT 0,
  points_walkover INTEGER NOT NULL DEFAULT -1,
  roster_max INTEGER NOT NULL DEFAULT 12,
  roster_locks_at_round INTEGER NOT NULL DEFAULT 3 CHECK (roster_locks_at_round >= 1),
  status TEXT NOT NULL DEFAULT 'inscricoes' CHECK (status IN ('inscricoes', 'a_decorrer', 'terminada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (points_win > points_draw AND points_draw >= points_loss AND points_loss >= points_walkover),
  CHECK (roster_max BETWEEN matches_per_encounter * 2 AND 40),
  UNIQUE (league_id, gender, level)
);

CREATE TABLE IF NOT EXISTS league_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'retirada', 'suplente')),
  applied_by UUID REFERENCES profiles(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by UUID REFERENCES profiles(id),
  decided_at TIMESTAMPTZ,
  reject_reason TEXT CHECK (reject_reason IS NULL OR length(reject_reason) <= 500),
  waitlist_order INTEGER,
  -- Fase 1: uma equipa por clube e categoria (pergunta aberta 4 do spec).
  UNIQUE (category_id, organization_id)
);

CREATE TABLE IF NOT EXISTS league_captains (
  team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS league_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- O ranking no dia em que entrou: é este que decide o nível (spec, nota 2).
  rating_at_entry NUMERIC NOT NULL,
  added_by UUID REFERENCES profiles(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);
-- Um jogador, um clube por liga — mesmo que seja membro de vários clubes.
CREATE UNIQUE INDEX IF NOT EXISTS league_roster_one_club
  ON league_roster (league_id, user_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS league_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  CHECK (window_end >= window_start),
  UNIQUE (category_id, number)
);

CREATE TABLE IF NOT EXISTS league_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES league_rounds(id) ON DELETE CASCADE,
  home_team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  away_team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  venue_text TEXT CHECK (venue_text IS NULL OR length(venue_text) <= 200),
  proposed_by_team_id UUID REFERENCES league_teams(id),
  status TEXT NOT NULL DEFAULT 'por_marcar'
    CHECK (status IN ('por_marcar', 'proposto', 'marcado', 'submetido', 'contestado', 'oficial', 'cancelado')),
  submitted_by UUID REFERENCES profiles(id),
  submitted_by_team_id UUID REFERENCES league_teams(id),
  submitted_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMPTZ,
  contested_by UUID REFERENCES profiles(id),
  contested_at TIMESTAMPTZ,
  contest_reason TEXT CHECK (contest_reason IS NULL OR length(contest_reason) <= 500),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  -- Quem faltou (falta de comparência), só quando o organizador o decide.
  walkover_team_id UUID REFERENCES league_teams(id),
  -- O que foi aplicado ao ranking, para reverter com exatidão (padrão de
  -- group_matches.applied_*): [{slot, deltas:{uid:n}, points:{uid:n}, won:{uid:bool}, org:{uid:org}}].
  ranked_applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_snapshot JSONB,
  CHECK (home_team_id <> away_team_id)
);

CREATE TABLE IF NOT EXISTS league_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES league_encounters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  home_p1 UUID NOT NULL REFERENCES profiles(id),
  home_p2 UUID NOT NULL REFERENCES profiles(id),
  away_p1 UUID NOT NULL REFERENCES profiles(id),
  away_p2 UUID NOT NULL REFERENCES profiles(id),
  sets JSONB NOT NULL,
  winner TEXT NOT NULL CHECK (winner IN ('home', 'away')),
  UNIQUE (encounter_id, slot)
);

-- O histórico de tudo o que muda (append-only, como participant_events).
CREATE TABLE IF NOT EXISTS league_events (
  id BIGSERIAL PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES league_encounters(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leagues_status ON leagues (status, district);
CREATE INDEX IF NOT EXISTS idx_leagues_owner ON leagues (owner_org_id);
CREATE INDEX IF NOT EXISTS idx_league_categories_league ON league_categories (league_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_category ON league_teams (category_id, status);
CREATE INDEX IF NOT EXISTS idx_league_teams_org ON league_teams (organization_id);
CREATE INDEX IF NOT EXISTS idx_league_roster_team ON league_roster (team_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_league_roster_user ON league_roster (user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_league_rounds_category ON league_rounds (category_id, number);
CREATE INDEX IF NOT EXISTS idx_league_encounters_category ON league_encounters (category_id, round_id);
CREATE INDEX IF NOT EXISTS idx_league_encounters_home ON league_encounters (home_team_id);
CREATE INDEX IF NOT EXISTS idx_league_encounters_away ON league_encounters (away_team_id);
CREATE INDEX IF NOT EXISTS idx_league_events_league ON league_events (league_id, created_at DESC);

-- ── Funções de acesso ───────────────────────────────────────────────────
-- Próprias da liga (não dependem de is_platform_admin_me das aulas, que pode
-- não estar corrida no mesmo ambiente).
CREATE OR REPLACE FUNCTION league_is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Dono: Liga Alinho → admins da plataforma; comunitária → admins do clube dono.
CREATE OR REPLACE FUNCTION league_is_owner(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues l
     WHERE l.id = p_league_id
       AND ((l.kind = 'alinho' AND league_is_platform_admin())
         OR (l.kind = 'comunitaria' AND is_org_admin(l.owner_org_id))));
$$;

CREATE OR REPLACE FUNCTION can_manage_league(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT league_is_owner(p_league_id)
      OR EXISTS (SELECT 1 FROM league_organizers o WHERE o.league_id = p_league_id AND o.user_id = auth.uid());
$$;

-- Representante de uma equipa: admin do clube ou capitão nomeado.
CREATE OR REPLACE FUNCTION represents_league_team(p_team_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_teams t
     WHERE t.id = p_team_id
       AND (is_org_admin(t.organization_id)
         OR EXISTS (SELECT 1 FROM league_captains c WHERE c.team_id = t.id AND c.user_id = auth.uid())));
$$;

-- O nível público (1 a 6, 7 = Iniciante) de um ranking — mostra-se isto,
-- nunca o número exato (spec, segurança).
CREATE OR REPLACE FUNCTION league_band(p_rating NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_rating >= 1800 THEN 1 WHEN p_rating >= 1600 THEN 2 WHEN p_rating >= 1400 THEN 3
              WHEN p_rating >= 1200 THEN 4 WHEN p_rating >= 1000 THEN 5 WHEN p_rating >= 700 THEN 6 ELSE 7 END;
$$;

REVOKE ALL ON FUNCTION league_is_platform_admin() FROM public, anon;
REVOKE ALL ON FUNCTION league_is_owner(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_league(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION represents_league_team(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_is_platform_admin(), league_is_owner(UUID), can_manage_league(UUID), represents_league_team(UUID) TO authenticated;

-- ── RLS: só leitura, e só do que toca a quem lê ─────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['leagues','league_organizers','league_categories','league_teams','league_captains',
                           'league_roster','league_rounds','league_encounters','league_matches','league_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "league read" ON leagues;
CREATE POLICY "league read" ON leagues FOR SELECT TO authenticated
  USING (status <> 'rascunho' OR can_manage_league(id));

DROP POLICY IF EXISTS "league organizers read" ON league_organizers;
CREATE POLICY "league organizers read" ON league_organizers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR can_manage_league(league_id));

DROP POLICY IF EXISTS "league categories read" ON league_categories;
CREATE POLICY "league categories read" ON league_categories FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND (l.status <> 'rascunho' OR can_manage_league(l.id))));

DROP POLICY IF EXISTS "league rounds read" ON league_rounds;
CREATE POLICY "league rounds read" ON league_rounds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND (l.status <> 'rascunho' OR can_manage_league(l.id))));

DROP POLICY IF EXISTS "league teams read" ON league_teams;
CREATE POLICY "league teams read" ON league_teams FOR SELECT TO authenticated
  USING (status = 'aprovada' OR can_manage_league(league_id) OR represents_league_team(id));

DROP POLICY IF EXISTS "league captains read" ON league_captains;
CREATE POLICY "league captains read" ON league_captains FOR SELECT TO authenticated
  USING (represents_league_team(team_id)
      OR can_manage_league((SELECT t.league_id FROM league_teams t WHERE t.id = team_id)));

DROP POLICY IF EXISTS "league roster read" ON league_roster;
CREATE POLICY "league roster read" ON league_roster FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR represents_league_team(team_id) OR can_manage_league(league_id));

DROP POLICY IF EXISTS "league encounters read" ON league_encounters;
CREATE POLICY "league encounters read" ON league_encounters FOR SELECT TO authenticated
  USING (can_manage_league(league_id) OR represents_league_team(home_team_id) OR represents_league_team(away_team_id));

DROP POLICY IF EXISTS "league matches read" ON league_matches;
CREATE POLICY "league matches read" ON league_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM league_encounters e WHERE e.id = encounter_id));

DROP POLICY IF EXISTS "league events read" ON league_events;
CREATE POLICY "league events read" ON league_events FOR SELECT TO authenticated
  USING (can_manage_league(league_id));
```

- [ ] **Step 3: Pedir ao Renato para correr a migração e o teste na alinho-dev**

Mensagem exata: «Corre `supabase/migration_liga_1_base.sql` no SQL Editor da **alinho-dev** e depois `supabase/tests/liga_1_base.sql`. Cola aqui o resultado.»
Expected: 4 linhas, todas `OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_liga_1_base.sql supabase/tests/liga_1_base.sql
git commit -m "Liga: tabelas, RLS só de leitura e funções de acesso (migração 1)"
```

---

### Task 6: Ciclo da liga — criar, categorias, organizadores, avisos

**Files:**
- Create: `supabase/migration_liga_2_ciclo.sql`
- Test: `supabase/tests/liga_2_ciclo.sql`

**Interfaces:**
- Consumes: funções da Task 5; `is_org_admin(uuid)`; `organizations.kind`.
- Produces: `create_league(p_kind, p_owner_org_id, p_name, p_scope, p_district, p_season_label, p_description, p_applications_close_at, p_max_teams) → jsonb {id, slug}`; `update_league(p_league_id, p_name, p_scope, p_district, p_season_label, p_description, p_applications_close_at, p_max_teams) → void`; `publish_league(p_league_id) → void`; `cancel_league(p_league_id) → void`; `delete_league(p_league_id) → void`; `upsert_league_category(p_league_id, p_category_id, p_gender, p_level, p_rating_tolerance, p_matches_per_encounter, p_home_away, p_points_win, p_points_draw, p_points_loss, p_points_walkover, p_roster_max, p_roster_locks_at_round) → uuid`; `delete_league_category(p_category_id) → void`; `add_league_organizer(p_league_id, p_user_id)`, `remove_league_organizer(p_league_id, p_user_id)`; internas: `league_notify(p_user_ids uuid[], p_kind text, p_data jsonb)`, `league_team_rep_ids(p_team_id) → setof uuid`, `league_manager_ids(p_league_id) → setof uuid`, `league_log(p_league_id, p_encounter_id, p_kind, p_payload)`.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/liga_2_ciclo.sql — alinho-dev, depois da migração 2.
-- Usa dois utilizadores reais da dev: um admin de clube (não platform admin)
-- e um platform admin. Troca os e-mails pelos da dev antes de correr.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx AS
SELECT
  (SELECT p.id FROM profiles p JOIN memberships m ON m.user_id = p.id AND m.is_admin
     JOIN organizations o ON o.id = m.organization_id AND o.kind = 'club'
    WHERE NOT COALESCE(p.is_platform_admin, false) LIMIT 1) AS club_admin,
  (SELECT p.id FROM profiles p WHERE p.is_platform_admin LIMIT 1) AS platform_admin,
  (SELECT p.id FROM profiles p WHERE NOT COALESCE(p.is_platform_admin, false)
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_admin) LIMIT 1) AS player;
ALTER TABLE _ctx ADD COLUMN org UUID;
UPDATE _ctx SET org = (SELECT m.organization_id FROM memberships m JOIN organizations o ON o.id = m.organization_id
                        WHERE m.user_id = _ctx.club_admin AND m.is_admin AND o.kind = 'club' LIMIT 1);
GRANT SELECT ON _ctx TO authenticated; GRANT ALL ON _r TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

SET LOCAL ROLE authenticated;

-- 1) admin de clube não cria Liga Alinho
SELECT pg_temp.as_user(club_admin) FROM _ctx;
DO $$ BEGIN
  PERFORM create_league('alinho', NULL, 'Liga Teste Alinho', 'regional', 'Porto', NULL, NULL, NULL, 8);
  INSERT INTO _r VALUES (false, 'admin de clube criou Liga Alinho');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_platform_admin%', 'admin de clube não cria Liga Alinho: ' || SQLERRM);
END $$;

-- 2) admin de clube cria comunitária do seu clube
DO $$ DECLARE r jsonb; BEGIN
  r := create_league('comunitaria', (SELECT org FROM _ctx), 'Liga Teste Comunitária', 'local', 'Porto', 'Outono', NULL, NULL, 8);
  INSERT INTO _r VALUES (r ? 'slug', 'comunitária criada: ' || (r->>'slug'));
  PERFORM set_config('t.league', r->>'id', true);
END $$;

-- 3) categoria inválida recusada no servidor
DO $$ BEGIN
  PERFORM upsert_league_category(current_setting('t.league')::uuid, NULL, 'masculino', 4, 50, 4, false, 3, 1, 0, -1, 12, 3);
  INSERT INTO _r VALUES (false, '4 partidas por encontro aceite');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%matches_invalid%', 'categoria inválida recusada');
END $$;
SELECT upsert_league_category(current_setting('t.league')::uuid, NULL, 'masculino', 4, 50, 3, true, 3, 1, 0, -1, 12, 3);
INSERT INTO _r SELECT count(*) = 1, 'categoria M4 criada' FROM league_categories WHERE league_id = current_setting('t.league')::uuid;

-- 4) jogador qualquer não mexe na liga
SELECT pg_temp.as_user(player) FROM _ctx;
DO $$ BEGIN
  PERFORM update_league(current_setting('t.league')::uuid, 'Roubada', 'local', NULL, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES (false, 'jogador editou a liga');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_manager%', 'jogador não edita a liga');
END $$;

-- 5) co-organizador não se promove nem nomeia outros
SELECT pg_temp.as_user(club_admin) FROM _ctx;
SELECT add_league_organizer(current_setting('t.league')::uuid, (SELECT player FROM _ctx));
SELECT pg_temp.as_user(player) FROM _ctx;
INSERT INTO _r SELECT can_manage_league(current_setting('t.league')::uuid), 'co-organizador gere a liga';
DO $$ BEGIN
  PERFORM add_league_organizer(current_setting('t.league')::uuid, (SELECT platform_admin FROM _ctx));
  INSERT INTO _r VALUES (false, 'co-organizador nomeou outro');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_owner%', 'co-organizador não nomeia outros');
END $$;
DO $$ BEGIN
  PERFORM delete_league(current_setting('t.league')::uuid);
  INSERT INTO _r VALUES (false, 'co-organizador apagou a liga');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_owner%', 'co-organizador não apaga a liga');
END $$;

-- 6) publicar
SELECT pg_temp.as_user(club_admin) FROM _ctx;
SELECT publish_league(current_setting('t.league')::uuid);
INSERT INTO _r SELECT status = 'inscricoes', 'liga publicada' FROM leagues WHERE id = current_setting('t.league')::uuid;

-- 7) platform admin cria Liga Alinho
SELECT pg_temp.as_user(platform_admin) FROM _ctx;
DO $$ DECLARE r jsonb; BEGIN
  r := create_league('alinho', NULL, 'Liga Alinho Teste', 'regional', 'Lisboa', NULL, NULL, NULL, 8);
  INSERT INTO _r VALUES (r ? 'id', 'platform admin cria Liga Alinho');
END $$;

RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration_liga_2_ciclo.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 2: criar, editar, publicar, cancelar e
-- apagar ligas; categorias; co-organizadores; avisos no sino.
-- Correr primeiro: migration_liga_1_base.sql.
--
-- «O que impede alguém de chamar isto diretamente?» (CLAUDE.md): cada RPC
-- verifica quem chama logo no início — dono (league_is_owner), organizador
-- (can_manage_league) ou admin do clube dono. O tipo da liga NUNCA muda
-- depois de criada: não há parâmetro para isso.
-- ════════════════════════════════════════════════════════════════════════

-- ── Internas (sem EXECUTE para ninguém) ────────────────────────────────
CREATE OR REPLACE FUNCTION league_log(p_league_id UUID, p_encounter_id UUID, p_kind TEXT, p_payload JSONB DEFAULT '{}'::jsonb)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO league_events (league_id, encounter_id, actor_id, kind, payload)
  VALUES (p_league_id, p_encounter_id, auth.uid(), p_kind, COALESCE(p_payload, '{}'::jsonb));
$$;

-- Avisos no sino. Nunca a quem fez a ação; sem repetidos.
CREATE OR REPLACE FUNCTION league_notify(p_user_ids UUID[], p_kind TEXT, p_data JSONB)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT u, p_kind, auth.uid(), p_data
    FROM unnest(p_user_ids) AS u
   WHERE u IS NOT NULL AND u IS DISTINCT FROM auth.uid();
$$;

-- Quem fala por uma equipa: os admins do clube e os capitães.
CREATE OR REPLACE FUNCTION league_team_rep_ids(p_team_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id FROM league_teams t JOIN memberships m ON m.organization_id = t.organization_id AND m.is_admin
   WHERE t.id = p_team_id
  UNION
  SELECT c.user_id FROM league_captains c WHERE c.team_id = p_team_id;
$$;

-- Quem organiza: os donos (admins do clube dono, ou da plataforma na Liga
-- Alinho) e os co-organizadores.
CREATE OR REPLACE FUNCTION league_manager_ids(p_league_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id FROM leagues l JOIN memberships m ON m.organization_id = l.owner_org_id AND m.is_admin
   WHERE l.id = p_league_id AND l.kind = 'comunitaria'
  UNION
  SELECT p.id FROM leagues l JOIN profiles p ON p.is_platform_admin
   WHERE l.id = p_league_id AND l.kind = 'alinho'
  UNION
  SELECT o.user_id FROM league_organizers o WHERE o.league_id = p_league_id;
$$;

CREATE OR REPLACE FUNCTION league_slugify(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(lower(translate(p_name,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ── Criar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_league(
  p_kind TEXT, p_owner_org_id UUID, p_name TEXT, p_scope TEXT, p_district TEXT,
  p_season_label TEXT, p_description TEXT, p_applications_close_at TIMESTAMPTZ, p_max_teams INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := auth.uid();
  v_org organizations;
  v_id UUID;
  v_slug TEXT;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_kind = 'alinho' THEN
    -- Só a plataforma cria Liga Alinho — nunca por dados do cliente.
    IF NOT league_is_platform_admin() THEN RAISE EXCEPTION 'not_platform_admin'; END IF;
    p_owner_org_id := NULL;
  ELSIF p_kind = 'comunitaria' THEN
    SELECT * INTO v_org FROM organizations WHERE id = p_owner_org_id;
    IF v_org.id IS NULL OR NOT is_org_admin(p_owner_org_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
    -- Grupos não criam ligas (spec): só clubes.
    IF v_org.kind IS DISTINCT FROM 'club' THEN RAISE EXCEPTION 'groups_cannot_create'; END IF;
  ELSE
    RAISE EXCEPTION 'kind_invalid';
  END IF;
  IF length(trim(COALESCE(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'name_invalid'; END IF;
  IF COALESCE(p_scope, '') NOT IN ('local', 'regional', 'nacional') THEN RAISE EXCEPTION 'scope_invalid'; END IF;
  IF p_max_teams IS NOT NULL AND p_max_teams NOT BETWEEN 2 AND 64 THEN RAISE EXCEPTION 'max_teams_invalid'; END IF;
  IF p_applications_close_at IS NOT NULL AND p_applications_close_at < NOW() THEN RAISE EXCEPTION 'deadline_past'; END IF;

  v_slug := league_slugify(p_name) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
  INSERT INTO leagues (slug, name, kind, owner_org_id, scope, district, season_label, description,
                       applications_close_at, max_teams_per_category, created_by)
  VALUES (v_slug, trim(p_name), p_kind, p_owner_org_id, p_scope, NULLIF(trim(p_district), ''),
          NULLIF(trim(p_season_label), ''), NULLIF(trim(p_description), ''), p_applications_close_at, p_max_teams, v_me)
  RETURNING id INTO v_id;
  PERFORM league_log(v_id, NULL, 'league_created', jsonb_build_object('kind', p_kind));
  RETURN jsonb_build_object('id', v_id, 'slug', v_slug);
END;
$$;

CREATE OR REPLACE FUNCTION update_league(
  p_league_id UUID, p_name TEXT, p_scope TEXT, p_district TEXT, p_season_label TEXT,
  p_description TEXT, p_applications_close_at TIMESTAMPTZ, p_max_teams INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status IN ('terminada', 'cancelada') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF length(trim(COALESCE(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'name_invalid'; END IF;
  IF COALESCE(p_scope, '') NOT IN ('local', 'regional', 'nacional') THEN RAISE EXCEPTION 'scope_invalid'; END IF;
  IF p_max_teams IS NOT NULL AND p_max_teams NOT BETWEEN 2 AND 64 THEN RAISE EXCEPTION 'max_teams_invalid'; END IF;
  UPDATE leagues
     SET name = trim(p_name), scope = p_scope, district = NULLIF(trim(p_district), ''),
         season_label = NULLIF(trim(p_season_label), ''), description = NULLIF(trim(p_description), ''),
         applications_close_at = p_applications_close_at, max_teams_per_category = p_max_teams
   WHERE id = p_league_id;
  PERFORM league_log(p_league_id, NULL, 'league_updated');
END;
$$;

CREATE OR REPLACE FUNCTION publish_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status <> 'rascunho' THEN RAISE EXCEPTION 'league_not_draft'; END IF;
  IF NOT EXISTS (SELECT 1 FROM league_categories WHERE league_id = p_league_id) THEN RAISE EXCEPTION 'no_categories'; END IF;
  UPDATE leagues SET status = 'inscricoes' WHERE id = p_league_id;
  PERFORM league_log(p_league_id, NULL, 'league_published');
END;
$$;

-- Cancelar: só o dono. Encontros por jogar ficam cancelados; o que já é
-- oficial fica no histórico.
CREATE OR REPLACE FUNCTION cancel_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  UPDATE leagues SET status = 'cancelada' WHERE id = p_league_id AND status NOT IN ('terminada', 'cancelada');
  IF NOT FOUND THEN RAISE EXCEPTION 'league_closed'; END IF;
  UPDATE league_encounters SET status = 'cancelado' WHERE league_id = p_league_id AND status <> 'oficial';
  PERFORM league_log(p_league_id, NULL, 'league_cancelled');
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t
                               WHERE t.league_id = p_league_id AND t.status IN ('aprovada', 'pendente', 'suplente')),
                        'league_cancelled', jsonb_build_object('league_id', p_league_id,
                          'league_name', (SELECT name FROM leagues WHERE id = p_league_id)));
END;
$$;

-- Apagar: só o dono, e só antes de haver encontros (depois, cancelar).
CREATE OR REPLACE FUNCTION delete_league(p_league_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  IF EXISTS (SELECT 1 FROM league_encounters WHERE league_id = p_league_id) THEN RAISE EXCEPTION 'league_has_encounters'; END IF;
  DELETE FROM leagues WHERE id = p_league_id;
END;
$$;

-- ── Categorias ─────────────────────────────────────────────────────────
-- Os mesmos limites de src/lib/leagueConfig.js. Só se mexe enquanto a
-- categoria está em inscrições (antes do calendário).
CREATE OR REPLACE FUNCTION upsert_league_category(
  p_league_id UUID, p_category_id UUID, p_gender TEXT, p_level INTEGER, p_rating_tolerance INTEGER,
  p_matches_per_encounter INTEGER, p_home_away BOOLEAN, p_points_win INTEGER, p_points_draw INTEGER,
  p_points_loss INTEGER, p_points_walkover INTEGER, p_roster_max INTEGER, p_roster_locks_at_round INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues; v_c league_categories; v_id UUID;
BEGIN
  SELECT * INTO v_l FROM leagues WHERE id = p_league_id;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
  IF NOT can_manage_league(p_league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_l.status IN ('terminada', 'cancelada') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF COALESCE(p_gender, '') NOT IN ('masculino', 'feminino', 'misto') THEN RAISE EXCEPTION 'gender_invalid'; END IF;
  IF p_level IS NULL OR p_level NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'level_invalid'; END IF;
  IF p_rating_tolerance IS NULL OR p_rating_tolerance NOT BETWEEN 0 AND 200 THEN RAISE EXCEPTION 'tolerance_invalid'; END IF;
  IF p_matches_per_encounter IS NULL OR p_matches_per_encounter NOT IN (1, 2, 3, 5) THEN RAISE EXCEPTION 'matches_invalid'; END IF;
  IF NOT (p_points_win > p_points_draw AND p_points_draw >= p_points_loss AND p_points_loss >= p_points_walkover) THEN
    RAISE EXCEPTION 'points_invalid';
  END IF;
  IF p_roster_max IS NULL OR p_roster_max < p_matches_per_encounter * 2 OR p_roster_max > 40 THEN RAISE EXCEPTION 'roster_max_invalid'; END IF;
  IF p_roster_locks_at_round IS NULL OR p_roster_locks_at_round < 1 THEN RAISE EXCEPTION 'lock_round_invalid'; END IF;

  IF p_category_id IS NULL THEN
    BEGIN
      INSERT INTO league_categories (league_id, gender, level, rating_tolerance, matches_per_encounter, home_away,
        points_win, points_draw, points_loss, points_walkover, roster_max, roster_locks_at_round)
      VALUES (p_league_id, p_gender, p_level, p_rating_tolerance, p_matches_per_encounter, COALESCE(p_home_away, FALSE),
        p_points_win, p_points_draw, p_points_loss, p_points_walkover, p_roster_max, p_roster_locks_at_round)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'category_exists';
    END;
  ELSE
    SELECT * INTO v_c FROM league_categories WHERE id = p_category_id AND league_id = p_league_id FOR UPDATE;
    IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
    IF v_c.status <> 'inscricoes' OR EXISTS (SELECT 1 FROM league_rounds WHERE category_id = v_c.id) THEN
      RAISE EXCEPTION 'category_started';
    END IF;
    BEGIN
      UPDATE league_categories
         SET gender = p_gender, level = p_level, rating_tolerance = p_rating_tolerance,
             matches_per_encounter = p_matches_per_encounter, home_away = COALESCE(p_home_away, FALSE),
             points_win = p_points_win, points_draw = p_points_draw, points_loss = p_points_loss,
             points_walkover = p_points_walkover, roster_max = p_roster_max, roster_locks_at_round = p_roster_locks_at_round
       WHERE id = v_c.id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'category_exists';
    END;
    v_id := v_c.id;
  END IF;
  PERFORM league_log(p_league_id, NULL, 'category_saved', jsonb_build_object('category_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_league_category(p_category_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c league_categories;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'inscricoes' OR EXISTS (SELECT 1 FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada') THEN
    RAISE EXCEPTION 'category_started';
  END IF;
  DELETE FROM league_categories WHERE id = v_c.id;
  PERFORM league_log(v_c.league_id, NULL, 'category_deleted', jsonb_build_object('category_id', v_c.id));
END;
$$;

-- ── Co-organizadores ───────────────────────────────────────────────────
-- Só o dono nomeia. Um co-organizador nunca se promove (não há RPC para
-- isso) e só se pode tirar a si próprio.
CREATE OR REPLACE FUNCTION add_league_organizer(p_league_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT league_is_owner(p_league_id) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  INSERT INTO league_organizers (league_id, user_id, added_by) VALUES (p_league_id, p_user_id, auth.uid())
  ON CONFLICT DO NOTHING;
  PERFORM league_log(p_league_id, NULL, 'organizer_added', jsonb_build_object('user_id', p_user_id));
  PERFORM league_notify(ARRAY[p_user_id], 'league_organizer_added',
    jsonb_build_object('league_id', p_league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = p_league_id),
                       'league_name', (SELECT name FROM leagues WHERE id = p_league_id)));
END;
$$;

CREATE OR REPLACE FUNCTION remove_league_organizer(p_league_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (league_is_owner(p_league_id) OR p_user_id = auth.uid()) THEN RAISE EXCEPTION 'not_league_owner'; END IF;
  DELETE FROM league_organizers WHERE league_id = p_league_id AND user_id = p_user_id;
  PERFORM league_log(p_league_id, NULL, 'organizer_removed', jsonb_build_object('user_id', p_user_id));
END;
$$;

REVOKE ALL ON FUNCTION league_log(UUID, UUID, TEXT, JSONB), league_notify(UUID[], TEXT, JSONB),
  league_team_rep_ids(UUID), league_manager_ids(UUID) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION create_league(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER),
  update_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER), publish_league(UUID), cancel_league(UUID),
  delete_league(UUID), upsert_league_category(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  delete_league_category(UUID), add_league_organizer(UUID, UUID), remove_league_organizer(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_league(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER),
  update_league(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER), publish_league(UUID), cancel_league(UUID),
  delete_league(UUID), upsert_league_category(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  delete_league_category(UUID), add_league_organizer(UUID, UUID), remove_league_organizer(UUID, UUID) TO authenticated;
```

- [ ] **Step 3: Pedir ao Renato para correr na alinho-dev**

«Corre `supabase/migration_liga_2_ciclo.sql` na **alinho-dev** e depois `supabase/tests/liga_2_ciclo.sql`.» Expected: todas as linhas `OK` (10). Se `_ctx` vier com algum NULL (a dev não tem um platform admin, ou um jogador sem ser admin), dizer qual falta antes de interpretar os resultados.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_liga_2_ciclo.sql supabase/tests/liga_2_ciclo.sql
git commit -m "Liga: criar (comunitária/Liga Alinho), categorias, co-organizadores e avisos (migração 2)"
```

---

### Task 7: Candidaturas, capitães e plantel

**Files:**
- Create: `supabase/migration_liga_3_inscricoes.sql`
- Test: `supabase/tests/liga_3_inscricoes.sql`

**Interfaces:**
- Consumes: Task 5 e 6 (`league_notify`, `league_team_rep_ids`, `league_manager_ids`, `league_log`).
- Produces: `apply_to_league(p_category_id, p_organization_id) → uuid` (team id); `withdraw_application(p_team_id)`; `decide_application(p_team_id, p_decision 'aprovada'|'rejeitada'|'suplente', p_reason text)`; `set_league_captain(p_team_id, p_user_id, p_on boolean)`; `add_to_roster(p_team_id, p_user_id) → uuid`; `remove_from_roster(p_roster_id)`; `league_roster_locked(p_category_id) → boolean`.
- Códigos novos: `not_club_admin`, `applications_closed`, `already_applied`, `category_full`, `not_team_rep`, `team_not_approved`, `not_member`, `already_in_league`, `gender_missing`, `gender`, `level`, `roster_full`, `roster_locked`.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/liga_3_inscricoes.sql — alinho-dev, depois da migração 3.
-- Precisa de: 2 clubes com um admin cada (A e B, pessoas diferentes) e um
-- jogador masculino membro de AMBOS (para o caso «um clube por liga").
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (org_a UUID, admin_a UUID, org_b UUID, admin_b UUID, both_player UUID, owner UUID, league UUID, cat UUID, team_a UUID, team_b UUID);
-- Preencher à mão com ids da dev (ver comentário no topo):
INSERT INTO _ctx (org_a, admin_a, org_b, admin_b, both_player, owner)
VALUES ('<org A>', '<admin A>', '<org B>', '<admin B>', '<jogador em A e B>', '<admin de um 3.º clube>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

-- Liga comunitária do 3.º clube, M4, máx. 2 equipas… e uma 3.ª candidata.
SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria',
  (SELECT m.organization_id FROM memberships m WHERE m.user_id = _ctx.owner AND m.is_admin LIMIT 1),
  'Liga Teste Inscrições', 'local', NULL, NULL, NULL, NULL, 2)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 4, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;

-- Admin A candidata A; admin A NÃO pode candidatar B.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
UPDATE _ctx SET team_a = apply_to_league(cat, org_a);
DO $$ BEGIN PERFORM apply_to_league((SELECT cat FROM _ctx), (SELECT org_b FROM _ctx));
  INSERT INTO _r VALUES (false, 'admin A candidatou o clube B');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_club_admin%', 'admin A não candidata B'); END $$;
DO $$ BEGIN PERFORM apply_to_league((SELECT cat FROM _ctx), (SELECT org_a FROM _ctx));
  INSERT INTO _r VALUES (false, 'candidatura repetida aceite');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%already_applied%', 'sem candidaturas repetidas'); END $$;

SELECT pg_temp.as_user(admin_b) FROM _ctx;
UPDATE _ctx SET team_b = apply_to_league(cat, org_b);

-- Admin A não decide candidaturas.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
DO $$ BEGIN PERFORM decide_application((SELECT team_b FROM _ctx), 'aprovada', NULL);
  INSERT INTO _r VALUES (false, 'admin A aprovou B');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_league_manager%', 'só quem organiza decide'); END $$;

SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(team_a, 'aprovada', NULL), decide_application(team_b, 'aprovada', NULL) FROM _ctx;
INSERT INTO _r SELECT count(*) = 2, 'duas aprovadas' FROM league_teams WHERE category_id = (SELECT cat FROM _ctx) AND status = 'aprovada';

-- Plantel: o jogador dos dois clubes entra por A e é recusado por B.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT add_to_roster(team_a, both_player) FROM _ctx;
SELECT pg_temp.as_user(admin_b) FROM _ctx;
DO $$ BEGIN PERFORM add_to_roster((SELECT team_b FROM _ctx), (SELECT both_player FROM _ctx));
  INSERT INTO _r VALUES (false, 'jogador entrou por dois clubes');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%already_in_league%', 'um clube por liga'); END $$;
-- Admin B não mexe no plantel de A.
DO $$ BEGIN PERFORM remove_from_roster((SELECT id FROM league_roster WHERE team_id = (SELECT team_a FROM _ctx) LIMIT 1));
  INSERT INTO _r VALUES (false, 'admin B tirou um jogador de A');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_team_rep%', 'cada clube só mexe no seu plantel'); END $$;

RESET ROLE;
-- Lotação: com o máximo em 2, uma 3.ª aprovação falha (feito como owner).
-- (A corrida real — duas aprovações ao mesmo tempo — é coberta pelo
-- SELECT … FOR UPDATE na categoria; ver a função.)
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration_liga_3_inscricoes.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 3: candidaturas dos clubes, capitães e
-- plantel. Correr primeiro: migrações 1 e 2.
--
-- Fluxo (spec §9): o admin do clube candidata → pendente → quem organiza
-- aprova / rejeita / põe como suplente → o clube é avisado. Lotação vista com
-- a categoria trancada (FOR UPDATE), para duas aprovações ao mesmo tempo não
-- passarem o máximo.
-- ════════════════════════════════════════════════════════════════════════

-- O plantel fecha quando começa a jornada N da categoria (N = roster_locks_at_round).
CREATE OR REPLACE FUNCTION league_roster_locked(p_category_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_rounds r JOIN league_categories c ON c.id = r.category_id
     WHERE r.category_id = p_category_id AND r.number = c.roster_locks_at_round AND r.window_start <= CURRENT_DATE);
$$;

CREATE OR REPLACE FUNCTION apply_to_league(p_category_id UUID, p_organization_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c league_categories; v_l leagues; v_org organizations; v_t league_teams; v_id UUID;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_c.league_id;
  SELECT * INTO v_org FROM organizations WHERE id = p_organization_id;
  IF v_org.id IS NULL OR NOT is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  IF v_org.kind IS DISTINCT FROM 'club' THEN RAISE EXCEPTION 'groups_cannot_apply'; END IF;
  IF v_l.status <> 'inscricoes' OR v_c.status <> 'inscricoes'
     OR (v_l.applications_close_at IS NOT NULL AND NOW() > v_l.applications_close_at) THEN
    RAISE EXCEPTION 'applications_closed';
  END IF;

  SELECT * INTO v_t FROM league_teams WHERE category_id = p_category_id AND organization_id = p_organization_id FOR UPDATE;
  IF v_t.id IS NOT NULL THEN
    -- Quem se retirou ou foi rejeitado pode voltar a pedir; o resto é repetido.
    IF v_t.status NOT IN ('retirada', 'rejeitada') THEN RAISE EXCEPTION 'already_applied'; END IF;
    UPDATE league_teams SET status = 'pendente', applied_by = auth.uid(), applied_at = NOW(),
           decided_by = NULL, decided_at = NULL, reject_reason = NULL, waitlist_order = NULL
     WHERE id = v_t.id;
    v_id := v_t.id;
  ELSE
    INSERT INTO league_teams (league_id, category_id, organization_id, applied_by)
    VALUES (v_l.id, p_category_id, p_organization_id, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  PERFORM league_log(v_l.id, NULL, 'application_sent', jsonb_build_object('team_id', v_id));
  PERFORM league_notify(ARRAY(SELECT league_manager_ids(v_l.id)), 'league_application_received',
    jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                       'club_name', v_org.name, 'team_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_application(p_team_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams; v_c league_categories;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT is_org_admin(v_t.organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  IF v_c.status <> 'inscricoes' THEN RAISE EXCEPTION 'category_started'; END IF;
  IF v_t.status NOT IN ('pendente', 'suplente', 'aprovada') THEN RAISE EXCEPTION 'cannot_withdraw'; END IF;
  UPDATE league_teams SET status = 'retirada', waitlist_order = NULL WHERE id = p_team_id;
  PERFORM league_log(v_t.league_id, NULL, 'application_withdrawn', jsonb_build_object('team_id', p_team_id));
END;
$$;

CREATE OR REPLACE FUNCTION decide_application(p_team_id UUID, p_decision TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams; v_c league_categories; v_l leagues; v_count INTEGER;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT can_manage_league(v_t.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF p_decision NOT IN ('aprovada', 'rejeitada', 'suplente') THEN RAISE EXCEPTION 'decision_invalid'; END IF;
  -- A categoria trancada: duas aprovações ao mesmo tempo esperam uma pela outra.
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id FOR UPDATE;
  SELECT * INTO v_l FROM leagues WHERE id = v_t.league_id;
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_c.status <> 'inscricoes' THEN RAISE EXCEPTION 'category_started'; END IF;
  IF v_t.status NOT IN ('pendente', 'suplente') THEN RAISE EXCEPTION 'team_already_decided'; END IF;

  IF p_decision = 'aprovada' AND v_l.max_teams_per_category IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada';
    IF v_count >= v_l.max_teams_per_category THEN RAISE EXCEPTION 'category_full'; END IF;
  END IF;
  IF p_decision = 'rejeitada' AND length(trim(COALESCE(p_reason, ''))) > 500 THEN RAISE EXCEPTION 'reason_too_long'; END IF;

  UPDATE league_teams
     SET status = p_decision, decided_by = auth.uid(), decided_at = NOW(),
         reject_reason = CASE WHEN p_decision = 'rejeitada' THEN NULLIF(trim(p_reason), '') END,
         waitlist_order = CASE WHEN p_decision = 'suplente'
           THEN (SELECT COALESCE(max(waitlist_order), 0) + 1 FROM league_teams WHERE category_id = v_c.id AND status = 'suplente') END
   WHERE id = p_team_id;
  PERFORM league_log(v_l.id, NULL, 'application_decided', jsonb_build_object('team_id', p_team_id, 'decision', p_decision));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(p_team_id)), 'league_application_decided',
    jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                       'team_id', p_team_id, 'decision', p_decision, 'reason', NULLIF(trim(p_reason), '')));
END;
$$;

CREATE OR REPLACE FUNCTION set_league_captain(p_team_id UUID, p_user_id UUID, p_on BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  -- Só o admin do clube nomeia capitães (um capitão não nomeia outros).
  IF NOT is_org_admin(v_t.organization_id) THEN RAISE EXCEPTION 'not_club_admin'; END IF;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_t.organization_id AND user_id = p_user_id AND NOT is_guest) THEN
      RAISE EXCEPTION 'not_member';
    END IF;
    INSERT INTO league_captains (team_id, user_id) VALUES (p_team_id, p_user_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM league_captains WHERE team_id = p_team_id AND user_id = p_user_id;
  END IF;
  PERFORM league_log(v_t.league_id, NULL, CASE WHEN p_on THEN 'captain_added' ELSE 'captain_removed' END,
                     jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id));
END;
$$;

-- Os mesmos critérios de src/lib/leagueEligibility.js (playerProblem).
CREATE OR REPLACE FUNCTION add_to_roster(p_team_id UUID, p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams; v_c league_categories; v_p profiles; v_ceiling NUMERIC; v_count INTEGER; v_id UUID;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'team_not_found'; END IF;
  IF NOT represents_league_team(p_team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_t.status <> 'aprovada' THEN RAISE EXCEPTION 'team_not_approved'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  IF v_c.status = 'terminada' THEN RAISE EXCEPTION 'category_finished'; END IF;
  IF league_roster_locked(v_c.id) THEN RAISE EXCEPTION 'roster_locked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_t.organization_id AND user_id = p_user_id AND NOT is_guest) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  SELECT * INTO v_p FROM profiles WHERE id = p_user_id;
  IF NULLIF(v_p.gender, '') IS NULL THEN RAISE EXCEPTION 'gender_missing'; END IF;
  IF v_c.gender <> 'misto' AND v_p.gender <> v_c.gender THEN RAISE EXCEPTION 'gender'; END IF;
  v_ceiling := CASE v_c.level WHEN 1 THEN NULL WHEN 2 THEN 1800 WHEN 3 THEN 1600 WHEN 4 THEN 1400
                              WHEN 5 THEN 1200 WHEN 6 THEN 1000 ELSE 700 END;
  IF v_ceiling IS NOT NULL AND COALESCE(v_p.rating, 900) >= v_ceiling + v_c.rating_tolerance THEN RAISE EXCEPTION 'level'; END IF;
  SELECT count(*) INTO v_count FROM league_roster WHERE team_id = p_team_id AND removed_at IS NULL;
  IF v_count >= v_c.roster_max THEN RAISE EXCEPTION 'roster_full'; END IF;
  BEGIN
    INSERT INTO league_roster (league_id, team_id, user_id, rating_at_entry, added_by)
    VALUES (v_t.league_id, p_team_id, p_user_id, COALESCE(v_p.rating, 900), auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_in_league';
  END;
  PERFORM league_log(v_t.league_id, NULL, 'roster_added', jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id));
  PERFORM league_notify(ARRAY[p_user_id], 'league_roster_added',
    jsonb_build_object('league_id', v_t.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_t.league_id),
                       'league_name', (SELECT name FROM leagues WHERE id = v_t.league_id),
                       'club_name', (SELECT name FROM organizations WHERE id = v_t.organization_id)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION remove_from_roster(p_roster_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r league_roster;
BEGIN
  SELECT * INTO v_r FROM league_roster WHERE id = p_roster_id FOR UPDATE;
  IF v_r.id IS NULL OR v_r.removed_at IS NOT NULL THEN RAISE EXCEPTION 'roster_not_found'; END IF;
  IF NOT represents_league_team(v_r.team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  UPDATE league_roster SET removed_at = NOW() WHERE id = p_roster_id;
  PERFORM league_log(v_r.league_id, NULL, 'roster_removed', jsonb_build_object('team_id', v_r.team_id, 'user_id', v_r.user_id));
END;
$$;

REVOKE ALL ON FUNCTION league_roster_locked(UUID), apply_to_league(UUID, UUID), withdraw_application(UUID),
  decide_application(UUID, TEXT, TEXT), set_league_captain(UUID, UUID, BOOLEAN), add_to_roster(UUID, UUID),
  remove_from_roster(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_roster_locked(UUID), apply_to_league(UUID, UUID), withdraw_application(UUID),
  decide_application(UUID, TEXT, TEXT), set_league_captain(UUID, UUID, BOOLEAN), add_to_roster(UUID, UUID),
  remove_from_roster(UUID) TO authenticated;
```

- [ ] **Step 3: Pedir ao Renato para correr na alinho-dev** (migração e teste, com os ids preenchidos). Expected: 6 linhas `OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_liga_3_inscricoes.sql supabase/tests/liga_3_inscricoes.sql
git commit -m "Liga: candidaturas com lotação, capitães e plantel de um clube por liga (migração 3)"
```

---

### Task 8: Calendário no servidor e marcação

**Files:**
- Create: `supabase/migration_liga_4_calendario.sql`
- Test: `supabase/tests/liga_4_calendario.sql`

**Interfaces:**
- Consumes: Tasks 5–7; o JS da Task 1 gera `p_rounds`.
- Produces: `save_league_schedule(p_category_id uuid, p_rounds jsonb, p_first_start date, p_round_days int) → int` (nº de encontros) com `p_rounds = [[{"home": uuid, "away": uuid}, …], …]`; `propose_encounter_time(p_encounter_id, p_when timestamptz, p_venue text)`; `accept_encounter_time(p_encounter_id)`; `set_encounter_time(p_encounter_id, p_when, p_venue)` (organizador).
- Códigos: `schedule_team_invalid`, `schedule_team_twice`, `schedule_pairs`, `schedule_rounds`, `not_enough_teams`, `schedule_has_results`, `outside_window`, `not_your_proposal`, `encounter_locked`.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/liga_4_calendario.sql — alinho-dev, depois da migração 4.
-- Cria tudo como owner num ambiente vazio da liga: usa os mesmos ids da
-- Task 7 (preencher). Verifica que o servidor recusa calendários errados.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (owner UUID, org_owner UUID, org_a UUID, org_b UUID, org_c UUID, admin_a UUID, admin_b UUID, admin_c UUID,
                        league UUID, cat UUID, ta UUID, tb UUID, tc UUID);
INSERT INTO _ctx (owner, org_owner, org_a, org_b, org_c, admin_a, admin_b, admin_c)
VALUES ('<owner>', '<clube do owner>', '<org A>', '<org B>', '<org C>', '<admin A>', '<admin B>', '<admin C>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria', org_owner, 'Liga Teste Calendário', 'local', NULL, NULL, NULL, NULL, NULL)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 4, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; UPDATE _ctx SET ta = apply_to_league(cat, org_a);
SELECT pg_temp.as_user(admin_b) FROM _ctx; UPDATE _ctx SET tb = apply_to_league(cat, org_b);
SELECT pg_temp.as_user(admin_c) FROM _ctx; UPDATE _ctx SET tc = apply_to_league(cat, org_c);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(ta, 'aprovada', NULL), decide_application(tb, 'aprovada', NULL), decide_application(tc, 'aprovada', NULL) FROM _ctx;

-- Errado: A joga duas vezes na mesma jornada.
DO $$ DECLARE c _ctx; BEGIN SELECT * INTO c FROM _ctx;
  PERFORM save_league_schedule(c.cat, jsonb_build_array(jsonb_build_array(
    jsonb_build_object('home', c.ta, 'away', c.tb), jsonb_build_object('home', c.ta, 'away', c.tc))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (false, 'aceitou equipa duas vezes na jornada');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%schedule_team_twice%', 'recusa equipa duas vezes na jornada'); END $$;

-- Errado: falta o par B–C.
DO $$ DECLARE c _ctx; BEGIN SELECT * INTO c FROM _ctx;
  PERFORM save_league_schedule(c.cat, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('home', c.ta, 'away', c.tb)),
    jsonb_build_array(jsonb_build_object('home', c.tc, 'away', c.ta))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (false, 'aceitou calendário incompleto');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%schedule_pairs%' OR SQLERRM LIKE '%schedule_rounds%', 'recusa calendário incompleto'); END $$;

-- Certo (3 equipas → 3 jornadas, folga em cada).
DO $$ DECLARE c _ctx; n INTEGER; BEGIN SELECT * INTO c FROM _ctx;
  n := save_league_schedule(c.cat, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('home', c.ta, 'away', c.tb)),
    jsonb_build_array(jsonb_build_object('home', c.tc, 'away', c.ta)),
    jsonb_build_array(jsonb_build_object('home', c.tb, 'away', c.tc))), CURRENT_DATE, 14);
  INSERT INTO _r VALUES (n = 3, 'calendário certo gravado: ' || n || ' encontros');
END $$;
INSERT INTO _r SELECT status = 'a_decorrer', 'categoria a decorrer' FROM league_categories WHERE id = (SELECT cat FROM _ctx);

-- Marcação: A (casa) propõe; A não pode aceitar a própria proposta; B aceita.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT propose_encounter_time(e.id, (CURRENT_DATE + 2)::timestamptz + interval '18 hours', 'Campo 2')
  FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
DO $$ BEGIN PERFORM accept_encounter_time((SELECT e.id FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb));
  INSERT INTO _r VALUES (false, 'aceitou a própria proposta');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%not_your_proposal%', 'não aceita a própria proposta'); END $$;
SELECT pg_temp.as_user(admin_b) FROM _ctx;
SELECT accept_encounter_time(e.id) FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
INSERT INTO _r SELECT status = 'marcado', 'encontro marcado' FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb;
-- Fora da janela.
SELECT pg_temp.as_user(admin_a) FROM _ctx;
DO $$ BEGIN PERFORM propose_encounter_time((SELECT e.id FROM league_encounters e, _ctx c WHERE e.home_team_id = c.ta AND e.away_team_id = c.tb),
  (CURRENT_DATE + 60)::timestamptz, NULL);
  INSERT INTO _r VALUES (false, 'aceitou data fora da janela');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%outside_window%', 'recusa data fora da janela'); END $$;

RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration_liga_4_calendario.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 4: gravar o calendário e marcar datas.
-- Correr primeiro: migrações 1 a 3.
--
-- O calendário é calculado no browser (src/lib/leagueSchedule.js) e aqui só
-- se VALIDA: todas as equipas aprovadas, ninguém duas vezes por jornada, cada
-- par uma vez (casa e fora: cada ordem uma vez), número certo de jornadas.
-- Assim o algoritmo vive num sítio só e o servidor continua a mandar.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_league_schedule(p_category_id UUID, p_rounds JSONB, p_first_start DATE, p_round_days INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c league_categories; v_l leagues;
  v_n INTEGER; v_expected_rounds INTEGER; v_expected_pairs INTEGER; v_pairs INTEGER; v_rounds INTEGER;
  v_round_id UUID; r INTEGER;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_c.league_id FOR UPDATE;
  IF v_l.status NOT IN ('inscricoes', 'a_decorrer') THEN RAISE EXCEPTION 'league_closed'; END IF;
  IF v_c.status = 'terminada' THEN RAISE EXCEPTION 'category_finished'; END IF;
  -- Refazer o calendário só enquanto nada foi jogado.
  IF EXISTS (SELECT 1 FROM league_encounters WHERE category_id = v_c.id AND status IN ('submetido', 'contestado', 'oficial')) THEN
    RAISE EXCEPTION 'schedule_has_results';
  END IF;
  IF p_first_start IS NULL OR p_round_days IS NULL OR p_round_days NOT BETWEEN 3 AND 60 THEN RAISE EXCEPTION 'schedule_dates'; END IF;

  SELECT count(*) INTO v_n FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada';
  IF v_n < 2 THEN RAISE EXCEPTION 'not_enough_teams'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _lg_pairs (num INTEGER, home UUID, away UUID) ON COMMIT DROP;
  TRUNCATE _lg_pairs;
  INSERT INTO _lg_pairs
  SELECT x.ri::int, (p->>'home')::uuid, (p->>'away')::uuid
    FROM jsonb_array_elements(p_rounds) WITH ORDINALITY AS x(rnd, ri), jsonb_array_elements(x.rnd) AS p;

  IF EXISTS (SELECT 1 FROM _lg_pairs
              WHERE home IS NULL OR away IS NULL OR home = away
                 OR home NOT IN (SELECT id FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada')
                 OR away NOT IN (SELECT id FROM league_teams WHERE category_id = v_c.id AND status = 'aprovada')) THEN
    RAISE EXCEPTION 'schedule_team_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT num, home AS t FROM _lg_pairs UNION ALL SELECT num, away FROM _lg_pairs) s
              GROUP BY num, t HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'schedule_team_twice';
  END IF;

  v_expected_rounds := (CASE WHEN v_n % 2 = 0 THEN v_n - 1 ELSE v_n END) * (CASE WHEN v_c.home_away THEN 2 ELSE 1 END);
  v_expected_pairs := v_n * (v_n - 1) / 2 * (CASE WHEN v_c.home_away THEN 2 ELSE 1 END);
  SELECT count(DISTINCT num), COALESCE(max(num), 0) INTO v_rounds, r FROM _lg_pairs;
  IF v_rounds <> v_expected_rounds OR r <> v_expected_rounds THEN RAISE EXCEPTION 'schedule_rounds'; END IF;
  IF v_c.home_away THEN
    IF EXISTS (SELECT 1 FROM _lg_pairs GROUP BY home, away HAVING count(*) <> 1) THEN RAISE EXCEPTION 'schedule_pairs'; END IF;
    SELECT count(*) INTO v_pairs FROM (SELECT DISTINCT home, away FROM _lg_pairs) s;
  ELSE
    IF EXISTS (SELECT 1 FROM _lg_pairs GROUP BY least(home, away), greatest(home, away) HAVING count(*) <> 1) THEN
      RAISE EXCEPTION 'schedule_pairs';
    END IF;
    SELECT count(*) INTO v_pairs FROM (SELECT DISTINCT least(home, away), greatest(home, away) FROM _lg_pairs) s;
  END IF;
  IF v_pairs <> v_expected_pairs THEN RAISE EXCEPTION 'schedule_pairs'; END IF;

  -- Tudo certo: substitui o calendário anterior (nada estava jogado).
  DELETE FROM league_rounds WHERE category_id = v_c.id;
  FOR r IN 1..v_expected_rounds LOOP
    INSERT INTO league_rounds (league_id, category_id, number, window_start, window_end)
    VALUES (v_c.league_id, v_c.id, r, p_first_start + (r - 1) * p_round_days, p_first_start + r * p_round_days - 1)
    RETURNING id INTO v_round_id;
    INSERT INTO league_encounters (league_id, category_id, round_id, home_team_id, away_team_id)
    SELECT v_c.league_id, v_c.id, v_round_id, home, away FROM _lg_pairs WHERE num = r;
  END LOOP;

  UPDATE league_categories SET status = 'a_decorrer' WHERE id = v_c.id;
  UPDATE leagues SET status = 'a_decorrer' WHERE id = v_l.id AND status = 'inscricoes';
  PERFORM league_log(v_l.id, NULL, 'schedule_saved', jsonb_build_object('category_id', v_c.id, 'pairs', v_pairs));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t WHERE t.category_id = v_c.id AND t.status = 'aprovada'),
    'league_schedule_published', jsonb_build_object('league_id', v_l.id, 'league_slug', v_l.slug, 'league_name', v_l.name,
                                                    'category_id', v_c.id));
  RETURN v_pairs;
END;
$$;

-- O lado de quem chama num encontro: 'home', 'away' ou NULL.
CREATE OR REPLACE FUNCTION league_side(p_e league_encounters)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN represents_league_team(p_e.home_team_id) AND represents_league_team(p_e.away_team_id) THEN 'both'
              WHEN represents_league_team(p_e.home_team_id) THEN 'home'
              WHEN represents_league_team(p_e.away_team_id) THEN 'away' END;
$$;

CREATE OR REPLACE FUNCTION league_check_window(p_e league_encounters, p_when TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r league_rounds;
BEGIN
  SELECT * INTO v_r FROM league_rounds WHERE id = p_e.round_id;
  -- O dia conta em Lisboa (como o resto da app).
  IF (p_when AT TIME ZONE 'Europe/Lisbon')::date NOT BETWEEN v_r.window_start AND v_r.window_end THEN
    RAISE EXCEPTION 'outside_window';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION propose_encounter_time(p_encounter_id UUID, p_when TIMESTAMPTZ, p_venue TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID; v_other UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status NOT IN ('por_marcar', 'proposto', 'marcado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  PERFORM league_check_window(v_e, p_when);
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  v_other := CASE v_side WHEN 'home' THEN v_e.away_team_id ELSE v_e.home_team_id END;
  UPDATE league_encounters
     SET scheduled_at = p_when, venue_text = NULLIF(trim(p_venue), ''), status = 'proposto', proposed_by_team_id = v_team
   WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_proposed', jsonb_build_object('when', p_when, 'team_id', v_team));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_other)), 'league_time_proposed',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'when', p_when));
END;
$$;

CREATE OR REPLACE FUNCTION accept_encounter_time(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status <> 'proposto' THEN RAISE EXCEPTION 'nothing_to_accept'; END IF;
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  IF v_team = v_e.proposed_by_team_id THEN RAISE EXCEPTION 'not_your_proposal'; END IF;
  UPDATE league_encounters SET status = 'marcado' WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_accepted', jsonb_build_object('when', v_e.scheduled_at));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.proposed_by_team_id)), 'league_time_accepted',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'when', v_e.scheduled_at));
END;
$$;

-- Quem organiza pode marcar diretamente (o recurso quando os clubes não se entendem).
CREATE OR REPLACE FUNCTION set_encounter_time(p_encounter_id UUID, p_when TIMESTAMPTZ, p_venue TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  IF NOT can_manage_league(v_e.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_e.status NOT IN ('por_marcar', 'proposto', 'marcado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  UPDATE league_encounters SET scheduled_at = p_when, venue_text = NULLIF(trim(p_venue), ''), status = 'marcado', proposed_by_team_id = NULL
   WHERE id = p_encounter_id;
  PERFORM league_log(v_e.league_id, v_e.id, 'time_set_by_organizer', jsonb_build_object('when', p_when));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.home_team_id) UNION SELECT league_team_rep_ids(v_e.away_team_id)),
    'league_time_accepted', jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                                               'encounter_id', v_e.id, 'when', p_when));
END;
$$;

REVOKE ALL ON FUNCTION league_side(league_encounters), league_check_window(league_encounters, TIMESTAMPTZ) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION save_league_schedule(UUID, JSONB, DATE, INTEGER), propose_encounter_time(UUID, TIMESTAMPTZ, TEXT),
  accept_encounter_time(UUID), set_encounter_time(UUID, TIMESTAMPTZ, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION save_league_schedule(UUID, JSONB, DATE, INTEGER), propose_encounter_time(UUID, TIMESTAMPTZ, TEXT),
  accept_encounter_time(UUID), set_encounter_time(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
```

- [ ] **Step 3: Pedir ao Renato para correr na alinho-dev.** Expected: 7 linhas `OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_liga_4_calendario.sql supabase/tests/liga_4_calendario.sql
git commit -m "Liga: o servidor valida e grava o calendário; propor, aceitar e marcar datas (migração 4)"
```

---

### Task 9: Resultados — submeter, confirmar, contestar, resolver; ranking e XP

**Files:**
- Create: `supabase/migration_liga_5_resultados.sql`
- Test: `supabase/tests/liga_5_resultados.sql`

**Interfaces:**
- Consumes: Tasks 5–8; `apply_elo_pairing(a1, a2, b1, b2, s_a)` (`RETURNS TABLE(pid, delta, s)`); `organizations.points_rules`; `player_stats`; `xp_events`.
- Produces: `league_match_winner(p_sets jsonb) → 'home'|'away'`; `submit_encounter_result(p_encounter_id, p_matches jsonb)`; `confirm_encounter_result(p_encounter_id)`; `contest_encounter_result(p_encounter_id, p_reason text)`; `resolve_encounter(p_encounter_id, p_matches jsonb, p_walkover_team_id uuid, p_note text)`; `finish_league_category(p_category_id)`. `p_matches = [{"slot":1,"home":[uid,uid],"away":[uid,uid],"sets":[[6,4],[6,3]]}, …]`.
- Códigos: `not_played_yet`, `already_submitted_by_other`, `cannot_confirm_own`, `nothing_to_confirm`, `reason_required`, `note_required`, `walkover_team_invalid`, `matches_count`, `slot_invalid`, `pair_gender`, `player_twice`, `not_in_roster`, `pending_encounters` + os de `league_match_winner`.

- [ ] **Step 1: Verificar o check atual de `xp_events.kind` na dev e em produção**

Run (SQL Editor, dev e prod, só leitura):
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'xp_events'::regclass AND contype = 'c';
```
Expected: `xp_events_kind_check` com exatamente `mix_participation, mix_games, mix_win, friendly_match, friendly_win, kudos`. Se tiver mais kinds, acrescentá-los à lista do Step 3 antes de continuar (senão a migração apaga-os do check).

- [ ] **Step 2: Write the test script**

```sql
-- supabase/tests/liga_5_resultados.sql — alinho-dev, depois da migração 5.
-- Parte de uma categoria com 2 equipas aprovadas (A e B), 1 partida por
-- encontro, e 2 jogadores masculinos no plantel de cada (preencher ids).
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (owner UUID, org_owner UUID, org_a UUID, org_b UUID, admin_a UUID, admin_b UUID,
  a1 UUID, a2 UUID, b1 UUID, b2 UUID, league UUID, cat UUID, ta UUID, tb UUID, enc UUID, rating_before NUMERIC);
INSERT INTO _ctx (owner, org_owner, org_a, org_b, admin_a, admin_b, a1, a2, b1, b2)
VALUES ('<owner>', '<clube do owner>', '<org A>', '<org B>', '<admin A>', '<admin B>', '<jog A1>', '<jog A2>', '<jog B1>', '<jog B2>');
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(owner) FROM _ctx;
UPDATE _ctx SET league = (create_league('comunitaria', org_owner, 'Liga Teste Resultados', 'local', NULL, NULL, NULL, NULL, NULL)->>'id')::uuid;
UPDATE _ctx SET cat = upsert_league_category(league, NULL, 'masculino', 1, 50, 1, false, 3, 1, 0, -1, 4, 3);
SELECT publish_league(league) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; UPDATE _ctx SET ta = apply_to_league(cat, org_a);
SELECT pg_temp.as_user(admin_b) FROM _ctx; UPDATE _ctx SET tb = apply_to_league(cat, org_b);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT decide_application(ta, 'aprovada', NULL), decide_application(tb, 'aprovada', NULL) FROM _ctx;
SELECT pg_temp.as_user(admin_a) FROM _ctx; SELECT add_to_roster(ta, a1), add_to_roster(ta, a2) FROM _ctx;
SELECT pg_temp.as_user(admin_b) FROM _ctx; SELECT add_to_roster(tb, b1), add_to_roster(tb, b2) FROM _ctx;
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT save_league_schedule(cat, jsonb_build_array(jsonb_build_array(jsonb_build_object('home', ta, 'away', tb))), CURRENT_DATE, 14) FROM _ctx;
UPDATE _ctx SET enc = (SELECT id FROM league_encounters WHERE category_id = _ctx.cat);
RESET ROLE;
UPDATE _ctx SET rating_before = (SELECT rating FROM profiles WHERE id = _ctx.a1);
SET LOCAL ROLE authenticated;

-- A submete (A ganha 6–4 6–3).
SELECT pg_temp.as_user(admin_a) FROM _ctx;
SELECT submit_encounter_result(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[6,3]]'::jsonb))) FROM _ctx;
-- A não confirma o próprio resultado.
DO $$ BEGIN PERFORM confirm_encounter_result((SELECT enc FROM _ctx));
  INSERT INTO _r VALUES (false, 'A confirmou o próprio resultado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%cannot_confirm_own%', 'ninguém confirma o próprio resultado'); END $$;
-- Set impossível recusado.
DO $$ BEGIN PERFORM submit_encounter_result((SELECT enc FROM _ctx), (SELECT jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,5],[6,3]]'::jsonb)) FROM _ctx));
  INSERT INTO _r VALUES (false, 'aceitou 6–5');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM LIKE '%set_invalid%', 'recusa set impossível'); END $$;

-- B contesta, o owner resolve como B 2–0 → oficial; depois corrige para A.
SELECT pg_temp.as_user(admin_b) FROM _ctx;
SELECT contest_encounter_result(enc, 'O segundo set foi 3–6.') FROM _ctx;
INSERT INTO _r SELECT status = 'contestado', 'contestado' FROM league_encounters WHERE id = (SELECT enc FROM _ctx);
SELECT pg_temp.as_user(owner) FROM _ctx;
SELECT resolve_encounter(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[3,6],[8,10]]'::jsonb)), NULL, 'Visto o boletim.') FROM _ctx;
INSERT INTO _r SELECT status = 'oficial' AND ranked_applied, 'resolvido e aplicado ao ranking' FROM league_encounters WHERE id = (SELECT enc FROM _ctx);
SELECT resolve_encounter(enc, jsonb_build_array(jsonb_build_object('slot', 1,
  'home', jsonb_build_array(a1, a2), 'away', jsonb_build_array(b1, b2), 'sets', '[[6,4],[6,3]]'::jsonb)), NULL, 'Correção.') FROM _ctx;
RESET ROLE;
-- Depois de reverter e reaplicar, o rating de A1 = antes + o delta guardado agora (aplicado uma vez só).
INSERT INTO _r SELECT abs(p.rating - (c.rating_before + (e.applied_snapshot->0->'deltas'->>c.a1::text)::numeric)) < 0.001,
  'correção reverte e reaplica uma vez'
  FROM _ctx c JOIN profiles p ON p.id = c.a1 JOIN league_encounters e ON e.id = c.enc;
INSERT INTO _r SELECT count(*) = 1, 'XP de partida sem duplicar'
  FROM xp_events WHERE user_id = (SELECT a1 FROM _ctx) AND kind = 'league_match';
-- Conflito de interesses: quem é admin dos dois clubes não submete.
-- (Correr à parte se a dev tiver essa pessoa; senão fica a nota.)
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migration_liga_5_resultados.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 5: resultados e o que eles mexem.
-- Correr primeiro: migrações 1 a 4. Antes, ver Task 9 Step 1 (xp_events).
--
-- Fluxo (spec §10): um lado submete → o OUTRO lado confirma (oficial) ou
-- contesta → quem organiza resolve. Só o oficial mexe no ranking global
-- (apply_elo_pairing, decisão do Renato a 16 out), em player_stats do clube
-- que cada jogador representa, e no XP. Corrigir um oficial reverte e
-- reaplica com o que ficou guardado em applied_snapshot (o padrão de
-- apply/reverse_group_match_ranking). O XP não se retira (é monotónico, como
-- no resto da app) e o índice único impede que se repita.
-- ════════════════════════════════════════════════════════════════════════

-- ── XP com origem na liga ──────────────────────────────────────────────
-- Sem FK de propósito: as partidas são atualizadas no sítio (nunca apagadas
-- depois de contarem), e um ON DELETE SET NULL deixaria a linha sem origem.
ALTER TABLE xp_events ADD COLUMN IF NOT EXISTS source_league_match_id UUID;
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_kind_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_kind_check CHECK (kind IN
  ('mix_participation', 'mix_games', 'mix_win', 'friendly_match', 'friendly_win', 'kudos', 'league_match', 'league_win'));
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'xp_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%source_game_id IS NOT NULL%' AND conname <> 'xp_events_source_check';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE xp_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_source_check
  CHECK (source_game_id IS NOT NULL OR source_private_match_id IS NOT NULL OR source_league_match_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS xp_events_league_once
  ON xp_events (user_id, kind, source_league_match_id) WHERE source_league_match_id IS NOT NULL;

-- ── Validar uma partida (igual a src/lib/leagueResult.js) ──────────────
CREATE OR REPLACE FUNCTION league_match_winner(p_sets JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n INTEGER; i INTEGER; h INTEGER; a INTEGER; hi INTEGER; lo INTEGER; wh INTEGER := 0; wa INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_sets) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'sets_count'; END IF;
  n := jsonb_array_length(p_sets);
  IF n < 2 OR n > 3 THEN RAISE EXCEPTION 'sets_count'; END IF;
  FOR i IN 0..n - 1 LOOP
    IF wh = 2 OR wa = 2 THEN RAISE EXCEPTION 'sets_after_win'; END IF;
    IF jsonb_typeof(p_sets->i) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sets->i) <> 2
       OR jsonb_typeof(p_sets->i->0) <> 'number' OR jsonb_typeof(p_sets->i->1) <> 'number' THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    IF (p_sets->i->>0)::numeric <> floor((p_sets->i->>0)::numeric) OR (p_sets->i->>1)::numeric <> floor((p_sets->i->>1)::numeric) THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    h := (p_sets->i->>0)::int; a := (p_sets->i->>1)::int;
    IF h < 0 OR a < 0 THEN RAISE EXCEPTION 'set_invalid'; END IF;
    hi := greatest(h, a); lo := least(h, a);
    IF i = 2 AND hi >= 10 THEN
      IF NOT (hi - lo >= 2 AND (hi = 10 OR hi - lo = 2)) THEN RAISE EXCEPTION 'set_invalid'; END IF;
    ELSIF NOT ((hi = 6 AND lo <= 4) OR (hi = 7 AND lo IN (5, 6))) THEN
      RAISE EXCEPTION 'set_invalid';
    END IF;
    IF h > a THEN wh := wh + 1; ELSE wa := wa + 1; END IF;
  END LOOP;
  IF wh < 2 AND wa < 2 THEN RAISE EXCEPTION 'no_winner'; END IF;
  RETURN CASE WHEN wh > wa THEN 'home' ELSE 'away' END;
END;
$$;

-- Valida as duplas e os sets e grava (atualiza no sítio, por slot).
CREATE OR REPLACE FUNCTION league_save_matches(p_e league_encounters, p_matches JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c league_categories; m JSONB; v_slot INTEGER; v_h1 UUID; v_h2 UUID; v_a1 UUID; v_a2 UUID;
  v_home_used UUID[] := '{}'; v_away_used UUID[] := '{}'; v_slots INTEGER[] := '{}'; v_winner TEXT; g TEXT[];
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_e.category_id;
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches) <> v_c.matches_per_encounter THEN
    RAISE EXCEPTION 'matches_count';
  END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(p_matches) LOOP
    v_slot := (m->>'slot')::int;
    IF v_slot IS NULL OR v_slot NOT BETWEEN 1 AND v_c.matches_per_encounter OR v_slot = ANY (v_slots) THEN RAISE EXCEPTION 'slot_invalid'; END IF;
    v_slots := v_slots || v_slot;
    v_h1 := (m->'home'->>0)::uuid; v_h2 := (m->'home'->>1)::uuid;
    v_a1 := (m->'away'->>0)::uuid; v_a2 := (m->'away'->>1)::uuid;
    IF v_h1 IS NULL OR v_h2 IS NULL OR v_a1 IS NULL OR v_a2 IS NULL OR v_h1 = v_h2 OR v_a1 = v_a2 THEN RAISE EXCEPTION 'incomplete'; END IF;
    -- Ninguém joga duas partidas no mesmo encontro.
    IF v_h1 = ANY (v_home_used) OR v_h2 = ANY (v_home_used) OR v_a1 = ANY (v_away_used) OR v_a2 = ANY (v_away_used) THEN
      RAISE EXCEPTION 'player_twice';
    END IF;
    v_home_used := v_home_used || v_h1 || v_h2;
    v_away_used := v_away_used || v_a1 || v_a2;
    IF (SELECT count(*) FROM league_roster WHERE team_id = p_e.home_team_id AND removed_at IS NULL AND user_id IN (v_h1, v_h2)) <> 2
       OR (SELECT count(*) FROM league_roster WHERE team_id = p_e.away_team_id AND removed_at IS NULL AND user_id IN (v_a1, v_a2)) <> 2 THEN
      RAISE EXCEPTION 'not_in_roster';
    END IF;
    FOREACH g SLICE 1 IN ARRAY ARRAY[
      ARRAY[(SELECT gender FROM profiles WHERE id = v_h1), (SELECT gender FROM profiles WHERE id = v_h2)],
      ARRAY[(SELECT gender FROM profiles WHERE id = v_a1), (SELECT gender FROM profiles WHERE id = v_a2)]] LOOP
      IF v_c.gender = 'misto' THEN
        IF NOT ('masculino' = ANY (g) AND 'feminino' = ANY (g)) THEN RAISE EXCEPTION 'pair_gender'; END IF;
      ELSIF g[1] IS DISTINCT FROM v_c.gender OR g[2] IS DISTINCT FROM v_c.gender THEN
        RAISE EXCEPTION 'pair_gender';
      END IF;
    END LOOP;
    v_winner := league_match_winner(m->'sets');
    INSERT INTO league_matches (encounter_id, slot, home_p1, home_p2, away_p1, away_p2, sets, winner)
    VALUES (p_e.id, v_slot, v_h1, v_h2, v_a1, v_a2, m->'sets', v_winner)
    ON CONFLICT (encounter_id, slot) DO UPDATE
      SET home_p1 = EXCLUDED.home_p1, home_p2 = EXCLUDED.home_p2, away_p1 = EXCLUDED.away_p1,
          away_p2 = EXCLUDED.away_p2, sets = EXCLUDED.sets, winner = EXCLUDED.winner;
  END LOOP;
END;
$$;

-- ── Ranking ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_league_encounter_ranking(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e league_encounters; v_home_org UUID; v_away_org UUID; mt league_matches; pl RECORD; slotrec RECORD;
  v_snap JSONB := '[]'::jsonb; v_deltas JSONB; v_points JSONB; v_won JSONB; v_org JSONB;
  v_rules JSONB; v_is_won BOOLEAN; v_pts INTEGER; v_when TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF v_e.ranked_applied OR v_e.walkover_team_id IS NOT NULL OR v_e.status <> 'oficial' THEN RETURN; END IF;
  SELECT organization_id INTO v_home_org FROM league_teams WHERE id = v_e.home_team_id;
  SELECT organization_id INTO v_away_org FROM league_teams WHERE id = v_e.away_team_id;
  v_when := COALESCE(v_e.scheduled_at, NOW());

  FOR mt IN SELECT * FROM league_matches WHERE encounter_id = v_e.id ORDER BY slot LOOP
    v_deltas := '{}'::jsonb; v_points := '{}'::jsonb; v_won := '{}'::jsonb; v_org := '{}'::jsonb;
    FOR pl IN SELECT * FROM apply_elo_pairing(mt.home_p1, mt.home_p2, mt.away_p1, mt.away_p2,
                                              CASE WHEN mt.winner = 'home' THEN 1 ELSE 0 END) LOOP
      v_deltas := v_deltas || jsonb_build_object(pl.pid::text, pl.delta);
    END LOOP;
    FOR slotrec IN SELECT * FROM (VALUES
        (mt.home_p1, 'home', v_home_org), (mt.home_p2, 'home', v_home_org),
        (mt.away_p1, 'away', v_away_org), (mt.away_p2, 'away', v_away_org)) AS t(pid, side, org) LOOP
      v_is_won := slotrec.side = mt.winner;
      SELECT points_rules INTO v_rules FROM organizations WHERE id = slotrec.org;
      v_rules := COALESCE(v_rules, '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb);
      v_pts := COALESCE((v_rules->>'point_per_match_played')::int, 1)
             + CASE WHEN v_is_won THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END;
      INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
      VALUES (slotrec.pid, slotrec.org, CASE WHEN v_is_won THEN 1 ELSE 0 END, CASE WHEN v_is_won THEN 0 ELSE 1 END, 0, 0, v_pts)
      ON CONFLICT (user_id, organization_id) DO UPDATE
        SET game_wins = player_stats.game_wins + EXCLUDED.game_wins,
            game_losses = player_stats.game_losses + EXCLUDED.game_losses,
            total_points = player_stats.total_points + EXCLUDED.total_points,
            updated_at = NOW();
      v_points := v_points || jsonb_build_object(slotrec.pid::text, v_pts);
      v_won := v_won || jsonb_build_object(slotrec.pid::text, v_is_won);
      v_org := v_org || jsonb_build_object(slotrec.pid::text, slotrec.org);
      -- XP: 10 por partida, +5 a quem ganha (como o jogo entre amigos).
      INSERT INTO xp_events (user_id, organization_id, kind, source_league_match_id, amount, occurred_at)
      VALUES (slotrec.pid, slotrec.org, 'league_match', mt.id, 10, v_when) ON CONFLICT DO NOTHING;
      IF v_is_won THEN
        INSERT INTO xp_events (user_id, organization_id, kind, source_league_match_id, amount, occurred_at)
        VALUES (slotrec.pid, slotrec.org, 'league_win', mt.id, 5, v_when) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    v_snap := v_snap || jsonb_build_array(jsonb_build_object('slot', mt.slot, 'deltas', v_deltas, 'points', v_points, 'won', v_won, 'org', v_org));
  END LOOP;
  UPDATE league_encounters SET ranked_applied = TRUE, applied_snapshot = v_snap WHERE id = v_e.id;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_league_encounter_ranking(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters; s JSONB; k TEXT; v_won BOOLEAN;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF NOT v_e.ranked_applied THEN RETURN; END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(v_e.applied_snapshot) LOOP
    FOR k IN SELECT jsonb_object_keys(s->'points') LOOP
      v_won := (s->'won'->>k)::boolean;
      UPDATE profiles
         SET rating = GREATEST(0, COALESCE(rating, 900) - COALESCE((s->'deltas'->>k)::numeric, 0)),
             rating_games = GREATEST(0, rating_games - 1)
       WHERE id = k::uuid;
      UPDATE player_stats
         SET game_wins = GREATEST(0, game_wins - CASE WHEN v_won THEN 1 ELSE 0 END),
             game_losses = GREATEST(0, game_losses - CASE WHEN v_won THEN 0 ELSE 1 END),
             total_points = GREATEST(0, total_points - COALESCE((s->'points'->>k)::int, 0)),
             updated_at = NOW()
       WHERE user_id = k::uuid AND organization_id = (s->'org'->>k)::uuid;
    END LOOP;
  END LOOP;
  UPDATE league_encounters SET ranked_applied = FALSE, applied_snapshot = NULL WHERE id = v_e.id;
END;
$$;

-- ── O fluxo ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_encounter_result(p_encounter_id UUID, p_matches JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters; v_side TEXT; v_team UUID; v_other UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  v_side := league_side(v_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  -- Quem fala pelos dois clubes não pode fazer as duas metades do fluxo.
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  IF v_e.status IN ('oficial', 'contestado', 'cancelado') THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  v_team := CASE v_side WHEN 'home' THEN v_e.home_team_id ELSE v_e.away_team_id END;
  v_other := CASE v_side WHEN 'home' THEN v_e.away_team_id ELSE v_e.home_team_id END;
  IF v_e.status = 'submetido' AND v_e.submitted_by_team_id <> v_team THEN RAISE EXCEPTION 'already_submitted_by_other'; END IF;
  IF v_e.scheduled_at IS NOT NULL AND v_e.scheduled_at > NOW() THEN RAISE EXCEPTION 'not_played_yet'; END IF;
  PERFORM league_save_matches(v_e, p_matches);
  UPDATE league_encounters
     SET status = 'submetido', submitted_by = auth.uid(), submitted_by_team_id = v_team, submitted_at = NOW(),
         contested_by = NULL, contested_at = NULL, contest_reason = NULL
   WHERE id = v_e.id;
  PERFORM league_log(v_e.league_id, v_e.id, 'result_submitted', jsonb_build_object('team_id', v_team, 'matches', p_matches));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_other)), 'league_result_to_confirm',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id,
                       'club_name', (SELECT o.name FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_team)));
END;
$$;

-- Confirmar e contestar: só o lado que NÃO submeteu, e nunca quem submeteu.
CREATE OR REPLACE FUNCTION league_check_answerer(p_e league_encounters)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_side TEXT; v_team UUID;
BEGIN
  IF p_e.status <> 'submetido' THEN RAISE EXCEPTION 'nothing_to_confirm'; END IF;
  v_side := league_side(p_e);
  IF v_side IS NULL THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  IF v_side = 'both' THEN RAISE EXCEPTION 'conflict_of_interest'; END IF;
  v_team := CASE v_side WHEN 'home' THEN p_e.home_team_id ELSE p_e.away_team_id END;
  IF v_team = p_e.submitted_by_team_id OR auth.uid() = p_e.submitted_by THEN RAISE EXCEPTION 'cannot_confirm_own'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_encounter_result(p_encounter_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  PERFORM league_check_answerer(v_e);
  UPDATE league_encounters SET status = 'oficial', confirmed_by = auth.uid(), confirmed_at = NOW() WHERE id = v_e.id;
  PERFORM apply_league_encounter_ranking(v_e.id);
  PERFORM league_log(v_e.league_id, v_e.id, 'result_confirmed');
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.submitted_by_team_id)), 'league_result_confirmed',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id), 'encounter_id', v_e.id));
END;
$$;

CREATE OR REPLACE FUNCTION contest_encounter_result(p_encounter_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  PERFORM league_check_answerer(v_e);
  IF length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE league_encounters SET status = 'contestado', contested_by = auth.uid(), contested_at = NOW(), contest_reason = trim(p_reason)
   WHERE id = v_e.id;
  PERFORM league_log(v_e.league_id, v_e.id, 'result_contested', jsonb_build_object('reason', trim(p_reason)));
  PERFORM league_notify(ARRAY(SELECT league_manager_ids(v_e.league_id)), 'league_result_contested',
    jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                       'encounter_id', v_e.id, 'reason', trim(p_reason)));
END;
$$;

-- Resolver (disputa, falta de comparência ou correção de um oficial).
CREATE OR REPLACE FUNCTION resolve_encounter(p_encounter_id UUID, p_matches JSONB, p_walkover_team_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e league_encounters; v_before JSONB;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'encounter_not_found'; END IF;
  IF NOT can_manage_league(v_e.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_e.status = 'cancelado' THEN RAISE EXCEPTION 'encounter_locked'; END IF;
  IF length(trim(COALESCE(p_note, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'note_required'; END IF;
  IF p_walkover_team_id IS NOT NULL AND p_walkover_team_id NOT IN (v_e.home_team_id, v_e.away_team_id) THEN
    RAISE EXCEPTION 'walkover_team_invalid';
  END IF;
  v_before := (SELECT COALESCE(jsonb_agg(to_jsonb(m) - 'encounter_id' ORDER BY m.slot), '[]'::jsonb) FROM league_matches m WHERE m.encounter_id = v_e.id);

  PERFORM reverse_league_encounter_ranking(v_e.id);
  IF p_walkover_team_id IS NULL THEN
    PERFORM league_save_matches(v_e, p_matches);
  END IF;
  UPDATE league_encounters
     SET status = 'oficial', walkover_team_id = p_walkover_team_id,
         resolved_by = auth.uid(), resolved_at = NOW(), resolution_note = trim(p_note)
   WHERE id = v_e.id;
  PERFORM apply_league_encounter_ranking(v_e.id);
  PERFORM league_log(v_e.league_id, v_e.id, 'result_resolved',
    jsonb_build_object('before', v_before, 'matches', p_matches, 'walkover_team_id', p_walkover_team_id, 'note', trim(p_note)));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(v_e.home_team_id) UNION SELECT league_team_rep_ids(v_e.away_team_id)),
    'league_result_resolved', jsonb_build_object('league_id', v_e.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_e.league_id),
                                                 'encounter_id', v_e.id, 'note', trim(p_note)));
END;
$$;

-- Fechar uma categoria: sem encontros por oficializar (spec §11 — nunca
-- campeão com disputas pendentes). A Fase 1 acaba pela tabela.
CREATE OR REPLACE FUNCTION finish_league_category(p_category_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c league_categories;
BEGIN
  SELECT * INTO v_c FROM league_categories WHERE id = p_category_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'category_not_found'; END IF;
  IF NOT can_manage_league(v_c.league_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
  IF v_c.status <> 'a_decorrer' THEN RAISE EXCEPTION 'category_not_running'; END IF;
  IF EXISTS (SELECT 1 FROM league_encounters WHERE category_id = v_c.id AND status NOT IN ('oficial', 'cancelado')) THEN
    RAISE EXCEPTION 'pending_encounters';
  END IF;
  UPDATE league_categories SET status = 'terminada' WHERE id = v_c.id;
  UPDATE leagues SET status = 'terminada'
   WHERE id = v_c.league_id AND NOT EXISTS (SELECT 1 FROM league_categories WHERE league_id = v_c.league_id AND status <> 'terminada');
  PERFORM league_log(v_c.league_id, NULL, 'category_finished', jsonb_build_object('category_id', v_c.id));
  PERFORM league_notify(ARRAY(SELECT league_team_rep_ids(t.id) FROM league_teams t WHERE t.category_id = v_c.id AND t.status = 'aprovada'),
    'league_finished', jsonb_build_object('league_id', v_c.league_id, 'league_slug', (SELECT slug FROM leagues WHERE id = v_c.league_id),
                                          'category_id', v_c.id));
END;
$$;

REVOKE ALL ON FUNCTION league_save_matches(league_encounters, JSONB), apply_league_encounter_ranking(UUID),
  reverse_league_encounter_ranking(UUID), league_check_answerer(league_encounters) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION submit_encounter_result(UUID, JSONB), confirm_encounter_result(UUID), contest_encounter_result(UUID, TEXT),
  resolve_encounter(UUID, JSONB, UUID, TEXT), finish_league_category(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_match_winner(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_encounter_result(UUID, JSONB), confirm_encounter_result(UUID), contest_encounter_result(UUID, TEXT),
  resolve_encounter(UUID, JSONB, UUID, TEXT), finish_league_category(UUID) TO authenticated;
```

- [ ] **Step 4: Pedir ao Renato para correr na alinho-dev** (Step 1 primeiro, depois migração e teste). Expected: 7 linhas `OK`. Se a dev tiver alguém admin de dois clubes, acrescentar o caso `conflict_of_interest` ao script e confirmar `OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_liga_5_resultados.sql supabase/tests/liga_5_resultados.sql
git commit -m "Liga: resultado com confirmação cruzada, contestação, resolução; ranking, player_stats e XP (migração 5)"
```

---

### Task 10: Leituras públicas, Home e lembretes

**Files:**
- Create: `supabase/migration_liga_6_leitura.sql`
- Test: `supabase/tests/liga_6_leitura.sql`

**Interfaces:**
- Produces:
  - `get_league_page(p_slug text) → jsonb | null` (anon + authenticated): `{ league: {id, slug, name, kind, scope, district, season_label, description, status, applications_close_at, max_teams_per_category, owner: {name, slug, logo}|null}, categories: [{id, gender, level, rating_tolerance, matches_per_encounter, home_away, points_win, points_draw, points_loss, points_walkover, roster_max, roster_locks_at_round, status}], teams: [{id, category_id, organization_id?, name, club_slug, logo, status, applied_at}], rounds: [{id, category_id, number, window_start, window_end}], encounters: [{id, category_id, round_id, home_team_id, away_team_id, scheduled_at, venue, status, walkover_team_id, sets}], viewer: {signed_in, can_manage, is_owner, team_ids: uuid[], admin_clubs: [{id, name}]} }` — `organization_id` e equipas não aprovadas só para quem organiza ou representa; `sets`/`walkover_team_id` só de encontros oficiais.
  - `get_league_encounter(p_encounter_id uuid) → jsonb | null` (anon + authenticated): `{ encounter: {...como acima, round_number, window_start, window_end, submitted_at, contest_reason?}, league: {slug, name, kind}, category: {...}, home: {id, name, logo}, away: {...}, matches: [{slot, home:[{id,name}], away:[...], sets, winner}] (oficial: todos; submetido/contestado: só reps/managers), rosters: {home:[{user_id,name,gender,band}], away:[...]} (só reps/managers), viewer: {side: 'home'|'away'|'both'|null, can_manage, can_submit, can_answer, can_propose, can_accept} }`.
  - `get_league_team(p_team_id uuid) → jsonb` (authenticated): `{ team: {id, name, status, category, league:{slug,name}}, roster: [{id, user_id, name, band, added_at}], captains: [{user_id, name}], viewer: {can_edit, is_club_admin, locked, roster_max} }`.
  - `league_roster_candidates(p_team_id) → jsonb` (reps): `[{user_id, name, gender, band, problem: null|'already_in_league'|'gender_missing'|'gender'|'level'}]`.
  - `my_league_agenda() → jsonb` (authenticated): `{ encounters: [{id, league_slug, league_name, league_kind, category_gender, category_level, round_number, home_name, away_name, my_side, scheduled_at, venue, status, window_end, needs_my_answer, home_logo, away_logo}], open_leagues: [{slug, name, kind, district, applications_close_at, category_codes:[{gender,level}], my_club_name}] }`.
  - `league_deadline_reminders()` + `cron.schedule('league-deadline-reminders', '0 8 * * *', …)`.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/liga_6_leitura.sql — alinho-dev, depois da migração 6.
-- Reaproveita uma liga publicada da dev com uma candidatura pendente
-- (preencher o slug). Verifica o que vê quem não tem sessão.
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
GRANT ALL ON _r TO anon;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$ DECLARE p jsonb; s text; BEGIN
  p := get_league_page('<slug de uma liga publicada>');
  s := p::text;
  INSERT INTO _r VALUES (p IS NOT NULL, 'anon lê a página da liga');
  INSERT INTO _r VALUES (s NOT LIKE '%@%', 'sem e-mails');
  INSERT INTO _r VALUES (s NOT LIKE '%rating%' AND s NOT LIKE '%phone%', 'sem ranking exato nem telefone');
  INSERT INTO _r VALUES (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'teams') t WHERE t->>'status' <> 'aprovada'),
                         'anon só vê equipas aprovadas');
  INSERT INTO _r VALUES (NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'teams') t WHERE t ? 'organization_id'),
                         'anon não vê ids de clubes');
  INSERT INTO _r VALUES ((p->'viewer'->>'can_manage')::boolean IS FALSE, 'anon não gere');
END $$;
DO $$ BEGIN
  INSERT INTO _r VALUES (get_league_page('<slug de uma liga em rascunho>') IS NULL, 'rascunho invisível a anon');
END $$;
RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migration_liga_6_leitura.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 6: leituras (página pública, encontro,
-- equipa, Home) e lembretes de prazo. Correr primeiro: migrações 1 a 5.
--
-- Tudo o que um visitante sem sessão vê sai daqui, com colunas escolhidas à
-- mão — nunca um select * de uma tabela (lição dos torneios). Nada de
-- e-mails, telefones, ranking exato (só a banda) ou candidaturas alheias.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_league_page(p_slug TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l leagues; v_manage BOOLEAN; v_my UUID[];
BEGIN
  SELECT * INTO v_l FROM leagues WHERE slug = p_slug;
  IF v_l.id IS NULL THEN RETURN NULL; END IF;
  v_manage := auth.uid() IS NOT NULL AND can_manage_league(v_l.id);
  IF v_l.status = 'rascunho' AND NOT v_manage THEN RETURN NULL; END IF;
  v_my := CASE WHEN auth.uid() IS NULL THEN '{}'::uuid[]
               ELSE ARRAY(SELECT t.id FROM league_teams t WHERE t.league_id = v_l.id AND represents_league_team(t.id)) END;

  RETURN jsonb_build_object(
    'league', jsonb_build_object(
      'id', v_l.id, 'slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind, 'scope', v_l.scope, 'district', v_l.district,
      'season_label', v_l.season_label, 'description', v_l.description, 'status', v_l.status,
      'applications_close_at', v_l.applications_close_at, 'max_teams_per_category', v_l.max_teams_per_category,
      'owner', (SELECT jsonb_build_object('name', o.name, 'slug', o.slug, 'logo', o.group_logo_url)
                  FROM organizations o WHERE o.id = v_l.owner_org_id)),
    'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'league_id' - 'created_at' ORDER BY c.gender, c.level), '[]'::jsonb)
                     FROM league_categories c WHERE c.league_id = v_l.id),
    'teams', (SELECT COALESCE(jsonb_agg(
                jsonb_build_object('id', t.id, 'category_id', t.category_id, 'name', COALESCE(t.name, o.name),
                                   'club_slug', o.slug, 'logo', o.group_logo_url, 'status', t.status)
                || CASE WHEN v_manage OR t.id = ANY (v_my)
                        THEN jsonb_build_object('organization_id', t.organization_id, 'applied_at', t.applied_at,
                                                'reject_reason', t.reject_reason, 'waitlist_order', t.waitlist_order)
                        ELSE '{}'::jsonb END
                ORDER BY o.name), '[]'::jsonb)
                FROM league_teams t JOIN organizations o ON o.id = t.organization_id
               WHERE t.league_id = v_l.id AND (t.status = 'aprovada' OR v_manage OR t.id = ANY (v_my))),
    'rounds', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'category_id', r.category_id, 'number', r.number,
                                                           'window_start', r.window_start, 'window_end', r.window_end)
                                         ORDER BY r.number), '[]'::jsonb)
                 FROM league_rounds r WHERE r.league_id = v_l.id),
    'encounters', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', e.id, 'category_id', e.category_id, 'round_id', e.round_id,
                      'home_team_id', e.home_team_id, 'away_team_id', e.away_team_id,
                      'scheduled_at', e.scheduled_at, 'venue', e.venue_text, 'status', e.status,
                      'walkover_team_id', CASE WHEN e.status = 'oficial' THEN e.walkover_team_id END,
                      'sets', CASE WHEN e.status = 'oficial' AND e.walkover_team_id IS NULL
                                   THEN (SELECT jsonb_agg(m.sets ORDER BY m.slot) FROM league_matches m WHERE m.encounter_id = e.id) END)
                    ORDER BY e.scheduled_at NULLS LAST), '[]'::jsonb)
                     FROM league_encounters e WHERE e.league_id = v_l.id),
    'viewer', jsonb_build_object(
      'signed_in', auth.uid() IS NOT NULL, 'can_manage', v_manage,
      'is_owner', auth.uid() IS NOT NULL AND league_is_owner(v_l.id),
      'team_ids', to_jsonb(v_my),
      'admin_clubs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.name), '[]'::jsonb)
                        FROM memberships m JOIN organizations o ON o.id = m.organization_id
                       WHERE m.user_id = auth.uid() AND m.is_admin AND o.kind = 'club')));
END;
$$;

CREATE OR REPLACE FUNCTION get_league_encounter(p_encounter_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e league_encounters; v_l leagues; v_c league_categories; v_r league_rounds;
  v_manage BOOLEAN; v_side TEXT; v_inside BOOLEAN; v_my_team UUID;
BEGIN
  SELECT * INTO v_e FROM league_encounters WHERE id = p_encounter_id;
  IF v_e.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_e.league_id;
  v_manage := auth.uid() IS NOT NULL AND can_manage_league(v_l.id);
  IF v_l.status = 'rascunho' AND NOT v_manage THEN RETURN NULL; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_e.category_id;
  SELECT * INTO v_r FROM league_rounds WHERE id = v_e.round_id;
  v_side := CASE WHEN auth.uid() IS NULL THEN NULL ELSE league_side(v_e) END;
  v_inside := v_manage OR v_side IS NOT NULL;
  v_my_team := CASE v_side WHEN 'home' THEN v_e.home_team_id WHEN 'away' THEN v_e.away_team_id END;

  RETURN jsonb_build_object(
    'encounter', jsonb_build_object(
      'id', v_e.id, 'status', v_e.status, 'scheduled_at', v_e.scheduled_at, 'venue', v_e.venue_text,
      'round_number', v_r.number, 'window_start', v_r.window_start, 'window_end', v_r.window_end,
      'home_team_id', v_e.home_team_id, 'away_team_id', v_e.away_team_id,
      'walkover_team_id', CASE WHEN v_e.status = 'oficial' THEN v_e.walkover_team_id END,
      'proposed_by_team_id', v_e.proposed_by_team_id, 'submitted_by_team_id', v_e.submitted_by_team_id,
      'submitted_at', v_e.submitted_at, 'resolution_note', v_e.resolution_note,
      'contest_reason', CASE WHEN v_inside THEN v_e.contest_reason END),
    'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name, 'kind', v_l.kind),
    'category', to_jsonb(v_c) - 'league_id' - 'created_at',
    'home', (SELECT jsonb_build_object('id', t.id, 'name', COALESCE(t.name, o.name), 'logo', o.group_logo_url)
               FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_e.home_team_id),
    'away', (SELECT jsonb_build_object('id', t.id, 'name', COALESCE(t.name, o.name), 'logo', o.group_logo_url)
               FROM league_teams t JOIN organizations o ON o.id = t.organization_id WHERE t.id = v_e.away_team_id),
    'matches', CASE WHEN v_e.status = 'oficial' OR (v_inside AND v_e.status IN ('submetido', 'contestado')) THEN
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'slot', m.slot, 'sets', m.sets, 'winner', m.winner,
          'home', jsonb_build_array(jsonb_build_object('id', m.home_p1, 'name', (SELECT name FROM profiles WHERE id = m.home_p1)),
                                    jsonb_build_object('id', m.home_p2, 'name', (SELECT name FROM profiles WHERE id = m.home_p2))),
          'away', jsonb_build_array(jsonb_build_object('id', m.away_p1, 'name', (SELECT name FROM profiles WHERE id = m.away_p1)),
                                    jsonb_build_object('id', m.away_p2, 'name', (SELECT name FROM profiles WHERE id = m.away_p2))))
        ORDER BY m.slot), '[]'::jsonb) FROM league_matches m WHERE m.encounter_id = v_e.id)
      ELSE '[]'::jsonb END,
    'rosters', CASE WHEN v_inside THEN jsonb_build_object(
      'home', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name, 'gender', p.gender,
                                                            'band', league_band(r.rating_at_entry)) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_e.home_team_id AND r.removed_at IS NULL),
      'away', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name, 'gender', p.gender,
                                                            'band', league_band(r.rating_at_entry)) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_e.away_team_id AND r.removed_at IS NULL))
      END,
    'viewer', jsonb_build_object(
      'side', v_side, 'can_manage', v_manage,
      'can_submit', v_side IN ('home', 'away') AND (v_e.status IN ('por_marcar', 'proposto', 'marcado')
                    OR (v_e.status = 'submetido' AND v_e.submitted_by_team_id = v_my_team))
                    AND (v_e.scheduled_at IS NULL OR v_e.scheduled_at <= NOW()),
      'can_answer', v_side IN ('home', 'away') AND v_e.status = 'submetido'
                    AND v_e.submitted_by_team_id <> v_my_team AND v_e.submitted_by IS DISTINCT FROM auth.uid(),
      'can_propose', v_side IN ('home', 'away') AND v_e.status IN ('por_marcar', 'proposto', 'marcado'),
      'can_accept', v_side IN ('home', 'away') AND v_e.status = 'proposto' AND v_e.proposed_by_team_id <> v_my_team));
END;
$$;

CREATE OR REPLACE FUNCTION get_league_team(p_team_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams; v_c league_categories; v_l leagues; v_edit BOOLEAN;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_l FROM leagues WHERE id = v_t.league_id;
  v_edit := represents_league_team(v_t.id);
  IF v_t.status <> 'aprovada' AND NOT (v_edit OR can_manage_league(v_l.id)) THEN RETURN NULL; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  RETURN jsonb_build_object(
    'team', jsonb_build_object('id', v_t.id, 'status', v_t.status,
      'name', (SELECT COALESCE(v_t.name, o.name) FROM organizations o WHERE o.id = v_t.organization_id),
      'category', to_jsonb(v_c) - 'league_id' - 'created_at',
      'league', jsonb_build_object('slug', v_l.slug, 'name', v_l.name)),
    'roster', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'user_id', p.id, 'name', p.name,
                                                            'band', league_band(r.rating_at_entry),
                                                            'band_now', league_band(COALESCE(p.rating, 900)),
                                                            'added_at', r.added_at) ORDER BY p.name), '[]'::jsonb)
                 FROM league_roster r JOIN profiles p ON p.id = r.user_id WHERE r.team_id = v_t.id AND r.removed_at IS NULL),
    'captains', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name) ORDER BY p.name), '[]'::jsonb)
                   FROM league_captains c JOIN profiles p ON p.id = c.user_id WHERE c.team_id = v_t.id),
    'viewer', jsonb_build_object('can_edit', v_edit, 'is_club_admin', is_org_admin(v_t.organization_id),
                                 'locked', league_roster_locked(v_c.id), 'roster_max', v_c.roster_max));
END;
$$;

-- Os membros do clube que se podem pôr no plantel, com o motivo de quem não pode.
CREATE OR REPLACE FUNCTION league_roster_candidates(p_team_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t league_teams; v_c league_categories; v_ceiling NUMERIC;
BEGIN
  SELECT * INTO v_t FROM league_teams WHERE id = p_team_id;
  IF v_t.id IS NULL OR NOT represents_league_team(p_team_id) THEN RAISE EXCEPTION 'not_team_rep'; END IF;
  SELECT * INTO v_c FROM league_categories WHERE id = v_t.category_id;
  v_ceiling := CASE v_c.level WHEN 1 THEN NULL WHEN 2 THEN 1800 WHEN 3 THEN 1600 WHEN 4 THEN 1400
                              WHEN 5 THEN 1200 WHEN 6 THEN 1000 ELSE 700 END;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'user_id', p.id, 'name', p.name, 'gender', p.gender, 'band', league_band(COALESCE(p.rating, 900)),
            'problem', CASE
              WHEN EXISTS (SELECT 1 FROM league_roster r WHERE r.league_id = v_t.league_id AND r.user_id = p.id AND r.removed_at IS NULL) THEN 'already_in_league'
              WHEN NULLIF(p.gender, '') IS NULL THEN 'gender_missing'
              WHEN v_c.gender <> 'misto' AND p.gender <> v_c.gender THEN 'gender'
              WHEN v_ceiling IS NOT NULL AND COALESCE(p.rating, 900) >= v_ceiling + v_c.rating_tolerance THEN 'level'
            END) ORDER BY p.name), '[]'::jsonb)
            FROM memberships m JOIN profiles p ON p.id = m.user_id
           WHERE m.organization_id = v_t.organization_id AND NOT m.is_guest
             AND NOT EXISTS (SELECT 1 FROM league_roster r WHERE r.team_id = v_t.id AND r.user_id = p.id AND r.removed_at IS NULL));
END;
$$;

-- A Home: os meus encontros (estou no plantel ou falo pela equipa) e as
-- ligas abertas a que os meus clubes ainda não concorreram.
CREATE OR REPLACE FUNCTION my_league_agenda()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('encounters', '[]'::jsonb, 'open_leagues', '[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'encounters', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'scheduled_at' NULLS LAST), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', e.id, 'league_slug', l.slug, 'league_name', l.name, 'league_kind', l.kind,
        'category_gender', c.gender, 'category_level', c.level, 'round_number', r.number, 'window_end', r.window_end,
        'home_name', COALESCE(th.name, oh.name), 'away_name', COALESCE(ta.name, oa.name),
        'home_logo', oh.group_logo_url, 'away_logo', oa.group_logo_url,
        'my_side', CASE WHEN EXISTS (SELECT 1 FROM league_roster x WHERE x.team_id = e.home_team_id AND x.user_id = v_me AND x.removed_at IS NULL)
                          OR represents_league_team(e.home_team_id) THEN 'home' ELSE 'away' END,
        'scheduled_at', e.scheduled_at, 'venue', e.venue_text, 'status', e.status,
        'needs_my_answer', e.status = 'submetido' AND e.submitted_by IS DISTINCT FROM v_me
                           AND ((represents_league_team(e.home_team_id) AND e.submitted_by_team_id = e.away_team_id)
                             OR (represents_league_team(e.away_team_id) AND e.submitted_by_team_id = e.home_team_id))) AS x
        FROM league_encounters e
        JOIN leagues l ON l.id = e.league_id
        JOIN league_categories c ON c.id = e.category_id
        JOIN league_rounds r ON r.id = e.round_id
        JOIN league_teams th ON th.id = e.home_team_id JOIN organizations oh ON oh.id = th.organization_id
        JOIN league_teams ta ON ta.id = e.away_team_id JOIN organizations oa ON oa.id = ta.organization_id
       WHERE e.status <> 'cancelado' AND l.status IN ('a_decorrer', 'terminada')
         AND r.window_end >= CURRENT_DATE - 30
         AND (EXISTS (SELECT 1 FROM league_roster x WHERE x.user_id = v_me AND x.removed_at IS NULL AND x.team_id IN (e.home_team_id, e.away_team_id))
           OR represents_league_team(e.home_team_id) OR represents_league_team(e.away_team_id))) s),
    'open_leagues', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'slug', l.slug, 'name', l.name, 'kind', l.kind, 'district', l.district,
          'applications_close_at', l.applications_close_at, 'my_club_name', o.name,
          'category_codes', (SELECT jsonb_agg(jsonb_build_object('gender', c.gender, 'level', c.level) ORDER BY c.gender, c.level)
                               FROM league_categories c WHERE c.league_id = l.id))), '[]'::jsonb)
        FROM leagues l
        JOIN memberships m ON m.user_id = v_me AND m.is_admin
        JOIN organizations o ON o.id = m.organization_id AND o.kind = 'club'
       WHERE l.status = 'inscricoes'
         AND (l.applications_close_at IS NULL OR l.applications_close_at > NOW())
         AND (l.district IS NULL OR o.district IS NULL OR l.district = o.district OR l.scope = 'nacional')
         AND l.owner_org_id IS DISTINCT FROM o.id
         AND NOT EXISTS (SELECT 1 FROM league_teams t WHERE t.league_id = l.id AND t.organization_id = o.id)));
END;
$$;

-- Lembrete: 2 dias antes do fim da janela, a quem fala por cada lado de um
-- encontro ainda por jogar. Uma vez só por encontro.
CREATE OR REPLACE FUNCTION league_deadline_reminders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e RECORD; n INTEGER := 0;
BEGIN
  FOR e IN
    SELECT le.*, l.slug, l.name AS league_name FROM league_encounters le
      JOIN league_rounds r ON r.id = le.round_id JOIN leagues l ON l.id = le.league_id
     WHERE r.window_end = CURRENT_DATE + 2 AND le.status IN ('por_marcar', 'proposto', 'marcado')
       AND NOT EXISTS (SELECT 1 FROM notifications nt WHERE nt.kind = 'league_deadline_soon' AND nt.data->>'encounter_id' = le.id::text)
  LOOP
    INSERT INTO notifications (user_id, kind, data)
    SELECT DISTINCT u, 'league_deadline_soon',
           jsonb_build_object('league_id', e.league_id, 'league_slug', e.slug, 'league_name', e.league_name, 'encounter_id', e.id)
      FROM (SELECT league_team_rep_ids(e.home_team_id) AS u UNION SELECT league_team_rep_ids(e.away_team_id)) s;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- cron.schedule substitui o trabalho se já existir: pode correr outra vez.
SELECT cron.schedule('league-deadline-reminders', '0 8 * * *', $$SELECT public.league_deadline_reminders()$$);

REVOKE ALL ON FUNCTION get_league_page(TEXT), get_league_encounter(UUID), get_league_team(UUID),
  league_roster_candidates(UUID), my_league_agenda(), league_deadline_reminders() FROM public;
GRANT EXECUTE ON FUNCTION get_league_page(TEXT), get_league_encounter(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_league_team(UUID), league_roster_candidates(UUID), my_league_agenda() TO authenticated;
REVOKE ALL ON FUNCTION league_deadline_reminders() FROM anon, authenticated;
```

- [ ] **Step 3: Pedir ao Renato para correr na alinho-dev** (migração + teste com os dois slugs). Expected: 7 linhas `OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_liga_6_leitura.sql supabase/tests/liga_6_leitura.sql
git commit -m "Liga: leituras sem dados sensíveis, agenda da Home e lembretes de prazo (migração 6)"
```

---

### Task 11: API, erros e textos

**Files:**
- Create: `src/lib/leagueApi.js`, `src/lib/leagueApi.test.js`
- Modify: `src/locales/pt.json`, `src/locales/en.json`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase`), `signupErrorMessage(t, error, prefix)` de `src/lib/tournamentError.js`.
- Produces: `getLeaguePage(slug)`, `getLeagueEncounter(id)`, `getLeagueTeam(id)`, `rosterCandidates(teamId)`, `myLeagueAgenda()`, `createLeague(d)`, `updateLeague(id, d)`, `publishLeague(id)`, `cancelLeague(id)`, `deleteLeague(id)`, `saveCategory(leagueId, categoryId|null, c)`, `deleteCategory(id)`, `addOrganizer(leagueId, userId)`, `removeOrganizer(leagueId, userId)`, `applyToLeague(categoryId, orgId)`, `withdrawApplication(teamId)`, `decideApplication(teamId, decision, reason)`, `setCaptain(teamId, userId, on)`, `addToRoster(teamId, userId)`, `removeFromRoster(rosterId)`, `saveSchedule(categoryId, rounds, firstStart, days)`, `proposeTime(id, whenIso, venue)`, `acceptTime(id)`, `setTime(id, whenIso, venue)`, `submitResult(id, matches)`, `confirmResult(id)`, `contestResult(id, reason)`, `resolveEncounter(id, matches|null, walkoverTeamId|null, note)`, `finishCategory(id)`, `leagueErrorMessage(t, error)`. Todas as que escrevem devolvem `data` ou lançam o erro do Supabase.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueApi.test.js
import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const api = await import('./leagueApi')

describe('leagueApi', () => {
  it('chama a RPC com os nomes de parâmetros do SQL', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'l1', slug: 'liga-x' }, error: null })
    const r = await api.createLeague({ kind: 'comunitaria', ownerOrgId: 'o1', name: 'Liga X', scope: 'local' })
    expect(r).toEqual({ id: 'l1', slug: 'liga-x' })
    expect(rpc).toHaveBeenCalledWith('create_league', {
      p_kind: 'comunitaria', p_owner_org_id: 'o1', p_name: 'Liga X', p_scope: 'local', p_district: null,
      p_season_label: null, p_description: null, p_applications_close_at: null, p_max_teams: null,
    })
  })
  it('lança o erro do servidor', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'cannot_confirm_own' } })
    await expect(api.confirmResult('e1')).rejects.toEqual({ message: 'cannot_confirm_own' })
  })
  it('a frase do erro vem de league.error_<código>', () => {
    const t = (k) => ({ 'league.error_cannot_confirm_own': 'Não podes confirmar o resultado que enviaste.' }[k] || k)
    expect(api.leagueErrorMessage(t, { message: 'ERROR: cannot_confirm_own' })).toBe('Não podes confirmar o resultado que enviaste.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/leagueApi.test.js` — Expected: FAIL (import).

- [ ] **Step 3: Write the implementation**

```js
// src/lib/leagueApi.js
// As chamadas da Liga entre Clubes (Fase 1) — só transporte, sem regras: as
// regras estão nas RPCs (supabase/migration_liga_*.sql) e na lógica pura
// (leagueSchedule/Result/Standings/Eligibility).
import { supabase } from './supabase'
import { signupErrorMessage } from './tournamentError'

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

/** A frase de um erro da liga (league.error_<código>), ou a genérica. */
export const leagueErrorMessage = (t, error) => signupErrorMessage(t, error, 'league.error_')

export const getLeaguePage = (slug) => rpc('get_league_page', { p_slug: slug })
export const getLeagueEncounter = (id) => rpc('get_league_encounter', { p_encounter_id: id })
export const getLeagueTeam = (id) => rpc('get_league_team', { p_team_id: id })
export const rosterCandidates = (teamId) => rpc('league_roster_candidates', { p_team_id: teamId })
export const myLeagueAgenda = () => rpc('my_league_agenda', {})

export const createLeague = (d) => rpc('create_league', {
  p_kind: d.kind, p_owner_org_id: d.ownerOrgId ?? null, p_name: d.name, p_scope: d.scope,
  p_district: d.district ?? null, p_season_label: d.seasonLabel ?? null, p_description: d.description ?? null,
  p_applications_close_at: d.applicationsCloseAt ?? null, p_max_teams: d.maxTeams ?? null,
})
export const updateLeague = (id, d) => rpc('update_league', {
  p_league_id: id, p_name: d.name, p_scope: d.scope, p_district: d.district ?? null, p_season_label: d.seasonLabel ?? null,
  p_description: d.description ?? null, p_applications_close_at: d.applicationsCloseAt ?? null, p_max_teams: d.maxTeams ?? null,
})
export const publishLeague = (id) => rpc('publish_league', { p_league_id: id })
export const cancelLeague = (id) => rpc('cancel_league', { p_league_id: id })
export const deleteLeague = (id) => rpc('delete_league', { p_league_id: id })
export const saveCategory = (leagueId, categoryId, c) => rpc('upsert_league_category', {
  p_league_id: leagueId, p_category_id: categoryId, p_gender: c.gender, p_level: c.level,
  p_rating_tolerance: c.rating_tolerance, p_matches_per_encounter: c.matches_per_encounter, p_home_away: c.home_away,
  p_points_win: c.points_win, p_points_draw: c.points_draw, p_points_loss: c.points_loss,
  p_points_walkover: c.points_walkover, p_roster_max: c.roster_max, p_roster_locks_at_round: c.roster_locks_at_round,
})
export const deleteCategory = (id) => rpc('delete_league_category', { p_category_id: id })
export const addOrganizer = (leagueId, userId) => rpc('add_league_organizer', { p_league_id: leagueId, p_user_id: userId })
export const removeOrganizer = (leagueId, userId) => rpc('remove_league_organizer', { p_league_id: leagueId, p_user_id: userId })

export const applyToLeague = (categoryId, orgId) => rpc('apply_to_league', { p_category_id: categoryId, p_organization_id: orgId })
export const withdrawApplication = (teamId) => rpc('withdraw_application', { p_team_id: teamId })
export const decideApplication = (teamId, decision, reason = null) =>
  rpc('decide_application', { p_team_id: teamId, p_decision: decision, p_reason: reason })
export const setCaptain = (teamId, userId, on) => rpc('set_league_captain', { p_team_id: teamId, p_user_id: userId, p_on: on })
export const addToRoster = (teamId, userId) => rpc('add_to_roster', { p_team_id: teamId, p_user_id: userId })
export const removeFromRoster = (rosterId) => rpc('remove_from_roster', { p_roster_id: rosterId })

export const saveSchedule = (categoryId, rounds, firstStart, days) =>
  rpc('save_league_schedule', { p_category_id: categoryId, p_rounds: rounds, p_first_start: firstStart, p_round_days: days })
export const proposeTime = (id, whenIso, venue) => rpc('propose_encounter_time', { p_encounter_id: id, p_when: whenIso, p_venue: venue ?? null })
export const acceptTime = (id) => rpc('accept_encounter_time', { p_encounter_id: id })
export const setTime = (id, whenIso, venue) => rpc('set_encounter_time', { p_encounter_id: id, p_when: whenIso, p_venue: venue ?? null })

export const submitResult = (id, matches) => rpc('submit_encounter_result', { p_encounter_id: id, p_matches: matches })
export const confirmResult = (id) => rpc('confirm_encounter_result', { p_encounter_id: id })
export const contestResult = (id, reason) => rpc('contest_encounter_result', { p_encounter_id: id, p_reason: reason })
export const resolveEncounter = (id, matches, walkoverTeamId, note) => rpc('resolve_encounter', {
  p_encounter_id: id, p_matches: matches, p_walkover_team_id: walkoverTeamId, p_note: note,
})
export const finishCategory = (id) => rpc('finish_league_category', { p_category_id: id })
```

- [ ] **Step 4: Add the i18n keys**

Acrescentar a `src/locales/pt.json` (antes do `}` final, respeitando vírgulas) — e as mesmas chaves em `en.json` com a tradução ao lado:

```json
  "league.kind_alinho": "Liga Alinho",
  "league.kind_comunitaria": "Comunitária",
  "league.status_rascunho": "Rascunho",
  "league.status_inscricoes": "Inscrições abertas",
  "league.status_a_decorrer": "A decorrer",
  "league.status_terminada": "Terminada",
  "league.status_cancelada": "Cancelada",
  "league.tab_table": "Tabela",
  "league.tab_rounds": "Jornadas",
  "league.tab_clubs": "Clubes",
  "league.round": "Jornada {{n}}",
  "league.round_of": "de {{total}}",
  "league.home_away": "casa e fora",
  "league.matches_per_encounter_one": "{{count}} partida por encontro",
  "league.matches_per_encounter_other": "{{count}} partidas por encontro",
  "league.your_club": "✓ O teu clube",
  "league.you_play": "✓ Estás escalado",
  "league.your_position": "O teu clube está em {{pos}}.º em {{code}}",
  "league.clubs_count_one": "{{count}} clube",
  "league.clubs_count_other": "{{count}} clubes",
  "league.official_only": "Só contam encontros oficiais.",
  "league.decided_h2h": "Empate a {{points}} pontos: fica à frente quem ganhou o confronto direto.",
  "league.decided_matches": "Empate a {{points}} pontos: desempata a diferença de partidas.",
  "league.decided_sets": "Empate a {{points}} pontos: desempata a diferença de sets.",
  "league.decided_games": "Empate a {{points}} pontos: desempata a diferença de jogos.",
  "league.decided_lot": "Empate em tudo: desempata o sorteio.",
  "league.col_club": "Clube",
  "league.col_won": "V",
  "league.col_drawn": "E",
  "league.col_lost": "D",
  "league.col_matches": "±P",
  "league.col_points": "Pts",
  "league.enc_por_marcar": "Por marcar",
  "league.enc_proposto": "Data proposta",
  "league.enc_marcado": "Marcado",
  "league.enc_submetido": "Por confirmar",
  "league.enc_contestado": "Contestado",
  "league.enc_oficial": "Oficial",
  "league.enc_cancelado": "Cancelado",
  "league.enc_late": "Em atraso",
  "league.at_home": "em casa",
  "league.away": "fora",
  "league.home_of": "Em casa: {{name}}",
  "league.confirm_result": "Confirmar resultado",
  "league.contest": "Contestar",
  "league.contest_title": "Contestar o resultado?",
  "league.contest_message": "Quem organiza a liga vai ver o teu motivo e decidir. Até lá não conta para a tabela.",
  "league.contest_reason": "O que não está certo",
  "league.not_right": "Não está certo",
  "league.submit_result": "Enviar resultado",
  "league.match_n": "Partida {{n}} de {{total}}",
  "league.next_match": "Partida seguinte",
  "league.previous": "‹ Anterior",
  "league.send_for_confirmation": "Enviar para confirmar",
  "league.sets": "Sets",
  "league.waiting_other": "À espera da confirmação de {{name}}",
  "league.pending_answer": "Enviado por {{name}}",
  "league.counts_after_confirm": "Conta para a tabela e para o ranking depois de confirmado.",
  "league.propose_time": "Propor data",
  "league.accept_time": "Aceitar data",
  "league.proposed_by": "Data proposta por {{name}}",
  "league.apply": "Inscrever o clube",
  "league.applied": "Pedido enviado",
  "league.withdraw": "Retirar o pedido",
  "league.approve": "Aprovar",
  "league.waitlist": "Pôr como suplente",
  "league.reject": "Rejeitar",
  "league.reject_title": "Rejeitar o pedido de {{name}}?",
  "league.reject_message": "O clube recebe um aviso com o motivo, se escreveres um.",
  "league.not_yet": "Ainda não",
  "league.roster": "Plantel",
  "league.captains": "Capitães",
  "league.add_player": "Adicionar jogador",
  "league.remove_player": "Tirar",
  "league.level_at_entry": "O nível conta no dia em que o jogador entra. Se subir durante a liga, continua a poder jogar.",
  "league.roster_locked": "O plantel fechou na jornada {{n}}.",
  "league.create": "Criar liga",
  "league.create_kind_desc": "Clubes da tua zona, por jornadas",
  "league.manage": "Gerir liga",
  "league.applications": "Pedidos",
  "league.make_schedule": "Fazer o calendário",
  "league.finish_category": "Fechar a categoria",
  "league.champion": "Campeão",
  "league.empty_rounds_title": "Ainda não há calendário",
  "league.empty_rounds_text": "Aparece quando quem organiza fechar os pedidos.",
  "league.foryou_confirm": "Confirma o resultado de {{when}}",
  "league.foryou_open": "Inscrições abertas: {{name}}",
  "league.error_generic": "Não foi possível. Tenta outra vez.",
  "league.error_not_platform_admin": "Só a equipa do alinho cria uma Liga Alinho.",
  "league.error_not_club_admin": "Só os admins do clube podem fazer isto.",
  "league.error_groups_cannot_create": "Os grupos não criam ligas, só os clubes.",
  "league.error_not_league_manager": "Só quem organiza a liga pode fazer isto.",
  "league.error_not_league_owner": "Só quem criou a liga pode fazer isto.",
  "league.error_applications_closed": "As inscrições já fecharam.",
  "league.error_already_applied": "O teu clube já pediu para entrar nesta categoria.",
  "league.error_category_full": "Esta categoria já está cheia.",
  "league.error_already_in_league": "Este jogador já joga por outro clube nesta liga.",
  "league.error_gender_missing": "Este jogador ainda não escolheu o género no perfil.",
  "league.error_gender": "Esta categoria é de outro género.",
  "league.error_level": "O nível deste jogador está acima do da categoria.",
  "league.error_roster_full": "O plantel está completo.",
  "league.error_roster_locked": "O plantel já fechou.",
  "league.error_not_team_rep": "Só os admins e capitães do clube podem fazer isto.",
  "league.error_conflict_of_interest": "Falas pelos dois clubes: pede a quem organiza que trate deste encontro.",
  "league.error_cannot_confirm_own": "Não podes confirmar o resultado que enviaste.",
  "league.error_already_submitted_by_other": "O outro clube já enviou o resultado. Confirma ou contesta.",
  "league.error_not_played_yet": "O encontro ainda não aconteceu.",
  "league.error_outside_window": "Essa data está fora da jornada.",
  "league.error_not_your_proposal": "Esta data foi proposta pelo teu clube: espera pela resposta.",
  "league.error_set_invalid": "Há um set com um resultado impossível.",
  "league.error_no_winner": "Falta um set: ninguém ganhou 2.",
  "league.error_sets_after_win": "Há um set a mais depois de a partida acabar.",
  "league.error_player_twice": "Ninguém pode jogar duas partidas no mesmo encontro.",
  "league.error_not_in_roster": "Há um jogador que não está no plantel.",
  "league.error_pair_gender": "Uma dupla não cumpre o género da categoria.",
  "league.error_reason_required": "Escreve o que não está certo.",
  "league.error_note_required": "Escreve uma nota sobre a decisão.",
  "league.error_pending_encounters": "Ainda há encontros por fechar.",
  "league.error_schedule_has_results": "Já há resultados: o calendário não pode mudar.",
  "league.error_not_enough_teams": "São precisos pelo menos 2 clubes aprovados.",
  "notif.league_application_received": "{{club}} pediu para entrar na {{league}}",
  "notif.league_application_decided_aprovada": "O teu clube entrou na {{league}}",
  "notif.league_application_decided_rejeitada": "O pedido para a {{league}} não foi aceite",
  "notif.league_application_decided_suplente": "O teu clube ficou como suplente na {{league}}",
  "notif.league_schedule_published": "Já há calendário na {{league}}",
  "notif.league_time_proposed": "Há uma data proposta para um encontro da {{league}}",
  "notif.league_time_accepted": "Encontro marcado na {{league}}",
  "notif.league_result_to_confirm": "{{club}} enviou um resultado: confirma",
  "notif.league_result_confirmed": "Resultado confirmado na {{league}}",
  "notif.league_result_contested": "Um resultado da {{league}} foi contestado",
  "notif.league_result_resolved": "Quem organiza decidiu um resultado da {{league}}",
  "notif.league_deadline_soon": "Faltam 2 dias para acabar a jornada na {{league}}",
  "notif.league_roster_added": "Estás no plantel do {{club}} na {{league}}",
  "notif.league_organizer_added": "Agora organizas a {{league}}",
  "notif.league_finished": "A {{league}} terminou",
  "notif.league_cancelled": "A {{league}} foi cancelada"
```

- [ ] **Step 5: Run tests and the i18n check**

Run: `npx vitest run src/lib/leagueApi.test.js src/lib/i18n.test.js`
Expected: PASS (o `i18n.test.js` existente apanha chaves que faltem em `en.json`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/leagueApi.js src/lib/leagueApi.test.js src/locales/pt.json src/locales/en.json
git commit -m "Liga: chamadas às RPCs, frases de erro e textos pt/en"
```

---

### Task 12: Página da liga (tabela, jornadas, clubes, inscrever)

**Files:**
- Create: `src/components/league/StandingsTable.jsx`, `src/components/league/EncounterRow.jsx`, `src/pages/LeaguePage.jsx`, `src/lib/leagueView.js`, `src/lib/leagueView.test.js`
- Modify: `src/App.jsx` (rota `/liga/:slug`, pública)

**Interfaces:**
- Consumes: `getLeaguePage`, `applyToLeague`, `leagueErrorMessage` (Task 11); `leagueStandings`, `resultsFromEncounters` (Task 3); `EventHero`, `Tabs`, `Chips`, `PrimaryButton`, `EmptyState` (existentes); `categoryCode` de `src/lib/tournaments.js`.
- Produces: `leagueView.categoryRows(page, categoryId) → standings rows`; `leagueView.encounterState(encounter, today: 'AAAA-MM-DD', roundEnd) → 'late'|status`; `leagueView.isMine(encounter, teamIds) → boolean`. Componentes `StandingsTable({ rows, myTeamIds, onTieNote })`, `EncounterRow({ encounter, teams, round, myTeamIds, to })`.

- [ ] **Step 1: Write the failing test for the view helpers**

```js
// src/lib/leagueView.test.js
import { describe, it, expect } from 'vitest'
import { categoryRows, encounterState, isMine } from './leagueView'

const page = {
  categories: [{ id: 'c1', matches_per_encounter: 1, points_win: 3, points_draw: 1, points_loss: 0, points_walkover: -1 }],
  teams: [{ id: 'A', category_id: 'c1', name: 'Maré Alta Padel', status: 'aprovada' }, { id: 'B', category_id: 'c1', name: 'Serra Azul Padel', status: 'aprovada' },
          { id: 'P', category_id: 'c1', name: 'Pendente', status: 'pendente' }],
  encounters: [{ id: 'e1', category_id: 'c1', home_team_id: 'A', away_team_id: 'B', status: 'oficial', walkover_team_id: null, sets: [[[6, 4], [6, 4]]] }],
}

describe('vista da liga', () => {
  it('a tabela só leva equipas aprovadas', () => {
    const rows = categoryRows(page, 'c1')
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B'])
    expect(rows[0].points).toBe(3)
  })
  it('em atraso quando a jornada acabou e o encontro não é oficial', () => {
    expect(encounterState({ status: 'marcado' }, '2026-11-20', '2026-11-16')).toBe('late')
    expect(encounterState({ status: 'oficial' }, '2026-11-20', '2026-11-16')).toBe('oficial')
    expect(encounterState({ status: 'por_marcar' }, '2026-11-10', '2026-11-16')).toBe('por_marcar')
  })
  it('é meu se uma das equipas é minha', () => {
    expect(isMine({ home_team_id: 'A', away_team_id: 'B' }, ['B'])).toBe(true)
    expect(isMine({ home_team_id: 'A', away_team_id: 'B' }, [])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/leagueView.test.js` → FAIL (import).

- [ ] **Step 3: Implement `leagueView.js`**

```js
// src/lib/leagueView.js
// O que a página da liga mostra, a partir do que get_league_page devolve.
import { leagueStandings, resultsFromEncounters } from './leagueStandings'

export function categoryRows(page, categoryId) {
  const cat = page.categories.find((c) => c.id === categoryId)
  if (!cat) return []
  const teams = page.teams.filter((t) => t.category_id === categoryId && t.status === 'aprovada').map((t) => ({ id: t.id, name: t.name }))
  const results = resultsFromEncounters(page.encounters.filter((e) => e.category_id === categoryId), cat.matches_per_encounter)
  return leagueStandings(teams, results, {
    win: cat.points_win, draw: cat.points_draw, loss: cat.points_loss, walkover: cat.points_walkover,
  }, categoryId)
}

const DONE = new Set(['oficial', 'cancelado', 'submetido', 'contestado'])

/** O estado a mostrar: 'late' quando a jornada acabou e ainda não se jogou. */
export function encounterState(encounter, todayKey, roundEnd) {
  if (!DONE.has(encounter.status) && roundEnd && todayKey > roundEnd) return 'late'
  return encounter.status
}

export const isMine = (encounter, teamIds = []) =>
  teamIds.includes(encounter.home_team_id) || teamIds.includes(encounter.away_team_id)
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/leagueView.test.js` → PASS.

- [ ] **Step 5: Write the components and the page**

```jsx
// src/components/league/StandingsTable.jsx
// A tabela de uma categoria (mockup «Página da liga — tabela»). O teu clube
// leva a borda lima e a pastilha «✓ O teu clube» (DESIGN.md: «é contigo»).
import { useTranslation } from 'react-i18next'

const COLS = 'grid grid-cols-[20px_minmax(0,1fr)_22px_22px_22px_32px_30px] items-center gap-1.5'

export default function StandingsTable({ rows, myTeamIds = [] }) {
  const { t } = useTranslation()
  const note = rows.find((r) => r.decidedBy)
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-card bg-white pb-1 shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <div className={`${COLS} min-h-[32px] px-3 font-mono text-[10px] uppercase tracking-[.06em] text-ink-500`}>
          <span className="text-center">#</span><span>{t('league.col_club')}</span>
          <span className="text-center">{t('league.col_won')}</span><span className="text-center">{t('league.col_drawn')}</span>
          <span className="text-center">{t('league.col_lost')}</span><span className="text-center">{t('league.col_matches')}</span>
          <span className="text-center">{t('league.col_points')}</span>
        </div>
        {rows.map((r) => {
          const mine = myTeamIds.includes(r.teamId)
          return (
            <div key={r.teamId}
              className={`${COLS} min-h-[44px] text-sm ${mine ? 'mx-1.5 my-0.5 rounded-ctrl px-1.5 shadow-[0_0_0_2px_#C8DC00]' : 'border-t border-[#EEF0F3] px-3'}`}>
              <span className="text-center font-mono text-[13px]">{r.position}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`truncate ${mine ? 'font-extrabold' : 'font-bold'}`}>{r.name}</span>
                {mine && <span className="shrink-0 rounded-full bg-lime-400 px-1.5 py-0.5 font-display text-[10.5px] font-bold text-ink-900">{t('league.your_club')}</span>}
              </span>
              <span className="text-center font-mono text-[13px]">{r.won}</span>
              <span className="text-center font-mono text-[13px]">{r.drawn}</span>
              <span className="text-center font-mono text-[13px]">{r.lost}</span>
              <span className="text-center font-mono text-[13px]">{r.matchesFor - r.matchesAgainst > 0 ? '+' : ''}{r.matchesFor - r.matchesAgainst}</span>
              <b className="text-center font-mono text-[13px]">{r.points}</b>
            </div>
          )
        })}
      </div>
      <p className="px-0.5 text-[13px] text-ink-500">
        {note ? `${t(`league.decided_${note.decidedBy}`, { points: note.points })} ` : ''}{t('league.official_only')}
      </p>
    </div>
  )
}
```

```jsx
// src/components/league/EncounterRow.jsx
// Um encontro na lista de jornadas (mockup «Página da liga — jornadas»).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../../lib/formatDate'
import { encounterTotals } from '../../lib/leagueResult'

const TONE = { late: '#B13A10', submetido: '#B13A10', contestado: '#B13A10', marcado: '#3F6212', proposto: '#8A1145', por_marcar: '#4B5563', oficial: '#4F535A', cancelado: '#4F535A' }

export default function EncounterRow({ encounter: e, state, home, away, mine, to }) {
  const { t, i18n } = useTranslation()
  const totals = e.status === 'oficial' && e.sets ? encounterTotals(e.sets.map((sets) => ({ sets }))) : null
  const when = e.scheduled_at
    ? `${formatDate(new Date(e.scheduled_at), i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(e.scheduled_at).toLocaleTimeString(i18n.language === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' })}`
    : t('league.enc_por_marcar')
  return (
    <Link to={to} className={`press block rounded-card bg-white px-3.5 py-3 ${mine ? 'shadow-[0_0_0_2px_#C8DC00]' : 'shadow-[0_1px_2px_rgba(17,17,17,.06)]'}`}>
      <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">
        <span>{when}</span>
        {mine
          ? <span className="rounded-full bg-lime-400 px-2 py-0.5 font-display text-[11px] font-bold normal-case tracking-normal text-ink-900">{t('league.your_club')}</span>
          : <span>{t('league.home_of', { name: home?.name || '' })}</span>}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-display text-[15px] font-extrabold leading-tight">
        <span className="truncate">{home?.name}</span>
        <span className="min-w-[52px] text-center text-[22px] tracking-[-.02em]">
          {e.walkover_team_id ? 'FC' : totals ? `${totals.homeMatches}–${totals.awayMatches}` : <span className="text-sm text-ink-500">vs</span>}
        </span>
        <span className="truncate text-right">{away?.name}</span>
      </div>
      {state !== 'oficial' && (
        <p className="mt-2 flex items-center gap-1.5 font-display text-[13px] font-bold" style={{ color: TONE[state] }}>
          <i className="h-[7px] w-[7px] rounded-full" style={{ background: TONE[state] }} />
          {t(state === 'late' ? 'league.enc_late' : `league.enc_${state}`)}
        </p>
      )}
    </Link>
  )
}
```

```jsx
// src/pages/LeaguePage.jsx
// A página da liga (/liga/:slug) — pública, legível sem sessão. Capa com o
// Alino da liga (EventHero kind="league"), separadores Tabela · Jornadas ·
// Clubes e a categoria por chips. Mockups 1 · «Página da liga».
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EventHero from '../components/event/EventHero'
import { Tabs, Chips, PrimaryButton, EmptyState } from '../components/ui'
import StandingsTable from '../components/league/StandingsTable'
import EncounterRow from '../components/league/EncounterRow'
import { getLeaguePage, applyToLeague, leagueErrorMessage } from '../lib/leagueApi'
import { categoryRows, encounterState, isMine } from '../lib/leagueView'
import { categoryCode } from '../lib/tournaments'
import { toDayKey } from '../lib/agenda'

export default function LeaguePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [page, setPage] = useState(undefined)
  const [tab, setTab] = useState('table')
  const [catId, setCatId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => getLeaguePage(slug).then((p) => {
    setPage(p)
    if (p && !catId) setCatId(p.categories[0]?.id || null)
  }).catch(() => setPage(null))
  useEffect(() => { load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (page && catId ? categoryRows(page, catId) : []), [page, catId])
  if (page === undefined) return null
  if (page === null) return <EmptyState title={t('league.empty_rounds_title')} subtitle="" />

  const { league, viewer } = page
  const myTeamIds = viewer.team_ids || []
  const today = toDayKey(new Date())
  const teamsById = new Map(page.teams.map((x) => [x.id, x]))
  const roundsById = new Map(page.rounds.map((r) => [r.id, r]))
  const cat = page.categories.find((c) => c.id === catId)
  const myRow = rows.find((r) => myTeamIds.includes(r.teamId))
  const totalRounds = page.rounds.filter((r) => r.category_id === catId).length
  const currentRound = page.rounds.filter((r) => r.category_id === catId && r.window_start <= today).pop()

  // Inscrever: um admin de clube, inscrições abertas, o clube ainda sem pedido nesta categoria.
  const applyClub = viewer.admin_clubs?.find((c) => !page.teams.some((x) => x.category_id === catId && x.organization_id === c.id))
  const canApply = league.status === 'inscricoes' && cat?.status === 'inscricoes' && applyClub

  const apply = async () => {
    setBusy(true); setError('')
    try { await applyToLeague(catId, applyClub.id); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  return (
    <div className="pb-6">
      <EventHero
        kind="league"
        chip={`${t(`league.kind_${league.kind}`)} · ${page.categories.length} ${page.categories.length === 1 ? 'categoria' : 'categorias'}`}
        org={{ name: league.owner?.name || 'alinho', kindLabel: t(`league.kind_${league.kind}`), logo: league.owner?.logo,
               onOpen: league.owner ? () => navigate(`/clube/${league.owner.slug}`) : null }}
        title={league.name}
        time={currentRound ? t('league.round', { n: currentRound.number }) : null}
        timeAside={currentRound ? t('league.round_of', { total: totalRounds }) : null}
        dateLine={[t(`league.status_${league.status}`), cat?.home_away ? t('league.home_away') : null].filter(Boolean).join(' · ')}
        onBack={() => navigate(-1)}
        onShare={() => navigator.share?.({ title: league.name, url: window.location.href })}
        status={myRow ? { tone: 'kind', text: t('league.your_position', { pos: myRow.position, code: categoryCode(cat.gender, cat.level) }),
                          meta: t('league.clubs_count', { count: rows.length }) } : null}
        manage={viewer.can_manage ? (
          <PrimaryButton variant="ghost" className="w-full" onClick={() => navigate(`/liga/${slug}/gerir`)}>{t('league.manage')}</PrimaryButton>
        ) : null}
      >
        {canApply && <PrimaryButton className="w-full" disabled={busy} onClick={apply}>{t('league.apply')}</PrimaryButton>}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      </EventHero>

      <div className="mt-3 space-y-3">
        <Tabs label={league.name} value={tab} onChange={setTab}
          options={[{ value: 'table', label: t('league.tab_table') }, { value: 'rounds', label: t('league.tab_rounds') }, { value: 'clubs', label: t('league.tab_clubs') }]} />
        {page.categories.length > 1 && (
          <Chips label="Categoria" value={catId} onChange={setCatId}
            options={page.categories.map((c) => ({ value: c.id, label: categoryCode(c.gender, c.level) }))} />
        )}

        {tab === 'table' && <StandingsTable rows={rows} myTeamIds={myTeamIds} />}

        {tab === 'rounds' && (page.rounds.filter((r) => r.category_id === catId).length === 0
          ? <EmptyState pose={null} title={t('league.empty_rounds_title')} subtitle={t('league.empty_rounds_text')} />
          : page.rounds.filter((r) => r.category_id === catId).map((r) => (
            <section key={r.id} className="space-y-2.5">
              <div className="flex items-baseline gap-2 px-0.5 pt-1">
                <b className="font-display text-[20px] font-black tracking-[-.02em]">{t('league.round', { n: r.number })}</b>
                <span className="font-display text-sm font-semibold text-[#5B6068]">{r.window_start} – {r.window_end}</span>
              </div>
              {page.encounters.filter((e) => e.round_id === r.id).map((e) => (
                <EncounterRow key={e.id} encounter={e} state={encounterState(e, today, r.window_end)}
                  home={teamsById.get(e.home_team_id)} away={teamsById.get(e.away_team_id)}
                  mine={isMine(e, myTeamIds)} to={`/liga/${slug}/encontro/${e.id}`} />
              ))}
            </section>
          )))}

        {tab === 'clubs' && (
          <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
            {page.teams.filter((x) => x.category_id === catId).map((x) => (
              <button key={x.id} type="button" onClick={() => navigate(`/liga/${slug}/equipa/${x.id}`)}
                className="flex min-h-[52px] w-full items-center justify-between gap-2 border-t border-[#EEF0F3] px-3.5 text-left first:border-t-0">
                <span className="flex items-center gap-2 font-bold">{x.name}
                  {myTeamIds.includes(x.id) && <span className="rounded-full bg-lime-400 px-1.5 py-0.5 font-display text-[10.5px] font-bold">{t('league.your_club')}</span>}
                </span>
                <span className="font-display text-[13px] font-extrabold text-ink-500">{x.status === 'aprovada' ? '' : t(`league.team_${x.status}`, x.status)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

Em `src/App.jsx`, junto às outras páginas carregadas com `lazyPage`:

```jsx
const LeaguePage = lazyPage(() => import('./pages/LeaguePage'))
```

e junto à rota `/torneio/:id`:

```jsx
        {/* Liga entre Clubes (Fase 1): pública, como o torneio. */}
        <Route path="/liga/:slug" element={<Guard require="public" showSplash={showSplash}><LeaguePage /></Guard>} />
```

Acrescentar a `pt.json`/`en.json`: `"league.team_pendente": "Pendente"`, `"league.team_suplente": "Suplente"`, `"league.team_rejeitada": "Rejeitada"`, `"league.team_retirada": "Retirada"`.

- [ ] **Step 6: Verificar no browser**

Run: `npm run dev` (com o `.env` copiado para o worktree) e abrir `/liga/<slug da dev>` com e sem sessão.
Expected: capa rosa com o Alino da liga; separadores na cinza da página; tabela com «✓ O teu clube» com a borda lima quando és admin de um clube aprovado; sem sessão aparece igual, sem «Inscrever o clube».

- [ ] **Step 7: Run all tests + build, then commit**

Run: `npx vitest run && npm run build` — Expected: tudo PASS e build sem erros.

```bash
git add src/lib/leagueView.js src/lib/leagueView.test.js src/components/league src/pages/LeaguePage.jsx src/App.jsx src/locales/pt.json src/locales/en.json
git commit -m "Liga: página pública com tabela, jornadas, clubes e inscrever o clube"
```

---

### Task 13: Encontro e envio do resultado

**Files:**
- Create: `src/pages/LeagueEncounterPage.jsx`, `src/pages/LeagueResultPage.jsx`, `src/lib/leagueResultDraft.js`, `src/lib/leagueResultDraft.test.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `getLeagueEncounter`, `submitResult`, `confirmResult`, `contestResult`, `proposeTime`, `acceptTime`, `leagueErrorMessage`; `matchWinner`; `lineupProblem`; `EventHero`, `ConfirmSheet`, `StepPage`, `PrimaryButton`.
- Produces: `emptyDraft(n) → Array<{ slot, home:[null,null], away:[null,null], sets:[[null,null],[null,null],[null,null]] }>`; `draftToMatches(draft) → p_matches` (tira o 3.º set quando vazio); `draftProblem(draft, category, rosters, side) → null|código` (usa `lineupProblem` para os dois lados e `matchWinner` para os sets).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueResultDraft.test.js
import { describe, it, expect } from 'vitest'
import { emptyDraft, draftToMatches, draftProblem } from './leagueResultDraft'

const cat = { gender: 'masculino', matches_per_encounter: 1 }
const rosters = {
  home: [{ user_id: 'h1', gender: 'masculino' }, { user_id: 'h2', gender: 'masculino' }],
  away: [{ user_id: 'a1', gender: 'masculino' }, { user_id: 'a2', gender: 'masculino' }],
}

describe('rascunho do resultado', () => {
  it('começa vazio com o número de partidas da categoria', () => {
    expect(emptyDraft(3)).toHaveLength(3)
    expect(emptyDraft(1)[0]).toEqual({ slot: 1, home: [null, null], away: [null, null], sets: [[null, null], [null, null], [null, null]] })
  })
  it('converte para o formato da RPC, sem o 3.º set vazio', () => {
    const d = emptyDraft(1)
    d[0] = { slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 4], [6, 3], [null, null]] }
    expect(draftToMatches(d)).toEqual([{ slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 4], [6, 3]] }])
    expect(draftProblem(d, cat, rosters)).toBeNull()
  })
  it('diz o que falta', () => {
    const d = emptyDraft(1)
    expect(draftProblem(d, cat, rosters)).toBe('incomplete')
    d[0] = { slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 5], [6, 3], [null, null]] }
    expect(draftProblem(d, cat, rosters)).toBe('set_invalid')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/leagueResultDraft.test.js` → FAIL.

- [ ] **Step 3: Implement `leagueResultDraft.js`**

```js
// src/lib/leagueResultDraft.js
// O resultado que um clube está a preencher, partida a partida, antes de o
// enviar (LeagueResultPage). As mesmas regras que o servidor volta a ver.
import { matchWinner } from './leagueResult'
import { lineupProblem } from './leagueEligibility'

export const emptyDraft = (n) => Array.from({ length: n }, (_, i) => ({
  slot: i + 1, home: [null, null], away: [null, null], sets: [[null, null], [null, null], [null, null]],
}))

const filledSets = (sets) => sets.filter(([h, a]) => h !== null && h !== '' && a !== null && a !== '').map(([h, a]) => [Number(h), Number(a)])

export const draftToMatches = (draft) => draft.map((m) => ({ slot: m.slot, home: m.home, away: m.away, sets: filledSets(m.sets) }))

export function draftProblem(draft, category, rosters) {
  for (const side of ['home', 'away']) {
    const list = rosters?.[side] || []
    const p = lineupProblem(category, draft.map((m) => ({ p1: m[side][0], p2: m[side][1] })), {
      rosterIds: new Set(list.map((r) => r.user_id)),
      genders: Object.fromEntries(list.map((r) => [r.user_id, r.gender])),
    })
    if (p) return p
  }
  for (const m of draft) {
    const r = matchWinner(filledSets(m.sets))
    if (r.problem) return r.problem
  }
  return null
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Write the two pages**

```jsx
// src/pages/LeagueEncounterPage.jsx
// Um encontro (/liga/:slug/encontro/:id) — mockup «Encontro — confirmar
// resultado». Uma ação lima por ecrã: «Confirmar resultado» (quem responde)
// ou «Enviar resultado» (quem joga); «Contestar» em contorno, com folha.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EventHero from '../components/event/EventHero'
import { PrimaryButton, ConfirmSheet } from '../components/ui'
import { getLeagueEncounter, confirmResult, contestResult, acceptTime, leagueErrorMessage } from '../lib/leagueApi'
import { encounterTotals } from '../lib/leagueResult'
import { formatDate } from '../lib/formatDate'
import { categoryCode } from '../lib/tournaments'

export default function LeagueEncounterPage() {
  const { slug, id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(undefined)
  const [contestOpen, setContestOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const load = () => getLeagueEncounter(id).then(setData).catch(() => setData(null))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null

  const { encounter: e, home, away, matches, viewer, category, league } = data
  const totals = matches.length ? encounterTotals(matches) : null
  const when = e.scheduled_at ? new Date(e.scheduled_at) : null
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (err) { setError(leagueErrorMessage(t, err)) } }

  return (
    <div className="pb-6">
      <EventHero
        kind="league"
        chip={`${t('agenda.kind_league')} · ${categoryCode(category.gender, category.level)} · ${t('league.round', { n: e.round_number })}`}
        org={{ name: league.name, onOpen: () => navigate(`/liga/${slug}`) }}
        title={`${home.name} vs ${away.name}`}
        time={when ? when.toLocaleTimeString(i18n.language === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' }) : null}
        timeAside={viewer.side === 'home' ? t('league.at_home') : viewer.side === 'away' ? t('league.away') : null}
        dateLine={[when ? formatDate(when, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }) : t('league.enc_por_marcar'), e.venue].filter(Boolean).join(' · ')}
        onBack={() => navigate(-1)}
        status={{ tone: e.status === 'oficial' ? 'ok' : 'kind',
                  text: `${t(`league.enc_${e.status}`)}${totals ? ` · ${totals.homeMatches}–${totals.awayMatches}` : ''}`,
                  meta: e.status === 'submetido' ? t('league.pending_answer', { name: e.submitted_by_team_id === home.id ? home.name : away.name }) : null,
                  note: e.status === 'submetido' ? t('league.counts_after_confirm') : e.resolution_note }}
      >
        {matches.length > 0 && (
          <div className="overflow-hidden rounded-[14px] bg-surface">
            {matches.map((m) => (
              <div key={m.slot} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-[#E9EAE5] px-3 py-2.5 text-sm first:border-t-0">
                {['home', 'away'].map((side) => (
                  <div key={side} className="contents">
                    <span className={m.winner === side ? 'font-extrabold' : 'text-ink-500'}>{m[side].map((p) => p.name).join(' / ')}</span>
                    <span className={`flex justify-end gap-2.5 font-mono font-bold ${m.winner === side ? '' : 'text-ink-500'}`}>
                      {m.sets.map((s, i) => <span key={i}>{side === 'home' ? s[0] : s[1]}</span>)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {viewer.can_answer && <PrimaryButton className="w-full" onClick={() => run(() => confirmResult(id))}>{t('league.confirm_result')}</PrimaryButton>}
        {viewer.can_answer && <PrimaryButton variant="ghost" className="w-full" onClick={() => setContestOpen(true)}>{t('league.contest')}</PrimaryButton>}
        {!viewer.can_answer && viewer.can_submit && (
          <PrimaryButton className="w-full" onClick={() => navigate(`/liga/${slug}/encontro/${id}/resultado`)}>{t('league.submit_result')}</PrimaryButton>
        )}
        {viewer.can_accept && <PrimaryButton variant="ghost" className="w-full" onClick={() => run(() => acceptTime(id))}>{t('league.accept_time')}</PrimaryButton>}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      </EventHero>

      <ConfirmSheet open={contestOpen} title={t('league.contest_title')} message={t('league.contest_message')}
        confirmLabel={t('league.contest')} cancelLabel={t('league.not_yet')} confirmDisabled={reason.trim().length < 3}
        onClose={() => setContestOpen(false)} errorOf={(err) => leagueErrorMessage(t, err)}
        onConfirm={async () => { await contestResult(id, reason.trim()); setContestOpen(false); await load() }}>
        <label className="mt-3 block text-sm font-bold">{t('league.contest_reason')}
          <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} rows={3}
            className="mt-1.5 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
        </label>
      </ConfirmSheet>
    </div>
  )
}
```

```jsx
// src/pages/LeagueResultPage.jsx
// Enviar o resultado por passos, uma partida por passo (mockup «Submeter
// resultado»): «Partida seguinte» lima preso em baixo (StepPage), «‹ Anterior»
// como texto junto ao título do passo.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StepPage from '../components/steps/StepPage'
import { getLeagueEncounter, submitResult, leagueErrorMessage } from '../lib/leagueApi'
import { emptyDraft, draftToMatches, draftProblem } from '../lib/leagueResultDraft'

function PlayerSelect({ value, options, onChange, label }) {
  return (
    <select aria-label={label} value={value || ''} onChange={(e) => onChange(e.target.value || null)}
      className="min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3 text-base font-bold">
      <option value="">—</option>
      {options.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
    </select>
  )
}

export default function LeagueResultPage() {
  const { slug, id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState([])
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getLeagueEncounter(id).then((d) => { setData(d); setDraft(emptyDraft(d.category.matches_per_encounter)) })
  }, [id])
  if (!data || !draft.length) return null

  const total = draft.length
  const m = draft[step]
  const set = (patch) => setDraft((d) => d.map((x, i) => (i === step ? { ...x, ...patch } : x)))
  const setScore = (si, side, v) => set({ sets: m.sets.map((s, i) => (i === si ? (side === 0 ? [v === '' ? null : Number(v), s[1]] : [s[0], v === '' ? null : Number(v)]) : s)) })
  const last = step === total - 1
  const problem = last ? draftProblem(draft, data.category, data.rosters) : null

  const next = async () => {
    if (!last) { setStep(step + 1); return }
    setBusy(true); setError('')
    try { await submitResult(id, draftToMatches(draft)); navigate(`/liga/${slug}/encontro/${id}`, { replace: true }) }
    catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  return (
    <StepPage
      title={t('league.match_n', { n: step + 1, total })}
      subtitle={`${data.home.name} vs ${data.away.name}`}
      step={step + 1} total={total}
      onBack={step > 0 ? () => setStep(step - 1) : () => navigate(-1)}
      onNext={next} nextLabel={last ? t('league.send_for_confirmation') : t('league.next_match')}
      nextDisabled={!!problem} nextHint={problem ? t(`league.error_${problem}`) : null}
      error={error} busy={busy}
    >
      {['home', 'away'].map((side) => (
        <div key={side} className="mb-4 space-y-2">
          <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{data[side].name}</p>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((k) => (
              <PlayerSelect key={k} label={`${data[side].name} ${k + 1}`} value={m[side][k]} options={data.rosters[side]}
                onChange={(v) => set({ [side]: m[side].map((x, i) => (i === k ? v : x)) })} />
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_48px_48px_48px] items-center gap-2">
            <span className="text-[13px] text-ink-500">{t('league.sets')}</span>
            {[0, 1, 2].map((si) => (
              <input key={si} inputMode="numeric" aria-label={`${data[side].name} set ${si + 1}`}
                value={m.sets[si][side === 'home' ? 0 : 1] ?? ''} onChange={(e) => setScore(si, side === 'home' ? 0 : 1, e.target.value.replace(/\D/g, ''))}
                className="h-12 w-12 rounded-ctrl border border-line bg-white text-center font-display text-lg font-extrabold" />
            ))}
          </div>
        </div>
      ))}
    </StepPage>
  )
}
```

> `StepPage` já desenha «‹» e o botão preso em baixo; confirmar no browser que o botão do passo sai lima (é a ação de quem joga). Se o `StepPage` só tiver o botão preto, passar a variante lima pela prop que ele já usa para isso — verificar em `src/components/steps/StepPage.jsx` antes de mudar.

Rotas em `src/App.jsx`:

```jsx
const LeagueEncounterPage = lazyPage(() => import('./pages/LeagueEncounterPage'))
const LeagueResultPage = lazyPage(() => import('./pages/LeagueResultPage'))
```

```jsx
        <Route path="/liga/:slug/encontro/:id" element={<Guard require="public" showSplash={showSplash}><LeagueEncounterPage /></Guard>} />
        <Route path="/liga/:slug/encontro/:id/resultado" element={<Guard require="protected" showSplash={showSplash}><LeagueResultPage /></Guard>} />
```

- [ ] **Step 6: Verificar no browser** com dois utilizadores da dev (admin A e admin B): A envia → B vê «Confirmar resultado» lima e «Contestar» em contorno; A não vê «Confirmar».

- [ ] **Step 7: Tests + build + commit**

Run: `npx vitest run && npm run build` → PASS.

```bash
git add src/lib/leagueResultDraft.js src/lib/leagueResultDraft.test.js src/pages/LeagueEncounterPage.jsx src/pages/LeagueResultPage.jsx src/App.jsx
git commit -m "Liga: página do encontro (confirmar, contestar, aceitar data) e envio do resultado por passos"
```

---

### Task 14: Plantel e capitães

**Files:**
- Create: `src/pages/LeagueTeamPage.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `getLeagueTeam`, `rosterCandidates`, `addToRoster`, `removeFromRoster`, `setCaptain`, `leagueErrorMessage`; `BackBar`, `PrimaryButton`, `ConfirmSheet`.

- [ ] **Step 1: Write the page**

```jsx
// src/pages/LeagueTeamPage.jsx
// O plantel de um clube na liga (/liga/:slug/equipa/:teamId) — mockup
// «Plantel do clube». Página sem capa: título grande na página e só «‹» em
// cima (BackBar). «Adicionar jogador» a preto (ação de quem organiza o clube).
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, PrimaryButton, ConfirmSheet } from '../components/ui'
import { getLeagueTeam, rosterCandidates, addToRoster, removeFromRoster, setCaptain, leagueErrorMessage } from '../lib/leagueApi'
import { categoryCode } from '../lib/tournaments'

const Level = ({ band, gender }) => (
  <span className="rounded-full bg-ink-900 px-2 py-0.5 font-mono text-[10.5px] font-bold text-lime-400">
    {band === 7 ? 'INI' : `${gender === 'feminino' ? 'F' : 'M'}${band}`}
  </span>
)

export default function LeagueTeamPage() {
  const { slug, teamId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [picking, setPicking] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [error, setError] = useState('')
  const load = () => getLeagueTeam(teamId).then(setData)
  useEffect(() => { load() }, [teamId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  const { team, roster, captains, viewer } = data
  const cat = team.category
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } }

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate(-1)} title={team.name} />
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[#8A1145]">{team.name} · {categoryCode(cat.gender, cat.level)}</p>
        <h1 className="mt-1 font-display text-[30px] font-black tracking-[-.02em]">{t('league.roster')}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{viewer.locked ? t('league.roster_locked', { n: cat.roster_locks_at_round }) : t('league.level_at_entry')}</p>
      </div>

      <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <p className="px-3.5 pb-2 pt-3 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{t('league.captains')}</p>
        {captains.map((c) => (
          <div key={c.user_id} className="flex min-h-[52px] items-center justify-between border-t border-[#EEF0F3] px-3.5">
            <b>{c.name}</b>
            {viewer.is_club_admin && (
              <button type="button" className="min-h-[44px] font-display text-sm font-extrabold underline underline-offset-[3px]"
                onClick={() => run(() => setCaptain(teamId, c.user_id, false))}>{t('league.remove_player')}</button>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <p className="px-3.5 pb-2 pt-3 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{t('league.roster')} · {roster.length}/{viewer.roster_max}</p>
        {roster.map((r) => (
          <div key={r.id} className="flex min-h-[56px] items-center gap-3 border-t border-[#EEF0F3] px-3.5">
            <b className="min-w-0 flex-1 truncate">{r.name}</b>
            <Level band={r.band} gender={cat.gender === 'feminino' ? 'feminino' : 'masculino'} />
            {viewer.can_edit && (
              <button type="button" className="min-h-[44px] pl-1.5 font-display text-sm font-extrabold underline underline-offset-[3px]"
                onClick={() => setRemoving(r)}>{t('league.remove_player')}</button>
            )}
          </div>
        ))}
      </div>

      {viewer.can_edit && !viewer.locked && roster.length < viewer.roster_max && (
        <PrimaryButton variant="ink" className="w-full" onClick={() => rosterCandidates(teamId).then(setPicking)}>{t('league.add_player')}</PrimaryButton>
      )}
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      {picking && (
        <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
          {picking.map((p) => (
            <button key={p.user_id} type="button" disabled={!!p.problem}
              onClick={() => run(async () => { await addToRoster(teamId, p.user_id); setPicking(null) })}
              className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#EEF0F3] px-3.5 text-left first:border-t-0 disabled:text-ink-500">
              <span className="min-w-0 flex-1"><b className="block truncate">{p.name}</b>
                {p.problem && <small className="block text-[12.5px]">{t(`league.error_${p.problem}`)}</small>}</span>
            </button>
          ))}
        </div>
      )}

      <ConfirmSheet open={!!removing} title={removing ? `${t('league.remove_player')} ${removing.name}?` : ''}
        message={viewer.locked ? t('league.roster_locked', { n: cat.roster_locks_at_round }) : ''}
        confirmLabel={t('league.remove_player')} cancelLabel={t('league.not_yet')}
        onClose={() => setRemoving(null)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await removeFromRoster(removing.id); setRemoving(null); await load() }} />
      <p className="sr-only">{slug}</p>
    </div>
  )
}
```

Rota em `src/App.jsx`:

```jsx
const LeagueTeamPage = lazyPage(() => import('./pages/LeagueTeamPage'))
```
```jsx
        <Route path="/liga/:slug/equipa/:teamId" element={<Guard require="protected" showSplash={showSplash}><LeagueTeamPage /></Guard>} />
```

- [ ] **Step 2: Verificar no browser**: como admin do clube, adicionar um jogador elegível; um jogador já no outro clube aparece cinzento com «Este jogador já joga por outro clube nesta liga.»

- [ ] **Step 3: Build + commit**

Run: `npx vitest run && npm run build` → PASS.

```bash
git add src/pages/LeagueTeamPage.jsx src/App.jsx
git commit -m "Liga: plantel do clube com capitães e motivo de quem não pode entrar"
```

---

### Task 15: Criar liga e gerir (pedidos, calendário, disputas, organizadores)

**Files:**
- Create: `src/pages/CreateLeaguePage.jsx`, `src/pages/LeagueManagePage.jsx`
- Modify: `src/components/gerir/CreateKindSheet.jsx`, o ficheiro que monta `CreateKindSheet` com a lista `kinds` (procurar com `grep -rn "CreateKindSheet" src`), `src/App.jsx`

**Interfaces:**
- Consumes: `createLeague`, `saveCategory`, `publishLeague`, `getLeaguePage`, `decideApplication`, `saveSchedule`, `resolveEncounter`, `finishCategory`, `addOrganizer`, `removeOrganizer`; `roundRobin`, `roundWindows`; `CATEGORY_DEFAULTS`, `categoryProblem`; `useAuth()` (`profile.is_platform_admin`); `StepPage`, `Chips`, `Tabs`, `PrimaryButton`, `ConfirmSheet`, `PlayerSearch` (existente, para escolher co-organizadores).

- [ ] **Step 1: Ligar a liga ao «＋ Criar» do Gerir**

Em `src/components/gerir/CreateKindSheet.jsx`:

```js
const KIND_OF = { mix: 'mix', aberto: 'open', torneio: 'tournament', liga: 'league', turma: 'lesson', amigos: 'friends' }
const LABEL = {
  mix: 'gerirclube.event_label_mix',
  aberto: 'gerirclube.create_kind_open',
  torneio: 'gerirclube.event_label_tournament',
  liga: 'agenda.kind_league',
  turma: 'gerirclube.event_label_series',
  amigos: 'gerirclube.create_kind_friends',
}
```

Acrescentar `"gerirclube.create_desc_liga": "Clubes da tua zona, por jornadas"` (pt) / `"Clubs near you, round by round"` (en).

O distrito do clube (`organizations.district`, migração 1) é o que faz uma liga aparecer em «Para ti» a clubes da mesma zona: no formulário de dados do clube em `src/pages/GerirClube.jsx` (onde já se edita `location`), acrescentar um `Select` «Distrito» com os 18 distritos + «Açores» + «Madeira», gravado no mesmo `update` de `organizations` que já lá existe. Sem distrito, o clube vê as ligas de todos os distritos (ver `my_league_agenda`). No ficheiro que passa `kinds` à folha, pôr `'liga'` logo a seguir a `'torneio'` (ordem dos tipos do DESIGN.md) **só quando a organização é um clube** (`org.kind === 'club'`), e no `onPick('liga')` navegar para `/gerir/${slug}/criar/liga`.

- [ ] **Step 2: Write `CreateLeaguePage.jsx`**

```jsx
// src/pages/CreateLeaguePage.jsx
// Criar uma liga por passos (/gerir/:slug/criar/liga) — mockup «Criar liga».
// Passo 1: liga (nome, âmbito, distrito, prazo, máximo de clubes; a
// plataforma escolhe «Liga Alinho» aqui). Passo 2: categoria (com os valores
// por omissão). No fim: criar, gravar a categoria e publicar. O servidor
// valida tudo outra vez; aqui é para dizer o que falta antes de tentar.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StepPage from '../components/steps/StepPage'
import { Chips } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { createLeague, saveCategory, publishLeague, leagueErrorMessage } from '../lib/leagueApi'
import { CATEGORY_DEFAULTS, categoryProblem } from '../lib/leagueConfig'

const field = 'min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3.5 text-base'

export default function CreateLeaguePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { profile, memberships } = useAuth()
  const org = memberships?.find((m) => m.organizations?.slug === slug)?.organizations
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [league, setLeague] = useState({ kind: 'comunitaria', name: '', scope: 'local', district: org?.district || '', applicationsCloseAt: '', maxTeams: 8 })
  const [cat, setCat] = useState({ ...CATEGORY_DEFAULTS, gender: 'masculino', level: 4 })

  const leagueProblem = league.name.trim().length < 3 ? 'name' : null
  const catProblem = categoryProblem(cat)

  const finish = async () => {
    setBusy(true); setError('')
    try {
      const created = await createLeague({
        kind: league.kind, ownerOrgId: league.kind === 'comunitaria' ? org?.id : null, name: league.name.trim(), scope: league.scope,
        district: league.district || null, applicationsCloseAt: league.applicationsCloseAt ? new Date(league.applicationsCloseAt).toISOString() : null,
        maxTeams: league.maxTeams || null,
      })
      await saveCategory(created.id, null, cat)
      await publishLeague(created.id)
      navigate(`/liga/${created.slug}`, { replace: true })
    } catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  if (step === 1) return (
    <StepPage title={t('league.create')} step={1} total={2} onBack={() => navigate(-1)}
      onNext={() => setStep(2)} nextLabel={t('ui.next', 'Seguinte')} nextDisabled={!!leagueProblem}>
      <div className="space-y-4">
        {profile?.is_platform_admin && (
          <Chips label="Tipo" value={league.kind} onChange={(v) => setLeague({ ...league, kind: v })}
            options={[{ value: 'comunitaria', label: t('league.kind_comunitaria') }, { value: 'alinho', label: t('league.kind_alinho') }]} />
        )}
        <input className={field} placeholder="Nome da liga" value={league.name} maxLength={80} onChange={(e) => setLeague({ ...league, name: e.target.value })} />
        <Chips label="Âmbito" value={league.scope} onChange={(v) => setLeague({ ...league, scope: v })}
          options={[{ value: 'local', label: 'Local' }, { value: 'regional', label: 'Regional' }, { value: 'nacional', label: 'Nacional' }]} />
        <input className={field} placeholder="Distrito" value={league.district} onChange={(e) => setLeague({ ...league, district: e.target.value })} />
        <label className="block text-sm font-bold">Inscrições até
          <input type="datetime-local" className={`${field} mt-1.5`} value={league.applicationsCloseAt} onChange={(e) => setLeague({ ...league, applicationsCloseAt: e.target.value })} />
        </label>
        <label className="block text-sm font-bold">Máximo de clubes por categoria
          <input inputMode="numeric" className={`${field} mt-1.5`} value={league.maxTeams ?? ''} onChange={(e) => setLeague({ ...league, maxTeams: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} />
        </label>
      </div>
    </StepPage>
  )

  return (
    <StepPage title="Categoria" step={2} total={2} onBack={() => setStep(1)}
      onNext={finish} nextLabel={t('league.create')} nextDisabled={!!catProblem}
      nextHint={catProblem ? t(`league.error_${catProblem}`, t('league.error_generic')) : null} error={error} busy={busy}>
      <div className="space-y-4">
        <Chips label="Quem joga" value={cat.gender} onChange={(v) => setCat({ ...cat, gender: v })}
          options={[{ value: 'masculino', label: 'Homens' }, { value: 'feminino', label: 'Mulheres' }, { value: 'misto', label: 'Mistos' }]} />
        <Chips label="Nível" value={cat.level} onChange={(v) => setCat({ ...cat, level: v })}
          options={[6, 5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${cat.gender === 'feminino' ? 'F' : cat.gender === 'misto' ? 'MX' : 'M'}${n}` }))} />
        <Chips label="Partidas por encontro" value={cat.matches_per_encounter} onChange={(v) => setCat({ ...cat, matches_per_encounter: v, roster_max: Math.max(cat.roster_max, v * 2) })}
          options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} />
        <Chips label="Casa e fora" value={cat.home_away} onChange={(v) => setCat({ ...cat, home_away: v })}
          options={[{ value: false, label: 'Uma volta' }, { value: true, label: 'Casa e fora' }]} />
        <p className="text-[13px] text-ink-500">Vitória {cat.points_win} · empate {cat.points_draw} · derrota {cat.points_loss} · falta {cat.points_walkover}. O plantel fecha na jornada {cat.roster_locks_at_round}.</p>
      </div>
    </StepPage>
  )
}
```

> Antes de escrever: confirmar em `src/contexts/AuthContext.jsx` o nome do campo das memberships (o `value` do provider) e como cada uma traz a organização (`organizations` ou outro). Ajustar a linha `const org = …` ao que lá está; o resto não depende disso. As etiquetas em linha («Homens», «Âmbito»…) passam a chaves `league.create_*` em `pt.json`/`en.json` no mesmo commit.

- [ ] **Step 3: Write `LeagueManagePage.jsx`**

```jsx
// src/pages/LeagueManagePage.jsx
// Gerir a liga (/liga/:slug/gerir) — mockup «Gerir — candidaturas».
// Separadores: Pedidos · Jornadas · Equipa (organizadores). Ações de quem
// organiza a preto; «Rejeitar» é texto vermelho que abre a folha.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, Tabs, Chips, PrimaryButton, ConfirmSheet } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import { getLeaguePage, decideApplication, saveSchedule, finishCategory, addOrganizer, leagueErrorMessage } from '../lib/leagueApi'
import { roundRobin } from '../lib/leagueSchedule'
import { categoryCode } from '../lib/tournaments'
import { toDayKey } from '../lib/agenda'

export default function LeagueManagePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [page, setPage] = useState(null)
  const [tab, setTab] = useState('requests')
  const [catId, setCatId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [firstStart, setFirstStart] = useState(toDayKey(new Date()))
  const [days, setDays] = useState(14)
  const [error, setError] = useState('')
  const load = () => getLeaguePage(slug).then((p) => { setPage(p); setCatId((c) => c || p?.categories[0]?.id) })
  useEffect(() => { load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!page) return null
  if (!page.viewer.can_manage) { navigate(`/liga/${slug}`, { replace: true }); return null }

  const cat = page.categories.find((c) => c.id === catId)
  const teams = page.teams.filter((x) => x.category_id === catId)
  const pending = teams.filter((x) => x.status === 'pendente' || x.status === 'suplente')
  const approved = teams.filter((x) => x.status === 'aprovada')
  const disputes = page.encounters.filter((e) => e.category_id === catId && e.status === 'contestado')
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } }

  const makeSchedule = () => run(() => {
    // Ordem estável: a da aprovação (applied_at), para o calendário ser repetível.
    const ids = [...approved].sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at))).map((x) => x.id)
    return saveSchedule(catId, roundRobin(ids, { homeAway: cat.home_away }), firstStart, days)
  })

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate(`/liga/${slug}`)} title={page.league.name} />
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[#8A1145]">{t('league.manage')} · {page.league.name}</p>
        <h1 className="mt-1 font-display text-[30px] font-black tracking-[-.02em]">{t('league.applications')}</h1>
      </div>
      <Tabs label={t('league.manage')} value={tab} onChange={setTab}
        options={[{ value: 'requests', label: t('league.applications'), badge: pending.length }, { value: 'rounds', label: t('league.tab_rounds'), badge: disputes.length }, { value: 'team', label: 'Equipa' }]} />
      {page.categories.length > 1 && (
        <Chips label="Categoria" value={catId} onChange={setCatId} options={page.categories.map((c) => ({ value: c.id, label: categoryCode(c.gender, c.level) }))} />
      )}
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      {tab === 'requests' && pending.map((x) => (
        <div key={x.id} className="space-y-2 rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,.06)]">
          <b className="block font-display text-base font-extrabold">{x.name}</b>
          <PrimaryButton variant="ink" className="w-full" onClick={() => run(() => decideApplication(x.id, 'aprovada'))}>{t('league.approve')}</PrimaryButton>
          {x.status === 'pendente' && <PrimaryButton variant="ghost" className="w-full" onClick={() => run(() => decideApplication(x.id, 'suplente'))}>{t('league.waitlist')}</PrimaryButton>}
          <button type="button" className="mx-auto block min-h-[40px] font-display text-sm font-extrabold text-[#DC2626] underline underline-offset-[3px]"
            onClick={() => setRejecting(x)}>{t('league.reject')}</button>
        </div>
      ))}

      {tab === 'rounds' && (
        <div className="space-y-3">
          {cat?.status === 'inscricoes' && (
            <div className="space-y-2 rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,.06)]">
              <label className="block text-sm font-bold">Primeira jornada começa
                <input type="date" value={firstStart} onChange={(e) => setFirstStart(e.target.value)} className="mt-1.5 min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3 text-base" />
              </label>
              <Chips label="Dias por jornada" value={days} onChange={setDays} options={[7, 14, 21].map((n) => ({ value: n, label: `${n} dias` }))} />
              <PrimaryButton variant="ink" className="w-full" disabled={approved.length < 2} onClick={makeSchedule}>{t('league.make_schedule')}</PrimaryButton>
            </div>
          )}
          {disputes.map((e) => (
            <button key={e.id} type="button" onClick={() => navigate(`/liga/${slug}/encontro/${e.id}`)}
              className="block w-full rounded-card bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(17,17,17,.06)]">
              <b>{page.teams.find((x) => x.id === e.home_team_id)?.name} vs {page.teams.find((x) => x.id === e.away_team_id)?.name}</b>
              <span className="mt-1 block font-display text-[13px] font-bold text-[#B13A10]">{t('league.enc_contestado')}</span>
            </button>
          ))}
          {cat?.status === 'a_decorrer' && (
            <PrimaryButton variant="ghost" className="w-full" onClick={() => run(() => finishCategory(catId))}>{t('league.finish_category')}</PrimaryButton>
          )}
        </div>
      )}

      {tab === 'team' && page.viewer.is_owner && (
        <div className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,.06)]">
          <PlayerSearch onSelect={(p) => run(() => addOrganizer(page.league.id, p.id))} />
        </div>
      )}

      <ConfirmSheet open={!!rejecting} danger title={rejecting ? t('league.reject_title', { name: rejecting.name }) : ''}
        message={t('league.reject_message')} confirmLabel={t('league.reject')} cancelLabel={t('league.not_yet')}
        onClose={() => setRejecting(null)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await decideApplication(rejecting.id, 'rejeitada', reason.trim() || null); setRejecting(null); setReason(''); await load() }}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="Motivo (opcional)"
          className="mt-3 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
      </ConfirmSheet>
    </div>
  )
}
```

> Antes de escrever: ver as props reais de `PlayerSearch` (`grep -n "export default function PlayerSearch" -A10 src/components/PlayerSearch.jsx`) e ajustar `onSelect` ao nome que lá estiver. A resolução de uma disputa (marcar o resultado final ou a falta de comparência) é feita na página do encontro: acrescentar lá, só quando `viewer.can_manage` e o estado é `contestado`/`submetido`/`oficial`, um botão preto «Decidir o resultado» que abre o mesmo `LeagueResultPage` com `?resolver=1` e, no envio, chama `resolveEncounter(id, draftToMatches(draft), null, nota)` com uma nota obrigatória (`ConfirmSheet` com textarea), mais «Falta de comparência» (escolher o clube que faltou → `resolveEncounter(id, null, teamId, nota)`).

Rotas em `src/App.jsx`:

```jsx
const CreateLeaguePage = lazyPage(() => import('./pages/CreateLeaguePage'))
const LeagueManagePage = lazyPage(() => import('./pages/LeagueManagePage'))
```
```jsx
        <Route path="/gerir/:slug/criar/liga" element={<Guard require="protected" showSplash={showSplash}><CreateLeaguePage /></Guard>} />
        <Route path="/liga/:slug/gerir" element={<Guard require="protected" showSplash={showSplash}><LeagueManagePage /></Guard>} />
```

- [ ] **Step 4: Verificar no browser o ciclo completo na dev**: criar comunitária → 2 clubes pedem → aprovar → fazer calendário → marcar data → enviar resultado → confirmar; outro encontro: contestar → decidir → a tabela muda; fechar a categoria.

- [ ] **Step 5: Tests + build + commit**

Run: `npx vitest run && npm run build` → PASS.

```bash
git add src/pages/CreateLeaguePage.jsx src/pages/LeagueManagePage.jsx src/pages/LeagueEncounterPage.jsx src/pages/LeagueResultPage.jsx src/components/gerir src/App.jsx src/locales/pt.json src/locales/en.json
git commit -m "Liga: criar por passos a partir do Gerir; gerir pedidos, calendário, disputas e organizadores"
```

---

### Task 16: A liga na Home e no sino

**Files:**
- Create: `src/lib/leagueAgenda.js`, `src/lib/leagueAgenda.test.js`, `src/components/league/LeagueEventCard.jsx`, `src/components/league/LeagueNoticeRow.jsx`
- Modify: `src/lib/agenda.js` (`EVENT_KINDS`, `KINDS_BEFORE_FREE`), `src/pages/Home.jsx`, `src/components/home/ForYouLine.jsx` (`forYouItems`), `src/components/Layout.jsx` (avisos), `src/lib/agenda.test.js` se testar `EVENT_KINDS`

**Interfaces:**
- Consumes: `myLeagueAgenda()` (Task 11); `HomeCard`, `BandPill`, `CardTitle`, `CardChips`, `CardState`, `CardFoot`, `CardButton`, `kindColorsOf` (de `src/components/agenda/HomeCard.jsx`); `toDayKey`.
- Produces: `eventFromLeagueEncounter(row) → event` com `{ key: 'league:<id>', source: 'league_encounter', kind: 'league', id, slug, startsAt, hasTime, dayKey, mine: true, needsMyAnswer, raw }` (sem data → `dayKey` = `window_end`, `hasTime: false`); `leagueForYouItems(agenda, t) → items` no formato de `forYouItems`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/leagueAgenda.test.js
import { describe, it, expect } from 'vitest'
import { eventFromLeagueEncounter, leagueForYouItems } from './leagueAgenda'

const row = {
  id: 'e1', league_slug: 'liga-porto', league_name: 'Liga Alinho Porto', league_kind: 'alinho',
  category_gender: 'masculino', category_level: 4, round_number: 4, window_end: '2026-11-16',
  home_name: 'Serra Azul Padel', away_name: 'Maré Alta Padel', my_side: 'away',
  scheduled_at: '2026-11-08T17:00:00Z', venue: 'Campo 3', status: 'marcado', needs_my_answer: false,
}

describe('liga na Home', () => {
  it('um encontro marcado fica no dia dele, com hora', () => {
    const e = eventFromLeagueEncounter(row)
    expect(e).toMatchObject({ key: 'league:e1', kind: 'league', slug: 'liga-porto', hasTime: true, mine: true })
    expect(e.dayKey).toBe('2026-11-08')
  })
  it('sem data fica no último dia da jornada, sem hora', () => {
    const e = eventFromLeagueEncounter({ ...row, scheduled_at: null, status: 'por_marcar' })
    expect(e).toMatchObject({ dayKey: '2026-11-16', hasTime: false })
  })
  it('«Para ti»: confirmar resultados e ligas abertas para os meus clubes', () => {
    const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`
    const items = leagueForYouItems({
      encounters: [{ ...row, status: 'submetido', needs_my_answer: true }],
      open_leagues: [{ slug: 'liga-lx', name: 'Liga Alinho Lisboa', my_club_name: 'Maré Alta Padel' }],
    }, t)
    expect(items.map((i) => i.key)).toEqual(['league-confirm:e1', 'league-open:liga-lx'])
    expect(items[0].to).toBe('/liga/liga-porto/encontro/e1')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/leagueAgenda.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// src/lib/leagueAgenda.js
// A liga na Home (Renato, 16 out: sem separador próprio — aparece entre os
// jogos). Cada encontro em que estou escalado ou falo pela equipa é um cartão
// no seu dia; sem data, fica no último dia da jornada. «Para ti» junta os
// resultados por confirmar e as ligas abertas para os clubes que administro.
import { toDayKey } from './agenda'
import { myLeagueAgenda } from './leagueApi'
import { KIND_COLORS } from './kindColors'

export function eventFromLeagueEncounter(row) {
  const startsAt = row.scheduled_at ? new Date(row.scheduled_at) : new Date(`${row.window_end}T12:00:00`)
  return {
    key: `league:${row.id}`,
    source: 'league_encounter',
    kind: 'league',
    id: row.id,
    slug: row.league_slug,
    startsAt,
    hasTime: !!row.scheduled_at,
    dayKey: row.scheduled_at ? toDayKey(startsAt) : row.window_end,
    mine: true,
    needsMyAnswer: !!row.needs_my_answer,
    finished: row.status === 'oficial',
    raw: row,
  }
}

export function leagueForYouItems(agenda, t) {
  const items = []
  for (const e of agenda?.encounters || []) {
    if (!e.needs_my_answer) continue
    items.push({
      key: `league-confirm:${e.id}`, icon: '✓', bg: KIND_COLORS.league.light,
      title: t('league.foryou_confirm', { when: e.scheduled_at ? new Date(e.scheduled_at).toLocaleDateString('pt-PT', { weekday: 'long' }) : '' }),
      sub: `${e.home_name} vs ${e.away_name} · ${e.league_name}`,
      to: `/liga/${e.league_slug}/encontro/${e.id}`, cta: t('league.confirm_result'),
    })
  }
  for (const l of agenda?.open_leagues || []) {
    items.push({
      key: `league-open:${l.slug}`, icon: '🏆', bg: KIND_COLORS.league.light,
      title: t('league.foryou_open', { name: l.name }), sub: l.my_club_name,
      to: `/liga/${l.slug}`, cta: t('league.apply'),
    })
  }
  return items
}

/** Para a Home: os eventos e os «Para ti» da liga. Sem as migrações, vazio. */
export async function loadLeagueHome() {
  try {
    const agenda = await myLeagueAgenda()
    return { events: (agenda?.encounters || []).map(eventFromLeagueEncounter), agenda }
  } catch (error) {
    if (error?.code !== 'PGRST202' && error?.code !== '42883') console.error('Error loading league agenda:', error)
    return { events: [], agenda: null }
  }
}
```

```jsx
// src/components/league/LeagueEventCard.jsx
// Um encontro da liga na Home (mockup «Home — a liga entre os jogos»): a
// moldura comum (HomeCard) na cor da liga, «✓ Estás escalado» na faixa, a hora
// grande, e «Ver» em contorno (já estás dentro).
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, CardButton, kindColorsOf } from '../agenda/HomeCard'
import { categoryCode } from '../../lib/tournaments'

export default function LeagueEventCard({ event, past }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const r = event.raw
  const to = `/liga/${r.league_slug}/encontro/${r.id}`
  const time = event.hasTime
    ? new Date(r.scheduled_at).toLocaleTimeString(i18n.language === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' })
    : t('league.enc_por_marcar')
  return (
    <HomeCard colors={kindColorsOf('league')} mine={!past} past={past} to={to} ariaLabel={`${r.home_name} vs ${r.away_name}`}
      label={`${t('agenda.kind_league')} · ${categoryCode(r.category_gender, r.category_level)} · ${t('league.round', { n: r.round_number })}`}
      pill={!past ? <BandPill>{t('league.you_play')}</BandPill> : null}
      time={time} timeAside={r.my_side === 'home' ? t('league.at_home') : t('league.away')}>
      <p className="text-[13px] text-ink-700">{r.league_name}</p>
      <CardTitle past={past}>{r.home_name} vs {r.away_name}</CardTitle>
      {r.venue && <CardChips>{r.venue}</CardChips>}
      {event.needsMyAnswer
        ? <CardState tone="warn">{t('league.enc_submetido')}</CardState>
        : <CardState tone={r.status === 'oficial' ? 'inv' : 'ok'}>{t(`league.enc_${r.status}`)}</CardState>}
      <CardFoot>
        <CardButton variant="outline" onClick={() => navigate(to)}>{t('ui.view', 'Ver')}</CardButton>
      </CardFoot>
    </HomeCard>
  )
}
```

```jsx
// src/components/league/LeagueNoticeRow.jsx
// Um aviso da liga no sino. A frase vem de notif.<kind>; tocar abre a liga
// ou o encontro.
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export const LEAGUE_NOTICE_KINDS = [
  'league_application_received', 'league_application_decided', 'league_schedule_published', 'league_time_proposed',
  'league_time_accepted', 'league_result_to_confirm', 'league_result_confirmed', 'league_result_contested',
  'league_result_resolved', 'league_deadline_soon', 'league_roster_added', 'league_organizer_added',
  'league_finished', 'league_cancelled',
]

export default function LeagueNoticeRow({ notice, onOpen }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const d = notice.data || {}
  const key = notice.kind === 'league_application_decided' ? `notif.league_application_decided_${d.decision}` : `notif.${notice.kind}`
  const to = d.encounter_id ? `/liga/${d.league_slug}/encontro/${d.encounter_id}` : d.league_slug ? `/liga/${d.league_slug}` : null
  return (
    <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left"
      onClick={() => { onOpen?.(notice); if (to) navigate(to) }}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#BE185D]" />
      <span className="text-sm font-semibold text-ink-900">{t(key, { league: d.league_name || '', club: d.club_name || '' })}</span>
    </button>
  )
}
```

Alterações em ficheiros existentes (ler cada um antes de editar e seguir o padrão do torneio que está ao lado):
- `src/lib/agenda.js`: `export const EVENT_KINDS = ['mix', 'open', 'free', 'friends', 'lesson', 'tournament', 'league']` e `KINDS_BEFORE_FREE` com `'league'` no fim.
- `src/pages/Home.jsx`: onde se chama `loadTournamentEvents(...)`, chamar também `loadLeagueHome()` e juntar `events` aos do torneio; guardar `agenda` num estado; no render (ao lado de `if (event.kind === 'tournament')`) `if (event.kind === 'league') return <LeagueEventCard key={event.key} event={event} past={past} />`; no link do evento (`eventLink`), `e.kind === 'league' ? \`/liga/${e.slug}/encontro/${e.id}\``; os itens «Para ti»: `[...forYouItems(...), ...leagueForYouItems(leagueAgenda, t)]`.
- `src/components/Layout.jsx`: como `setFriendNotices(data.filter((n) => FRIEND_NOTICE_KINDS.includes(n.kind)))`, juntar `setLeagueNotices(data.filter((n) => LEAGUE_NOTICE_KINDS.includes(n.kind)))` e desenhar `LeagueNoticeRow` na lista do sino, marcando como lido com `markNotificationsRead([n.id])` no `onOpen`.

- [ ] **Step 4: Run tests** — `npx vitest run` → PASS (incluindo `agenda.test.js` e `separadores.test.js`).

- [ ] **Step 5: Verificar no browser**: com um encontro marcado, a Home mostra o cartão rosa com «✓ Estás escalado» e borda lima; com um resultado por confirmar, «Para ti · 1» com «Confirmar» a preto; o filtro «Liga» mostra só cartões da liga; o sino mostra o aviso e abre o encontro.

- [ ] **Step 6: Build + commit**

Run: `npm run build` → sem erros.

```bash
git add src/lib/leagueAgenda.js src/lib/leagueAgenda.test.js src/components/league src/lib/agenda.js src/pages/Home.jsx src/components/home/ForYouLine.jsx src/components/Layout.jsx
git commit -m "Liga: encontros na Home, «Para ti» (confirmar e ligas abertas) e avisos no sino"
```

---

### Task 17: Documentação e revisão final

**Files:**
- Modify: `FEATURES.md`, `docs/superpowers/specs/2026-10-16-liga-entre-clubes-design.md` (só a secção «Estado»)

- [ ] **Step 1: FEATURES.md** — nova secção «Liga entre Clubes (Fase 1)» com o que existe de facto: tipos de liga, categorias, candidaturas, plantel de um clube por liga com nível congelado, calendário por jornadas (casa e fora), marcação, resultado com confirmação cruzada/contestação/decisão, tabela com desempates, ranking/player_stats/XP, Home/«Para ti»/sino, lembrete de prazo. E em «Explicitly not built»: playoffs, desafios, torneio interclubes, WhatsApp da liga, duas equipas do mesmo clube na mesma categoria.

- [ ] **Step 2: Spec — secção de estado** (acrescentar no fim; não reescrever as decisões):

```markdown
## Estado (atualizar ao implementar)

- Fase 1 implementada no branch `feature/liga-entre-clubes`. Migrações `migration_liga_1` a `6` — **correr na alinho-dev; em produção só quando a Fase 1 for para `main`, por esta ordem.**
- Desvios ao desenho acima, decididos no plano (2026-10-16-liga-entre-clubes-fase1.md): a tabela calcula-se em JS a partir só dos encontros oficiais devolvidos pelo servidor (não há função SQL `league_standings`); o calendário calcula-se em JS e o servidor valida-o; nível por `level` + `rating_tolerance` (em vez de `min_rating`/`max_rating`); XP com coluna `source_league_match_id` (sem generalizar `xp_events`).
```

- [ ] **Step 3: Revisão de segurança** — correr `superpowers:requesting-code-review` (ou o agente `security-reviewer`) sobre o branch com foco nos 5 pontos de «Review Focus» e em: nenhuma tabela `league_*` com `INSERT/UPDATE/DELETE` para `authenticated`; todas as RPCs com `SET search_path = public`; `get_league_page`/`get_league_encounter` sem colunas sensíveis.

- [ ] **Step 4: Verificação final**

Run: `npx vitest run && npm run build`
Expected: todos os testes PASS (contar e citar o número), build sem erros. Os scripts `supabase/tests/liga_*.sql` com todas as linhas `OK` na alinho-dev (colar a saída que o Renato devolveu).

- [ ] **Step 5: Commit (sem push)**

```bash
git add FEATURES.md docs/superpowers/specs/2026-10-16-liga-entre-clubes-design.md
git commit -m "Liga: FEATURES.md e estado do spec da Fase 1"
```

Não fazer push. Dizer ao Renato: branch, número de commits, migrações por correr em produção (1 a 6, por ordem) e que `main`/`dev` não foram tocados.
