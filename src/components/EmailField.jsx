// O campo do email em entrar, criar conta e recuperar a palavra-passe, sem a
// bolha do browser (UX/QA, 13 out). O erro aparece por baixo do campo, com
// ⚠ a vermelho e o contorno vermelho, e diz o que fazer, com um exemplo.
// Só aparece quando a pessoa sai do campo ou carrega no botão — nunca
// enquanto escreve — e some assim que o email fica certo.
// `checkNow`: um número que o formulário aumenta ao carregar no botão com o
// email mal escrito (aí também o «Escreve o teu email.» de um campo vazio).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emailProblem } from '../lib/emailCheck'

export default function EmailField({ value, onChange, checkNow = 0, placeholder, autoComplete = 'email', id, autoFocus = false }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false) // já se pode mostrar o erro
  useEffect(() => { if (checkNow > 0) setShown(true) }, [checkNow])
  const problem = emailProblem(value)
  // Ao sair do campo vazio não se diz nada; o «vazio» é só do botão.
  const visible = shown && problem && (problem !== 'empty' || checkNow > 0)
  const errId = id ? `${id}-erro` : undefined
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={onChange}
        onBlur={() => { if (value) setShown(true) }}
        className={`input-field ${visible ? '!border-danger focus:!border-danger focus:!ring-danger/20' : ''}`}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={visible || undefined}
        aria-describedby={visible ? errId : undefined}
      />
      {visible && (
        <p id={errId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-extrabold text-danger">
          <span aria-hidden="true">⚠</span>
          <span>{t(`login.email_error_${problem}`)}</span>
        </p>
      )}
    </>
  )
}
