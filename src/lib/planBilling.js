// Os planos pagos (#723): só transporte. As regras (quem pede, valores,
// referência, experiência grátis, avisos) estão nas funções do Dev 3
// (supabase/migration_planos_pagos_1.sql e _2).
import { supabase } from './supabase'
import { signupErrorMessage } from './tournamentError'

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

/** A frase de um erro dos planos (gerirplans.error_<código>), ou a genérica. */
export const planErrorMessage = (t, error) => signupErrorMessage(t, error, 'gerirplans.error_')

// Ordem dos planos, como a plan_rank da base.
export const PLAN_RANK = { free: 0, plus: 1, pro: 2, club: 3 }

export const getGroupPlanStatus = (orgId) => rpc('get_group_plan_status', { p_organization_id: orgId })
export const requestPlan = (orgId, tier, { period = 'monthly', invoiceName = null, invoiceNif = null } = {}) =>
  rpc('request_plan', { p_organization_id: orgId, p_tier: tier, p_period: period, p_invoice_name: invoiceName, p_invoice_nif: invoiceNif })
export const cancelPlanRequest = (requestId) => rpc('cancel_plan_request', { p_request_id: requestId })
export const markPlanRequestPaid = (requestId) => rpc('mark_plan_request_paid', { p_request_id: requestId })
export const startPlanTrial = (orgId, tier) => rpc('start_plan_trial', { p_organization_id: orgId, p_tier: tier })
export const stopPlanTrial = (orgId) => rpc('stop_plan_trial', { p_organization_id: orgId })


/** Hoje em Lisboa, 'YYYY-MM-DD' (as datas dos planos são de Lisboa). */
export function lisbonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** Dias de hoje até `iso` (0 = hoje, 1 = amanhã). */
export function daysUntil(iso) {
  if (!iso) return null
  const a = new Date(`${lisbonToday()}T00:00:00Z`)
  const b = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

/** 'YYYY-MM-DD' + n dias. */
export function addDaysIso(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** '2026-01-18' → «18 jan» (pt) / «18 Jan» (en): o dia e o mês curto, sem
 *  pontos (o pt-PT do browser com day+month dá «18/01»). */
export function shortDay(iso, lang) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`)
  const month = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'short' }).replace(/\./g, '')
  return `${d.getDate()} ${month}`
}
