import { semAcentos } from './semAcentos'

// Gerir › Pessoas (#776): quem já é membro, pelo que se escreveu. Procura em
// todos os membros que o ecrã já tem. Cada palavra escrita tem de estar no nome,
// sem contar com acentos e maiúsculas: «Pedro soa» e «soares» dão Pedro Soares.
export function membersMatching(members, query) {
  const words = semAcentos(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return (members || []).filter((member) => {
    const name = semAcentos(member.name)
    return words.every((word) => name.includes(word))
  })
}
