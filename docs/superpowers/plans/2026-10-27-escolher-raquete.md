# Escolhe a tua raquete — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um questionário de 11 ecrãs no Perfil que, com a IA (Gemini Flash grátis), recomenda 3 raquetes reais da Street Padel, com foto, preço de hoje e link, e guarda o resultado.

**Architecture:** Uma Edge Function `sync-raquetes` (diária, pg_cron) copia as raquetes do catálogo Shopify da Street Padel para a tabela `rackets`. A Edge Function `recomendar-raquete` filtra no código (stock, orçamento), manda uma lista curta ao Gemini, valida os ids devolvidos e guarda em `racket_picks`. A lógica pura (parse do catálogo, specs, lista curta, prompt, validação) vive num módulo partilhado em JS simples, testado com vitest e importado pelas duas funções Deno.

**Tech Stack:** Supabase (Postgres, RLS, pg_cron, pg_net, Edge Functions em Deno), Gemini API (REST `generateContent`, JSON estruturado), React + React Router + Tailwind + react-i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-escolher-raquete-design.md` (mockups: `.superpowers/brainstorm/1067-1793113249/content/raquete-ecras-v2.html`).

## Global Constraints

- A IA só escolhe ids da lista curta que recebeu; o servidor rejeita qualquer outro. Nada inventado: spec que a descrição não diz = «não indicado».
- Só raquetes disponíveis e com preço ≤ orçamento chegam à IA. A marca não filtra, é só preferência.
- Ao Gemini nunca vão nome, email nem id do jogador.
- Limite: 3 recomendações por jogador por dia de Lisboa (`Europe/Lisbon`), contadas antes de chamar a IA.
- Preço, foto, stock e link mostrados vêm sempre da `rackets` de hoje, nunca do resultado guardado.
- Loja num sítio só: `STORE` em `supabase/functions/_shared/raquetes.js` (`name: 'Street Padel'`, `base: 'https://www.streetpadel.com'`).
- Fora do catálogo: produtos com `product_type !== 'Palas'`, e títulos com `pack`, `tripack`, `duo` ou `pickleball` (sem maiúsculas/minúsculas).
- `DESIGN.md`: fundo `ground`, cartões brancos sem borda, Outfit nos títulos e preços, rótulos Geist Mono, um só botão lima por ecrã, botões a toda a largura, 48px.
- Rodapé do resultado, tal e qual: «Sugestões feitas por IA a partir do catálogo da Street Padel. Preços e stock de hoje.»
- Instrução do Renato no prompt: dar prioridade à adequação ao jogador, ao conforto e ao desempenho, não à popularidade da marca nem só ao preço. Não recomendar automaticamente uma raquete avançada ou cara só porque tem melhores specs técnicas.
- pt/en/es: toda a frase nova vai aos 3 ficheiros em `src/locales/` (chaves planas `raquete.*`).
- A migração e as funções não ficam ativas por estarem no repo: correr/publicar à mão no dev e depois em produção. Commits sem linha de atribuição ao Claude.

## Review Focus

1. **Orçamento «< 80 €» com nada em stock** → a função devolve `{ error: 'no_candidates' }` e o ecrã diz para subir o orçamento (teste na Task 4 e na Task 1, `shortlist` vazia).
2. **O Gemini devolve um id repetido, inventado, ou JSON inválido** → uma nova tentativa; à segunda, `502 { error: 'ai_failed' }`, nada guardado (testes de `validatePicks` na Task 1).
3. **Dores: «Não» com «Cotovelo» ao mesmo tempo** → escolher «Não» limpa as outras e escolher outra limpa «Não» (teste de `toggleAnswer` na Task 5).
4. **Resultado guardado com uma raquete que esgotou ou saiu do catálogo** → cartão com «Esgotada» e sugestão de refazer, sem preço velho (teste de `mergePickWithCatalog` na Task 5).
5. **Quarta tentativa no mesmo dia, ou a quota do Gemini esgotada (HTTP 429)** → `429 { error: 'daily_limit' }` / `503 { error: 'ai_unavailable' }`, e o ecrã diz «Tenta daqui a pouco» sem perder as respostas (Task 4 e Task 6).

---

## Ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| `supabase/functions/_shared/raquetes.js` (novo) | Lógica pura: loja, parse do catálogo, specs, lista curta, prompt, esquema JSON, validação |
| `supabase/functions/_shared/raquetes.test.js` (novo) | vitest da lógica pura |
| `supabase/migration_escolher_raquete.sql` (novo) | Tabelas, RLS, contador diário, job do pg_cron |
| `supabase/tests/escolher_raquete.sql` (novo) | Teste das RLS (ROLLBACK) |
| `supabase/functions/sync-raquetes/index.ts` (novo) | Cópia diária do catálogo |
| `supabase/functions/recomendar-raquete/index.ts` (novo) | Recomendação |
| `src/lib/raquete.js` (novo) + `.test.js` | Perguntas, respostas, chamada à função, juntar resultado com o catálogo |
| `src/pages/RaqueteQuestionario.jsx` (novo) | Os 11 ecrãs |
| `src/pages/RaqueteResultado.jsx` (novo) | Resultado, ficha, refazer |
| `src/components/raquete/RaqueteCard.jsx` (novo) | Cartão compacto e cartão em destaque |
| `src/pages/Profile.jsx`, `src/App.jsx`, `src/locales/{pt,en,es}.json` | Entrada no perfil, rotas, textos |
| `docs/raquete.md` (novo), `FEATURES.md` | Runbook de deploy e o que está feito |

---

### Task 1: Lógica partilhada do catálogo e da recomendação

**Files:**
- Create: `supabase/functions/_shared/raquetes.js`
- Test: `supabase/functions/_shared/raquetes.test.js`

**Interfaces:**
- Produces (ESM, sem dependências, corre em Node e em Deno):
  - `STORE = { name: 'Street Padel', base: 'https://www.streetpadel.com' }`
  - `productLink(handle: string): string` → `${STORE.base}/products/${handle}`
  - `extractSpecs(text: string): { shape: 'redonda'|'lagrima'|'diamante'|null, balance: 'baixo'|'medio'|'alto'|null, weight: string|null, profile_mm: number|null, core: string|null, faces: string|null }`
  - `parseShopifyRacket(p: ShopifyProduct): RacketRow | null` com `RacketRow = { store_id: string, name, brand, handle, url, image_url, price: number, available: boolean, description: string, specs }`. `null` se não for raquete (Global Constraints). `price` = a variante disponível mais barata (ou a mais barata se nenhuma estiver). `description` = `body_html` sem tags, espaços colapsados, máx. 1200 caracteres.
  - `BUDGETS = { lt80: 80, '80_150': 150, '150_220': 220, '220_300': 300, '300plus': Infinity }`
  - `shortlist(rackets: RacketRow[], answers: Answers, max = 40): RacketRow[]` — só `available` e `price <= BUDGETS[answers.budget]`; ordena: primeiro as do formato pedido (`answers.shape`, exceto `'recomenda'`), depois as de marca preferida (`answers.brands` são as chaves `bullpadel|nox|head|adidas|babolat|outra|sem_preferencia`, comparadas com `brand` em minúsculas), depois por preço descendente (mais perto do teto); corta em `max`.
  - `RESPONSE_SCHEMA` — esquema JSON do Gemini: `{ best: string, picks: [{ id: string, why: string, pros: string[], cons: string[], hardness: string, sweet_spot: string }] }` com 3 picks.
  - `buildPrompt({ answers, profile, candidates, lang }): string` — `profile = { side, hand, levels: string[] }`; inclui a instrução do Renato (Global Constraints), «escolhe exatamente 3 ids desta lista», «responde em ${lang}», «hardness/sweet_spot: só o que a descrição diz, senão "não indicado"».
  - `validatePicks(json: unknown, allowedIds: string[]): { ok: true, best: string, picks: Pick[] } | { ok: false, reason: string }`

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect } from 'vitest'
import { parseShopifyRacket, extractSpecs, shortlist, validatePicks, productLink, buildPrompt } from './raquetes.js'

const product = (o = {}) => ({ id: 1, title: 'STARVIE SHADE', vendor: 'StarVie', handle: 'starvie-shade', product_type: 'Palas',
  body_html: '<p>Forma Redonda y balance bajo. Peso 355-370 gr. Perfil de 38 mm.</p>',
  images: [{ src: 'https://cdn.shopify.com/x.jpg' }], variants: [{ price: '124.95', available: true }], ...o })

describe('parseShopifyRacket', () => {
  it('raquete normal', () => {
    const r = parseShopifyRacket(product())
    expect(r).toMatchObject({ store_id: '1', brand: 'StarVie', price: 124.95, available: true, url: productLink('starvie-shade'), image_url: 'https://cdn.shopify.com/x.jpg' })
    expect(r.description).not.toMatch(/<p>/)
  })
  it.each(['PACK DUO BULLPADEL RAIDER', 'TRIPACK X', 'PICKLEBALL TECNIFIBRE TF SELECT'])('fora: %s', (title) => {
    expect(parseShopifyRacket(product({ title }))).toBeNull()
  })
  it('fora: não é pala', () => expect(parseShopifyRacket(product({ product_type: 'Zapatillas' }))).toBeNull())
  it('preço = variante disponível mais barata', () => {
    expect(parseShopifyRacket(product({ variants: [{ price: '99', available: false }, { price: '130', available: true }, { price: '120', available: true }] })).price).toBe(120)
  })
})

describe('extractSpecs', () => {
  it('lê formato, balanço, peso e perfil', () => {
    expect(extractSpecs('Forma Redonda y balance bajo. Peso 355-370 gr. Perfil de 38 mm.')).toMatchObject({ shape: 'redonda', balance: 'baixo', weight: '355-370 g', profile_mm: 38 })
  })
  it('lágrima e diamante; nada = null', () => {
    expect(extractSpecs('forma de lágrima').shape).toBe('lagrima')
    expect(extractSpecs('Diamante, balance alto').shape).toBe('diamante')
    expect(extractSpecs('sem nada')).toMatchObject({ shape: null, balance: null, weight: null, profile_mm: null })
  })
})

describe('shortlist', () => {
  const rows = [
    { store_id: 'a', price: 70, available: true, brand: 'Nox', specs: { shape: 'redonda' } },
    { store_id: 'b', price: 79, available: false, brand: 'Nox', specs: { shape: 'redonda' } },
    { store_id: 'c', price: 140, available: true, brand: 'Head', specs: { shape: 'diamante' } },
  ]
  it('orçamento e stock filtram', () => expect(shortlist(rows, { budget: 'lt80' }).map((r) => r.store_id)).toEqual(['a']))
  it('vazia quando nada cabe', () => expect(shortlist([rows[1]], { budget: 'lt80' })).toEqual([]))
  it('formato pedido primeiro', () => expect(shortlist(rows, { budget: '80_150', shape: 'diamante' })[0].store_id).toBe('c'))
})

describe('validatePicks', () => {
  const ok = { best: 'a', picks: ['a', 'b', 'c'].map((id) => ({ id, why: 'x', pros: [], cons: [], hardness: 'não indicado', sweet_spot: 'não indicado' })) }
  it('aceita 3 ids da lista', () => expect(validatePicks(ok, ['a', 'b', 'c', 'd']).ok).toBe(true))
  it('recusa id inventado', () => expect(validatePicks(ok, ['a', 'b']).ok).toBe(false))
  it('recusa repetidos', () => expect(validatePicks({ ...ok, picks: [ok.picks[0], ok.picks[0], ok.picks[1]] }, ['a', 'b', 'c']).ok).toBe(false))
  it('recusa best fora dos picks', () => expect(validatePicks({ ...ok, best: 'z' }, ['a', 'b', 'c', 'z']).ok).toBe(false))
  it('recusa lixo', () => expect(validatePicks('nada', ['a']).ok).toBe(false))
})

describe('buildPrompt', () => {
  it('nunca leva dados pessoais e leva a regra do Renato', () => {
    const p = buildPrompt({ answers: { budget: 'lt80' }, profile: { side: 'left', hand: 'right', levels: ['N3'] }, candidates: [], lang: 'pt' })
    expect(p).toMatch(/não recomend/i)
    expect(p).not.toMatch(/@|user_id/)
  })
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `npx vitest run supabase/functions/_shared/raquetes.test.js`
Expected: FAIL (`Failed to resolve import "./raquetes.js"`)

- [ ] **Step 3: Implementar `raquetes.js`** com as assinaturas acima. Specs por regex sobre o texto em espanhol da loja (`redond`, `l[aá]grima`, `diamante`; `balance (bajo|medio|intermedio|alto)` → `baixo|medio|medio|alto`; `(\d{3})\s*-\s*(\d{3})\s*g`; `perfil[^\d]{0,12}(\d{2})\s*mm`; núcleo e caras: a palavra a seguir a `n[uú]cleo` / `caras?` até à pontuação, ou `null`).

- [ ] **Step 4: Correr e ver passar**

Run: `npx vitest run supabase/functions/_shared/raquetes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/raquetes.js supabase/functions/_shared/raquetes.test.js
git commit -m "feat(raquete): lógica partilhada do catálogo, lista curta e validação da IA"
```

---

### Task 2: Migração e RLS

**Files:**
- Create: `supabase/migration_escolher_raquete.sql`
- Create: `supabase/tests/escolher_raquete.sql`

**Interfaces:**
- Produces:
  - `rackets(store_id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT, handle TEXT NOT NULL, url TEXT NOT NULL, image_url TEXT, price NUMERIC(8,2) NOT NULL, available BOOLEAN NOT NULL, description TEXT, specs JSONB NOT NULL DEFAULT '{}', synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`. RLS: `SELECT` para `authenticated`; nenhuma escrita fora do service role.
  - `racket_picks(user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, answers JSONB NOT NULL, lang TEXT NOT NULL, best_id TEXT NOT NULL, picks JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`. `picks` = o array validado de `validatePicks`. RLS: `SELECT` só `user_id = auth.uid()`; sem `INSERT/UPDATE/DELETE` para `authenticated`.
  - `racket_pick_runs(user_id UUID REFERENCES profiles(id) ON DELETE CASCADE, day DATE, count INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`. RLS ligada, sem regras (`REVOKE ALL` a `anon, authenticated`).
  - `take_racket_run(p_user UUID) RETURNS BOOLEAN` — `SECURITY DEFINER`, só `service_role` pode executar; dia = `(NOW() AT TIME ZONE 'Europe/Lisbon')::date`; incrementa e devolve `false` se já ia em 3.
  - Job pg_cron `sync-raquetes`, `'0 5 * * *'`, com `net.http_post` para `<SUPABASE_URL>/functions/v1/sync-raquetes` e cabeçalho `x-sync-secret`. URL e segredo são marcadores `<PREENCHER …>` no ficheiro (como no push); `CREATE EXTENSION IF NOT EXISTS pg_net;`.

- [ ] **Step 1: Escrever o teste SQL** `supabase/tests/escolher_raquete.sql` no estilo de `supabase/tests/relogio_mix_a.sql` (`BEGIN`, tabela `_r(ok, label)`, ids a preencher, `SET LOCAL role authenticated` + `request.jwt.claims`, `ROLLBACK`). Linhas que têm de dar `OK`:
  - jogador A lê a sua linha de `racket_picks`; jogador B não a vê (0 linhas);
  - A não consegue `INSERT`/`UPDATE` em `racket_picks` nem em `rackets` (erro 42501);
  - A lê `rackets`;
  - `take_racket_run` chamado como `authenticated` falha (42501); como superuser dá `true, true, true, false`.

- [ ] **Step 2: Escrever a migração** com o que está em Interfaces, idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `cron.schedule` com nome fixo), e um cabeçalho que diz: correr no dev, depois correr o teste, depois produção; preencher URL e segredo do projeto certo.

- [ ] **Step 3: Verificação** (não há Postgres local): reler a migração contra o teste linha a linha. A execução real é do Renato no SQL Editor do dev, e todas as linhas do teste têm de dar `OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_escolher_raquete.sql supabase/tests/escolher_raquete.sql
git commit -m "feat(raquete): migração (rackets, racket_picks, limite diário, cron) + teste das RLS"
```

---

### Task 3: Edge Function `sync-raquetes`

**Files:**
- Create: `supabase/functions/sync-raquetes/index.ts`

**Interfaces:**
- Consumes: `parseShopifyRacket`, `STORE` (Task 1); tabela `rackets` (Task 2).
- Produces: `POST /functions/v1/sync-raquetes`, cabeçalho `x-sync-secret` igual ao secret `SYNC_RAQUETES_SECRET` (senão `403 { error: 'forbidden' }`, como o `send-push`). Resposta `200 { total, rackets, available }`.

- [ ] **Step 1: Implementar.** Lê `${STORE.base}/products.json?limit=250&page=N` de N=1 até vir `products: []` (máx. 40 páginas, `User-Agent` normal), aplica `parseShopifyRacket`, faz `upsert` por `store_id` em lotes de 200 com `synced_at = now()`, e depois marca `available = false` em todas as linhas com `synced_at` anterior a este sync (não apaga). Se a primeira página falhar ou vier vazia, não marca nada como indisponível e devolve `502 { error: 'catalog_unavailable' }`. Cliente com service role, `createClient` de `jsr:@supabase/supabase-js@2.117.3` (versão igual à do `watch-session`); importa `../_shared/raquetes.js`. Comentário no topo com o propósito, os secrets e o comando de deploy, no estilo de `watch-session/index.ts`.

- [ ] **Step 2: Verificação manual (Renato, no dev):**
  `npx supabase functions deploy sync-raquetes --project-ref <dev>` e
  `curl -X POST -H "x-sync-secret: $S" https://<dev>.supabase.co/functions/v1/sync-raquetes`
  Expected: `200` com `rackets` perto de 600–700 e `available` perto de 260; `select count(*) from rackets where available` igual.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/sync-raquetes/index.ts
git commit -m "feat(raquete): Edge Function sync-raquetes (cópia diária do catálogo da Street Padel)"
```

---

### Task 4: Edge Function `recomendar-raquete`

**Files:**
- Create: `supabase/functions/recomendar-raquete/index.ts`

**Interfaces:**
- Consumes: `shortlist`, `buildPrompt`, `RESPONSE_SCHEMA`, `validatePicks` (Task 1); `rackets`, `racket_picks`, `take_racket_run` (Task 2).
- Produces: `POST /functions/v1/recomendar-raquete`, corpo `{ answers: Answers, lang: 'pt'|'en'|'es' }`, JWT do utilizador obrigatório.
  - `200 { best_id, picks }` (e grava em `racket_picks` com `upsert` por `user_id`)
  - `401 unauthorized` · `400 bad_answers` (falta `budget` ou outra resposta obrigatória) · `422 no_candidates` · `429 daily_limit` · `503 ai_unavailable` (Gemini 429/5xx/timeout) · `502 ai_failed` (duas respostas inválidas). Todos em `{ error }`.
- Secrets: `GEMINI_API_KEY`, `GEMINI_MODEL` (por omissão `gemini-2.5-flash`; o Renato põe o Flash mais recente do plano gratuito).

- [ ] **Step 1: Implementar.** Ordem: CORS/OPTIONS e só POST (como `watch-session`) → `getUser` com o JWT → validar `answers` → ler `profiles.preferred_side, dominant_hand` e `memberships.level` do utilizador (service role) → `rackets` disponíveis → `shortlist`; vazia → `422 no_candidates` **sem** gastar o limite → `take_racket_run`; `false` → `429` → chamar `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=…` com `generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.4 }` e timeout de 25 s → `validatePicks` com os ids da lista curta; inválido → repetir uma vez; inválido outra vez → `502` → `upsert` em `racket_picks` → `200`. Nunca registar as respostas nem o prompt em `console`; nos erros, só o código.

- [ ] **Step 2: Verificação manual (Renato, no dev, depois da Task 3):** com o JWT de uma conta de teste,
  `curl -X POST -H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"lang":"pt","answers":{"budget":"80_150","shape":"redonda","pain":["cotovelo"],"wants":"controlo"}}' https://<dev>.supabase.co/functions/v1/recomendar-raquete`
  Expected: `200` com 3 `picks` cujos `id` existem em `rackets` com `available` e `price <= 150`. Com `"budget":"lt80"` e o catálogo filtrado vazio (`update rackets set available=false where price<80` dentro de uma transação de teste) → `422 no_candidates`. A 4.ª chamada no dia → `429 daily_limit`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/recomendar-raquete/index.ts
git commit -m "feat(raquete): Edge Function recomendar-raquete (lista curta + Gemini + validação)"
```

---

### Task 5: Lógica da app (perguntas, respostas, resultado)

**Files:**
- Create: `src/lib/raquete.js`
- Test: `src/lib/raquete.test.js`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase.js`); a função e as tabelas das Tasks 2–4.
- Produces:
  - `QUESTIONS: Array<{ key: string, multi: boolean, optional: boolean, options: string[], exclusive?: string, text?: true }>` — as 11 da spec, nesta ordem e com estas chaves: `frequency`, `style`, `strengths` (multi), `struggle`, `pain` (multi, `exclusive: 'nao'`), `feel`, `center`, `wants`, `shape`, `budget` (opções = chaves de `BUDGETS`), `brands` (multi, optional, `text: true` para `current_racket`). Os rótulos vêm do i18n: `raquete.q_${key}` e `raquete.opt_${key}_${option}`.
  - `toggleAnswer(answers, question, option): Answers` — single substitui; multi alterna; com `exclusive`, escolher a exclusiva deixa só ela e escolher outra tira a exclusiva.
  - `isAnswered(answers, question): boolean` — `optional` está sempre respondida.
  - `requestPick(answers, lang): Promise<{ best_id, picks } | { error: string }>` — `supabase.functions.invoke('recomendar-raquete')`; erros devolvem o código do corpo (`daily_limit`, `no_candidates`, `ai_unavailable`, `ai_failed`, ou `network`), nunca lançam.
  - `loadMyPick(): Promise<{ pick, rackets } | null>` — a linha de `racket_picks` do utilizador e as 3 linhas de `rackets` desses ids.
  - `mergePickWithCatalog(pick, rackets): Array<{ id, best: boolean, why, pros, cons, hardness, sweet_spot, racket: RacketRow | null, soldOut: boolean }>` — melhor primeiro; `soldOut` se a raquete não existe ou `available` é `false`.

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { QUESTIONS, toggleAnswer, isAnswered, mergePickWithCatalog } from './raquete'

