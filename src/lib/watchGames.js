import { registerPlugin } from '@capacitor/core'
import { IS_NATIVE, NATIVE_PLATFORM } from './native'

/* Jogos do relógio no iPhone (plugin WatchGames, ios/App/App/WatchGamesPlugin.swift).
   Fora da app de iPhone não há relógio: a lista vem vazia. */

export const WatchGames = registerPlugin('WatchGames', {
  web: () => ({
    list: async () => ({ games: [] }),
    remove: async () => {},
    markRegistered: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  }),
})

// Só a app de iPhone recebe jogos do relógio.
export const hasWatchGames = IS_NATIVE && NATIVE_PLATFORM === 'ios'

// Junta um jogo que chegou do relógio à lista: pelo id, fica o mais recente
// (updatedAt); `deleted` apaga; o registo feito no telemóvel não se perde.
export function mergeGame(list, game) {
  const existing = list.find((g) => g.id === game.id)
  if (existing && (existing.updatedAt ?? '') > (game.updatedAt ?? '')) return list
  const rest = list.filter((g) => g.id !== game.id)
  if (game.deleted) return rest
  const merged = existing?.registeredMatchId ? { ...game, registeredMatchId: existing.registeredMatchId } : game
  return [...rest, merged].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
}
