import type { Story } from '../storybook/read-stories.js'
import type { Selection } from './parse-command-line.js'

/**
 * Keeps the stories a run covers. `default` and `all` keep every story; `default` becomes the affected stories with
 * #77. `filter` keeps the stories whose ID the pattern matches.
 */
export function selectStories(stories: Story[], selection: Selection): Story[] {
  if (selection.kind === 'filter') {
    return stories.filter((story) => selection.pattern.test(story.id))
  }

  return stories
}
