# Sorteio sem repetição forçada (janela de 4 mixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O sorteio de duplas deixa de aceitar em silêncio que dois jogadores repitam parceria — passa a olhar para os últimos 4 mixes do clube, tenta ativamente (com backtracking) encontrar uma atribuição sem repetições, e só aceita uma repetição depois de provar que é impossível evitá-la, avisando o admin antes de criar as equipas.

**Architecture:** `formDuplas` (`src/lib/mixLogic.js`) passa a fazer uma busca exaustiva com backtracking sobre os jogadores solo antes de cair no greedy antigo como último recurso; devolve também quais pares ficaram forçados a repetir. `GameDetails.jsx` alarga a janela de histórico de 1 para 4 mixes e mostra um `confirm()` (mesmo padrão já usado para ações destrutivas neste ficheiro) quando há repetições forçadas.

**Tech Stack:** React + JS puro (`mixLogic.js` não tem I/O), Vitest para os testes unitários, i18next (`pt.json`/`en.json`) para as strings do diálogo.

**Spec:** `docs/superpowers/specs/2026-09-15-fair-pairing-and-dominance-cap-design.md`

## Global Constraints

- Janela de repetição = últimos 4 mixes do clube, contados (não por data/mês).
- A busca sem repetições é sempre tentada primeiro; só se aceita uma repetição quando se prova (por exaustão) que não há nenhuma atribuição válida sem repetições para o grupo desse mix.
- Quando há repetição forçada, o admin vê um aviso explícito com os nomes antes das equipas serem criadas, e tem de confirmar para avançar — nunca acontece silenciosamente.
- `formDuplas` é usado por dois ecrãs (`GameDetails.jsx` e `MixOffline.jsx`) — a mudança de forma do valor devolvido tem de atualizar os dois.

---

### Task 1: `formDuplas` com backtracking e sinalização de repetições forçadas

**Files:**
- Modify: `src/lib/mixLogic.js:78-117` (a função `formDuplas` e o comentário de cabeçalho do ficheiro que a descreve, linhas 5-13)
- Test: `src/lib/mixLogic.test.js` (adicionar `formDuplas` aos imports e um novo bloco `describe('formDuplas', ...)` no fim do ficheiro)

