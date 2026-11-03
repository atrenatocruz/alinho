// O distrito de um sítio escolhido da lista do Google (#731). O Google devolve-o
// de várias formas («Distrito de Setúbal», «Setúbal District», «Lisbon»…) e a base
// só aceita os nomes de leagueDistricts.js, ou nada.
import { DISTRICTS } from './leagueDistricts'

const plain = (text) => String(text ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim()
  .replace(/\s+/g, ' ')

const BY_PLAIN_NAME = new Map(DISTRICTS.map((d) => [plain(d), d]))
// Os nomes em inglês que não são só o português sem acentos.
BY_PLAIN_NAME.set('lisbon', 'Lisboa')
BY_PLAIN_NAME.set('oporto', 'Porto')
BY_PLAIN_NAME.set('azores', 'Açores')

/** O nome da lista, ou null quando não é um distrito que a gente conheça. */
export function districtFromGoogleName(name) {
  const bare = plain(name)
    .replace(/^distrito (de |do |da )?/, '')
    .replace(/^regiao autonoma (dos |das |do |da |de )?/, '')
    .replace(/^autonomous region (of )?(the )?/, '')
    .replace(/ district$/, '')
    .replace(/ autonomous region$/, '')
  return BY_PLAIN_NAME.get(bare) ?? null
}

const componentName = (c) => c?.long_name ?? c?.longText ?? null
const componentCode = (c) => c?.short_name ?? c?.shortText ?? null
const ofType = (components, type) => components.find((c) => c?.types?.includes(type))

/** Dos address_components do Google (a forma antiga e a nova). Fora de Portugal,
 *  ou sem a região, é null: o jogo fica sem distrito. */
export function districtFromAddressComponents(components) {
  if (!Array.isArray(components)) return null
  const country = ofType(components, 'country')
  if (country && componentCode(country) !== 'PT') return null
  const region = ofType(components, 'administrative_area_level_1')
  return region ? districtFromGoogleName(componentName(region)) : null
}

/** Das propriedades do Photon, a reserva quando a Google falha. O distrito vem no
 *  county; nos Açores e na Madeira, no state. */
export function districtFromPhoton(properties) {
  const p = properties ?? {}
  if (p.countrycode && p.countrycode !== 'PT') return null
  return districtFromGoogleName(p.county) ?? districtFromGoogleName(p.state)
}
