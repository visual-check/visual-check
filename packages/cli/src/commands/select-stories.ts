import type { Story } from '../storybook/read-stories.js'

/**
 * Which of a Storybook's stories a run takes: every story, the stories whose ID a pattern matches, or the affected
 * stories: those of some stories files plus some stories by ID.
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
       * The stories of `storiesFiles` and the stories of `storyIds` are kept.
       */
      kind: 'affected'
      /**
       * The stories files whose stories are kept, as the import paths `index.json` gives them.
       */
      storiesFiles: ReadonlySet<string>
      /**
       * The IDs of the stories kept besides those of `storiesFiles`.
       */
      storyIds: ReadonlySet<string>
    }

/**
 * Keeps the stories a run takes, in their order. `all` keeps every story, `filter` the stories whose ID the pattern
 * matches, and `affected` the stories whose import path is one of the stories files or whose ID is one of the story
 * IDs.
 */
export function selectStories(stories: Story[], choice: StoryChoice): Story[] {
  if (choice.kind === 'filter') {
    return stories.filter((story) => choice.pattern.test(story.id))
  }

  if (choice.kind === 'affected') {
    return stories.filter((story) => choice.storiesFiles.has(story.importPath) || choice.storyIds.has(story.id))
  }

  return stories
}
