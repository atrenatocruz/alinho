// O sítio de um clube numa linha curta: a localidade, nunca a morada inteira
// (#787, SPEC da Comunidade, ponto 1). O campo do clube às vezes traz a morada
// completa: «A2N Padel Academy - Av. Vieira da Silva, … 2855-597 Corroios,
// Portugal» → «Corroios». Se não der para tirar a localidade, o distrito.

const COUNTRY = /^(portugal|espa[nñ]a|spain)$/i
const POSTAL = /\b\d{4}-\d{3}\s+([^,]+)/
// Palavra inteira: «Estoril», «Avintes» e «Aveiro» são terras, não «Est.» nem «Av.» (QA, 8 nov).
const STREET = /^(av|avenida|rua|r|largo|lg|praça|pç|travessa|tv|estrada|est|alameda|calçada|beco|urb|urbanização)(?=[.\s]|$)/i

export function placeName(location, district) {
  const s = String(location || '').replace(/\s+/g, ' ').trim()
  if (!s) return district || ''
  // Já é só a localidade («Almada»).
  if (!/[,\d]/.test(s) && !s.includes(' - ')) return s
  // Com código postal: o que vem a seguir a ele.
  const postal = s.match(POSTAL)
  if (postal) return postal[1].trim()
  // Sem código postal: a última parte, se não for uma rua nem tiver números.
  const parts = s.split(',').map((p) => p.trim()).filter((p) => p && !COUNTRY.test(p))
  const last = (parts[parts.length - 1] || '').split(' - ').pop().trim()
  if (parts.length > 1 && last && !/\d/.test(last) && !STREET.test(last)) return last
  return district || ''
}
