// Job: a CV (and cover letter) tailored to one job ad, built to pass applicant tracking systems.
// The AI writes the content (worker/, behind a passcode and a monthly cap); everything
// else, reading the upload, the PDF and Word files, the check, runs here in the browser.
import { WORDS } from "./words.js";
import { COLOURS, SAMPLE, fileName } from "./lib/cv.js";
import { cvPdf, letterPdf } from "./lib/pdf.js";
import { cvDocx, letterDocx } from "./lib/docx.js";
import { readUpload, checkCv } from "./lib/ats.js";
import { cvHtml, letterHtml } from "./lib/preview.js";

const API = "https://job-api.appdoivo.com";
// Approximate cost of one CV + cover letter per model (USD), for the picker
const MODELS = { haiku: "$0.003", sonnet: "$0.05", opus: "$0.10" };
const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

let lang = new URLSearchParams(location.search).get("lang") || store.get("lang") || ((navigator.language || "").toLowerCase().startsWith("pt") ? "pt" : "en");
if (!WORDS[lang]) lang = "en";
let w = WORDS[lang];
let colour = store.get("colour") || "blue";
let cvText = "", cvFile = "";
let result = null;                                       // { cv, letter, notes, sample, cost… }

// ---- words ----
function fill() {
  w = WORDS[lang];
  document.documentElement.lang = lang;
  document.title = w.title;
  document.querySelectorAll("[data-w]").forEach((el) => (el.textContent = w[el.dataset.w]));
  $("job").placeholder = w.jobPh; $("company").placeholder = w.companyPh; $("cv-text").placeholder = w.cvPaste;
  $("lang").textContent = w.other; $("lang").setAttribute("aria-label", `${w.other}: ${w.otherLabel}`);
  $("swatches").innerHTML = Object.keys(COLOURS).map((k) => `<button type="button" role="radio" class="swatch" data-c="${k}" aria-checked="${k === colour}" style="--sw:${COLOURS[k].hex}"><span>${w.colours[k]}</span></button>`).join("");
  const m = $("model").value || store.get("model") || "sonnet";
  $("model").innerHTML = Object.keys(MODELS).map((k) => `<option value="${k}">${w.models[k]} (${w.about.replace("{c}", MODELS[k])})</option>`).join("");
  $("model").value = m;
  if (cvText && cvFile) status("cv-status", w.readOk.replace("{n}", words(cvText)).replace("{f}", cvFile));
  paintTheme();
  if (result) show(result);
}
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const status = (id, text, bad = false) => { const el = $(id); el.textContent = text; el.classList.toggle("bad", bad); };

// ---- theme: the device decides until a choice is made here ----
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function paintTheme() { const m = $("mode"), d = isDark(); m.setAttribute("aria-label", d ? w.toLight : w.toDark); m.title = d ? w.toLight : w.toDark; m.classList.toggle("is-dark", d); }
$("mode").addEventListener("click", () => { const n = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = n; store.set("theme", n); paintTheme(); });
$("lang").addEventListener("click", () => { lang = lang === "pt" ? "en" : "pt"; store.set("lang", lang); fill(); });

// ---- step 1: the CV, uploaded, dropped or pasted ----
async function take(file) {
  try {
    cvText = (await readUpload(file)).trim(); cvFile = file.name;
    if (words(cvText) < 40) throw new Error("empty");
    status("cv-status", w.readOk.replace("{n}", words(cvText)).replace("{f}", file.name));
    check(); open(2);                                                        // a file that reads well moves straight on
  } catch (_) { cvText = ""; status("cv-status", w.readFail, true); check(); }
}
$("cv-file").addEventListener("change", (e) => e.target.files[0] && take(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && take(e.dataTransfer.files[0]));
$("paste-toggle").addEventListener("click", () => {
  const t = $("cv-text"); t.hidden = !t.hidden; $("paste-toggle").setAttribute("aria-expanded", String(!t.hidden));
  if (!t.hidden) t.focus();
});
$("cv-text").addEventListener("input", (e) => { cvText = e.target.value.trim(); cvFile = ""; });

// ---- steps: each appears once the one before it is done ----
const step = (n) => document.querySelector(`.step[data-step="${n}"]`);
const ready = { 1: () => words(cvText) >= 40, 2: () => $("job").value.trim().length >= 80, 3: () => $("company").value.trim().length >= 40 };
function check() { for (const n of [1, 2, 3]) document.querySelector(`[data-next="${n}"]:not([data-skip])`).disabled = !ready[n](); }
function open(n) {
  const el = step(n); if (!el || !el.hidden) return;
  el.hidden = false; step(n - 1)?.classList.add("done");
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.querySelector("textarea, select")?.focus({ preventScroll: true });
}
document.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => {
  const n = +b.dataset.next;
  if (b.hasAttribute("data-skip")) $("company").value = "";
  open(n + 1);
}));
["job", "company", "cv-text"].forEach((id) => $(id).addEventListener("input", check));

// ---- options ----
$("swatches").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]"); if (!b) return;
  colour = b.dataset.c; store.set("colour", colour);
  document.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s.dataset.c === colour)));
  if (result) show(result);
});
$("swatches").addEventListener("keydown", (e) => {                     // arrow keys move through the colours, like any radio group
  if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
  e.preventDefault();
  const keys = Object.keys(COLOURS), i = keys.indexOf(colour), n = keys[(i + (/Right|Down/.test(e.key) ? 1 : keys.length - 1)) % keys.length];
  document.querySelector(`.swatch[data-c="${n}"]`).click(); document.querySelector(`.swatch[data-c="${n}"]`).focus();
});
$("model").addEventListener("change", (e) => store.set("model", e.target.value));

