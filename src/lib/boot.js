// O único splash da app é o ecrã de arranque do index.html (#boot). Fica por
// cima de tudo até a app estar pronta (sessão resolvida — ver AppRoutes) e
// nunca sai antes de a animação do logótipo acabar, mais um bocadinho com o
// logótipo completo. Espera pelas animações em si e não por um relógio: com
// o JavaScript já em cache, o browser às vezes só desenha o #boot depois de
// correr o bundle, e a animação começa mais tarde do que o início da página.
// Chamar mais do que uma vez não faz mal.
const HOLD_MS = 600          // logótipo completo, parado, antes de sair
const SAFETY_MS = 4000       // se as animações nunca chegarem a correr
const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
const wait = ms => new Promise(r => setTimeout(r, ms))

let leaving = false
export async function hideBoot() {
  const boot = document.getElementById('boot')
  if (!boot || leaving) return
  leaving = true
  await nextFrame()
  const logo = boot.querySelector('svg')
  const animations = logo?.getAnimations?.({ subtree: true }) ?? []
  const done = animations.length
    ? Promise.all(animations.map(a => a.finished.catch(() => {})))
    : wait(1450)
  await Promise.race([done, wait(SAFETY_MS)])
  await wait(HOLD_MS)
  boot.classList.add('boot-leave')
  await wait(300)
  boot.remove()
}
