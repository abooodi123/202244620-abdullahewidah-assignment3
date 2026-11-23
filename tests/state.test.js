// Checks the state store and the Personalize dialog: sign in and out, theme
// choices, hidden sections, saved values across reloads, and sync between tabs.
const puppeteer = require("puppeteer-core");
const { CHROME_PATH } = require("./config");
const SITE = process.argv[2];
const OUT = process.argv[3] || ".";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(SITE, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (label, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());
  const isOpen = () => page.$eval("#prefs-dialog", (d) => d.open);

  check("personalize button visible", await page.$eval("#prefs-open", (b) => !b.hidden));
  await page.click("#prefs-open");
  await wait(300);
  check("dialog opens as modal", await isOpen());

  // Invalid names are rejected with a message, and nothing is stored.
  await page.click("#name-form button[type=submit]");
  check("empty name shows error", (await text("#visitor-name-error")).length > 0);
  await page.type("#visitor-name", "R2D2");
  await page.click("#name-form button[type=submit]");
  check("name with digits rejected", (await text("#visitor-name-error")).includes("letters"));
  check("nothing stored for bad name", (await page.evaluate(() => localStorage.getItem("portfolio-visitor-name"))) === null);

  await page.$eval("#visitor-name", (i) => (i.value = ""));
  await page.type("#visitor-name", "  Sara   Al-Qahtani ");
  await page.click("#name-form button[type=submit]");
  await wait(200);
  check("signed-in panel shows", await page.$eval("#signed-in", (el) => !el.hidden));
  check("spaces tidied in stored name", (await page.evaluate(() => localStorage.getItem("portfolio-visitor-name"))) === "Sara Al-Qahtani");
  check("header shows initial S", (await text("#avatar-initial")) === "S");
  check("greeting uses name", (await text("#greeting")).includes("Sara Al-Qahtani"));
  check("contact name prefilled", (await page.$eval("#name", (i) => i.value)) === "Sara Al-Qahtani");
  await page.screenshot({ path: `${OUT}/prefs-signed-in.png` });

  // Theme radios drive the store, which drives the page.
  await page.click('input[name="pref-theme"][value="dark"] + span');
  await wait(400);
  check("dark radio -> dark page", (await page.$eval("html", (h) => h.dataset.theme)) === "dark");
  await page.click('input[name="pref-theme"][value="system"] + span');
  await wait(400);
  check("system choice removes saved theme", (await page.evaluate(() => localStorage.getItem("portfolio-theme"))) === null);

  // Hide the GitHub section; its nav link goes too.
  const githubSwitch = await page.$('#prefs-sections input[data-section="github"]');
  check("switch generated for GitHub", Boolean(githubSwitch));
  await page.click('#prefs-sections input[data-section="github"]');
  await wait(100);
  check("github section hidden", await page.$eval("#github", (s) => s.classList.contains("is-user-hidden")));
  check("github nav link hidden", await page.$eval('.nav-links a[href="#github"]', (a) => a.parentElement.classList.contains("is-user-hidden")));

  // Escape closes the dialog (native modal behaviour).
  await page.keyboard.press("Escape");
  await wait(100);
  check("Escape closes dialog", !(await isOpen()));

  // Everything survives a reload.
  await page.reload({ waitUntil: "networkidle0" });
  check("name remembered after reload", (await text("#greeting")).includes("Sara"));
  check("hidden section remembered", await page.$eval("#github", (s) => s.classList.contains("is-user-hidden")));

  // A second tab that changes a value updates this tab through the storage event.
  const other = await browser.newPage();
  await other.goto(SITE, { waitUntil: "networkidle0" });
  await other.evaluate(() => document.querySelector("#theme-toggle").click());
  await wait(600); // The other tab cross-fades first, so read its result afterwards.
  const otherTheme = await other.evaluate(() => localStorage.getItem("portfolio-theme"));
  check(`other tab's theme (${otherTheme}) synced here`, (await page.$eval("html", (h) => h.dataset.theme)) === otherTheme);
  await other.close();

  // Damaged saved values fall back to safe defaults.
  await page.evaluate(() => {
    localStorage.setItem("portfolio-hidden-sections", "{not json");
    localStorage.setItem("portfolio-visitor-name", "<script>");
  });
  await page.reload({ waitUntil: "networkidle0" });
  check("corrupt values ignored", !(await page.$eval("#github", (s) => s.classList.contains("is-user-hidden"))) && !(await text("#greeting")).includes("<"));

  // Sign out and reset.
  await page.evaluate(() => localStorage.setItem("portfolio-visitor-name", "Sara"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.click("#prefs-open");
  await page.click("#sign-out");
  await wait(100);
  check("sign out clears name", (await page.evaluate(() => localStorage.getItem("portfolio-visitor-name"))) === null && !(await text("#greeting")).includes("Sara"));
  await page.click('#prefs-sections input[data-section="github"]');
  await page.click("#prefs-reset");
  await wait(500); // Reset may switch the theme; clicks are ignored during its cross-fade.
  check("reset restores sections and clears storage", !(await page.$eval("#github", (s) => s.classList.contains("is-user-hidden"))) && (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("portfolio-") && !["portfolio-weather", "portfolio-github-repos"].includes(k)).length)) === 0);
  await page.click("#prefs-done");

  await page.setViewport({ width: 390, height: 844 });
  await wait(300); // Let the layout settle at the new size before clicking.
  await page.click("#prefs-open");
  await wait(300);
  check("dialog opens on a phone-sized screen", await isOpen());
  await page.screenshot({ path: `${OUT}/prefs-mobile.png` });

  check("no page errors", errors.length === 0);
  if (errors.length) console.log("errors:", errors);
  await browser.close();
})();
