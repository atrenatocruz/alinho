// O que mudou numa data de uma série (SPEC design-handoff/2026-10-13-serie-
// so-este-ou-seguintes, aprovada pelo Francisco). Ao guardar o Editar de uma
// data de um mix que se repete, a app pergunta «Só este mix» ou «Este e os
// seguintes» quando alguma destas regras mudou. O dia e a hora ficam de
// fora (mudam sempre só este mix), e o que só existe na série («Repete?»,
// «Abrem as inscrições», «Acaba») muda sempre a série.
//
// As mudanças vão em códigos ({ field, value }) para o aviso aos inscritos
// (notify_mix_changed, Dev 3); o ecrã escreve a frase com changeText.
import { formatCurrency } from './formatDate'
import { formatLabelKey, GENDER_RESTRICTION_LABEL_KEY } from './mixLogic'
import { AGE_LABEL_KEY } from './ageCategories'
import { parseLevel } from './mixLevels'

// Pela ordem em que aparecem nas pastilhas.
export const RULE_FIELDS = [
  'title', 'format', 'price_per_player', 'special', 'num_courts', 'court_time_minutes', 'game_time_minutes',
  'level', 'gender_restriction', 'age_restriction', 'prize', 'has_voucher', 'ranked', 'location',
  'pairing_mode', 'respect_sides', 'allow_pair_signup', 'join_approval', 'scoring_format', 'tiebreak_8_8',
  'pool_size', 'auto_start_hours_before', 'image_url', 'whatsapp_post_times',
]

// O formato, na app, junta três colunas (sobe e desce, escalada, a rodar).
const FORMAT_PARTS = ['format', 'seed_reverse', 'rotate_partners']

const norm = (field, v) => {
  if (v === undefined || v === '') v = null
  switch (field) {
    case 'price_per_player': case 'num_courts': case 'court_time_minutes': case 'game_time_minutes':
    case 'pool_size': case 'auto_start_hours_before':
      return v == null ? null : Number(String(v).replace(',', '.'))
    case 'has_voucher': case 'respect_sides': case 'allow_pair_signup': case 'join_approval':
      return !!v
    case 'ranked': return v !== false
    case 'gender_restriction': return v || 'indiferente'
    case 'pairing_mode': return v || 'por_nivel'
    case 'tiebreak_8_8': return v === 'super_tiebreak' ? 'super_tiebreak' : null
    case 'whatsapp_post_times': return Array.isArray(v) ? v.map((h) => String(h).slice(0, 5)).sort().join(',') : null
    case 'special': return v == null ? null : JSON.stringify(v)
    default: return v
  }
}

/** before e after: linhas de games (after = o que se vai gravar). Devolve
 *  [{ field, value }] só com as regras que mudaram. */
export function mixChanges(before, after) {
  const out = []
  for (const field of RULE_FIELDS) {
    if (field === 'format') {
      const pick = (g) => ({ format: g?.format || 'sobe_desce', seed_reverse: !!g?.seed_reverse, rotate_partners: !!g?.rotate_partners })
      const changed = FORMAT_PARTS.some((f) => pick(before)[f] !== pick(after)[f])
      if (changed) out.push({ field: 'format', value: { format: after.format, seed_reverse: !!after.seed_reverse, rotate_partners: !!after.rotate_partners } })
      continue
    }
    if (!(field in (after || {}))) continue
    if (norm(field, before?.[field]) !== norm(field, after[field])) out.push({ field, value: after[field] ?? null })
  }
  return out
}

/** «Formato: Sobe e desce», «Preço: 10,00 €»; nas regras sem valor curto,
 *  só o nome («Imagem»). */
export function changeLabel(t, change, lang) {
  const name = t(`seriescope.field_${change.field}`)
  const v = changeValue(t, change, lang)
  return v ? `${name}: ${v}` : name
}

/** A frase do aviso aos inscritos: «preço 10,00 €, formato Sobe e desce». */
export function changesText(t, changes, lang) {
  return (changes || []).map((c) => {
    const v = changeValue(t, c, lang)
    const name = t(`seriescope.field_${c.field}`).toLocaleLowerCase(lang)
    return v ? `${name} ${v}` : name
  }).join(', ')
}

function changeValue(t, { field, value }, lang) {
  switch (field) {
    case 'title': case 'location': return value ? String(value) : null
    case 'prize': return value ? String(value) : t('seriescope.value_none')
    case 'format': return t(formatLabelKey(value || {}))
    case 'price_per_player': return value == null || value === '' ? t('seriescope.value_free') : formatCurrency(Number(value), lang)
    case 'num_courts': return t('gamedetails.court_count', { count: Number(value) || 1 })
    case 'court_time_minutes': case 'game_time_minutes': return value ? `${value} min` : null
    case 'level': { const l = parseLevel(value); return l ? `${l.scale}${l.num}` : t('seriescope.value_any_level') }
    case 'gender_restriction': return GENDER_RESTRICTION_LABEL_KEY[value || 'indiferente'] ? t(GENDER_RESTRICTION_LABEL_KEY[value || 'indiferente']) : null
    case 'age_restriction': return value && AGE_LABEL_KEY[value] ? t(AGE_LABEL_KEY[value]) : t('seriescope.value_any_age')
    case 'has_voucher': case 'allow_pair_signup': case 'join_approval': case 'respect_sides':
      return t(value ? 'seriescope.value_yes' : 'seriescope.value_no')
    case 'ranked': return value === false ? t('gamedetails.badge_friendly') : t('seriescope.value_ranked')
    default: return null
  }
}
