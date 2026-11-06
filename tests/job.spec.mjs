import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "fs";

const API = /job-api\.appdoivo\.com/;
// A tailored answer, as the AI service returns it: the made-up example person
const answer = async (page) => {
  const { SAMPLE } = await page.evaluate(async () => import("/lib/cv.js"));
  return { cv: SAMPLE.cv, letter: SAMPLE.letter, keywords: SAMPLE.keywords, notes: { changes: ["Moved TypeScript up."], gaps: ["Accessibility testing"] }, cached: false, cost: "$0.0412", balance: "$4.76" };
};
// Walks the machine: Continue only works once the step is valid; Back returns
const CV = "Alex Morgan\nalex.morgan@example.com | +351 910 000 000\nQA Engineer, Northwind 2022 - present\n" + "Built Playwright and TypeScript test suites for checkout. ".repeat(12);
const fillForm = async (page) => {
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await expect(page.locator("#read-cv")).toContainText("Alex Morgan");
  await page.locator("#next").click();
  await expect(page.locator('.panel[data-step="1"]')).toBeHidden();             // the previous step is put away
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4));
  await expect(page.locator("#read-job")).toContainText("Playwright");
  await page.locator("#next").click();
  await page.locator("#skip").click();
  await expect(page.locator("#summary")).toContainText("Pasted Text");
  await expect(page.locator("#tailor")).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("fresh")) { localStorage.clear(); sessionStorage.setItem("fresh", "1"); } } catch (_) {} });
});

test("the example shows a CV and a cover letter that pass every ATS check", async ({ page }) => {
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?lang=en");
  await page.locator("#example").click();
  await expect(page.locator("#checks li")).toHaveCount(11);
  for (const id of ["Real, Selectable Text", "Name at the Top", "Email in the Header", "Standard Section Titles", "One Column, Read in Order", "No Images", "Every Job Has Dates", "Clean File Name"])
    await expect(page.locator("#checks li.ok", { hasText: id })).toHaveCount(1);
  await expect(page.locator("#kw-missing")).toContainText("accessibility testing");     // honest: the CV does not have it
  await expect(page.locator("#cv-preview")).toContainText("Northwind Payments");
  await page.locator("#tab-letter").click();
  await expect(page.locator("#letter-preview")).toContainText("Dear Hiring Team,");
  expect(errors).toEqual([]);
});

test("downloads: PDF and Word with clean names, and the PDF reads back in order", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.locator("#example").click();
  await expect(page.locator("#checks li")).toHaveCount(11);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.locator('[data-dl="cv-pdf"]').click()]);
  expect(pdf.suggestedFilename()).toBe("Alex-Morgan-CV.pdf");
  const [docx] = await Promise.all([page.waitForEvent("download"), page.locator('[data-dl="cv-docx"]').click()]);
  expect(docx.suggestedFilename()).toBe("Alex-Morgan-CV.docx");
  expect(readFileSync(await docx.path()).subarray(0, 2).toString()).toBe("PK");           // a real Word (zip) file
  // Read the downloaded PDF the way a parser does: each job's dates come right after its title
  const bytes = [...readFileSync(await pdf.path())];
  const text = await page.evaluate(async (b) => (await (await import("/lib/ats.js")).readPdf(new Uint8Array(b))).text, bytes);
  const t = text.replace(/\s+/g, " ");
  expect(t.indexOf("QA Engineer, Contoso Markets")).toBeLessThan(t.indexOf("Jan 2019 – Jan 2022"));
  expect(t.indexOf("Jan 2019 – Jan 2022")).toBeLessThan(t.indexOf("SKILLS"));
  const [letter] = await Promise.all([page.waitForEvent("download"), (async () => { await page.locator("#tab-letter").click(); await page.locator('#panel-letter [data-dl="letter-pdf"]').click(); })()]);
  expect(letter.suggestedFilename()).toBe("Alex-Morgan-Cover-Letter.pdf");
});

test("colours: five, keyboard-reachable, and the CV follows the choice", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.locator("#example").click();
  await expect(page.locator(".swatch")).toHaveCount(6);
  await page.locator('.swatch[data-c="green"]').click();
  await expect(page.locator(".paper").first()).toHaveAttribute("style", /#2e6b3f/);
  await page.locator('.swatch[data-c="green"]').press("ArrowRight");
  await expect(page.locator('.swatch[data-c="yellow"]')).toHaveAttribute("aria-checked", "true");
});

