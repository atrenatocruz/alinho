// O caminho do organizador até ao sorteio (Trello #364, «Torneio 4/6»).
// Desenho: «Fechar inscrições · M5», «Formato · M5», «Sortear · M4»,
// «Sorteio · por confirmar» e «Sorteio feito · M4».
//
// Três passos, um de cada vez, por categoria — é como o organizador pensa:
// primeiro sei quem entra, depois escolho o formato, depois sorteio. Em
// cada passo a app PROPÕE e o organizador confirma; nada acontece sozinho.
//
// O sorteio só se grava quando ele carrega em «Confirmar»: até lá pode
// mover duplas, trocar cabeças de série e voltar a sortear à vontade.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Shuffle, Check, AlertTriangle, RefreshCw, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PrimaryButton, EmptyState, ConfirmSheet } from '../ui'
import { MonoLabel, StatePill } from './TournamentBits'
import {
  listCategoriesAdmin, listCategorySeeding, closeCategoryEntries,
  saveCategoryFormat, drawCategory, clearCategoryDraw, buildDrawPayload, buildKnockoutPayload,
} from '../../lib/tournamentDraw'
import { formatOptions, recommendFormat, availableCourtHours, pickSeeds } from '../../lib/tournamentFormat'

const euros = (c) => (c == null ? null : `${(c / 100).toFixed(0)} €`)

/* ── Passo 1: quem entra ────────────────────────────────────────────────
   Chega quase sempre mais gente do que lugares. O organizador escolhe, e
   quem fica de fora fica SUPLENTE por ordem — não se apaga ninguém. */
