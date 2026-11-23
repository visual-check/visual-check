import React, { type ReactNode, useEffect, useState } from 'react'
import { AddonPanel } from 'storybook/internal/components'
import { useStorybookApi, useStorybookState } from 'storybook/manager-api'
import { type StorybookTheme, useTheme } from 'storybook/theming'
import { staticCommandsOf } from '../static-build/static-commands.js'
import { storyOf } from './addon-panel.js'
import { panelCssOf } from './panel-css.js'
import type { PanelStory } from './panel-view.js'

/**
 * How long a copy button says how the copy went.
 */
const copiedForMs = 2000

/**
 * What `StaticPanelView` takes.
 */
interface StaticPanelViewProps {
  /**
   * The current story, or `null` when there is none, as on a docs page.
   */
  story: PanelStory | null
  /**
   * The Storybook's name in visual-check's config when the build was made, or `''` when it had none.
   */
  storybook: string
  /**
   * The address the build is served at.
   */
  address: string
}

/**
 * What `StaticPanel` takes.
 */
interface StaticPanelProps extends Omit<StaticPanelViewProps, 'story'> {
  /**
   * Whether the panel is the one that shows.
   */
  active: boolean
}

/**
 * What `Command` takes.
 */
interface CommandProps {
  /**
   * What the command does, said before it.
   */
  label: string
  /**
   * The command.
   */
  command: string
}

/**
 * Writes a command to the clipboard, and gives what its button says about how that went.
 */
export async function copiedLabelOf(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard,
): Promise<string> {
  try {
    await clipboard.writeText(text)

    return 'Copied'
  } catch {
    return 'Copy failed'
  }
}

/**
 * A command, and a button that copies it and says for a while how that went.
 */
function Command({ label, command }: CommandProps): ReactNode {
  // A new object for each copy, so a click while the button says how the last one went starts the time again.
  const [copied, setCopied] = useState<{ label: string } | null>(null)

  useEffect(() => {
    if (copied === null) {
      return undefined
    }

    const timer = setTimeout(() => setCopied(null), copiedForMs)

    return () => clearTimeout(timer)
  }, [copied])

  const onClick = () => {
    copiedLabelOf(command).then((copiedLabel) => setCopied({ label: copiedLabel }))
  }

  return (
    <>
      <p>{label}</p>
      <pre data-visual-check="static-command">{command}</pre>
      <button type="button" data-visual-check="copy" onClick={onClick}>
        {copied?.label ?? 'Copy'}
      </button>
    </>
  )
}

/**
 * What the static panel shows of the story: the commands that check it and rewrite its baselines.
 */
function StaticBody({ story, storybook, address }: StaticPanelViewProps): ReactNode {
  if (story === null) {
    return <p data-visual-check="empty">Select a story to see its commands.</p>
  }

  if (storybook === '') {
    return (
      <p data-visual-check="static-no-name">
        visual-check found no entry for this Storybook in its config when this build was made. Run visual-check init,
        then build it again.
      </p>
    )
  }

  const { test, update } = staticCommandsOf({ storybook, storyId: story.id, address })

  return (
    <>
      <p>
        This is a static build, so the panel can't run visual-check. With the build served here, run these in the
        project:
      </p>
      <Command label="Check this story:" command={test} />
      <Command label="Rewrite its baselines:" command={update} />
      <p data-visual-check="static-note">
        That update also writes this Storybook's other missing baselines and deletes its orphans, as every update does.
      </p>
    </>
  )
}

/**
 * The panel of a static build, on the story it is given.
 */
export function StaticPanelView(props: StaticPanelViewProps): ReactNode {
  return (
    <div data-visual-check="panel">
      <style>{panelCssOf(useTheme() as StorybookTheme)}</style>
      <StaticBody {...props} />
    </div>
  )
}

/**
 * visual-check's panel in a static build, on the story that is selected.
 *
 * @public
 */
export function StaticPanel({ active, storybook, address }: StaticPanelProps): ReactNode {
  // The current entry comes from the API, which doesn't render this again when another one is selected. The state does.
  useStorybookState()

  const entry = useStorybookApi().getCurrentStoryData()

  return (
    <AddonPanel active={active}>
      <StaticPanelView story={storyOf(entry)} storybook={storybook} address={address} />
    </AddonPanel>
  )
}
