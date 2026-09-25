/* ─── Mensagens de erro com contexto (Trello #247) ──────────────────────────
   Antes, cada ecrã fazia `t('x.error') + (err.message || '')`: uma frase
   genérica seguida do texto cru do Supabase — às vezes uma boa frase em
   português das nossas funções SQL, muitas vezes inglês técnico ("new row
   violates row-level security policy") ou nada.

   Agora todos os erros mostrados ao utilizador passam por describeError:
   1. Se o tipo de erro é reconhecível, diz a razão (sem internet, sessão
      expirada, sem permissão, nome repetido, funcionalidade por ativar…).
   2. Se é uma regra da app escrita em português numa função SQL (RAISE
      EXCEPTION → código P0001), mostra essa frase tal como está.
   3. Senão, não adivinha a causa: diz o que falhou (a frase da ação) e o
      que fazer a seguir. O código técnico vai só para a consola (#421).
   O texto técnico completo fica na consola (console.error já existe em cada
   catch) — o cartão «Registar automaticamente os erros da app» trata de o
   guardar para a equipa. */

const text = (error) => `${error?.message || ''} ${error?.error_description || ''}`.trim()

export function errorKind(error) {
  if (!error) return 'unknown'
  const msg = text(error)
  const code = error.code ? String(error.code) : ''
  const status = Number(error.status || 0)

  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false)
    || /failed to fetch|networkerror|network request failed|load failed/i.test(msg)
  if (offline) return 'offline'

  if (code === 'PGRST301' || /jwt expired|invalid refresh token|refresh token not found|auth session missing|session.*expired/i.test(msg)) {
    return 'session'
  }

  // Supabase Auth (login/registo/password)
  if (/invalid login credentials/i.test(msg)) return 'invalid_login'
  if (/user already registered|already been registered/i.test(msg)) return 'already_registered'
  if (/email not confirmed/i.test(msg)) return 'email_not_confirmed'
  if (status === 429 || /rate limit|too many requests|security purposes.*after/i.test(msg)) return 'too_many'

  // Migração por correr: função, coluna ou tabela que a base de dados ainda não tem
  if (['PGRST202', 'PGRST204', '42703', '42883', '42P01'].includes(code) || /schema cache|does not exist/i.test(msg)) {
    return 'not_ready'
  }

  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'permission'
  if (code === '23505' || /duplicate key/i.test(msg)) return 'duplicate'

  // RAISE EXCEPTION das nossas funções — frases já escritas para o utilizador
  if (code === 'P0001' && msg) return 'business'

  return 'unknown'
}

/** O mix encheu entre ver e carregar: o trigger das vagas
 *  (migration_mix_capacity_guard.sql) recusa com a mensagem `game_full`. */
export function isGameFull(error) {
  return /(^|\W)game_full$/.test(String(error?.message || '').trim())
}

/** Código técnico curto para o utilizador enviar à equipa, ou null. */
export function errorCode(error) {
  if (!error) return null
  if (error.code) return String(error.code)
  if (error.status) return `HTTP ${error.status}`
  return null
}

// Tira ": " do fim das frases antigas pensadas para levar o erro cru colado
// ("Erro ao criar jogo: ") e garante pontuação final.
function sentence(value) {
  const s = String(value || '').trim().replace(/[\s:–—-]+$/, '')
  if (!s) return ''
  return /[.!?…]$/.test(s) ? s : `${s}.`
}

export function describeError(t, error, fallbackKey = 'errors.generic') {
  const kind = errorKind(error)
  switch (kind) {
    case 'offline': return t('errors.offline')
    case 'session': return t('errors.session_expired')
    case 'invalid_login': return t('errors.invalid_login')
    case 'already_registered': return t('errors.already_registered')
    case 'email_not_confirmed': return t('errors.email_not_confirmed')
    case 'too_many': return t('errors.too_many')
    case 'not_ready': return t('errors.not_ready')
    case 'permission': return t('errors.permission')
    case 'duplicate': return t('errors.duplicate')
    case 'business': return sentence(error.message)
    default: {
      const base = sentence(t(fallbackKey))
      const retry = /tenta|try/i.test(base) ? '' : ` ${t('errors.try_again')}`
      // O código técnico fica na consola, nunca no ecrã (Trello #421).
      const code = errorCode(error)
      if (code) console.warn('[alinho] error code:', code)
      return `${base}${retry}`
    }
  }
}
