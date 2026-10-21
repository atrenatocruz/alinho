import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, RatingBadge, Select } from '../components/ui'
import { MIN_SIGNUP_AGE, ADULT_AGE, isAtLeast, maxSignupBirthday } from '../lib/age'
import Alino from '../components/Alino'
import { ONBOARDING_LEVELS } from '../lib/elo'
import { countryOptions } from '../lib/countries'
import { describeError } from '../lib/errors'

/* ════════════════════════════════════════════════════════════════════════
   Auto-classificação no primeiro registo (Elo v1, RANKING.md).

   Ecrã bloqueante mostrado UMA vez, apenas a contas novas
   (profiles.rating_onboarded_at === null — ver Guard em App.jsx). Define
   os pontos de entrada no ranking, do nível 1 (1900) a Iniciante (600) —
   Trello #288, migration_elo_entry_levels.sql. A âncora é a peça que calibra o grupo na escala do desporto — o
   Elo só ordena — por isso a escolha é explícita e não tem default.
   Contas antigas nunca passam por aqui (marcadas na migração).

   Por passos, uma pergunta de cada vez (Renato, 21 out — a versão B dos
   mockups): nível → sobre ti (só se faltar género ou data, contas Google)
   → lado → nacionalidade. O passo vai no URL (?passo=2), para o «voltar»
   do navegador e do Android recuar um passo em vez de sair do ecrã.
   ════════════════════════════════════════════════════════════════════════ */

// Os países mais prováveis à cabeça da lista, antes de se escrever.
const POPULAR_COUNTRIES = ['PT', 'BR', 'ES', 'FR', 'GB', 'AO']
const LOCALES = { pt: 'pt-PT', en: 'en-GB' }
const pad = (n) => String(n).padStart(2, '0')
const daysInMonth = (year, month) => new Date(year || 2000, month, 0).getDate()

function CheckDot() {
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink-900" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-4.9" fill="none" stroke="#C5DD01" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  )
}

// Meio campo visto de cima, com o lado escolhido a preto.
function CourtSide({ side, on }) {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="54" height="38" rx="4" fill={side === 'both' ? '#040404' : '#F4F5F1'} stroke={side === 'both' ? '#040404' : '#CFD2D7'} />
      {side === 'left' && <rect x="1" y="1" width="27" height="38" rx="4" fill="#040404" />}
      {side === 'right' && <rect x="28" y="1" width="27" height="38" rx="4" fill="#040404" />}
      <line x1="28" y1="1" x2="28" y2="39" stroke={side === 'both' && on ? '#C5DD01' : '#CFD2D7'} strokeWidth="1.5" />
    </svg>
  )
}

const tileClass = (on) =>
  `press w-full rounded-[14px] border-2 bg-white text-left shadow-card transition-colors duration-fast ${
    on ? 'border-ink-900' : 'border-transparent [@media(hover:hover)]:hover:border-line'
  }`

