import { supabase } from './supabase'

/** O endereço (alinho.pt/clube/<isto>) faz-se sozinho a partir do nome:
 *  sem acentos, minúsculas, hífens. A pessoa já não o escreve (UX, 29 set:
 *  «slug» e «identificador» saem). Mudar o nome depois não o muda — os
 *  links já partilhados não podem partir. */
export function slugFromName(name, fallback = 'grupo') {
  const slug = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '')
  return slug || fallback
}

// Endereço já usado (e não o nome, que tem erro próprio): tenta -2, -3…
const slugTaken = (error) => error?.code === '23505' && !/name_unaccent/.test(`${error.message} ${error.details || ''}`)

async function withFreeSlug(name, create) {
  const base = slugFromName(name)
  for (let n = 1; ; n++) {
    const { data, error } = await create(n === 1 ? base : `${base}-${n}`)
    if (!error) return data
    if (!slugTaken(error) || n >= 20) throw error
  }
}

export const searchAnyPlayer = async (query) => {
  const { data, error } = await supabase.rpc('search_any_player', { p_query: query })
  if (error) throw error
  return data || []
}

/** Devolve { data, slug } — o endereço que ficou, para abrir a página. */
export const createOrganization = async (name, adminUserId) => {
  let used = null
  const data = await withFreeSlug(name, (slug) => {
    used = slug
    return supabase.rpc('create_organization', { p_name: name, p_slug: slug, p_admin_user_id: adminUserId })
  })
  return { data, slug: used }
}

export const createGroup = async (name, parentOrgId, adminUserId) => {
  let used = null
  const data = await withFreeSlug(name, (slug) => {
    used = slug
    return supabase.rpc('create_group', { p_name: name, p_slug: slug, p_parent_org_id: parentOrgId || null, p_admin_user_id: adminUserId })
  })
  return { data, slug: used }
}

export const createSelfServeGroup = async (name) => {
  let used = null
  const data = await withFreeSlug(name, (slug) => {
    used = slug
    return supabase.rpc('create_self_serve_group', { p_name: name, p_slug: slug })
  })
  return { data, slug: used }
}
