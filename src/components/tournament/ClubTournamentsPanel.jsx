// Separador «Torneios» do Gerir do clube (Trello #361). Lista os torneios,
// deixa criar um novo em 4 passos (print 07), abrir e fechar inscrições, e
// apagar enquanto for rascunho e ninguém se tiver inscrito.
//
// Enquanto a migração do torneio não correr, as RPCs não existem: a lista
// fica vazia em vez de rebentar.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Pencil, Plus, Trash2, Trophy, Shuffle } from 'lucide-react'
import { createTournament, deleteTournament, getTournamentForEdit, listClubTournaments, setTournamentStatus, updateTournament } from '../../lib/tournamentApi'
import { canDelete, nextStatus, previousStatus } from '../../lib/tournaments'
import { describeError, errorKind } from '../../lib/errors'
import { DangerConfirmModal, EmptyState, PrimaryButton } from '../ui'
import { MonoLabel, StatePill } from './TournamentBits'
import CreateTournamentForm from './CreateTournamentForm'
import ScorekeepersPanel from './ScorekeepersPanel'
import DrawAdminPanel from './DrawAdminPanel'

const STATE_TONE = { rascunho: 'grey', inscricoes: 'in', fechado: 'grey', sorteado: 'dark', a_decorrer: 'live', terminado: 'grey' }

export default function ClubTournamentsPanel({ organizationId, club }) {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toDelete, setToDelete] = useState(null)
  const [keepersOf, setKeepersOf] = useState(null)
  // O caminho do sorteio (Dev 3, «Torneio 4/6»): fechar inscricoes,
  // escolher formato e sortear. Mesmo padrao do painel dos marcadores.
  const [drawOf, setDrawOf] = useState(null)
  const [editing, setEditing] = useState(null) // { row, data }

  const load = useCallback(() => {
    listClubTournaments(organizationId)
      .then((rows) => setList(rows))
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading tournaments:', err)
        setList([])
      })
  }, [organizationId])

  useEffect(() => { load() }, [load])

  const create = async (draft) => {
    setSaving(true)
    setError('')
    try {
      await createTournament(organizationId, draft)
      setCreating(false)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = async (row) => {
    setError('')
    try {
      const data = await getTournamentForEdit(row.id)
      if (!data?.tournament) throw new Error('not ready')
      setEditing({ row, data })
    } catch (err) {
      if (errorKind(err) !== 'not_ready') console.error('Error loading tournament:', err)
      setError(describeError(t, err, 'tournament.admin.edit_error'))
    }
  }

  const saveEdit = async (draft) => {
    setSaving(true)
    setError('')
    try {
      await updateTournament(editing.row.id, draft)
      setEditing(null)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setSaving(false)
    }
  }

  const move = async (tournament, status) => {
    try {
      await setTournamentStatus(tournament.id, status)
      load()
    } catch (err) {
      setError(describeError(t, err))
    }
  }

  const remove = async () => {
    try {
      await deleteTournament(toDelete.id)
      setToDelete(null)
      load()
    } catch (err) {
      setError(describeError(t, err))
    }
  }

  if (creating) {
    return <CreateTournamentForm club={club} saving={saving} error={error} onCancel={() => setCreating(false)} onCreate={create} />
  }

  if (keepersOf) {
    return <ScorekeepersPanel tournament={keepersOf} onBack={() => setKeepersOf(null)} />
  }
  if (drawOf) {
    return <DrawAdminPanel tournament={drawOf} onBack={() => { setDrawOf(null); load() }} />
  }

  if (editing) {
    return (
      <CreateTournamentForm
        club={club}
        initial={editing.data}
        locked={!!editing.data.has_entries}
        saving={saving}
        error={error}
        onCancel={() => setEditing(null)}
        onCreate={saveEdit}
      />
    )
  }

  const dates = (row) => {
    if (!row.starts_on) return ''
    const a = new Date(`${row.starts_on}T12:00`)
    const b = new Date(`${row.ends_on || row.starts_on}T12:00`)
    const month = (d) => d.toLocaleDateString(i18n.language, { month: 'short' }).replace('.', '')
    return a.getTime() === b.getTime()
      ? `${a.getDate()} ${month(a)}`
      : a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${month(b)}` : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
  }

  return (
    <div className="space-y-4">
      <PrimaryButton className="flex w-full items-center justify-center gap-2" onClick={() => { setError(''); setCreating(true) }}>
        <Plus size={20} /> {t('tournament.admin.create')}
      </PrimaryButton>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      {list === null ? (
        <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={Trophy} title={t('tournament.admin.empty_title')} subtitle={t('tournament.admin.empty_subtitle')} />
      ) : (
        list.map((row) => {
          const forward = nextStatus(row.status)
          const back = previousStatus(row.status)
          return (
            <div key={row.id} className="card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <MonoLabel>{dates(row)}</MonoLabel>
                  <Link to={`/torneio/${row.slug || row.id}`} className="mt-0.5 flex items-center gap-1 font-display text-base font-extrabold text-ink-900 hover:underline">
                    <span className="truncate">{row.name}</span>
                    <ChevronRight size={16} className="shrink-0 text-ink-300" />
                  </Link>
                  <p className="mt-0.5 text-[11.5px] text-ink-500">
                    {t('tournament.admin.counts', { categories: row.category_count || 0, teams: row.entry_count || 0 })}
                  </p>
                </div>
                <StatePill tone={STATE_TONE[row.status] || 'grey'}>{t(`tournament.status_${row.status}`)}</StatePill>
              </div>

              {/* Editar está sempre: mesmo um torneio a decorrer deixa
                  mudar o nome, o local e o texto do organizador. */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {forward && (
                  <button type="button" onClick={() => move(row, forward)} className="rounded-full bg-ink-900 px-3 py-1.5 text-[12px] font-bold text-white">
                    {t(`tournament.admin.to_${forward}`)}
                  </button>
                )}
                {back && (
                  <button type="button" onClick={() => move(row, back)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-700 hover:bg-ink-50">
                    {t(`tournament.admin.back_to_${back}`)}
                  </button>
                )}
                {['inscricoes', 'fechado', 'sorteado', 'a_decorrer'].includes(row.status) && (
                  <button type="button" onClick={() => setDrawOf(row)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-700 hover:bg-ink-50">
                    <Shuffle size={14} /> {t('tournament.admin.draw')}
                  </button>
                )}
                {['sorteado', 'a_decorrer', 'terminado'].includes(row.status) && (
                  <>
                    <Link to={`/torneio/${row.id}/marcar`} className="rounded-full bg-ink-900 px-3 py-1.5 text-[12px] font-bold text-white">
                      {t('tournament.score.open')}
                    </Link>
                    <button type="button" onClick={() => setKeepersOf(row)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-700 hover:bg-ink-50">
                      {t('tournament.score.keepers_title')}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => openEdit(row)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-900">
                  <Pencil size={14} /> {t('tournament.admin.edit')}
                </button>
                {canDelete(row) && (
                  <button type="button" onClick={() => setToDelete(row)} aria-label={t('tournament.admin.delete')} className="text-ink-300 hover:text-danger">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          )
        })
      )}

      <DangerConfirmModal
        open={!!toDelete}
        title={t('tournament.admin.delete_title')}
        message={t('tournament.admin.delete_message', { name: toDelete?.name || '' })}
        confirmLabel={t('tournament.admin.delete')}
        cancelLabel={t('tournament.create.cancel')}
        onConfirm={remove}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