// ---- tailoring ----
function askPass() {
  return new Promise((resolve) => {
    const d = $("pass-dialog");
    d.addEventListener("close", () => resolve(d.returnValue === "ok" ? $("pass").value : null), { once: true });
    d.returnValue = ""; $("pass").value = "";
    d.showModal();
  });
}
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!cvText) return status("status", w.needCv, true);
  const job = $("job").value.trim(); if (!job) { $("job").focus(); return status("status", w.needJob, true); }
  let pass = store.get("pass") || await askPass();
  if (!pass) return;
  $("tailor").disabled = true; status("status", w.working);
  try {
    const res = await fetch(`${API}/tailor`, { method: "POST", headers: { "content-type": "application/json", "x-passcode": pass },
      body: JSON.stringify({ cv: cvText, job, company: $("company").value.trim(), model: $("model").value, ui: lang }) });
    if (res.status === 401) { store.set("pass", ""); $("pass-err").hidden = false; return status("status", w.passWrong, true); }
    if (res.status === 402) return status("status", w.capped, true);
    if (!res.ok) throw new Error(String(res.status));
    store.set("pass", pass); $("pass-err").hidden = true;
    const data = await res.json();
    result = { ...data, job, sample: false };
    status("status", "");
    await show(result);
  } catch (err) {
    status("status", err instanceof TypeError ? w.offline : w.failed, true);       // TypeError: the AI service cannot be reached
  } finally { $("tailor").disabled = false; }
});
$("example").addEventListener("click", async () => {
  result = { cv: SAMPLE.cv, letter: SAMPLE.letter, keywords: SAMPLE.keywords, job: SAMPLE.job, sample: true,
    notes: { changes: ["Moved Playwright, TypeScript and CI/CD to the top of the summary, where the ad asks for them first.", "Reworded the API bullet to say REST API testing, the ad's own term."],
      gaps: ["The ad mentions accessibility and performance testing. They are not in the CV: add them only if they are true."] } };
  status("status", "");
  await show(result);
});

// ---- showing the result: preview, downloads, the ATS check ----
const files = {};
async function show(r) {
  const box = $("result"); box.hidden = false;
  $("result-note").textContent = r.sample ? w.sample : r.cached ? w.cached : r.cost ? w.cost.replace("{c}", r.cost).replace("{m}", r.month).replace("{cap}", r.cap) : "";
  $("cv-preview").innerHTML = cvHtml(r.cv, colour);
  $("tab-letter").hidden = !r.letter;
  if (r.letter) $("letter-preview").innerHTML = letterHtml(r.letter, colour);
  else selectTab("cv");
  files["cv-pdf"] = { bytes: await cvPdf(r.cv, colour), name: fileName(r.cv.name, "CV", "pdf"), type: "application/pdf" };
  files["cv-docx"] = { blob: () => cvDocx(r.cv, colour), name: fileName(r.cv.name, "CV", "docx") };
  if (r.letter) {
    files["letter-pdf"] = { bytes: await letterPdf(r.letter, colour), name: fileName(r.letter.name, "Cover-Letter", "pdf"), type: "application/pdf" };
    files["letter-docx"] = { blob: () => letterDocx(r.letter, colour), name: fileName(r.letter.name, "Cover-Letter", "docx") };
  }
  const a = await checkCv(files["cv-pdf"].bytes, r.cv, r.job, files["cv-pdf"].name, r.letter?.company || "", r.keywords);
  $("checks").innerHTML = a.checks.map((c) => `<li class="${c.ok ? (c.warn ? "warn" : "ok") : "bad"}"><span class="mark" aria-hidden="true">${c.ok ? (c.warn ? "!" : "✓") : "✗"}</span>${w.checks[c.id].replace("{d}", c.detail)}</li>`).join("");
  const chip = (k) => `<span class="chip">${k.replace(/[&<>]/g, "")}</span>`;
  $("kw-found").innerHTML = a.found.map(chip).join("") || "—";
  $("kw-missing").innerHTML = a.missing.map(chip).join("") || "—";
  const n = r.notes || {}, list = (h, items) => (items?.length ? `<h3>${h}</h3><ul>${items.map((t) => `<li>${t.replace(/[&<>]/g, "")}</li>`).join("")}</ul>` : "");
  $("notes").innerHTML = list(w.changes, n.changes) + list(w.gaps, n.gaps);
  box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function selectTab(which) {
  for (const t of ["cv", "letter"]) { $(`tab-${t}`).setAttribute("aria-selected", String(t === which)); $(`panel-${t}`).hidden = t !== which; }
}
$("tab-cv").addEventListener("click", () => selectTab("cv"));
$("tab-letter").addEventListener("click", () => selectTab("letter"));
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = $("tab-cv").getAttribute("aria-selected") === "true" && !$("tab-letter").hidden ? "letter" : "cv";
  selectTab(next); $(`tab-${next}`).focus();
});
document.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", async () => {
  const f = files[b.dataset.dl]; if (!f) return;
  const blob = f.bytes ? new Blob([f.bytes], { type: f.type }) : await f.blob();
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: f.name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}));

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);
fill(); check();
