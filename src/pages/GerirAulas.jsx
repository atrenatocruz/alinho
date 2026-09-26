// Gerir › Clube › «Aulas ›» (#342, versão final de 26 set; entrada acertada
// com a designer no mesmo dia). Uma página própria com Professores · Turmas ·
// Preços. Os preços saíram do fundo de Gerir › Clube para aqui; as turmas e
// os professores continuam também em Eventos e em Pessoas.
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { getClubProfile } from '../lib/clubProfile'
import { getClubLessonSettings, listClubTeachers } from '../lib/lessonsApi'
import { Tabs } from '../components/ui'
import { ClubTeachers, Prices } from '../components/lessons/ClubLessonsPanel'
import ClubSeriesPanel from '../components/lessons/ClubSeriesPanel'

const TABS = ['teachers', 'series', 'prices']

export default function GerirAulas() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack(`/gerir/${slug}?tab=settings`)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'teachers'
  const [org, setOrg] = useState(null)
  const [teachers, setTeachers] = useState([])
  const [settings, setSettings] = useState({ prices: [], peakHours: [] })

  useEffect(() => {
    let alive = true
    getClubProfile(slug)
      .then(async (club) => {
        if (!alive || !club?.id) return
        setOrg(club)
        const [rows, res] = await Promise.all([listClubTeachers(club.id), getClubLessonSettings(club.id)])
        if (alive) { setTeachers(rows); setSettings(res) }
      })
      .catch((err) => console.error('Error loading lessons page:', err))
    return () => { alive = false }
  }, [slug])

  return (
    <div className="mx-auto max-w-lg pb-28">
      <button type="button" onClick={goBack} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700">
        <ArrowLeft size={20} /> {t('lessons.back_to_gerir')}
      </button>
      <h2 className="mt-2 text-3xl text-ink-900">{t('lessons.page_title')}</h2>

      <div className="mt-6">
        <Tabs
          label={t('lessons.page_title')}
          value={tab}
          onChange={(v) => setSearchParams({ tab: v }, { replace: true })}
          options={[
            { value: 'teachers', label: t('lessons.tab_teachers') },
            { value: 'series', label: t('lessons.tab_series') },
            { value: 'prices', label: t('lessons.tab_prices') },
          ]}
        />
      </div>

      {org && (
        <div className="mt-6">
          {tab === 'teachers' && <ClubTeachers organizationId={org.id} />}
          {tab === 'series' && (
            <ClubSeriesPanel organizationId={org.id} teachers={teachers} prices={settings.prices} peakHours={settings.peakHours}
              onCreate={() => navigate(`/gerir/${slug}/criar/turma`)} />
          )}
          {tab === 'prices' && <Prices organizationId={org.id} orgName={org.name} />}
        </div>
      )}
    </div>
  )
}
