// O marcador do jogo entre amigos (sets ou pontos), o mesmo na lista
// «Jogos entre amigos» e na folha «Resultado do jogo N» da sessão (27 set).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../ui'

// pontos_simples: um resultado só, dois números (qualquer valor — cobre
// "muitos pontos num set só").
// Empate permitido no jogo entre amigos (Francisco, 22 set — Trello #420):
// grava-se, mas não conta para o ranking. Diz-se isso antes de gravar.
export function DrawNote() {
  const { t } = useTranslation()
  return <p className="text-xs font-extrabold text-ink-700" role="status">{t('privatematches.draw_note')}</p>
}

export function ScoreEntrySimple({ initial, onSave, saving }) {
  const { t } = useTranslation()
  const [a, setA] = useState(initial?.a ?? '')
  const [b, setB] = useState(initial?.b ?? '')
  const aNum = parseInt(a, 10)
  const bNum = parseInt(b, 10)
  const valid = a !== '' && b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum >= 0 && bNum >= 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input type="number" min="0" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} className="input-field w-16 text-center" placeholder="0" />
        <span className="text-muted font-extrabold">-</span>
        <input type="number" min="0" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} className="input-field w-16 text-center" placeholder="0" />
      </div>
      {valid && aNum === bNum && <DrawNote />}
      {valid && (
        <PrimaryButton onClick={() => onSave({ score_a: aNum, score_b: bNum })} disabled={saving} className="w-full">
          {saving ? t('privatematches.saving') : t('privatematches.submit_score')}
        </PrimaryButton>
      )}
    </div>
  )
}

// 'sets': a pessoa escolhe quantos sets ao criar o jogo (numSets) — aqui
// registam-se todos de uma vez, sem regra de "quem fecha primeiro" (os
// amigos nem sempre seguem as regras todas). O resultado final é quantos
// sets cada lado ganhou; empate nos sets é empate do jogo (#420).
export function ScoreEntrySets({ numSets, onSave, saving }) {
  const { t } = useTranslation()
  const [sets, setSets] = useState(() => Array.from({ length: numSets }, () => ({ a: '', b: '' })))

  const updateSet = (i, side, value) =>
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, [side]: value } : s)))

  const parsed = sets.map((s) => ({ a: parseInt(s.a, 10), b: parseInt(s.b, 10) }))
  const allFilled = sets.every((s, i) =>
    s.a !== '' && s.b !== '' && !Number.isNaN(parsed[i].a) && !Number.isNaN(parsed[i].b) && parsed[i].a >= 0 && parsed[i].b >= 0
  )
  const setsWonA = parsed.filter((s) => s.a > s.b).length
  const setsWonB = parsed.filter((s) => s.b > s.a).length
  const tied = allFilled && setsWonA === setsWonB

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs font-extrabold text-muted w-16 shrink-0">{t('privatematches.set_label', { number: i + 1 })}</span>
          <input type="number" min="0" inputMode="numeric" value={s.a} onChange={(e) => updateSet(i, 'a', e.target.value)} className="input-field w-16 text-center" placeholder="0" />
          <span className="text-muted font-extrabold">-</span>
          <input type="number" min="0" inputMode="numeric" value={s.b} onChange={(e) => updateSet(i, 'b', e.target.value)} className="input-field w-16 text-center" placeholder="0" />
        </div>
      ))}
      {tied && <DrawNote />}
      {allFilled && (
        <PrimaryButton
          onClick={() => onSave({ score_a: setsWonA, score_b: setsWonB, sets: parsed.map((s) => ({ score_a: s.a, score_b: s.b })) })}
          disabled={saving}
          className="w-full"
        >
          {saving ? t('privatematches.saving') : t('privatematches.submit_score')}
        </PrimaryButton>
      )}
    </div>
  )
}
