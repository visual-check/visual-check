import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reportLineOf } from './run-output.js'

describe('reportLineOf', () => {
  it("gives report.json's path relative to the cwd, with /", () => {
    const project = join('/', 'project')
    const folder = join(project, '.visual-check', 'report')

    expect(reportLineOf(project, folder)).toBe('Report: .visual-check/report/report.json')
    expect(reportLineOf(join(project, 'packages', 'web'), folder)).toBe(
      'Report: ../../.visual-check/report/report.json',
    )
  })
})
