// Cartaz do torneio (Trello #361, print 07, passo 1: «Cartaz (opcional)»).
//
// Guarda-se no balde que já existe, `club-logos`, dentro da pasta do clube:
//   <organization_id>/torneios/<ficheiro>.jpg
// As regras desse balde deixam escrever a quem é admin da organização da
// PRIMEIRA pasta do caminho (migration_club_profile.sql), e a leitura é
// pública — que é o que um cartaz precisa, porque a página do torneio abre
// sem conta. Assim não é preciso balde novo nem migração.
//
// PROPOSTA, por acordar com o Renato: se preferir um balde próprio
// («tournament-posters»), é mudar o BUCKET aqui e mover os ficheiros — o
// resto da app não sabe onde eles estão, só guarda o endereço.
import { supabase } from './supabase'
import { compressImage } from './compressImage'

const BUCKET = 'club-logos'

/** Um cartaz é para se ver, não é um avatar: 1400 px de lado maior, para
 *  se conseguir ler o que está escrito na imagem sem pesar no telemóvel. */
const POSTER = { maxSize: 1400, quality: 0.82 }

/** O nome do ficheiro leva um carimbo de tempo porque o torneio ainda não
 *  existe quando o cartaz é escolhido (é o passo 1 de criar). */
export async function uploadTournamentPoster(organizationId, file) {
  const blob = await compressImage(file, POSTER)
  const path = `${organizationId}/torneios/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Tirar o cartaz: apaga o ficheiro a partir do endereço guardado. Se o
 *  endereço não for deste balde (um torneio antigo, um endereço escrito à
 *  mão), não faz nada — mais vale deixar um ficheiro órfão do que rebentar
 *  o ecrã de quem está a criar o torneio. */
export async function removeTournamentPoster(url) {
  const marker = `/${BUCKET}/`
  const at = typeof url === 'string' ? url.indexOf(marker) : -1
  if (at === -1) return
  const path = url.slice(at + marker.length).split('?')[0]
  const { error } = await supabase.storage.from(BUCKET).remove([decodeURIComponent(path)])
  if (error) throw error
}
