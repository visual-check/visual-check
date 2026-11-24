/* PROTOTYPE — throwaway. Landing F: five top-header prototypes, one per option of the `header` idea toggle.
 *
 * Contract with f.html (and f-headers-demo.html):
 * - <div id="f-header" data-f-headers></div> is the first child of <body>; f-headers.css is in the head; this file loads with `defer`.
 * - The kit sets html[data-t-header="bare|slug|command|reveal|corners"] and fires `vc-proto:toggle` on document when it changes.
 * All five headers render once; the active one is shown, and its name is mirrored to html[data-fh-header] and the host's
 * data-fh-active (the CSS keys stickiness and anchor offsets on those).
 *
 *   bare     logo left; Docs, GitHub and the theme icon right, as plain links. No fill, no rule, not sticky.
 *   slug     the job line printed along the top edge of a proof sheet, in mono, between registration marks. Not sticky.
 *            It replaces the hero's own slug row (the hero's first element with "slug" in its class).
 *   command  a 48px sticky bar whose centre is the install command, with a copy button. The chip waits until the
 *            hero's own install command (a pre or code in the hero holding it) has scrolled away.
 *   reveal   the bare row on the hero; once the hero has scrolled away, a 48px bar with in-page links and Get started.
 *   corners  no bar: the mark and the links sit in the corners of the screen behind crop marks. Fixed from 1440px,
 *            where the margins are empty; under that, a band above the hero that scrolls away.
 */
