import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import i18n from '../lib/i18n'

const AuthContext = createContext({})

// Dev-only bypass: fake admin session so we can enter the app without an account.
const MOCK_ADMIN_KEY = 'mockAdminSession'
const MOCK_ADMIN_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'admin@dev.local',
}
const MOCK_ADMIN_PROFILE = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'admin@dev.local',
  name: 'Admin (Dev)',
  gender: 'masculino',
  phone_hash: 'dev-bypass', // dummy — skips the mandatory-phone modal for the dev bypass
}
const MOCK_ADMIN_ORG_ID = '00000000-0000-0000-0000-0000000000aa'
const MOCK_ADMIN_MEMBERSHIP = {
  id: '00000000-0000-0000-0000-0000000000bb',
  user_id: MOCK_ADMIN_USER.id,
  organization_id: MOCK_ADMIN_ORG_ID,
  is_admin: true,
  is_guest: false,
  level: 'avançado',
  organization: { id: MOCK_ADMIN_ORG_ID, name: 'Dev Org', slug: 'dev-org' },
}

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
  // Set only once every retry in loadProfile has been exhausted — lets the
  // UI show a "couldn't load your data, try again" screen instead of
  // silently rendering as if the account had no profile/memberships (see
  // the 2026-08-24 Supabase platform incident that prompted this).
  const [profileError, setProfileError] = useState(false)

  useEffect(() => {
    // Restore dev admin bypass if it was activated previously.
    if (import.meta.env.DEV && localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      setUser(MOCK_ADMIN_USER)
      setProfile(MOCK_ADMIN_PROFILE)
      setMemberships([MOCK_ADMIN_MEMBERSHIP])
      setCurrentOrganizationId(MOCK_ADMIN_ORG_ID)
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

  // Consumes a pending org slug (if any) by attaching the now-authenticated
  // user to that organization. Read from sessionStorage, NOT the live URL —
  // App.jsx redirects away from /login the instant `user` is set, and for
  // Google sign-in the auth-state-change → loadProfile chain races that
  // client-side navigation, so by the time this runs window.location.search
  // may already have been stripped. sessionStorage survives both that route
  // change and the full-page OAuth redirect itself (Login.jsx writes it on
  // mount, before anything can navigate away). Idempotent (DB-side ON
  // CONFLICT DO NOTHING) and a no-op when nothing is pending.
  const consumePendingOrgSlug = async () => {
    const slug = sessionStorage.getItem('pendingOrgSlug')
    if (!slug) return
    sessionStorage.removeItem('pendingOrgSlug')

    const { error } = await supabase.rpc('join_organization', { p_slug: slug })
    if (error) console.error('Failed to join organization from pending slug:', error)
  }

  const loadFeatureFlags = async () => {
    const { data, error } = await supabase.from('feature_flags').select('key, enabled')
    if (error) {
      console.error('Error loading feature flags:', error)
      return
    }
    const privateMatchesFlag = data?.find((f) => f.key === 'private_matches')
    setIsPrivateMatchesEnabled(privateMatchesFlag?.enabled ?? true)
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
        i18n.changeLanguage(profileData.language || 'pt')

        await consumePendingOrgSlug()
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
  const retryProfile = () => {
    if (user) loadProfile(user.id)
  }

  const signUp = async (email, password, userData) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData,
        emailRedirectTo: window.location.href,
      }
    })
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signInWithGoogle = async () => {
    // Preserve the current URL (including ?org=<slug>, if present) through
    // the OAuth round-trip — signInWithOAuth can't carry custom fields
    // through raw_user_meta_data the way email signUp can, so the org slug
    // has to survive in the redirect URL itself instead.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
      },
    })
    return { data, error }
  }

  const signInAsAdmin = () => {
    localStorage.setItem(MOCK_ADMIN_KEY, 'true')
    setUser(MOCK_ADMIN_USER)
    setProfile(MOCK_ADMIN_PROFILE)
    setMemberships([MOCK_ADMIN_MEMBERSHIP])
    setCurrentOrganizationId(MOCK_ADMIN_ORG_ID)
    setLoading(false)
  }

  const signOut = async () => {
    // Clear dev admin bypass if active.
    if (localStorage.getItem(MOCK_ADMIN_KEY) === 'true') {
      localStorage.removeItem(MOCK_ADMIN_KEY)
      setUser(null)
      setProfile(null)
      setMemberships([])
      setCurrentOrganizationId(null)
      i18n.changeLanguage('pt')
      return { error: null }
    }

    const { error } = await supabase.auth.signOut()
    if (!error) {
      setUser(null)
      setProfile(null)
      setMemberships([])
      setCurrentOrganizationId(null)
      i18n.changeLanguage('pt')
    }
    return { error }
  }

  const updateProfile = async (updates) => {
    if (!user) return { error: new Error('No user logged in') }

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
    await loadProfile(user.id)
  }

  const switchOrganization = (organizationId) => {
    setCurrentOrganizationId(organizationId)
  }

  const currentMembership = memberships.find((m) => m.organization_id === currentOrganizationId) ?? null

  const value = {
    user,
    profile,
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
    refreshFeatureFlags: loadFeatureFlags,
    signUp,
    signIn,
    signInWithGoogle,
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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
