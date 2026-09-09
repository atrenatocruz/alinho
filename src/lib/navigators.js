// Apps de navegação para chegar ao local de um mix (Trello #34).
//
// Até aqui o link do local ia sempre e só para o Google Maps, sem escolha.
//
// Cada app recebe a morada em texto e, quando existirem, as coordenadas.
// Preferimos sempre as coordenadas: a pesquisa por texto depende de o
// serviço interpretar bem a morada, e os nomes de clubes de padel são
// exactamente o tipo de coisa que uma pesquisa por texto falha. As
// coordenadas passaram a ser guardadas em #203, por isso os locais criados
// a partir daí têm-nas; os antigos não, e para esses continua a valer o
// texto.
export const NAVIGATORS = [
  {
    key: 'google',
    labelKey: 'gamedetails.navigator_google',
    url: ({ location, latitude, longitude }) =>
      latitude != null && longitude != null
        ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location || '')}`,
  },
  {
    key: 'waze',
    labelKey: 'gamedetails.navigator_waze',
    // navigate=yes faz o Waze começar já a navegar em vez de só mostrar o
    // ponto — é o que se quer de um link "como chegar lá".
    url: ({ location, latitude, longitude }) =>
      latitude != null && longitude != null
        ? `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(location || '')}&navigate=yes`,
  },
  {
    key: 'apple',
    labelKey: 'gamedetails.navigator_apple',
    url: ({ location, latitude, longitude }) =>
      latitude != null && longitude != null
        ? `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(location || '')}`
        : `https://maps.apple.com/?q=${encodeURIComponent(location || '')}`,
  },
]

export const DEFAULT_NAVIGATOR = 'google'

// Guardado no dispositivo, e não no perfil, de propósito: ter o Waze
// instalado é uma característica do TELEMÓVEL, não da pessoa. Quem usa Waze
// no telemóvel não o tem no portátil, e sincronizar a escolha entre os dois
// dava a resposta errada num deles. Mesmo motivo pelo qual a preferência de
// idioma pré-login vive em localStorage (ver lib/i18n.js) — e poupa uma
// migração.
//
// try/catch em ambos: localStorage rebenta em navegação privada e com
// armazenamento desativado.
const STORAGE_KEY = 'preferredNavigator'

export function getPreferredNavigator() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (NAVIGATORS.some((n) => n.key === stored)) return stored
  } catch {
    // ignorar — cai no valor por omissão
  }
  return DEFAULT_NAVIGATOR
}

export function setPreferredNavigator(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // ignorar — a escolha vale só para esta abertura
  }
}

export function navigatorUrl(key, place) {
  const nav = NAVIGATORS.find((n) => n.key === key) || NAVIGATORS[0]
  return nav.url(place)
}
