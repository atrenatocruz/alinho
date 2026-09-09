// Escalões etários (Trello #212).
//
// Decisão do Francisco (9 set 2026): versão curta — Sub-18 / 18-34 / +35 /
// +45. Mostra-se o intervalo e não o código federado: "SEN" significa, no
// desporto, o escalão principal de adultos (18-34), ou seja os MAIS NOVOS
// dos adultos — exactamente ao contrário do que "sénior" sugere na
// linguagem corrente. O próprio Francisco leu ao contrário, e é quem melhor
// conhece o produto. Vocabulário que precisa de legenda é vocabulário
// errado.
//
// ATENÇÃO À DUPLA NATUREZA DESTES VALORES:
// - Como ETIQUETA de perfil são gavetas exclusivas: quem tem 50 mostra "+45".
// - Como RESTRIÇÃO de um mix, os "+" são MÍNIMOS: um mix "+35" aceita quem
//   tenha 35 ou mais, incluindo alguém de 50. É como o desporto funciona —
//   um veterano pode jogar a prova do escalão abaixo do seu.
// A mesma regra está espelhada em SQL na função `meets_age_restriction`
// (migration_mix_age_restriction.sql). Se mudar aqui, tem de mudar lá.

export const AGE_RESTRICTIONS = [
  { value: 'sub18', labelKey: 'age.sub18' },
  { value: '18_34', labelKey: 'age.18_34' },
  { value: 'plus35', labelKey: 'age.plus35' },
  { value: 'plus45', labelKey: 'age.plus45' },
]

export const AGE_LABEL_KEY = Object.fromEntries(
  AGE_RESTRICTIONS.map((a) => [a.value, a.labelKey])
)

/** Idade em anos completos, ou null se não houver data de nascimento. */
export function ageFromBirthday(birthday) {
  if (!birthday) return null
  const born = new Date(birthday)
  if (Number.isNaN(born.getTime())) return null
  const today = new Date()
  let anos = today.getFullYear() - born.getFullYear()
  const mes = today.getMonth() - born.getMonth()
  // Ainda não fez anos este ano: desconta um.
  if (mes < 0 || (mes === 0 && today.getDate() < born.getDate())) anos -= 1
  return anos
}

/** Gaveta exclusiva, para mostrar no perfil. null quando não há data. */
export function ageCategory(birthday) {
  const anos = ageFromBirthday(birthday)
  if (anos == null) return null
  if (anos < 18) return 'sub18'
  if (anos < 35) return '18_34'
  if (anos < 45) return 'plus35'
  return 'plus45'
}

/**
 * Pode inscrever-se num mix com esta restrição?
 * Espelha `meets_age_restriction` em SQL — quem decide de verdade é a
 * policy de INSERT em `participants`; isto só evita mostrar um botão que
 * ia dar erro.
 */
export function meetsAgeRestriction(birthday, restriction) {
  if (!restriction) return true
  const anos = ageFromBirthday(birthday)
  // Sem data não há como verificar. A app pede-a num modal, no momento.
  if (anos == null) return false
  switch (restriction) {
    case 'sub18': return anos < 18
    case '18_34': return anos >= 18 && anos <= 34
    case 'plus35': return anos >= 35
    case 'plus45': return anos >= 45
    default: return true
  }
}
