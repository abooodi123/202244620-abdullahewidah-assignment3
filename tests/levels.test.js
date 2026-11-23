// Checks the reader-level views and date sorting in the project explorer,
// including how the level combines with area filters, search, and sorting.
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
  const visible = () => page.$$eval(".project-card", (cards) => cards.filter((c) => !c.hidden).map((c) => c.id.replace("project-", "")));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const chooseView = async (view) => {
    await page.click(`input[name="project-view"][value="${view}"] + span`);
    await wait(150);
  };

  check("level bar visible", await page.$eval("#level-bar", (el) => !el.hidden));
  check("Everyone selected by default", await page.$eval('input[name="project-view"][value="all"]', (r) => r.checked));
  check("no level message for everyone", (await page.$eval("#level-message", (el) => el.textContent)) === "");
  check("plain words hidden by default", await page.$eval(".plain-words", (el) => getComputedStyle(el).display === "none"));

  // Sorting by date.
  await page.select("#project-sort", "newest");
  await wait(100);
  check("newest first", same(await visible(), ["portfolio", "twin", "gesture", "yolo"]));
  await page.select("#project-sort", "oldest");
  await wait(100);
  check("oldest first", same(await visible(), ["yolo", "gesture", "twin", "portfolio"]));

  // Beginner: easier projects, plain-language explanations, a message.
  await chooseView("beginner");
  check("beginner shows beginner + intermediate", same(await visible(), ["gesture", "portfolio"]));
  check("beginner message shown", (await page.$eval("#level-message", (el) => el.textContent)).includes("plain words"));
  check("plain words shown", await page.$eval("#project-gesture .plain-words", (el) => getComputedStyle(el).display !== "none"));
  check("summary names the audience", (await page.$eval("#project-count", (el) => el.textContent)).includes("for beginners"));
  check("chip counts respect level", (await page.$eval('[data-filter="ai"] .chip-count', (el) => el.textContent)) === "1");
  check("url has view=beginner", page.url().includes("view=beginner"));

  // Advanced: harder projects with highlights opened automatically.
  await chooseView("advanced");
  await wait(400);
  check("advanced shows intermediate + advanced (oldest first)", same(await visible(), ["yolo", "gesture", "twin"]));
  check("advanced opens highlights", await page.$eval("#project-yolo .details-toggle", (b) => b.getAttribute("aria-expanded") === "true"));
  check("plain words hidden again", await page.$eval("#project-gesture .plain-words", (el) => getComputedStyle(el).display === "none"));
  await page.evaluate(() => document.querySelector("#projects").scrollIntoView());
  await wait(500);
  await page.screenshot({ path: `${OUT}/levels-advanced.png` });

  // Filter + level conflict: Web has no advanced projects, and the empty state says why.
  await page.click('[data-filter="web"]');
  await wait(100);
  const empty = await page.$eval("#project-empty-text", (el) => el.textContent);
  check("web + advanced is empty", (await visible()).length === 0);
  check(`empty state offers both fixes ("${empty}")`, empty.includes("“All” areas") && empty.includes("“Everyone”"));
  await page.click("#project-reset");
  await wait(200);
  check("reset returns to everyone and all areas", (await visible()).length === 4 && (await page.$eval('input[name="project-view"][value="all"]', (r) => r.checked)));

  // Search + area conflict still blames the area first.
  await chooseView("beginner");
  await page.click('[data-filter="web"]');
  await page.type("#project-search", "esp32");
  await wait(300);
  check("only the area is to blame", (await page.$eval("#project-empty-text", (el) => el.textContent)).includes("other areas"));
  await page.click("#project-reset");
  await wait(200);

  // Level-only conflict: a beginner searching for the advanced YOLO project.
  await chooseView("beginner");
  await page.type("#project-search", "yolo");
  await wait(300);
  check("only the level is to blame", (await page.$eval("#project-empty-text", (el) => el.textContent)).includes("other levels"));
  await page.click("#project-reset");
  await wait(200);

  // The level is remembered, and a shared link wins over the saved choice.
  await chooseView("beginner");
  await page.goto(SITE, { waitUntil: "networkidle0" });
  check("level remembered after reload", same(await visible(), ["gesture", "portfolio"]));
  await page.goto(`${SITE}?view=advanced&sort=newest`, { waitUntil: "networkidle0" });
  check("shared link overrides saved level", same(await visible(), ["twin", "gesture", "yolo"]));
  await chooseView("beginner");
  check("switching from a link level works", same(await visible(), ["portfolio", "gesture"])); // still newest first
  await page.goto(`${SITE}?view=bogus`, { waitUntil: "networkidle0" });
  check("unknown view falls back to saved", same(await visible(), ["gesture", "portfolio"]));

  check("no page errors", errors.length === 0);
  if (errors.length) console.log("errors:", errors);
  await browser.close();
})();
