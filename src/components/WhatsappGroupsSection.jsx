import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, Pencil, Check, X } from 'lucide-react'
import { BadgePill } from './ui'
import { listWhatsappGroups, renameWhatsappGroup, WHATSAPP_GROUP_LABEL_MAX } from '../lib/whatsappGroups'
import { describeError } from '../lib/errors'

// PostgREST quando a função não existe — a migração ainda não correu.
const FUNCTION_NOT_FOUND = 'PGRST202'

function GroupLevels({ levels }) {
  const { t } = useTranslation()
  if (!levels || levels.length === 0) {
    return <span className="text-xs font-extrabold text-muted">{t('gerirclube.whatsapp_groups_all_levels')}</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {levels.map((level) => <BadgePill key={level} text={level} />)}
    </div>
  )
}

function GroupCode({ jid }) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="text-[11px] text-muted">{t('gerirclube.whatsapp_groups_code_label')}</p>
      <p className="font-mono text-[11px] text-muted break-all">{jid}</p>
    </div>
  )
}

function WhatsappGroupRow({ group, onRenamed }) {
  const { t } = useTranslation()
  const unnamed = !group.label
  // Um grupo sem nome abre já em edição: é a única coisa a fazer com ele.
  const [editing, setEditing] = useState(unnamed)
  const [draft, setDraft] = useState(group.label || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cancel = () => {
    setDraft(group.label || '')
    setError('')
    setEditing(false)
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await renameWhatsappGroup(group.id, draft)
      onRenamed(group.id, saved)
      setDraft(saved || '')
      // Apagar o nome devolve o grupo a "por nomear", que fica em edição.
      setEditing(!saved)
    } catch (err) {
      console.error('Error renaming WhatsApp group:', err)
      setError(describeError(t, err, 'gerirclube.whatsapp_groups_save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className={`p-4 space-y-2.5 ${unnamed ? 'bg-lime-100' : ''}`}>
        {unnamed && (
          <>
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-ink-900">
              {t('gerirclube.whatsapp_groups_unnamed')}
            </p>
            <p className="font-mono text-sm font-extrabold text-ink-900 break-all">{group.group_jid}</p>
            <GroupLevels levels={group.levels} />
          </>
        )}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={WHATSAPP_GROUP_LABEL_MAX}
          placeholder={t('gerirclube.whatsapp_groups_name_placeholder')}
          aria-label={t('gerirclube.whatsapp_groups_name_aria')}
          className="input-field"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || draft.trim() === (group.label || '')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-ctrl bg-lime-400 text-ink-900 text-sm font-extrabold disabled:opacity-40"
          >
            <Check size={16} /> {saving ? t('gerirclube.whatsapp_groups_saving') : t('gerirclube.whatsapp_groups_save')}
          </button>
          {!unnamed && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-ctrl border border-line bg-canvas text-muted text-sm font-extrabold"
            >
              <X size={16} /> {t('gerirclube.whatsapp_groups_cancel')}
            </button>
          )}
        </div>
        {error && <p className="text-sm font-extrabold text-danger">{error}</p>}
        {!unnamed && (
          <>
            <GroupCode jid={group.group_jid} />
            <GroupLevels levels={group.levels} />
          </>
        )}
      </form>
    )
  }

  return (
    <div className="p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-ink-900 text-lime-400 flex items-center justify-center shrink-0">
        <MessageCircle size={18} />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-base font-extrabold text-ink-900 break-words">{group.label}</p>
        <GroupCode jid={group.group_jid} />
        <GroupLevels levels={group.levels} />
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t('gerirclube.whatsapp_groups_rename_aria', { name: group.label })}
        className="w-10 h-10 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast shrink-0"
      >
        <Pencil size={16} />
      </button>
    </div>
  )
}

/**
 * Grupos de WhatsApp onde o robô publica os mixes do clube. Parte 1: ver e
 * dar nome. Sem "adicionar grupo" — ligar grupos continua a ser manual.
 * Some por inteiro enquanto a migração não tiver corrido.
 */
export default function WhatsappGroupsSection({ organizationId }) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | unavailable | error

  useEffect(() => {
    if (!organizationId) return
    let cancelled = false
    setStatus('loading')
    listWhatsappGroups(organizationId)
      .then((rows) => {
        if (cancelled) return
        setGroups(rows)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.code === FUNCTION_NOT_FOUND) {
          setStatus('unavailable')
          return
        }
        console.error('Error loading WhatsApp groups:', err)
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [organizationId])

  const handleRenamed = (groupId, label) => {
    setGroups((rows) => rows.map((g) => (g.id === groupId ? { ...g, label } : g)))
  }

  if (status === 'unavailable') return null

  return (
    <div className="mt-6 pt-6 border-t border-gray-200">
      <h4 className="text-base font-semibold text-ink-900 mb-1">{t('gerirclube.whatsapp_groups_heading')}</h4>
      <p className="text-sm text-gray-500 mb-4">{t('gerirclube.whatsapp_groups_description')}</p>

      {status === 'loading' ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : status === 'error' ? (
        <p className="text-sm font-extrabold text-danger">{t('gerirclube.whatsapp_groups_load_error')}</p>
      ) : groups.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-canvas px-4 py-7 text-center">
          <MessageCircle size={22} className="mx-auto text-muted" />
          <p className="mt-2 text-sm font-extrabold text-ink-900">{t('gerirclube.whatsapp_groups_empty_title')}</p>
          <p className="mt-1 text-sm text-muted">{t('gerirclube.whatsapp_groups_empty_body')}</p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-canvas overflow-hidden divide-y divide-line">
          {groups.map((g) => <WhatsappGroupRow key={g.id} group={g} onRenamed={handleRenamed} />)}
        </div>
      )}
    </div>
  )
}
