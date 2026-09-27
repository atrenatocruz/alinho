import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

// Nenhum grupo nem clube pode repetir o nome (Francisco, 27 set). A trava a
// sério é da base de dados (Dev 3, migration_nomes_de_grupo_unicos.sql: o
// índice organizations_name_unaccent_key, sem contar maiúsculas, acentos nem
// espaços a mais, e o 'name_taken' das funções de criar). Aqui só se avisa
// enquanto se escreve, com a organization_name_taken — e a mesma frase
// aparece se a base de dados recusar ao gravar (errors.js, 'org_name_taken').

/** O nome já é de outro grupo ou clube? `excludeId`: o próprio, ao mudar o nome. */
export async function orgNameTaken(name, excludeId = null) {
  const { data, error } = await supabase.rpc('organization_name_taken', { p_name: name, p_exclude_id: excludeId })
  // Sem a função (migração por correr) ou sem rede: não se avisa — quem
  // decide é a base de dados, ao gravar.
  if (error) return false
  return data === true
}

/** Verifica o nome enquanto se escreve (400 ms depois da última tecla). */
export function useOrgNameTaken(name, { excludeId = null, enabled = true } = {}) {
  const [taken, setTaken] = useState(false)
  const trimmed = String(name || '').trim()
  useEffect(() => {
    setTaken(false)
    if (!enabled || !trimmed) return undefined
    let alive = true
    const timer = setTimeout(async () => {
      const result = await orgNameTaken(trimmed, excludeId)
      if (alive) setTaken(result)
    }, 400)
    return () => { alive = false; clearTimeout(timer) }
  }, [trimmed, excludeId, enabled])
  return taken
}

/** A frase por baixo do campo do nome. */
export function OrgNameTakenHint({ taken, className = '' }) {
  const { t } = useTranslation()
  if (!taken) return null
  return <p role="alert" className={`mt-1.5 text-sm font-extrabold text-danger ${className}`}>{t('errors.org_name_taken')}</p>
}