function CloseEntriesStep({ category, onDone, t }) {
  const [rows, setRows] = useState(null)
  const [chosen, setChosen] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listCategorySeeding(category.id)
      .then((data) => {
        if (cancelled) return
        setRows(data)
        // A app propõe: os primeiros pelos pontos, até encher as vagas.
        const limit = category.slots || data.length
        setChosen(data.slice(0, limit).map((r) => r.entry_id))
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [category.id, category.slots])

  const toggle = (id) => setChosen((list) =>
    (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const close = async () => {
    setBusy(true)
    setError(null)
    try {
      const waitlist = rows.filter((r) => !chosen.includes(r.entry_id)).map((r) => r.entry_id)
      await closeCategoryEntries(category.id, chosen, waitlist)
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !rows) return <p className="py-6 text-center text-[12px] text-danger">{error}</p>
  if (!rows) return <p className="py-6 text-center text-[12px] text-muted">{t('common.loading')}</p>
  if (!rows.length) {
    return <EmptyState icon={AlertTriangle} title={t('tournament.draw.close_nobody_title')}
      subtitle={t('tournament.draw.close_nobody_subtitle')} />
  }

  const over = category.slots ? chosen.length > category.slots : false

  return (
    <div>
      <p className="mb-2 text-[12.5px] text-ink-700">
        {t('tournament.draw.close_intro', { teams: rows.length, slots: category.slots || rows.length })}
      </p>

      <div className="mb-2 overflow-hidden rounded-xl border border-ink-100 bg-white">
        {rows.map((row, i) => {
          const inside = chosen.includes(row.entry_id)
          return (
            <button
              key={row.entry_id}
              type="button"
              onClick={() => toggle(row.entry_id)}
              className={`flex w-full items-center gap-2 border-t border-ink-50 px-3 py-2 text-left first:border-t-0 ${inside ? '' : 'bg-ink-50/60'}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${inside ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-transparent'}`}>
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink-900">{row.name}</span>
                <span className="font-mono text-[10px] text-muted">
                  {row.points_incomplete
                    ? t('tournament.draw.points_unknown')
                    : t('tournament.draw.points', { n: row.points })}
                </span>
              </span>
              {!inside && (
                <span className="shrink-0 font-mono text-[10px] text-[#B86E00]">
                  {t('tournament.draw.waitlist_tag')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {over && (
        <p className="mb-2 text-[11.5px] text-danger">
          {t('tournament.draw.close_over', { slots: category.slots, chosen: chosen.length })}
        </p>
      )}
      <p className="mb-2 text-[11px] text-muted">{t('tournament.draw.close_waitlist_note')}</p>
      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}

      <PrimaryButton onClick={close} disabled={busy || over || !chosen.length}>
        {t('tournament.draw.close_confirm', { teams: t('tournament.n.teams', { count: chosen.length }) })}
      </PrimaryButton>
    </div>
  )
}

/* ── Passo 2: o formato ─────────────────────────────────────────────────
   A app faz as contas com as duplas que entraram e o tempo de campo do
   torneio, e diz o que cabe. O organizador escolhe. */
function FormatStep({ days: dayRows, rules, category, teamCount, onDone, t }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [thirdPlace, setThirdPlace] = useState(Boolean(category.third_place_match))

  const options = useMemo(() => {
    // `availableCourtHours` quer horas e campos em numero, nao a grelha do
    // horario: { hours, courts }.
    const hoursOf = (d) => {
      const [h1, m1] = String(d.starts_at).split(':').map(Number)
      const [h2, m2] = String(d.ends_at).split(':').map(Number)
      return Math.max(0, (h2 * 60 + m2 - (h1 * 60 + m1)) / 60)
    }
    const days = (dayRows || []).map((d) => ({ hours: hoursOf(d), courts: Number(d.courts) || 1 }))
    return formatOptions(teamCount, {
      maxDurationMin: Number(rules?.duration_max) || 60,
      // Sem dias marcados nao ha limite de horas: mostra tudo e nao mente a
      // dizer que cabe.
      availableHours: days.length ? availableCourtHours(days) : null,
      thirdPlaceMatch: thirdPlace,
    })
  }, [dayRows, rules, teamCount, thirdPlace])

  const best = useMemo(() => recommendFormat(options), [options])
  const [pick, setPick] = useState(null)
  const chosen = pick || best?.key

  const save = async () => {
    const option = options.find((o) => o.key === chosen)
    if (!option) return
    setBusy(true)
    setError(null)
    try {
      await saveCategoryFormat(category.id, {
        key: option.key,
        groups: option.groupCount,
        qualifiers_per_group: option.qualifiersPerGroup,
        qualifiers: option.qualifiers,
        third_place: thirdPlace,
      })
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!options.length) {
    return <EmptyState icon={AlertTriangle} title={t('tournament.draw.format_none_title')}
      subtitle={t('tournament.draw.format_none_subtitle', { teams: teamCount })} />
  }

  return (
    <div>
      <p className="mb-2 text-[12.5px] text-ink-700">
        {t('tournament.draw.format_intro', { teams: teamCount })}
      </p>

      {options.map((o) => {
        const active = o.key === chosen
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setPick(o.key)}
            className={`mb-1.5 block w-full rounded-xl border px-3 py-2.5 text-left ${
              active ? 'border-ink-900 bg-white' : 'border-ink-100 bg-white'
            } ${o.fits === false ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <b className="text-[13px] font-extrabold text-ink-900">
                {o.groupCount
                  ? t('tournament.draw.opt_groups', { groups: o.groupCount, size: o.sizes?.[0] ?? 0, per: o.qualifiersPerGroup })
                  : t('tournament.draw.opt_knockout')}
              </b>
              {o.key === best?.key && <StatePill tone="dark">{t('tournament.draw.recommended')}</StatePill>}
            </div>
            <p className="mt-0.5 font-mono text-[10.5px] text-muted">
              {t('tournament.draw.opt_line', {
                guaranteed: t('tournament.draw.opt_guaranteed', { count: o.guaranteed }),
                matches: t('tournament.n.matches', { count: o.matches }),
                hours: Math.round(o.hours),
                phases: t('tournament.n.phases', { count: o.phases }),
              })}
            </p>
            {o.fits === false && (
              <p className="mt-0.5 text-[11px] text-danger">
                {t('tournament.draw.opt_no_fit', { hours: Math.round(o.hours) })}
              </p>
            )}
          </button>
        )
      })}

      <label className="mb-2 mt-1 flex items-center gap-2 text-[12px] text-ink-700">
        <input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} />
        {t('tournament.draw.third_place')}
      </label>

      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
      <PrimaryButton onClick={save} disabled={busy || !chosen}>
        {t('tournament.draw.format_confirm')}
      </PrimaryButton>
    </div>
  )
}

/* ── Passo 3: o sorteio ─────────────────────────────────────────────────
   Ver antes de confirmar. Nada é gravado enquanto o organizador não
   carregar em «Confirmar sorteio» — pode voltar a sortear as vezes que
   quiser, e as cabeças de série são trocáveis. */
function DrawStep({ category, onDone, onChangeFormat, t }) {
  const [teams, setTeams] = useState(null)
  const [seedIds, setSeedIds] = useState(null)
  const [seed, setSeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const format = category.format || {}
  const groupCount = Number(format.groups) || 0
  // Só eliminatória: sem grupos, o quadro sai direto das cabeças de série
  // (Trello #455 — antes `!groupCount` matava o sorteio e não havia saída).
  const knockoutOnly = groupCount === 0
  const perGroup = Number(format.qualifiers_per_group) || 2

  useEffect(() => {
    let cancelled = false
    listCategorySeeding(category.id)
      .then((data) => {
        if (cancelled) return
        const only = data.filter((r) => r.status === 'selecionada')
        setTeams(only.map((r) => ({ id: r.entry_id, name: r.name, points: r.points, incomplete: r.points_incomplete })))
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [category.id])

  const seeds = useMemo(() => {
    if (!teams || !groupCount) return []
    if (seedIds) return seedIds.map((id) => teams.find((x) => x.id === id)).filter(Boolean)
    return pickSeeds(teams, groupCount)
  }, [teams, groupCount, seedIds])

  const payload = useMemo(() => {
    if (!teams) return null
    if (knockoutOnly) return buildKnockoutPayload(teams, { thirdPlace: Boolean(category.third_place_match) })
    if (teams.length < groupCount) return null
    return buildDrawPayload(teams, {
      groupCount, perGroup, seeds, seed, thirdPlace: Boolean(category.third_place_match),
    })
  }, [teams, knockoutOnly, groupCount, perGroup, seeds, seed, category.third_place_match])

  const byId = useMemo(() => Object.fromEntries((teams || []).map((x) => [x.id, x])), [teams])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await drawCategory(category.id, payload)
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !teams) return <p className="py-6 text-center text-[12px] text-danger">{error}</p>
  if (!teams) return <p className="py-6 text-center text-[12px] text-muted">{t('common.loading')}</p>
  if (!payload) {
    return (
      <div>
        <EmptyState icon={AlertTriangle} title={t('tournament.draw.draw_short_title')}
          subtitle={t('tournament.draw.draw_short_subtitle', {
            teams: t('tournament.n.teams', { count: teams.length }),
            groups: t('tournament.n.groups', { count: groupCount }),
          })} />
        {/* A mensagem manda mudar de formato — agora há mesmo por onde. */}
        <PrimaryButton onClick={onChangeFormat} className="w-full">{t('tournament.draw.change_format')}</PrimaryButton>
      </div>
    )
  }

  if (knockoutOnly) {
    const firstRound = payload.bracket.filter((m) => m.a && m.b && m.round === payload.bracket[0].round)
    const byeIds = payload.bracket.filter((m) => m.round !== payload.bracket[0].round).flatMap((m) => [m.a, m.b]).filter(Boolean)
    return (
      <div>
        <MonoLabel className="mb-1">{t('tournament.draw.preview_label')}</MonoLabel>
        <p className="mb-1.5 text-[11.5px] text-muted">{t('tournament.draw.knockout_note')}</p>
        {firstRound.map((m) => (
          <div key={m.slot} className="mb-1.5 rounded-xl border border-ink-100 bg-white px-3 py-2 text-[12px] text-ink-900">
            {byId[m.a]?.name || m.a} <span className="text-muted">×</span> {byId[m.b]?.name || m.b}
          </div>
        ))}
        {byeIds.length > 0 && (
          <p className="mb-2 text-[11.5px] text-muted">
            {t('tournament.draw.knockout_byes', { names: byeIds.map((id) => byId[id]?.name || id).join(', ') })}
          </p>
        )}
        {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={confirm} disabled={busy}>{t('tournament.draw.draw_confirm')}</PrimaryButton>
          <button type="button" onClick={onChangeFormat} disabled={busy}
            className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50">
            {t('tournament.draw.change_format')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <MonoLabel className="mb-1">{t('tournament.draw.seeds_label')}</MonoLabel>
      <p className="mb-1.5 text-[11.5px] text-muted">{t('tournament.draw.seeds_note')}</p>
      <div className="mb-3 overflow-hidden rounded-xl border border-ink-100 bg-white">
        {seeds.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 border-t border-ink-50 px-3 py-2 first:border-t-0">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E9E7FB] font-mono text-[10.5px] font-bold text-[#4338A8]">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-900">{s.name}</span>
            <span className="font-mono text-[10px] text-muted">
              {s.incomplete ? t('tournament.draw.points_unknown') : t('tournament.draw.points', { n: s.points })}
            </span>
          </div>
        ))}
      </div>

      <MonoLabel className="mb-1">{t('tournament.draw.preview_label')}</MonoLabel>
      {payload.groups.map((g) => (
        <div key={g.number} className="mb-1.5 rounded-xl border border-ink-100 bg-white px-3 py-2">
          <b className="text-[12.5px] font-extrabold text-ink-900">{g.name}</b>
          {g.teams.map((id, i) => (
            <p key={id} className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-900">
              {i === 0 && <span className="font-mono text-[9.5px] text-[#4338A8]">{t('tournament.draw.seed_tag')}</span>}
              <span className="truncate">{byId[id]?.name || id}</span>
            </p>
          ))}
        </div>
      ))}

      <p className="mb-2 text-[11.5px] text-muted">
        {t('tournament.draw.preview_summary', {
          groupMatches: payload.group_matches.length,
          bracket: payload.bracket.length,
          guaranteed: Math.min(...payload.groups.map((g) => g.teams.length)) - 1,
        })}
      </p>

      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <PrimaryButton onClick={confirm} disabled={busy}>{t('tournament.draw.draw_confirm')}</PrimaryButton>
        <button
          type="button"
          onClick={() => { setSeedIds(null); setSeed((n) => n + 1) }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50"
        >
          <RefreshCw size={14} /> {t('tournament.draw.draw_again')}
        </button>
      </div>
    </div>
  )
}

/* ── Depois de sorteado ─────────────────────────────────────────────── */
function DoneStep({ tournament, category, onDone, t }) {
  const [asking, setAsking] = useState(false)
  const locked = (category.played_count || 0) > 0

  // Apaga grupos, jogos e horas da categoria: pergunta antes, como as outras
  // ações que destroem trabalho (CLAUDE.md). O erro fica na própria folha.
  const undo = async () => {
    await clearCategoryDraw(category.id)
    onDone()
  }

  return (
    <div>
      <div className="mb-2 rounded-xl border border-ink-100 bg-white px-3 py-2.5">
        <b className="text-[13px] font-extrabold text-ink-900">{t('tournament.draw.done_title')}</b>
        <p className="mt-0.5 text-[12px] text-ink-700">
          {category.group_count
            ? t('tournament.draw.done_line', {
              groups: t('tournament.n.groups', { count: category.group_count }),
              matches: t('tournament.n.matches', { count: category.match_count || 0 }),
            })
            : t('tournament.draw.done_line_ko', { matches: t('tournament.n.matches', { count: category.match_count || 0 }) })}
        </p>
        <p className="mt-1 text-[11.5px] text-muted">
          {locked ? t('tournament.draw.done_locked') : t('tournament.draw.done_can_undo')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/torneio/${tournament.slug || tournament.id}/imprimir?categoria=${category.id}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-2 text-[12px] font-bold text-white"
        >
          <Printer size={14} /> {t('tournament.draw.print')}
        </Link>
        {!locked && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50"
          >
            {t('tournament.draw.undo')}
          </button>
        )}
      </div>

      <ConfirmSheet
        open={asking}
        danger
        title={t('tournament.draw.undo_confirm_title', { code: category.code })}
        message={t('tournament.draw.undo_confirm_message')}
        cancelLabel={t('tournament.draw.undo_confirm_keep')}
        confirmLabel={t('tournament.draw.undo')}
        onConfirm={undo}
        onClose={() => setAsking(false)}
      />
    </div>
  )
}

export default function DrawAdminPanel({ tournament, onBack }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [pickedId, setPickedId] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  // «Mudar formato» a partir do sorteio: volta ao passo 2 sem apagar nada.
  const [reformatId, setReformatId] = useState(null)

  useEffect(() => {
    let cancelled = false
    listCategoriesAdmin(tournament.id)
      .then((payload) => { if (!cancelled) setData(payload) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [tournament.id, reload])

  const categories = data?.categories || null
  const picked = (categories || []).find((c) => c.id === pickedId) || null
  const done = () => { setReformatId(null); setReload((n) => n + 1) }

  const teamCount = picked?.selected_count || 0

  return (
    <div>
      <button type="button" onClick={picked ? () => setPickedId(null) : onBack}
        className="mb-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
        <ChevronLeft size={16} /> {picked ? t('tournament.draw.back_categories') : t('common.back')}
      </button>

      <h3 className="font-display text-lg font-extrabold text-ink-900">
        {picked ? `${picked.code} · ${picked.name}` : t('tournament.draw.admin_title')}
      </h3>
      <p className="mb-3 text-[12px] text-muted">{tournament.name}</p>

      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}

      {!categories ? (
        <p className="py-6 text-center text-[12px] text-muted">{t('common.loading')}</p>
      ) : !picked ? (
        categories.length === 0 ? (
          <EmptyState icon={Shuffle} title={t('tournament.draw.no_categories_title')}
            subtitle={t('tournament.draw.no_categories_subtitle')} />
        ) : (
          categories.map((c) => (
            <button key={c.id} type="button" onClick={() => setPickedId(c.id)}
              className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-left">
              <span className="min-w-0">
                <b className="block truncate text-[13px] font-extrabold text-ink-900">{c.code} · {c.name}</b>
                <span className="font-mono text-[10.5px] text-muted">
                  {t('tournament.draw.cat_counts', {
                    selected: t('tournament.n.selected', { count: c.selected_count || 0 }),
                    waiting: c.waiting_count || 0,
                    waitlist: t('tournament.n.reserves', { count: c.waitlist_count || 0 }),
                    slots: t('tournament.n.slots', { count: c.slots || 0 }),
                  })}
                  {c.price_cents ? ` · ${euros(c.price_cents)}` : ''}
                </span>
              </span>
              <StatePill tone={c.status === 'sorteada' ? 'dark' : 'grey'}>
                {t(`tournament.draw.cat_status_${c.status}`)}
              </StatePill>
            </button>
          ))
        )
      ) : picked.status === 'inscricoes' ? (
        <CloseEntriesStep category={picked} onDone={done} t={t} />
      ) : picked.status === 'fechada' && (!picked.format || reformatId === picked.id) ? (
        <FormatStep days={data.days} rules={data.rules} category={picked} teamCount={teamCount} onDone={done} t={t} />
      ) : picked.status === 'fechada' ? (
        <DrawStep category={picked} onDone={done} onChangeFormat={() => setReformatId(picked.id)} t={t} />
      ) : (
        <DoneStep tournament={tournament} category={picked} onDone={done} t={t} />
      )}
    </div>
  )
}
