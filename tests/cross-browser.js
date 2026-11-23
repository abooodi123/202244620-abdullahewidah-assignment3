// Cross-browser check: runs the main features in Chrome, Edge, Firefox, and
// WebKit (the engine behind Safari), at desktop size and on a phone-sized touch
// screen. Both APIs are simulated so the results do not depend on the network.
//
// Usage (from the tests folder): npm install, npx playwright install firefox webkit,
// then npm run test:browsers
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, firefox, webkit, devices } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

// A tiny static file server, so every browser loads the site over http://.
function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const WEATHER = { current: { temperature_2m: 24.6, apparent_temperature: 25, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 14, is_day: 1 } };
const REPOS = [{ name: "sample-repo", description: "A simulated repository", html_url: "https://github.com/abooodi123/sample-repo", language: "Python", stargazers_count: 1, fork: false, archived: false, pushed_at: new Date().toISOString() }];

const BROWSERS = [
  { name: "Chrome", type: chromium, options: { channel: "chrome" } },
  { name: "Edge", type: chromium, options: { channel: "msedge" } },
  { name: "Firefox", type: firefox, options: {} },
  { name: "WebKit (Safari engine)", type: webkit, options: {} },
];

const LAYOUTS = [
  { name: "desktop", context: { viewport: { width: 1280, height: 900 } } },
  // Firefox does not support Playwright's mobile emulation, so it gets a phone-sized window.
  { name: "phone", context: (browserName) => (browserName === "Firefox" ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { ...devices["iPhone 13"] }) },
];

async function checkSite(page, base, check, layout, screenshotName) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ json: WEATHER, headers: { "access-control-allow-origin": "*" } }));
  await page.route("https://api.github.com/**", (route) => route.fulfill({ json: REPOS, headers: { "access-control-allow-origin": "*" } }));
  await page.goto(base);

  // No horizontal scrolling at this size.
  check("no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // API data: weather (in the hero) and GitHub (near its section).
  await page.waitForSelector(".weather-now", { timeout: 10000 });
  check("weather card renders", (await page.textContent("#weather")).includes("25°C Partly cloudy"));
  await page.waitForTimeout(1000); // Let the hero entrance animation finish.
  await page.screenshot({ path: path.join(__dirname, "screenshots", `browser-${screenshotName}.png`) });
  await page.locator("#github").scrollIntoViewIfNeeded();
  await page.waitForSelector("#repo-grid .repo-card:not(.is-skeleton)", { timeout: 10000 });
  check("GitHub cards render", (await page.textContent("#repo-grid")).includes("sample-repo"));

  // Timers.
  const first = await page.textContent("#countdown");
  await page.waitForTimeout(1300);
  check("countdown ticks", (await page.textContent("#countdown")) !== first);

  // State: theme toggle survives a reload.
  const theme = await page.getAttribute("html", "data-theme");
  await page.click("#theme-toggle");
  await page.waitForTimeout(400);
  await page.reload();
  check("theme toggle remembered", (await page.getAttribute("html", "data-theme")) !== theme);

  // State: sign in through the <dialog>, with a non-Latin name (Unicode regex).
  await page.click("#prefs-open");
  check("dialog opens as a modal", await page.evaluate(() => document.querySelector("#prefs-dialog").open));
  await page.fill("#visitor-name", "عبدالله");
  await page.click("#name-form button[type=submit]");
  check("Arabic name accepted and greeted", (await page.textContent("#greeting")).includes("عبدالله"));
  await page.keyboard.press("Escape");
  check("Escape closes the dialog", !(await page.evaluate(() => document.querySelector("#prefs-dialog").open)));

  // Complex logic: level + sort.
  await page.locator("#projects").scrollIntoViewIfNeeded();
  await page.click('input[name="project-view"][value="beginner"] + span');
  await page.selectOption("#project-sort", "newest");
  const visible = await page.$$eval(".project-card", (cards) => cards.filter((c) => !c.hidden).map((c) => c.id));
  check("Beginner + Newest first", JSON.stringify(visible) === JSON.stringify(["project-portfolio", "project-gesture"]));
  check("plain-words shown", await page.isVisible("#project-gesture .plain-words"));

  // Contact form rules.
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await page.selectOption("#topic", "Internship or job opportunity");
  check("job topic reveals Company", await page.isVisible("#company"));
  await page.click('#contact-form button[type="submit"]');
  check("empty submit shows errors", (await page.textContent("#email-error")).length > 0 && (await page.textContent("#company-error")).length > 0);
  await page.fill("#email", "sara@gmial.com");
  await page.focus("#message");
  check("email typo suggestion", await page.isVisible("#email-hint"));

  if (layout === "phone") {
    await page.click("#menu-toggle");
    check("phone menu opens", (await page.getAttribute("#menu-toggle", "aria-expanded")) === "true");
  }

  check("no JavaScript errors", errors.length === 0);
  if (errors.length) console.log("    errors:", errors);
}

(async () => {
  fs.mkdirSync(path.join(__dirname, "screenshots"), { recursive: true });
  const server = await serve();
  const base = `http://localhost:${server.address().port}/`;
  const summary = [];
  let failed = 0;

  for (const browserInfo of BROWSERS) {
    let browser;
    try {
      browser = await browserInfo.type.launch(browserInfo.options);
    } catch (error) {
      console.log(`SKIP ${browserInfo.name}: not installed (${error.message.split("\n")[0]})`);
      summary.push(`${browserInfo.name}: skipped`);
      continue;
    }
    const version = browser.version();
    for (const layout of LAYOUTS) {
      const options = typeof layout.context === "function" ? layout.context(browserInfo.name) : layout.context;
      const context = await browser.newContext(options);
      const page = await context.newPage();
      let passed = 0;
      let failedHere = 0;
      const check = (label, ok) => {
        console.log(`${ok ? "PASS" : "FAIL"} [${browserInfo.name} ${layout.name}] ${label}`);
        if (ok) passed += 1;
        else failedHere += 1;
      };
      try {
        await checkSite(page, base, check, layout.name, `${browserInfo.name.split(" ")[0].toLowerCase()}-${layout.name}`);
      } catch (error) {
        check(`crashed: ${error.message.split("\n")[0]}`, false);
      }
      failed += failedHere;
      summary.push(`${browserInfo.name} ${version} (${layout.name}): ${passed} passed, ${failedHere} failed`);
      await context.close();
    }
    await browser.close();
  }

  server.close();
  console.log(`\n${summary.join("\n")}`);
  process.exit(failed > 0 ? 1 : 0);
})();
