// Supabase Edge Function: copia as raquetes da Street Padel para a tabela `rackets`.
//
// PORQUÊ: o «Escolhe a tua raquete» (docs/superpowers/specs/2026-10-27-escolher-raquete-design.md)
// só recomenda raquetes reais, em stock, com o preço de hoje. Ler o catálogo da loja
// a cada pedido deixava o questionário dependente do site da loja; por isso fica uma
// cópia nossa, atualizada uma vez por dia pelo cron 'sync-raquetes'
// (supabase/migration_escolher_raquete.sql).
//
// Como funciona: lê /products.json da loja (Shopify, público) página a página até vir
// vazia, fica só com as raquetes (parseShopifyRacket: sem packs nem pickleball), faz
// upsert por store_id e marca como indisponíveis as que já não vieram. Nada se apaga:
// um resultado guardado pode apontar para uma raquete que saiu do catálogo.
// Se a primeira página falhar, não mexe em nada: 502 {"error":"catalog_unavailable"}.
//
// Chamada só pelo cron, com o cabeçalho x-sync-secret igual ao secret
// SYNC_RAQUETES_SECRET (senão 403). Resposta: 200 {total, rackets, available}.
//
// Secrets: SYNC_RAQUETES_SECRET (escolher um valor e pô-lo também na migração).
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados pela plataforma.
//
// Deploy (Renato, projeto dev primeiro):
//   npx supabase functions deploy sync-raquetes --no-verify-jwt --project-ref <dev>
// Verificar à mão:
//   curl -X POST -H "x-sync-secret: $S" https://<dev>.supabase.co/functions/v1/sync-raquetes
//   -> 200 com rackets ~700 e available ~300.

import { createClient } from 'jsr:@supabase/supabase-js@2.117.3'
import { STORE, parseShopifyRacket } from '../_shared/raquetes.js'

// A 27 out a loja tinha 8674 produtos (35 páginas). Chegar ao limite sem uma
// página vazia conta como lista incompleta (não se marca nada como esgotado).
const MAX_PAGES = 80
const BATCH = 200

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fetchPage(page: number): Promise<unknown[]> {
  const res = await fetch(`${STORE.base}/products.json?limit=250&page=${page}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; alinho.pt)' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`catalog ${res.status}`)
  const body = await res.json()
  return Array.isArray(body?.products) ? body.products : []
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('SYNC_RAQUETES_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret) return json({ error: 'forbidden' }, 403)

  const startedAt = new Date().toISOString()
  // Só as raquetes ficam em memória (filtradas página a página); `total` conta
  // todos os produtos lidos.
  const byId = new Map()
  let total = 0
  let partial = true
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await fetchPage(page)
      if (!list.length) { partial = false; break }
      total += list.length
      for (const r of list.map(parseShopifyRacket)) if (r) byId.set(r.store_id, { ...r, synced_at: startedAt })
    }
    if (partial) console.error('sync-raquetes: page cap reached, treating as partial')
  } catch (e) {
    // Sem a primeira página não se sabe nada: não marcar tudo como esgotado.
    if (!total) {
      console.error('sync-raquetes: catalog unavailable', (e as Error).message)
      return json({ error: 'catalog_unavailable' }, 502)
    }
    // A meio: fica o que veio, mas não se marca nada como indisponível (a lista está incompleta).
    console.error('sync-raquetes: partial catalog', (e as Error).message)
    partial = true
  }
  if (!total) return json({ error: 'catalog_unavailable' }, 502)

  // O Map por store_id também tira repetidos: a paginação por páginas da Shopify
  // pode repetir um produto que mudou de página a meio, e dois iguais no mesmo
  // upsert rebentavam com o lote todo.
  const rows = [...byId.values()]

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('rackets').upsert(rows.slice(i, i + BATCH), { onConflict: 'store_id' })
    if (error) {
      console.error('sync-raquetes: upsert failed', error.code)
      return json({ error: 'db_error' }, 500)
    }
  }
  if (!partial) {
    const { error } = await db.from('rackets').update({ available: false }).lt('synced_at', startedAt)
    if (error) console.error('sync-raquetes: mark unavailable failed', error.code)
  }

  return json({
    total,
    rackets: rows.length,
    available: rows.filter((r) => r!.available).length,
  })
})
