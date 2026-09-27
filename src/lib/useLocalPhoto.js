// A foto de quem partilha (galeria ou câmara), só no telemóvel: nunca sobe
// para a app. Uso:
//   const photo = useLocalPhoto()
//   <input ref={photo.inputRef} {...photo.inputProps} />  (escondido)
//   <button onClick={photo.pick}>…</button>   photo.dataUrl · photo.clear()
import { useRef, useState } from 'react'
import { readLocalPhoto } from './shareImage'

export default function useLocalPhoto(options) {
  const inputRef = useRef(null)
  const [photo, setPhoto] = useState(null) // { dataUrl, width, height }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // escolher a mesma foto outra vez volta a disparar
    if (!file) return
    setBusy(true); setError('')
    try { setPhoto(await readLocalPhoto(file, options)) } catch (err) {
      console.error('Error reading the photo:', err)
      setError(err?.message === 'not_an_image' ? 'not_an_image' : 'read_failed')
    } finally { setBusy(false) }
  }

  return {
    inputRef,
    // No telemóvel, accept="image/*" já oferece a câmara e a galeria.
    inputProps: { type: 'file', accept: 'image/*', className: 'hidden', onChange },
    pick: () => inputRef.current?.click(),
    clear: () => setPhoto(null),
    dataUrl: photo?.dataUrl || null,
    photo,
    busy,
    error,
  }
}
