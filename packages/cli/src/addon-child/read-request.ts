import type { AddonRequest } from './protocol.js'

/**
 * Whether each of the fields holds a non-empty string.
 */
function hasTexts<Field extends string>(
  message: Partial<Record<string, unknown>>,
  fields: readonly Field[],
): message is Record<Field, string> {
  return fields.every((field) => typeof message[field] === 'string' && message[field] !== '')
}

/**
 * Reads a message the child got as a request, with the fields it knows. Gives `undefined` for anything else: an unknown
 * `kind`, or a field that isn't a non-empty string.
 */
export function readAddonRequest(message: unknown): AddonRequest | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined
  }

  const { kind }: { kind?: unknown } = message

  if ((kind === 'check' || kind === 'update') && hasTexts(message, ['id', 'storyId', 'configDir', 'url'])) {
    const { id, storyId, configDir, url } = message

    return { kind, id, storyId, configDir, url }
  }

  if (kind === 'cancel' && hasTexts(message, ['id'])) {
    return { kind, id: message.id }
  }

  return undefined
}