const q = (key) => QUESTIONS.find((x) => x.key === key)

it('11 perguntas, na ordem da spec', () => {
  expect(QUESTIONS.map((x) => x.key)).toEqual(['frequency', 'style', 'strengths', 'struggle', 'pain', 'feel', 'center', 'wants', 'shape', 'budget', 'brands'])
})

describe('toggleAnswer', () => {
  it('«Não» nas dores limpa as outras, e outra limpa «Não»', () => {
    let a = toggleAnswer({}, q('pain'), 'cotovelo')
    a = toggleAnswer(a, q('pain'), 'nao')
    expect(a.pain).toEqual(['nao'])
    expect(toggleAnswer(a, q('pain'), 'pulso').pain).toEqual(['pulso'])
  })
  it('multi alterna; single substitui', () => {
    const a = toggleAnswer(toggleAnswer({}, q('strengths'), 'voleios'), q('strengths'), 'voleios')
    expect(a.strengths).toEqual([])
    expect(toggleAnswer({ budget: 'lt80' }, q('budget'), '80_150').budget).toBe('80_150')
  })
})

it('marcas é opcional', () => expect(isAnswered({}, q('brands'))).toBe(true))

describe('mergePickWithCatalog', () => {
  const pick = { best_id: 'b', picks: [{ id: 'a', why: 'x' }, { id: 'b', why: 'y' }, { id: 'c', why: 'z' }] }
  const rackets = [{ store_id: 'a', available: true, price: 100 }, { store_id: 'b', available: false, price: 90 }]
  it('melhor primeiro; esgotada e desaparecida marcadas; preço de hoje', () => {
    const m = mergePickWithCatalog(pick, rackets)
    expect(m.map((x) => [x.id, x.best, x.soldOut])).toEqual([['b', true, true], ['a', false, false], ['c', false, true]])
    expect(m[1].racket.price).toBe(100)
    expect(m[2].racket).toBeNull()
  })
})
```

- [ ] **Step 2: Correr e ver falhar**

Run: `npx vitest run src/lib/raquete.test.js`
Expected: FAIL (`Failed to resolve import "./raquete"`)

- [ ] **Step 3: Implementar `src/lib/raquete.js`** com as assinaturas acima. As opções de cada pergunta (chaves curtas em pt sem acentos) seguem a tabela do questionário na spec.

- [ ] **Step 4: Correr e ver passar**

Run: `npx vitest run src/lib/raquete.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/raquete.js src/lib/raquete.test.js
git commit -m "feat(raquete): perguntas, respostas e resultado do lado da app"
```

---

### Task 6: Ecrãs, entrada no perfil, rotas e textos

**Files:**
- Create: `src/pages/RaqueteQuestionario.jsx`, `src/pages/RaqueteResultado.jsx`, `src/components/raquete/RaqueteCard.jsx`
- Modify: `src/App.jsx` (rotas, junto de `/perfil/numeros` em `src/App.jsx:680`), `src/pages/Profile.jsx` (cartão, antes do cartão do relógio em `src/pages/Profile.jsx:1014`), `src/locales/pt.json`, `en.json`, `es.json`

**Interfaces:**
- Consumes: tudo de `src/lib/raquete.js` (Task 5); `BackBar`, `PrimaryButton`, `EmptyState` (`pose="a-pensar"`), `LoadErrorState` de `src/components/ui.jsx`.
- Produces: rotas `/perfil/raquete` (resultado, ou o início se não houver) e `/perfil/raquete/perguntas`, ambas com `<Guard require="protected">`.

- [ ] **Step 1: Textos.** Acrescentar as chaves `raquete.*` aos 3 ficheiros: título e corpo do cartão do perfil (sem e com resultado), as 11 perguntas e todas as opções (`raquete.q_*`, `raquete.opt_*`), «N de 11», «Seguinte», «Saltar», «A pensar…», «Para ti», «As tuas 3 raquetes», «A melhor para ti», «Ver na Street Padel ↗», «Esgotada», «não indicado», «Refazer as perguntas», o rodapé (Global Constraints), e uma mensagem por erro: `daily_limit`, `no_candidates` (sugere subir o orçamento), `ai_unavailable` e `ai_failed` («Tenta daqui a pouco»), `network`. Textos curtos, pt-PT, sem ponto final nos títulos.

- [ ] **Step 2: `RaqueteQuestionario.jsx`** segundo o mockup v2, ecrã 2: fundo branco, «‹» + «N de 11» (Geist Mono) + barra de progresso, título Outfit, opções em botões de 48px (escolhida: borda preta 2px e ✓), `PrimaryButton` lima «Seguinte» preso em baixo e desligado até `isAnswered`. Na última pergunta, «Saltar» em texto e um campo de texto opcional (16px) para `current_racket`. As respostas vivem no estado da página: «‹» volta à pergunta anterior sem as perder; sair a meio não grava nada. No fim mostra `EmptyState pose="a-pensar"` e chama `requestPick(answers, i18n.language)`; com sucesso, `navigate('/perfil/raquete', { replace: true })`; com erro, mostra a mensagem do código e um botão para tentar outra vez com as mesmas respostas.

- [ ] **Step 3: `RaqueteCard.jsx` + `RaqueteResultado.jsx`** segundo o mockup v2, ecrã 3. `RaqueteCard({ item, featured, onOpen })`: foto (`racket.image_url`, `object-contain` numa caixa `bg-ink-50`, 84px em destaque e 64px compacto), nome, preço de hoje (Outfit 900), e, em destaque, o contorno lima, o selo «A melhor para ti», as pílulas de specs (formato, balanço, peso e dureza, cada uma com «não indicado» se faltar) e o `why`. Com `soldOut`: selo «Esgotada», sem preço. A ficha completa (ao tocar) mostra todos os campos da spec e o link `racket.url` com `target="_blank" rel="noopener"`. A página carrega `loadMyPick()`; sem resultado → redireciona para as perguntas; mostra o rodapé e o botão outline «Refazer as perguntas» → `/perfil/raquete/perguntas`.

- [ ] **Step 4: Perfil e rotas.** No `Profile.jsx`, um cartão no estilo do cartão do relógio (botão `card`, `ChevronRight`), visível para todos: sem resultado, título e corpo de «Escolhe a tua raquete»; com resultado (`loadMyPick` no carregamento da página), «As tuas raquetes» e as 3 fotos pequenas. As duas rotas no `App.jsx`, com import das páginas.

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/lib/raquete.test.js && npx vite build`
Expected: testes PASS e `✓ built`. Depois `npm run dev` com o atalho de login de dev: abrir o Perfil, fazer o questionário até ao fim contra o dev (precisa das Tasks 2–4 no dev), e confirmar à largura de telemóvel: um só botão lima por ecrã, a foto em cada raquete, «‹» mantém as respostas, «Refazer» volta às perguntas.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RaqueteQuestionario.jsx src/pages/RaqueteResultado.jsx src/components/raquete/RaqueteCard.jsx src/App.jsx src/pages/Profile.jsx src/locales/pt.json src/locales/en.json src/locales/es.json
git commit -m "feat(raquete): questionário, resultado com fotos e entrada no perfil"
```

---

### Task 7: Runbook e FEATURES

**Files:**
- Create: `docs/raquete.md`
- Modify: `FEATURES.md`

- [ ] **Step 1: `docs/raquete.md`** com a ordem de ativação, primeiro no dev e depois em produção: (1) criar a chave em Google AI Studio e ver lá o limite real do plano gratuito; (2) secrets `GEMINI_API_KEY`, `GEMINI_MODEL`, `SYNC_RAQUETES_SECRET`; (3) deploy de `sync-raquetes` e `recomendar-raquete`; (4) preencher URL e segredo e correr `migration_escolher_raquete.sql`, depois `supabase/tests/escolher_raquete.sql` (tudo `OK`); (5) chamar o sync uma vez à mão; (6) os curls das Tasks 3 e 4. Mais: como trocar de loja (`STORE` e `parseShopifyRacket`) e de modelo (`GEMINI_MODEL`).

- [ ] **Step 2: `FEATURES.md`:** uma entrada «Escolhe a tua raquete», a dizer que depende da migração, das duas funções e do secret, e onde está o runbook.

- [ ] **Step 3: Commit**

```bash
git add docs/raquete.md FEATURES.md
git commit -m "docs(raquete): runbook de ativação e FEATURES"
```
