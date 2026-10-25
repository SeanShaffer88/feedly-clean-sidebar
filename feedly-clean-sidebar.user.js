// ==UserScript==
// @name         Feedly — Clean Sidebar & No Upgrade Prompts
// @namespace    https://github.com/SeanShaffer88
// @version      1.1.0
// @description  Hides the Create AI Feed, Search, Go to…, Read later and Recently read items from the Feedly sidebar, and continuously hides any Upgrade buttons, links and banners as they appear.
// @author       SEAN (via Muse)
// @match        https://feedly.com/*
// @match        https://*.feedly.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  v1.1 — why this version HIDES instead of removing nodes:
   *  Feedly is a React app. v1.0 deleted matched nodes from the DOM;
   *  React still holds references to those nodes, and on its next
   *  render it throws ("node to be removed is not a child…") and
   *  unmounts the whole app — a blank page. Early-load sweeps could
   *  also catch a half-rendered app shell. This version only ever
   *  sets display:none on matched elements (nodes stay in the DOM,
   *  React stays in charge of them) and adds hard guards so no
   *  element that wraps the app or the article stream can be hidden.
   * ------------------------------------------------------------------ */

  // Sidebar items from the screenshot, matched by their visible label.
  // Matching is exact after normalisation (case, whitespace, trailing
  // "..." / "…" and a trailing count like "(3)" are all ignored), so an
  // article whose headline merely *mentions* one of these phrases is
  // never touched — only a nav row whose whole label is one of these.
  const SIDEBAR_LABELS = new Set([
    'create ai feed',
    'create an ai feed',
    'search',
    'go to',
    'read later',
    'recently read',
  ]);

  // An element counts as an "Upgrade" element if it is a button/link/
  // banner and any of these hit:
  //   - its href points at an upgrade / pro / pricing page
  //   - its class, id, aria-label or data-testid mentions upgrade/upsell
  //   - its (short) visible text is an upgrade call-to-action
  const UPGRADE_HREF_RE = /(upgrade|upsell|\/pro\b|\/pricing|\/plans?\b|checkout.*plan)/i;
  const UPGRADE_TEXT_RE = /^(upgrade|upgrade now|upgrade to .+|go pro|try .{0,30}pro\b.*|get .{0,20}pro\b.*)$/i;
  // No \b anchors: textContent concatenates sibling nodes without
  // spaces ("…with Pro" + "Upgrade now" → "…with ProUpgrade now").
  const UPGRADE_BANNER_TEXT_RE = /upgrade/i;

  const INTERACTIVE_SEL =
    'a, button, [role="button"], [role="link"], [role="menuitem"], [role="treeitem"], [role="tab"], input[type="button"], input[type="submit"]';
  const ATTR_SEL =
    '[class*="upgrade" i], [class*="Upgrade"], [id*="upgrade" i], [class*="upsell" i], ' +
    '[id*="upsell" i], [data-testid*="upgrade" i], [aria-label*="upgrade" i]';

  const HIDDEN_ATTR = 'data-fcs-hidden';

  /* ------------------------------------------------------------------ *
   *  1. Instant CSS hide (runs at document-start, before first paint,
   *     so Upgrade CTAs never flash). Attribute-scoped only — these
   *     selectors can only match the upgrade element itself.
   * ------------------------------------------------------------------ */
  const css = `
    a[href*="upgrade" i], a[href*="/i/pro" i], a[href*="feedly.com/pro" i],
    ${ATTR_SEL} {
      display: none !important;
    }
  `;
  function injectCss() {
    try {
      if (document.getElementById('clean-sidebar-css')) return;
      const style = document.createElement('style');
      style.id = 'clean-sidebar-css';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* head not ready yet; start() retries */ }
  }
  injectCss();

  /* ------------------------------------------------------------------ *
   *  2. Hiding helpers + safety guards
   * ------------------------------------------------------------------ */

  function normalise(text) {
    return (text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(\.\.\.|…)\s*$/, '')      // "Go to..." / "Go to…"
      .replace(/\s*\(\d+\)\s*$/, '')       // trailing count "(3)"
      .trim();
  }

  // The label an element presents: its own visible text if it is short,
  // otherwise its aria-label / title.
  function labelOf(el) {
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
    const text = normalise(el.textContent);
    if (text && text.length <= 60) return text;
    return normalise(aria) || text;
  }

  function isInArticleContent(el) {
    // Never touch the article reading pane itself.
    return !!el.closest(
      'article, .entry, .article-content, [class*="Article" i], [data-testid*="article" i], main article'
    );
  }

  function isInNavArea(el) {
    return !!el.closest(
      'nav, aside, header, footer, [role="navigation"], [role="banner"], ' +
      '[class*="sidebar" i], [class*="leftnav" i], [class*="left-nav" i], ' +
      '[class*="navigation" i], [id*="sidebar" i], [data-testid*="sidebar" i], ' +
      '[data-testid*="left-nav" i], #feedlyTabs, #leftnav, #sidebar'
    );
  }

  // HARD GUARD — an element may only be hidden if it is small and does
  // not wrap the application or the content stream. This is what makes
  // a repeat of the v1.0 blank page impossible from this code path:
  // the app root, the stream container and anything holding <main> or
  // an <article> always fail this check, so at worst we hide the small
  // matched element itself.
  function isSafeToHide(el, maxDescendants) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.tagName === 'HTML' || el.tagName === 'BODY' || el.tagName === 'MAIN') return false;
    const descendants = el.querySelectorAll ? el.querySelectorAll('*').length : 0;
    if (descendants > maxDescendants) return false;
    if (el.querySelector && el.querySelector('main, article')) return false;
    // Never hide an ancestor of the main content region.
    const main = document.querySelector('main');
    if (main && el !== main && el.contains(main)) return false;
    return true;
  }

  function hideEl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.getAttribute(HIDDEN_ATTR) === '1') return true;
    try {
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute(HIDDEN_ATTR, '1');
      el.setAttribute('aria-hidden', 'true');
      return true;
    } catch (e) {
      return false;
    }
  }

  // Climb from a matched inner element to the outermost wrapper that
  // still represents *just this one row/item* (same text throughout),
  // stopping before nav/aside/ul/body and before any wrapper that is
  // too big to be a row. Returns the element to hide.
  function rowToHide(el) {
    let node = el;
    for (let depth = 0; depth < 5; depth++) {
      const parent = node.parentElement;
      if (!parent) break;
      const tag = parent.tagName;
      if (['UL', 'OL', 'NAV', 'ASIDE', 'HEADER', 'FOOTER', 'BODY', 'HTML', 'MAIN'].includes(tag)) break;
      if (parent.getAttribute && parent.getAttribute('role') === 'navigation') break;
      if (normalise(parent.textContent) !== normalise(node.textContent)) break;
      if (!isSafeToHide(parent, 40)) break;
      const others = [...parent.querySelectorAll(INTERACTIVE_SEL)].filter(
        (o) => o !== el && !el.contains(o) && !o.contains(el)
      );
      if (others.length) break;
      node = parent;
    }
    const li = node.closest('li');
    if (li && li.contains(el) && normalise(li.textContent) === normalise(el.textContent) && isSafeToHide(li, 40)) {
      node = li;
    }
    return node;
  }

  function hideRowOrSelf(el) {
    if (!el || !el.isConnected) return;
    const target = rowToHide(el);
    if (isSafeToHide(target, 40)) { hideEl(target); return; }
    // Fall back to hiding only the matched element itself.
    if (isSafeToHide(el, 40)) hideEl(el);
  }

  /* ------------------------------------------------------------------ *
   *  3. The hiding passes
   * ------------------------------------------------------------------ */

  // A row's label may be prefixed by a short icon badge rendered as
  // text — Feedly's "Create AI Feed" row carries an "AI+" badge — so a
  // label also matches if it *ends* with a target label and the prefix
  // is just a few badge characters.
  function isSidebarLabel(label) {
    if (SIDEBAR_LABELS.has(label)) return true;
    for (const target of SIDEBAR_LABELS) {
      if (label.endsWith(target)) {
        const prefix = label.slice(0, label.length - target.length).trim();
        if (prefix.length <= 4) return true;
      }
    }
    return false;
  }

  function hideSidebarItems(root) {
    if (!root || !root.querySelectorAll) return;
    const seen = new Set();
    const check = (el) => {
      if (seen.has(el) || !el.isConnected || isInArticleContent(el)) return;
      seen.add(el);
      if (el.getAttribute(HIDDEN_ATTR) === '1') return;
      if (!isSidebarLabel(labelOf(el))) return;
      if (isInNavArea(el) || el.matches(INTERACTIVE_SEL)) {
        hideRowOrSelf(el);
      }
    };
    root.querySelectorAll(INTERACTIVE_SEL + ', li, [class*="item" i]').forEach(check);
    // Plain row <div>/<span> wrappers inside nav/sidebar areas, for
    // Feedly builds where the row itself is not the link.
    const navSel =
      'nav, aside, [role="navigation"], [class*="sidebar" i], [class*="leftnav" i], ' +
      '[id*="sidebar" i], [data-testid*="sidebar" i], #feedlyTabs, #leftnav';
    const scope = root.matches && root.matches(navSel) ? [root] : [...root.querySelectorAll(navSel)];
    for (const navRoot of scope) {
      navRoot.querySelectorAll('div, span').forEach((el) => {
        if (el.children.length <= 3) check(el);
      });
    }
  }

  function hideUpgradeByAttributes(root) {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll(ATTR_SEL)) {
      if (!el.isConnected || isInArticleContent(el)) continue;
      if (el.getAttribute(HIDDEN_ATTR) === '1') continue;
      const text = normalise(el.textContent);
      if (
        el.matches(INTERACTIVE_SEL) ||
        UPGRADE_BANNER_TEXT_RE.test(text) ||
        (el.textContent || '').trim().length <= 120
      ) {
        hideRowOrSelf(el);
      }
    }
    for (const el of root.querySelectorAll('a[href], [href]')) {
      if (!el.isConnected) continue;
      const href = el.getAttribute('href') || '';
      if (UPGRADE_HREF_RE.test(href) && !isInArticleContent(el)) {
        hideRowOrSelf(el);
      }
    }
  }

  function hideUpgradeByText(root) {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll(INTERACTIVE_SEL)) {
      if (!el.isConnected || isInArticleContent(el)) continue;
      if (el.getAttribute(HIDDEN_ATTR) === '1') continue;
      const label = labelOf(el);
      if (label.length > 90) continue;
      if (UPGRADE_TEXT_RE.test(label) || (/upgrade/i.test(label) && el.matches('a, button, [role="button"]'))) {
        hideRowOrSelf(el);
      }
    }
  }

  function hideUpgradeBanners(root) {
    if (!root || !root.querySelectorAll) return;
    // Only run once the page has finished its initial parse — during
    // early load a half-rendered app shell can look deceptively small.
    if (document.readyState === 'loading') return;
    const containers = root.querySelectorAll(
      'div, section, aside, footer, [role="dialog"], [role="alertdialog"], [class*="banner" i], [class*="modal" i], [class*="popover" i], [class*="card" i]'
    );
    for (const box of containers) {
      if (!box.isConnected || isInArticleContent(box)) continue;
      if (box.getAttribute(HIDDEN_ATTR) === '1') continue;
      const text = normalise(box.textContent);
      if (!text || text.length > 500) continue;
      if (!UPGRADE_BANNER_TEXT_RE.test(text)) continue;
      const interactives = [...box.querySelectorAll(INTERACTIVE_SEL)];
      const hasUpgradeCta = interactives.some((c) =>
        UPGRADE_TEXT_RE.test(labelOf(c)) || UPGRADE_HREF_RE.test(c.getAttribute('href') || '')
      );
      const hasCta = interactives.length > 0;
      const isBannerLike = !!box.closest(
        'header, aside, nav, [role="dialog"], [role="alertdialog"], [class*="banner" i], [class*="modal" i], [class*="popover" i], [class*="toast" i]'
      ) || box.matches('[role="dialog"], [role="alertdialog"]');
      // A banner holds at most one unrelated control (e.g. a close ×).
      // A region holding several ordinary links is navigation/content
      // that merely *contains* an upgrade pitch — leave the region;
      // the CTA itself is hidden by the text/attribute passes.
      const otherControls = interactives.filter(
        (c) => !UPGRADE_TEXT_RE.test(labelOf(c)) && !UPGRADE_HREF_RE.test(c.getAttribute('href') || '')
      );
      if ((hasUpgradeCta && otherControls.length <= 1) || (hasCta && isBannerLike && otherControls.length <= 1)) {
        if (isSafeToHide(box, 120)) hideEl(box);
      }
    }
  }

  let sweeping = false;
  function sweep(root) {
    const scope = root && root.nodeType === Node.ELEMENT_NODE ? root : document;
    // Banners first, while their Upgrade CTA is still visible inside
    // them, so the whole pitch is hidden in one go.
    hideUpgradeBanners(scope);
    hideUpgradeByAttributes(scope);
    hideUpgradeByText(scope);
    hideSidebarItems(scope);
  }

  function fullSweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      injectCss();
      sweep(document);
    } catch (e) {
      // A cleaning error must never take the page down with it.
    } finally {
      sweeping = false;
    }
  }

  /* ------------------------------------------------------------------ *
   *  4. Continuous watching — Feedly injects items and Upgrade prompts
   *     on navigation, on a timer, and after API responses. Watch for
   *     added nodes and attribute swaps; hiding (not removing) means
   *     our own changes never trigger React errors. A low-frequency
   *     safety sweep covers anything that slips through.
   * ------------------------------------------------------------------ */

  let rafPending = false;
  function scheduleSweep() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      fullSweep();
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Ignore mutations we caused ourselves (style/data attributes
      // are not in the attribute filter, and hidden nodes staying in
      // the DOM means we cause no childList mutations at all).
      if (m.type === 'childList' && m.addedNodes.length) { scheduleSweep(); return; }
      if (m.type === 'attributes') { scheduleSweep(); return; }
    }
  });

  let started = false;
  function start() {
    if (started) { fullSweep(); return; }
    started = true;
    injectCss();
    fullSweep();
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'class', 'id', 'aria-label', 'data-testid', 'role'],
      });
    } catch (e) { /* interval below still covers us */ }
    setInterval(fullSweep, 2000);
    window.addEventListener('popstate', scheduleSweep);
    window.addEventListener('hashchange', scheduleSweep);
  }

  start();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
