/* PROTOTYPE — throwaway. visual-check site prototypes (issue #102), shared kit.
 *
 * Load in <head>, right after `window.VC_PAGE = {...}`:
 *   <script>window.VC_PAGE = { set: 'landing', key: 'A', toggles: [{ id: 'hero', label: 'Hero art', options: ['plates', 'terminal'] }] };</script>
 *   <script src="../shared/proto-kit.js"></script>
 *
 * What it does
 * - Theme: `data-theme` + `.dark` on <html>, from ?theme=, the last choice, or the OS. Any [data-kit-theme-toggle] toggles it.
 * - Switcher bar (bottom centre): ‹ variant › · theme · motion · copy · idea toggles · hub. ← / → cycle variants.
 * - Idea toggles: each VC_PAGE.toggles entry becomes a bar button that cycles its options and sets
 *   `data-t-<id>="<option>"` on <html>. Style with `html[data-t-hero="terminal"] …`.
 * - Copy alternatives: <h1 data-copy><span data-copy-alt>One</span><span data-copy-alt>Two</span></h1>.
 *   The bar's "Copy" button cycles every group on the page together.
 * - Header / footer: <div data-kit="header"></div> and <div data-kit="footer"></div> render the design system's SiteHeader and a footer.
 * - Embed mode (?embed=1&slot=hero): shows only that [data-slot] section and reports its height to the parent (the mixer).
 * - VCProto.scene(): a tiny timeline for animated demos (see below). VCProto.onView(): IntersectionObserver helper.
 * - VCProto.motion: 'auto' (play when seen) | 'click' (end state + play button) | 'still' (end state only).
 *   Defaults to 'still' under prefers-reduced-motion.
 */
