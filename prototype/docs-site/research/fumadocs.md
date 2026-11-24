# Fumadocs research for the visual-check docs site

Researched 2026-11-23. Versions on npm that day: `fumadocs-ui` / `@fumadocs/base-ui` 16.19.7, `fumadocs-core` 16.19.7, `fumadocs-mdx` 15.6.4, `fumadocs-openapi` 12.6.7, `fumadocs-typescript` 5.6.2, `fumadocs-twoslash` 4.0.5, `@fumadocs/story` 1.5.5.

Sources: fumadocs.dev docs, read through its own `llms-full.txt` exports (`/docs/ui/layouts/llms-full.txt`, `/docs/ui/components/llms-full.txt`, `/docs/ui/llms-full.txt`, `/docs/next/markdown/llms-full.txt`, `/docs/next/integrations/llms.md`, `/docs/next/page-conventions.md`). Dimensions and class names were read from the published `@fumadocs/base-ui@16.19.7` tarball (`dist/layouts/**`, `dist/components/**`, `css/**`). Showcase sites were opened in a real browser at 1440×900 and their DOM was probed for the Fumadocs ids (`#nd-docs-layout`, `#nd-notebook-layout`, `#nd-sidebar`, `#nd-page`, `#nd-toc`).

---

## 1. Fumadocs UI building blocks (v16)

