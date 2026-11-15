// The font tables below are the three Playwright v1.65.1 gives Chromium through `Page.setFontFamilies`, one per OS,
// copied here as data. Playwright generates them from the default fonts Chromium's source sets for each platform.
// Source:
// https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright-core/src/server/chromium/defaultFontFamilies.ts
// Playwright is licensed under the Apache License 2.0. Review these tables against Playwright's latest release on every
// Chromium bump.

import type { BrowserSystem } from '../driver.js'

// The types below are `type` aliases, not interfaces, so they are assignable to the `Record<string, unknown>` that CDP
// commands take as parameters.

/**
 * The fonts for each generic font family, as `Page.setFontFamilies` takes them. A family a table leaves out keeps
 * Chromium's own default.
 */
type FontFamilies = {
  /**
   * The font of text that names no family.
   */
  standard?: string
  /**
   * The font of the `monospace` family.
   */
  fixed?: string
  /**
   * The font of the `serif` family.
   */
  serif?: string
  /**
   * The font of the `sans-serif` family.
   */
  sansSerif?: string
  /**
   * The font of the `cursive` family.
   */
  cursive?: string
  /**
   * The font of the `fantasy` family.
   */
  fantasy?: string
}

/**
 * The parameters of one `Page.setFontFamilies` call.
 */
type FontFamiliesParameters = {
  /**
   * The fonts for every script that has none of its own.
   */
  fontFamilies: FontFamilies
  /**
   * The fonts for scripts that need others, such as `jpan` for Japanese. Linux has none.
   */
  forScripts?: ScriptFontFamilies[]
}

/**
 * The fonts for one script.
 */
type ScriptFontFamilies = {
  /**
   * The script's four-letter code, such as `jpan` for Japanese.
   */
  script: string
  /**
   * The fonts for the script.
   */
  fontFamilies: FontFamilies
}

/**
 * The font tables, by the OS the browser runs on.
 */
const fontFamiliesBySystem: Record<BrowserSystem, FontFamiliesParameters> = {
  linux: {
    fontFamilies: {
      standard: 'Times New Roman',
      fixed: 'Monospace',
      serif: 'Times New Roman',
      sansSerif: 'Arial',
      cursive: 'Comic Sans MS',
      fantasy: 'Impact',
    },
  },
  macos: {
    fontFamilies: {
      standard: 'Times',
      fixed: 'Courier',
      serif: 'Times',
      sansSerif: 'Helvetica',
      cursive: 'Apple Chancery',
      fantasy: 'Papyrus',
    },
    forScripts: [
      {
        script: 'jpan',
        fontFamilies: {
          standard: 'Hiragino Kaku Gothic ProN',
          fixed: 'Osaka-Mono',
          serif: 'Hiragino Mincho ProN',
          sansSerif: 'Hiragino Kaku Gothic ProN',
        },
      },
      {
        script: 'hang',
        fontFamilies: {
          standard: 'Apple SD Gothic Neo',
          serif: 'AppleMyungjo',
          sansSerif: 'Apple SD Gothic Neo',
        },
      },
      {
        script: 'hans',
        fontFamilies: {
          standard: ',PingFang SC,STHeiti',
          serif: 'Songti SC',
          sansSerif: ',PingFang SC,STHeiti',
          cursive: 'Kaiti SC',
        },
      },
      {
        script: 'hant',
        fontFamilies: {
          standard: ',PingFang TC,Heiti TC',
          serif: 'Songti TC',
          sansSerif: ',PingFang TC,Heiti TC',
          cursive: 'Kaiti TC',
        },
      },
    ],
  },
  windows: {
    fontFamilies: {
      standard: 'Times New Roman',
      fixed: 'Consolas',
      serif: 'Times New Roman',
      sansSerif: 'Arial',
      cursive: 'Comic Sans MS',
      fantasy: 'Impact',
    },
    forScripts: [
      {
        script: 'cyrl',
        fontFamilies: {
          standard: 'Times New Roman',
          fixed: 'Courier New',
          serif: 'Times New Roman',
          sansSerif: 'Arial',
        },
      },
      {
        script: 'arab',
        fontFamilies: {
          fixed: 'Courier New',
          sansSerif: 'Segoe UI',
        },
      },
      {
        script: 'grek',
        fontFamilies: {
          standard: 'Times New Roman',
          fixed: 'Courier New',
          serif: 'Times New Roman',
          sansSerif: 'Arial',
        },
      },
      {
        script: 'jpan',
        fontFamilies: {
          standard: ',Meiryo,Yu Gothic',
          fixed: 'MS Gothic',
          serif: ',Yu Mincho,MS PMincho',
          sansSerif: ',Meiryo,Yu Gothic',
        },
      },
      {
        script: 'hang',
        fontFamilies: {
          standard: 'Malgun Gothic',
          fixed: 'Gulimche',
          serif: 'Batang',
          sansSerif: 'Malgun Gothic',
          cursive: 'Gungsuh',
        },
      },
      {
        script: 'hans',
        fontFamilies: {
          standard: 'Microsoft YaHei',
          fixed: 'NSimsun',
          serif: 'Simsun',
          sansSerif: 'Microsoft YaHei',
          cursive: 'KaiTi',
        },
      },
      {
        script: 'hant',
        fontFamilies: {
          standard: 'Microsoft JhengHei',
          fixed: 'MingLiU',
          serif: 'PMingLiU',
          sansSerif: 'Microsoft JhengHei',
          cursive: 'DFKai-SB',
        },
      },
    ],
  },
}

/**
 * The parameters of the `Page.setFontFamilies` call for a browser that runs on this OS.
 */
export function fontFamiliesOf(system: BrowserSystem): FontFamiliesParameters {
  return fontFamiliesBySystem[system]
}
