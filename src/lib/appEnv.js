// O site de testes (teste.alinho.pt, #585) — design-handoff/2026-09-27-site-de-testes,
// aprovado pelo Francisco a 27 set. Liga-se por uma variável da Vercel posta
// só no Preview do ramo dev: VITE_APP_ENV=test (combinado com o SI). Só o
// valor exato 'test' mostra o aviso: sem a variável, ou com outro valor, a
// app é a do alinho.pt — se a variável falhar, quem perde é o site de testes,
// nunca a app a sério. O nome e os ícones da app instalada decidem-se no
// build (vite.config.js); aqui só a faixa.
//
// Em localhost, `localStorage.mockTestEnv = 'true'` mostra a faixa para as
// prints (o nome e os ícones precisam do build com a variável).
function devOverride() {
  if (!import.meta.env.DEV) return false
  try { return localStorage.getItem('mockTestEnv') === 'true' } catch { return false }
}

export const IS_TEST_ENV = import.meta.env.VITE_APP_ENV === 'test' || devOverride()