(() => {
  'use strict';

  const NAMES = ['bare', 'slug', 'command', 'reveal', 'corners'];
  const DOCS = '../docs/3.html#getting-started';
  const GITHUB = 'https://github.com/visual-check/visual-check';
  const INSTALL = 'npx @visual-check/cli init';
  const LOGO = '../shared/logo/';
  const COPIED_MS = 1600;
  /**
   * The reveal bar's in-page links: the section's data-slot and the link's label.
   */
  const SECTIONS = [['problem', 'Problem'], ['demo', 'How it works'], ['agent', 'Agent'], ['faq', 'FAQ']];

  const root = document.documentElement;
  const host = document.querySelector('[data-f-headers]');
  if (!host) {
    return;
  }

  const kitIcon = (window.VCProto && window.VCProto.icon) || {};
  const ICON = {
    github: kitIcon.github || '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/></svg>',
    theme: kitIcon.theme || '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>',
    copy: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h.5"/></svg>',
    check: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
    reg: '<svg class="fh-reg" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.5"/><path d="M7.5 0v15M0 7.5h15"/></svg>'
  };
  const NEW_TAB = '<span class="fh-sr"> (opens in a new tab)</span>';

  /* ---------- markup ---------- */

  /**
   * A light and a dark image of one logo file; bundle.css shows the one that matches the theme.
   */
  function logoPair(file, className, alt) {
    return `<img class="${className} vc-only-light" src="${LOGO}${file}.svg" alt="${alt}">` +
      `<img class="${className} vc-only-dark" src="${LOGO}${file}-dark.svg" alt="${alt}">`;
  }

  /**
   * The logo link to the top of the page: the horizontal logo, and the mark for narrow bars (CSS picks one).
   */
  function homeLink(logoClass) {
    return `<a class="fh-home" href="#top">` +
      `<span class="fh-home__full">${logoPair('logo-horizontal', `fh-logo ${logoClass}`, 'visual-check')}</span>` +
      `<span class="fh-home__mark">${logoPair('mark', 'fh-mark', 'visual-check')}</span></a>`;
  }

  /**
   * A theme toggle; the kit handles the click on any [data-kit-theme-toggle].
   */
  function themeButton(className) {
    return `<button class="${className}" type="button" data-kit-theme-toggle aria-label="Dark theme" aria-pressed="false">${ICON.theme}</button>`;
  }

  /**
   * The quiet row used by `bare`, and by `reveal` on top of the hero.
   */
  function quietRow() {
    return `<div class="fh-wrap fh-row">${homeLink('')}` +
      `<div class="fh-row__end"><nav class="fh-nav" aria-label="Site">` +
      `<a class="fh-link" href="${DOCS}">Docs</a>` +
      `<a class="fh-link" href="${GITHUB}" target="_blank" rel="noopener">GitHub${NEW_TAB}</a>` +
      `</nav>${themeButton('vc-icon-btn')}</div></div>`;
  }

  const BUILD = {
    bare: () => quietRow(),

    slug: () => `<div class="fh-slug__line">` +
      `<div class="fh-slug__start">${ICON.reg}` +
      `<a class="fh-slug__job" href="#top">${logoPair('mark', 'fh-mark', '')}<span>visual-check</span></a>` +
      `<span class="fh-slug__meta">· free and open source · MIT</span></div>` +
      `<span class="fh-cbar" aria-hidden="true"><span class="fh-cbar__c"></span><span class="fh-cbar__m"></span><span class="fh-cbar__k"></span><span class="fh-cbar__p"></span></span>` +
      `<div class="fh-slug__end"><nav class="fh-slug__nav" aria-label="Site">` +
      `<a class="fh-mono" href="${DOCS}">Docs</a>` +
      `<a class="fh-mono" href="${GITHUB}" target="_blank" rel="noopener">GitHub<span class="fh-mono__out" aria-hidden="true">↗</span>${NEW_TAB}</a>` +
      `</nav>${themeButton('fh-glyph')}${ICON.reg}</div></div>`,

    command: () => `<div class="fh-wrap fh-command__row">` +
      `<div class="fh-command__start">${homeLink('fh-logo--bar')}</div>` +
      `<div class="fh-chip">` +
      `<span class="fh-chip__prompt" aria-hidden="true">$</span><code class="fh-chip__cmd">${INSTALL}</code>` +
      `<button class="fh-chip__copy" type="button" data-fh-copy="${INSTALL}">` +
      `<span class="fh-chip__idle">${ICON.copy}</span><span class="fh-chip__done">${ICON.check}</span>` +
      `<span class="fh-chip__word"><span class="fh-chip__idle">Copy</span><span class="fh-chip__done">Copied</span></span>` +
      `<span class="fh-sr"> install command</span></button></div>` +
      `<div class="fh-command__end"><a class="fh-link" href="${DOCS}">Docs</a>` +
      `<a class="vc-icon-btn" href="${GITHUB}" target="_blank" rel="noopener" aria-label="visual-check on GitHub (opens in a new tab)">${ICON.github}</a>` +
      `${themeButton('vc-icon-btn')}</div></div>`,

    /* The design system's SiteHeader (vc-header__top + vc-header__bar): the logo alone while the hero is on
       screen; the bar with the sections, GitHub, theme and Get started once the hero's install command has gone. */
    reveal: () => `<div class="vc-header__top fh-reveal__top"><a class="vc-header__logo" href="#top" aria-label="visual-check home">` +
      `${logoPair('logo-horizontal', '', 'visual-check')}</a></div>` +
      `<div class="vc-header__bar" data-fh-bar><div class="vc-header__inner">` +
      `<a class="vc-header__logo" href="#top" aria-label="Back to the top">${logoPair('logo-horizontal', '', 'visual-check')}</a>` +
      `<nav class="vc-header__nav" aria-label="On this page">` +
      SECTIONS.map(([slot, label]) => `<a href="#${slot}" data-fh-slot="${slot}">${label}</a>`).join('') +
      `</nav><div class="vc-header__actions">` +
      `<a class="vc-icon-btn" href="${GITHUB}" target="_blank" rel="noopener" aria-label="visual-check on GitHub (opens in a new tab)">${ICON.github}</a>` +
      `${themeButton('vc-icon-btn')}` +
      `<a class="vc-btn vc-btn--primary vc-btn--sm" href="${DOCS}">Get started</a></div></div></div>`,

    corners: () => `<div class="fh-corners__frame">` +
      `<div class="fh-corner fh-corner--tl"><a class="fh-home" href="#top">${logoPair('mark', 'fh-mark', 'visual-check')}</a></div>` +
      `<div class="fh-corner fh-corner--tr"><nav class="fh-corner__nav" aria-label="Site">` +
      `<a class="fh-mono" href="${DOCS}">Docs</a><span class="fh-corner__dot" aria-hidden="true">·</span>` +
      `<a class="fh-mono" href="${GITHUB}" target="_blank" rel="noopener">GitHub<span class="fh-mono__out" aria-hidden="true">↗</span>${NEW_TAB}</a>` +
      `<span class="fh-corner__dot" aria-hidden="true">·</span></nav>${themeButton('fh-glyph')}</div>` +
      `<span class="fh-corner fh-corner--bl" aria-hidden="true"></span><span class="fh-corner fh-corner--br" aria-hidden="true"></span></div>`
  };

  host.classList.add('fh-host');
  host.innerHTML = NAMES.map((name) => `<header class="fh fh-${name}${name === 'reveal' ? ' vc-header' : ''}" data-fh-name="${name}" hidden>${BUILD[name]()}</header>`).join('') +
    '<p class="fh-sr" role="status" data-fh-status></p>';

  const headers = Array.from(host.querySelectorAll('[data-fh-name]'));
  const status = host.querySelector('[data-fh-status]');

  /* ---------- active header ---------- */

  /**
   * Shows one header and hides the rest. Unknown names fall back to `bare`, the toggle's default.
   */
  function show(name) {
    const active = NAMES.indexOf(name) > -1 ? name : 'bare';
    headers.forEach((header) => {
      header.hidden = header.getAttribute('data-fh-name') !== active;
    });
    host.setAttribute('data-fh-active', active);
    root.setAttribute('data-fh-header', active);
  }

  /**
   * Keeps every theme toggle's pressed state in step with the page theme.
   */
  function syncTheme() {
    const dark = root.getAttribute('data-theme') === 'dark';
    host.querySelectorAll('[data-kit-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', String(dark));
    });
  }

  show(root.getAttribute('data-t-header'));
  syncTheme();
  document.addEventListener('vc-proto:toggle', (event) => {
    if (event.detail && event.detail.id === 'header') {
      show(event.detail.value);
    }
  });
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- in-page anchors (reveal bar) ---------- */

  const slotSections = Array.from(document.querySelectorAll('[data-slot]'));
  slotSections.forEach((section) => section.classList.add('fh-target'));

  const tocLinks = {};
  SECTIONS.forEach(([slot]) => {
    const link = host.querySelector(`[data-fh-slot="${slot}"]`);
    const section = document.querySelector(`[data-slot="${slot}"]`);
    if (!section) {
      link.hidden = true;
      return;
    }
    if (!section.id) {
      section.id = `fh-${slot}`;
    }
    link.href = `#${section.id}`;
    tocLinks[slot] = link;
  });

  /* ---------- reveal: the bar appears once the hero has scrolled away ---------- */

  /**
   * Calls back with true while the element is on screen. Uses the kit's helper when it's there.
   */
  function watch(element, callback, options) {
    if (window.VCProto && window.VCProto.onView) {
      return window.VCProto.onView(element, callback, options);
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => callback(entry.isIntersecting));
    }, { rootMargin: options.rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }

  const canWatch = 'IntersectionObserver' in window;
  const hero = document.querySelector('[data-slot="hero"]');
  const bar = host.querySelector('[data-fh-bar]');
  /* The bar takes over once the hero's install command has scrolled past (not the whole, tall hero),
     and only when it has gone up: on a phone the command may start below the fold. */
  const revealAnchor = hero && Array.from(hero.querySelectorAll('pre, code'))
    .find((element) => element.textContent.indexOf('@visual-check/cli init') > -1);
  const revealTrigger = revealAnchor || hero || host.querySelector('.fh-reveal .fh-row');
  if (canWatch) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.bottom <= 48;
        bar.classList.toggle('is-shown', scrolledPast);
      });
    }, { rootMargin: '-48px 0px 0px 0px' });
    revealObserver.observe(revealTrigger);
  } else {
    bar.classList.add('is-shown');
  }

  /* ---------- slug: the header's slug replaces the hero's own slug row ---------- */

  const heroSlug = hero && hero.querySelector('[class*="slug"]');
  if (heroSlug) {
    heroSlug.classList.add('fh-absorbed');
  }

  /* ---------- command: the chip waits until the hero's own install command has scrolled away ---------- */

  const chip = host.querySelector('.fh-chip');
  const heroInstall = hero && Array.from(hero.querySelectorAll('pre, code')).find((element) => element.textContent.indexOf(INSTALL) > -1);
  if (heroInstall && canWatch) {
    chip.classList.add('is-away');
    watch(heroInstall, (visible) => chip.classList.toggle('is-away', visible), { rootMargin: '-48px 0px 0px 0px' });
  }

  /* Scrollspy: the link of the section crossing a line 40% down the screen is current. */
  if (canWatch && slotSections.length) {
    const crossing = new Map();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => crossing.set(entry.target, entry.isIntersecting));
      const current = slotSections.find((section) => crossing.get(section));
      const currentSlot = current ? current.getAttribute('data-slot') : '';
      Object.keys(tocLinks).forEach((slot) => {
        if (slot === currentSlot) {
          tocLinks[slot].setAttribute('aria-current', 'location');
        } else {
          tocLinks[slot].removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-40% 0px -59% 0px' });
    slotSections.forEach((section) => spy.observe(section));
  }

  /* ---------- copy the install command ---------- */

  /**
   * Writes text to the clipboard; falls back to a hidden textarea where the Clipboard API is missing or refused.
   */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const focused = document.activeElement;
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'fh-sr';
      area.style.position = 'fixed';
      area.style.top = '0';
      document.body.appendChild(area);
      area.focus({ preventScroll: true });
      area.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (fallbackError) {
        copied = false;
      }
      area.remove();
      if (focused && focused.focus) {
        focused.focus({ preventScroll: true });
      }
      return copied;
    }
  }

  host.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-fh-copy]');
    if (!button) {
      return;
    }
    const copied = await copyText(button.getAttribute('data-fh-copy'));
    status.textContent = copied ? 'Install command copied' : 'Couldn’t copy. Select the command and copy it.';
    if (!copied) {
      return;
    }
    button.classList.add('is-copied');
    clearTimeout(button.fhTimer);
    button.fhTimer = setTimeout(() => {
      button.classList.remove('is-copied');
      status.textContent = '';
    }, COPIED_MS);
  });
})();
