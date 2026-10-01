// Supabase em memória para os testes do bot: só o que o bot usa
// (select/insert/upsert/update/delete, eq/neq/in/gt, order/limit,
// single/maybeSingle, embeds «x:profiles!fk(...)»). `calls` regista uma
// entrada por ida à BD — é assim que se mede «quantas idas por comando».
import crypto from 'node:crypto'

export const calls = []

export function installFakeSupabase(supabase, db) {
  const embed = (row, select) => {
    const out = { ...row }
    const re = /(\w+):(profiles|game_guests)(?:!(\w+))?\s*\(/g
    let m
    while ((m = re.exec(select))) {
      const alias = m[1]
      if (m[2] === 'game_guests') {
        const col = m[3]?.includes('partner') || alias.includes('partner') ? 'partner_guest_id' : 'guest_id'
        out[alias] = (db.game_guests ?? []).find((g) => g.id === row[col]) ?? null
      } else {
        const col = m[3]?.includes('partner') || alias === 'partner' ? 'partner_id' : 'user_id'
        out[alias] = db.profiles.find((p) => p.id === row[col]) ?? null
      }
    }
    return out
  }
  function builder(table) {
    const q = { filters: [], op: 'select', select: '*', orders: [] }
    const get = (r, c) => c.split('.').reduce((o, k) => o?.[k], r)
    const exec = () => {
      calls.push(table)
      db[table] ??= []
      // Grandfathering da migração (migration_mix_guest_sem_conta.sql):
      // quem tem número associado conta como verificado — como em produção
      // depois da migração. Um teste que queira um número POR verificar
      // põe phone_verified_at: null explicitamente.
      for (const p of db.profiles ?? []) {
        if (p.phone_hash && !('phone_verified_at' in p)) p.phone_verified_at = '2026-10-01T00:00:00Z'
      }
      if (q.op === 'insert' || q.op === 'upsert') {
        if (db.failInsert?.table === table) {
          const { code, message } = db.failInsert
          db.failInsert = null
          return { data: null, error: { code, message } }
        }
        const out = []
        for (const r of q.rows) {
          // Upsert com onConflict (ex.: game_guests por (game_id,
          // phone_hash)): a linha existente é atualizada, como no Postgres.
          const conflictCols = q.op === 'upsert' && q.onConflict ? q.onConflict.split(',') : null
          const existing = conflictCols && conflictCols.every((c) => r[c] != null)
            ? db[table].find((x) => conflictCols.every((c) => x[c] === r[c]))
            : null
          if (existing) {
            Object.assign(existing, r)
            out.push(existing)
            continue
          }
          const row = { id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...r }
          if (q.op === 'upsert') db[table] = db[table].filter((x) => x.id !== row.id)
          db[table].push(row)
          out.push(row)
        }
        return { data: q.single ? out[0] : out, error: null }
      }
      if (q.op === 'delete') {
        db[table] = db[table].filter((row) => !q.filters.every((f) => f(row)))
        // Os triggers da BD (ex.: promover o 1.º suplente ao sair) — o teste
        // diz o que acontece com db.afterDelete(table).
        db.afterDelete?.(table)
        return { data: null, error: null }
      }
      if (q.op === 'update') {
        const changed = db[table].filter((r) => q.filters.every((f) => f(r)))
        for (const row of changed) Object.assign(row, q.patch)
        // Como o PostgREST com .select(): devolve as linhas alteradas.
        return { data: q.single ? changed[0] ?? null : changed, error: null }
      }
      let rows = db[table].map((r) => embed(r, q.select))
      for (const f of q.filters) rows = rows.filter(f)
      // .order(col, { ascending }) — por ordem de chamada (a 1.ª manda, as
      // seguintes desempatam), como no PostgREST.
      if (q.orders.length) {
        rows.sort((x, y) => {
          for (const { col, asc } of q.orders) {
            const a = get(x, col), b = get(y, col)
            if (a === b) continue
            return (a < b ? -1 : 1) * (asc ? 1 : -1)
          }
          return 0
        })
      }
      if (q.limit != null) rows = rows.slice(0, q.limit)
      if (q.single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
      if (q.maybe) return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }
    const api = {
      select: (s = '*') => { if (q.op === 'select') q.select = s; return api },
      insert: (r) => { q.op = 'insert'; q.rows = [].concat(r); return api },
      upsert: (r, opts = {}) => { q.op = 'upsert'; q.rows = [].concat(r); q.onConflict = opts.onConflict ?? null; return api },
      update: (patch) => { q.op = 'update'; q.patch = patch; return api },
      delete: () => { q.op = 'delete'; return api },
      eq: (c, v) => { q.filters.push((r) => get(r, c) === v); return api },
      neq: (c, v) => { q.filters.push((r) => get(r, c) !== v); return api },
      // .not(col, 'is', null) e .not(col, 'like', 'padrão%') — o que o phone.js usa.
      not: (c, op, v) => {
        // LIKE do SQL: % = qualquer coisa; o resto é literal.
        const like = (x) => {
          const parts = String(v).split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          return new RegExp('^' + parts.join('.*') + '$').test(x ?? '')
        }
        q.filters.push((r) => (op === 'is' ? get(r, c) !== v && get(r, c) !== undefined : op === 'like' ? !like(get(r, c)) : true))
        return api
      },
      in: (c, v) => { q.filters.push((r) => v.includes(get(r, c))); return api },
      gt: (c, v) => { q.filters.push((r) => get(r, c) > v); return api },
      lt: (c, v) => { q.filters.push((r) => get(r, c) < v); return api },
      // .is(col, null) — o que o voucherNotices.js usa.
      is: (c, v) => { q.filters.push((r) => (get(r, c) ?? null) === v); return api },
      order: (col, opts = {}) => { q.orders.push({ col, asc: opts.ascending !== false }); return api },
      limit: (n) => { q.limit = n; return api },
      single: () => { q.single = true; return api },
      maybeSingle: () => { q.maybe = true; return api },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    }
    return api
  }
  supabase.from = builder
  supabase.rpc = async (name, args) => {
    ;(db.rpcCalls ??= []).push([name, args])
    return { data: [], error: null }
  }
  supabase.auth.admin.createUser = async ({ user_metadata }) => ({ data: { user: { id: 'u-' + crypto.randomUUID().slice(0, 8), user_metadata } }, error: null })
  supabase.auth.admin.deleteUser = async () => ({})
}
