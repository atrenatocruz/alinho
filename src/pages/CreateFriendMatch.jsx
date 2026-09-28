import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { Users, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createFriendMatch, updateFriendMatch, addFriendMatchInvitees, removeFriendMatchInvitee } from '../lib/privateMatches'
import { FORMAT_DB, formatKey } from '../components/friends/friendScoring'
import { listOrganizationMembers } from '../lib/clubProfile'
import { contemTexto } from '../lib/semAcentos'
import { PrimaryButton, DateTimeField, Chips } from '../components/ui'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { describeError } from '../lib/errors'
import StepPage from '../components/steps/StepPage'
import InviteesStep, { MIN_PEOPLE } from '../components/friends/InviteesStep'

/* `group` ({ id, slug, name }): o jogo de grupo — o mesmo desenho, com a
   pesquisa só entre os membros do grupo, e o jogo fica do grupo (ranking do
   grupo): create_friend_match com p_organization_id (Dev 3).
   `edit` ({ match, invitees, games } do get_friend_match): «Editar jogo entre
   amigos», os mesmos 4 passos (editar e juntar sets, aprovado a 27 set). */
const personFrom = (i) => ({
  key: i.invitee_id, inviteeId: i.invitee_id, user_id: i.user_id, name: i.name, avatar_url: i.avatar_url,
  guest: i.is_guest || i.status === 'guest',
})
const EDIT_ERRORS = ['not_allowed', 'format_locked', 'has_results', 'in_first_game', 'ranked_locked', 'teams_locked']