**Interfaces:**
- Produces: `formDuplas(participants, pointsById = {}, repeatPairKeys = new Set())` passa a devolver `{ duplas: [{ player1, player2, seed }], forcedRepeats: [{ player1, player2 }] }` em vez do array `duplas` diretamente. `forcedRepeats` vem vazio (`[]`) sempre que existiu (ou não era preciso) uma atribuição sem repetições. Este novo formato é consumido pela Task 2 (`GameDetails.jsx`) e pela Task 3 (`MixOffline.jsx`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar `formDuplas` à lista de imports no topo de `src/lib/mixLogic.test.js`:

```js
import {
  splitIntoPools, seedKnockoutFromPools,
  poolRoundNumbers, poolRoundsPlayed, roundRobinRound,
  generateAmericanoSchedule, americanoStandings,
  computeMixWinnerTeamId, formDuplas,
} from './mixLogic'
```

No fim do ficheiro, depois do último `})` do `describe('computeMixWinnerTeamId', ...)`, acrescentar:

```js
describe('formDuplas', () => {
  // Helper: jogador solo confirmado, com pontos e side opcional.
  const withPoints = (id, pts, side = 'both') => ({
    status: 'confirmed',
    user: { id, name: id, preferred_side: side, _points: pts },
  })
  const pointsById = (rows) => Object.fromEntries(rows.map((r) => [r.user.id, r.user._points]))
  const pairKey = (a, b) => [a, b].sort().join('|')

  it('sem histórico de repetição, pareia por pontos mais próximos (comportamento existente)', () => {
    const rows = [withPoints('a', 100), withPoints('b', 90), withPoints('c', 80), withPoints('d', 70)]
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), new Set())
    expect(duplas.map((d) => [d.player1.id, d.player2.id])).toEqual([['a', 'b'], ['c', 'd']])
    expect(forcedRepeats).toEqual([])
  })

  it('evita uma repetição simples saltando para o próximo candidato em pontos', () => {
    const rows = [withPoints('a', 100), withPoints('b', 90), withPoints('c', 80), withPoints('d', 70)]
    const repeatPairKeys = new Set([pairKey('a', 'b')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(duplas.map((d) => [d.player1.id, d.player2.id]).map((p) => p.sort())).toContainEqual(['a', 'c'])
    expect(forcedRepeats).toEqual([])
  })

  it('usa backtracking quando a escolha mais óbvia levaria a uma repetição evitável mais à frente', () => {
    // Pontos desc: a=100 b=99 c=98 d=97 e=96 f=95.
    // Proibidos: a-b, c-d, e-f (repetiram no mix anterior) e a-c (repetiram há 2 mixes).
    // O greedy antigo (mais próximo em pontos, sem olhar para a frente) dava:
    // a-d (b e c já eram proibidos para a), depois b-c (mais próximo dos que sobram),
    // o que obriga e-f no fim — uma repetição evitável.
    // Uma solução sem NENHUMA repetição existe: a-d, b-e, c-f.
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => withPoints(id, 100 - i))
    const repeatPairKeys = new Set([pairKey('a', 'b'), pairKey('c', 'd'), pairKey('e', 'f'), pairKey('a', 'c')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(forcedRepeats).toEqual([])
    for (const d of duplas) {
      expect(repeatPairKeys.has(pairKey(d.player1.id, d.player2.id))).toBe(false)
    }
  })

  it('quando é matematicamente impossível evitar, forma as duplas mesmo assim e sinaliza a repetição', () => {
    // Só há 2 solos e já jogaram juntos — não há alternativa nenhuma.
    const rows = [withPoints('a', 100), withPoints('b', 90)]
    const repeatPairKeys = new Set([pairKey('a', 'b')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(duplas).toHaveLength(1)
    expect(duplas[0].player1.id).toBe('a')
    expect(duplas[0].player2.id).toBe('b')
    expect(forcedRepeats).toHaveLength(1)
    expect([forcedRepeats[0].player1.id, forcedRepeats[0].player2.id].sort()).toEqual(['a', 'b'])
  })

  it('duplas já formadas (com parceiro fixo) continuam a passar direto, sem entrar na busca', () => {
    const fixedPartner = {
      status: 'confirmed',
      user: { id: 'x', name: 'x' },
      partner_id: 'y',
      partner: { id: 'y', name: 'y' },
    }
    const solos = [withPoints('a', 100), withPoints('b', 90)]
    const { duplas, forcedRepeats } = formDuplas([fixedPartner, ...solos], pointsById(solos), new Set())
    expect(duplas).toHaveLength(2)
    expect(duplas.some((d) => d.player1.id === 'x' && d.player2.id === 'y')).toBe(true)
    expect(forcedRepeats).toEqual([])
  })
})
```

- [ ] **Step 2: Correr os testes e confirmar que falham**

Run: `npx vitest run src/lib/mixLogic.test.js -t formDuplas`
Expected: FAIL — `formDuplas` ainda devolve o array diretamente, `duplas` fica `undefined` na desestruturação (`duplas.map` rebenta) ou os testes de backtracking falham porque o greedy atual força a repetição em `e-f`.

- [ ] **Step 3: Implementar a busca com backtracking e o formato de retorno novo**

Substituir a função `formDuplas` completa em `src/lib/mixLogic.js` (linhas 78-117) por:

```js
/**
 * Perfect-matching search over solos: tries to pair everyone without
 * repeating a past partnership. At each step, tries candidates for the
 * current player closest-points-first, side-compatible first then any
 * side, and recurses; a candidate is only accepted once the rest of the
 * list is proven completable without any repeat (recursive call returns
 * non-null). Returns null when no fully repeat-free assignment exists for
 * this list — the only signal formDuplas needs to fall back to the old
 * greedy below.
 */
function matchWithoutRepeats(remaining, repeatPairKeys, sidesCompatible) {
  if (remaining.length <= 1) return []
  const [a, ...rest] = remaining
  const pairKey = (x, y) => [x?.id, y?.id].sort().join('|')
  const tiers = [
    (b) => !repeatPairKeys.has(pairKey(a, b)) && sidesCompatible(a, b),
    (b) => !repeatPairKeys.has(pairKey(a, b)),
  ]
  for (const passes of tiers) {
    for (let i = 0; i < rest.length; i++) {
      if (!passes(rest[i])) continue
      const b = rest[i]
      const others = [...rest.slice(0, i), ...rest.slice(i + 1)]
      const completion = matchWithoutRepeats(others, repeatPairKeys, sidesCompatible)
      if (completion) return [[a, b], ...completion]
    }
  }
  return null
}

/**
 * Form duplas from confirmed participant rows.
 * Rows with partner keep their dupla; solos are sorted by global club points
 * (pointsById) and matchWithoutRepeats above tries to pair everyone without
 * ever repeating a partnership in repeatPairKeys — closest points first,
 * side preference as a soft secondary order, backtracking whenever a choice
 * would dead-end the rest of the list.
 * Only when a fully repeat-free assignment is proven impossible for this
 * group does it fall back to the old closest-points greedy (side
 * preference relaxed first, repeat-avoidance last), recording exactly which
 * pairs were forced to repeat so the caller can warn before locking teams
 * in — see the file-header note.
 * Returns { duplas: [{ player1, player2, seed }], forcedRepeats: [{ player1, player2 }] }.
 */
export function formDuplas(participants, pointsById = {}, repeatPairKeys = new Set()) {
  const duplas = []
  const solos = []

  for (const row of participants.filter(p => p.status === 'confirmed')) {
    if (row.partner_id && row.partner) duplas.push([row.user, row.partner])
    else if (row.user) solos.push(row.user)
  }

  const pointsOf = u => pointsById[u?.id] ?? 0
  solos.sort((a, b) => pointsOf(b) - pointsOf(a))

  const pairKey = (a, b) => [a?.id, b?.id].sort().join('|')
  const sideOf = u => (u?.preferred_side === 'left' || u?.preferred_side === 'right') ? u.preferred_side : 'both'
  const sidesCompatible = (a, b) => sideOf(a) === 'both' || sideOf(b) === 'both' || sideOf(a) !== sideOf(b)

  const forcedRepeats = []
  let soloPairs = matchWithoutRepeats(solos, repeatPairKeys, sidesCompatible)

  if (!soloPairs) {
    soloPairs = []
    const remaining = [...solos]
    while (remaining.length >= 2) {
      const a = remaining.shift()
      let idx = remaining.findIndex(candidate => !repeatPairKeys.has(pairKey(a, candidate)) && sidesCompatible(a, candidate))
      if (idx === -1) idx = remaining.findIndex(candidate => !repeatPairKeys.has(pairKey(a, candidate)))
      if (idx === -1) idx = 0
      const b = remaining.splice(idx, 1)[0]
      if (repeatPairKeys.has(pairKey(a, b))) forcedRepeats.push([a, b])
      soloPairs.push([a, b])
    }
  }

  for (const pair of soloPairs) duplas.push(pair)

  return {
    duplas: duplas.map(([p1, p2]) => ({
      player1: p1,
      player2: p2,
      seed: pointsOf(p1) + pointsOf(p2),
    })),
    forcedRepeats: forcedRepeats.map(([p1, p2]) => ({ player1: p1, player2: p2 })),
  }
}
```

Atualizar também o comentário de cabeçalho do ficheiro (linhas 5-13 de `src/lib/mixLogic.js`) para descrever o novo comportamento:

```js
   - Solo pairing (Trello #162, revisto 2026-09-15 — repeat-avoidance passa
     a ser uma busca com backtracking, não um greedy simples):
     every solo is sorted by global club points (pointsById). A full
     repeat-free matching is searched first (matchWithoutRepeats) — closest
     points first, side preference as a soft secondary order — and only
     when no such matching exists at all does formDuplas fall back to the
     old closest-points greedy, which now records which pairs it was
     forced to repeat (forcedRepeats) instead of doing so silently.
```

- [ ] **Step 4: Correr os testes e confirmar que passam**

Run: `npx vitest run src/lib/mixLogic.test.js -t formDuplas`
Expected: PASS (5 testes)

- [ ] **Step 5: Correr a suite toda para confirmar que nada mais quebrou**

Run: `npx vitest run src/lib/mixLogic.test.js`
Expected: PASS em todos os testes (o ficheiro só falha por causa dos dois consumidores de `formDuplas` fora deste ficheiro — tratados nas Tasks 2 e 3 a seguir; este ficheiro de teste, por si só, deve ficar verde)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mixLogic.js src/lib/mixLogic.test.js
git commit -m "feat: formDuplas tenta backtracking antes de aceitar repetição de par"
```

---

### Task 2: `GameDetails.jsx` — janela de 4 mixes + confirmação quando a repetição é inevitável

**Files:**
- Modify: `src/pages/GameDetails.jsx:830-853`
- Modify: `src/locales/pt.json:403` (inserir logo a seguir)
- Modify: `src/locales/en.json:403` (inserir logo a seguir, mesma posição para os dois ficheiros ficarem alinhados)

**Interfaces:**
- Consumes: `formDuplas(participants, pointsById, repeatPairKeys)` → `{ duplas, forcedRepeats }` (Task 1). `firstLastName` já importado de `../lib/statsLogic` neste ficheiro (linha 22) — reutilizado para os nomes no diálogo.
- Produces: nenhuma interface nova para fora deste ficheiro.

- [ ] **Step 1: Adicionar a string de confirmação aos dois ficheiros de tradução**

Em `src/locales/pt.json`, substituir:

```json
  "gamedetails.confirm_stop_mix_no_results": "Isto apaga as duplas formadas, para poderes recomeçar. Tens a certeza?",
```

por (a mesma linha, mais a nova chave a seguir):

```json
  "gamedetails.confirm_stop_mix_no_results": "Isto apaga as duplas formadas, para poderes recomeçar. Tens a certeza?",
  "gamedetails.confirm_repeat_pairing": "Sem alternativa possível, estas duplas repetem parceria de um dos últimos 4 mixes: {{pairs}}. Continuar mesmo assim?",
```

Em `src/locales/en.json`, substituir:

```json
  "gamedetails.confirm_stop_mix_no_results": "This deletes the formed duplas, so you can start over. Are you sure?",
```

por:

```json
  "gamedetails.confirm_stop_mix_no_results": "This deletes the formed duplas, so you can start over. Are you sure?",
  "gamedetails.confirm_repeat_pairing": "No alternative was possible — these pairs repeat a partnership from one of the last 4 mixes: {{pairs}}. Continue anyway?",
```

- [ ] **Step 2: Alargar a janela de histórico e ligar a confirmação**

Substituir em `src/pages/GameDetails.jsx` o bloco das linhas 830-853:

```js
      // Duplas from the most recent previous mix at this club — solos
      // whose points-based pairing would recreate one of these get
      // reshuffled with the next-closest points instead (see formDuplas).
      const { data: previousGames } = await supabase
        .from('games')
        .select('id')
        .eq('organization_id', gameOrganizationId)
        .lt('date', game.date)
        .order('date', { ascending: false })
        .limit(1)
      let repeatPairKeys = new Set()
      if (previousGames?.[0]) {
        const { data: previousTeams } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('game_id', previousGames[0].id)
        repeatPairKeys = new Set(
          (previousTeams || []).map(team => [team.player1_id, team.player2_id].sort().join('|'))
        )
      }

      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
      if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))
