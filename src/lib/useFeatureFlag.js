import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/** Um interruptor da tabela feature_flags, lido na hora. Sem linha (ou com
 *  erro) conta como desligado. { on, loading }. */
export function useFeatureFlag(key) {
  const [state, setState] = useState({ on: false, loading: true })
  useEffect(() => {
    let cancelled = false
    supabase.from('feature_flags').select('key, enabled').then(({ data, error }) => {
      if (cancelled) return
      if (error) console.error('Error loading feature flag:', error)
      setState({ on: !error && (data || []).find((f) => f.key === key)?.enabled === true, loading: false })
    })
    return () => { cancelled = true }
  }, [key])
  return state
}