(function () {
  'use strict';

  var SETS = {
    landing: {
      label: 'Landing',
      dir: 'landing/',
      items: [
        { key: 'A', file: 'a.html', name: 'Proof sheet' },
        { key: 'B', file: 'b.html', name: 'One terminal' },
        { key: 'C', file: 'c.html', name: 'Page under test' },
        { key: 'D', file: 'd.html', name: 'Three surfaces' },
        { key: 'E', file: 'e.html', name: 'Agent speed' },
        { key: 'F', file: 'f.html', name: 'Chosen mix, tightened' },
        { key: 'Mix', file: 'mix.html', name: 'Mix and match' }
      ]
    },
    docs: {
      label: 'Docs',
      dir: 'docs/',
      items: [
        { key: '1', file: '1.html', name: 'Classic' },
        { key: '2', file: '2.html', name: 'Notebook' },
        { key: '3', file: '3.html', name: 'Illustrated' }
      ]
    }
  };
  var SLOTS = ['hero', 'problem', 'demo', 'commands', 'features', 'agent', 'faq', 'cta'];

  var PAGE = window.VC_PAGE || {};
  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  /* Hosts that drop query strings (the artifact viewer) still keep the hash inside a frame:
     the mixer passes `#embed=1&slot=hero&…`, merged here under any query values. */
  if (location.hash.indexOf('=') > -1) {
    new URLSearchParams(location.hash.slice(1)).forEach(function (value, key) { if (!params.has(key)) params.set(key, value); });
  }
  var embed = params.get('embed') === '1';
  var embedSlot = params.get('slot');

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('vc-proto:' + k);
      if (v === null) localStorage.removeItem('vc-proto:' + k);
      else localStorage.setItem('vc-proto:' + k, String(v));
    } catch (e) { /* storage blocked: state lives in the URL only */ }
    return null;
  }
  function mq(q) { return window.matchMedia ? window.matchMedia(q).matches : false; }

  /* ---------- theme ---------- */
  var theme = params.get('theme') || (embed ? null : store('theme')) || (mq('(prefers-color-scheme: dark)') ? 'dark' : 'light');
  function applyTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }
  applyTheme(theme);
  function setTheme(t) {
    applyTheme(t);
    if (!embed) store('theme', theme);
    syncUrl();
    renderBar();
    var frames = document.querySelectorAll('iframe[data-kit-frame]');
    for (var i = 0; i < frames.length; i++) {
      try { frames[i].contentWindow.postMessage({ type: 'vc-proto:theme', theme: theme }, '*'); } catch (e) {}
    }
  }

  /* ---------- motion ---------- */
  var MOTIONS = ['auto', 'click', 'still'];
  var MOTION_LABEL = { auto: 'plays when seen', click: 'click to play', still: 'end state' };
  var motion = params.get('motion') || (embed ? null : store('motion')) || (mq('(prefers-reduced-motion: reduce)') ? 'still' : 'auto');
  if (MOTIONS.indexOf(motion) < 0) motion = 'auto';
  root.setAttribute('data-motion', motion);

  /* ---------- copy alternatives ---------- */
  var copyIdx = parseInt(params.get('copy') || store('copy:' + PAGE.set + ':' + PAGE.key) || '0', 10) || 0;

  /* ---------- idea toggles ---------- */
  var toggles = (PAGE.toggles || []).map(function (t) {
    var key = 'toggle:' + PAGE.set + ':' + PAGE.key + ':' + t.id;
    var v = params.get('t-' + t.id) || store(key) || t.options[0];
    if (t.options.indexOf(v) < 0) v = t.options[0];
    root.setAttribute('data-t-' + t.id, v);
    return { id: t.id, label: t.label, options: t.options, value: v, storeKey: key };
  });

  if (embed) root.classList.add('kit-embed');

  /* ---------- URL sync (shareable, reload-stable) ---------- */
  function syncUrl() {
    if (embed || !window.history || !history.replaceState) return;
    var p = new URLSearchParams(location.search);
    p.set('theme', theme);
    if (motion !== 'auto') p.set('motion', motion); else p.delete('motion');
    if (copyIdx) p.set('copy', String(copyIdx)); else p.delete('copy');
    toggles.forEach(function (t) {
      if (t.value !== t.options[0]) p.set('t-' + t.id, t.value); else p.delete('t-' + t.id);
    });
    if (PAGE.extraParams) PAGE.extraParams(p);
    var q = p.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (e) {}
  }
  function carryParams() {
    var p = new URLSearchParams();
    p.set('theme', theme);
    if (motion !== 'auto') p.set('motion', motion);
    return p.toString();
  }

  /* ---------- icons (the design system's hand-drawn stand-ins) ---------- */
  var ICON = {
    search16: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>',
    search: '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>',
    github: '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 15.5c-3 1-3-1.5-4.5-2M12.5 17.5v-2.6a2.3 2.3 0 0 0-.6-1.7c2.1-.2 4.3-1 4.3-4.7a3.6 3.6 0 0 0-1-2.5 3.4 3.4 0 0 0 0-2.5s-.8-.2-2.6 1a9 9 0 0 0-4.7 0C6.1 3.3 5.3 3.5 5.3 3.5a3.4 3.4 0 0 0 0 2.5 3.6 3.6 0 0 0-1 2.5c0 3.7 2.2 4.5 4.3 4.7a2.3 2.3 0 0 0-.6 1.7v2.6"/></svg>',
    theme: '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>',
    menu: '<svg class="vc-icon vc-icon--20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg>',
    arrow: '<svg class="vc-icon vc-btn__arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
    play: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>',
    pause: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>',
    replay: '<svg class="vc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5"/></svg>'
  };

  /* ---------- header / footer ---------- */
  var GITHUB = 'https://github.com/visual-check/visual-check';
  function docsHref(hash) {
    var file = PAGE.set === 'docs' ? (location.pathname.split('/').pop() || '1.html') : '../docs/1.html';
    return file + (hash ? '#' + hash : '');
  }
  function headerHTML(el) {
    var current = el.getAttribute('data-current') || '';
    var nav = [
      ['docs', 'Docs', docsHref('getting-started')],
      ['addon', 'Storybook addon', docsHref('storybook-addon')],
      ['skill', 'Agent skill', docsHref('agent-skill')],
      ['changelog', 'Changelog', GITHUB + '/releases']
    ];
    var links = nav.map(function (n) {
      var ext = n[2].indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + n[2] + '"' + ext + (n[0] === current ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('');
    return '<header class="vc-header kit-header"><div class="vc-header__inner">' +
      '<a class="vc-header__logo" href="' + (PAGE.set === 'docs' ? '../landing/a.html' : '#top') + '" aria-label="visual-check home">' +
      '<img class="vc-only-light" src="../shared/logo/logo-horizontal.svg" alt="visual-check">' +
      '<img class="vc-only-dark" src="../shared/logo/logo-horizontal-dark.svg" alt="visual-check"></a>' +
      '<nav class="vc-header__nav" aria-label="Main">' + links + '</nav>' +
      '<div class="vc-header__actions">' +
      '<button class="vc-search" type="button">' + ICON.search16 + '<span class="vc-search__label">Search docs</span><kbd class="vc-kbd">⌘K</kbd></button>' +
      '<button class="vc-icon-btn vc-header__search-icon" type="button" aria-label="Search docs">' + ICON.search + '</button>' +
      '<a class="vc-icon-btn vc-header__wide" href="' + GITHUB + '" target="_blank" rel="noopener" aria-label="visual-check on GitHub">' + ICON.github + '</a>' +
      '<button class="vc-icon-btn" type="button" aria-label="Toggle theme" data-kit-theme-toggle>' + ICON.theme + '</button>' +
      '<a class="vc-btn vc-btn--primary vc-btn--sm vc-header__wide" href="' + docsHref('getting-started') + '">Get started</a>' +
      '<button class="vc-icon-btn vc-header__menu" type="button" aria-label="Open menu" aria-expanded="false" data-kit-menu>' + ICON.menu + '</button>' +
      '</div></div>' +
      '<nav class="kit-menu-sheet" aria-label="Menu" hidden>' + links + '<a href="' + GITHUB + '" target="_blank" rel="noopener">GitHub</a>' +
      '<a class="vc-btn vc-btn--primary" href="' + docsHref('getting-started') + '">Get started</a></nav>' +
      '</header>';
  }
  function footerHTML() {
    return '<footer class="kit-footer"><div class="kit-footer__inner">' +
      '<img class="vc-only-light" src="../shared/logo/mark.svg" alt="" width="28" height="28">' +
      '<img class="vc-only-dark" src="../shared/logo/mark-dark.svg" alt="" width="28" height="28">' +
      '<p class="kit-footer__text">visual-check is open source under the MIT licence. No service, no account.</p>' +
      '<nav class="kit-footer__nav" aria-label="Footer"><a href="' + docsHref('getting-started') + '">Docs</a>' +
      '<a href="' + GITHUB + '" target="_blank" rel="noopener">GitHub</a>' +
      '<a href="https://www.npmjs.com/package/visual-check" target="_blank" rel="noopener">npm</a></nav>' +
      '</div></footer>';
  }

  /* ---------- switcher bar ---------- */
  var bar, barCollapsed = store('bar-collapsed') === '1', extraButtons = [];
  function setInfo() { return SETS[PAGE.set] || null; }
  function goVariant(step) {
    var s = setInfo(); if (!s) return;
    var i = 0;
    for (var j = 0; j < s.items.length; j++) if (s.items[j].key === PAGE.key) i = j;
    var next = s.items[(i + step + s.items.length) % s.items.length];
    location.href = next.file + '?' + carryParams();
  }
  function maxCopy() {
    var m = 0, groups = document.querySelectorAll('[data-copy]');
    for (var i = 0; i < groups.length; i++) m = Math.max(m, groups[i].querySelectorAll(':scope > [data-copy-alt]').length);
    return m;
  }
  function applyCopy() {
    var groups = document.querySelectorAll('[data-copy]');
    for (var i = 0; i < groups.length; i++) {
      var alts = groups[i].querySelectorAll(':scope > [data-copy-alt]');
      for (var j = 0; j < alts.length; j++) alts[j].classList.toggle('kit-hidden', j !== copyIdx % alts.length);
    }
  }
  function btn(label, title, onClick, extraClass) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-bar__btn' + (extraClass ? ' ' + extraClass : '');
    b.innerHTML = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  function renderBar() {
    if (embed || !bar) return;
    bar.innerHTML = '';
    bar.classList.toggle('is-collapsed', barCollapsed);
    if (barCollapsed) {
      bar.appendChild(btn('Prototype ▴', 'Show the prototype bar', function () { barCollapsed = false; store('bar-collapsed', null); renderBar(); }));
      return;
    }
    var s = setInfo();
    if (s) {
      bar.appendChild(btn('‹', 'Previous variant (←)', function () { goVariant(-1); }, 'kit-bar__arrow'));
      var sel = document.createElement('select');
      sel.className = 'kit-bar__select';
      sel.setAttribute('aria-label', s.label + ' variant');
      s.items.forEach(function (it) {
        var o = document.createElement('option');
        o.value = it.file;
        o.textContent = it.key + ' · ' + it.name;
        if (it.key === PAGE.key) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { location.href = sel.value + '?' + carryParams(); });
      bar.appendChild(sel);
      bar.appendChild(btn('›', 'Next variant (→)', function () { goVariant(1); }, 'kit-bar__arrow'));
      bar.appendChild(sep());
    }
    bar.appendChild(btn(theme === 'dark' ? 'Dark' : 'Light', 'Theme', function () { setTheme(theme === 'dark' ? 'light' : 'dark'); }));
    if (PAGE.set !== 'docs' || PAGE.motion) {
      bar.appendChild(btn('Motion: ' + MOTION_LABEL[motion], 'How demos play', function () {
        motion = MOTIONS[(MOTIONS.indexOf(motion) + 1) % MOTIONS.length];
        store('motion', motion); syncUrl(); location.reload();
      }));
    }
    var mc = maxCopy();
    if (mc > 1) {
      bar.appendChild(btn('Copy ' + ((copyIdx % mc) + 1) + '/' + mc, 'Cycle the alternative headlines and copy', function () {
        copyIdx = (copyIdx + 1) % mc; store('copy:' + PAGE.set + ':' + PAGE.key, copyIdx); applyCopy(); syncUrl(); renderBar();
      }));
    }
    toggles.forEach(function (t) {
      bar.appendChild(btn(t.label + ': ' + t.value, 'Cycle ' + t.label, function () {
        t.value = t.options[(t.options.indexOf(t.value) + 1) % t.options.length];
        root.setAttribute('data-t-' + t.id, t.value);
        store(t.storeKey, t.value); syncUrl(); renderBar();
        document.dispatchEvent(new CustomEvent('vc-proto:toggle', { detail: { id: t.id, value: t.value } }));
      }));
    });
    extraButtons.forEach(function (e) { bar.appendChild(btn(e.label(), e.title, e.onClick)); });
    bar.appendChild(sep());
    var hub = document.createElement('a');
    hub.className = 'kit-bar__btn';
    hub.href = '../index.html';
    hub.textContent = 'Hub';
    bar.appendChild(hub);
    bar.appendChild(btn('▾', 'Hide the prototype bar', function () { barCollapsed = true; store('bar-collapsed', '1'); renderBar(); }));
  }
  function sep() { var s = document.createElement('span'); s.className = 'kit-bar__sep'; s.setAttribute('aria-hidden', 'true'); return s; }

  /* ---------- onView ---------- */
  function onView(el, cb, opts) {
    opts = opts || {};
    if (!('IntersectionObserver' in window)) { cb(true); return function () {}; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var vis = e.isIntersecting && e.intersectionRatio >= (opts.threshold || 0.01);
        cb(vis, e);
        if (vis && opts.once) io.disconnect();
      });
    }, { threshold: [0, opts.threshold || 0.01, 0.5, 1], rootMargin: opts.rootMargin || '0px' });
    io.observe(el);
    return function () { io.disconnect(); };
  }

  /* ---------- scene timeline ----------
   * var demo = VCProto.scene(rootEl, async function (t) {
   *   t.chapter(0);
   *   await t.type('.cmd', 'npx visual-check test');
   *   await t.wait(400);
   *   t.add('.out', '<div class="line">412 passed</div>');
   *   t.chapter(1); …
   * }, { controls: controlsEl, chapters: ['init', 'update', 'test'], label: 'Terminal demo' });
   *
   * rootEl's markup at registration is the START state; it is restored before every play, so always query
   * through t.$ / t.$$ inside the script. When not playing, the scene shows its END state (the script run
   * instantly), so the page is complete at rest, in thumbnails and under reduced motion.
   */
  var CANCEL = {};
  function scene(rootEl, script, opts) {
    opts = opts || {};
    if (typeof rootEl === 'string') rootEl = document.querySelector(rootEl);
    if (!rootEl) return null;
    var start = rootEl.innerHTML;
    var runId = 0, paused = false, resumers = [], state = 'idle', chapterNow = -1, jumpTarget = -1, playedOnce = false, inView = false;
    var controls = typeof opts.controls === 'string' ? document.querySelector(opts.controls) : opts.controls;
    var chapters = opts.chapters || [];

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function resolveEl(x) { return typeof x === 'string' ? rootEl.querySelector(x) : x; }

    function api(id, instantAll) {
      var t = { root: rootEl, instant: instantAll };
      function check() { if (id !== runId) throw CANCEL; }
      t.$ = function (sel) { return rootEl.querySelector(sel); };
      t.$$ = function (sel) { return Array.prototype.slice.call(rootEl.querySelectorAll(sel)); };
      t.wait = async function (ms) {
        check();
        if (t.instant) return;
        var left = ms;
        while (left > 0) {
          if (paused) { await new Promise(function (r) { resumers.push(r); }); check(); }
          var step = Math.min(left, 40);
          await sleep(step); check();
          left -= step;
        }
      };
      t.type = async function (el, text, o) {
        el = resolveEl(el); check();
        if (!el) return;
        if (t.instant) { el.textContent += text; return; }
        var cps = (o && o.cps) || 32;
        el.classList.add('is-typing');
        for (var i = 0; i < text.length; i++) {
          el.textContent += text[i];
          await t.wait((1000 / cps) * (0.6 + Math.random() * 0.8));
        }
        el.classList.remove('is-typing');
      };
      t.add = function (parent, html) {
        parent = resolveEl(parent); check();
        parent.insertAdjacentHTML('beforeend', html);
        return parent.lastElementChild;
      };
      t.lines = async function (parent, htmlLines, gap) {
        for (var i = 0; i < htmlLines.length; i++) { t.add(parent, htmlLines[i]); await t.wait(gap == null ? 120 : gap); }
      };
      t.chapter = function (i) {
        check();
        if (jumpTarget >= 0 && i >= jumpTarget) {
          t.instant = false; jumpTarget = -1;
          state = 'playing'; rootEl.setAttribute('data-scene', 'playing');
        }
        chapterNow = i; paintControls();
        rootEl.setAttribute('data-chapter', String(i));
      };
      return t;
    }

    async function run(instant) {
      var id = ++runId;
      paused = false; flushResume();
      rootEl.innerHTML = start;
      chapterNow = -1;
      state = instant ? 'ending' : 'playing';
      rootEl.setAttribute('data-scene', state);
      paintControls();
      try {
        await script(api(id, instant));
        if (id === runId) { state = 'ended'; rootEl.setAttribute('data-scene', 'ended'); paintControls(); }
      } catch (e) {
        if (e !== CANCEL) { console.error(e); }
      }
    }
    function flushResume() { var r = resumers; resumers = []; r.forEach(function (f) { f(); }); }
    function play() { playedOnce = true; jumpTarget = -1; return run(false); }
    function end() { jumpTarget = -1; return run(true); }
    function jump(i) { playedOnce = true; jumpTarget = i; return run(true); }
    function pause() { if (state === 'playing') { paused = true; state = 'paused'; rootEl.setAttribute('data-scene', 'paused'); paintControls(); } }
    function resume() { if (state === 'paused') { paused = false; state = 'playing'; rootEl.setAttribute('data-scene', 'playing'); flushResume(); paintControls(); } }

    function paintControls() {
      if (!controls) return;
      var playing = state === 'playing';
      var html = '';
      if (motion !== 'still') {
        if (playing) html += '<button type="button" class="kit-scene-btn" data-act="pause" aria-label="Pause demo">' + ICON.pause + '</button>';
        else if (state === 'paused') html += '<button type="button" class="kit-scene-btn" data-act="resume" aria-label="Resume demo">' + ICON.play + '</button>';
        else html += '<button type="button" class="kit-scene-btn" data-act="play" aria-label="Play demo">' + ICON.play + (playedOnce ? '' : '<span>Play</span>') + '</button>';
        if (playedOnce && state !== 'ended') html += '<button type="button" class="kit-scene-btn" data-act="replay" aria-label="Replay demo">' + ICON.replay + '</button>';
        if (state === 'ended' && playedOnce) html = '<button type="button" class="kit-scene-btn" data-act="play" aria-label="Replay demo">' + ICON.replay + '<span>Replay</span></button>';
      }
      if (chapters.length) {
        html += '<span class="kit-scene-chapters">' + chapters.map(function (c, i) {
          return '<button type="button" class="kit-chapter" data-act="jump" data-i="' + i + '"' + (i === chapterNow ? ' aria-current="step"' : '') + '>' + c + '</button>';
        }).join('') + '</span>';
      }
      controls.innerHTML = html;
    }
    if (controls) {
      controls.classList.add('kit-scene-controls');
      controls.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'pause') pause();
        else if (act === 'resume') resume();
        else if (act === 'play' || act === 'replay') play();
        else if (act === 'jump') {
          var i = parseInt(b.getAttribute('data-i'), 10);
          if (motion === 'still') { jumpTarget = -1; runToChapter(i); } else jump(i);
        }
      });
    }
    // In 'still' mode a chapter click shows that chapter's end: run instantly, stop at the next chapter.
    function runToChapter(i) {
      var id = ++runId; rootEl.innerHTML = start;
      var t = api(id, true);
      var origChapter = t.chapter;
      t.chapter = function (n) { if (n > i) throw CANCEL; origChapter(n); };
      script(t).catch(function (e) { if (e !== CANCEL) console.error(e); }).then(function () { state = 'ended'; paintControls(); });
    }

    // Policy
    var controller = { play: play, pause: pause, resume: resume, end: end, jump: jump, get state() { return state; } };
    rootEl.setAttribute('aria-live', 'off');
    if (opts.label) rootEl.setAttribute('aria-label', opts.label);
    if (motion === 'auto' && !embed && isInViewport(rootEl)) play();
    else end();
    if (motion === 'auto') {
      onView(rootEl, function (vis) {
        inView = vis;
        if (vis && !playedOnce) play();
        else if (!vis && state === 'playing') { pause(); controller._autoPaused = true; }
        else if (vis && state === 'paused' && controller._autoPaused) { controller._autoPaused = false; resume(); }
      }, { threshold: 0.35 });
    }
    return controller;
  }
  function isInViewport(el) {
    var r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 0.8 && r.bottom > 0;
  }

  /* ---------- embed mode (for the mixer) ---------- */
  function setupEmbed() {
    var target = embedSlot && document.querySelector('[data-slot="' + embedSlot + '"]');
    if (!target) { document.body.innerHTML = '<p class="kit-missing">This variant has no "' + embedSlot + '" section.</p>'; target = document.body; }
    var node = target;
    while (node && node !== document.body && node.parentElement) {
      var parentEl = node.parentElement;
      for (var i = 0; i < parentEl.children.length; i++) {
        var c = parentEl.children[i];
        if (c !== node && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && !c.hasAttribute('data-kit-keep')) c.classList.add('kit-hidden');
      }
      node = parentEl;
    }
    function post() {
      var h = Math.ceil(document.body.getBoundingClientRect().height);
      try { window.parent.postMessage({ type: 'vc-proto:height', slot: embedSlot, height: h }, '*'); } catch (e) {}
    }
    if ('ResizeObserver' in window) new ResizeObserver(post).observe(document.body);
    window.addEventListener('load', post);
    post();
    window.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'vc-proto:theme') applyTheme(d.theme);
      if (d.type === 'vc-proto:copy') { copyIdx = d.copy; applyCopy(); }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    var hs = document.querySelectorAll('[data-kit="header"]');
    for (var i = 0; i < hs.length; i++) hs[i].innerHTML = headerHTML(hs[i]);
    var fs = document.querySelectorAll('[data-kit="footer"]');
    for (var k = 0; k < fs.length; k++) fs[k].innerHTML = footerHTML();
    applyCopy();
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-kit-theme-toggle]')) setTheme(theme === 'dark' ? 'light' : 'dark');
      var m = e.target.closest('[data-kit-menu]');
      if (m) {
        var sheet = m.closest('.kit-header').querySelector('.kit-menu-sheet');
        var open = sheet.hidden; sheet.hidden = !open; m.setAttribute('aria-expanded', String(open));
      }
    });
    if (embed) { setupEmbed(); return; }
    bar = document.createElement('div');
    bar.className = 'kit-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Prototype controls');
    document.body.appendChild(bar);
    renderBar();
    syncUrl();
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var a = document.activeElement;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      /* Arrow keys belong to widgets that use them (tabs, menus, sliders, open dialogs) */
      if (a && a.closest && a.closest('[role="slider"],[role="tab"],[role="tablist"],[role="menu"],[role="menubar"],[role="listbox"],[role="radiogroup"],[role="tree"],[role="grid"],dialog[open],[popover],[data-kit-arrows]')) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') goVariant(-1);
      if (e.key === 'ArrowRight') goVariant(1);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.VCProto = {
    SETS: SETS,
    SLOTS: SLOTS,
    get theme() { return theme; },
    setTheme: setTheme,
    get motion() { return motion; },
    get copy() { return copyIdx; },
    embed: embed,
    scene: scene,
    onView: onView,
    icon: ICON,
    addBarButton: function (label, title, onClick) { extraButtons.push({ label: typeof label === 'function' ? label : function () { return label; }, title: title, onClick: onClick }); renderBar(); },
    rerenderBar: function () { renderBar(); },
    syncUrl: syncUrl
  };
})();
