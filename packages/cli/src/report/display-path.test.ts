import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayPathOf } from './display-path.js'

describe('displayPathOf', () => {
  const project = join('/', 'project')

  it('writes a path inside the folder relative to it, with /', () => {
    expect(displayPathOf(project, join(project, '.visual-check', 'baselines', 'a.png'))).toBe(
      '.visual-check/baselines/a.png',
    )
  })

  it('climbs out of the folder with .. for a path outside it', () => {
    expect(displayPathOf(join(project, 'packages', 'web'), join(project, 'a.png'))).toBe('../../a.png')
  })
})
