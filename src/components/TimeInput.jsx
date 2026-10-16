// A hora sempre em 24 h («16:00», nunca «04:00 PM»), em todo o lado onde se
// escolhe hora (Renato/Francisco, 16 out). O <input type="time"> do browser
// segue a língua do computador ou do telemóvel, e num em inglês aparece em
// AM/PM, sem forma de o mudar. Aqui são duas listas (horas 00–23 e minutos)
// que abrem a roda do telemóvel. Funciona como o input: `value` em 'HH:MM'
// (ou '') e `onChange(e)`, com `e.target.value` também em 'HH:MM'.
// `step` em segundos, como no input (1800 = de meia em meia hora); por
// omissão, de 5 em 5 minutos. Um valor fora do passo continua na lista.
const pad = (n) => String(n).padStart(2, '0')

export default function TimeInput({ value = '', onChange, step = 300, className = '', disabled = false, id, 'aria-label': ariaLabel, required = false }) {
  const [hh = '', mm = ''] = String(value || '').slice(0, 5).split(':')
  const every = Math.max(1, Math.round(Number(step || 300) / 60))
  const minutes = []
  for (let m = 0; m < 60; m += every) minutes.push(pad(m))
  if (mm && !minutes.includes(mm)) minutes.push(mm)
  minutes.sort()
  const emit = (h, m) => onChange?.({ target: { value: h && m ? `${h}:${m}` : '' } })
  const sel = 'min-w-0 cursor-pointer appearance-none bg-transparent text-center text-base tabular-nums text-ink-900 outline-none disabled:cursor-default'
  return (
    <div role="group" aria-label={ariaLabel}
      className={`flex items-center gap-0.5 ${className} ${disabled ? 'opacity-60' : ''}`}>
      <select id={id} value={hh} disabled={disabled} required={required}
        aria-label={ariaLabel ? `${ariaLabel} (horas)` : undefined}
        onChange={(e) => emit(e.target.value, mm || '00')} className={`${sel} w-[2.4ch]`}>
        {!hh && <option value="">--</option>}
        {Array.from({ length: 24 }, (_, h) => pad(h)).map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true" className="text-ink-500">:</span>
      <select value={mm} disabled={disabled} required={required}
        aria-label={ariaLabel ? `${ariaLabel} (minutos)` : undefined}
        onChange={(e) => emit(hh || '00', e.target.value)} className={`${sel} w-[2.4ch]`}>
        {!mm && <option value="">--</option>}
        {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  )
}
