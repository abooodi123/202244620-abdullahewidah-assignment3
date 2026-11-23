// Checks the contact form rules added in Assignment 3: the company field that
// only the job topic requires, the email typo suggestion, and the live checklist.
const puppeteer = require("puppeteer-core");
const { CHROME_PATH } = require("./config");
const SITE = process.argv[2];
const OUT = process.argv[3] || ".";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(SITE, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  // A test browser cannot open an email app, so record the mailto: navigation
  // the page asks for through the DevTools protocol instead.
  let mailto = "";
  const cdp = await page.createCDPSession();
  await cdp.send("Page.enable");
  cdp.on("Page.frameRequestedNavigation", (event) => event.url.startsWith("mailto:") && (mailto = event.url));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (label, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  const summary = () => page.$eval("#checklist-summary", (el) => el.textContent);
  const items = () => page.$$eval("#form-checklist li", (lis) => lis.map((li) => `${li.firstChild.textContent}${li.classList.contains("is-done") ? "✓" : "○"}`).join(" "));
  const clearField = (sel) => page.$eval(sel, (el) => (el.value = ""));

  // Checklist starts with the three always-required fields.
  check("checklist visible", await page.$eval("#form-checklist", (el) => !el.hidden));
  check(`starts at 0 of 3 (${await items()})`, (await summary()) === "0 of 3 ready" && (await items()) === "Name○ Email○ Message○");
  await page.type("#name", "Sara");
  await page.type("#email", "sara@example");
  check("half-typed email not ticked", (await items()) === "Name✓ Email○ Message○");
  await page.type("#email", ".com");
  await page.type("#message", "Hello there, a question.");
  check(`all ticked -> Ready to send (${await summary()})`, (await summary()) === "Ready to send");
  check("ready state styled", await page.$eval("#form-checklist", (el) => el.classList.contains("is-ready")));

  // The job topic adds a required company field, and the checklist follows.
  check("company hidden for other topics", await page.$eval("#company-field", (el) => el.hidden));
  await page.select("#topic", "Internship or job opportunity");
  check("job topic shows the company field", await page.$eval("#company-field", (el) => !el.hidden));
  check(`checklist adds Company (${await items()})`, (await items()).includes("Company or organization○") && (await summary()) === "3 of 4 ready");
  await page.click('#contact-form button[type="submit"]');
  await wait(300);
  check("submit blocked without a company", (await page.$eval("#company-error", (el) => el.textContent)).includes("company") && (await page.evaluate(() => document.activeElement.id)) === "company");
  check("no email draft opened", mailto === "");
  await page.evaluate(() => document.querySelector("#contact").scrollIntoView());
  await wait(400);
  await page.screenshot({ path: `${OUT}/form-company.png` });

  // Switching away from the job topic removes the rule and its error.
  await page.select("#topic", "Question about my work");
  check("other topic hides field and error", (await page.$eval("#company-field", (el) => el.hidden)) && (await page.$eval("#company-error", (el) => el.textContent)) === "");
  check("checklist back to 3 fields", (await summary()) === "Ready to send");

  await page.select("#topic", "Internship or job opportunity");
  await page.type("#company", "Example Labs");
  await page.click('#contact-form button[type="submit"]');
  await wait(300);
  const draftUrl = decodeURIComponent(mailto);
  check("valid job message opens the email draft", (await page.$eval("#form-status", (el) => el.textContent)).includes("Thanks, Sara"));
  check(`company in subject and body (${draftUrl.slice(0, 90)}…)`, draftUrl.includes("message from Sara (Example Labs)") && draftUrl.includes("Sara\nExample Labs\nsara@example.com"));

  // Company is saved with the draft and restored with its field.
  await wait(500);
  await page.reload({ waitUntil: "networkidle0" });
  check("draft restores company and its field", (await page.$eval("#company", (el) => el.value)) === "Example Labs" && (await page.$eval("#company-field", (el) => !el.hidden)));

  // Email typo suggestion: shown on leaving the field, applied with one click.
  await clearField("#email");
  await page.type("#email", "sara@gmial.com");
  check("no suggestion while typing", await page.$eval("#email-hint", (el) => el.hidden));
  await page.focus("#message");
  check("suggestion after leaving the field", (await page.$eval("#email-hint", (el) => !el.hidden)) && (await page.$eval("#email-fix", (el) => el.textContent)) === "sara@gmail.com");
  await page.evaluate(() => document.querySelector("#contact").scrollIntoView());
  await wait(300);
  await page.screenshot({ path: `${OUT}/form-email-hint.png` });
  await page.click("#email-fix");
  check("one click applies the fix and hides the hint", (await page.$eval("#email", (el) => el.value)) === "sara@gmail.com" && (await page.$eval("#email-hint", (el) => el.hidden)));

  // A domain that passes the format check but is a likely typo is still only a suggestion.
  await clearField("#email");
  await page.type("#email", "sara@gmail.co");
  await page.focus("#message");
  check("gmail.co suggested but not blocked", (await page.$eval("#email-hint", (el) => !el.hidden)) && (await page.$eval("#email-error", (el) => el.textContent)) === "");
  await page.click("#email");
  await page.keyboard.press("End");
  await page.keyboard.type("m");
  check("fixing it by hand hides the hint", await page.$eval("#email-hint", (el) => el.hidden));

  // Unknown domains get no suggestion.
  await clearField("#email");
  await page.type("#email", "sara@company.org");
  await page.focus("#message");
  check("normal domain: no suggestion", await page.$eval("#email-hint", (el) => el.hidden));

  check("no page errors", errors.length === 0);
  if (errors.length) console.log("errors:", errors);
  await browser.close();
})();
