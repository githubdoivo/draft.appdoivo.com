// Job: a CV (and cover letter) tailored to one job ad, built to pass applicant tracking systems.
// The AI writes the content (worker/, behind a passcode and a monthly cap); everything
// else, reading the upload, the PDF and Word files, the check, runs here in the browser.
import { WORDS } from "./words.js";
import { COLOURS, SAMPLE, fileName } from "./lib/cv.js";
import { cvPdf, letterPdf } from "./lib/pdf.js";
import { cvDocx, letterDocx } from "./lib/docx.js";
import { readUpload, checkCv, keywords } from "./lib/ats.js";
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
  if (typeof at !== "undefined") { $("step-count").textContent = w.stepOf.replace("{n}", at); readCv(); readJob(); readCompany(); if (at === 4) summary(); refresh(); }
  if (result) show(result);
}
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const status = (id, text, bad = false) => { const el = $(id); el.textContent = text; el.classList.toggle("bad", bad); };

// ---- theme: the device decides until a choice is made here ----
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function paintTheme() { const m = $("mode"), d = isDark(); m.setAttribute("aria-label", d ? w.toLight : w.toDark); m.title = d ? w.toLight : w.toDark; m.classList.toggle("is-dark", d); }
$("mode").addEventListener("click", () => { const n = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = n; store.set("theme", n); paintTheme(); });
$("lang").addEventListener("click", () => { lang = lang === "pt" ? "en" : "pt"; store.set("lang", lang); fill(); });

// ---- the machine: one step at a time ----
// Limits match what the AI service accepts; minimums make sure there is enough to work with
const LIMIT = { "cv-text": 30000, job: 20000, company: 10000 }, MIN = { cv: 200, job: 80 };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chips = (list) => list.map((k) => `<span class="chip">${esc(k)}</span>`).join("");
let at = 1;
const panel = (n) => document.querySelector(`.machine .panel[data-step="${n}"]`);
const valid = {
  1: () => cvText.length >= MIN.cv && words(cvText) >= 40,
  2: () => $("job").value.trim().length >= MIN.job,
  3: () => true,
};
function go(n) {
  at = n; saveDraft();
  document.querySelectorAll(".machine .panel").forEach((p) => (p.hidden = +p.dataset.step !== n));
  document.querySelectorAll("#track li").forEach((li) => { const k = +li.dataset.for; li.classList.toggle("done", k < n); li.classList.toggle("now", k === n); });
  $("step-count").textContent = w.stepOf.replace("{n}", n);
  $("back").hidden = n === 1;
  $("skip").hidden = n !== 3 || $("company").value.trim().length > 0;
  $("next").hidden = n === 4; $("tailor").hidden = n !== 4;
  if (n === 4) summary();
  refresh();
  panel(n).querySelector(".m-title").focus({ preventScroll: true });
  const box = $("form").getBoundingClientRect();
  if (box.top < 0 || box.top > innerHeight * .4) $("form").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function refresh() {
  $("next").disabled = !valid[at]?.();
  if (at === 3) $("skip").hidden = $("company").value.trim().length > 0;
  for (const [id, max] of Object.entries(LIMIT)) {
    const n = $(id).value.length, el = document.querySelector(`[data-count="${id}"]`);
    el.textContent = w.chars.replace("{n}", n.toLocaleString(lang === "pt" ? "pt-PT" : "en-GB")).replace("{max}", max.toLocaleString(lang === "pt" ? "pt-PT" : "en-GB"));
    el.classList.toggle("near", n > max * .9);
  }
  status("status", "");
}
$("next").addEventListener("click", () => {
  if (!valid[at]()) return status("status", w.tooShort.replace("{n}", at === 1 ? MIN.cv : MIN.job), true);
  go(at + 1);
});
$("back").addEventListener("click", () => go(at - 1));
$("skip").addEventListener("click", () => { $("company").value = ""; readCompany(); go(4); });
// Enter in the step's text box does not submit; Ctrl/Cmd+Enter moves on
$("form").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && at < 4) { e.preventDefault(); $("next").click(); } });

