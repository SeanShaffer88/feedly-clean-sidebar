# Feedly — Clean Sidebar & No Upgrade Prompts

## TL;DR
A userscript for Feedly that removes the **Create AI Feed**, **Search**, **Go to…**, **Read later**, and **Recently read** items from the left sidebar, and continuously removes any **Upgrade** button, link, or banner as it appears — including ones Feedly injects after the page loads.

## Install
1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw script and confirm the install in the manager: https://raw.githubusercontent.com/SeanShaffer88/feedly-clean-sidebar/main/feedly-clean-sidebar.user.js
3. Reload Feedly. No configuration needed.

**Status:** v1.1.0 is field-verified on the author's own Feedly account (2026-10-24) — page loads normally, the five sidebar items are gone, and Upgrade prompts are hidden as they appear.

## How it works
- **Hide, never delete (v1.1 fix):** v1.0 deleted matched nodes from the DOM — Feedly is a React app, React kept references to the deleted nodes and crashed on its next render, giving a blank page. v1.1 only ever sets `display: none` on matched elements; the nodes stay in the DOM under React's control, so the app cannot crash that way. Hard guards also refuse to hide anything that wraps the app root, the article stream, or a `<main>`/`<article>`.
- **Instant hide:** a CSS rule injected at `document-start` hides known Upgrade elements (upgrade hrefs, `upgrade`/`upsell` classes, ids, testids, aria-labels) before first paint, so they never flash.
- **Label-based hiding:** the five sidebar rows are hidden by exact visible-label match (icon-badge prefixes like Feedly's "AI+" chip, trailing "…", and trailing counts are tolerated). Matching is exact, so article headlines that merely mention these phrases are untouched, and anything inside the article reading pane is never hidden.
- **Upgrade hiding:** buttons/links whose text, href, class, id, or aria-label marks them as an upgrade CTA are hidden, along with bounded banner/card/modal containers that pitch an upgrade — a container is only hidden whole when it holds at most one unrelated control, so navigation regions are never nuked.
- **Continuous:** a `MutationObserver` re-sweeps on DOM/attribute changes (Feedly injects prompts on navigation and on a timer), plus a 2-second safety sweep and re-sweeps on back/forward/hash navigation.

## Updating from v1.0
Open the new `feedly-clean-sidebar.user.js` and confirm the install — the manager treats it as an update (same name, version 1.1.0) and replaces v1.0. Then hard-reload Feedly (Ctrl+Shift+R).

## Notes
- Scoped to `feedly.com` via `@match`. To use the same cleaning on another site, add another `// @match` line in the header.
- Tested against a mock Feedly DOM (jsdom): all five sidebar items hidden, static and dynamically-injected Upgrade CTAs/banners hidden, legitimate content (Today, feed names, article headlines, in-article controls) preserved, and explicit blank-page regression guards (app root and `<main>` never hidden, nodes hidden not deleted) — 20/20 checks on v1.1, and v1.1 is field-verified live (see Status above).
