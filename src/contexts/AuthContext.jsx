import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

  const loadProfile = async (userId, retried = false) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (profileError) {
        // Right after signup the profile trigger may not have committed yet — retry once.
        if (profileError.code === 'PGRST116' && !retried) {
          setTimeout(() => loadProfile(userId, true), 600)
          return
        }
        throw profileError
      }
      setProfile(profileData)

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
    } catch (error) {
      console.error('Error loading profile:', error)
    } finally {
      setLoading(false)
    }
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
      return { error: null }
    }

    const { error } = await supabase.auth.signOut()
    if (!error) {
      setUser(null)
      setProfile(null)
      setMemberships([])
      setCurrentOrganizationId(null)
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
    isAdmin: currentMembership?.is_admin === true,
    isGuest: currentMembership?.is_guest === true,
    loading,
    isPrivateMatchesEnabled,
    refreshFeatureFlags: loadFeatureFlags,
    signUp,
    signIn,
    signInWithGoogle,
    signInAsAdmin,
    signOut,
    updateProfile,
    updateMembership,
    joinOrganization,
    switchOrganization,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