// What the machine understood, shown under each input
function readCv() {
  if (!cvText) return ($("read-cv").innerHTML = "");
  const name = cvText.split(/\n/).map((l) => l.trim()).find((l) => /^[A-Za-zÀ-ÿ' .-]{4,40}$/.test(l) && l.split(" ").length <= 5) || "";
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.test(cvText), phone = /\+?\d[\d\s().-]{7,}\d/.test(cvText);
  const roles = (cvText.match(/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present|current|now|atual|presente)/gi) || []).length;
  const items = [name && esc(name), w.sumWords.replace("{n}", words(cvText)), email ? "✓ Email" : w.noEmail, phone ? "✓ Tel." : w.noPhone, roles ? w.roles.replace("{n}", roles) : ""].filter(Boolean);
  $("read-cv").innerHTML = `<h3>${esc(w.readCv)}</h3><p class="chips">${items.map((t) => `<span class="chip">${t}</span>`).join("")}</p>`;
}
let jt;
function readJob() {
  const t = $("job").value.trim();
  if (t.length < MIN.job) return ($("read-job").innerHTML = "");
  const title = t.split(/\n|\. /)[0].slice(0, 80);
  $("read-job").innerHTML = `<h3>${esc(w.readJob)}</h3><p class="lead">${esc(w.jobTitle)}: <b>${esc(title)}</b></p><p class="chips">${chips(keywords(t, 12))}</p>`;
}
function readCompany() {
  const t = $("company").value.trim();
  if (t.length < 40) return ($("read-company").innerHTML = "");
  $("read-company").innerHTML = `<h3>${esc(w.readCompany)}</h3><p class="chips">${chips(keywords(t, 8))}</p>`;
}
function summary() {
  const job = $("job").value.trim(), company = $("company").value.trim().length >= 40;
  $("summary").innerHTML = `<dt>${esc(w.sumCv)}</dt><dd>${esc(cvFile || w.pasted)} · ${esc(w.sumWords.replace("{n}", words(cvText)))}</dd>
    <dt>${esc(w.sumJob)}</dt><dd>${esc(job.split(/\n|\. /)[0].slice(0, 80))}<span class="chips">${chips(keywords(job, 5))}</span></dd>
    <dt>${esc(w.sumOut)}</dt><dd>${esc(company ? w.outBoth : w.outCv)}</dd>`;
}

// ---- step 1: the CV, uploaded, dropped or pasted ----
async function take(file) {
  try {
    cvText = (await readUpload(file)).trim().slice(0, LIMIT["cv-text"]); cvFile = file.name;
    if (words(cvText) < 40) throw new Error("empty");
    status("cv-status", w.readOk.replace("{n}", words(cvText)).replace("{f}", file.name));
    saveDraft();
    readCv(); refresh();
  } catch (_) { cvText = ""; readCv(); status("cv-status", w.readFail, true); refresh(); }
}
$("cv-file").addEventListener("change", (e) => e.target.files[0] && take(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && take(e.dataTransfer.files[0]));
$("paste-toggle").addEventListener("click", () => {
  const t = $("cv-paste"); t.hidden = !t.hidden; $("paste-toggle").setAttribute("aria-expanded", String(!t.hidden));
  if (!t.hidden) $("cv-text").focus();
});
let ct;
$("cv-text").addEventListener("input", (e) => { cvText = e.target.value.trim(); cvFile = ""; refresh(); saveDraft(); clearTimeout(ct); ct = setTimeout(readCv, 300); });
$("job").addEventListener("input", () => { refresh(); saveDraft(); clearTimeout(jt); jt = setTimeout(readJob, 300); });
$("company").addEventListener("input", () => { refresh(); saveDraft(); clearTimeout(jt); jt = setTimeout(readCompany, 300); });
$("model").addEventListener("change", saveDraft);

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

// The work in progress survives a reload of this tab (sessionStorage), and is forgotten
// when the tab closes, so a CV never stays behind on a shared device.
function saveDraft() {
  try { sessionStorage.setItem("draft", JSON.stringify({ cv: cvText, cvFile, pasted: !$("cv-paste").hidden, job: $("job").value, company: $("company").value, model: $("model").value, at })); } catch (_) {}
}
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem("draft") || "null"); } catch (_) { return null; }
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);
const draft = loadDraft();
if (draft) { cvText = draft.cv || ""; cvFile = draft.cvFile || ""; }
fill();
if (draft) {
  if (draft.pasted || (cvText && !cvFile)) { $("cv-paste").hidden = false; $("paste-toggle").setAttribute("aria-expanded", "true"); $("cv-text").value = cvText; }
  $("job").value = draft.job || ""; $("company").value = draft.company || "";
  if (draft.model && [...$("model").options].some((o) => o.value === draft.model)) $("model").value = draft.model;
  readCv(); readJob(); readCompany();
}
// Back to the step it was on, but never past a step that is not valid
let start = 1;
while (draft && start < Math.min(draft.at || 1, 4) && valid[start]()) start++;
go(start);
