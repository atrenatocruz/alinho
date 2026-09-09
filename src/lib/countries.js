// Nacionalidade do jogador (Trello #191).
//
// Guardamos o código ISO 3166-1 alpha-2 (`PT`, `BR`, `ES`), nunca o nome:
// o nome muda com o idioma da app, o código não. Mesmo raciocínio de
// `profiles.language` guardar 'pt'/'en' e não "Português".
//
// Os NOMES vêm do `Intl.DisplayNames` do próprio navegador, já traduzidos.
// Isto evita ter de manter ~250 países × 2 idiomas em pt.json/en.json — que
// era o que tornava esta task grande — e dá de graça qualquer idioma que a
// app venha a suportar.
//
// Sem bandeiras, por decisão do Francisco (9 set 2026): só texto.

// ISO 3166-1 alpha-2. Lista fixa porque o Intl não sabe enumerar regiões,
// só traduzir um código que lhe dermos.
const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

const LOCALE_MAP = { pt: 'pt-PT', en: 'en-GB' }

// Cache por idioma: construir o DisplayNames e ordenar 250 nomes a cada
// render de um <Select> seria desperdício, e a lista não muda.
const cache = new Map()

export function countryName(code, lang) {
  if (!code) return ''
  try {
    return new Intl.DisplayNames([LOCALE_MAP[lang] || 'pt-PT'], { type: 'region' }).of(code) || code
  } catch {
    // Navegador sem Intl.DisplayNames — mostra o código, que continua a ser
    // legível ("PT") e é melhor do que não mostrar nada.
    return code
  }
}

/** [{ value: 'PT', label: 'Portugal' }], ordenado pelo nome no idioma dado. */
export function countryOptions(lang) {
  const key = lang || 'pt'
  if (cache.has(key)) return cache.get(key)
  const locale = LOCALE_MAP[key] || 'pt-PT'
  const options = CODES
    .map((code) => ({ value: code, label: countryName(code, key) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))
  cache.set(key, options)
  return options
}