test("tailoring: passcode, the answer, its cost, and the errors", async ({ page }) => {
  let calls = 0, reply = 200;
  await page.route(API, async (route) => {
    calls++;
    if (route.request().headers()["x-passcode"] !== "right") return route.fulfill({ status: 401, json: { error: "passcode" } });
    if (reply === 402) return route.fulfill({ status: 402, json: { error: "credit", balance: "$0.00" } });
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await fillForm(page);
  await page.locator("#tailor").click();
  await page.locator("#pass").fill("wrong");
  await page.locator("#pass-form button").click();
  await expect(page.locator("#status")).toHaveText("That passcode is not right.");
  await page.locator("#tailor").click();
  await page.locator("#pass").fill("right");
  await page.locator("#pass-form button").click();
  await expect(page.locator("#result-note")).toHaveText("This run cost $0.0412. Credit left: $4.76.");
  await expect(page.locator("#notes")).toContainText("Accessibility testing");
  reply = 402;
  await page.locator("#tailor").click();                                     // passcode remembered: no dialog
  await expect(page.locator("#status")).toHaveText("The credit has run out.");
  expect(calls).toBe(3);
});

test("when the AI service cannot be reached, it says so and points to the example", async ({ page }) => {
  await page.route(API, (route) => route.abort());
  await page.goto("/?lang=en");
  await fillForm(page);
  await page.locator("#tailor").click();
  await page.locator("#pass").fill("x");
  await page.locator("#pass-form button").click();
  await expect(page.locator("#status")).toContainText("isn't connected yet");
});

test("Portuguese: same words, Title Case labels, impersonal", async ({ page }) => {
  await page.goto("/?lang=pt");
  await expect(page.locator("h1")).toHaveText("O CV à Medida de Cada Vaga");
  await expect(page.locator("#tailor")).toHaveText("Adaptar o CV");
  const { WORDS } = await page.evaluate(async () => import("/words.js"));
  const keys = (o) => Object.keys(o).sort();
  expect(keys(WORDS.pt)).toEqual(keys(WORDS.en));
  expect(keys(WORDS.pt.checks)).toEqual(keys(WORDS.en.checks));
  const small = new Set(["o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "à", "ao", "um", "uma", "por", "para", "com", "se", "ou"]);
  for (const k of ["back", "pasted", "tCompany", "sumOut", "continue", "skip", "stepGo", "stepCv", "choose", "pasteInstead", "stepJob", "stepCompany", "colour", "model", "tailor", "example", "tabLetter", "dlPdf", "dlWord", "check", "found", "gaps", "changes", "checkBtn", "have", "missingQ", "suggest", "recheck", "change"])
    WORDS.pt[k].split(/\s+/).forEach((w, i) => { if (i === 0 || !small.has(w.toLowerCase())) expect(w[0], `${k}: ${WORDS.pt[k]}`).toBe(w[0].toUpperCase()); });
  expect(JSON.stringify(WORDS.pt)).not.toMatch(/\b(tu|teu|tua|você)\b/i);
});

test("no sideways scroll, 44px targets, no serious accessibility problems, light and dark", async ({ page }) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?lang=en");
    await page.locator("#example").click();
    await expect(page.locator("#checks li")).toHaveCount(11);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    for (const sel of ["#lang", "#mode", "#next", "#example", ".swatch >> nth=0", "#tab-cv", '[data-dl="cv-pdf"]'])
      expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
    const r = await new AxeBuilder({ page }).exclude(".paper").analyze();       // the CV itself is a document preview, checked by the ATS check
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), scheme).toEqual([]);
  }
});

test("the machine: one step at a time, Back keeps what was typed, limits are shown", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.locator("#step-count")).toHaveText("Step 1 of 4");
  await expect(page.locator("#back")).toBeHidden();
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await expect(page.locator('[data-count="cv-text"]')).toContainText("/ 30,000 characters");
  await page.locator("#next").click();
  await expect(page.locator("#step-count")).toHaveText("Step 2 of 4");
  await page.locator("#job").fill("short");
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#back").click();
  await expect(page.locator("#cv-text")).toHaveValue(CV);
  await expect(page.locator("#next")).toBeEnabled();
});

test("a reload keeps the CV, the job, the company and the step (this tab only)", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await page.locator("#next").click();
  await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4));
  await page.locator("#next").click();
  await page.locator("#company").fill("We value care, craft, plain words and kind teams.");
  await page.locator("#next").click();
  await expect(page.locator("#tailor")).toBeVisible();
  await page.reload();
  await expect(page.locator("#tailor")).toBeVisible();                           // back on step 4
  await expect(page.locator("#summary")).toContainText("A tailored CV and a cover letter");
  await page.locator("#back").click();
  await expect(page.locator("#company")).toHaveValue("We value care, craft, plain words and kind teams.");
  await page.locator("#back").click();
  await expect(page.locator("#job")).toHaveValue(/QA automation engineer/);
  await page.locator("#back").click();
  await expect(page.locator("#cv-text")).toHaveValue(/Alex Morgan/);
});

