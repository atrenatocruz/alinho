// O sexo nunca bloqueia uma inscrição (Francisco, 26 set): quando não bate
// com a categoria, pergunta-se «tens a certeza?» e, se sim, segue. O
// organizador tira a dupla se for caso disso. A base de dados deixou de o
// verificar (migration_tournament_sexo_nao_bloqueia.sql, Dev 3).
//
// Quem não tem o sexo no perfil não conta como «não bate»: não se sabe.

/** Devolve a chave do título da pergunta, ou null se não há nada a perguntar.
 *  `genders` são os sexos conhecidos da dupla (um ou dois; null = não se sabe). */
export function categoryGenderQuestion(category, genders = []) {
  const known = genders.filter(Boolean)
  const rule = category?.gender
  if (rule === 'masculino' || rule === 'feminino') {
    return known.some((g) => g !== rule) ? `tsignup.gender_confirm_title_${rule}` : null
  }
  // Misto: um homem e uma mulher. Só se pergunta com os dois conhecidos.
  if (rule === 'misto' && known.length === 2 && known[0] === known[1]) return 'tsignup.gender_confirm_title_misto'
  return null
}
