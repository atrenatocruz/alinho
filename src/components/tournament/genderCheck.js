// O sexo nos torneios (Francisco, 8 nov; SPEC 2026-11-08-torneio-sexo-bloqueia).
// Masculinos: dois homens. Femininos: duas mulheres. Mistos: um homem e uma
// mulher. Quem joga não se inscreve numa categoria que não é para si: quem
// recusa é a base de dados, o ecrã só avisa antes. Quem organiza pode pôr na
// mesma, depois de confirmar. Nos mixes não muda nada: continua só a pergunta.
//
// Quem não tem o sexo no perfil não conta como «não bate»: não se sabe.

/** Esta categoria é para quem tem este sexo? Sem sexo, não se sabe: sim. */
export function fitsPlayer(category, gender) {
  const rule = category?.gender
  return !gender || !rule || rule === 'misto' || rule === gender
}

/** Quem tem este sexo pode fazer dupla comigo nesta categoria? */
export function partnerFits(category, myGender, partnerGender) {
  if (!partnerGender) return true
  const rule = category?.gender
  if (rule === 'masculino' || rule === 'feminino') return partnerGender === rule
  if (rule === 'misto') return !myGender || partnerGender !== myGender
  return true
}

/** «Só para mulheres» ou «Só para homens». */
export const onlyForKey = (category) => (category?.gender === 'feminino' ? 'tsignup.only_women' : 'tsignup.only_men')

/** Para quem organiza: a chave do título da pergunta «Inscrever na mesma?»,
 *  ou null se não há nada a perguntar. `genders` são os sexos conhecidos da
 *  dupla (um ou dois; null = não se sabe). */
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
