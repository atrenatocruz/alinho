// Criar uma liga por passos (/gerir/:slug/criar/liga) — mockup «Criar liga».
// Passo 1: liga (nome, âmbito, distrito, prazo, máximo de clubes; a
// plataforma escolhe «Liga Alinho» aqui). Passo 2: categoria (com os valores
// por omissão). No fim: criar, gravar a categoria e publicar. O servidor
// valida tudo outra vez; aqui é para dizer o que falta antes de tentar.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StepPage from '../components/steps/StepPage'
import { Chips, PrimaryButton, Select } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { createLeague, saveCategory, publishLeague, leagueErrorMessage } from '../lib/leagueApi'
import { CATEGORY_DEFAULTS, categoryProblem } from '../lib/leagueConfig'
import { emptyCreateProgress, nextCreateStep } from '../lib/leagueCreate'
import { districtOptions } from '../lib/leagueDistricts'

const field = 'min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3.5 text-base'

export default function CreateLeaguePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { profile, memberships } = useAuth()
  // Cada membership traz a organização em `organization` (AuthContext).
  const memberOrg = memberships?.find((m) => m.organization?.slug === slug)?.organization
  // O superadmin escondido (18 out) já não tem inscrição nos grupos onde só
  // gere: o clube vem da tabela das organizações.
  const [adminOrg, setAdminOrg] = useState(null)
  useEffect(() => {
    if (memberOrg || !profile?.is_platform_admin || !slug) return undefined
    let alive = true
    supabase.from('organizations').select('*').eq('slug', slug).maybeSingle()
      .then(({ data }) => { if (alive) setAdminOrg(data || null) })
    return () => { alive = false }
  }, [memberOrg, profile?.is_platform_admin, slug])
  const org = memberOrg || adminOrg
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [league, setLeague] = useState({ kind: 'comunitaria', name: '', scope: 'local', district: org?.district || '', applicationsCloseAt: '', maxTeams: 8 })
  const [cat, setCat] = useState({ ...CATEGORY_DEFAULTS, gender: 'masculino', level: 4 })

  const leagueProblem = league.name.trim().length < 3 ? 'name_short' : null
  const catProblem = categoryProblem(cat)
  // «Comunitária» é de um clube: sem o clube (ainda a carregar, ou sem acesso), não há onde a pôr.
  const noOrg = league.kind === 'comunitaria' && !org?.id

  // O que já ficou feito no servidor: uma nova tentativa continua daí, não cria outra liga.
  const progress = useRef(emptyCreateProgress())
  const [createdSlug, setCreatedSlug] = useState(null)

  const finish = async () => {
    setBusy(true); setError('')
    try {
      const pr = progress.current
      if (nextCreateStep(pr) === 'create') {
        const created = await createLeague({
          kind: league.kind, ownerOrgId: league.kind === 'comunitaria' ? org?.id : null, name: league.name.trim(), scope: league.scope,
          district: league.district || null, applicationsCloseAt: league.applicationsCloseAt ? new Date(league.applicationsCloseAt).toISOString() : null,
          maxTeams: league.maxTeams || null,
        })
        pr.league = { id: created.id, slug: created.slug }
        setCreatedSlug(created.slug)
      }
      if (nextCreateStep(pr) === 'category') { await saveCategory(pr.league.id, null, cat); pr.categoryDone = true }
      if (nextCreateStep(pr) === 'publish') { await publishLeague(pr.league.id); pr.published = true }
      navigate(`/liga/${pr.league.slug}`, { replace: true })
    } catch (e) { setError(leagueErrorMessage(t, e)) } finally { setBusy(false) }
  }

  const levelPrefix = cat.gender === 'feminino' ? 'F' : cat.gender === 'misto' ? 'MX' : 'M'

  if (step === 1) return (
    <StepPage title={t('league.create')} step={1} total={2} onBack={() => navigate(-1)}
      onNext={() => setStep(2)} nextDisabled={!!leagueProblem || noOrg}
      nextHint={leagueProblem ? t(`league.create_${leagueProblem}`) : null}>
      <div className="space-y-6">
        {profile?.is_platform_admin && (
          <Chips label={t('league.create_kind_label')} value={league.kind} onChange={(v) => setLeague({ ...league, kind: v })}
            options={[{ value: 'comunitaria', label: t('league.kind_comunitaria') }, { value: 'alinho', label: t('league.kind_alinho') }]} />
        )}
        <input className={field} aria-label={t('league.create_name_ph')} placeholder={t('league.create_name_ph')} value={league.name} maxLength={80}
          onChange={(e) => setLeague({ ...league, name: e.target.value })} />
        <Chips label={t('league.create_scope')} value={league.scope} onChange={(v) => setLeague({ ...league, scope: v })}
          options={['local', 'regional', 'nacional'].map((v) => ({ value: v, label: t(`league.scope_${v}`) }))} />
        <label className="block text-sm font-bold">
          <span className="mb-2 block">{t('gerirclube.district_label')}</span>
          <Select value={league.district} onChange={(v) => setLeague({ ...league, district: v })} options={districtOptions(t('gerirclube.district_none'))} />
        </label>
        <label className="block text-sm font-bold">{t('league.create_apps_until')}
          <input type="datetime-local" className={`${field} mt-2`} value={league.applicationsCloseAt} onChange={(e) => setLeague({ ...league, applicationsCloseAt: e.target.value })} />
        </label>
        <label className="block text-sm font-bold">{t('league.create_max_clubs')}
          <input inputMode="numeric" className={`${field} mt-2`} value={league.maxTeams ?? ''}
            onChange={(e) => setLeague({ ...league, maxTeams: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} />
        </label>
      </div>
    </StepPage>
  )

  return (
    <StepPage title={t('league.create_category_title')} step={2} total={2} onBack={() => setStep(1)}
      onNext={finish} nextLabel={t('league.create')} nextDisabled={!!catProblem}
      nextHint={catProblem ? t(`league.error_${catProblem}`, t('league.error_generic')) : null} error={error} busy={busy}>
      <div className="space-y-6">
        <Chips label={t('league.create_who')} value={cat.gender} onChange={(v) => setCat({ ...cat, gender: v })}
          options={['masculino', 'feminino', 'misto'].map((v) => ({ value: v, label: t(`league.gender_${v}`) }))} />
        <Chips label={t('league.create_level')} value={cat.level} onChange={(v) => setCat({ ...cat, level: v })}
          options={[6, 5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${levelPrefix}${n}` }))} />
        <Chips label={t('league.create_matches')} value={cat.matches_per_encounter}
          onChange={(v) => setCat({ ...cat, matches_per_encounter: v, roster_max: Math.max(cat.roster_max, v * 2) })}
          options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} />
        <Chips label={t('league.create_home_away')} value={cat.home_away} onChange={(v) => setCat({ ...cat, home_away: v })}
          options={[{ value: false, label: t('league.one_leg') }, { value: true, label: t('league.create_home_away') }]} />
        {createdSlug && error && (
          <PrimaryButton variant="ghost" className="w-full" onClick={() => navigate(`/liga/${createdSlug}/gerir`)}>{t('league.open_draft')}</PrimaryButton>
        )}
        <p className="text-[13px] text-ink-500">
          {t('league.create_points_summary', { win: cat.points_win, draw: cat.points_draw, loss: cat.points_loss, walkover: cat.points_walkover, lock: cat.roster_locks_at_round })}
        </p>
      </div>
    </StepPage>
  )
}
