// O único splash da app é o ecrã de arranque do index.html (#boot). Fica por
// cima de tudo até a app estar pronta (sessão resolvida — ver AppRoutes) e
// nunca sai antes de a animação acabar (~1,4 s desde o início da página).
// Chamar mais do que uma vez não faz mal.
const BOOT_ANIMATION_MS = 1450

let leaving = false
export function hideBoot() {
  const boot = document.getElementById('boot')
  if (!boot || leaving) return
  leaving = true
  setTimeout(() => {
    boot.classList.add('boot-leave')
    setTimeout(() => boot.remove(), 300)
  }, Math.max(0, BOOT_ANIMATION_MS - performance.now()))
}
