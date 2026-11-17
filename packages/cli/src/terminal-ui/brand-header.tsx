import { Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { glyphs } from './theme.js'

/**
 * What `BrandHeader` takes.
 */
interface BrandHeaderProps {
  /**
   * The command that runs, such as `init`.
   */
  command: string
  /**
   * The CLI's version, without the `v`.
   */
  version: string
}

/**
 * The first line a command draws: the mark, a check printed twice off register in the cyan and magenta plates, then
 * the name, the command and the version.
 */
export function BrandHeader({ command, version }: BrandHeaderProps): ReactNode {
  return (
    <Text>
      <ColouredText colour="brandCyan">{glyphs.passed}</ColouredText>
      <ColouredText colour="brandMagenta">{glyphs.passed}</ColouredText> <Text bold>visual-check</Text>
      <Text dimColor>{` ${command} ${glyphs.hint} v${version}`}</Text>
    </Text>
  )
}
