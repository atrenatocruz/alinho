// Pré-visualização do link do torneio no WhatsApp (Trello #363).
//
// Ligada no vercel.json a 12 nov 2026 (/torneio/:slug e /torneio/:slug/:rest*),
// por decisão do Francisco, avisado o Renato pelo PO.
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

// O index.html já traz o título e as etiquetas genéricas do alinho (logótipo).
// O WhatsApp e o Facebook ficam com a PRIMEIRA og:image que encontram, por isso
// as genéricas saem antes de entrarem as do torneio.
export function stripDefaultTags(html) {
  return html
    .replace(/[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>[ \t]*\r?\n?/gi, '')
    .replace(/[ \t]*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>[ \t]*\r?\n?/gi, '')
}

export function metaTags({ tour, pageUrl, imageUrl, hasPoster }) {
  const title = `${tour.name} · alinho`
  const description = [
    dateRange(tour.starts_on, tour.ends_on),
    tour.club_name,
    tour.entry_fee_cents ? `${(tour.entry_fee_cents / 100).toFixed(0)} € por dupla` : null,
  ].filter(Boolean).join(' · ')

  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'alinho'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', pageUrl],
    ['og:locale', 'pt_PT'],
    imageUrl ? ['og:image', imageUrl] : null,
    imageUrl ? ['og:image:alt', title] : null,
    ['twitter:card', hasPoster ? 'summary_large_image' : 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
    imageUrl ? ['twitter:image', imageUrl] : null,
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
      // Sem cartaz: o logótipo do alinho, que é o que o link mostrava até aqui.
      const hasPoster = /^https:\/\//.test(tour.poster_url || '')
      const imageUrl = hasPoster ? tour.poster_url : `${origin}/pwa-512x512.png`
      html = stripDefaultTags(html)
        .replace('</head>', `    ${metaTags({ tour, pageUrl, imageUrl, hasPoster })}\n  </head>`)
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
// COMO ESTÁ LIGADA — vercel.json, antes do catch-all:
//   /torneio/:slug          → /api/tournament-preview?slug=:slug
//   /torneio/:slug/:rest*   → /api/tournament-preview?slug=:slug
// Usa VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (as mesmas do browser).
// Sem elas, ou se o torneio não existir, devolve a app sem etiquetas novas.
// Testar: curl -A "WhatsApp/2.23.20.0" <site>/torneio/<slug> | grep og:
// ════════════════════════════════════════════════════════════════════════
