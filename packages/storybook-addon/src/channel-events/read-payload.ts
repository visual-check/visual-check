/**
 * The longest ID a payload may hold, in characters.
 */
const longestId = 1000

/**
 * Reads a field of a payload as an ID, or gives `undefined` when it isn't a string of 1 to 1000 characters.
 */
function readId(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const id = (value as Partial<Record<string, unknown>>)[field]

  return typeof id === 'string' && id !== '' && id.length <= longestId ? id : undefined
}

/**
 * Reads the payload of a `check` or `update` event, which anyone who reaches Storybook's WebSocket may have sent. Gives
 * `undefined` for one that names no story.
 *
 * @public
 */
export function readStoryPayload(value: unknown): { storyId: string } | undefined {
  const storyId = readId(value, 'storyId')

  return storyId === undefined ? undefined : { storyId }
}

/**
 * Reads the payload of a `cancel` event, which anyone who reaches Storybook's WebSocket may have sent. Gives `undefined`
 * for one that names no run.
 *
 * @public
 */
export function readCancelPayload(value: unknown): { id: string } | undefined {
  const id = readId(value, 'id')

  return id === undefined ? undefined : { id }
}
