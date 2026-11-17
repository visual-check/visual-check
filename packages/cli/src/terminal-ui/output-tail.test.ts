import { describe, expect, it } from 'vitest'
import { emptyOutputTail, type OutputTail, outputTailOf, shownLinesOf } from './output-tail.js'

/**
 * Adds each chunk in turn to an empty tail.
 */
function tailOf(...chunks: string[]): OutputTail {
  return chunks.reduce(outputTailOf, emptyOutputTail)
}

describe('outputTailOf', () => {
  it('splits a chunk into lines at line feeds and Windows line ends, and keeps the line still being written', () => {
    expect(tailOf('one\ntwo\r\nthr')).toEqual({ lines: ['one', 'two'], unfinished: 'thr' })
  })

  it('keeps only the last drawing of a line a progress bar draws again after carriage returns', () => {
    expect(tailOf('Installing\n10%\r50%\r', '90%\r100%\nDone')).toEqual({
      lines: ['Installing', '100%'],
      unfinished: 'Done',
    })
  })

  it('keeps only the last drawing of the line still being written', () => {
    expect(tailOf('10%\r50%\r', '90%')).toEqual({ lines: [], unfinished: '90%' })
  })

  it('finishes a line whose Windows line end is split across chunks', () => {
    expect(tailOf('two\r', '\nthree')).toEqual({ lines: ['two'], unfinished: 'three' })
  })

  it('finishes a line that arrived in two chunks', () => {
    expect(tailOf('Downloa', 'ding\nDone')).toEqual({ lines: ['Downloading'], unfinished: 'Done' })
  })

  it('drops the lines that hold only spaces', () => {
    expect(tailOf('one\n\n   \n\ttwo\n')).toEqual({ lines: ['one', '\ttwo'], unfinished: '' })
  })

  it('keeps only the last fifteen finished lines', () => {
    const numbers = Array.from({ length: 17 }, (_, index) => `${index + 1}`)

    expect(tailOf(`${numbers.slice(0, 3).join('\n')}\n`, `${numbers.slice(3).join('\n')}\n`)).toEqual({
      lines: numbers.slice(2),
      unfinished: '',
    })
  })

  it('strips ANSI escapes from a finished line, even one split across chunks', () => {
    expect(tailOf('\u001b[3', '2mgreen\u001b[39m\n')).toEqual({ lines: ['green'], unfinished: '' })
  })
})

describe('shownLinesOf', () => {
  it('shows nothing for an empty tail', () => {
    expect(shownLinesOf(emptyOutputTail, 3)).toEqual([])
  })

  it('shows the last drawing of the unfinished line, before a carriage return that draws nothing yet', () => {
    expect(shownLinesOf({ lines: [], unfinished: '50%\r' }, 3)).toEqual(['50%'])
  })

  it('shows the finished lines, then the unfinished one without its ANSI escapes', () => {
    expect(shownLinesOf({ lines: ['one'], unfinished: '\u001b[1mtwo' }, 3)).toEqual(['one', 'two'])
  })

  it('leaves out an unfinished line that holds only spaces or escapes', () => {
    expect(shownLinesOf({ lines: ['one'], unfinished: ' \u001b[0m' }, 3)).toEqual(['one'])
  })

  it('shows at most `count` lines, the unfinished one last', () => {
    expect(shownLinesOf({ lines: ['1', '2', '3', '4', '5'], unfinished: '6' }, 3)).toEqual(['4', '5', '6'])
  })
})
