import { describe, it, expect } from 'vitest'
import { normalizeGameOrgHint } from './gameOrgHint'

describe('de que grupo é um jogo fechado (SPEC 2026-10-01)', () => {
  it('get_game_org_hint: grupo que se vê de fora', () => {
    expect(normalizeGameOrgHint([{ org_name: 'Jota Padeleiros', org_slug: 'jota', org_kind: 'group', org_logo_url: null, org_visible: true }]))
      .toEqual({ visible: true, name: 'Jota Padeleiros', slug: 'jota', kind: 'group', logoUrl: null })
  })
  it('get_game_org_hint: privado não traz nome', () => {
    expect(normalizeGameOrgHint([{ org_name: null, org_slug: null, org_kind: 'group', org_logo_url: null, org_visible: false }]).name).toBeNull()
  })
  it('game_owner_org: as duas formas', () => {
    expect(normalizeGameOrgHint({ name: 'Smash', slug: 'smash', kind: 'club', group_logo_url: 'x', private: false }).visible).toBe(true)
    expect(normalizeGameOrgHint({ private: true }).visible).toBe(false)
  })
  it('sem linhas: null', () => {
    expect(normalizeGameOrgHint([])).toBeNull()
    expect(normalizeGameOrgHint(null)).toBeNull()
  })
})
