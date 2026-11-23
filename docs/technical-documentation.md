# Technical Documentation

This document explains how the portfolio works: its structure, the state store, the two API integrations, the multi-step logic, and the choices made for performance, compatibility, accessibility, and security. For setup and usage, see the [README](../README.md).

## Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [State management](#3-state-management)
4. [API integration](#4-api-integration)
5. [Complex logic](#5-complex-logic)
6. [Features carried over from Assignment 2](#6-features-carried-over-from-assignment-2)
7. [Data and storage](#7-data-and-storage)
8. [Performance](#8-performance)
9. [Compatibility](#9-compatibility)
10. [Accessibility](#10-accessibility)
11. [Security and privacy](#11-security-and-privacy)
12. [Testing](#12-testing)
13. [Known limitations and next steps](#13-known-limitations-and-next-steps)

---

## 1. Overview

| | |
| --- | --- |
| Type | Static single-page website |
| Languages | HTML5, CSS3, JavaScript (ES2020, one classic script, no modules) |
| Runtime dependencies | None |
| External services | GitHub REST API (`GET /users/abooodi123/repos`) and Open-Meteo forecast API (`GET /v1/forecast`), neither needs a key |
| Test tools (optional) | `puppeteer-core` (in-page suites), Playwright (cross-browser), Lighthouse 12 |
| Hosting | Any static host; GitHub Pages recommended |
| Size (gzip) | HTML 8.8 KB, CSS 11.2 KB, JS 23.5 KB, plus 7 KB of SVG images |

---

## 2. Architecture

### 2.1 Progressive enhancement

The HTML is complete and readable on its own, and JavaScript adds features on top of it.

| Without JavaScript | With JavaScript |
| --- | --- |
| All projects, with dates, levels, highlights, and *In plain words* notes | Level views, search, filters, sorting, collapsible highlights |
| All About panels in order | Tabs |
| The browser's own form validation | Custom rules, the company field, typo hints, checklist, drafts |
| A link to my GitHub profile | Live repository cards |
| No weather card and no stats band (both need live data) | Live weather, countdown, time on page, and visits |

Controls that only work with JavaScript start `hidden` in the HTML, and the script reveals them once it has set them up. A small inline script in `<head>` adds a `js` class to `<html>` and applies the saved theme before the first paint. CSS uses `.js` for any state that only JavaScript can undo, such as collapsed highlights or hidden plain-language notes.

### 2.2 JavaScript structure

`script.js` is one classic script loaded with `defer`. ES modules were not used, because browsers block module scripts on `file://` pages, and the site should open with a double-click.

```text
Helpers            $, $$, createSafeStorage, debounce, normalizeText, replayAnimation,
                   createElement, timeAgo, onMediaChange
Shared API code    apiError, fetchJson, createApiCache                       (new)
State              STATE_SCHEMA, createStore → store                         (new)
Features           initTheme · initNavigation · initGreeting · initWeather (new) ·
                   initTimers (new) · initPersonalize (new) · initAboutTabs ·
                   initProjectExplorer · initGitHubRepos · initCopyEmail ·
                   initContactForm · initScrollEffects · initFooterYear
Start-up           [...features].forEach(init => try { init() } catch { console.error })
```

Each feature starts inside its own `try…catch`, so a failure in one feature never stops the others.

### 2.3 How data flows

```text
visitor action ──► store.set(name, value) ──► validates, saves to localStorage
                                              └─► notifies subscribers ──► features re-render
another tab ─────► "storage" event ──────────► store reloads that value ──► same subscribers
API ─────────────► fetchJson ─► createApiCache ─► feature state ─► render()
```

---

## 3. State management

### 3.1 The store

Everything the site remembers about a visitor is declared in one schema:

```js
const STATE_SCHEMA = {
  theme:          { key: "portfolio-theme",           fallback: "system",  format: "text", isValid: … },
  visitorName:    { key: "portfolio-visitor-name",    fallback: "",        format: "text", isValid: … },
  hiddenSections: { key: "portfolio-hidden-sections", fallback: [],        format: "json", isValid: … },
  githubForks:    { key: "portfolio-github-forks",    fallback: false,     format: "json", isValid: … },
  projectView:    { key: "portfolio-project-view",    fallback: "all",     format: "text", isValid: … },
  tempUnit:       { key: "portfolio-temp-unit",       fallback: "celsius", format: "text", isValid: … },
  visits:         { key: "portfolio-visits",          fallback: 0,         format: "json", isValid: … },
};
```

`createStore(schema)` returns a small publish/subscribe API:

| Method | What it does |
| --- | --- |
| `get(name)` | Returns the current value from memory, without touching storage. |
| `set(name, value)` | Rejects invalid values with a `TypeError`, saves the value (or removes the key when it equals the default), and notifies subscribers if it changed. |
| `reset(name)` | Sets the default. |
| `names()` | Lists every setting; used by *Reset all preferences*. |
| `subscribe(name, fn, { now })` | Calls `fn(value)` on every change; with `now: true`, also right away. |

**Design choices:**

- **Validate on load and on save.** A damaged or out-of-date saved value is replaced by its default. For example, `hiddenSections = "{not json"` or a visitor name of `<script>`.
- **Defaults are not stored.** An empty `localStorage` means "all defaults". Resetting therefore clears the keys, which is what a privacy-minded visitor expects.
- **Text values keep the Assignment 2 format.** The theme is stored as `dark`, not `"dark"`, so the inline `<head>` script can still read it before the first paint.
- **Sync between tabs.** The browser fires a `storage` event in every *other* tab when `localStorage` changes. The store reloads the affected value and notifies the same subscribers. Because of this, no feature needs any extra code to stay in sync.
- **Two paths for the project level.** A shared link like `?view=advanced` must take priority over the saved level without overwriting it. So `setView()` is called directly as well as through the store. If the visitor picks the level that is already saved, `store.set` sees no change, but the view must still update.

### 3.2 Simulated login (Personalize dialog)

- The header's person button opens a native `<dialog>` with `showModal()`. That gives focus trapping, **Escape** to close, and an inert background for free. A click on the backdrop also closes it.
- **Sign in** checks the name with `checkVisitorName`:
  - extra spaces are collapsed;
  - the name must be 2–30 characters;
  - only letters from any language, spaces, hyphens, apostrophes, and periods are allowed (`/^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u`).

  This means an Arabic name like "عبدالله" works.
- When `visitorName` changes, these features update through their subscriptions:

  | Subscriber | What it shows |
  | --- | --- |
  | The header button | The visitor's initial on an accent circle |
  | The greeting | "Good evening, Sara" |
  | The visit note | "Welcome back, Sara." |
  | The contact form | The name in an **empty** Name field (it never overwrites typing) |

- **Sign out** resets `visitorName`, and the same subscribers undo their changes.

### 3.3 Visible sections

Elements marked `data-hideable="Label"` (the weather card, the stats band, the GitHub section) each get a switch in the dialog, created by the script. Hidden sections get the class `is-user-hidden` (`display: none !important`), and so does their navigation link, if they have one.

A class is used instead of the `hidden` attribute so that each feature can still control its own `hidden` state, for example while loading, without the two interfering.

A hidden GitHub section is never on screen, so its `IntersectionObserver` never fires and no API request is made.

---

## 4. API integration

### 4.1 Shared helpers

**`fetchJson(url, { timeoutMs, headers })`**, used by both APIs:

1. If `navigator.onLine` is false, it throws `offline` straight away.
2. An `AbortController` cancels the request after the timeout (`timeout`).
3. If `fetch` rejects, the error is `network`.
4. If the response is not OK:
   - `429`, or `403` with `x-ratelimit-remaining: 0`, is `rate-limit` (with the reset time);
   - `404` is `not-found`;
   - anything else is `http` (with the status code).
5. If the body is not valid JSON, the error is `http`.

**`createApiCache(key, maxAgeMinutes, isValidData)`** returns `read()`, `write(data)`, and `isFresh(entry)`, and stores `{ savedAt, data }`. A damaged entry, or one that fails `isValidData`, is ignored.

### 4.2 GitHub repositories

These work as in Assignment 2: loaded when the section comes near the screen, cached for 30 minutes, with an older copy used as a fallback. They now use the shared helpers. The cache moved to a new key, `portfolio-github-repos`.

Both assignment sites live on the same `abooodi123.github.io` origin and so share `localStorage`. With the new key, the two sites can't overwrite each other's cache in a different format.

### 4.3 Dhahran weather (Open-Meteo)

```text
GET https://api.open-meteo.com/v1/forecast?latitude=26.29&longitude=50.11
    &current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day
    &timezone=Asia/Riyadh
```

**Steps:**

1. **Read the cache.** A reading less than 15 minutes old is shown immediately with no request. The service itself updates its current values every 15 minutes.
2. **Otherwise, show a skeleton** (or the older reading, if there is one), then fetch with an 8-second timeout.
3. **Validate.** All five numbers must be finite, or the response is rejected as `http`. A visitor never sees "NaN°C".
4. **Describe.** `describeWeatherCode(code, isDay)` turns the WMO weather code into words and an icon: clear (sun or moon), partly cloudy, overcast, fog, drizzle, rain, snow, or thunderstorm.
5. **Add a remark.** `weatherRemark()` checks rules in order of importance, and the first match wins:
   1. thunderstorm;
   2. rain ("a rare sight in the Eastern Province");
   3. 40 °C or hotter;
   4. 30 °C or hotter with humidity of 70% or more;
   5. 15 °C or cooler;
   6. otherwise, no remark.
6. **Units.** Data always arrives in °C, and `formatTemperature` converts it on the page, so changing `tempUnit` needs no request.
7. **Errors.** With no saved copy, the card shows a specific message and **Try again**. With an older copy, it shows that copy and adds "Showing the reading from 2 hours ago."
8. **Refreshing.** The card does not poll. When the visitor returns to the tab and the reading is stale, it reloads, and it retries when the `online` event fires. The "updated … ago" text is refreshed every minute while the tab is visible.

| Error kind | Message on the weather card |
| --- | --- |
| `offline` | You're offline, so the Dhahran weather can't load. It will load once you reconnect. |
| `timeout` | The weather service is slow to respond right now. |
| `rate-limit` | The weather service is busy right now. |
| `http`, `network`, `not-found` | The weather in Dhahran is unavailable right now. |

---

## 5. Complex logic

### 5.1 Project explorer: level → area → search → sort

Each card carries `data-date="2026-01"` and `data-level="intermediate"`, along with the Assignment 2 attributes. The dates are approximate, to the month.

```js
const isVisible = (project, { view, filter, terms }) =>
  matchesView(project, view) && matchesFilter(project, filter) && matchesSearch(project, terms);
```

`PROJECT_VIEWS` holds each level's rules:

| View | Shows levels | Plain-language notes | Highlights | Message |
| --- | --- | --- | --- | --- |
| `all` (Everyone) | beginner, intermediate, advanced | hidden | as the visitor left them | none |
| `beginner` | beginner, intermediate | shown | closed | "New to engineering? …" |
| `advanced` | intermediate, advanced | hidden | opened | "Here for the technical details? …" |

**Sorting.** Sorters include `newest` and `oldest`. `"YYYY-MM"` strings sort correctly as plain text, and ties fall back to the featured order, so cards never jump around.

**Empty-state diagnosis.** When nothing is visible, the code relaxes one step at a time:

```text
inOtherAreas  = projects visible if the area were "all"
atOtherLevels = projects visible if the level were "all"
both > 0  → "… Choose “All” areas to see N projects, or “Everyone” to see M."
only area → "… N projects in other areas match. Choose “All” …"
only level→ "… M projects at other levels match. Choose “Everyone” …"
search    → "Nothing mentions “x”. Check the spelling …"
otherwise → "There are no projects in this area yet."
```

The URL keeps `?q=`, `area=`, `sort=`, and `view=` (defaults are left out), so any view can be shared.

### 5.2 Contact form rules

| Step | Rule |
| --- | --- |
| Which fields are active | `activeFields()` = name, email, message, and **company only if** the topic is "Internship or job opportunity" |
| Show or hide | `updateCompanyField()` reveals the field and makes it `required`. Hiding it also clears its error and its "touched" state, so a hidden field can never block sending. |
| Live checklist | `updateChecklist()` checks every active field silently and ticks it off, showing "3 of 4 ready" or "Ready to send". |
| Typo suggestion | `suggestEmail()` looks up the domain in `EMAIL_DOMAIN_FIXES` after the field loses focus. Some typos are valid addresses (`gmail.co`), so this is a suggestion with a one-click fix, never an error. |
| Submit | 1) Validate every active field. 2) If any fails, show "Almost there" and focus the first invalid field. 3) Only when all pass, build the subject (with the company in brackets) and body, then open the `mailto:` draft. |

The draft saved in `localStorage` includes the topic and company, and restoring a job-topic draft brings the company field back.

### 5.3 Timers

**One ticker.** `createTicker()` keeps a single 1-second `setInterval` for every counter. It stops on `visibilitychange` when the tab is hidden and restarts (with an immediate tick) when the tab is visible again.

**Graduation countdown.** `graduationPhase(now)` returns one of three phases:

| Phase | When | Display |
| --- | --- | --- |
| `before` | before 1 Dec 2026, 00:00 Dhahran time (UTC+3) | `7d 19h 25m 10s`, with the units updated in place each second |
| `during` | December 2026 | "This month!" |
| `after` | from January 2027 | "Complete" |

The phase-dependent text is rebuilt only when the phase changes.

**Time on page.** This counts visible time only:

```text
elapsed = time banked from earlier visible stretches + (now − visibleSince, if visible)
```

It uses `performance.now()`, which is not affected by changes to the system clock.

**Visits.** The `visits` count goes up once per browser session. A `sessionStorage` flag (`portfolio-visit-counted`) stops reloads from counting. The label uses `Intl.PluralRules({ type: "ordinal" })` for "1st, 2nd, 3rd, 4th…".

---

## 6. Features carried over from Assignment 2

These are unchanged except where noted. Full details are in the Assignment 2 documentation.

- **Theme.** Applied before the first paint, with a View Transitions cross-fade. *New:* three choices (light, dark, system), and no cross-fade in hidden tabs, because the browser would abort it.
- **Navigation.** A collapsible menu on phones and the current section highlighted with `IntersectionObserver`.
- **Greeting and Dhahran clock.** *New:* the greeting includes the visitor's name.
- **About tabs.** The WAI-ARIA tabs pattern with a roving tabindex. *New:* the first indicator measurement waits one frame (see §8).
- **Contact form base.** Inline validation, drafts, a success message, and copying the email address.
- **Motion.** Scroll reveals and hover effects, with everything respecting `prefers-reduced-motion`.

---

## 7. Data and storage

Every `localStorage` and `sessionStorage` access goes through `createSafeStorage`, which catches the errors some private windows throw. If storage is blocked, the site keeps working in memory.

| Key | Where | Value | Cleared by |
| --- | --- | --- | --- |
| `portfolio-theme` | local | `light` / `dark` (missing = system) | Choosing "Match my device"; Reset |
| `portfolio-visitor-name` | local | text, 2–30 letters | Sign out; Reset |
| `portfolio-hidden-sections` | local | JSON array of ids | Turning sections back on; Reset |
| `portfolio-project-view` | local | `beginner` / `advanced` | Choosing "Everyone"; Reset |
| `portfolio-temp-unit` | local | `fahrenheit` (missing = °C) | Choosing °C; Reset |
| `portfolio-github-forks` | local | `true` | Turning forks off; Reset |
| `portfolio-visits` | local | integer | Reset |
| `portfolio-github-repos` | local | `{ savedAt, data: repos[] }` | Replaced on the next load |
| `portfolio-weather` | local | `{ savedAt, data: reading }` | Replaced on the next load |
| `portfolio-contact-draft` | local | `{ name, email, topic, company, message }` | Discard draft; Clear the form |
| `portfolio-visit-counted` | session | `"1"` | Closing the tab |

---

## 8. Performance

### 8.1 Measured results

Lighthouse 12, run on a local server:

| Run | Performance | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- |
| Mobile, before the performance branch | 98 | 1.1 s | 2.1 s | 100 ms | 0.002 |
| Mobile, after (3 runs, identical) | **100** | 1.1 s | **1.9 s** | **0 ms** | **0.001** |
| Desktop, after | **100** | 0.5 s | 0.5 s | 0 ms | 0 |

Accessibility, Best Practices, and SEO scored 100 in every run.

### 8.2 What was fixed, and why it worked

**The forced reflow (87 ms).** `initAboutTabs` read `tab.offsetWidth` during start-up, right after other features had changed the page. The browser had to stop the script and lay out the whole page before it could answer. The first measurement now happens in `requestAnimationFrame`, when the layout is already being calculated, so it costs nothing extra. The first `scrollY` read in `initScrollEffects` was deferred the same way.

**Layout shift from the weather card.** The card used to grow from one line ("Checking…") to three or four lines when the data arrived. The heights were measured at six widths, and two changes fixed it:

1. The loading state is now a skeleton with the same parts as a reading.
2. `min-height` reserves a typical reading's height at each breakpoint.

Loading and loaded heights now match at every width tested. Only the optional remark line adds height.

**Resource hints.** `preconnect` to `api.open-meteo.com`, which is used straight away, and `dns-prefetch` for `api.github.com`, which is used later.

### 8.3 Other measures

| Measure | Benefit |
| --- | --- |
| No frameworks, libraries, or web fonts | Nothing extra to download or parse |
| CSS in `<head>`, script with `defer` | The script never blocks HTML parsing |
| Shared `fetchJson`, `createApiCache`, `createTicker` | No repeated code; one 1-second timer instead of three |
| Ticker and weather refresh pause in hidden tabs | No background CPU or network use |
| API caches (GitHub 30 min, weather 15 min) | Repeat visits render instantly and send no requests |
| GitHub API called only near its section | Visitors who never scroll there (or hide it) make no request |
| WebP screenshots, compact SVG illustrations, unused PNGs removed | 195 KB of documentation images instead of 444 KB; 7 KB of site images |
| `width`/`height` on images, lazy loading | No layout shift from images |
| Debounced search and resize, rAF-throttled scroll | Little work per frame |

**Left as is on purpose:**

- The code is not minified, so markers can read it.
- Compression and cache headers depend on the host. GitHub Pages compresses files, but Python's test server does not, so Lighthouse lists "enable text compression" when testing locally.
- The "unused CSS/JS" that Lighthouse reports is the styling and code for states not shown on first load, such as dialogs, errors, and empty states.

---

## 9. Compatibility

### 9.1 Tested

`tests/cross-browser.js` (Playwright) runs the same checks in each browser engine at desktop size and on a phone-sized touch screen. Both APIs are simulated so that only the browser varies.

| Browser | Engine | Version | Desktop | Phone |
| --- | --- | --- | --- | --- |
| Chrome | Chromium | 157 | 14/14 | 15/15 |
| Edge | Chromium | 158 | 14/14 | 15/15 |
| Firefox | Gecko | 159 | 14/14 | 15/15 |
| WebKit | WebKit (Safari) | 27.2 | 14/14 | 15/15 |

The checks cover:

- horizontal overflow;
- both APIs;
- the countdown ticking;
- the theme being remembered;
- the `<dialog>` with Escape;
- the Unicode name check;
- the Beginner view with Newest-first sorting;
- the company rule, empty-submit errors, and the email hint;
- the phone menu;
- no JavaScript errors.

The in-page suites also checked widths from 320 px to 1440 px.

### 9.2 Features used, and fallbacks

| Feature | Used for | Fallback |
| --- | --- | --- |
| `<dialog>` + `showModal()` | Personalize | Without support, the button stays hidden |
| Unicode property escapes (`\p{L}`) | Name check | Supported by all browsers tested |
| `Intl.PluralRules`, `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat` | Ordinals, "3 minutes ago", Dhahran time | Supported by all browsers tested |
| `storage` event | Sync between tabs | Without it, each tab still works on its own |
| `AbortController` | Request timeouts | Supported by all browsers tested |
| View Transitions API | Theme cross-fade | Instant switch; never used in hidden tabs |
| `IntersectionObserver` | Reveals, active nav, lazy GitHub request | Content shown and loaded immediately |
| `navigator.clipboard` | Copy buttons | Hidden `textarea` + `execCommand("copy")` |
| `MediaQueryList.addEventListener` | Theme and layout changes | `addListener` for older Safari |

---

## 10. Accessibility

New parts follow the same rules as Assignment 2. Lighthouse Accessibility scores 100.

- **The Personalize dialog** uses a native modal `<dialog>`, labeled by its heading. Focus is trapped while it is open and returns to the button when it closes. Escape closes it.
- **Radio groups** (level, temperature unit, and theme) are real radio inputs styled as pills, so the arrow keys work and the focus ring is visible.
- **Timers** use `role="timer"`, which screen readers don't announce on every tick. The countdown has real spaces between its units, so it is read as "7d 19h 25m", not "7d19h25m". The tests caught this.
- **The level message** is an `aria-live="polite"` region, so changing the level is announced.
- **The email suggestion** is linked to the field with `aria-describedby`. Each checklist item has visually hidden text ("Name: done" or "Company: still needed").
- **Keyboard:** the keyboard test tabs through the whole page at 1280 px and 390 px. Every stop must be on screen and show a focus ring.

---

## 11. Security and privacy

- **No HTML injection.** API data and anything a visitor types are always inserted with `textContent` (through `createElement`). The only `innerHTML` calls insert fixed icon markup written in the code, such as the weather icons.
- **Validated input.** Every saved value is checked before use, so a value planted in `localStorage` (for example, a "name" of `<script>`) is ignored.
- **Safe links.** Repository links must start with `https://github.com/`. Links that open a new tab use `rel="noopener noreferrer"`.
- **No secrets and no tracking.** Neither API needs a key. There are no cookies or analytics, and preferences stay in the visitor's browser. Signing in only stores a first name locally; nothing is sent anywhere.

---

## 12. Testing

### 12.1 In-page suites (`npm test`): 178 checks

| Suite | Checks | Covers |
| --- | --- | --- |
| `state.test.js` *(new)* | 24 | Store, sign in and out, name rules, theme choices, hidden sections, values kept after a reload, sync between tabs, damaged values, reset, phone dialog |
| `levels.test.js` *(new)* | 25 | Level rules, date sorting, combined filters, every empty-state cause, the URL and saved level, invalid `?view=` |
| `weather.test.js` *(new)* | 26 | Live API, cache, °C/°F, remarks, simulated 500/429/network/bad data/non-JSON/timeout, retry, stale copy, hiding, no JavaScript |
| `timers.test.js` *(new)* | 17 | All countdown phases with a simulated clock, the last second before December, pause while hidden, visits across sessions, one shared 1-second timer |
| `form-rules.test.js` *(new)* | 22 | Company rule, blocked submit, mailto subject and body (captured through the DevTools protocol), draft restore, typo hints, checklist |
| `projects.test.js`, `github.test.js`, `contact.test.js`, `about.test.js`, `keyboard.test.js`, `motion.test.js` | 64 | The Assignment 2 suites (63 checks, plus one for the restored company field), updated for the new features |

If GitHub's hourly limit for the network is used up, the live GitHub checks print `SKIP`, and the runner counts them separately.

### 12.2 Cross-browser (`npm run test:browsers`): 116 checks

See §9.1.

### 12.3 Bugs the tests found

| Found by | Problem | Fix |
| --- | --- | --- |
| `state.test.js` | When the theme changed in another tab, the hidden tab tried to cross-fade. The browser aborts transitions in hidden documents, so the theme never switched and an error was thrown. | Cross-fade only when `document.visibilityState === "visible"` |
| `levels.test.js` | "Web + Advanced" blamed only the area, although the level also removed results | Relax each step separately, and offer both fixes when both apply |
| `timers.test.js` | The countdown text had no real spaces ("7d19h25m") | Insert text spaces between the units |
| Lighthouse | An 87 ms forced reflow at start-up, and a small layout shift | §8.2 |
| `contact.test.js` (Assignment 2) | An old test now failed because the job topic needs a company | The rule was working as designed, so the test was updated to fill in the company |

---

## 13. Known limitations and next steps

- **No backend.** The contact form relies on the visitor's email app, and "sign in" is only a name stored on the device, not a real account. A future assignment could add a serverless form endpoint and real authentication.
- **Approximate dates.** Project dates are accurate to the month.
- **Graduation date.** The countdown targets the start of December 2026, my expected graduation month, not a specific ceremony date.
- **GitHub's rate limit** is per network, so on a busy shared network it may be reached. The site explains this and shows any cached copy.
- **Safari itself.** Safari was not tested directly; WebKit, its engine, was tested on Windows. A check on a real iPhone or Mac would complete the picture.
