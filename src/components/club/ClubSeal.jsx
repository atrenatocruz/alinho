// O selo do clube verificado: a roseta preta com o visto lima (desenho da
// Comunidade, design-handoff/2026-10-18-comunidade-clubes-destaque, aprovado
// pelo Francisco a 18 out). Preto e lima, as cores da marca: o azul é dos
// mixes. Só nos clubes verificados (club_verified, migration_clube_verificado).
export default function ClubSeal({ size = 20, label = '', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'} className={`shrink-0 ${className}`}>
      <path fill="#040404" d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.6-.7 2.9 1.2 2.7-2.2 2-.3 3-2.9.6-1.7 2.5-2.8-1-2.8 1-1.7-2.5-2.9-.6-.3-3-2.2-2 1.2-2.7-.7-2.9 2.6-1.6 1-2.8 3 .2z" />
      <path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#C8DC00" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
