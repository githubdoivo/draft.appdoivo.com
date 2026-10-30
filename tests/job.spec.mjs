import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "fs";

const API = /job-api\.appdoivo\.com/;
// A tailored answer, as the AI service returns it: the made-up example person
const answer = async (page) => {
  const { SAMPLE } = await page.evaluate(async () => import("/lib/cv.js"));
  return { cv: SAMPLE.cv, letter: SAMPLE.letter, keywords: SAMPLE.keywords, notes: { changes: ["Moved TypeScript up."], gaps: ["Accessibility testing"] }, cached: false, cost: "$0.0412", month: "$0.04", cap: "$3.00" };
};
const fillForm = async (page) => {
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill("Alex Morgan. QA engineer. ".repeat(30));
  await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4));
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
  await expect(page.locator(".swatch")).toHaveCount(5);
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
    if (reply === 402) return route.fulfill({ status: 402, json: { error: "cap" } });
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await page.locator("#tailor").click();
  await expect(page.locator("#status")).toHaveText("Add a CV first.");
  await fillForm(page);
  await page.locator("#tailor").click();
  await page.locator("#pass").fill("wrong");
  await page.locator("#pass-form button").click();
  await expect(page.locator("#status")).toHaveText("That passcode is not right.");
  await page.locator("#tailor").click();
  await page.locator("#pass").fill("right");
  await page.locator("#pass-form button").click();
  await expect(page.locator("#result-note")).toContainText("This run cost $0.0412");
  await expect(page.locator("#notes")).toContainText("Accessibility testing");
  reply = 402;
  await page.locator("#tailor").click();                                     // passcode remembered: no dialog
  await expect(page.locator("#status")).toContainText("spending limit");
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
  for (const k of ["stepCv", "choose", "pasteInstead", "stepJob", "stepCompany", "colour", "model", "tailor", "example", "tabLetter", "dlPdf", "dlWord", "check", "found", "gaps", "changes"])
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
    for (const sel of ["#lang", "#mode", "#tailor", "#example", ".swatch >> nth=0", "#tab-cv", '[data-dl="cv-pdf"]'])
      expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
    const r = await new AxeBuilder({ page }).exclude(".paper").analyze();       // the CV itself is a document preview, checked by the ATS check
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), scheme).toEqual([]);
  }
});
