import { describe, expect, it } from 'vitest'
import { readWorkspaceManifests, repoRoot } from '../workspace/manifests.ts'
import { findPlaywrightDependents } from './no-playwright.ts'

describe('findPlaywrightDependents', () => {
  it('returns nothing when no package depends on Playwright', () => {
    expect(findPlaywrightDependents([{ name: 'a', version: '1.0.0', dependencies: { zod: '1.0.0' } }])).toEqual([])
  })

  it('reports a published package with a Playwright peer dependency', () => {
    expect(
      findPlaywrightDependents([{ name: 'a', version: '1.0.0', peerDependencies: { 'playwright-core': '*' } }]),
    ).toEqual(['a: playwright-core'])
  })

  it('reports a Playwright optional dependency', () => {
    expect(
      findPlaywrightDependents([{ name: 'a', version: '1.0.0', optionalDependencies: { '@playwright/test': '*' } }]),
    ).toEqual(['a: @playwright/test'])
  })

  it('ignores private packages', () => {
    expect(
      findPlaywrightDependents([{ name: 'a', version: '1.0.0', private: true, dependencies: { playwright: '*' } }]),
    ).toEqual([])
  })

  it('finds no Playwright dependents in the real workspace', () => {
    expect(findPlaywrightDependents(readWorkspaceManifests(repoRoot))).toEqual([])
  })
})