export default function CreateFriendMatch({ group = null, edit = null }) {
  const m = edit?.match
  const goBack = useGoBack(m ? `/jogos-privados/sessao/${m.id}` : group ? `/clube/${group.slug}/jogos` : '/jogos-privados')
  const { t } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Quatro passos, como todos os eventos (#342, versão final de 26 set):
  // Pessoas · Quando · Onde joga · Regras. Primeiro as pessoas, sem duplas —
  // podem ser mais de 4; as equipas fazem-se depois de todos aceitarem, na
  // página do jogo (base de dados do Dev 3: create_friend_match).
  const [step, setStep] = useState(1)
  const original = (edit?.invitees || []).filter((i) => !i.is_creator && i.status !== 'declined')
  const [people, setPeople] = useState(() => original.map(personFrom)) // sem o criador
  // No editar: quem já tem resultados não sai; com resultados, a forma de
  // contar não muda (a base de dados tranca com format_locked).
  const lockedKeys = edit ? new Set(original.filter((i) => i.has_results).map((i) => i.invitee_id)) : null
  const scoringLocked = !!edit?.games?.some((g) => g.score_a != null && g.score_b != null)

  // «Conta para o ranking?» e «Equipas» também no editar (27 set: «o editar
  // tem tudo o que o criar tem»). O ranking tranca quando algum jogo já
  // contou; as equipas quando já há resultados (base de dados do Dev 3).
  const [rankedIntent, setRankedIntent] = useState(m ? m.ranked_intent !== false : true)
  const rankingLocked = !!(m?.ranking_locked || edit?.games?.some((g) => g.counts))
  // «Dia e hora» num campo só, como no mix.
  const [when, setWhen] = useState(() => (m?.scheduled_date
    ? `${m.scheduled_date}T${String(m.scheduled_time || '').slice(0, 5)}` : '')) // 'YYYY-MM-DDTHH:mm'
  const scheduledDate = when.slice(0, 10)
  const scheduledTime = when.slice(11, 16)
  const [location, setLocation] = useState(m?.location || '')
  const [locationCoords, setLocationCoords] = useState({ latitude: m?.location_latitude ?? null, longitude: m?.location_longitude ?? null })
  const [court, setCourt] = useState(m?.court || '')
  // «Melhor de 3» vem escolhido (27 set); substitui o «N sets» fixo.
  const [format, setFormat] = useState(m ? formatKey(m.scoring_format, m.num_sets) : 'best3')
  const [teamsMode, setTeamsMode] = useState(m?.teams_mode || 'manual')
  // «Cada jogo dura» (27 set): 0 = sem tempo; só com mais de 4 pessoas.
  const [gameMinutes, setGameMinutes] = useState(m?.game_minutes || 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const locationInputRef = useRef(null)
  useGooglePlacesAutocomplete(locationInputRef, step === 3, ({ value, latitude, longitude }) => {
    setLocation(value)
    setLocationCoords({ latitude, longitude })
  })

  // Os membros do grupo, para a pesquisa (sem mim).
  const [members, setMembers] = useState([])
  useEffect(() => {
    if (!group?.id) return
    listOrganizationMembers(group.id)
      .then((data) => setMembers((data || []).filter((m) => m.id !== profile?.id)))
      .catch((err) => console.error('Error loading group members:', err))
  }, [group?.id, profile?.id])
  // Estável entre desenhos: a pesquisa do InviteesStep volta a correr quando
  // a função muda.
  const searchMembers = useCallback(async (q) => members.filter((m) => contemTexto(m.name, q)), [members])

  const hasGuest = people.some((p) => p.guest)
  const missing = Math.max(0, MIN_PEOPLE - (people.length + 1))

  const handleCreate = async () => {
    setError('')
    if (!scheduledDate) {
      setError(t('createprivatematch.error_date_required'))
      setStep(2)
      return
    }
    setSaving(true)
    try {
      const id = await createFriendMatch({
        rankedIntent,
        scheduledDate,
        scheduledTime: scheduledTime || null,
        location: location.trim() || null,
        locationLatitude: locationCoords.latitude,
        locationLongitude: locationCoords.longitude,
        court: court.trim() || null,
        scoringFormat: FORMAT_DB[format].scoringFormat,
        numSets: FORMAT_DB[format].numSets,
        teamsMode,
        organizationId: group?.id || null,
        gameMinutes: people.length + 1 > MIN_PEOPLE ? gameMinutes || null : null,
        invitees: people.map((p) => (p.guest
          ? { guest_name: p.name, ...(p.email ? { guest_email: p.email } : {}) }
          : { user_id: p.user_id })),
      })
      navigate(`/jogos-privados/sessao/${id}`)
    } catch (err) {
      console.error('Error creating friend match:', err)
      // As funções do Dev 3 recusam com a frase já escrita (P0001).
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err, 'createprivatematch.error_create'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    setError('')
    if (!scheduledDate) { setError(t('createprivatematch.error_date_required')); setStep(2); return }
    setSaving(true)
    try {
      const keep = new Set(people.map((p) => p.inviteeId).filter(Boolean))
      for (const i of original.filter((x) => !keep.has(x.invitee_id))) {
        // eslint-disable-next-line no-await-in-loop
        await removeFriendMatchInvitee(i.invitee_id)
      }
      const added = people.filter((p) => !p.inviteeId)
      if (added.length) {
        await addFriendMatchInvitees(m.id, added.map((p) => (p.guest
          ? { guest_name: p.name, ...(p.email ? { guest_email: p.email } : {}) }
          : { user_id: p.user_id })))
      }
      await updateFriendMatch(m.id, {
        scheduledDate,
        scheduledTime: scheduledTime || null,
        location: location.trim() || null,
        locationLatitude: locationCoords.latitude,
        locationLongitude: locationCoords.longitude,
        court: court.trim() || null,
        gameMinutes: people.length + 1 > MIN_PEOPLE ? gameMinutes || null : null,
        ...FORMAT_DB[format],
        // Só vão quando mudam (a função recusa com o cadeado).
        rankedIntent: rankedIntent !== (m.ranked_intent !== false) ? rankedIntent : undefined,
        teamsMode: teamsMode !== (m.teams_mode || 'manual') ? teamsMode : undefined,
      })
      navigate(`/jogos-privados/sessao/${m.id}`)
    } catch (err) {
      console.error('Error editing friend match:', err)
      const code = EDIT_ERRORS.find((k) => String(err?.message || '').includes(k))
      setError(code ? t(`friends.edit_error_${code}`) : describeError(t, err))
    } finally {
      setSaving(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  // «Equipas» e «Conta para o ranking?»: os mesmos no criar e no editar.
  // No editar, com cadeado e a razão à vista (SPEC amigos-por-rondas, fim).
  const teamsLocked = !!edit && scoringLocked
  const teamsBlock = (
    <div>
      <p className={label}>{t('friends.teams_label')}</p>
      <div className={teamsLocked ? 'pointer-events-none opacity-50' : ''} aria-disabled={teamsLocked || undefined}>
        <Chips
          value={teamsMode}
          onChange={setTeamsMode}
          options={[
            { value: 'manual', label: t('friends.teams_me_later') },
            { value: 'app', label: t('friends.teams_app') },
          ]}
        />
      </div>
      {teamsLocked ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Lock size={12} className="mt-0.5 shrink-0 text-warning" /> {t('friends.teams_locked_hint')}
        </p>
      ) : <p className="mt-2 text-xs text-muted">{t('friends.teams_app_hint')}</p>}
    </div>
  )
  const rankedLocked = !!edit && rankingLocked
  const rankedBlock = (
    <div>
      <p className={label}>{t('steps.ranking_heading')}</p>
      <div className={rankedLocked ? 'pointer-events-none opacity-50' : ''} aria-disabled={rankedLocked || undefined}>
        <Chips
          value={rankedIntent}
          onChange={setRankedIntent}
          options={[
            { value: true, label: t('steps.ranking_yes') },
            { value: false, label: t('steps.ranking_friendly') },
          ]}
        />
      </div>
      {/* A regra é jogo a jogo (base de dados): um jogo com um convidado
          sem conta não conta, os outros da sessão contam — e quem
          criar conta pelo convite passa a contar (QA/PO, 27 set). */}
      {rankedLocked ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Lock size={12} className="mt-0.5 shrink-0 text-warning" /> {t('friends.ranked_locked_hint')}
        </p>
      ) : edit ? <p className="mt-2 text-xs text-muted">{t('friends.ranked_edit_hint')}</p>
        : rankedIntent && hasGuest && <p className="mt-2 text-xs text-muted">{t('friends.ranked_hint_guests')}</p>}
    </div>
  )

  // «Cada jogo dura» — no criar depois da forma de contar, no editar antes
  // (os dois desenhos de 27 set). Com 4 não roda, por isso não aparece.
  const durationBlock = people.length + 1 > MIN_PEOPLE && (
    <div>
      <p className={label}>{t('friends.game_minutes_label')}</p>
      <Chips
        value={gameMinutes}
        onChange={setGameMinutes}
        options={[
          { value: 0, label: t('friends.game_minutes_none') },
          ...[15, 20, 30].map((n) => ({ value: n, label: t('friends.game_minutes_option', { count: n }) })),
        ]}
      />
      <p className="mt-2 text-xs text-muted">{edit && edit.games?.length ? t('friends.game_minutes_edit_hint') : t('friends.game_minutes_hint')}</p>
    </div>
  )

  const stepLabels = [t('steps.people'), t('steps.when'), t('steps.where'), t('steps.rules')]

  return (
    <StepPage
      title={edit ? t('friends.edit_title') : group ? t('creategroupmatch.title_new') : t('createprivatematch.title_new')}
      subtitle={!edit && group ? t('creategroupmatch.in_group', { group: group.name }) : null}
      step={step}
      total={4}
      stepLabel={stepLabels[step - 1]}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(step - 1) }}
      onNext={() => { setError(''); setStep(step + 1) }}
      nextDisabled={(step === 1 && missing > 0) || (step === 2 && !scheduledDate)}
      nextHint={step === 1 ? t('friends.missing_people', { count: missing }) : t('createprivatematch.date_missing')}
      error={error}
      footer={step === 4 ? (edit ? (
        <PrimaryButton onClick={handleSave} disabled={saving} className="w-full">
          {saving ? t('privatematches.saving') : t('friends.save_changes')}
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={handleCreate} disabled={saving} className="w-full">
          <Users size={18} />
          {saving ? t('createprivatematch.creating') : t('createprivatematch.create_and_invite')}
        </PrimaryButton>
      )) : null}
    >
      {step === 1 && (
        <InviteesStep
          {...(group ? { searchFn: searchMembers, searchPlaceholder: t('friends.search_group_placeholder') } : {})}
          me={profile}
          people={people}
          {...(edit ? { lockedKeys, collapsedSearch: true } : {})}
          onAdd={(p) => setPeople((list) => (list.some((x) => x.key === p.key) ? list : [...list, p]))}
          onRemove={(key) => setPeople((list) => list.filter((x) => x.key !== key))}
        />
      )}

      {step === 2 && (
        <div>
          <p className={label}>{t('steps.datetime_label')}</p>
          <DateTimeField value={when} onChange={setWhen} />
          <p className="mt-2 text-xs text-muted">{t('createprivatematch.when_hint')}</p>
        </div>
      )}

      {step === 3 && (
        <>
          <div>
            <p className={label}>{t('steps.where_label')}</p>
            <input
              ref={locationInputRef}
              type="text"
              value={location}
              // Escrever a morada à mão invalida as coordenadas — ficariam a
              // apontar para o sítio escolhido antes (mesmo cuidado que
              // GerirClube.jsx tem para o local dos mixes).
              onChange={(e) => { setLocation(e.target.value); setLocationCoords({ latitude: null, longitude: null }) }}
              placeholder={t('friends.where_placeholder')}
              className="input-field"
            />
          </div>
          <div>
            <p className={label}>{t('friends.court_label')}</p>
            <input type="text" value={court} onChange={(e) => setCourt(e.target.value)} maxLength={40}
              placeholder={t('friends.court_placeholder')} className="input-field" />
          </div>
        </>
      )}

      {step === 4 && (
        <>
          {!edit && (<>
          {teamsBlock}
          {rankedBlock}
          </>)}
          {edit && durationBlock}
          <div>
            <p className={label}>{t('steps.how_counted')}</p>
            <div className={scoringLocked ? 'pointer-events-none opacity-50' : ''} aria-disabled={scoringLocked || undefined}>
              <Chips
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'best3', label: t('friends.format_best3') },
                  { value: 'free', label: t('friends.format_free') },
                  { value: 'points', label: t('createprivatematch.format_points') },
                ]}
              />
            </div>
            {format !== 'points' && <p className="mt-2 text-xs text-muted">{t(`friends.format_${format}_hint`)}</p>}
            {scoringLocked && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <Lock size={12} className="mt-0.5 shrink-0 text-warning" /> {t('friends.format_locked_hint')}
              </p>
            )}
          </div>
          {edit && teamsBlock}
          {edit && rankedBlock}
          {!edit && durationBlock}
        </>
      )}
    </StepPage>
  )
}
