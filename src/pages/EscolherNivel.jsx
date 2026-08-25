import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { ONBOARDING_LEVELS } from '../lib/elo'

/* ════════════════════════════════════════════════════════════════════════
   Auto-classificação no primeiro registo (Elo v1, RANKING.md).

   Ecrã bloqueante mostrado UMA vez, apenas a contas novas
   (profiles.rating_onboarded_at === null — ver Guard em App.jsx). Define
   os pontos de entrada no ranking: Iniciado 700 · Regular 900 · Avançado
   1100. A âncora é a peça que calibra o grupo na escala do desporto — o
   Elo só ordena — por isso a escolha é explícita e não tem default.
   Contas antigas nunca passam por aqui (marcadas na migração).
   ════════════════════════════════════════════════════════════════════════ */
export default function EscolherNivel() {
  const { user, refreshMemberships } = useAuth()
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('complete_rating_onboarding', {
        p_level: selected,
      })
      if (rpcError) throw rpcError
      // Re-lê o perfil — rating_onboarded_at deixa de ser null e o Guard
      // deixa-nos entrar na app.
      await refreshMemberships()
    } catch (err) {
      console.error('Error completing rating onboarding:', err)
      setError('Não foi possível guardar. Tenta novamente.')
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Wordmark variant="light" className="h-7 mx-auto mb-8" />

        <h1 className="text-2xl text-ink-900 text-center mb-1.5">Qual é o teu nível?</h1>
        <p className="text-muted text-sm text-center mb-7">
          Define os teus pontos de entrada no ranking. Escolhe com honestidade —
          a partir daqui são os resultados que falam.
        </p>

        <div className="space-y-3 mb-7">
          {ONBOARDING_LEVELS.map((level) => {
            const isSelected = selected === level.key
            return (
              <button
                key={level.key}
                type="button"
                onClick={() => setSelected(level.key)}
                className={`card press block w-full text-left transition-all duration-fast ${
                  isSelected ? 'ring-2 ring-lime-400' : 'hover:shadow-lift'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base text-ink-900">{level.title}</h3>
                    <p className="text-[13px] text-muted mt-0.5">{level.description}</p>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2.5">
                    <div>
                      <p className="text-xl font-extrabold text-ink-900 tabular-nums">{level.points}</p>
                      <p className="text-[11px] text-muted">pontos</p>
                    </div>
                    {isSelected && <CheckCircle2 size={22} className="text-lime-600" />}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {error && <p className="text-danger text-sm text-center mb-4">{error}</p>}

        <PrimaryButton
          onClick={handleConfirm}
          disabled={!selected || saving}
          className="w-full"
        >
          {saving ? 'A guardar…' : 'Confirmar'}
        </PrimaryButton>
        <p className="text-[11px] text-muted text-center mt-3">
          Esta escolha define só o ponto de partida — o nível público (M6, M5…)
          evolui com os teus jogos.
        </p>
      </div>
    </div>
  )
}
