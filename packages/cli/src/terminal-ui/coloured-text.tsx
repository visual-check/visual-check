import { Text, type TextProps } from 'ink'
import { type ReactNode, useContext } from 'react'
import { type Colour, colours, ThemeContext } from './theme.js'

/**
 * What `ColouredText` takes: Ink's text props, with a theme colour in place of a raw one.
 */
type ColouredTextProps = Omit<TextProps, 'color' | 'backgroundColor'> & {
  /**
   * The theme colour the text takes while the theme has colour on.
   */
  colour: Colour
}

/**
 * Text in a theme colour, or in the terminal's own colour when the theme has colour off. Bold, dim and inverse stay
 * either way, because they are not colours.
 */
export function ColouredText({ colour, ...textProps }: ColouredTextProps): ReactNode {
  const theme = useContext(ThemeContext)

  if (!theme.colour) {
    return <Text {...textProps} />
  }

  return <Text color={colours[colour]} {...textProps} />
}
