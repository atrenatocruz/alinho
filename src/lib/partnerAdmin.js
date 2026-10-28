import { supabase } from './supabase'

/* A página de quem gere um parceiro (a Rita, da RM Terapias). Plano do Dev 3
   aprovado pelo Francisco a 22 out; funções em migration_parceiros_3_pagina_
   do_parceiro.sql. Os códigos vêm SEM nomes de quem ganhou. */

const BUCKET = 'partner-images'
const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Os parceiros que esta conta gere: [{ id, slug, name, logo_url }]. Sem nenhum, []. */
export async function myManagedPartners() {
  const { data, error } = await supabase.rpc('my_managed_partners')
  if (error) {
    // A função ainda não existe (base por correr): ninguém gere nada.
    if (error.code === 'PGRST202') return []
    throw error
  }
  return data || []
}

/** Os códigos do mês (p_month 'AAAA-MM-01', ou null = o mês de agora). */
export async function partnerListVouchers(partnerId, month = null) {
  const { data, error } = await supabase.rpc('partner_list_vouchers', { p_partner_id: partnerId, p_month: month })
  if (error) throw error
  return data || []
}

/** Os números do mês para o parceiro (design-handoff/2026-10-28-rm-tres-pecas,
    peça 2). Função do Dev 3 (nome combinado a 28 out). p_month 'AAAA-MM-01', ou
    null = o mês de agora. Devolve { counting_since, card_people, page_people,
    contact_taps, prizes, opened, used }: só totais, nunca quem foi. Sem a função
    (base por correr), null: o ecrã mostra o vazio. */
export async function partnerMonthNumbers(partnerId, month = null) {
  const { data, error } = await supabase.rpc('partner_month_numbers', { p_partner_id: partnerId, p_month: month })
  if (error) {
    if (error.code === 'PGRST202') return null
    throw error
  }
  return data || null
}

/** Marca um código como usado. Erros: not_allowed, not_found, already_used, expired. */
export async function partnerRedeemVoucher(code) {
  const { data, error } = await supabase.rpc('partner_redeem_voucher', { p_code: code })
  if (error) throw error
  return data
}

/** Guarda a ficha. undefined/null fica como está; '' apaga. Devolve o json do get_partner. */
export async function updatePartnerProfile(partnerId, fields) {
  const p = (v) => (v === undefined ? null : v)
  const { data, error } = await supabase.rpc('update_partner_profile', {
    p_partner_id: partnerId,
    // O nome também é do parceiro (Francisco, 22 out); só se manda quando muda,
    // para a função antiga (sem p_name) continuar a servir.
    ...(fields.name !== undefined ? { p_name: fields.name } : {}),
    ...(fields.kind_label !== undefined ? { p_kind_label: fields.kind_label } : {}),
    p_tagline: p(fields.tagline), p_address: p(fields.address), p_hours: p(fields.hours),
    p_phones: p(fields.phones), p_email: p(fields.email),
    p_instagram_url: p(fields.instagram_url), p_website_url: p(fields.website_url),
    p_logo_url: p(fields.logo_url), p_cover_url: p(fields.cover_url),
  })
  if (error) throw error
  return data
}

/** O erro das imagens antes de subir: 'bad_type' ou 'too_big'; null se está bem. */
export function imageProblem(file) {
  if (!file) return 'bad_type'
  if (!TYPES.includes(file.type)) return 'bad_type'
  if (file.size > MAX_BYTES) return 'too_big'
  return null
}

/** Sobe o logótipo ou a capa para partner-images/<partner_id>/ e devolve o endereço público. */
export async function uploadPartnerImage(partnerId, file, kind) {
  const problem = imageProblem(file)
  if (problem) throw new Error(problem)
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
  const path = `${partnerId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** «  rm-abc 123 » → «RM-ABC123»: como a base aceita (maiúsculas, sem espaços). */
export const normalizeCode = (code) => String(code || '').replace(/\s+/g, '').toUpperCase()

/** Para comparar: sem espaços nem hífenes (ao balcão escreve-se «rm q3u5xj» ou «rmq3u5xj»; QA, 23 out). */
export const codeKey = (code) => String(code || '').replace(/[\s-]+/g, '').toUpperCase()
