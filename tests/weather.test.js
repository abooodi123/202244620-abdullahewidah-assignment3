// Exercises the Dhahran weather card against the live Open-Meteo API and
// simulated responses: errors, bad data, slow answers, and cached copies.
const puppeteer = require("puppeteer-core");
const { CHROME_PATH } = require("./config");
const SITE = process.argv[2];
const OUT = process.argv[3] || ".";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (label, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${label}`);

// A made-up reading: 41.4 °C, clear, daytime.
const FAKE = { current: { temperature_2m: 41.4, apparent_temperature: 44, relative_humidity_2m: 20, weather_code: 0, wind_speed_10m: 12, is_day: 1 } };

async function openPage(browser, startMode, { seed } = {}) {
  let mode = startMode;
  const page = await browser.newPage();
  const errors = [];
  let calls = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (!req.url().startsWith("https://api.open-meteo.com")) return req.continue();
    calls += 1;
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (mode === "live") return req.continue();
    if (mode === "fake") return req.respond({ status: 200, headers, body: JSON.stringify(FAKE) });
    if (mode === "rain") return req.respond({ status: 200, headers, body: JSON.stringify({ current: { ...FAKE.current, temperature_2m: 22, weather_code: 63 } }) });
    if (mode === "500") return req.respond({ status: 500, headers, body: "{}" });
    if (mode === "429") return req.respond({ status: 429, headers, body: "{}" });
    if (mode === "bad-data") return req.respond({ status: 200, headers, body: JSON.stringify({ current: { temperature_2m: "hot" } }) });
    if (mode === "not-json") return req.respond({ status: 200, headers, body: "<html>oops</html>" });
    if (mode === "network") return req.abort("failed");
    if (mode === "slow") return; // Never answers, so the 8-second timeout must fire.
  });
  // Start from a clean slate (optionally with a saved copy), then load for real.
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await page.evaluate((seedEntry) => {
    localStorage.clear();
    if (seedEntry) localStorage.setItem("portfolio-weather", JSON.stringify(seedEntry));
  }, seed || null);
  calls = 0;
  await page.reload({ waitUntil: "domcontentloaded" });
  return { page, errors, calls: () => calls, setMode: (next) => (mode = next) };
}

const weatherText = (page) => page.$eval("#weather", (el) => el.textContent.replace(/\s+/g, " ").trim());

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

  // 1. The real API answers and the card fills in.
  let { page, errors, calls } = await openPage(browser, "live");
  await page.waitForSelector(".weather-now", { timeout: 15000 });
  console.log("  live:", await weatherText(page));
  check("live weather renders a temperature", /-?\d+°C/.test(await weatherText(page)));
  check("live: one request", calls() === 1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".weather-now");
  check("reload reuses the 15-minute cache (no new request)", calls() === 1);
  check("live: no page errors", errors.length === 0);
  await page.close();

  // 2. Known data: words, icon, remark, and unit conversion.
  ({ page, errors } = await openPage(browser, "fake"));
  await page.waitForSelector(".weather-now");
  const text = await weatherText(page);
  check(`fake reading shown in °C (${text})`, text.includes("41°C Clear sky in Dhahran") && text.includes("Feels like 44°C"));
  check("hot-day remark chosen", text.includes("scorcher"));
  await page.click('input[name="temp-unit"][value="fahrenheit"] + span');
  await wait(100);
  check("°F conversion: 41.4°C -> 107°F", (await weatherText(page)).includes("107°F"));
  check("unit saved", (await page.evaluate(() => localStorage.getItem("portfolio-temp-unit"))) === "fahrenheit");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".weather-now");
  check("unit remembered after reload", (await weatherText(page)).includes("107°F"));
  await page.evaluate(() => document.querySelector("#weather").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${OUT}/weather-card.png` });
  await page.close();

  ({ page } = await openPage(browser, "rain"));
  await page.waitForSelector(".weather-now");
  check("rain remark beats temperature remarks", (await weatherText(page)).includes("Rain is a rare sight"));
  await page.close();

  // 3. Failures with no saved copy: a specific message and a retry button.
  const expected = {
    500: "unavailable",
    429: "busy",
    network: "unavailable",
    "bad-data": "unavailable",
    "not-json": "unavailable",
  };
  for (const [mode, phrase] of Object.entries(expected)) {
    ({ page, errors } = await openPage(browser, mode));
    await page.waitForSelector(".weather-note.is-error", { timeout: 15000 });
    const message = await weatherText(page);
    check(`${mode}: "${phrase}" message with retry (${message})`, message.includes(phrase) && (await page.$$("#weather .text-button")).length === 1);
    check(`${mode}: never shows NaN`, !message.includes("NaN"));
    if (mode === "500") await page.screenshot({ path: `${OUT}/weather-error.png`, clip: { x: 0, y: 450, width: 700, height: 300 } });
    await page.close();
  }

  // 4. Retry recovers once the service is back.
  let setMode;
  ({ page, setMode } = await openPage(browser, "500"));
  await page.waitForSelector(".weather-note.is-error");
  setMode("live");
  await page.click("#weather .text-button");
  await page.waitForSelector(".weather-now", { timeout: 15000 });
  check("retry loads live data after an error", /\d+°C/.test(await weatherText(page)));
  await page.close();

  // 5. A slow service times out with its own message.
  ({ page } = await openPage(browser, "slow"));
  check("loading message while waiting", (await weatherText(page)).includes("Checking the weather"));
  await page.waitForSelector(".weather-note.is-error", { timeout: 15000 });
  check("timeout message after 8 s", (await weatherText(page)).includes("slow to respond"));
  await page.close();

  // 6. An old saved copy is shown, labelled honestly, when a refresh fails.
  ({ page } = await openPage(browser, "500", { seed: { savedAt: Date.now() - 2 * 3600e3, data: { temperature: 30, feelsLike: 33, humidity: 75, wind: 9, code: 3, isDay: true } } }));
  await page.waitForSelector(".weather-source.is-error", { timeout: 15000 });
  const stale = await weatherText(page);
  check(`stale copy shown with its age (${stale})`, stale.includes("30°C Overcast") && stale.includes("2 hours ago"));

  // 7. Hiding the card in Personalize removes it and stops nothing else.
  await page.click("#prefs-open");
  await page.click('#prefs-sections input[data-section="weather"]');
  await page.keyboard.press("Escape");
  check("weather can be hidden from Personalize", await page.$eval("#weather", (el) => getComputedStyle(el).display === "none"));
  await page.close();

  // 8. Without JavaScript the empty card is not shown at all.
  page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  check("no-JS page hides the weather card", await page.$eval("#weather", (el) => getComputedStyle(el).display === "none"));
  await page.close();

  await browser.close();
})();
