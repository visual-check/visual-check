import { Component, computed, ElementRef, InjectionToken, inject, input, type OnInit, Renderer2 } from '@angular/core'
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular'
import { combinations } from '@visual-check/storybook/angular'
import {
  accentColor,
  type ChipProps,
  chipStyleOf,
  everyCombinationPlay,
  forcedStatesPlay,
  type LateChipProps,
  lateBaseRule,
  lateChipClassOf,
  lateChipLabels,
  lateChipStyle,
  lateStylesPlay,
  longTitle,
  type StateChipProps,
  stateChipClassOf,
  stateChipStyles,
} from '../../storybook-10-react/stories/grid-parts'

/**
 * The colour of an accent chip. The meta's `moduleMetadata` provides `accentColor`, green, and a chip injects it with a
 * red default, so a red chip in a snapshot means the injector didn't reach the grid's cells.
 */
const accentToken = new InjectionToken<string>('accent')

/**
 * The accent a chip injects when nothing provides one: red, so a red chip means the injector missed its cell.
 */
const missingAccent = '#dc2626'

/**
 * A rounded chip, whose accent colour is injected. Its inputs are signal inputs.
 */
@Component({
  selector: 'vc-chip',
  standalone: true,
  template: '<span [attr.title]="title() ?? null" [style]="chipStyle()">{{ label() }}</span>',
})
class Chip {
  /**
   * The chip's text.
   */
  readonly label = input.required<ChipProps['label']>()

  /**
   * Its colours.
   */
  readonly tone = input.required<ChipProps['tone']>()

  /**
   * Its padding and font size.
   */
  readonly size = input.required<ChipProps['size']>()

  /**
   * The tooltip, which the snapshot doesn't show.
   */
  readonly title = input<ChipProps['title']>()

  /**
   * The accent the story provides, or red when the injector misses the cell.
   */
  readonly accent = inject(accentToken, { optional: true }) ?? missingAccent

  /**
   * The chip's inline style, from its tone, size and accent.
   */
  readonly chipStyle = computed(() => chipStyleOf({ tone: this.tone(), size: this.size() }, this.accent))
}

/**
 * A real `<style>` element in the canvas, holding `css`, with `marker` set to `"true"` when given. Angular pulls a
 * template's `<style>` out into the component's scoped styles, so a story template can't hold one, and the `play`
 * checks need real `<style>` elements in the canvas. The element is made with `Renderer2` and appended to the host.
 */
@Component({
  selector: 'vc-style',
  standalone: true,
  template: '',
})
class StyleTag implements OnInit {
  /**
   * The CSS the `<style>` holds.
   */
  readonly css = input('')

  /**
   * The data attribute the `<style>` carries, set to `"true"`, as React writes a boolean one.
   */
  readonly marker = input<string>()

  /**
   * The renderer that makes the `<style>`.
   */
  private readonly renderer = inject(Renderer2)

  /**
   * The host element the `<style>` goes into.
   */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef)

  /**
   * Makes the `<style>` and appends it to the host.
   */
  ngOnInit(): void {
    const style = this.renderer.createElement('style')

    const marker = this.marker()

    if (marker !== undefined) {
      this.renderer.setAttribute(style, marker, 'true')
    }

    this.renderer.appendChild(style, this.renderer.createText(this.css()))
    this.renderer.appendChild(this.host.nativeElement, style)
  }
}

/**
 * The grid stories, drawn in Angular with `combinations()` from `@visual-check/storybook/angular`, with the same
 * elements and styles as `storybook-10-react`'s, so their snapshots are the React port's byte for byte. The meta's
 * `moduleMetadata` provides the green accent around every story, so it reaches the grid's cells only through Angular's
 * own injector tree. It also imports `<vc-style>`, which the stories' templates use for their CSS.
 */
const meta = {
  title: 'Grid',
  decorators: [moduleMetadata({ imports: [StyleTag], providers: [{ provide: accentToken, useValue: accentColor }] })],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Every combination of the chip's tone, size and title: 8 captioned rows, as the React story draws them. Every accent
 * chip is green, from the meta's `moduleMetadata`: `play` checks the computed background of each, which a red chip
 * fails.
 */
export const EveryCombination: Story = {
  render: () =>
    combinations({
      component: Chip,
      props: { tone: ['neutral', 'accent'], size: ['sm', 'lg'], title: [undefined, longTitle] },
      args: { label: 'Save changes' },
    }),
  play: everyCombinationPlay,
}

/**
 * A chip styled only by `stateChipStyles`, so its states come from the page's stylesheet.
 */
@Component({
  selector: 'vc-state-chip',
  standalone: true,
  template: '<span [class]="chipClass()">{{ label() }}</span>',
})
class StateChip {
  /**
   * The chip's text.
   */
  readonly label = input.required<StateChipProps['label']>()

  /**
   * Its background.
   */
  readonly tone = input.required<StateChipProps['tone']>()

  /**
   * The class `stateChipStyles` styles the chip by.
   */
  readonly chipClass = computed(() => stateChipClassOf(this.tone()))
}

/**
 * The grid forces `hover` and `focus-visible` inside the theme that colours a hovered chip's text, as the React story
 * does. `play` checks the headers and each cell's computed style.
 */
export const ForcedStates: Story = {
  render: () => {
    const grid = combinations({
      component: StateChip,
      props: { tone: ['default', 'quiet'] },
      args: { label: 'Save' },
      states: ['hover', 'focus-visible'],
    })

    return {
      ...grid,
      template: `<div class="forced-states-theme"><vc-style [css]="stateChipStyles" />${grid.template}</div>`,
      props: { ...grid.props, stateChipStyles },
    }
  },
  play: forcedStatesPlay,
}

/**
 * A grey chip whose hover rule `LateStyles` adds once the grid is there.
 */
@Component({
  selector: 'vc-late-chip',
  standalone: true,
  template: '<span [class]="chipClass()" [style]="lateChipStyle">{{ chipLabel() }}</span>',
})
class LateChip {
  /**
   * How its hover rule arrives.
   */
  readonly variant = input.required<LateChipProps['variant']>()

  /**
   * The class its hover rule selects.
   */
  readonly chipClass = computed(() => lateChipClassOf(this.variant()))

  /**
   * The chip's text.
   */
  readonly chipLabel = computed(() => lateChipLabels[this.variant()])

  /**
   * Its inline style. Its background comes from `lateBaseRule`.
   */
  protected readonly lateChipStyle = lateChipStyle
}

/**
 * The grid forces `hover`, and `play` adds its chips' hover rules once the grid is in the page, so forcing must stay on
 * after the grid is created. The two `<style>` elements come before the grid, as in the React story, and their data
 * attributes are `"true"`, as React writes a boolean one.
 */
export const LateStyles: Story = {
  render: () => {
    const grid = combinations({ component: LateChip, props: { variant: ['inserted', 'appended'] }, states: ['hover'] })

    return {
      ...grid,
      template: `<vc-style marker="data-late-insert" [css]="lateBaseRule" /><vc-style marker="data-late-append" />${grid.template}`,
      props: { ...grid.props, lateBaseRule },
    }
  },
  play: lateStylesPlay,
}