```

por:

```js
      // Duplas dos últimos 4 mixes deste clube — solos cujo pareamento por
      // pontos recriaria um destes pares são reshuffled com o próximo mais
      // próximo em pontos em vez disso; só se aceita a repetição quando
      // for matematicamente impossível evitá-la (ver formDuplas).
      const { data: previousGames } = await supabase
        .from('games')
        .select('id')
        .eq('organization_id', gameOrganizationId)
        .lt('date', game.date)
        .order('date', { ascending: false })
        .limit(4)
      let repeatPairKeys = new Set()
      if (previousGames?.length) {
        const { data: previousTeams } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .in('game_id', previousGames.map(g => g.id))
        repeatPairKeys = new Set(
          (previousTeams || []).map(team => [team.player1_id, team.player2_id].sort().join('|'))
        )
      }

      // 4.1 formação de duplas
      const { duplas, forcedRepeats } = formDuplas(participants, pointsById, repeatPairKeys)
      if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))
      if (forcedRepeats.length > 0) {
        const pairsList = forcedRepeats
          .map(({ player1, player2 }) => `${firstLastName(player1?.name)} + ${firstLastName(player2?.name)}`)
          .join(', ')
        if (!confirm(t('gamedetails.confirm_repeat_pairing', { pairs: pairsList }))) {
          setBusy(false)
          return
        }
      }