const REVIEW = { role: "QA Automation Engineer", company: "Northwind", score: 72, verdict: "A strong match on automation; no Kubernetes shown.",
  have: [{ term: "Playwright", evidence: "Northwind, checkout tests" }], missing: [{ term: "Kubernetes", question: "Have you worked with Kubernetes?" }, { term: "Java", question: "Have you used Java?" }],
  suggestions: ["Lead the summary with Playwright", "Move TypeScript into the headline"], cost: "$0.0021", balance: "$4.99" };

test("the review board: a quick check first, then the CV is written with the person's choices", async ({ page }) => {
  let body = null;
  await page.route(API, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/review") return route.fulfill({ status: 200, json: REVIEW });
    body = route.request().postDataJSON();
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await page.evaluate(() => localStorage.setItem("pass", "right"));            // the owner's device: the check runs straight away
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await page.locator("#next").click();
  await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4));
  await page.locator("#next").click();
  await page.locator("#skip").click();
  await expect(page.locator("#review")).toContainText("72% Match");
  await expect(page.locator("#credit")).toHaveText("Credit: $4.99");
  await page.locator('[data-yes="0"]').check();
  await page.locator('[data-note="0"]').fill("Deloitte, two client projects");
  await page.locator('[data-sug="1"]').uncheck();
  await page.locator("#tailor").click();
  await expect(page.locator("#result-note")).toContainText("Credit left: $4.76");
  expect(body.choices).toEqual({ confirmed: [{ term: "Kubernetes", note: "Deloitte, two client projects" }], apply: ["Lead the summary with Playwright"], skip: ["Move TypeScript into the headline"] });
  await page.reload();                                                         // the choices survive a reload, with no second check
  await expect(page.locator('[data-yes="0"]')).toBeChecked();
});

test("a job link is read for you; a page that cannot be read says so", async ({ page }) => {
  let ok = true;
  await page.route(API, (route) => ok
    ? route.fulfill({ status: 200, json: { title: "QA Engineer", company: "Northwind", text: "We need a QA automation engineer with Playwright and TypeScript. ".repeat(4) } })
    : route.fulfill({ status: 422, json: { error: "unreadable" } }));
  await page.goto("/?lang=en");
  await page.evaluate(() => localStorage.setItem("pass", "right"));
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await page.locator("#next").click();
  await page.locator("#job").fill("https://www.linkedin.com/jobs/view/4481307816/");
  await expect(page.locator("#job")).toHaveValue(/^QA Engineer · Northwind\n\nWe need/);
  // one link fills the job here and the company in the next step; nothing is skipped
  await expect(page.locator("#job-status")).toContainText("Read from linkedin.com");
  await expect(page.locator("#company")).toHaveValue(/^Northwind/);
  await page.locator("#next").click();
  await expect(page.locator("#company")).toBeVisible();
  ok = false;
  // a fresh tab (no saved draft) for the page that cannot be read
  const p2 = await page.context().newPage();
  await p2.route(API, (route) => route.fulfill({ status: 422, json: { error: "unreadable" } }));
  await p2.goto("/?lang=en");
  await p2.locator("#paste-toggle").click();
  await p2.locator("#cv-text").fill(CV);
  await p2.locator("#next").click();
  await p2.locator("#job").fill("https://example.com/careers/42");
  await expect(p2.locator("#job-status")).toHaveText("That page could not be read. Open the ad and paste its text here instead.");
  await expect(p2.locator("#next")).toBeDisabled();
});

/* ---------- phone frame (same as ivolopes.com) ---------- */
test("nothing is pinned to the screen edges (iPhone Safari paints a solid band over it)", async ({ page }) => {
  await page.goto("/");
  const pinned = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position)).map((el) => el.id || el.className));
  expect(pinned).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe("hidden");
});

test("the window sits scrolled down by the strip above it, and the background covers past every edge", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160);
  const top = await page.locator(".top").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(40);
  const vp = page.viewportSize();
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const bg = await page.locator(".bg").evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, img: getComputedStyle(el).backgroundImage }; });
    expect(bg.top, scheme).toBeLessThanOrEqual(-150);
    expect(bg.bottom, scheme).toBeGreaterThanOrEqual(vp.height);
    expect(bg.img, scheme).not.toBe("none");
  }
});
