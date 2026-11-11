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
// the owner's passcode now sits under "Owner passcode" in the sign-in window (APP-DR-003)
const ready = (page) => expect(page.locator("#lang")).toHaveAttribute("aria-label", /.+/);   // the page has run: its words are filled in
// the owner's account, as the service reports it: no passcode anywhere (APP-DR-003 round 4)
const ME_OWNER = { signedIn: true, owner: true, name: "Ivo", credits: 0, start: 5, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [] };
const isMe = (route) => new URL(route.request().url()).pathname === "/me";
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

test("tailoring: signed out it asks to sign in first; signed in, the answer, its cost, and the errors", async ({ page }) => {
  let calls = 0, reply = 200, me = { signedIn: false, start: 5 };
  await page.route(API, async (route) => {
    if (isMe(route)) return route.fulfill({ status: 200, json: me });        // the account lookup isn't a run
    calls++;
    if (route.request().headers()["x-passcode"]) return route.fulfill({ status: 500, json: {} });   // no passcode is ever sent with a run
    if (reply === 401) return route.fulfill({ status: 401, json: { error: "signin" } });
    if (reply === 402) return route.fulfill({ status: 402, json: { error: "credit", credits: 1, price: 3 } });
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await fillForm(page);
  await page.locator("#tailor").click();
  await expect(page.locator("#sign-dialog")).toBeVisible(); await expect(page.locator("#sign-dialog input[type=password]")).toHaveCount(0);   // no owner passcode in the window
  await page.locator("#sign-close").click(); expect(calls, "closing the window runs nothing").toBe(0);
  me = { ...ME_OWNER, owner: false, credits: 5 }; await page.reload();          // signed in now; the draft comes back on step 4
  await expect(page.locator("#acct")).toHaveText("5 credits");
  await page.locator("#tailor").click();
  await expect(page.locator("#result-note")).toHaveText("This run cost $0.0412. Credit left: $4.76.");
  await expect(page.locator("#notes")).toContainText("Accessibility testing");
  reply = 402;
  await page.locator("#tailor").click();
  await expect(page.locator("#wallet")).toBeVisible(); await expect(page.locator("#wallet-need")).toHaveText("This needs 3 credits and you have 1.");
  await page.locator("#wallet-close").click();
  // the session ended meanwhile: it asks to sign in again instead of failing
  reply = 401; await page.locator("#tailor").click(); await expect(page.locator("#sign-dialog")).toBeVisible();
  expect(calls).toBe(3);
});

test("when the AI service cannot be reached, it says so and points to the example", async ({ page }) => {
  await page.route(API, (route) => isMe(route) ? route.fulfill({ status: 200, json: ME_OWNER }) : route.abort());
  await page.goto("/?lang=en");
  await fillForm(page);
  await page.locator("#tailor").click();
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
  suggestions: ["Lead the summary with Playwright", "Move TypeScript into the headline"], jobs: [{ title: "QA Engineer", company: "Deloitte" }, { title: "Tester", company: "Euronext" }], cost: "$0.0021", balance: "$4.99" };

test("the review board: a quick check first, then the CV is written with the person's choices", async ({ page }) => {
  let body = null;
  await page.route(API, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/me") return route.fulfill({ status: 200, json: ME_OWNER });   // the owner's account: the check runs straight away
    if (path === "/review") return route.fulfill({ status: 200, json: REVIEW });
    body = route.request().postDataJSON();
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await page.locator("#next").click();
  await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4));
  await page.locator("#next").click();
  await page.locator("#skip").click();
  await expect(page.locator("#review")).toContainText("72% Match");
  await expect(page.locator("#credit")).toHaveText("Credit: $4.99");
  // one question at a time: Kubernetes at a past job (one tap on the job), then Java: no
  await expect(page.locator(".ask-n")).toHaveText("1 of 2");
  await page.getByRole("button", { name: "Yes, at a Past Job" }).click();
  await page.getByRole("button", { name: "QA Engineer, Deloitte" }).click();
  await expect(page.locator(".ask-q")).toHaveText("Have you used Java?");
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.locator(".answers")).toContainText("At QA Engineer, Deloitte");
  await page.locator('[data-sug="1"]').uncheck();
  await page.locator("#tailor").click();
  await expect(page.locator("#result-note")).toContainText("Credit left: $4.76");
  expect(body.choices).toEqual({ confirmed: [{ term: "Kubernetes", note: "At QA Engineer, Deloitte" }], apply: ["Lead the summary with Playwright"], skip: ["Move TypeScript into the headline"] });
  await page.reload();                                                         // the choices survive a reload, with no second check
  await expect(page.locator(".answers")).toContainText("At QA Engineer, Deloitte");
  await page.locator('[data-goto="0"]').click();                               // Change goes back to that question
  await page.getByRole("button", { name: "Yes, Elsewhere" }).click();
  await page.locator('[data-note="0"]').fill("A Kubernetes course");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ask-q")).toHaveText("Have you used Java?");
});

test("a job link is read for you; a page that cannot be read says so", async ({ page }) => {
  let ok = true;
  await page.route(API, (route) => ok
    ? route.fulfill({ status: 200, json: { title: "QA Engineer", company: "Northwind", text: "We need a QA automation engineer with Playwright and TypeScript. ".repeat(4) } })
    : route.fulfill({ status: 422, json: { error: "unreadable" } }));
  await page.goto("/?lang=en");
  await page.locator("#paste-toggle").click();
  await page.locator("#cv-text").fill(CV);
  await page.locator("#next").click();
  await page.locator("#job-link").fill("https://www.linkedin.com/jobs/view/4481307816/");
  await page.locator("#read-link").click();
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
  await p2.locator("#job-link").fill("https://example.com/careers/42");
  await p2.locator("#read-link").click();
  await expect(p2.locator("#job-status")).toContainText("didn't let draftdoivo read the ad");
  await expect(p2.locator("#next")).toBeDisabled();
});

test("after a tailored CV: interview prep from the CV, and the job saved in My Applications on this device", async ({ page }) => {
  await page.route(API, async (route) => {
    if (isMe(route)) return route.fulfill({ status: 200, json: ME_OWNER });
    if (route.request().url().endsWith("/review")) return route.fulfill({ status: 200, json: REVIEW });   // the owner's account checks the match by itself
    if (route.request().url().endsWith("/interview")) return route.fulfill({ status: 200, json: { questions: [{ question: "Tell us about your test automation.", why: "The role is about Playwright.", answer: "At Northwind I built the Playwright suite." }], ask: ["How do you release?"], thanks: { subject: "Thank you", body: "Dear [Name], thank you." }, cost: "$0.003", balance: "$4.75" } });
    route.fulfill({ status: 200, json: await answer(page) });
  });
  await page.goto("/?lang=en");
  await page.evaluate(() => localStorage.removeItem("applications"));
  await fillForm(page);
  await page.locator("#tailor").click();
  await expect(page.locator("#apps")).toBeVisible();
  await expect(page.locator("#app-list li")).toHaveCount(1);
  await page.locator("#app-list select").selectOption("applied");
  await page.locator("#tab-interview").click();
  await page.locator("#prep").click();
  await expect(page.locator("#prep-out details.q")).toHaveCount(1);
  await expect(page.locator("#prep-out")).toContainText("How do you release?");
  await page.reload();
  await expect(page.locator("#app-list li")).toHaveCount(1);
  await expect(page.locator("#app-list select")).toHaveValue("applied");
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

test("accounts: signed out, Tailor asks to sign in with Face ID; signed in, the pill shows credits; out of credits opens the wallet", async ({ page }) => {
  let signedIn = false;
  await page.route(API, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/me") return route.fulfill({ status: 200, json: signedIn ? { signedIn: true, name: "Alex", credits: 2, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [{ id: "p10", credits: 10, eur: 4 }] } : { signedIn: false, start: 5, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [{ id: "p10", credits: 10, eur: 4 }] } });
    if (path === "/tailor") return route.fulfill({ status: 402, json: { error: "credit", credits: 2, price: 3 } });
    route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/?lang=en");
  await expect(page.locator("#acct")).toHaveText("Sign In");
  await fillForm(page);
  await page.locator("#tailor").click();
  await expect(page.locator("#sign-dialog")).toBeVisible();
  await expect(page.locator("#sign-lead")).toContainText("5 free credits");
  await expect(page.getByRole("button", { name: "Create My Account" })).toBeVisible();
  await page.locator("#sign-close").click();
  await expect(page.locator("#sign-dialog")).toBeHidden();
  signedIn = true; await page.reload();                                         // the draft comes back on step 4
  await expect(page.locator("#acct")).toHaveText("2 credits");
  await page.locator("#tailor").click();
  await expect(page.locator("#wallet")).toBeVisible();
  await expect(page.locator("#wallet-title")).toHaveText("Fill Your Wallet");
  await expect(page.locator("#wallet-need")).toHaveText("This needs 3 credits and you have 2.");
  await expect(page.locator("#packs")).toContainText("10 credits · €4");
});

// APP-DR-005: LinkedIn's Share can copy a sentence with the link inside; the link is picked out and read
test.describe("share text with a link inside", () => {
  const LINK = "https://www.linkedin.com/jobs/view/4486077010/", SHARE = `Check out this job at Five9: ${LINK}`;
  const toJob = async (page, asked) => {
    await page.route(API, (route) => { if (!route.request().url().endsWith("/job")) return route.fulfill({ status: 401, json: { error: "signin" } }); asked.push(route.request().postDataJSON().url); route.fulfill({ status: 200, json: { title: "Senior Quality Engineer", company: "Five9", text: "We need a QA automation engineer with Playwright and TypeScript. ".repeat(4) } }); });
    await page.goto("/?lang=en"); await page.locator("#paste-toggle").click(); await page.locator("#cv-text").fill(CV); await page.locator("#next").click();
  };
  const paste = (page, sel, text) => page.locator(sel).evaluate((el, t) => { const d = new DataTransfer(); d.setData("text", t); el.focus(); const e = new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }); if (el.dispatchEvent(e)) { el.value = t; el.dispatchEvent(new Event("input", { bubbles: true })); } }, text);
  test("in the link box: Read picks the link out and reads it, also when tapped twice", async ({ page }) => {
    const asked = []; await toJob(page, asked);
    await page.locator("#job-link").evaluate((el, t) => { el.value = t; }, SHARE);
    await page.locator("#read-link").dblclick();
    await expect(page.locator("#job")).toHaveValue(/^Senior Quality Engineer · Five9/);
    await expect(page.locator("#job-link")).toHaveValue(LINK);
    await expect(page.locator("#job-status")).toContainText("Read from linkedin.com");
    expect(new Set(asked)).toEqual(new Set([LINK]));
  });
  test("pasted into the link box or the empty ad box: the link is read by itself", async ({ page }) => {
    const asked = []; await toJob(page, asked);
    await paste(page, "#job-link", SHARE + ".");
    await expect(page.locator("#job")).toHaveValue(/^Senior Quality Engineer · Five9/); await expect(page.locator("#job-link")).toHaveValue(LINK);
    await page.locator("#job").fill(""); await page.locator("#job-link").fill("");
    await paste(page, "#job", SHARE);
    await expect(page.locator("#job-link")).toHaveValue(LINK); await expect(page.locator("#job")).toHaveValue(/^Senior Quality Engineer · Five9/);
    expect(new Set(asked)).toEqual(new Set([LINK]));
  });
  test("not a share: an ad's own text with links in it stays as text, and words without a link say so", async ({ page }) => {
    const asked = []; await toJob(page, asked);
    const ad = "We need a QA automation engineer with Playwright and TypeScript. ".repeat(4) + "Apply at https://example.com/apply or see https://example.com/about";
    await paste(page, "#job", ad);
    await expect(page.locator("#job")).toHaveValue(ad); await expect(page.locator("#job-link")).toHaveValue("");
    // text already in the ad box: a pasted share sentence is added as text, the ad is not thrown away
    await paste(page, "#job", "Check out this job: https://example.com/job/1");
    await expect(page.locator("#job-link")).toHaveValue("");
    await page.locator("#job-link").evaluate((el) => { el.value = "check out this job"; });
    await page.locator("#read-link").click();
    await expect(page.locator("#job-status")).toHaveClass(/bad/); await expect(page.locator("#job-status")).toContainText("doesn't look like a link");
    expect(asked).toEqual([]);
  });
});

// APP-DR-003 round 2: a new account needs an invite code; the owner makes invite links and manages accounts in People
test.describe("invite codes and People", () => {
  const ME_OUT = { signedIn: false, start: 5, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [] };
  const fakePasskey = (page) => page.addInitScript(() => {
    const buf = (n) => new Uint8Array(n).buffer;
    window.PublicKeyCredential = window.PublicKeyCredential || function () {};
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => ({ id: "cred", response: { clientDataJSON: buf(8), attestationObject: buf(8) } }), get: async () => ({ id: "cred", response: { clientDataJSON: buf(8), authenticatorData: buf(8), signature: buf(8) } }) } });
  });
  test("Create My Account asks for the code first; a wrong or used code says so; the right one makes the account once", async ({ page }) => {
    const asked = []; let created = 0;
    await fakePasskey(page);
    await page.route(API, async (route) => {
      const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON() || {};
      if (path === "/me") return route.fulfill({ status: 200, json: ME_OUT });
      if (path === "/account/options") { asked.push(body);
        if (body.mode !== "create") return route.fulfill({ status: 200, json: { challenge: "AAAA", rpId: "localhost", allowCredentials: [] } });
        if (body.invite === "WRONG") return route.fulfill({ status: 403, json: { error: "invite" } });
        if (body.invite === "USED-CODE") return route.fulfill({ status: 403, json: { error: "invite_used" } });
        await new Promise((r) => setTimeout(r, 300));
        return route.fulfill({ status: 200, json: { challenge: "AAAA", rp: { name: "draftdoivo", id: "localhost" }, user: { id: "AAAA", name: "Alex", displayName: "Alex" }, pubKeyCredParams: [] } }); }
      if (path === "/account/create") { created++; return route.fulfill({ status: 200, json: { signedIn: true, name: "Alex", credits: 5, prices: ME_OUT.prices, packs: [] } }); }
      route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/?lang=en"); await ready(page); await page.locator("#acct").click();
    await expect(page.locator("#sign-lead")).toContainText("needs an invite code");
    const create = page.getByRole("button", { name: "Create My Account" }), err = page.locator("#sign-err");
    await create.click();
    await expect(err).toContainText("Enter your invite code"); expect(asked).toEqual([]); await expect(page.locator("#sign-invite")).toBeFocused();
    await page.locator("#sign-invite").fill("WRONG"); await create.click(); await expect(err).toContainText("isn't right");
    await page.locator("#sign-invite").fill("USED-CODE"); await create.click(); await expect(err).toContainText("already used");
    await expect(page.locator("#sign-dialog")).toBeVisible(); expect(created).toBe(0);
    await page.locator("#sign-invite").fill("abcd-efgh"); await create.dblclick();
    await expect(page.locator("#sign-dialog")).toBeHidden(); await expect(page.locator("#acct")).toHaveText("5 credits");
    expect(created, "a double tap makes one account").toBe(1); expect(asked.filter((b) => b.invite === "abcd-efgh").length).toBe(1);
  });
  test("Sign In needs no code; an invite link opens the window on New Account with the code filled in", async ({ page }) => {
    const asked = [];
    await fakePasskey(page);
    await page.route(API, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/me") return route.fulfill({ status: 200, json: ME_OUT });
      if (path === "/account/options") { asked.push(route.request().postDataJSON()); return route.fulfill({ status: 200, json: { challenge: "AAAA", rpId: "localhost", allowCredentials: [] } }); }
      if (path === "/account/signin") return route.fulfill({ status: 200, json: { signedIn: true, name: "Alex", credits: 4, prices: ME_OUT.prices, packs: [] } });
      route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/?lang=en&invite=ABCD-EFGH%3Cscript%3E");
    await expect(page.locator("#sign-dialog")).toBeVisible(); await expect(page.locator("#sign-invite")).toHaveValue("ABCD-EFGHscript");
    await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true");
    await page.locator("#sign-invite").fill("");
    await page.getByRole("tab", { name: "Sign In" }).click(); await expect(page.locator("#pane-new")).toBeHidden();
    await page.getByRole("button", { name: "Sign In With Face ID / Touch ID" }).click();
    await expect(page.locator("#acct")).toHaveText("4 credits"); expect(asked).toEqual([{ mode: "signin", name: "" }]);
    // already signed in: an invite link doesn't ask to sign in again
    await page.unroute(API); await page.route(API, (route) => route.fulfill({ status: 200, json: { ...ME_OWNER, owner: false, credits: 4 } }));
    await page.goto("/?lang=en&invite=ABCDEFGH"); await ready(page); await page.waitForTimeout(400);
    await expect(page.locator("#sign-dialog")).toBeHidden();
  });
  test("People: only on the owner's device; New Invite Link, Copy Link, and Remove that asks twice", async ({ page, browserName }, info) => {
    let invites = [{ code: "USEDCODE", created: "2026-11-10T10:00:00Z", usedBy: "u1", usedName: "Alex", usedAt: "2026-11-10T11:00:00Z" }], users = [{ id: "u1", name: "Alex", created: "2026-11-10T11:00:00Z", credits: 2 }, { id: "u2", name: "Test Account", created: "2026-11-11T09:00:00Z", credits: 1 }];
    const calls = []; let fail = 0, me = { ...ME_OWNER, owner: false, credits: 2 };
    await page.route(API, async (route) => {
      const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON() || {};
      if (path === "/me") return route.fulfill({ status: 200, json: me });
      if (!path.startsWith("/admin/")) return route.fulfill({ status: 404, json: {} });
      calls.push(path);
      if (!me.owner || route.request().headers()["x-passcode"]) return route.fulfill({ status: 401, json: { error: "passcode" } });   // the owner's session, never a passcode
      if (fail) { fail--; return route.fulfill({ status: 500, json: {} }); }
      if (path === "/admin/invite") { await new Promise((r) => setTimeout(r, 250)); invites = [{ code: "NEWC" + (2000 + invites.length), created: new Date().toISOString() }, ...invites]; }
      if (path === "/admin/invite/delete") invites = invites.filter((i) => i.code !== body.code);
      if (path === "/admin/user/delete") users = users.filter((u) => u.id !== body.id);
      route.fulfill({ status: 200, json: { users, invites } });
    });
    await page.goto("/?lang=en"); await ready(page); await expect(page.locator("#acct")).toHaveText("2 credits");
    await expect(page.locator("#people-btn")).toBeHidden(); await expect(page.locator("#model-row")).toBeHidden();   // an invited account: no People, no model picker
    me = ME_OWNER; await page.reload(); await ready(page); await expect(page.locator("#acct")).toHaveText("Unlimited");
    await page.locator("#people-btn").click(); await expect(page.locator("#people")).toBeVisible();
    await expect(page.locator("#pp-invites li")).toHaveText([/USED-CODE.*Used by Alex · 10 Nov 2026/]); await expect(page.locator("#pp-invites .pp-copy")).toHaveCount(0);
    await expect(page.locator("#pp-users li")).toHaveText([/Alex.*2 credits · since 10 Nov 2026/, /Test Account.*1 credit · since 11 Nov 2026/]);
    // New Invite Link, double tapped: one new code
    await page.locator("#pp-new").dblclick(); await expect(page.locator("#pp-invites li")).toHaveCount(2);
    expect(calls.filter((c) => c === "/admin/invite").length).toBe(1);
    await expect(page.locator("#pp-invites li").first()).toContainText("NEWC-2001"); await expect(page.locator("#pp-invites li").first()).toContainText("Not used yet");
    if (browserName === "chromium") await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#pp-invites .pp-copy").click();
    await expect(page.locator("#pp-invites li").first().locator(".pp-copy, .pp-link")).toHaveCount(1);   // Copied, or the link shown to copy by hand
    // Remove: a double tap only arms it; a second tap removes
    const rm = page.locator("#pp-users li", { hasText: "Test Account" }).locator(".pp-remove");
    await rm.dblclick(); await expect(rm).toHaveText("Tap Again to Remove"); expect(calls.filter((c) => c === "/admin/user/delete").length).toBe(0);
    // a failed save: the message shows and the account stays
    fail = 1; await page.waitForTimeout(600); await rm.click();
    await expect(page.locator("#pp-err")).toHaveText("That didn't work. Try again."); await expect(page.locator("#pp-users li")).toHaveCount(2);
    await rm.click(); await page.waitForTimeout(600); await page.locator("#pp-users li", { hasText: "Test Account" }).locator(".pp-remove").click();
    await expect(page.locator("#pp-users li")).toHaveCount(1); await expect(page.locator("#pp-err")).toBeHidden();
    // 44px taps, nothing sideways, no accessibility problems in the window
    const small = await page.locator("#people button").evaluateAll((n) => n.map((b) => b.getBoundingClientRect()).filter((r) => r.height < 43.5 || r.width < 43.5).length); expect(small).toBe(0);
    expect(await page.evaluate(() => { const d = document.getElementById("people"); return d.scrollWidth <= d.clientWidth + 1; })).toBe(true);
    const axe = await new AxeBuilder({ page }).include("#people").analyze(); expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id)).toEqual([]);
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/people-" + info.project.name + ".png" });
    await page.locator("#people-close").click(); await expect(page.locator("#people")).toBeHidden();
    // the owner's own row: marked, with no Remove
    users = [{ id: "u0", name: "Ivo", created: "2026-11-09T09:00:00Z", credits: 0, owner: true }, ...users]; await page.locator("#people-btn").click();
    const mine = page.locator("#pp-users li", { hasText: "Ivo" }); await expect(mine).toContainText("Owner · unlimited"); await expect(mine.locator(".pp-remove")).toHaveCount(0);
  });
});

