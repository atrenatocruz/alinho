// Idade mínima para criar conta sozinho: 13 anos — é o que a Lei 58/2019
// (art. 16.º) fixa em Portugal para o consentimento de menores em serviços
// online. Abaixo disso só com os pais, e isso não existe na app: o registo
// recusa (Ruben, 29 set 2026). Entre 13 e 17 a conta nasce privada
// (profiles.is_private) — ver EscolherNivel.
export const MIN_SIGNUP_AGE = 13
export const ADULT_AGE = 18

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
