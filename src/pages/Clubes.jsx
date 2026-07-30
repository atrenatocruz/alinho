import { EmptyState } from '../components/ui'

export default function Clubes() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Clubes & Cortes</h2>
      </div>

      <EmptyState
        title="Em breve"
        subtitle="Informação de clubes e cortes vai aparecer aqui."
      />
    </div>
  )
}
