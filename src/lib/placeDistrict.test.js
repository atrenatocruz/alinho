import { describe, it, expect } from 'vitest'
import { DISTRICTS } from './leagueDistricts'
import { districtFromGoogleName, districtFromAddressComponents, districtFromPhoton } from './placeDistrict'

// As respostas do Photon de 3 nov, para estes sítios.
describe('districtFromPhoton', () => {
  it.each([
    [{ name: 'Almada', county: 'Setúbal', countrycode: 'PT' }, 'Setúbal'],
    [{ name: 'Rua Garrett', city: 'Lisboa', county: 'Lisboa', countrycode: 'PT' }, 'Lisboa'],
    [{ name: 'Vitória Sport Clube', city: 'Guimarães', county: 'Braga', countrycode: 'PT' }, 'Braga'],
    [{ name: 'Funchal', state: 'Madeira', countrycode: 'PT' }, 'Madeira'],
    [{ name: 'Ponta Delgada', state: 'Região Autónoma dos Açores', countrycode: 'PT' }, 'Açores'],
  ])('%o → %s', (properties, district) => {
    expect(districtFromPhoton(properties)).toBe(district)
  })

  it('sem county nem state, ou fora de Portugal, fica sem distrito', () => {
    expect(districtFromPhoton({ name: 'Porto', countrycode: 'PT' })).toBeNull()
    expect(districtFromPhoton({ county: 'Porto', countrycode: 'ES' })).toBeNull()
    expect(districtFromPhoton({})).toBeNull()
    expect(districtFromPhoton(null)).toBeNull()
    expect(districtFromPhoton(undefined)).toBeNull()
  })
})

describe('districtFromGoogleName', () => {
  it.each([
    ['Setúbal', 'Setúbal'],
    ['Distrito de Setúbal', 'Setúbal'],
    ['Setúbal District', 'Setúbal'],
    ['Setubal', 'Setúbal'],
    ['  distrito   de setúbal ', 'Setúbal'],
    ['Lisboa', 'Lisboa'],
    ['Lisbon', 'Lisboa'],
    ['Lisbon District', 'Lisboa'],
    ['Distrito do Porto', 'Porto'],
    ['Oporto', 'Porto'],
    ['Porto District', 'Porto'],
    ['Região Autónoma dos Açores', 'Açores'],
    ['Autonomous Region of the Azores', 'Açores'],
    ['Azores', 'Açores'],
    ['Região Autónoma da Madeira', 'Madeira'],
    ['Madeira Autonomous Region', 'Madeira'],
    ['Viana do Castelo District', 'Viana do Castelo'],
    ['Distrito de Évora', 'Évora'],
    ['Santarem', 'Santarém'],
    ['Braganca', 'Bragança'],
  ])('%s → %s', (google, district) => {
    expect(districtFromGoogleName(google)).toBe(district)
  })

  it('cada nome da lista volta a dar-se a si próprio', () => {
    for (const d of DISTRICTS) expect(districtFromGoogleName(d)).toBe(d)
  })

  it.each(['Madrid', 'Almada', 'Área Metropolitana de Lisboa', '', null, undefined])('%s não é um distrito', (name) => {
    expect(districtFromGoogleName(name)).toBeNull()
  })
})

describe('districtFromAddressComponents', () => {
  const region = (long_name) => ({ long_name, short_name: long_name, types: ['administrative_area_level_1', 'political'] })
  const country = (short_name) => ({ long_name: short_name, short_name, types: ['country', 'political'] })

  it('lê a região de um sítio em Portugal', () => {
    const almada = [{ long_name: 'Almada', short_name: 'Almada', types: ['locality', 'political'] }, region('Setúbal'), country('PT')]
    expect(districtFromAddressComponents(almada)).toBe('Setúbal')
  })

  it('lê a forma nova do Google', () => {
    const c = [
      { longText: 'Distrito do Porto', shortText: 'Porto', types: ['administrative_area_level_1'] },
      { longText: 'Portugal', shortText: 'PT', types: ['country'] },
    ]
    expect(districtFromAddressComponents(c)).toBe('Porto')
  })

  it('fora de Portugal fica sem distrito, mesmo com um nome igual', () => {
    expect(districtFromAddressComponents([region('Porto'), country('ES')])).toBeNull()
  })

  it('sem região, ou sem lista, fica sem distrito', () => {
    expect(districtFromAddressComponents([country('PT')])).toBeNull()
    expect(districtFromAddressComponents([])).toBeNull()
    expect(districtFromAddressComponents(null)).toBeNull()
    expect(districtFromAddressComponents(undefined)).toBeNull()
  })
})
