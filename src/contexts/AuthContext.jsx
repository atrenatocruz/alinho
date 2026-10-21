import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pendingAccountOrigin, clearAccountOrigin } from '../lib/accountOrigin'
import { loadMyRef } from '../lib/myRef'
import i18n from '../lib/i18n'
import { installDevMockNetwork } from '../lib/devMockNetwork'
import { Browser } from '@capacitor/browser'
import { SignInWithApple } from '@capacitor-community/apple-sign-in'
import { IS_NATIVE, NATIVE_AUTH_CALLBACK, appHref, appOrigin } from '../lib/native'
import { enablePush, disablePush } from '../lib/push'

const AuthContext = createContext({})

// Dev-only bypass: fake admin session so we can enter the app without an account.
const MOCK_ADMIN_KEY = 'mockAdminSession'
const MOCK_ADMIN_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'admin@dev.local',
  // localStorage.mockNewAccount = 'true' → conta criada agora (o ecrã de
  // consentimento com a frase das contas novas, #360).
  created_at: typeof localStorage !== 'undefined' && localStorage.getItem('mockNewAccount') === 'true' ? new Date().toISOString() : '2026-08-01T00:00:00Z',
}
const MOCK_ADMIN_PROFILE = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'admin@dev.local',
  name: 'Admin (Dev)',
  // localStorage.mockNoGender = 'true' → perfil sem sexo (mix só de homens, 26 set).
  gender: typeof localStorage !== 'undefined' && localStorage.getItem('mockNoGender') === 'true' ? null : 'masculino',
  phone_hash: typeof localStorage !== 'undefined' && localStorage.getItem('mockPhoneUnconfirmed') === 'true' ? 'hash-de-teste' : 'dev-bypass', // dummy — skips the mandatory-phone modal for the dev bypass; mockPhoneUnconfirmed mostra o «Confirma o teu número» (#537)
  phone_verified_at: typeof localStorage !== 'undefined' && localStorage.getItem('mockPhoneConfirmed') === 'true' ? '2026-09-24T20:00:00Z' : null,
  // localStorage.mockXp = '8100' → XP de atividade do perfil de teste (R15).
  xp: typeof localStorage !== 'undefined' && localStorage.getItem('mockXp') ? Number(localStorage.getItem('mockXp')) : 0,
  // localStorage.mockPlatformAdmin = 'true' → vê o seletor de plano no Gerir.
  is_platform_admin: typeof localStorage !== 'undefined' && localStorage.getItem('mockPlatformAdmin') === 'true',
  // Rating fictício (11 set 2026) — sem isto o aro de progresso do Perfil
  // fica sempre vazio ("— pontos") em localhost. Ver devMockNetwork.js
  // para o resto dos dados fictícios (troféus, XP, ranking, etc.).
  rating: 1450,
  // localStorage.mockConsentPending = 'true' → ainda sem aceitar a Política
  // (o ecrã de consentimento, #360).
  consent_accepted_at: typeof localStorage !== 'undefined' && localStorage.getItem('mockConsentPending') === 'true' ? null : '2026-09-01T00:00:00Z',
  // localStorage.mockDeletionRequestedAt = '2026-09-18' → ecrã de recuperar
  // a conta (apagar conta, Trello #306).
  deletion_requested_at: typeof localStorage !== 'undefined' ? localStorage.getItem('mockDeletionRequestedAt') : null,
  rating_games: 30,
  // «Aulas (onde e com quem treinas)» (migration_lessons_14): Privado por omissão.
  lessons_visibility: 'private',
  // localStorage.mockOnboarding = 'true' → ecrã "Qual é o teu nível?" (Trello #288).
  ...(typeof localStorage !== 'undefined' && localStorage.getItem('mockOnboarding') === 'true' ? { rating_onboarded_at: null } : {}),
  // Foto fictícia (SVG local, sem pedido de rede) — sem isto o botão de
  // eliminar foto nunca aparece em localhost (só existe quando já há foto).
  avatar_url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#1F2937"/></svg>'),
}
const MOCK_ADMIN_ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const MOCK_ADMIN_MEMBERSHIP = {
  id: '00000000-0000-0000-0000-0000000000bb',
  user_id: MOCK_ADMIN_USER.id,
  organization_id: MOCK_ADMIN_ORG_ID,
  // localStorage.mockNotAdmin = 'true' → ver o Dev Org como membro normal
  // (ex.: o mix sem o «Adicionar jogador», Trello #534).
  is_admin: typeof localStorage === 'undefined' || localStorage.getItem('mockNotAdmin') !== 'true',
  is_guest: false,
  level: 'avançado',
  // Same shape as the organizations row devMockNetwork.js serves for this id —
  // a group created in Comunidade, owned by the dev admin — so the Gerir
  // header shows the GRUPO mark in localhost (Trello #177, #261).
  organization: {
    id: MOCK_ADMIN_ORG_ID, name: 'Dev Org', slug: 'dev-org',
    // localStorage.mockOrgKind = 'club' para ver o Gerir de um clube.
    kind: localStorage.getItem('mockOrgKind') || 'group', self_serve: true, owner_id: MOCK_ADMIN_USER.id,
    // localStorage.mockPlanTier (free/plus/pro/club) para ver os 4 planos.
    plan_tier: localStorage.getItem('mockPlanTier') || 'pro',
  },
}

