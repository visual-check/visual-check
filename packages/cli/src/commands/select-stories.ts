import type { Story } from '../storybook/read-stories.js'

/**
 * Which of a Storybook's stories a run takes: every story, the stories whose ID a pattern matches, or the stories of
 * some stories files.
 */
export type StoryChoice =
  | {
      /**
       * Every story is kept.
       */
      kind: 'all'
    }
  | {
      /**
       * The stories whose ID `pattern` matches are kept.
       */
      kind: 'filter'
      /**
       * The pattern a kept story's ID matches, unanchored.
       */
      pattern: RegExp
    }
  | {
      /**
       * The stories of `storiesFiles` are kept.
       */
      kind: 'stories-files'
      /**
       * The stories files whose stories are kept, as the import paths `index.json` gives them.
       */
      storiesFiles: ReadonlySet<string>
    }

/**
 * Keeps the stories a run takes, in their order. `all` keeps every story, `filter` the stories whose ID the pattern
 * matches, and `stories-files` the stories whose import path is one of the stories files.
 */
export function selectStories(stories: Story[], choice: StoryChoice): Story[] {
  if (choice.kind === 'filter') {
    return stories.filter((story) => choice.pattern.test(story.id))
  }

  if (choice.kind === 'stories-files') {
    return stories.filter((story) => choice.storiesFiles.has(story.importPath))
  }

  return stories
}