export default function EscolherNivel() {
  const { t, i18n } = useTranslation()
  const { user, profile, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState(null)
  // Nacionalidade (Trello #191): oferecida aqui, na criacao do perfil, mas
  // NUNCA obrigatoria — o ultimo passo tem «Saltar».
  const [nationality, setNationality] = useState('')
  const [countryQuery, setCountryQuery] = useState('')
  // Género: obrigatório quando o perfil ainda não o tem — é o caso das
  // contas Google, que não passam pelo formulário de registo (Ruben, 29 set).
  // O rating tem prefixo M/F e os rankings separam por género; sem isto a
  // conta ficava como "N" para sempre.
  const needsGender = profile?.gender == null
  const [gender, setGender] = useState('')
  // Lado preferido: obrigatório para todas as contas novas (Ruben, 29 set).
  // O perfil nasce com 'both' por omissão, por isso não se pode inferir da
  // base se a pessoa escolheu — pede-se aqui, sem pré-seleção, e a
  // formação de duplas dos mixes passa a ter o dado desde o primeiro dia.
  const [side, setSide] = useState('')
  // Data de nascimento: as contas Google chegam sem ela. É obrigatória
  // (idade mínima 13, Lei 58/2019) e decide se a conta nasce privada.
  // Escolhe-se em três blocos (dia / mês / ano), cada um com a sua folha.
  const needsBirthday = profile?.birthday == null
  const [bDay, setBDay] = useState(null)
  const [bMonth, setBMonth] = useState(null)
  const [bYear, setBYear] = useState(null)
  const birthday = bDay && bMonth && bYear ? `${bYear}-${pad(bMonth)}-${pad(bDay)}` : ''
  const birthdayTooYoung = needsBirthday && birthday && !isAtLeast(birthday, MIN_SIGNUP_AGE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const locale = LOCALES[i18n.language] || 'pt-PT'
  const steps = useMemo(
    () => ['level', ...(needsGender || needsBirthday ? ['about'] : []), 'side', 'nationality'],
    [needsGender, needsBirthday],
  )
  const stepDone = {
    level: !!selected,
    about: (!needsGender || !!gender) && (!needsBirthday || (!!birthday && !birthdayTooYoung)),
    side: !!side,
    nationality: true,
  }
  // Não se salta para um passo sem os anteriores feitos (um recarregar a
  // meio perde as escolhas e volta ao primeiro que falta).
  const firstOpen = steps.findIndex((s) => !stepDone[s])
  const requested = Math.max(0, (Number(searchParams.get('passo')) || 1) - 1)
  const index = Math.min(requested, steps.length - 1, firstOpen === -1 ? steps.length - 1 : firstOpen)
  const step = steps[index]
  const isLast = index === steps.length - 1

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [index])

  const yearOptions = useMemo(() => {
    const top = Number(maxSignupBirthday().slice(0, 4))
    return Array.from({ length: top - 1929 }, (_, i) => ({ value: top - i, label: String(top - i) }))
  }, [])
  const monthOptions = useMemo(() => {
    // Por extenso na lista, abreviado no bloco («out»), que é estreito.
    const long = new Intl.DateTimeFormat(locale, { month: 'long' })
    const short = new Intl.DateTimeFormat(locale, { month: 'short' })
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: long.format(new Date(2000, i, 1)),
      short: short.format(new Date(2000, i, 1)).replace('.', ''),
    }))
  }, [locale])
  const dayOptions = useMemo(
    () => Array.from({ length: daysInMonth(bYear, bMonth || 1) }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [bYear, bMonth],
  )
  // Mudar o mês ou o ano nunca deixa um 31 de fevereiro escolhido.
  const pickMonth = (m) => { setBMonth(m); if (bDay) setBDay(Math.min(bDay, daysInMonth(bYear, m))) }
  const pickYear = (y) => { setBYear(y); if (bDay && bMonth) setBDay(Math.min(bDay, daysInMonth(y, bMonth))) }

  const allCountries = countryOptions(i18n.language)
  const countryList = useMemo(() => {
    const q = countryQuery.trim().toLocaleLowerCase(locale).normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (q) {
      return allCountries
        .filter((c) => c.label.toLocaleLowerCase(locale).normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
        .slice(0, 8)
    }
    const codes = nationality && !POPULAR_COUNTRIES.includes(nationality) ? [nationality, ...POPULAR_COUNTRIES] : POPULAR_COUNTRIES
    return codes.map((code) => allCountries.find((c) => c.value === code)).filter(Boolean)
  }, [countryQuery, allCountries, nationality, locale])

  const goNext = () => {
    if (!stepDone[step]) return
    setSearchParams({ passo: String(index + 2) })
  }

  const handleConfirm = async ({ skipNationality = false } = {}) => {
    if (firstOpen !== -1 || saving) return
    setSaving(true)
    setError('')
    try {
      // Género e lado primeiro: se falhar, o nível ainda não ficou gravado
      // e o utilizador volta a este ecrã inteiro em vez de ficar sem eles.
      // Menores (13–17): perfil privado por omissão — quem quiser segui-los
      // pede primeiro. Podem mudar depois em Perfil.
      const effectiveBirthday = needsBirthday ? birthday : profile?.birthday
      const minor = effectiveBirthday && !isAtLeast(effectiveBirthday, ADULT_AGE)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          preferred_side: side,
          ...(needsGender ? { gender } : {}),
          ...(needsBirthday ? { birthday } : {}),
          ...(minor ? { is_private: true } : {}),
        })
        .eq('id', user.id)
      if (profileError) throw profileError
      const { error: rpcError } = await supabase.rpc('complete_rating_onboarding', {
        p_level: selected,
      })
      if (rpcError) throw rpcError
      // Gravada a parte, com um update normal ao proprio perfil, em vez de
      // estender complete_rating_onboarding — a RLS ja permite a cada um
      // escrever o seu perfil, e assim nao ha migracao de funcao nenhuma.
      // Falhar aqui nao pode prender o utilizador fora da app: o nivel ja
      // ficou gravado e a nacionalidade e opcional.
      if (nationality && !skipNationality) {
        const { error: natError } = await supabase
          .from('profiles')
          .update({ nationality })
          .eq('id', user.id)
        if (natError) console.error('Error saving nationality on onboarding:', natError)
      }
      // Re-lê o perfil — rating_onboarded_at deixa de ser null e o Guard
      // deixa-nos entrar na app.
      await refreshMemberships()
      // O ?passo= não fica pendurado no URL da página para onde se entra.
      setSearchParams({}, { replace: true })
    } catch (err) {
      console.error('Error completing rating onboarding:', err)
      setError(describeError(t, err, 'onboarding.save_failed_retry'))
      setSaving(false)
    }
  }

  if (!user) return null

  const progress = `${((index + 1) / steps.length) * 100}%`

  return (
    <div className="min-h-screen bg-ground flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
      <div className="w-full max-w-md flex flex-col">
        {/* Topo: voltar · progresso · saltar (só no último, que é opcional). */}
        <div className="flex h-11 items-center gap-3">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t('common.back')}
              className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-900 active:bg-ink-50"
            >
              <ChevronLeft size={24} strokeWidth={2.4} />
            </button>
          ) : (
            <span className="w-2" aria-hidden="true" />
          )}
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E2E4DE]"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-label={t('onboarding.step_of', { n: index + 1, total: steps.length })}
          >
            <div className="h-full rounded-full bg-ink-900 transition-[width] duration-300 ease-out" style={{ width: progress }} />
          </div>
          {isLast ? (
            <button
              type="button"
              onClick={() => handleConfirm({ skipNationality: true })}
              disabled={saving}
              className="-mr-1 min-h-[44px] px-1 text-sm font-extrabold text-ink-900 disabled:opacity-40"
            >
              {t('onboarding.skip')}
            </button>
          ) : (
            <span className="w-2" aria-hidden="true" />
          )}
        </div>

        {/* Cabeçalho do passo. */}
        <div className="mt-5 mb-5 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
              {t('onboarding.step_of', { n: index + 1, total: steps.length })}
              {step === 'nationality' && ` · ${t('onboarding.optional')}`}
            </p>
            <h1 className="font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.015em] text-ink-900 [text-wrap:balance]">
              {t(`onboarding.${step}_heading`)}
            </h1>
            {step !== 'about' && (
              <p className="mt-1.5 text-sm text-ink-500">{t(`onboarding.${step}_lead`)}</p>
            )}
          </div>
          {/* O Alino a dar as boas-vindas no primeiro passo e «pronto» no
              último — pequeno, para não empurrar as escolhas para baixo. */}
          {step === 'level' && <Alino pose="ola" size={92} className="-mb-1 shrink-0" />}
          {step === 'nationality' && <Alino pose="pronto" size={84} className="-mb-1 shrink-0" />}
        </div>

        <div className="flex-1 pb-36">
          {step === 'level' && (
            <div className="space-y-1.5">
              {ONBOARDING_LEVELS.map((level) => {
                const on = selected === level.key
                return (
                  <button
                    key={level.key}
                    type="button"
                    onClick={() => setSelected(level.key)}
                    aria-pressed={on}
                    className={`${tileClass(on)} block px-3.5 ${on ? 'py-3' : 'py-2.5'}`}
                  >
                    <span className="flex min-h-[28px] items-center gap-2.5">
                      <RatingBadge rating={level.points} gender={profile?.gender || gender || undefined} me={on} />
                      <span className="flex-1 font-display text-base font-bold text-ink-900">
                        {level.num ? t('onboarding.level_title', { num: level.num }) : t('onboarding.level_iniciante_title')}
                      </span>
                      <span className={`font-display text-base tabular-nums ${on ? 'font-extrabold text-ink-900' : 'font-bold text-ink-500'}`}>
                        {level.points}
                      </span>
                      {on && <CheckDot />}
                    </span>
                    {on && (
                      <span className="mt-1.5 block text-[13px] leading-snug text-ink-700">{t(level.descriptionKey)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {step === 'about' && (
            <div className="space-y-7">
              {needsGender && (
                <section>
                  <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">{t('login.gender_label')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { value: 'masculino', label: t('login.gender_male') },
                      { value: 'feminino', label: t('login.gender_female') },
                    ].map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => setGender(g.value)}
                        aria-pressed={gender === g.value}
                        className={`${tileClass(gender === g.value)} flex min-h-[60px] items-center justify-between px-4 font-display text-lg font-bold text-ink-900`}
                      >
                        {g.label}
                        {gender === g.value && <CheckDot />}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-ink-500">{t('onboarding.gender_hint')}</p>
                </section>
              )}

              {needsBirthday && (
                <section>
                  <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">{t('login.birthday_label')}</p>
                  <div className="grid grid-cols-[1fr_1.2fr_1.4fr] gap-2.5">
                    <Select variant="tile" label={t('onboarding.birthday_day')} active={!!bDay} value={bDay} onChange={setBDay} options={dayOptions} placeholder="—" title={t('onboarding.birthday_day')} />
                    <Select variant="tile" label={t('onboarding.birthday_month')} active={!!bMonth} value={bMonth} onChange={pickMonth} options={monthOptions} placeholder="—" title={t('onboarding.birthday_month')} />
                    <Select variant="tile" label={t('onboarding.birthday_year')} active={!!bYear} value={bYear} onChange={pickYear} options={yearOptions} placeholder="—" title={t('onboarding.birthday_year')} startAt={1995} />
                  </div>
                  {birthdayTooYoung ? (
                    <p className="mt-2 text-[13px] text-danger">{t('login.error_under_age', { age: MIN_SIGNUP_AGE })}</p>
                  ) : (
                    <p className="mt-2 text-[13px] leading-snug text-ink-500">{t('onboarding.birthday_hint', { age: MIN_SIGNUP_AGE })}</p>
                  )}
                </section>
              )}
            </div>
          )}

          {step === 'side' && (
            <div className="space-y-2.5">
              {[
                { value: 'left', label: t('gamedetails.side_left'), sub: t('onboarding.side_left_sub') },
                { value: 'right', label: t('gamedetails.side_right'), sub: t('onboarding.side_right_sub') },
                { value: 'both', label: t('gamedetails.side_both'), sub: t('onboarding.side_both_sub') },
              ].map((s) => {
                const on = side === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSide(s.value)}
                    aria-pressed={on}
                    className={`${tileClass(on)} flex items-center gap-4 rounded-card px-4 py-3.5`}
                  >
                    <CourtSide side={s.value} on={on} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-display text-lg font-bold text-ink-900">{s.label}</span>
                      <span className="text-[13px] text-ink-500">{s.sub}</span>
                    </span>
                    {on && <CheckDot />}
                  </button>
                )
              })}
            </div>
          )}

          {step === 'nationality' && (
            <div>
              <label className="mb-3 flex h-12 items-center gap-2.5 rounded-full bg-white px-4 shadow-card focus-within:ring-2 focus-within:ring-ink-900">
                <Search size={17} className="shrink-0 text-ink-500" aria-hidden="true" />
                <span className="sr-only">{t('onboarding.nationality_search')}</span>
                <input
                  type="search"
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  placeholder={t('onboarding.nationality_search')}
                  className="min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-500"
                />
              </label>
              <div className="rounded-card bg-white p-1.5 shadow-card">
                {countryList.length === 0 ? (
                  <p className="px-3.5 py-3 text-sm text-ink-500">{t('ui.select_search_empty')}</p>
                ) : countryList.map((c) => {
                  const on = nationality === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => { setNationality(on ? '' : c.value); setCountryQuery('') }}
                      aria-pressed={on}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-ctrl px-3.5 text-left text-base transition-colors duration-fast ${
                        on ? 'bg-lime-100 font-extrabold' : 'font-medium [@media(hover:hover)]:hover:bg-ink-50'
                      } text-ink-900`}
                    >
                      <span className={`w-8 rounded-md py-0.5 text-center font-mono text-[11px] ${on ? 'bg-ink-900 text-lime-400' : 'bg-ink-50 text-ink-700'}`}>
                        {c.value}
                      </span>
                      <span className="flex-1 truncate">{c.label}</span>
                      {on && <CheckDot />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Botão fixo em baixo, acima da área segura. */}
        <div className="fixed inset-x-0 bottom-0 z-10 flex justify-center bg-ground px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <div className="w-full max-w-md">
            {error && <p className="mb-3 text-center text-sm text-danger">{error}</p>}
            {isLast ? (
              <PrimaryButton onClick={() => handleConfirm()} disabled={firstOpen !== -1 || saving} className="w-full">
                {saving ? t('onboarding.saving') : t('onboarding.confirm')}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={goNext} disabled={!stepDone[step]} className="w-full">
                {t('onboarding.continue')}
              </PrimaryButton>
            )}
            {isLast && (
              <p className="mt-2.5 text-center text-[11px] text-ink-500">{t('onboarding.footnote')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
