# AI Usage Report — Assignment 3

I built this assignment with an AI coding agent, **Claude Code**, in one conversation on 2026-11-23. I set the goal and the scope, supplied the facts only I know (such as when each project happened), and approved the decisions with outside effects, like publishing. Claude Code read my earlier assignments, planned the work, and wrote the code, tests, and documents. It then checked everything in real browsers and with Lighthouse.

This report covers:

- which tools were used and for what;
- what helped and what was hard;
- what I learned;
- how the output was checked and corrected.

Every AI conversation and artifact is listed in the [usage log](#8-usage-log). The full conversation and the intermediate artifacts are in the AI Evidence ZIP submitted on Blackboard.

## Contents

1. [Tools used and use cases](#1-tools-used-and-use-cases)
2. [How the work was done](#2-how-the-work-was-done)
3. [Benefits and challenges](#3-benefits-and-challenges)
4. [Problems found and fixed](#4-problems-found-and-fixed)
5. [Learning outcomes](#5-learning-outcomes)
6. [Responsible use and modifications](#6-responsible-use-and-modifications)
7. [Creative uses of AI](#7-creative-uses-of-ai)
8. [Usage log](#8-usage-log)
9. [AI evidence](#9-ai-evidence)
10. [Declaration](#10-declaration)

---

## 1. Tools used and use cases

| Tool | Model | How it was used |
| --- | --- | --- |
| **Claude Code** (Anthropic), VS Code extension | Claude Opus 5.5 | The only AI tool used in this assignment. It read my Assignment 1 and 2 code and documents, then for each feature it planned, wrote, reviewed, and debugged the HTML, CSS, and JavaScript. It also wrote the automated browser tests, ran Lighthouse and acted on its findings, ran the cross-browser tests, took the screenshots, and drafted the README, technical documentation, and this report. |

The work was checked with tools that are not AI:

- **Puppeteer**, which drives Chrome from code (the in-page test suites);
- **Playwright**, which runs Chrome, Edge, Firefox, and WebKit (the cross-browser checks);
- **Google Lighthouse 12** (performance and accessibility audits);
- **Git** (one branch per feature).

**Earlier assignments:** I used OpenAI Codex in Assignment 1 and Claude Code in Assignment 2. Both were declared in those assignments' reports. This assignment starts from an unchanged copy of Assignment 2 (commit `285135e`).

---

## 2. How the work was done

1. **Brief and context.** I pasted the Assignment 3 brief. Claude Code read my Assignment 2 repository (README, AI report, technical documentation, HTML, CSS, and JavaScript) and found that much of the brief was already covered, including the GitHub API, filters, validation, and the theme. So the plan was to build on Assignment 2 and add what was missing, not start again.
2. **One question back to me.** Sorting projects by date needed real dates, and the AI would not invent them, so it asked me. I gave approximate ones: YOLO about a year ago, Gesture IoT about 10 months ago, the Digital Twin started about 4–6 months ago. It used Nov 2025, Jan 2026, and Jun 2026, and the documents say they are approximate. I also confirmed that it should publish the repository and do everything the brief requires.
3. **One branch per feature,** each with the same loop:
   1. write the code;
   2. check the JavaScript syntax (`node --check`);
   3. write a test suite that uses the feature like a visitor would;
   4. run it, read the screenshots, and fix what is wrong;
   5. run *every* suite again;
   6. commit with an `Assisted-by:` line and merge.

   ```text
   feature/state-store → feature/project-levels → feature/weather-api → feature/timers
   → feature/contact-rules → perf/optimization → test/cross-browser → docs/assignment-3
   ```

4. **Measure, then optimize.** Lighthouse was run before any performance work. Only what it actually reported was fixed, and the result was measured again (three mobile runs).
5. **Cross-browser.** Firefox was not installed, so Playwright's Firefox and WebKit builds were used to test the browsers I could not open myself.
6. **Documentation.** The documents were written last, from the real code and test results.

---

## 3. Benefits and challenges

### Benefits

- **Speed with breadth.** In one session, the work covered:
  - five features;
  - a performance pass;
  - 114 new in-page checks in five new suites (plus updates to the Assignment 2 suites) and 116 cross-browser checks;
  - full documentation.

  Doing this alone would have taken much longer, especially the tests.
- **Testing I would not have attempted alone.** These would have been hard for me to do by hand:
  - simulating API failures (a 429 rate limit, broken JSON, an 8-second timeout);
  - faking the clock to test a countdown for dates that haven't happened yet;
  - testing in WebKit on Windows.
- **Honest numbers.** The AI measured instead of guessing. Lighthouse showed that the new features had *lowered* the mobile score to 98, and that is reported here rather than hidden.

### Challenges and limitations

- **The AI's first version was not always right.** Section 4 lists the real bugs that came up. Each was caught by a test or by Lighthouse, not by reading the code. Without the tests, several of them would have shipped.
- **Tests can be wrong too.** About half the failures were bugs in the *tests*. For example, one test read a value during a 0.25-second animation, and another used the wrong expected order. Telling a test bug from a site bug took careful reasoning each time.
- **External limits.** Running the suites many times used up GitHub's limit of 60 requests an hour for my network. The live GitHub checks crashed until they were changed to report SKIP in that situation.
- **The environment.** The session started with my C: drive completely full. The AI noticed, stopped, and told me rather than deleting anything. I freed space myself. It also found that its own editing scripts were writing Windows line endings and corrected them.
- **Responsibility stays with me.** The AI wrote most of the code, so I need to understand all of it. This report and the technical documentation explain how each part works, and I reviewed them for that reason.

---

## 4. Problems found and fixed

These happened during the assignment, and each fix is in the commit history.

**Bugs in the site:**

| # | What was wrong | How it was caught | Fix |
| --- | --- | --- | --- |
| 1 | Changing the theme in one tab made the other tab try a cross-fade. Browsers abort transitions in hidden tabs, so that tab threw `InvalidStateError` and never switched. | `state.test.js` (two tabs) | Cross-fade only in a visible tab |
| 2 | A level from a shared link (`?view=advanced`) could get stuck, because choosing the already-saved level was not a "change" to the store | Noticed while writing the code; confirmed by a test | Call `setView()` directly as well as through the store |
| 3 | For "Web + Advanced", the empty state blamed only the area, although the level also removed results | `levels.test.js` | Relax each step separately; offer both fixes when both apply |
| 4 | Hiding a section with the `hidden` attribute would clash with the weather card, which uses `hidden` itself while loading | Design review while building the weather card | Use a separate `is-user-hidden` class for sections the visitor hides |
| 5 | The new GitHub cache format would overwrite the Assignment 2 site's cache, because both share the `github.io` origin | Code review | New key, `portfolio-github-repos` |
| 6 | The countdown had no real spaces, so screen readers would read "7d19h25m" | `timers.test.js` | Text spaces between the units |
| 7 | An 87 ms **forced reflow** at start-up, and 100 ms of blocking time on phones (score 98) | Lighthouse | Measure the tab indicator and scroll position in the next animation frame (score 100, 0 ms) |
| 8 | The weather card grew when its data arrived (layout shift) | Lighthouse, then heights measured at six widths | A skeleton with the same parts, plus measured `min-height` per breakpoint |
| 9 | The "This Portfolio Website" card still linked to the Assignment 2 repository | Final review | Linked to this repository, with updated highlights |

**Bugs in the tests:**

| Test problem | Fix |
| --- | --- |
| It read the other tab's theme during its cross-fade, so the result was stale | Wait for the transition, then compare the saved value |
| It clicked "Done" during a theme cross-fade, when browsers ignore clicks | Wait for the transition |
| It expected the wrong order: the link also set `sort=newest` | Correct the expectation |
| It expected "12h 00m" although the page loads a moment after the simulated noon | Accept the correct range |
| It tried to record `mailto:` through `location.href`, which a test browser never changes | Capture the navigation through the DevTools protocol |
| The live GitHub check crashed when the hourly limit was used up | Report SKIP when the site shows its rate-limit message |
| An Assignment 2 contact test failed because the job topic now needs a company | The rule was working as designed, so the test now fills in the company |

---

## 5. Learning outcomes

What I learned from this assignment and from reviewing the AI's work:

- **State management without a framework.** A store with a schema, validation, and subscriptions is small (about 60 lines) but keeps every feature consistent. The browser's `storage` event gives sync between tabs almost for free.
- **Defensive API code.** `fetch` has no timeout, so `AbortController` adds one. A server can answer "OK" with broken data, so every number is validated before it reaches the page. Tagging each error with a *kind* lets the page tell a visitor exactly what went wrong.
- **Multi-step logic is easier to explain than to write.** "Show beginner projects" sounds simple. In practice it has to combine with the area, the search, the sort, the URL, and the saved choice, and the empty state has to say which of those removed the results.
- **Performance problems can be invisible.** Reading `offsetWidth` at the wrong moment cost 87 ms on a phone with no visible symptom. Lighthouse, and knowing what "forced reflow" means, found it.
- **Testing time-based code.** A countdown to December can't wait for December. Replacing `Date` in the test page makes every phase testable today.
- **Working with an AI agent.** The useful pattern was: give the full brief, answer its questions, require proof (tests, screenshots, measurements), and read why each failure happened. Several "failures" were the tests, not the site.

---

## 6. Responsible use and modifications

- **Accurate content.** Nothing about me was invented. The project dates came from me and are marked as approximate. The *In plain words* explanations and the level labels only restate the existing project descriptions in simpler words. The countdown counts to my expected graduation month, which is already on the site, not to an invented ceremony date.
- **How the output was reviewed and improved.** No AI change was accepted on trust. Each feature had to pass its own new suite *and* all earlier suites before merging. When a check failed, the cause was found and fixed in the site or in the test (section 4). The performance changes were accepted only after Lighthouse confirmed them.
- **My own changes.** I did not edit the generated code by hand. My contributions were:
  - the brief and the goals;
  - the project dates;
  - the decision to build everything the brief requires;
  - approval to publish;
  - reviewing the finished work.

  The usage log records this for each artifact.
- **Privacy and safety.**
  - No passwords, tokens, or private data were shared with the AI.
  - Both APIs work without keys, so the code contains no secrets.
  - Visitor preferences stay in the visitor's browser.
  - The test data uses made-up names ("Sara", "Example Labs").
  - When the disk was full, the AI stopped and asked me instead of deleting files.
- **Academic integrity.** All AI use is declared:
  - in this report;
  - in the README summary;
  - with an `Assisted-by:` line on every AI-assisted commit;
  - in the evidence ZIP, which contains the complete, unedited conversation.

---

## 7. Creative uses of AI

- **A simulated clock for future dates.** The tests replace `Date` in the page, so the countdown's "during December", "after December", and "last second before December" phases are tested now, not in December.
- **Failures on demand.** Request interception reproduces failures that can't be triggered by hand: a 429 rate limit, a 500 error, a dropped connection, non-JSON data, a reading with missing numbers, and a request that never answers.
- **Two tabs at once.** A second tab changes a setting, and the test confirms that the first tab updates, which is how bug 1 was found.
- **Safari's engine from Windows.** Firefox and WebKit builds from Playwright let the site be tested in four browsers without owning a Mac.
- **Measure, then optimize.** Lighthouse was used to *find* problems first. The fixes target only what it measured, and the gain is reported with before and after numbers.

---

## 8. Usage log

One row per AI conversation (`C`) and per AI-generated artifact (`A`). The commit IDs refer to this repository; `git show <commit>` shows each change exactly as the AI produced it.

| ID | Tool (model) | Date | Purpose | Files affected | What you changed and how you verified it |
|----|--------------|------|---------|----------------|------------------------------------------|
| C01 | Claude Code (Claude Opus 5.5), VS Code extension | 2026-11-23 | The whole assignment: reading Assignments 1–2, planning, building every feature, testing, performance, cross-browser checks, documentation, publishing, and the evidence ZIP. Session `98e4bb6e-81ba-4dc1-bae6-3e40448da738`. | All files in the repository | I gave the brief and goals, supplied the approximate project dates when asked, asked for everything the brief requires, and approved creating the public repository and GitHub Pages. Verification for each artifact is listed below. |
| A01 | Claude Code (Claude Opus 5.5) | 2026-11-23 | State store and Personalize dialog (sign in and out, theme, visible sections, reset, tab sync) — `f105183` | `js/script.js`, `index.html`, `css/styles.css`, `tests/state.test.js` | No manual edits. Verified by the new `state.test.js` (24 checks), which found bug 1 (fixed before the commit), plus all 63 Assignment 2 checks still passing and screenshots at desktop and phone sizes. |
| A02 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Reader levels, project dates, Newest and Oldest sorting, empty-state diagnosis — `2fd7454` | `js/script.js`, `index.html`, `css/styles.css`, `tests/levels.test.js` | I supplied the dates. No manual edits to the code. Verified by `levels.test.js` (25 checks), which found bug 3, and by screenshots of each level. |
| A03 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Open-Meteo weather; shared `fetchJson` and `createApiCache`; GitHub moved to the shared helpers — `92cb0d0` | `js/script.js`, `index.html`, `css/styles.css`, `tests/weather.test.js`, `tests/github.test.js`, `tests/state.test.js` | No manual edits. Verified against the live API and with `weather.test.js` (26 checks, including simulated 500, 429, network, bad-data, non-JSON, and timeout failures). The GitHub suite was re-run after the refactor. |
| A04 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Graduation countdown, time on page, visit counter, shared ticker — `c346156` | `js/script.js`, `index.html`, `css/styles.css`, `tests/timers.test.js` | No manual edits. Verified by `timers.test.js` (17 checks with a simulated clock), which found bug 6. |
| A05 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Contact form rules: conditional Company field, email typo suggestion, live checklist — `a826093` | `js/script.js`, `index.html`, `css/styles.css`, `tests/form-rules.test.js`, `tests/contact.test.js` | No manual edits. Verified by `form-rules.test.js` (22 checks, including the email draft's subject and body) and the updated Assignment 2 contact test. |
| A06 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Performance fixes found by Lighthouse; removal of unused images; SKIP handling for GitHub's rate limit — `fbfb99c` | `js/script.js`, `index.html`, `css/styles.css`, `tests/github.test.js`, `tests/run-all.js`, removed `tests/kb-first-*.png` | No manual edits. Verified with Lighthouse before (mobile 98, 100 ms blocking) and after (mobile 100 in three runs, 0 ms), weather-card heights measured at six widths, and all suites re-run. |
| A07 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Cross-browser checks (Chrome, Edge, Firefox, WebKit) and an updated portfolio card — `6cf7729` | `tests/cross-browser.js`, `tests/package.json`, `tests/package-lock.json`, `index.html` | No manual edits. Verified by running it: 116 of 116 checks passed in four browsers at two sizes, and the screenshots from Firefox and WebKit were reviewed. |
| A08 | Claude Code (Claude Opus 5.5) | 2026-11-23 | README, technical documentation, this report, and new WebP screenshots (commit on `docs/assignment-3`) | `README.md`, `docs/technical-documentation.md`, `docs/ai-usage-report.md`, `docs/screenshots/*` | Every number in the documents comes from a test or measurement run in this session. I reviewed the documents. Old PNG screenshots were replaced by WebP versions. |
| A09 | Claude Code (Claude Opus 5.5) | 2026-11-23 | AI Evidence ZIP and the script that builds it (not in the repository) | `make-ai-evidence-a3.py` and the ZIP, both outside the repository | Checked by listing the ZIP's contents and confirming that every line of the transcript is valid JSON. |
| A10 | Claude Code (Claude Opus 5.5) | 2026-11-23 | Publishing: create the public GitHub repository, push all branches, enable GitHub Pages | GitHub repository settings (no file changes) | I approved publishing. Verified by opening the live site and running the checks against it. |

---

## 9. AI evidence

The **AI Evidence ZIP**, `202244620-abdullahewidah-assignment3-ai-evidence.zip`, is submitted on Blackboard with the repository link. As required, it is **not** committed to this repository. It contains:

- `conversations/`: the complete, unedited Claude Code session transcript (the original JSONL file), plus a readable Markdown copy of the same conversation;
- `artifacts/`: what the AI produced before any edits. Each AI-generated commit is a numbered patch, in order, together with a full snapshot of the project after that commit.

---

## 10. Declaration

> I declare that this report and the attached evidence document all of my AI use in this assignment, with complete and unedited conversations, and that I understand and can explain all the code I submitted. I understand that undeclared AI use or a false declaration will be treated as plagiarism according to KFUPM regulations.

| | |
| --- | --- |
| **Name** | Abdullah Mohammed Ewidah |
| **Student ID** | 202244620 |
| **Date** | 2026-11-23 |
