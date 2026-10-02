import { supabase } from './supabase'

/* De que grupo é um jogo que a pessoa não pode ver (SPEC
   design-handoff/2026-10-01-jogo-de-grupo-fechado; Dev 3). Nada do jogo:
   só o grupo, e num grupo privado nem o nome.
   Devolve null (jogo apagado, rascunho, cancelado, entre amigos sem grupo,
   ou a função ainda não existe — fica o «Jogo não encontrado»), ou
   { visible, name, slug, kind, logoUrl }.
   Combinado como get_game_org_hint (tabela org_*); aceita também a forma
   game_owner_org (jsonb), que andou na conversa — a que existir. */
export function normalizeGameOrgHint(data) {
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  if ('org_visible' in row || 'org_kind' in row) {
    return { visible: !!row.org_visible, name: row.org_name || null, slug: row.org_slug || null, kind: row.org_kind || 'group', logoUrl: row.org_logo_url || null }
  }
  if (row.private === true) return { visible: false, name: null, slug: null, kind: row.kind || 'group', logoUrl: null }
  return { visible: true, name: row.name || null, slug: row.slug || null, kind: row.kind || 'group', logoUrl: row.group_logo_url || null }
}

export async function getGameOrgHint(gameId) {
  for (const fn of ['get_game_org_hint', 'game_owner_org']) {
    const { data, error } = await supabase.rpc(fn, { p_game_id: gameId })
    if (!error) {
      const hint = normalizeGameOrgHint(data)
      // Visível sem endereço não leva a lado nenhum: trata-se como privado.
      return hint && hint.visible && !hint.slug ? { ...hint, visible: false, name: null } : hint
    }
    if (error.code !== 'PGRST202') return null
  }
  return null
}
