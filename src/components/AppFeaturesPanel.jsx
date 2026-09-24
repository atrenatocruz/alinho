// Interruptores que valem para a APP TODA (tabela feature_flags). Só a
// equipa Alinho (is_platform_admin) os vê, na página principal do Gerir.
// Antes viviam nas Definições de um clube, o que fazia parecer que só
// mudavam esse clube (Francisco, 19 set 2026: "Isso não pode estar aí").
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Power } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { describeError } from '../lib/errors'
import { Toggle } from './lessons/LessonBits'

export default function AppFeaturesPanel() {
  const { t } = useTranslation()
  const { isPrivateMatchesEnabled, isLessonsFlagOn, refreshFeatureFlags } = useAuth()
  const [saving, setSaving] = useState(false)

  const togglePrivateMatches = async () => {
    const next = !isPrivateMatchesEnabled
    if (!next && !confirm(t('gerir.private_matches_off_confirm'))) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('admin_set_feature_flag', { p_key: 'private_matches', p_enabled: next })
      if (error) throw error
      await refreshFeatureFlags()
    } catch (error) {
      console.error('Error toggling private matches flag:', error)
      alert(describeError(t, error, 'gerirclube.error_toggle_feature'))
    } finally {
      setSaving(false)
    }
  }

  // Aulas: ligar mostra-as a toda a gente; desligadas, so a equipa Alinho
  // as ve. Precisa da linha 'lessons' na tabela (migration_feature_flag_lessons.sql).
  const toggleLessons = async () => {
    const next = !isLessonsFlagOn
    setSaving(true)
    try {
      const { error } = await supabase.rpc('admin_set_feature_flag', { p_key: 'lessons', p_enabled: next })
      if (error) throw error
      await refreshFeatureFlags()
    } catch (error) {
      console.error('Error toggling lessons flag:', error)
      alert(describeError(t, error, 'gerirclube.error_toggle_feature'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted flex items-center gap-1.5">
        <Power size={13} /> {t('gerirclube.app_features_heading')}
      </p>
      <div className="card">
        <p className="text-sm text-muted">{t('gerir.app_features_description')}</p>
        <Toggle
          label={
            <span>
              <span className="block font-extrabold text-ink-900">{t('gerirclube.private_matches_label')}</span>
              <span className="block text-[11px] text-muted">
                {isPrivateMatchesEnabled ? t('gerir.private_matches_on_hint') : t('gerir.private_matches_off_hint')}
              </span>
            </span>
          }
          checked={isPrivateMatchesEnabled}
          disabled={saving}
          onChange={togglePrivateMatches}
        />
        <Toggle
          label={
            <span>
              <span className="block font-extrabold text-ink-900">{t('gerirclube.tab_lessons')}</span>
              <span className="block text-[11px] text-muted">
                {isLessonsFlagOn ? t('gerir.lessons_on_hint') : t('gerir.lessons_off_hint')}
              </span>
            </span>
          }
          checked={isLessonsFlagOn}
          disabled={saving}
          onChange={toggleLessons}
        />
      </div>
    </div>
  )
}