// APP-DR-003 round 3: the sign-in window is two clear tabs; every window shares one head, one field style, one rhythm
test.describe("the windows: sign in, wallet and People", () => {
  const ME = (signedIn) => ({ signedIn, name: "Alex", credits: 2, start: 5, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [{ id: "p10", credits: 10, eur: 4 }, { id: "p25", credits: 25, eur: 9 }, { id: "p60", credits: 60, eur: 19 }] });
  const serve = (page, signedIn, signin = 200, owner = false) => page.route(API, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/me") return route.fulfill({ status: 200, json: { ...ME(signedIn), owner } });
    if (path === "/account/owner") return route.fulfill(route.request().headers()["x-passcode"] === "right" ? { status: 200, json: { ...ME(true), owner: true } } : { status: 401, json: { error: "passcode" } });
    if (path === "/account/options") return route.fulfill({ status: 200, json: { challenge: "AAAA", rpId: "localhost", allowCredentials: [] } });
    if (path === "/account/signin") return route.fulfill(signin === 200 ? { status: 200, json: ME(true) } : { status: 401, json: { error: "passkey_wrong" } });
    if (path.startsWith("/admin/")) return route.fulfill({ status: 200, json: { users: [{ id: "u1", name: "A Very Long First Name That Goes On And On", created: "2026-11-10T11:00:00Z", credits: 12 }], invites: [{ code: "ABCDEFGH", created: "2026-11-10T10:00:00Z" }, { code: "USEDCODE", created: "2026-11-09T10:00:00Z", usedBy: "u1", usedName: "A Very Long First Name That Goes On And On", usedAt: "2026-11-10T11:00:00Z" }] } });
    route.fulfill({ status: 404, json: {} });
  });
  const fakePasskey = (page) => page.addInitScript(() => { const buf = (n) => new Uint8Array(n).buffer; window.PublicKeyCredential = window.PublicKeyCredential || function () {};
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => ({ id: "c", response: { clientDataJSON: buf(8), attestationObject: buf(8) } }), get: async () => ({ id: "c", response: { clientDataJSON: buf(8), authenticatorData: buf(8), signature: buf(8) } }) } }); });
  // what a tidy window means, measured: nothing cut or sideways, 44px taps, one field style, even gaps to the edges, no accessibility problems
  const tidy = async (page, id) => {
    const q = await page.locator("#" + id).evaluate((d) => {
      const box = d.getBoundingClientRect(), seen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const taps = [...d.querySelectorAll("button, summary, input, a[href]")].filter(seen).map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height), out: r.left < box.left - 0.5 || r.right > box.right + 0.5 }; });
      const fields = [...d.querySelectorAll("input")].filter(seen).map((e) => { const s = getComputedStyle(e); return [Math.round(e.getBoundingClientRect().height), s.backgroundColor, s.borderRadius, s.borderColor].join("|"); });
      const kids = [...d.querySelectorAll(".btn, .field input, .seg2, .hint")].filter(seen).map((e) => Math.round(e.getBoundingClientRect().left - box.left));
      return { small: taps.filter((t) => t.h < 43.5 || t.w < 43.5).map((t) => `${t.n} ${t.w}x${t.h}`), out: taps.filter((t) => t.out).map((t) => t.n), fields: [...new Set(fields)].length, lefts: [...new Set(kids)], sideways: d.scrollWidth > d.clientWidth + 1, fits: box.bottom <= innerHeight + 0.5 && box.top >= -0.5 && box.left >= 0 && box.right <= innerWidth + 0.5 };
    });
    expect.soft(q.small, id + ": taps are at least 44px").toEqual([]); expect.soft(q.out, id + ": nothing pokes out").toEqual([]);
    expect.soft(q.fields, id + ": every field looks the same").toBeLessThanOrEqual(1); expect.soft(q.sideways, id + ": no sideways scroll").toBe(false); expect.soft(q.fits, id + ": fits the screen").toBe(true);
    const a = await new AxeBuilder({ page }).include("#" + id).analyze(); expect.soft(a.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id), id + ": accessibility").toEqual([]);
  };
  for (const scheme of ["light", "dark"]) for (const lang of ["en", "pt"]) test(`every window is tidy (${scheme}, ${lang})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme }); await serve(page, false); await page.goto("/?lang=" + lang);
    const shot = async (name) => { if (process.env.SHOTS && lang === "en") await page.screenshot({ path: `${process.env.SHOTS}/win-${name}-${scheme}-${info.project.name}.png` }); };
    await ready(page); await page.locator("#acct").click(); await expect(page.locator("#pane-new")).toBeVisible(); await tidy(page, "sign-dialog"); await shot("new");
    await page.locator("#sign-create").click(); await expect(page.locator("#sign-err")).toBeVisible(); await tidy(page, "sign-dialog");      // with the error showing
    await page.locator("#tab-in").click(); await expect(page.locator("#sign-err")).toBeHidden(); await tidy(page, "sign-dialog"); await shot("in");
    await expect(page.locator("#sign-dialog input[type=password]")).toHaveCount(0);                                 // no owner passcode in the sign-in window
    await page.locator("#sign-close").click(); await expect(page.locator("#sign-dialog")).toBeHidden();
    await page.unroute(API); await serve(page, true, 200, true); await page.reload();
    await ready(page); await page.locator("#acct").click(); await expect(page.locator("#wallet-left")).toContainText(lang === "en" ? "Unlimited" : "Ilimitado"); await tidy(page, "wallet"); await shot("wallet-owner"); await page.locator("#wallet-close").click();
    await page.locator("#people-btn").click(); await expect(page.locator("#pp-users li")).toHaveCount(1); await tidy(page, "people"); await shot("people");
    await page.locator("#people-close").click(); await expect(page.locator("#people")).toBeHidden();
    await page.unroute(API); await serve(page, true); await page.reload();
    await ready(page); await page.locator("#acct").click(); await expect(page.locator("#wallet")).toBeVisible(); await tidy(page, "wallet"); await shot("wallet");
    await page.locator("#wallet-close").click(); await expect(page.locator("#wallet")).toBeHidden();
  });
  test("tabs: a new device opens on New Account, a device that signed in before opens on Sign In; arrows and Escape work", async ({ page }) => {
    await fakePasskey(page); await serve(page, false); await page.goto("/?lang=en");
    await ready(page); await page.locator("#acct").click();
    await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true"); await expect(page.locator("#pane-in")).toBeHidden();
    await expect(page.locator("#sign-lead")).toContainText("invite code"); await expect(page.locator("#sign-lead")).toContainText("5 free credits");
    await page.locator("#tab-new").focus(); await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#tab-in")).toHaveAttribute("aria-selected", "true"); await expect(page.locator("#tab-in")).toBeFocused(); await expect(page.locator("#pane-new")).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign In With Face ID / Touch ID" })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.locator("#sign-dialog")).toBeHidden();
    // sign in once: from then on this device opens on Sign In
    await ready(page); await page.locator("#acct").click(); await page.locator("#tab-in").click(); await page.locator("#sign-have").dblclick();
    await expect(page.locator("#sign-dialog")).toBeHidden(); await expect(page.locator("#acct")).toHaveText("2 credits");
    await page.unroute(API); await serve(page, false); await page.reload(); await ready(page); await page.locator("#acct").click();
    await expect(page.locator("#tab-in")).toHaveAttribute("aria-selected", "true"); await expect(page.locator("#pane-new")).toBeHidden();
  });
  test("mistakes: a passkey with no account says where to go; Enter in the code field creates; switching tabs clears the message", async ({ page }) => {
    const asked = [];
    await fakePasskey(page); await serve(page, false, 401); await page.goto("/?lang=en");
    page.on("request", (r) => { if (r.url().endsWith("/account/options")) asked.push(r.postDataJSON()); });
    await ready(page); await page.locator("#acct").click(); await page.locator("#tab-in").click(); await page.locator("#sign-have").click();
    await expect(page.locator("#sign-err")).toContainText("No account was found"); await expect(page.locator("#sign-dialog")).toBeVisible();
    await expect(page.locator("#sign-have")).toBeEnabled();
    await page.locator("#tab-new").click(); await expect(page.locator("#sign-err")).toBeHidden();
    await page.locator("#sign-invite").press("Enter"); await expect(page.locator("#sign-err")).toContainText("Enter your invite code");
    expect(asked.filter((b) => b.mode === "create")).toEqual([]);
    await page.locator("#sign-name").fill("Alex"); await page.locator("#sign-invite").fill("abcd-efgh"); await page.locator("#sign-invite").press("Enter");
    await expect.poll(() => asked.filter((b) => b.mode === "create")).toEqual([{ mode: "create", name: "Alex", invite: "abcd-efgh" }]);
  });
  test("the owner's account: made once at /?owner with the passcode (wrong one says so), then People and Unlimited with no passcode kept", async ({ page }) => {
    await serve(page, true); await page.goto("/?lang=en"); await ready(page);
    await page.locator("#acct").click(); await expect(page.locator("#wallet")).toBeVisible(); await expect(page.locator("#claim")).toBeHidden();   // never offered on the plain address
    await page.locator("#wallet-close").click();
    await page.goto("/?lang=en&owner"); await ready(page); await expect(page.locator("#wallet")).toBeVisible(); await expect(page.locator("#claim")).toBeVisible();
    await page.locator("#pass").fill("wrong"); await page.locator("#pass-ok").click();
    await expect(page.locator("#pass-err")).toBeVisible(); await expect(page.locator("#people-btn")).toBeHidden();
    await page.locator("#pass").fill("right"); await page.locator("#pass-ok").dblclick();
    await expect(page.locator("#claim")).toBeHidden(); await expect(page.locator("#wallet-left")).toContainText("Unlimited");
    await page.locator("#wallet-close").click(); await expect(page.locator("#acct")).toHaveText("Unlimited"); await expect(page.locator("#people-btn")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("pass") || "")).toBe("");
  });
  test("a device that still holds the old passcode: signing in makes that account the owner's by itself, and the passcode is forgotten", async ({ page }) => {
    await serve(page, true); await page.goto("/?lang=en"); await ready(page);
    await page.evaluate(() => localStorage.setItem("pass", "right")); await page.reload(); await ready(page);
    await expect(page.locator("#acct")).toHaveText("Unlimited"); await expect(page.locator("#people-btn")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("pass") || "")).toBe("");
    // an old passcode that is wrong is forgotten too, and nothing else changes
    await page.evaluate(() => localStorage.setItem("pass", "stale")); await page.reload(); await ready(page);
    await expect(page.locator("#acct")).toHaveText("2 credits"); await expect(page.locator("#people-btn")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("pass") || "")).toBe("");
  });
});

// APP-DR-003 round 3: the whole app reviewed the same way, step by step: nothing sideways, 44px taps, readable, in light and dark
test.describe("every screen of the app is tidy", () => {
  const sweep = async (page, where) => {
    const q = await page.evaluate(() => {
      const seen = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !e.closest("[hidden], dialog:not([open]), .paper, .sr"); };
      const out = { small: [], wide: [] };
      for (const e of document.querySelectorAll("button, a[href], summary, select, input:not([type=hidden]):not([type=file]), textarea, [role=button], [role=tab], [role=radio]")) {
        if (!seen(e) || e.closest("p, li") && e.tagName === "A") continue;                       // a link inside a sentence is text
        const t = e.matches("input[type=checkbox], input[type=radio]") && e.closest("label") ? e.closest("label") : e, r = t.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) out.small.push(`${e.id ? "#" + e.id : e.className || e.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (const e of document.querySelectorAll("body *")) { if (!seen(e)) continue; const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 && !e.closest(".bg, .tabs, .steps")) out.wide.push(e.id ? "#" + e.id : String(e.className).slice(0, 30) || e.tagName); }
      out.scroll = document.documentElement.scrollWidth - innerWidth;
      return out;
    });
    expect.soft([...new Set(q.small)], where + ": taps are at least 44px").toEqual([]);
    expect.soft([...new Set(q.wide)].slice(0, 6), where + ": nothing sticks out sideways").toEqual([]);
    expect.soft(q.scroll, where + ": no sideways scroll").toBeLessThanOrEqual(0);
    const a = await new AxeBuilder({ page }).exclude(".paper").analyze();
    expect.soft(a.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ").slice(0, 120)}`), where + ": accessibility").toEqual([]);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/app-${where.replace(/\W+/g, "-")}-${test.info().project.name}.png`, fullPage: true });
  };
  for (const scheme of ["light", "dark"]) test(`steps 1 to 4, the review, the result and its tabs (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.route(API, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/me") return route.fulfill({ status: 200, json: ME_OWNER });
      if (path === "/review") return route.fulfill({ status: 200, json: REVIEW });
      if (path === "/interview") return route.fulfill({ status: 200, json: { questions: [{ question: "Tell us about your test automation.", why: "The role is about Playwright.", answer: "At Northwind I built the Playwright suite." }], ask: ["How do you release?"], thanks: { subject: "Thank you", body: "Dear [Name], thank you." }, cost: "$0.003", balance: "$4.75" } });
      route.fulfill({ status: 200, json: await answer(page) });
    });
    await page.goto("/?lang=en"); await ready(page); await page.evaluate(() => { localStorage.removeItem("applications"); }); await page.reload(); await ready(page);
    await sweep(page, `step 1 ${scheme}`);
    await page.locator("#paste-toggle").click(); await page.locator("#cv-text").fill(CV); await sweep(page, `step 1 filled ${scheme}`);
    await page.locator("#next").click(); await sweep(page, `step 2 ${scheme}`);
    await page.locator("#job").fill("We need a QA automation engineer with Playwright and TypeScript. ".repeat(4)); await page.locator("#next").click(); await sweep(page, `step 3 ${scheme}`);
    await page.locator("#skip").click(); await sweep(page, `step 4 ${scheme}`);
    const check = page.locator("#review-go, #check, [data-w='reviewGo']").first();
    if (await check.isVisible().catch(() => false)) { await check.click(); await page.waitForTimeout(600); await sweep(page, `review ${scheme}`); }
    await page.locator("#tailor").click(); await expect(page.locator("#result")).toBeVisible(); await page.waitForTimeout(500); await sweep(page, `result ${scheme}`);
    for (const tab of await page.locator("#result [role=tab]").all()) { if (!(await tab.isVisible())) continue; await tab.click(); await page.waitForTimeout(250); await sweep(page, `result ${await tab.getAttribute("id")} ${scheme}`); }
  });
});
