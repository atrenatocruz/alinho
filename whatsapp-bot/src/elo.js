// Bandas públicas do Elo (RANKING.md) — cópia local de src/lib/elo.js da
// web app, que é a fonte canónica dos thresholds. Duplicado de propósito:
// o Docker do bot só copia whatsapp-bot/src, não consegue importar da app.
const BANDS = [
  { min: 1800, num: 1 },
  { min: 1600, num: 2 },
  { min: 1400, num: 3 },
  { min: 1200, num: 4 },
  { min: 1000, num: 5 },
  { min: 700, num: 6 },
]

/** Banda de um rating ('M6', 'F4', 'INI') ou null sem rating. */
export function ratingBandLabel(rating, gender) {
  if (rating == null) return null
  // M = masculino, F = feminino, N = nível para quem não preencheu o
  // género (regra do Francisco, 9 set 2026, Trello #202). A app já faz
  // isto em src/lib/elo.js; o bot tinha ficado com a versão antiga, que
  // rotulava de M toda a gente sem género — incluindo mulheres.
  const prefix = gender === 'feminino' ? 'F' : gender === 'masculino' ? 'M' : 'N'
  const band = BANDS.find((b) => rating >= b.min)
  if (!band) return 'INI'
  return `${prefix}${band.num}`
}

/** "Nome Completo (M6)" — ou só o nome, para quem ainda não tem rating. */
export function nameWithBand({ name, rating, gender }) {
  const band = ratingBandLabel(rating, gender)
  return band ? `${name} (${band})` : name
}
