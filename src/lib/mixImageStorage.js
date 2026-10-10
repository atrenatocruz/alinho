// A imagem opcional do mix (Home do futuro, SPEC-3 — aprovado pelo
// Francisco a 9 out). Fica no balde `club-logos`, na pasta do clube:
//   <organization_id>/mixes/<ficheiro>.jpg
// como o cartaz do torneio (tournamentPosterStorage.js). A base de dados só
// aceita um endereço deste balde, na pasta do clube do próprio mix
// (migration_mix_imagem.sql, Dev 3) — um endereço de fora dá 23514.
//
// Tirar a imagem não apaga o ficheiro: as datas de uma série herdam o mesmo
// endereço, e apagá-lo deixava-as com a imagem partida.
import { supabase } from './supabase'
import { compressImage } from './compressImage'

const BUCKET = 'club-logos'

/** Uma faixa larga no cartão: 1400 px de lado maior chega e não pesa. */
const IMAGE = { maxSize: 1400, quality: 0.82 }

export async function uploadMixImage(organizationId, file) {
  const blob = await compressImage(file, IMAGE)
  const path = `${organizationId}/mixes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
