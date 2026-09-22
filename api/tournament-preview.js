// Pré-visualização do link do torneio no WhatsApp (Trello #363).
//
// ⚠️ PROPOSTA — NÃO ESTÁ LIGADA. Esta função existe no repositório mas
// nada a chama: falta uma linha no vercel.json, e essa linha é do Renato
// (ver "COMO SE LIGA", no fim). Enquanto não for ligada, a app fica
// exatamente como está hoje.
//
// PORQUÊ NO SERVIDOR. Quando se cola um link no WhatsApp, é o WhatsApp
// que vai buscar a página — e ele não corre JavaScript. A nossa app é uma
// página vazia que só se preenche no browser, por isso o WhatsApp não
// encontra nada para mostrar e o link fica "seco". A caixa com imagem,
// nome e datas só aparece se o servidor responder já com as etiquetas
// <meta property="og:...">. Não há forma de fazer isto dentro da app.
//
// O QUE ESTA FUNÇÃO FAZ
//   1. lê o endereço do torneio (ex. /torneio/smash-cup);
//   2. pede ao Supabase os dados públicos desse torneio (a mesma vista
//      que a página usa, com a chave pública — nada de privado);
//   3. vai buscar o index.html da própria app e mete-lhe as etiquetas;
//   4. devolve essa página. O browser continua a receber a app inteira,
//      igual ao que recebe hoje; o WhatsApp recebe também as etiquetas.
//
// SEGURANÇA E ROBUSTEZ
//   • só lê; usa a chave pública (a mesma que o browser já usa);
//   • tudo o que vem da base de dados é escapado antes de entrar no HTML;
//   • qualquer falha (torneio que não existe, Supabase em baixo, erro
//     nosso) devolve o index.html tal e qual — a página nunca parte por
//     causa da pré-visualização;
//   • cache de 5 minutos no CDN, que é o que o cartão pede para aguentar
//     muita gente a abrir o link ao mesmo tempo no wi-fi do clube.

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c])

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

// "9 a 11 de outubro de 2026" — o mesmo formato do cartaz.
function dateRange(startsOn, endsOn) {
  if (!startsOn) return ''
  const fmt = (iso, withMonth) => {
    const d = new Date(`${iso}T12:00:00Z`)
    const day = d.getUTCDate()
    const month = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
      'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][d.getUTCMonth()]
    return withMonth ? `${day} de ${month}` : `${day}`
  }
  if (!endsOn || endsOn === startsOn) return fmt(startsOn, true)
  const sameMonth = startsOn.slice(0, 7) === endsOn.slice(0, 7)
  return `${fmt(startsOn, !sameMonth)} a ${fmt(endsOn, true)}`
}

async function loadTournament(slug) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null
  const url = `${SUPABASE_URL}/rest/v1/tournament_public`
    + `?slug=eq.${encodeURIComponent(slug)}`
    + `&select=name,club_name,location,starts_on,ends_on,poster_url,entry_fee_cents,category_count`
    + `&limit=1`
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!res.ok) return null
  const rows = await res.json()
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

function metaTags({ tour, pageUrl, imageUrl }) {
  const title = `${tour.name} · Alinho`
  const description = [
    dateRange(tour.starts_on, tour.ends_on),
    tour.club_name,
    tour.entry_fee_cents ? `${(tour.entry_fee_cents / 100).toFixed(0)} € por dupla` : null,
  ].filter(Boolean).join(' · ')

  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'Alinho'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', pageUrl],
    ['og:locale', 'pt_PT'],
    imageUrl ? ['og:image', imageUrl] : null,
    ['twitter:card', imageUrl ? 'summary_large_image' : 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
  ].filter(Boolean)

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    ...tags.map(([property, content]) =>
      `<meta property="${property}" content="${escapeHtml(content)}">`),
  ].join('\n    ')
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${host}`

  // O index.html da própria app — é o que o browser tem de continuar a
  // receber. Pede-se o ficheiro estático, não a rota (que voltaria aqui).
  let html
  try {
    const shell = await fetch(`${origin}/index.html`)
    html = await shell.text()
  } catch {
    res.status(302).setHeader('Location', '/')
    return res.end()
  }

  try {
    const slug = String(req.query?.slug || '').replace(/[^a-z0-9-]/gi, '')
    const tour = slug ? await loadTournament(slug) : null
    if (tour) {
      const pageUrl = `${origin}/torneio/${slug}`
      const imageUrl = tour.poster_url || `${origin}/og-torneio.png`
      html = html.replace('</head>', `    ${metaTags({ tour, pageUrl, imageUrl })}\n  </head>`)
      // 5 min no CDN, e até 1 h a servir a versão antiga enquanto revalida.
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    }
  } catch (error) {
    // A página vale mais do que a pré-visualização: segue sem etiquetas.
    console.error('tournament-preview failed, serving the plain app:', error)
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).end(html)
}

// ════════════════════════════════════════════════════════════════════════
// COMO SE LIGA (Renato) — uma linha no vercel.json, antes do catch-all:
//
//   "rewrites": [
//     { "source": "/torneio/:slug",       "destination": "/api/tournament-preview?slug=:slug" },
//     { "source": "/torneio/:slug/:rest*", "destination": "/api/tournament-preview?slug=:slug" },
//     { "source": "/(.*)",                "destination": "/index.html" }
//   ]
//
// Precisa também de VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas
// variáveis do projeto na Vercel (só de leitura, as mesmas do browser).
//
// Falta ainda uma imagem por omissão em public/og-torneio.png (1200×630),
// para os torneios que não têm cartaz — é desenho, não é código.
//
// Não liguei isto por não ser meu: mexe no encaminhamento de TODA a
// secção /torneio em produção. Depois de ligado, testar com
// https://developers.facebook.com/tools/debug/ ou colando o link numa
// conversa de WhatsApp.
// ════════════════════════════════════════════════════════════════════════
