// Checks the stats band: the graduation countdown in each of its three phases
// (using a simulated clock), the time-on-page counter and its pause while the
// tab is hidden, and the visit counter.
const puppeteer = require("puppeteer-core");
const { CHROME_PATH } = require("./config");
const SITE = process.argv[2];
const OUT = process.argv[3] || ".";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (label, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${label}`);

// Makes the page believe it is a different date by shifting Date (not performance.now).
function fakeClock(isoDate) {
  return `(() => {
    const offset = new Date(${JSON.stringify(isoDate)}).getTime() - Date.now();
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
      static now() { return RealDate.now() + offset; }
    }
    window.Date = FakeDate;
  })();`;
}

async function openAt(browser, isoDate) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  if (isoDate) await page.evaluateOnNewDocument(fakeClock(isoDate));
  // Count how many 1-second intervals the page starts.
  await page.evaluateOnNewDocument(() => {
    const realSetInterval = window.setInterval;
    window.__secondTimers = 0;
    window.setInterval = (fn, ms, ...rest) => {
      if (ms === 1000) window.__secondTimers += 1;
      return realSetInterval(fn, ms, ...rest);
    };
  });
  await page.goto(SITE, { waitUntil: "networkidle0" });
  return { page, errors };
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, " ").trim());

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

  // 1. Before December: days, hours, minutes, seconds, ticking down.
  let { page, errors } = await openAt(browser, "2026-11-23T12:00:00+03:00");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  const first = await text(page, "#countdown");
  // The page loads a moment after the simulated noon, so allow 7d 12h 00m 00s or 7d 11h 59m 5Xs.
  check(`7 days 12 hours before: "${first}"`, /^7d (12h 00m 00s|11h 59m 5\ds)$/.test(first));
  await wait(1200);
  check("countdown ticks", (await text(page, "#countdown")) !== first);
  check("before-phase note", (await text(page, "#countdown-note")).includes("Until December 2026"));
  check("one shared 1-second timer drives every counter", (await page.evaluate(() => window.__secondTimers)) === 1);
  await page.evaluate(() => document.querySelector("#stats").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${OUT}/stats-band.png`, clip: { x: 0, y: 300, width: 1280, height: 300 } });

  // 2. Time on page counts up while visible...
  await wait(2100);
  const visibleTime = await text(page, "#time-on-page");
  check(`time on page counts (${visibleTime})`, /^[3-9]s$/.test(visibleTime));

  // ...and pauses while the tab is hidden.
  const setHidden = (hidden) =>
    page.evaluate((isHidden) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (isHidden ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  const atHide = await text(page, "#time-on-page");
  await wait(2500);
  await setHidden(false);
  const afterShow = await text(page, "#time-on-page");
  check(`hidden time not counted (${atHide} -> ${afterShow})`, parseInt(afterShow, 10) - parseInt(atHide, 10) <= 1);
  check("no page errors (before phase)", errors.length === 0);
  await page.close();

  // 3. Visits: the first visit, a reload in the same tab, then a new tab (new session).
  ({ page } = await openAt(browser));
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle0" });
  check("first visit", (await text(page, "#visit-count")) === "1st visit" && (await text(page, "#visit-note")).includes("Welcome!"));
  await page.reload({ waitUntil: "networkidle0" });
  check("reload is not a new visit", (await text(page, "#visit-count")) === "1st visit");
  await page.close();
  ({ page } = await openAt(browser));
  check("new tab is the 2nd visit", (await text(page, "#visit-count")) === "2nd visit" && (await text(page, "#visit-note")).includes("Welcome back!"));
  await page.evaluate(() => localStorage.setItem("portfolio-visitor-name", "Sara"));
  await page.close();
  ({ page } = await openAt(browser));
  check("3rd visit greets by name", (await text(page, "#visit-count")) === "3rd visit" && (await text(page, "#visit-note")) === "Welcome back, Sara.");
  await page.evaluate(() => localStorage.setItem("portfolio-visits", "-4"));
  await page.close();
  ({ page } = await openAt(browser));
  check("invalid saved count starts over", (await text(page, "#visit-count")) === "1st visit");
  await page.close();

  // 4. During December, then after it.
  ({ page, errors } = await openAt(browser, "2026-12-15T10:00:00+03:00"));
  check("during December: 'This month!'", (await text(page, "#countdown")) === "This month!" && (await text(page, "#countdown-note")).includes("expected graduation month"));
  await page.close();
  ({ page, errors } = await openAt(browser, "2027-02-01T10:00:00+03:00"));
  check("after December: 'Complete'", (await text(page, "#countdown")) === "Complete");
  check("no page errors (later phases)", errors.length === 0);
  await page.close();

  // 5. Edge: the exact last second before December 1 in Dhahran.
  ({ page } = await openAt(browser, "2026-11-30T23:59:59+03:00"));
  const lastSecond = await text(page, "#countdown");
  // Loading takes a moment, so it may already have crossed into December.
  check(`last second shows 0d 00h 00m 0Xs or the next phase (${lastSecond})`, /^0d 00h 00m 0\ds$/.test(lastSecond) || lastSecond === "This month!");
  await page.close();

  // 6. Hidden without JavaScript.
  page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  check("stats band hidden without JavaScript", await page.$eval("#stats", (el) => getComputedStyle(el).display === "none"));
  await page.close();

  await browser.close();
})();
