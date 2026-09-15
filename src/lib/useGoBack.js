import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * "Voltar" that goes back to wherever the person actually came from, instead of
 * a hard-coded destination (Trello #245).
 *
 * Every back control in the app used to point at a fixed route — ClubProfile at
 * /comunidade, PrivateMatches at /perfil, and so on. That is right only when you
 * arrived by the one path the author had in mind: open a group from a player's
 * profile and "voltar" dropped you in Comunidade, a page you had never been on.
 *
 * The fallback matters because `navigate(-1)` on the first entry of a session
 * leaves the app entirely — someone opening a shared club link, a bookmark, or
 * reloading the page has no in-app history behind them. React Router marks that
 * first entry with `key === 'default'`, which is how we tell the two apart.
 *
 * Pass the route that used to be hard-coded as the fallback, so a directly
 * opened page still has somewhere sensible to go.
 */
export function useGoBack(fallback = '/') {
  const navigate = useNavigate()
  const { key } = useLocation()

  return useCallback(() => {
    if (key === 'default') navigate(fallback, { replace: true })
    else navigate(-1)
  }, [navigate, key, fallback])
}
