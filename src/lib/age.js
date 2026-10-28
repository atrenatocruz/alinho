// Idade mínima para criar conta sozinho: 13 anos — é o que a Lei 58/2019
// (art. 16.º) fixa em Portugal para o consentimento de menores em serviços
// online. Abaixo disso só com os pais, e isso não existe na app: o registo
// recusa (Ruben, 29 set 2026). Entre 13 e 17 a conta nasce privada
// (profiles.is_private) — ver EscolherNivel.
export const MIN_SIGNUP_AGE = 13
export const ADULT_AGE = 18

// Idade mínima por país onde a pessoa vive (consentimento digital do RGPD,
// art. 8; Francisco, 23 out; design-handoff/2026-10-18-linguas/ES-LEGAL-BA.md,
// pontos 1a e 1b). Conta o país onde vive, não a nacionalidade nem o clube.
// Outro país qualquer: 16, a idade do RGPD quando o país não escolhe outra.
// Quando se abrir outro país, junta-se aqui uma linha (a confirmar antes).
export const MIN_AGE_BY_COUNTRY = { PT: 13, ES: 14 }
export const DEFAULT_MIN_AGE = 16

/** A idade mínima para ter conta no país onde se vive ('PT', 'ES', …). */
export const minSignupAge = (country) => MIN_AGE_BY_COUNTRY[String(country || '').toUpperCase()] ?? DEFAULT_MIN_AGE

/** O país já escolhido no criar conta, pela língua do telemóvel ou do browser
    (SPEC de 23 out): pt-PT → PT, es-ES (ou só «es») → ES; outra → PT (todos
    os grupos e clubes de hoje são portugueses). A pessoa pode sempre mudar. */
export const countryFromLocale = (locale) => {
  const [lang, region] = String(locale || '').replace('_', '-').split('-')
  if (/^es$/i.test(region || '') || (!region && /^es$/i.test(lang))) return 'ES'
  return 'PT'
}

/** Pode mudar para este país? Não, se ficar abaixo da idade mínima de lá
    (a conta não é apagada; resolve-se à mão pelo suporte). */
export const canLiveIn = (birthday, country, today = new Date()) => isAtLeast(birthday, minSignupAge(country), today)

// birthday: 'YYYY-MM-DD'. Compara datas civis, sem fusos (uma pessoa faz
// anos no dia em que faz anos).
export const ageOn = (birthday, today = new Date()) => {
  if (!birthday) return null
  const [y, m, d] = String(birthday).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  let age = today.getFullYear() - y
  const beforeBirthday = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

export const isAtLeast = (birthday, years, today = new Date()) => {
  const age = ageOn(birthday, today)
  return age != null && age >= years
}

/** O dia mais recente que uma data de nascimento pode ter no registo:
    hoje menos a idade mínima do país (13 em Portugal). Serve de `max` aos DateField de
    nascimento — não vale a pena o calendário abrir em 2026 quando só se
    aceita 13+ (Ruben, 2 out). */
export const maxSignupBirthday = (today = new Date(), country = 'PT') => {
  const d = new Date(today.getFullYear() - minSignupAge(country), today.getMonth(), today.getDate())
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