### 1.1 Setup and theming
- Tailwind v4 only. CSS entry: `@import 'tailwindcss'; @import 'fumadocs-ui/css/<theme>.css'; @import 'fumadocs-ui/css/preset.css';` Themes: neutral, black, vitepress, dusk, catppuccin, ocean, purple, solar, emerald, ruby, aspen. `fumadocs-ui/css/shadcn.css` maps `--color-fd-*` onto shadcn's `--background`, `--primary`, … and `#nd-sidebar` onto `--sidebar*`. ([theme](https://fumadocs.dev/docs/ui/theme))
- Colour tokens to override (light in `@theme`, dark in `.dark`): `--color-fd-{background, foreground, muted, muted-foreground, popover, popover-foreground, card, card-foreground, border, primary, primary-foreground, secondary, secondary-foreground, accent, accent-foreground, ring, overlay}`. Static extras: `--color-fd-{info, warning, error, success, idea}` (callouts) and `--color-fd-diff-{add,remove}[-symbol]` (code diff).
- Layout width is `--fd-layout-width` (default `97rem` = 1552px). Typography comes from a built-in fork of `@tailwindcss/typography`: `.prose`, plus `prose-sm` and `prose-xs`.
- Base UI is the default primitive library: `fumadocs-ui` is an alias of `@fumadocs/base-ui`, and Radix is opt-in. The Spacious layout exists only in the Base UI build. ([component-library](https://fumadocs.dev/docs/ui/component-library))
- Light/dark comes from `next-themes` inside `<RootProvider>`. Pressing **D** toggles the theme; turn it off with `theme.hotKey:false`. RTL is supported.
- To take full ownership: `npx @fumadocs/cli@latest customize` copies a layout into the repo, and `npx @fumadocs/cli add slots/docs/page/toc` (also `footer`, `breadcrumb`, `container`) ejects single slots.

### 1.2 Layouts ([list](https://fumadocs.dev/docs/ui/layouts))
| Import | What it is | Key dims (from source) |
|---|---|---|
| `fumadocs-ui/layouts/home` `HomeLayout` | Navbar only, for the landing page and other pages | sticky header `h-14` (56px), inner `max-w-(--fd-layout-width) px-4`, `backdrop-blur-lg border-b bg-fd-background/80`; search pill `rounded-full max-w-[240px]` |
| `layouts/docs` `DocsLayout` (default) | Sidebar + TOC. No top nav on desktop; the nav title sits in the sidebar | sidebar 268px (≥768px), TOC 268px (≥1280px), article `max-w-[900px]` (1168px with `full`), mobile header 56px |
| `layouts/notebook` | Compact: full-width top header, sidebar below it. `nav.mode:'top'`, `tabMode:'navbar'` puts root-folder tabs in the header | header 56px (96px with navbar tabs), sidebar 268, article 900 (1285 with `full`) |
| `layouts/spacious` (Base UI only) | Page sits in an inset rounded panel beside the sidebar; page actions sit at the top of the panel; the panel scrolls, the window doesn't; TOC uses `block` style | sidebar 268, page 760 (1200 with `full`), TOC 304px, header 56. **fumadocs.dev itself uses this now** |
| `layouts/glass` | Floating translucent sidebar and header; client component; separate CSS `fumadocs-ui/css/generated/glass.css` | header 48, left 280, main 900/1200, right 240 |
| `layouts/flux` | "Aggressively minimal": bottom navigation panel (`h-11`), best paired with static search | page max 900/1200 |

Shared props (`BaseLayoutProps`, kept in `lib/layout.shared.tsx`): `nav{title,url,transparentMode:'none'|'top'|'always',enabled}`, `links[]` (link / `type:'icon'` / `type:'menu'` / `type:'custom'`; `secondary`; `active:'url'|'nested-url'|'none'`), `githubUrl`, `themeSwitch`, `searchToggle`, `slots{navTitle,themeSwitch,searchTrigger,languageSelect}`. HomeLayout adds an animated `NavbarMenu` mega-menu (`fumadocs-ui/layouts/home/navbar`). A custom navbar must set `--fd-nav-height`. ([links](https://fumadocs.dev/docs/ui/layouts/links), [nav](https://fumadocs.dev/docs/ui/layouts/nav))

### 1.3 DocsLayout DOM skeleton for a static prototype (v16 grid)
```
div#nd-docs-layout.grid [data-sidebar-collapsed]   min-h:100dvh
  grid-template: "sidebar sidebar header toc toc" / "sidebar sidebar toc-popover toc toc" /
                 "sidebar sidebar tabs toc toc" / "sidebar sidebar main toc toc" 1fr
               / minmax(min-content,1fr) var(--fd-sidebar-col)
                 minmax(0, calc(var(--fd-layout-width,97rem) - var(--fd-sidebar-width) - var(--fd-toc-width)))
                 var(--fd-toc-width) minmax(min-content,1fr)
  header#nd-subnav        mobile only: sticky, 56px, ps-4 pe-2.5, border-b, backdrop-blur-sm, bg/80
  div[data-sidebar-placeholder] sticky top:banner-h, height 100dvh, hidden <768px
    aside#nd-sidebar      bg-fd-card, border-e, text-sm(14px), width 268px
      div.p-4.pb-2.gap-3  title row (15px medium + collapse icon-btn) · search trigger · tabs dropdown · banner
      viewport            p-4, 12px top/bottom fade mask, items gap-0.5
      div.p-4.pt-2        footer: [icon links | theme switch] pill (border, bg-fd-secondary/50, rounded-lg)
  div (toc-popover)       <1280px: sticky 40px bar "On this page ▾" under the header
  main[data-layout-main].grid.justify-items-center   [grid-area:main]
    article#nd-page       max-w 900, px-4 py-6 / md:px-6 pt-8 / xl:px-8 pt-14(56px), flex-col gap-4
      breadcrumb · h1 · p.description · actions row · div.prose · footer(prev/next)
  div#nd-toc              ≥1280px: sticky, full height, 268px, pt-12(48px) pe-4
```
- Sidebar items: `flex gap-2 rounded-lg p-2 text-fd-muted-foreground`, icons 16px. Hover is `bg-fd-accent/50`; active is `bg-fd-primary/10 text-fd-primary`. Indent is `padding-inline-start: calc((2+3·depth)·4px)`, so 8, 20 and 32px. Nested folders draw a 1px `bg-fd-border` rail at 10px, and the active nested item gets a 1px primary bar over the rail. Separators: `mt-6 mb-1 px-2` (the first at depth 0 has no top margin), with an optional icon.
- When the sidebar is collapsed it slides off and a floating pill appears top-left (`rounded-xl border bg-fd-muted shadow-lg`, collapse and search buttons). Hovering the left edge peeks the sidebar as a floating card (`inset-y-2 rounded-xl shadow-lg`). On mobile the sidebar is a drawer from the end edge, `w-[85%] max-w-[380px]`.
- Search trigger: `rounded-lg border bg-fd-secondary/50 p-1.5 ps-2 text-sm text-fd-muted-foreground` with `kbd` chips (`rounded-md border bg-fd-background px-1.5`) showing ⌘ K.
- Measured on fumadocs.dev (Spacious) at 1440: sidebar 268, `#nd-page` x=317 w=760, TOC 304. Font Geist, h1 28px, body 16px.
- Older showcase sites (Zod, ArkType, Nativewind) still run the pre-v16 flex layout with **286px** sidebar and TOC, so don't copy dimensions from them.

### 1.4 Sidebar content model ([page conventions](https://fumadocs.dev/docs/next/page-conventions))
- The page tree comes from files. `meta.json` holds `title, icon, defaultOpen, collapsible, pages, pagesIndex`. `pages` syntax: `"./path"`, `"---Label---"` / `"---[Icon]Label---"` (separator), `"[Text](url)"` / `"[Icon][Text](url)"` / `"external:[Text](url)"`, `"..."` (rest), `"z...a"`, `"...folder"` (extract), `"!item"` (except).
- `(group)` folders don't add a URL segment. A folder with `"root": true` becomes a **root folder**, rendered as the sidebar tab **dropdown** (`SidebarTabsDropdown`: `rounded-lg p-2 border bg-fd-secondary/50`, icon, title, description). `"root": "version"` makes root folders of one type interchangeable, for versions; switching keeps the same relative page. `tabs={[...]}` sets tabs explicitly, and `tabs.transform` adds icons.
- `sidebar`: `banner`, `footer`, `defaultOpenLevel`, `collapsible` (default true), `prefetch`, `components{Separator,Item,Folder…}` for overrides.

### 1.5 Page pieces ([page](https://fumadocs.dev/docs/ui/layouts/page))
- `DocsPage{toc, full, tableOfContent, tableOfContentPopover, breadcrumb, footer, slots}` · `DocsTitle` (h1, `text-[1.75em] font-semibold`) · `DocsDescription` (`mb-8 text-lg text-fd-muted-foreground`) · `DocsBody` (`prose flex-1`).
- Breadcrumb: only shown inside folders. `text-sm` muted, 14px chevrons. Options `includeRoot/includePage/includeSeparator`.
- Footer prev/next: `grid grid-cols-2 gap-4`. Cards are `rounded-lg border p-4 text-sm hover:bg-fd-accent/80`, with a medium title and arrow, a muted description, and the second card right-aligned.
- `PageLastUpdate` ("Last updated on …", `text-sm` muted). Fed by `lastModified` from fumadocs-mdx or `getGithubLastEdit`.
- `EditOnGitHub` (secondary sm button, "Edit on GitHub").
- AI page actions: `MarkdownCopyButton` (secondary sm button "Copy Markdown", fetches `<page>.md`) and `ViewOptionsPopover` ("Open" ▾: Open in GitHub, View as Markdown, Open in Scira AI, ChatGPT (`chatgpt.com/?q=`), Claude (`claude.ai/new?q=`), Cursor (`cursor.com/link/prompt`)). The usual placement is a row under the description: `flex gap-2 border-b pt-2 pb-6`.
- TOC `style`: `normal` (default; a track line with a thumb on active headings), `clerk` (the track follows heading depth as an SVG path, after clerk.com), `block` (no track; a gradient block slides behind the active item, numbered chips). Items are `prose-sm py-1.5` muted, active `text-fd-primary`. `tableOfContent.header/footer` are slots above and below the list (Turborepo uses them for feedback and a stat card).
- Heading control in MDX: `## Title [#custom-id]`, `[!toc]` hides a heading from the TOC, `[toc]` shows it only in the TOC. `<InlineTOC>` renders an in-content TOC.

### 1.6 Search, theme, banner
- `⌘K` / `Ctrl K` opens the dialog. The default engine is now listed as **"ZBSearch (default)"** (the built-in search, formerly Orama; URL still `/docs/next/search/orama`). It runs on a server route or from a static JSON index (`useStaticSearch`) for `output:'export'`, and supports tag filters. Alternatives: Orama Cloud, Algolia, Meilisearch, Typesense, Mixedbread, FlexSearch. ([search](https://fumadocs.dev/docs/next/search))
- Dialog: fixed, `top-4` on mobile and `md:top-[calc(50%-250px)]` above that, `w-[calc(100%-1rem)] max-w-screen-sm` (640px), `rounded-xl border bg-fd-popover shadow-2xl`. Composable parts: `SearchDialog{Overlay,Content,Header,Icon,Input,Close,List,Footer}`. Matches are styled with `::highlight(fd-search)`. `search.links` sets the links shown while the query is empty.
- `<Banner id variant="rainbow" changeLayout>` goes at the top of the root layout. It is dismissible when it has an `id` and persists that state. It shifts layouts through `--fd-banner-height`.

### 1.7 MDX components ([components](https://fumadocs.dev/docs/ui/components), [markdown](https://fumadocs.dev/docs/next/markdown))
| Component | Usage / notes | Look (source classes) |
|---|---|---|
| Callout (default) | `<Callout type="info|warn|error|success|idea" title>`; `:::note` syntax via remark-admonition | `flex gap-2 rounded-xl border bg-fd-card p-3 ps-1 text-sm`; 2px bar in `--callout-color`/50; 20px icon; medium title, muted body |
| Cards (default) | `<Cards><Card href title icon>`; `getPageTreePeers()` for "further reading" | `grid grid-cols-2 gap-3 @container`; card `rounded-xl border bg-fd-card p-4`; icon chip `rounded-lg border bg-fd-muted p-1.5 shadow-md` |
| Tabs | `<Tabs items groupId persist defaultIndex>`; link to a tab by `#id`; shared value across instances | `rounded-xl border bg-fd-secondary`; triggers `text-sm font-medium border-b`, active `border-fd-primary text-fd-primary`; panel `p-4 text-[15px] bg-fd-background rounded-xl` |
| Steps | `<Steps><Step>` or headings `### Install [step]` (remark-steps) | `.fd-steps ps-6 ms-2 border-s`; `.fd-step:before` 32px circle `bg-fd-secondary` with a counter |
| Accordion | `<Accordions type="single"><Accordion title id>`; opens on `#id` hash; `hiddenUntilFound` for ⌘F | Base UI accordion |
| Files | `<Files><Folder name defaultOpen><File name>`; also generated from a code block (`remark-mdx-files`) or `<auto-files>` | `rounded-md border bg-fd-card p-2`; rows `px-2 py-1.5 text-sm`; nested `border-l ms-2 ps-2` |
| TypeTable | `<TypeTable type={{ key:{type,description,default,required} }}>`; expandable rows | `rounded-2xl border bg-fd-card p-1 text-sm`; rows `rounded-xl border` |
| AutoTypeTable | `fumadocs-typescript`: `<AutoTypeTable path="./src/config.ts" name="Config"/>`, RSC, generated at build | same as TypeTable |
| Code block | Shiki through rehype-code: `title="x"`, icon, copy button, `lineNumbers[=4]`, `// [!code highlight]`, `[!code word:x]`, `[!code ++/--]`, `[!code focus]`, `twoslash` (fumadocs-twoslash), `keepBackground` | figure `my-4 bg-fd-card rounded-xl border`; title bar `h-9.5 border-b px-4`; pre `text-[13px] py-3.5 max-h-[600px]`; copy button `absolute top-2 right-2` |
| Code tabs | consecutive fences with `tab="pnpm"`; `tab-group` persists the choice; MDX in tab labels via `parseMdx` | `CodeBlockTabs` with an underline trigger indicator |
| npm tabs | a ` ```npm ` fence (or `package-install`) expands to npm/pnpm/yarn/bun tabs through `npm-to-yarn`; **`npx` becomes `pnpm dlx` / `yarn dlx` / `bunx`**; `persist` option | code tabs |
| ImageZoom | `fumadocs-ui/components/image-zoom`; lightbox, caption, gallery | |
| Mermaid | not built in: add the official `mermaid` client renderer, Pele, or beautiful-mermaid, then use a ` ```mermaid ` fence | |
| Others | Banner, DynamicCodeBlock (runtime Shiki), GitHubInfo (stars card), Graph View, Inline TOC, `<include>`, `<show when>`, Math (KaTeX), Validate Links | |
| Integrations | OpenAPI (`fumadocs-openapi`: playground, multi-language samples, TS response types, a page per operation via `openapi.staticSource()`), AsyncAPI, GraphQL, Feedback (page feedback), Changelog, OG images, **Story** (`@fumadocs/story`: renders a component with prop controls in MDX; its own docs still recommend Storybook for UI testing) | |

### 1.8 AI and LLM features ([llms](https://fumadocs.dev/docs/next/integrations/llms))
- `npx @fumadocs/cli feature llms` adds `docsLlms = llms(source,{renderPage})`. It serves `/llms.txt` (index), `/llms-full.txt`, **`<page>.md`** (e.g. `/docs/ui.md`; the current convention is `.md`, which older sites served as `.mdx`), and `<section>/llms-full.txt` for each root folder. Sections can be collapsed into their own `llms.txt`. Routes live in `app/llms.mdx/[...path]`, and `next.config` rewrites `/docs/:path*.md` to them.
- Each page carries `<link rel="alternate" type="text/markdown" href="/docs/x.md">`. `Accept: text/markdown` negotiation goes through `isMarkdownPreferred` / `rewritePath` (`fumadocs-core/negotiation`) in `proxy.ts`, with `Vary: Accept`. MDX components can render to Markdown form (`remark-llms`).
- `npx @fumadocs/cli feature mcp` adds an `/api/mcp` server (streamable HTTP) with list/read/search tools (`fumadocs-core/mcp`).
- Ask AI: the `aiChat={{open,onOpenChange,panel,trigger}}` prop docks a chat panel beside the page on wide screens and floats it on small ones. `trigger:true` adds a floating button.

---

## 2. Showcase: verified picks ([fumadocs.dev/showcase](https://fumadocs.dev/showcase))
Each was verified by its DOM ids at 1440×900. Several listed sites no longer render Fumadocs UI: **shadcn/ui** (custom UI; has Copy Page, Open in v0, llms.txt), **Ultracite**, **Code Hike**, **assistant-ui**, **c15t**. HeroUI v3 `/docs` returned 404.

0. **fumadocs.dev** (reference): Spacious docs layout, plus a HomeLayout landing with a "Get started" button, a `$ pnpm create fumadocs-app` command chip with copy, "Open in StackBlitz", and a sticky section scroll-spy bar at the bottom (Style · Write · Automate · CLI · Showcase …). The page header holds "Copy Markdown" and "Open ▾", and the header bar holds "Ask AI". *Steal: a command chip in the hero, plus a section index bar on a long landing.*
1. **Better Auth**: [better-auth.com/docs](https://better-auth.com/docs/introduction). DocsLayout grid with a custom sidebar (no `#nd-sidebar`). A version dropdown tops the sidebar, groups have icons and collapse, uppercase mono micro-buttons read "COPY MD" and "OPEN IN ▾", an LLMs.txt link sits nearby, a floating "Ask AI ⌘I" button, faint grid-paper background, bordered feature-card grid, near-black monochrome. *Steal: mono uppercase micro-labels for page actions (fits `--text-label`).*
2. **Zod**: [zod.dev](https://zod.dev). Default docs layout (pre-v16). A dismissible Banner announces the release ("Zod 4.6 is out!"), a root-folder dropdown reads "Zod 4 · latest version", separators are uppercase (DOCUMENTATION / PACKAGES / BLOG), the docs index doubles as a hero (logo, badges, links), and a floating Ask AI button. *Steal: Banner for releases; separators as section labels.*
3. **ArkType**: [arktype.io/docs](https://arktype.io/docs/intro/setup). Default docs layout, deep-navy custom theme, **Atkinson Hyperlegible** body font (visual-check's own family). A row of five inline page actions (Copy Markdown, View Markdown, Open in Claude, Open in ChatGPT, Open in Cursor), install tabs with pnpm first, a sidebar footer of social icons, API grouped into collapsible folders (Primitives / Objects). *Steal: proof that Atkinson plus a dark custom palette looks native; inline AI actions instead of a dropdown.*
4. **Prisma**: [prisma.io/docs](https://www.prisma.io/docs). **Notebook** layout. Top banner, full-width header with a centred "Search or ask AI… ⌘K", and a sidebar inset as a floating card (x=12, 252px). The docs home is a `full` mini-landing with **Build / Deploy** task columns and icon lists. An inline command chip `npx prisma deploy` has a copy button, the sidebar footer shows "All Systems Operational", and a split "Copy ▾" button. *Steal: docs home as a task-oriented hub; command chips.*
5. **Turborepo**: [turborepo.dev/docs](https://turborepo.dev/docs). Vercel's Fumadocs template. One 64px top nav shared by landing and docs (Docs/Blog/Showcase/Enterprise · Search ⌘K · Ask AI), a flat sidebar with chevron groups, a copy-page icon beside the H1, and a TOC footer with Give feedback, Edit on GitHub and a **live stat card** ("25,082,243 hours Total Compute Saved"). Also a Glossary page. Reference pages put a `Default:` line under each key and use `bash title="Terminal"` blocks. *Steal: the TOC-footer slot (feedback, edit, a live stat); a seamless shared header.*
6. **Chat SDK**: [chat-sdk.dev/docs](https://chat-sdk.dev/docs). Same template as Turborepo, plus a visually hidden agent hint ("AI/LLM: This documentation page is available in plain markdown format at /docs.md"), llms.txt and llms-full.txt links, "Copy page / View Markdown / Ask AI about this page", and an "AI coding agents" section. *Steal: the hidden agent hint plus "Ask AI about this page".*
7. **nuqs**: [nuqs.dev/docs](https://nuqs.dev/docs/installation). Notebook with a top nav (Documentation · Playground · Registry · Blog), 64px header, sidebar 268, TOC 268 with **sponsor logos** in the TOC footer. Install tabs cover npm/pnpm/yarn/bun/deno/vlt. Page actions are "Copy as Markdown", "Copy Markdown URL" and "Open ▾". The "Which version should I use?" list pairs framework icons with version ranges. *Steal: the compatibility list pattern for "Supported Storybooks".*
8. **Better-T-Stack**: [better-t-stack.dev/docs](https://www.better-t-stack.dev/docs). Notebook, a **CLI product**. Uppercase mono top nav (DOCS · BUILDER · ANALYTICS · SHOWCASE …). The sidebar banner is a grid of app-icon tiles. The CLI folder holds Commands, Options Reference, Programmatic API, Compatibility Rules and Agent Workflows, alongside a config-file page (`bts.jsonc`), an "AI agent plugin" card and "Copy Markdown / Open ▾". *Steal: the closest IA analogue for a CLI, with its Commands / Options / Compatibility / Agent split.*
9. **Animate UI**: [animate-ui.com/docs](https://animate-ui.com/docs). DocsLayout with a custom 68px header and version select (v2.x). A **React / Vue segmented switcher** tops the sidebar (root folders as tabs), and sidebar items carry **"new" and "updated" badges**. "Copy page ▾" plus prev/next arrow buttons sit top-right of the page, with diff code blocks (`[!code --/++]`) and live component previews. *Steal: sidebar status badges coloured with visual-check's state tokens.*
10. **Dokploy** ([docs.dokploy.com](https://docs.dokploy.com/docs/core)) and **Nativewind** ([nativewind.dev/docs](https://www.nativewind.dev/docs)) run near-stock docs layouts. Dokploy has "Copy as Markdown"; Nativewind links llms.txt and llms-full.txt in the page. *Use them as the "stock Fumadocs" baseline to judge customisation against.*

CLI command display across these sites: npm/pnpm/yarn/bun tabs from remark-npm (ArkType, nuqs, Better-T-Stack, Animate UI); plain `Terminal`-titled bash blocks (Turborepo); inline command chips with copy (Prisma, the fumadocs.dev hero).
Landing-to-docs transition: either one shared top nav (Turborepo, Chat SDK, nuqs, Prisma, through Notebook `nav.mode:'top'` or a custom header) or HomeLayout nav → DocsLayout, where the nav moves into the sidebar header (fumadocs.dev, Zod, ArkType).

---

## 3. Docs IA patterns from CLI and testing tools
- **Vitest** ([config](https://vitest.dev/config/include), [common errors](https://vitest.dev/guide/common-errors)): top nav Guides · API · Config. **One page per config key**, opening with a fixed block **Type / Default / CLI** (e.g. `CLI: vitest [...include]`), then the description, `## Example`, and NOTE/WARNING callouts. Keys are ordered by topic, not alphabetically (include, exclude, …); Browser Mode is its own group. The troubleshooting page "Common Errors" uses the **exact error message as the H2**, followed by cause and then fix.
- **Playwright** ([visual comparisons](https://playwright.dev/docs/test-snapshots)): top tabs Docs · MCP · CLI · API. The Docs sidebar runs Getting Started → Playwright Test (config/runner) → **Guides** (task pages such as "Visual comparisons"). The visual page covers generate, update (`--update-snapshots`), options (`threshold` 0–1, default 0.2; `maxDiffPixels`; `stylePath`) and a platform warning: baselines are per browser and OS (`-chromium-darwin` suffix), so generate them in the same environment.
- **Storybook** ([docs](https://storybook.js.org/docs)): Get Started · Stories · **Testing** (Interaction, Accessibility, **Visual**, Snapshot, Coverage, **In CI**, Integrations) · Docs · AI · Sharing · Essentials · Addons · Configure · Builders · **API** (main.js config, CSF, ArgTypes, Parameters, CLI options) · Releases · FAQ. Framework variants are chosen with `?renderer=`.
- **Biome** ([configuration](https://biomejs.dev/reference/configuration/)): one long config page with **dotted-path headings** (`formatter.indentWidth`, `overrides.<ITEM>.includes`, placeholders `[group]`) and **Type/Default** lines, top-level keys first and then per-language blocks. Snippets carry a `biome.json` title. The nav splits concept sections (Formatter, Analyzer) from Reference (CLI, configuration, diagnostics), Recipes and Internals.
- **Turborepo** ([configuration](https://turborepo.dev/docs/reference/configuration), [run](https://turborepo.dev/docs/reference/run)): Reference has a config page with an H3 per key, a `Default:` line, titled JSON examples, global keys separated from task keys, and Experimental/Deprecated labels. There is **one page per CLI command**, with an H3 per flag (`--cache-dir <path>`, aliases `--dry / --dry-run`), a `Default:` line, a `Terminal` block, and the env-var equivalent in prose. Turborepo also has a Glossary.

**Synthesis for visual-check:**
- Split pages into **Guides** (task-shaped: "Animations", "Remote content", "CI"), **Concepts** (Modes, tolerance, baselines), **Troubleshooting** (Flaky snapshots, Stories that break) and **Reference** (JSON reference, CLI).
- **JSON reference**: one heading per key with a dotted path and an `[#anchor]`, then a fixed meta row (Type · Default · CLI flag · env var), a one-line description, and a titled `visual-check.json` example. Generate it with `AutoTypeTable` from the TS config type if one exists; otherwise hand-write a TypeTable.
- **Troubleshooting**: use the symptom or the exact CLI error string as the H2, then cause → fix → a link to the related config key.
- **Getting started**: Steps (install → init → first run → review → accept baselines), npm tabs, and a "what you just did" Cards block at the end.

---

## 4. Recommendations: three prototype directions
**Token mapping (all three)**. Set these in `@theme` and in `.dark` / `[data-theme=dark]`:

| Fumadocs token | visual-check token |
|---|---|
| `--color-fd-background` | `--bg-page` |
| `--color-fd-foreground` | `--text-primary` |
| `--color-fd-card`, `--color-fd-popover` | `--bg-raised` |
| `--color-fd-muted`, `--color-fd-secondary`, `--color-fd-accent` | `--bg-surface` |
| `--color-fd-muted-foreground` | `--text-muted` |
| `--color-fd-border` | `--border-subtle` |
| `--color-fd-primary` | `--text-cyan` (cyan for active and links); or `--action-primary` (ink) for a monochrome look |
| `--color-fd-ring` | `--focus` |
| `--color-fd-info` | `--info-fg` |
| `--color-fd-warning` | `--caution-fg` |
| `--color-fd-error` | `--danger-fg` |
| `--color-fd-idea` | `--text-magenta` |

- **Sidebar**: override `#nd-sidebar{background:var(--bg-surface)}`, as the shadcn preset does.
- **Code**: code blocks must sit on `--code-bg` in both themes. Use `keepBackground` with a custom Shiki theme built from the `--code-*` tokens, or override `figure` and `pre`.
- **Fonts**: Atkinson Hyperlegible Next and Mono for body and code; Bricolage Grotesque for `DocsTitle` and prose h2/h3.
- **Radius**: Fumadocs uses 12px (`rounded-xl`) for cards, code and callouts. Remap these to `--radius-lg` (10px), and buttons and callouts to `--radius-md` (6px).

Common sidebar (`meta.json` `pages`):
```
"---Start---","getting-started","config","modes",
"---Capture---","full-page-and-element","grid-stories","animations","wait-hook","remote-content",
"---Compare---","color-and-pixels","baselines","flaky-snapshots","stories-that-break",
"---Run---","browser","platforms-and-docker","ci","security",
"---Integrate---","storybook-addon","agent-skill","supported-storybooks",
"---Reference---","json-reference"
```

### A. "Field manual": stock DocsLayout, Vitest-grade rigour
- **Layout**: `HomeLayout` on `/` and `DocsLayout` on `/docs` (nav title, search and theme toggle in the sidebar). TOC `style:'clerk'`, an **actions row** under the description (Copy Markdown · Open ▾ · Edit on GitHub), and `PageLastUpdate` plus prev/next in the footer.
- **Components**: Steps and npm tabs (` ```npm npx @visual-check/cli init` renders as `pnpm dlx` / `yarn dlx` / `bunx`); Callouts mapped to status tokens (Note=info, Warning=caution for "flaky", Danger=danger for "breaks"); `Files` for the baseline directory tree; `ImageZoom` for baseline/snapshot/diff PNGs; TypeTable for the JSON reference; code fences with `title="visual-check.json"` and `[!code highlight]`.
- **Customisations**: token skin only; a mono uppercase eyebrow over the H1 (the folder name); badges in a status-pill style. It's the cheapest to build and to keep up to date.
- **Pages to prototype**: Getting started (Steps); Config; `color` and `pixels` (a static worked example: a 10-pixel table showing which pixels pass under each `color` value and the total compared against `pixels`); Flaky snapshots (troubleshooting pattern); JSON reference (Vitest-style per-key blocks).

### B. "Product hub": Notebook layout with top tabs (Prisma, nuqs, Better-T-Stack)
- **Layout**: `layouts/notebook` with `nav.mode:'top'` and `tabMode:'navbar'`. The same 56px header (logo · Docs · Changelog · GitHub · Search ⌘K · theme) appears on the landing page through shared `baseOptions()`, so the move from landing to docs is seamless. Root folders become header tabs: **Guides** · **Integrations** (Storybook addon, Agent skill, CI, Platforms and Docker) · **Reference** (JSON reference, Supported Storybooks).
- **Components**: the docs home is a `full` page mini-landing with task columns (Capture / Compare / Run) as Cards with icons, and an inline **command chip** with copy; a nuqs-style **compatibility matrix** (Storybook versions × frameworks, with status badges) for Supported Storybooks; a dismissible `Banner` for releases; a TOC footer slot with "Was this helpful?" feedback and Edit on GitHub.
- **Pages to prototype**: Docs home hub; Getting started; Platforms and Docker (Tabs: macOS / Linux / Docker; Callout on why baselines differ per OS, the Playwright lesson); CI (code tabs: GitHub Actions / GitLab / CircleCI); Supported Storybooks (matrix); Agent skill.

### C. "Diff-first": Spacious layout with interactive explainers (fumadocs.dev, Better Auth)
- **Layout**: `layouts/spacious` (Base UI). Page actions sit at the top of the inset panel, the TOC uses `block` style, and `aiChat` docks an "Ask AI" panel. Expose all AI routes: `llms.txt`, `llms-full.txt`, per-page `.md`, `<link rel=alternate>`, a hidden agent hint (Chat SDK) and the MCP route. This direction suits a product that ships an **Agent skill**.
- **Custom MDX components** (prototype as static HTML):
  - `<DiffViewer>`: baseline, snapshot and diff, with a swipe slider in cyan and magenta "plates" and `--shadow-register`.
  - `<TolerancePlayground>`: the **10-pixel worked example**. A 10-cell pixel strip with per-pixel ΔE, plus `color` and `pixels` sliders that flip a pass/fail badge live.
  - `<CliOutput>`: a terminal on `--code-bg`, with the changed-count in `--code-magenta`.
  - Status badges (passed / changed / failed / missing / flaky) reused in sidebar items, as Animate UI does with "new" and "updated".
- **Pages to prototype**: `color` and `pixels` (playground); Modes; Full page and `element` (DiffViewer on two captures); Animations plus The `wait` hook (before/after diff); Baselines (Files tree plus the accept flow); Agent skill (copy-to-agent actions).

**Recommended prototype order**: A first (it fixes the token skin and the reference patterns), then C's playground component dropped into A. B is worth building if the landing page and docs must feel like one product with a shared header.

---

## Unresolved questions
- Is there a TS type for `visual-check.json`? If so, `AutoTypeTable` can generate the JSON reference; if not, it's a hand-written TypeTable or a JSON-Schema route.
- Spacious is Base UI only and a client component. Is that fine for the Next.js app, given no unserializable props from server components?
- `--color-fd-primary`: brand cyan (`--text-cyan`) or ink (`--action-primary`)?
- Is static export (`output:'export'`) planned? It changes the search mode (static index), the `.md` URLs (`/llms.mdx/...` prefix) and Accept negotiation, which needs a proxy.
- Versioned docs (`root:"version"`) from day one, or later?