```

- [ ] **Step 3: Verificação manual (não há harness de testes de integração para este ficheiro — `GameDetails.jsx` não tem testes automatizados hoje)**

Correr `npm run dev`, abrir um mix de teste com pelo menos 6 jogadores solo confirmados num clube com histórico de pelo menos 2 mixes anteriores já com resultados, e confirmar:
1. Clube com histórico normal (sem repetições forçadas): "Começar Mix" continua a funcionar sem qualquer diálogo, como hoje.
2. Forçar uma repetição (ex.: um clube de teste com poucos jogadores ativos, ou reduzir manualmente o grupo confirmado a 2 solos que já jogaram juntos num dos últimos 4 mixes): ao clicar "Começar Mix" aparece o `confirm()` com os nomes corretos; cancelar não cria equipas nem muda o estado do jogo; confirmar cria as equipas normalmente.

- [ ] **Step 4: Commit**

```bash
git add src/pages/GameDetails.jsx src/locales/pt.json src/locales/en.json
git commit -m "feat: janela de repetição de pares passa de 1 para 4 mixes, com aviso quando é inevitável"
```

---

### Task 3: `MixOffline.jsx` — adaptar ao novo formato de retorno de `formDuplas`

**Files:**
- Modify: `src/pages/MixOffline.jsx:102`

**Interfaces:**
- Consumes: `formDuplas(...)` → `{ duplas, forcedRepeats }` (Task 1). Este ecrã não tem histórico de mixes (`repeatPairKeys` é sempre `new Set()`), por isso `forcedRepeats` vem sempre vazio e não precisa de ser usado aqui.

- [ ] **Step 1: Atualizar a chamada**

Substituir em `src/pages/MixOffline.jsx`:

```js
    const duplas = formDuplas(participants, pointsById, new Set())
```

por:

```js
    const { duplas } = formDuplas(participants, pointsById, new Set())
```

- [ ] **Step 2: Verificação manual**

Correr `npm run dev`, abrir o ecrã de Mix Offline, introduzir pelo menos 8 nomes e confirmar que "Formar Equipas" continua a funcionar exatamente como antes (sem alterações de comportamento visível — esta task só ajusta a forma como o valor devolvido é lido).

- [ ] **Step 3: Commit**

```bash
git add src/pages/MixOffline.jsx
git commit -m "fix: MixOffline lê o novo formato { duplas } devolvido por formDuplas"
```
