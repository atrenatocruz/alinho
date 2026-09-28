import { useTranslation } from 'react-i18next'
import { usePlacesUnavailable } from '../lib/useGooglePlacesAutocomplete'

/** Por baixo do campo do local, quando a procura da Google falhou nesta
    visita (chave, quota, rede): o que se escreveu à mão fica a valer. */
export default function PlacesUnavailableHint({ className = '' }) {
  const { t } = useTranslation()
  const unavailable = usePlacesUnavailable()
  if (!unavailable) return null
  return <p role="status" className={`mt-1.5 text-sm text-muted ${className}`}>{t('places.unavailable')}</p>
}
