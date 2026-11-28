/**
 * What a note shows.
 */
interface NoteProps {
  /**
   * The note's text.
   */
  text: string
}

/**
 * A line of text in a fixed font size, which the network and page errors stories show.
 */
export function Note({ text }: NoteProps) {
  return <p style={{ margin: 0, fontFamily: 'sans-serif', fontSize: 14 }}>{text}</p>
}

/**
 * The body of the document of the canvas's iframe, or `undefined` while that document isn't reachable.
 */
export function frameBodyOf(canvasElement: HTMLElement): HTMLElement | undefined {
  return canvasElement.querySelector('iframe')?.contentDocument?.body ?? undefined
}