// localStorage.mockTwoOrgs = 'true' adds a club the dev admin also manages,
// so the Gerir list (which only shows with 2+ organizations) can be checked
// with its Clubes and Grupos sections side by side.
const MOCK_ADMIN_CLUB_MEMBERSHIP = {
  id: '00000000-0000-0000-0000-0000000000cc',
  user_id: MOCK_ADMIN_USER.id,
  organization_id: '00000000-0000-0000-0000-0000000000dd',
  is_admin: true,
  is_guest: false,
  level: 'avançado',
  organization: {
    id: '00000000-0000-0000-0000-0000000000dd', name: 'Smash Padel Almada', slug: 'smash-padel',
    kind: 'club', self_serve: false, owner_id: MOCK_ADMIN_USER.id, plan_tier: 'club',
  },
}
// localStorage.mockNoOrgs = 'true' — jogador que não é membro de nada, para
// ver o Gerir de quem ainda não gere nada ("Criar grupo", Trello #279).
const mockAdminMemberships = () => (
  localStorage.getItem('mockNoOrgs') === 'true' ? [] :
  localStorage.getItem('mockTwoOrgs') === 'true'
    ? [MOCK_ADMIN_MEMBERSHIP, MOCK_ADMIN_CLUB_MEMBERSHIP]
    : [MOCK_ADMIN_MEMBERSHIP]
)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [currentOrganizationId, setCurrentOrganizationId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isPrivateMatchesEnabled, setIsPrivateMatchesEnabled] = useState(true)
  // Aulas (Trello #49): escondidas ate depois do Smash Cup (Francisco,
  // 24 set). Sem linha na tabela = desligado, por isso nao e preciso
  // escrever nada em producao para as esconder.
  const [isLessonsFlagOn, setIsLessonsFlagOn] = useState(false)
  // Criar/editar mix por passos (#342): bandeira `assistente_mix`. Desligada,
  // volta o formulário antigo (voltar atrás em segundos, sem publicar). Os
  // admins da plataforma veem-no sempre, para testar antes de ligar.
  const [isMixWizardFlagOn, setIsMixWizardFlagOn] = useState(false)
  // Set only once every retry in loadProfile has been exhausted — lets the
  // UI show a "couldn't load your data, try again" screen instead of
  // silently rendering as if the account had no profile/memberships (see
  // the 2026-08-24 Supabase platform incident that prompted this).
  const [profileError, setProfileError] = useState(false)
  // Superadmin e modo (Francisco, 18 out; base do Dev 3,
  // migration_superadmin_modo.sql): get_my_platform_admin() →
  // { is_platform_admin, mode_on }. null = a função ainda não existe ou
  // falhou: fica tudo como antes, pela marca do perfil, e sem interruptor.
  const [platformMode, setPlatformMode] = useState(null)

  useEffect(() => {
    // Restore dev admin bypass if it was activated previously.
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      setUser(MOCK_ADMIN_USER)
      setProfile(MOCK_ADMIN_PROFILE)
      setPlatformMode(MOCK_ADMIN_PROFILE.is_platform_admin
        ? { is_platform_admin: true, mode_on: localStorage.getItem('mockPlatformMode') !== 'off' } : null)
      setMemberships(mockAdminMemberships())
      setCurrentOrganizationId(MOCK_ADMIN_ORG_ID)
      // localStorage.mockPrivateMatchesOff = 'true' — ver a app com o
      // interruptor "Jogo entre amigos" desligado no Gerir.
      setIsPrivateMatchesEnabled(localStorage.getItem('mockPrivateMatchesOff') !== 'true')
      // localStorage.mockAssistenteMix = 'true' — o mix por passos (#342).
      setIsMixWizardFlagOn(localStorage.getItem('mockAssistenteMix') === 'true')
      setLoading(false)
      return
    }

    // Check active sessions. Without a .catch here, a rejected getSession()
    // (e.g. a transient network hiccup right after the OAuth redirect)
    // would leave `loading` stuck true forever — the whole app gated
    // behind an infinite spinner with no way out but a manual refresh.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setLoading(false)
      }
    }).catch((error) => {
      console.error('Error checking session:', error)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
        setPlatformMode(null)
        setMemberships([])
        setCurrentOrganizationId(null)
        setLoading(false)
        // A later sign-in is a real "boot" transition, not a background
        // refresh — let it show the splash again.
        initialLoadDoneRef.current = false
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // App das lojas: com sessão, notificações push (src/lib/push.js). No site
  // não faz nada.
  const userId = user?.id
  useEffect(() => {
    if (userId) enablePush()
  }, [userId])

  // Welcome email on the first session. Strictly `=== null`: the column only
  // exists once migration_welcome_email.sql has run (undefined before that,
  // and in the dev mock), and that migration marks every existing account
  // as already sent. The function refuses to send twice, so a retry after
  // a dropped request is harmless. Fire-and-forget like the other side
  // calls here — never blocks the profile load.
  const sendWelcomeEmail = (profileData) => {
    if (profileData?.welcome_emailed_at !== null) return
    supabase.functions
      .invoke('send-email', { body: { type: 'welcome' } })
      .then(({ error }) => {
        if (error) console.error('Welcome email not sent:', error)
      })
      .catch((error) => console.error('Welcome email not sent:', error))
  }

  // A origem da conta (19 out, Dev 3): entrega-se uma vez, depois da primeira
  // sessão. A base só grava em contas com menos de 48 h, uma vez, e nunca o
  // próprio ref (devolve false sem erro): em qualquer resposta sem erro, limpa.
  // Sem a função (PGRST202), fica guardada para a próxima vez.
  const deliverAccountOrigin = () => {
    const pending = pendingAccountOrigin()
    if (!pending) return
    supabase.rpc('set_my_account_origin', { p_origin: pending.origin, p_ref_code: pending.ref })
      .then(({ error }) => {
        if (!error) clearAccountOrigin()
        else if (error.code !== 'PGRST202') console.error('Account origin not saved:', error)
      })
  }

  const loadFeatureFlags = async () => {
    const { data, error } = await supabase.from('feature_flags').select('key, enabled')
    if (error) {
      console.error('Error loading feature flags:', error)
      return
    }
    const privateMatchesFlag = data?.find((f) => f.key === 'private_matches')
    setIsPrivateMatchesEnabled(privateMatchesFlag?.enabled ?? true)
    setIsLessonsFlagOn(data?.find((f) => f.key === 'lessons')?.enabled === true)
    setIsMixWizardFlagOn(data?.find((f) => f.key === 'assistente_mix')?.enabled === true)
  }

  // getSession() and onAuthStateChange (below) both call loadProfile on
  // mount, firing two near-simultaneous requests for the same user — this
  // ref lets the second call reuse the first's in-flight promise instead of
  // racing it (observed in prod logs as repeated 401s on the profile fetch
  // right after a fresh Google login, immediately following a successful
  // /auth/v1/user, which then left profile/memberships blank forever since
  // the old code only retried on PGRST116).
  const profileRequestRef = useRef(null)

  // `loading` drives App.jsx's full-screen splash, meant to show once per
  // app boot. onAuthStateChange calls loadProfile again on every Supabase
  // auth event though — including a silent background TOKEN_REFRESHED —
  // and without this guard each of those flipped `loading` true again,
  // flashing the splash over whatever page was open mid-navigation.
  const initialLoadDoneRef = useRef(false)

  // Backoff schedule for retrying a failed profile load (see the
  // 2026-08-24 Supabase platform incident that intermittently 401'd fresh
  // session JWTs at the API gateway for several seconds at a time) —
  // spread out further than the old single 600ms retry so the app can
  // outlast that kind of blip instead of giving up after one attempt.
  const PROFILE_RETRY_DELAYS_MS = [700, 1500, 3000]

  const loadProfile = (userId, attempt = 0) => {
    // Sessão de teste (Admin(Dev)): o perfil e os clubes vêm do mock e não
    // da base de dados. Sem isto, abrir um link ?org= em localhost recarregava
    // o perfil e dava «Não foi possível carregar os teus dados» (#447).
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') return Promise.resolve()
    const isInitialLoad = !initialLoadDoneRef.current
    if (attempt === 0) {
      if (profileRequestRef.current?.userId === userId) {
        return profileRequestRef.current.promise
      }
      if (isInitialLoad) setLoading(true)
      setProfileError(false)
    }

    const promise = (async () => {
      try {
        const { data: profileData, error: fetchError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        // Right after signup the profile trigger may not have committed yet
        // (PGRST116) — same retry path handles both that and a transient
        // gateway rejection.
        if (fetchError) throw fetchError
        setProfile(profileData)
        // O modo superadmin, em paralelo com o resto (não atrasa o perfil).
        const platformPromise = supabase.rpc('get_my_platform_admin')
        i18n.changeLanguage(profileData.language || 'pt')

        // Carry a pre-auth language choice (Landing/Login's toggle, stashed
        // in localStorage since there's no profile yet to persist it on)
        // forward into the account now that one exists — covers both a
        // brand-new signup (profiles.language defaults to 'pt' server-side
        // regardless of what was picked pre-auth) and a returning user
        // logging in on a browser where they'd earlier switched language.
        // Fire-and-forget, matching this function's other best-effort
        // side calls (loadFeatureFlags) — never
        // await/block the profile load on it.
        try {
          const storedLanguagePref = localStorage.getItem('preferredLanguage')
          if (storedLanguagePref && storedLanguagePref !== profileData.language) {
            updateProfile({ language: storedLanguagePref })
          }
        } catch {
          // ignore — localStorage can throw in some contexts
        }

        // After the language reconciliation above, so a pre-auth EN choice
        // has usually landed by the time the function reads profiles.language.
        sendWelcomeEmail(profileData)
        deliverAccountOrigin()
        loadMyRef()
        await loadFeatureFlags()

        let { data: membershipData, error: membershipError } = await supabase
          .from('memberships')
          .select('*, organization:organizations(*)')
          .eq('user_id', userId)

        if (membershipError) throw membershipError

        // Single-club phase: anyone who signs in with no membership at all
        // (no invite link, no pending slug) auto-joins the one existing club
        // instead of hitting a "pick a club" dead end. No slug/env var — the
        // RPC finds the single organization itself, and raises once a second
        // organization exists, so this sunsets automatically. The
        // invite-link/manual-join flow (Home.jsx) already handles the
        // multi-club case and keeps working unchanged.
        if ((membershipData?.length ?? 0) === 0) {
          const { error: autoJoinError } = await supabase.rpc('join_default_organization')
          if (autoJoinError) {
            console.error('Failed to auto-join default organization:', autoJoinError)
          } else {
            const { data: refetched, error: refetchError } = await supabase
              .from('memberships')
              .select('*, organization:organizations(*)')
              .eq('user_id', userId)
            if (refetchError) throw refetchError
            membershipData = refetched
          }
        }

        setMemberships(membershipData || [])
        {
          const { data: pa, error: paError } = await platformPromise
          setPlatformMode(!paError && pa && typeof pa === 'object' ? pa : null)
        }

        // Keep the previously-selected org if still a member of it, otherwise
        // default to the first membership. No switcher UI yet (not needed
        // until someone is regularly juggling 2+ orgs) — this is just the
        // fallback selection logic.
        setCurrentOrganizationId((prev) => {
          if (prev && membershipData?.some((m) => m.organization_id === prev)) return prev
          return membershipData?.[0]?.organization_id ?? null
        })

        setLoading(false)
        initialLoadDoneRef.current = true
      } catch (error) {
        if (attempt < PROFILE_RETRY_DELAYS_MS.length) {
          setTimeout(() => loadProfile(userId, attempt + 1), PROFILE_RETRY_DELAYS_MS[attempt])
          return
        }
        console.error('Error loading profile:', error)
        setProfileError(true)
        setLoading(false)
        initialLoadDoneRef.current = true
      } finally {
        if (attempt === 0) {
          profileRequestRef.current = null
        }
      }
    })()

    if (attempt === 0) {
      profileRequestRef.current = { userId, promise }
    }
    return promise
  }

  // Manual escape hatch for the "couldn't load your data" screen (App.jsx)
  // — re-runs the same retry-with-backoff loadProfile from attempt 0.
  // Devolve a promessa, para quem precisa de esperar pelo perfil novo
  // (ex.: «Já enviei» ao confirmar o número, #537).
  const retryProfile = () => {
    if (user) return loadProfile(user.id)
    return Promise.resolve()
  }

  // captchaToken: the Turnstile token (src/components/TurnstileWidget.jsx),
  // only sent when the widget produced one. Supabase ignores it while its
  // captcha toggle is off and requires it once the toggle is on.
  const signUp = async (email, password, userData, captchaToken) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData,
        // Na app das lojas, o link do email abre no alinho.pt (appHref): o
        // email pode ser aberto noutro aparelho, onde a app não está.
        emailRedirectTo: appHref(),
        ...(captchaToken ? { captchaToken } : {}),
      }
    })
    return { data, error }
  }

  const signIn = async (email, password, captchaToken) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    return { data, error }
  }

  // Sends the reset-password email. `redirectTo` must be on Supabase's
  // allow-list (Authentication → URL Configuration, dashboard config, not
  // code — see the domain-redirects note in CLAUDE.md) or the link in the
  // email silently fails to sign the visitor in on the other end.
  const resetPassword = async (email, captchaToken) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appOrigin()}/redefinir-password`,
      ...(captchaToken ? { captchaToken } : {}),
    })
    return { data, error }
  }

  // Only valid inside the recovery session Supabase establishes when the
  // visitor follows the email link — ResetPassword.jsx is the only caller.
  const updatePassword = async (newPassword) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword })
    return { data, error }
  }

  const signInWithGoogle = async () => {
    // Na app das lojas: o Google não deixa entrar dentro da app, por isso
    // abre-se no browser do telemóvel, e a volta vem por NATIVE_AUTH_CALLBACK
    // (nativeShell.js), com a página de onde se saiu no ?next=.
    if (IS_NATIVE) {
      const next = `${window.location.pathname}${window.location.search}`
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${NATIVE_AUTH_CALLBACK}?next=${encodeURIComponent(next)}`,
          skipBrowserRedirect: true,
        },
      })
      if (!error && data?.url) await Browser.open({ url: data.url })
      return { data, error }
    }
    // Preserve the current URL (including ?org=<slug>, if present) through
    // the OAuth round-trip — signInWithOAuth can't carry custom fields
    // through raw_user_meta_data the way email signUp can, so the org slug
    // has to survive in the redirect URL itself instead.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
        // A ida ao Google substitui o /login no histórico, em vez de o
        // empilhar: de volta à app, o «voltar» não cai outra vez no login
        // (Francisco, 4 out). Na volta, o AfterLogin também usa replace.
        skipBrowserRedirect: true,
      },
    })
    // Na app instalada no ecrã do iPhone, o Google abre por cima da app; com
    // replace() a app ficava sem página e, ao cancelar, aparecia tudo branco
    // (Francisco, 18 out). Aí vai com assign(), e o /login fica por baixo. No
    // browser fica o replace() (o «voltar» não cai outra vez no login, 4 out).
    const installed = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (!error && data?.url) {
      if (installed) window.location.assign(data.url)
      else window.location.replace(data.url)
    }
    return { data, error }
  }

  // Sign in with Apple, só na app de iPhone (Login.jsx mostra o botão). A
  // janela é a nativa da Apple; o token vai para o Supabase (provider
  // «apple», com o pt.alinho.app nos Client IDs). O nonce: à Apple vai o
  // hash, ao Supabase o original — é assim que ele confirma o token.
  const signInWithApple = async () => {
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const rawNonce = hex(crypto.getRandomValues(new Uint8Array(16)))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce))
    const hashedNonce = hex(new Uint8Array(digest))
    let response
    try {
      ;({ response } = await SignInWithApple.authorize({
        clientId: 'pt.alinho.app',
        redirectURI: NATIVE_AUTH_CALLBACK,
        scopes: 'email name',
        nonce: hashedNonce,
      }))
    } catch (err) {
      // 1001 = a pessoa fechou a janela da Apple.
      if (String(err?.message || err).includes('1001')) return { cancelled: true }
      return { error: err }
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: response.identityToken,
      nonce: rawNonce,
    })
    // A Apple só manda o nome no primeiro login (e só se a pessoa o
    // partilhar): grava-se logo, por cima do «Novo Utilizador» do trigger.
    const name = [response.givenName, response.familyName].filter(Boolean).join(' ').trim()
    if (!error && name && data?.user) {
      await supabase.auth.updateUser({ data: { name, full_name: name } })
      await supabase.from('profiles').update({ name }).eq('id', data.user.id).eq('name', 'Novo Utilizador')
    }
    return { data, error }
  }

  const signInAsAdmin = () => {
    localStorage.setItem(MOCK_ADMIN_KEY, 'true')
    installDevMockNetwork()
    setUser(MOCK_ADMIN_USER)
    setProfile(MOCK_ADMIN_PROFILE)
    setPlatformMode(MOCK_ADMIN_PROFILE.is_platform_admin
      ? { is_platform_admin: true, mode_on: localStorage.getItem('mockPlatformMode') !== 'off' } : null)
    setMemberships(mockAdminMemberships())
    setCurrentOrganizationId(MOCK_ADMIN_ORG_ID)
    setLoading(false)
  }

  const signOut = async () => {
    // Clear dev admin bypass if active.
    if (localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      localStorage.removeItem(MOCK_ADMIN_KEY)
      setUser(null)
      setProfile(null); setPlatformMode(null)
      setMemberships([])
      setCurrentOrganizationId(null)
      i18n.changeLanguage('pt')
      try {
        localStorage.removeItem('preferredLanguage')
      } catch {
        // ignore — localStorage can throw in some contexts
      }
      return { error: null }
    }

    // «Sair» sai sempre deste telemóvel. Se o servidor recusar — a sessão já
    // não existe lá (403 session_not_found, depois de trocar a palavra-passe,
    // de «sair de todos» ou de igualar a base), ou não há rede —, apaga-se a
    // sessão só aqui. Antes a chave ficava guardada e a pessoa ficava presa na
    // conta (QA/Francisco, 30 set).
    // Antes de sair: este telemóvel deixa de receber os avisos da conta (só
    // na app das lojas; precisa da sessão, por isso vem primeiro).
    await disablePush()
    const { error } = await supabase.auth.signOut()
    let forced = false
    if (error) {
      console.error('Sign out failed on the server, clearing this device only:', error)
      // O «local» ainda fala com o servidor e, se falhar, também não apaga
      // nada: por isso, no fim, apaga-se a chave à mão.
      const local = await supabase.auth.signOut({ scope: 'local' }).catch((e) => ({ error: e }))
      const key = supabase.auth.storageKey
      try {
        if (local?.error || (key && localStorage.getItem(key))) {
          if (key) {
            localStorage.removeItem(key)
            localStorage.removeItem(`${key}-code-verifier`)
            localStorage.removeItem(`${key}-user`)
          }
          forced = true
        }
      } catch {
        // ignore — localStorage can throw in some contexts
      }
    }
    setUser(null)
    setProfile(null); setPlatformMode(null)
    setMemberships([])
    setCurrentOrganizationId(null)
    i18n.changeLanguage('pt')
    try {
      localStorage.removeItem('preferredLanguage')
    } catch {
      // ignore — localStorage can throw in some contexts
    }
    // Com a chave apagada à mão, o cliente ainda tem a sessão em memória:
    // recarrega-se no ecrã de entrar, já sem ela.
    if (forced) window.location.assign('/login')
    return { error: null }
  }

  const updateProfile = async (updates) => {
    if (!user) return { error: new Error('No user logged in') }
    // Sessão fictícia: não há perfil a sério para gravar — muda-se só aqui,
    // para o ecrã seguir como seguiria (antes ficava com outro perfil).
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      let next = null
      setProfile((p) => (next = { ...p, ...updates }))
      return { data: next, error: null }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()

    if (!error) {
      setProfile(data)
    }

    return { data, error }
  }

  // Updates the caller's membership row in the CURRENT organization (e.g.
  // skill level — that lives per-org now, not on `profiles`).
  const updateMembership = async (updates) => {
    if (!user || !currentOrganizationId) return { error: new Error('No active organization') }

    const { data, error } = await supabase
      .from('memberships')
      .update(updates)
      .eq('user_id', user.id)
      .eq('organization_id', currentOrganizationId)
      .select('*, organization:organizations(*)')
      .single()

    if (!error) {
      setMemberships((prev) => prev.map((m) => (m.id === data.id ? data : m)))
    }

    return { data, error }
  }

  // Toggles the caller's favorite flag on an arbitrary club membership (not
  // necessarily the current org — Clubes & Grupos lists every club the
  // user follows, not just the active one). Favorited clubs' mixs float to
  // the top of Home's "Próximos jogos".
  const toggleFavoriteOrganization = async (organizationId, isFavorite) => {
    if (!user) return { error: new Error('No user logged in') }

    const { data, error } = await supabase
      .from('memberships')
      .update({ is_favorite: isFavorite })
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .select('*, organization:organizations(*)')
      .single()

    if (!error) {
      setMemberships((prev) => prev.map((m) => (m.id === data.id ? data : m)))
    }

    return { data, error }
  }

  // Attaches the current user to an organization by slug — used by both
  // signup paths (email/password and Google) right after auth completes,
  // whenever there's a pending ?org=<slug> to consume.
  const joinOrganization = async (slug) => {
    const { data, error } = await supabase.rpc('join_organization', { p_slug: slug })
    if (!error && user) {
      await loadProfile(user.id)
    }
    return { data, error }
  }

  // Follows (joins immediately, or requests to join) a public "is_global"
  // organization from the Clubes & Grupos directory — mirrors
  // follow_organization()'s own 'joined' | 'pending' return value so the
  // caller can update its button state without a second round trip.
  const followOrganization = async (organizationId) => {
    const { data, error } = await supabase.rpc('follow_organization', { p_organization_id: organizationId })
    if (!error && data === 'joined' && user) {
      await loadProfile(user.id)
    }
    return { data, error }
  }

  // Platform-admin-only: grants the caller an admin membership in any club,
  // so opening its Gerir page for the first time works instead of hitting
  // "Sem acesso". Reloads memberships afterward, same as followOrganization,
  // so adminOrganizations/currentMembership pick up the new club right away.
  const ensureOrgAdminAccess = async (organizationId) => {
    const { error } = await supabase.rpc('platform_admin_ensure_org_access', { p_organization_id: organizationId })
    if (!error && user) {
      await loadProfile(user.id)
    }
    return { error }
  }

  // Leaves a club the caller currently belongs to. Blocked server-side if
  // the caller is that org's last admin.
  const leaveOrganization = async (organizationId) => {
    const { error } = await supabase.rpc('leave_organization', { p_organization_id: organizationId })
    if (!error && user) {
      await loadProfile(user.id)
    }
    return { error }
  }

  // Re-reads profile + memberships from the server. Needed after any action
  // that creates/changes a membership server-side without going through one
  // of the wrappers above (e.g. create_group, which inserts an admin
  // membership for the caller) — otherwise the client's memberships array
  // stays stale until a full page reload.
  const refreshMemberships = async () => {
    if (!user) return
    // Dev bypass: the fake admin has no profiles row, so reloading it ended
    // on "Não foi possível carregar os teus dados" after any admin action
    // (passar a posse, mudar plano). Keep the mock data instead.
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') return
    await loadProfile(user.id)
  }

  const switchOrganization = (organizationId) => {
    setCurrentOrganizationId(organizationId)
  }

  const currentMembership = memberships.find((m) => m.organization_id === currentOrganizationId) ?? null

  // O perfil que os ecrãs leem: com a função do modo, is_platform_admin só é
  // true com o modo ligado, e is_platform_admin_account diz se a conta é
  // superadmin (para o interruptor no Gerir). Os ~15 sítios que leem
  // profile.is_platform_admin passam a respeitar o modo sem mudar nada.
  const shownProfile = useMemo(() => (profile && platformMode
    ? { ...profile, is_platform_admin: platformMode.mode_on === true, is_platform_admin_account: platformMode.is_platform_admin === true }
    : profile), [profile, platformMode])

  // O interruptor «Modo superadmin». Depois de mudar, volta a ler o perfil e
  // as inscrições (em modo normal vê só os seus grupos).
  const setPlatformAdminMode = async (on) => {
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      try { localStorage.setItem('mockPlatformMode', on ? 'on' : 'off') } catch { /* modo privado */ }
      setPlatformMode((m) => (m ? { ...m, mode_on: !!on } : m))
      return { error: null }
    }
    const { data, error } = await supabase.rpc('set_platform_admin_mode', { p_on: !!on })
    if (error) return { error }
    if (data && typeof data === 'object') setPlatformMode(data)
    if (user) await loadProfile(user.id)
    return { error: null }
  }

  const value = {
    user,
    profile: shownProfile,
    memberships,
    currentOrganizationId,
    currentOrganization: currentMembership?.organization ?? null,
    currentMembership,
    adminOrganizations: memberships.filter((m) => m.is_admin).map((m) => m.organization),
    isAdminOfAny: memberships.some((m) => m.is_admin),
    isAdmin: currentMembership?.is_admin === true,
    isGuest: currentMembership?.is_guest === true,
    loading,
    profileError,
    retryProfile,
    isPrivateMatchesEnabled,
    // O que o interruptor diz, e o que a pessoa ve: a equipa Alinho ve as
    // aulas mesmo desligadas, para as poder testar (Francisco, 24 set).
    isLessonsFlagOn,
    isLessonsEnabled: isLessonsFlagOn || shownProfile?.is_platform_admin === true,
    isMixWizardEnabled: isMixWizardFlagOn || shownProfile?.is_platform_admin === true,
    refreshFeatureFlags: loadFeatureFlags,
    signUp,
    signIn,
    resetPassword,
    updatePassword,
    signInWithGoogle,
    signInWithApple,
    signInAsAdmin,
    signOut,
    updateProfile,
    updateMembership,
    toggleFavoriteOrganization,
    joinOrganization,
    followOrganization,
    ensureOrgAdminAccess,
    leaveOrganization,
    refreshMemberships,
    switchOrganization,
    setPlatformAdminMode,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
