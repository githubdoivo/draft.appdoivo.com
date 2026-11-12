// Draft: a CV (and cover letter) tailored to one job ad, built to pass applicant tracking systems.
// The AI writes the content (worker/, behind a passcode and prepaid credit); everything
// else, reading the upload, the PDF and Word files, the check, runs here in the browser.
import { WORDS } from "./words.js?v=16";
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
let review = null;                                       // { key, score, have, missing, suggestions, yes: {i: note}, off: [i] }

// ---- words ----
function fill() {
  w = WORDS[lang];
  if (typeof renderApps === "function") try { renderApps(); } catch (_) {}
  document.documentElement.lang = lang;
  document.title = w.title;
  document.querySelectorAll("[data-w]").forEach((el) => (el.textContent = w[el.dataset.w]));
  document.querySelectorAll("[data-w-placeholder]").forEach((el) => (el.placeholder = w[el.dataset.wPlaceholder] || ""));
  $("job").placeholder = w.jobPh; $("company").placeholder = w.companyPh; $("cv-text").placeholder = w.cvPaste;
  $("lang").textContent = w.other; $("lang").setAttribute("aria-label", `${w.other}: ${w.otherLabel}`);
  for (const id of ["sign-close", "wallet-close", "people-close"]) $(id).setAttribute("aria-label", w.close);
  $("swatches").innerHTML = Object.keys(COLOURS).map((k) => `<button type="button" role="radio" class="swatch" data-c="${k}" aria-checked="${k === colour}" style="--sw:${COLOURS[k].hex}"><span>${w.colours[k]}</span></button>`).join("");
  const m = $("model").value || store.get("model") || "opus";
  $("model").innerHTML = Object.keys(MODELS).map((k) => `<option value="${k}">${w.models[k]}</option>`).join("");
  $("model").value = m; modelCost();
  if (cvText && cvFile) cvLoaded();
  if (credit) showCredit(credit);
  paintAcct();
  paintTheme();
  if (typeof at !== "undefined") { $("step-count").textContent = w.stepOf.replace("{n}", at); readCv(); readJob(); readCompany(); if (at === 4) { summary(); if (review) paintReview(); } refresh(); }
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
const isLink = (t) => /^https?:\/\/\S+$/i.test(t.trim());
// Share sheets often copy a sentence with the link inside ("Check out this job at X: https://…"): the one link is picked out
const pickLink = (t) => { t = String(t || "").trim(); if (isLink(t)) return t; const m = t.match(/https?:\/\/[^\s<>"']+/gi); return m && m.length === 1 && t.length <= 500 ? m[0].replace(/[)\].,;:!?]+$/, "") : ""; };
const valid = {
  1: () => cvText.length >= MIN.cv && words(cvText) >= 40,
  2: () => $("job").value.trim().length >= MIN.job && !isLink($("job").value),
  3: () => true,
};
function go(n, { first = false } = {}) {
  at = n; saveDraft();
  document.querySelectorAll(".machine .panel").forEach((p) => (p.hidden = +p.dataset.step !== n));
  document.querySelectorAll("#track li").forEach((li) => { const k = +li.dataset.for; li.classList.toggle("done", k < n); li.classList.toggle("now", k === n); });
  $("step-count").textContent = w.stepOf.replace("{n}", n);
  $("back").hidden = n === 1;
  $("skip").hidden = n !== 3 || $("company").value.trim().length > 0;
  $("next").hidden = n === 4; $("tailor").hidden = n !== 4;
  if (n === 4) { summary(); showReview(); }
  refresh();
  panel(n).querySelector(".m-title").focus({ preventScroll: true });
  const box = $("form").getBoundingClientRect();
  // Moving between steps brings the machine into view; opening the page does not
  if (!first && (box.top < 0 || box.top > innerHeight * .4)) $("form").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
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
    <dt>${esc(w.sumOut)}</dt><dd>${esc(company ? w.outBoth : w.outCv)}</dd>${linkFilled ? `<dt></dt><dd class="hint">${esc(w.linkBoth)}</dd>` : ""}`;
}

// ---- step 1: the CV, uploaded, dropped or pasted ----
// Once a file is read, the big button steps back to a quiet "Change"
function cvLoaded() {
  status("cv-status", "✓ " + w.readOk.replace("{n}", words(cvText)).replace("{f}", cvFile));
  $("cv-pick").textContent = w.change; $("cv-pick").classList.add("ghost");
}
async function take(file) {
  try {
    cvText = (await readUpload(file)).trim().slice(0, LIMIT["cv-text"]); cvFile = file.name;
    if (words(cvText) < 40) throw new Error("empty");
    cvLoaded();
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
// A link instead of the ad's text: the AI service reads the page (most job sites, LinkedIn's public job pages)
let lt;
$("job").addEventListener("input", () => {
  refresh(); saveDraft(); clearTimeout(jt); jt = setTimeout(readJob, 300);
  // a link pasted into the text box moves to the link box and is read from there
  if (isLink($("job").value)) { $("job-link").value = $("job").value.trim(); $("job").value = ""; readLink($("job-link").value); }
});
$("read-link").addEventListener("click", () => { const u = pickLink($("job-link").value); if (u) { $("job-link").value = u; readLink(u); } else status("job-status", w.linkBad, true); });
// share text ("Check out this job… https://…") pasted into the empty ad box: its link goes to the link box and is read
$("job").addEventListener("paste", (e) => { const t = (e.clipboardData && e.clipboardData.getData("text")) || "", u = pickLink(t); if (u && !isLink(t) && !$("job").value.trim()) { e.preventDefault(); $("job-link").value = u; readLink(u); } });
$("job-link").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("read-link").click(); } });
$("job-link").addEventListener("paste", () => setTimeout(() => { const u = pickLink($("job-link").value); if (u) { $("job-link").value = u; readLink(u); } }, 0));
// Lines that are only about who to contact: emails, phone numbers, "contact / send your CV to"
function stripContacts(text) {
  const contacts = [], keep = [];
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g, PHONE = /(\+?\d[\d\s().-]{7,}\d)/g;
  for (const line of String(text || "").split("\n")) {
    const found = [...(line.match(EMAIL) || []), ...(line.match(PHONE) || [])];
    if (found.length || /^\s*(contact|contacto|recruiter|recrutador|send your (cv|resume)|envie o seu cv)\b/i.test(line)) { contacts.push(...(found.length ? found : [line.trim()])); continue; }
    keep.push(line);
  }
  return { text: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(), contacts: [...new Set(contacts)].slice(0, 4) };
}
// The company part of a job ad: the "About us / Who we are" section, else the company's name and the ad's opening
let linkFilled = false;
function aboutCompany(text, name) {
  const lines = text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((l) => new RegExp(`^(about (us|the company|the team${name ? "|" + esc : ""})|who we are|our (company|story|mission)|sobre (nós|a empresa${name ? "|a " + esc + "|o " + esc : ""})|quem somos)\\b`, "i").test(l) && l.length < 80);
  const stop = /^(responsibilities|requirements|what you('ll)?|your role|the role|qualifications|benefits|perks|how to apply|o que|requisitos|responsabilidades|funções|benefícios|perfil)\b/i;
  let out = [];
  if (start >= 0) { for (const l of lines.slice(start + 1)) { if (stop.test(l) && l.length < 60) break; out.push(l); if (out.join(" ").length > 1500) break; } }
  if (out.join(" ").length < 60) out = lines.filter((l) => name && l.toLowerCase().includes(name.toLowerCase())).slice(0, 3);
  return [name, ...out].filter(Boolean).join("\n\n").slice(0, 2000);
}
async function readLink(u) {
  status("job-status", w.linkReading);
  try {
    // LinkedIn often says "busy" to the first reads: try twice more on its own before giving up (APP-DR-005)
    let d;
    for (let n = 0; ; n++) {
      try { d = await api("/job", { url: u }); break; }
      catch (e) { if (n >= 2 || !/linkedin\.com|lnkd\.in/i.test(u) || $("job-link").value.trim() !== u) throw e;
        status("job-status", w.linkRetry); await new Promise((r) => setTimeout(r, 2500 * (n + 1))); }
    }
    if (!d || $("job-link").value.trim() !== u) return status("job-status", w.jobHint);   // cancelled, or the link changed meanwhile
    // contact details (emails, phone numbers, "contact X") are not part of the job: kept aside, not sent to the AI
    const { text: jobText, contacts } = stripContacts(d.text);
    $("job").value = `${[d.title, d.company].filter(Boolean).join(" · ")}\n\n${jobText}`.trim();
    $("contacts").hidden = !contacts.length; $("contacts").textContent = contacts.length ? w.contactsKept.replace("{c}", contacts.join(" · ")) : "";
    // one link fills both steps: the ad, and the company (its "About us" part, or its name and opening)
    if (!$("company").value.trim()) $("company").value = aboutCompany(jobText, d.company || "");
    status("job-status", "✓ " + w.linkOk.replace("{h}", new URL(u).hostname.replace(/^www\./, "")));
    readJob(); readCompany(); refresh(); saveDraft();
    // both steps are filled from the link; you stay here to check the job, then Continue shows the company filled too
    linkFilled = true;
  } catch (err) {
    status("job-status", err.say && err.say !== w.failed ? err.say : w.linkFail, true);
    // one tap to the ad itself, to copy its text (only http(s) links)
    if (/^https?:\/\//i.test(u)) { const go = document.createElement("a"); go.className = "btn ghost open-ad"; go.href = u; go.target = "_blank"; go.rel = "noopener noreferrer"; go.textContent = w.openAd; $("job-status").append(" ", go); }
    $("job").focus();
  }
}
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
$("model").addEventListener("change", (e) => { store.set("model", e.target.value); modelCost(); });
function modelCost() { $("model-cost").textContent = w.about.replace("{c}", MODELS[$("model").value] || MODELS.sonnet); }
let credit = "";
function showCredit(b) { credit = b; $("credit").hidden = false; $("credit").textContent = w.credit.replace("{b}", b); }

// ---- account (APP-DR-003): Face ID / Touch ID, credits and the wallet; the owner's passcode still works ----
let acct = { signedIn: false, credits: 0, prices: { "/tailor": 3, "/interview": 2, "/review": 0 }, packs: [], start: 5 };
const toBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const toB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const acctCall = async (path, body, pass) => { const r = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", credentials: "include", headers: body ? { "content-type": "application/json", ...(pass ? { "x-passcode": pass } : {}) } : {}, body: body ? JSON.stringify(body) : undefined }); const d = await r.json().catch(() => ({})); if (!r.ok) throw d; return d; };
function paintAcct() {
  const b = $("acct"); if (!b) return;
  const boss = !!(acct.signedIn && acct.owner);
  $("people-btn").hidden = !boss;                         // People (invite codes, accounts) and the model picker are the owner's account's
  $("model-row").hidden = !boss;
  b.hidden = false;
  b.textContent = !acct.signedIn ? w.acctIn : boss ? w.acctUnlimited : acct.credits === 1 ? w.acctCredit1 : w.acctCredits.replace("{n}", acct.credits);
}
async function loadAcct() { try { acct = { ...acct, ...(await acctCall("/me")) }; } catch (_) {} paintAcct(); await claimOwner(); }
// The owner's passcode is no longer how Draft is used (APP-DR-003 round 4). A device that still holds it uses it once, quietly,
// to make the signed-in account the owner's, and then forgets it.
async function claimOwner(typed) {
  const pass = typed || store.get("pass"); if (!pass || !acct.signedIn || acct.owner) return false;
  try { const r = await fetch(`${API}/account/owner`, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-passcode": pass }, body: "{}" });
    if (r.ok) { acct = { ...acct, ...(await r.json()) }; store.set("pass", ""); paintAcct(); return true; }
    if (r.status === 401) store.set("pass", "");          // a wrong or old passcode: forgotten, not tried again
  } catch (_) {}
  return false;
}
let signWait = null;
function askSignIn() {
  return new Promise((resolve) => {
    signWait = resolve;
    $("sign-lead").textContent = w.signLead.replace("{n}", acct.start || 5); $("sign-err").hidden = true;
    if (inviteFromLink && !$("sign-invite").value) $("sign-invite").value = inviteFromLink;
    // an invite link, or a device that never signed in: New Account first; a device that has signed in before: Sign In first
    signTab(inviteFromLink || !store.get("hadAcct") ? "new" : "in"); $("pass").value = ""; $("pass-err").hidden = true;
    const ok = !!(window.PublicKeyCredential && navigator.credentials);
    $("sign-create").disabled = $("sign-have").disabled = !ok; if (!ok) { $("sign-err").hidden = false; $("sign-err").textContent = w.signNo; }
    $("sign-dialog").showModal();
    ($("tab-in").getAttribute("aria-selected") === "true" ? $("tab-in") : $("tab-new")).focus();   // start on the chosen tab, not on Close
  });
}
const signDone = (v) => { const r = signWait; signWait = null; if ($("sign-dialog").open) $("sign-dialog").close(); paintAcct(); if (r) r(v); };
$("sign-dialog").addEventListener("close", () => { if (signWait) signDone(null); });
$("sign-close").addEventListener("click", () => signDone(null));
let signing = false;
async function passkey(create) {
  if (signing) return; signing = true; $("sign-err").hidden = true; $("sign-create").disabled = $("sign-have").disabled = true;
  try {
    const name = $("sign-name").value.trim(), invite = $("sign-invite").value.trim();
    // a new account needs an invite code (one code, one account): asked before Face ID, so nobody makes a passkey for nothing
    if (create && !invite && !store.get("pass")) { $("sign-err").hidden = false; $("sign-err").textContent = w.signNeedInvite; $("sign-invite").focus(); return; }
    const o = await acctCall("/account/options", { mode: create ? "create" : "signin", name, ...(create ? { invite } : {}) }, create && !invite ? store.get("pass") : "");
    let data;
    if (create) {
      const c = await navigator.credentials.create({ publicKey: { ...o, challenge: toBuf(o.challenge), user: { ...o.user, id: toBuf(o.user.id) } } });
      data = await acctCall("/account/create", { name, userId: o.user.id, clientDataJSON: toB64u(c.response.clientDataJSON), attestationObject: toB64u(c.response.attestationObject) });
    } else {
      const c = await navigator.credentials.get({ publicKey: { ...o, challenge: toBuf(o.challenge) } });
      data = await acctCall("/account/signin", { id: c.id, clientDataJSON: toB64u(c.response.clientDataJSON), authenticatorData: toB64u(c.response.authenticatorData), signature: toB64u(c.response.signature) });
    }
    acct = { ...acct, ...data }; store.set("hadAcct", "1"); await claimOwner(); if (acct.owner) store.set("pass", ""); signDone("account");
  } catch (e) { if (!(e && e.name === "NotAllowedError")) { $("sign-err").hidden = false; $("sign-err").textContent = e && e.error === "invite" ? w.signBadInvite : e && e.error === "invite_used" ? w.signUsedInvite : e && e.error === "passkey_wrong" ? w.signNoAcct : w.signFail; if (e && /^invite/.test(e.error || "")) $("sign-invite").focus(); } }
  finally { signing = false; $("sign-create").disabled = $("sign-have").disabled = false; }
}
function signTab(which) {
  for (const k of ["in", "new"]) { const on = k === which; $("tab-" + k).setAttribute("aria-selected", String(on)); $("tab-" + k).tabIndex = on ? 0 : -1; $("pane-" + k).hidden = !on; }
  $("sign-err").hidden = true;
}
$("tab-in").addEventListener("click", () => signTab("in")); $("tab-new").addEventListener("click", () => signTab("new"));
$("sign-tabs").addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const to = $("tab-in").getAttribute("aria-selected") === "true" ? "new" : "in"; signTab(to); $("tab-" + to).focus(); } });
for (const id of ["sign-invite", "sign-name"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); passkey(true); } });
$("sign-create").addEventListener("click", () => passkey(true));
$("sign-have").addEventListener("click", () => passkey(false));
// the one-time step that makes this account the owner's: only offered at draft…/?owner, in the wallet of a signed-in account
const wantsOwner = new URLSearchParams(location.search).has("owner");
let claiming = false;
$("pass-form").addEventListener("submit", async (e) => { e.preventDefault(); const v = $("pass").value; if (!v || claiming) return; claiming = true; $("pass-ok").disabled = true; $("pass-err").hidden = true;
  const ok = await claimOwner(v); claiming = false; $("pass-ok").disabled = false; $("pass").value = "";
  if (ok) openWallet(0); else $("pass-err").hidden = false; });
function openWallet(need) {
  $("wallet-title").textContent = need ? w.walletEmpty : w.walletTitle;
  $("wallet-left").textContent = acct.owner ? w.walletUnlimited : w.walletLeft.replace("{n}", acct.credits);
  $("claim").hidden = !(wantsOwner && acct.signedIn && !acct.owner); $("pass-err").hidden = true;
  $("packs").hidden = !!acct.owner; for (const h3 of $("wallet").querySelectorAll("h3")) if (h3.dataset.w === "walletPacks") h3.hidden = !!acct.owner; { const soon = $("wallet").querySelector('[data-w="packSoon"]'); if (soon) soon.hidden = !!acct.owner; }
  $("wallet-need").hidden = !need; if (need) $("wallet-need").textContent = w.walletNeed.replace("{p}", need).replace("{n}", acct.credits);
  const pr = acct.prices || {};
  $("prices").innerHTML = [["priceTailor", pr["/tailor"]], ["priceInterview", pr["/interview"]], ["priceReview", pr["/review"]]].map(([k, n]) => `<li><span>${esc(w[k])}</span><b>${n ? esc(w.nCredits.replace("{n}", n)) : esc(w.free)}</b></li>`).join("");
  $("packs").innerHTML = (acct.packs || []).map((p) => `<button type="button" class="btn ghost pack" disabled>${esc(w.packBuy.replace("{n}", p.credits).replace("{e}", p.eur))}</button>`).join("");
  $("sign-out").hidden = !acct.signedIn;
  $("wallet").showModal();
}
$("wallet-close").addEventListener("click", () => $("wallet").close());
$("sign-out").addEventListener("click", async () => { try { await acctCall("/account/signout", {}); } catch (_) {} acct = { ...acct, signedIn: false, credits: 0 }; $("wallet").close(); paintAcct(); });
$("acct").addEventListener("click", () => acct.signedIn ? openWallet(0) : askSignIn());
// ---- People (APP-DR-003 round 2): the owner makes invite links, and sees or removes accounts ----
const ownerCall = async (path, body = {}) => { const r = await fetch(`${API}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw { status: r.status, ...d }; return d; };
const ppDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(lang === "pt" ? "pt-PT" : "en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const inviteLink = (code) => `${location.origin}/?invite=${code}`;
const showCode = (c) => String(c).replace(/^(.{4})(.+)$/, "$1-$2");
let ppData = { users: [], invites: [] }, ppBusy = false, ppArmed = { key: "", at: 0 };
function paintPeople() {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // Remove asks twice: the first tap arms the button, a second tap (not a double tap) removes
  const remove = (key, run) => { const armed = ppArmed.key === key, b = el("button", "btn ghost pp-remove" + (armed ? " sure" : ""), armed ? w.ppSure : w.ppRemove); b.type = "button";
    b.addEventListener("click", () => { if (ppArmed.key === key) { if (Date.now() - ppArmed.at > 500) run(); } else { ppArmed = { key, at: Date.now() }; paintPeople(); } }); return b; };
  const row = (main, sub, ...acts) => { const li = el("li"), t = el("span", "pp-text"); t.append(el("b", null, main), el("span", null, sub)); const a = el("span", "pp-acts"); a.append(...acts); li.append(t, a); return li; };
  $("pp-invites").replaceChildren(...(ppData.invites.length ? ppData.invites.map((i) => {
    const acts = [];
    if (!i.usedBy) { const c = el("button", "btn ghost pp-copy", w.ppCopy); c.type = "button"; c.addEventListener("click", async () => { try { await navigator.clipboard.writeText(inviteLink(i.code)); c.textContent = w.ppCopied; } catch (_) { c.replaceWith(Object.assign(el("input", "pp-link"), { value: inviteLink(i.code), readOnly: true, ariaLabel: w.ppCopy })); } }); acts.push(c); }
    acts.push(remove("i:" + i.code, () => ppRun("/admin/invite/delete", { code: i.code })));
    return row(showCode(i.code), i.usedBy ? w.ppUsed.replace("{n}", i.usedName || "?").replace("{d}", ppDay(i.usedAt)) : w.ppFree, ...acts);
  }) : [el("li", "pp-none", w.ppNoInvites)]));
  $("pp-users").replaceChildren(...(ppData.users.length ? ppData.users.map((u) =>
    u.owner ? row(u.name || "Draft", w.ppOwner.replace("{d}", ppDay(u.created))) : row(u.name || "Draft", (u.credits === 1 ? w.ppAcct1 : w.ppAcct.replace("{c}", u.credits)).replace("{d}", ppDay(u.created)), remove("u:" + u.id, () => ppRun("/admin/user/delete", { id: u.id })))) : [el("li", "pp-none", w.ppNoAccounts)]));
}
async function ppRun(path, body) {
  if (ppBusy) return; ppBusy = true; $("pp-err").hidden = true; $("pp-new").disabled = true;
  try { const d = await ownerCall(path, body); ppData = { users: d.users || [], invites: d.invites || [] }; ppArmed = { key: "", at: 0 }; paintPeople(); }
  catch (e) { $("pp-err").hidden = false; $("pp-err").textContent = e && e.status === 401 ? w.ppNotOwner : w.ppFail; ppArmed = { key: "", at: 0 }; paintPeople(); }
  finally { ppBusy = false; $("pp-new").disabled = false; }
}
$("people-btn").addEventListener("click", () => { $("people").querySelector(".hint").textContent = w.ppLead.replace("{n}", acct.start || 5); ppArmed = { key: "", at: 0 }; paintPeople(); if (!$("people").open) $("people").showModal(); ppRun("/admin/people"); });
$("pp-new").addEventListener("click", () => ppRun("/admin/invite"));
$("people-close").addEventListener("click", () => $("people").close());
// An invite link (?invite=CODE) opens the sign-in window with the code filled in
const inviteFromLink = (new URLSearchParams(location.search).get("invite") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
loadAcct().then(() => { if (!acct.signedIn && (inviteFromLink || wantsOwner)) askSignIn().then((how) => { if (how && wantsOwner && !acct.owner) openWallet(0); }); else if (wantsOwner && !acct.owner) openWallet(0); });

// ---- tailoring ----
// Every call to the AI service: the passcode once per device, and plain-language errors
async function api(path, body) {
  // reading a link is free: no passcode for it
  if (path === "/job") {
    const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { say: res.status === 429 ? w.slowDown : w.linkFail };
    return data;
  }
  // the signed-in account pays (cookie); signed out: sign in first, then carry on
  if (!acct.signedIn) { const how = await askSignIn(); if (!how) return null; }
  const res = await fetch(`${API}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === "signin") { acct.signedIn = false; paintAcct(); const how = await askSignIn(); if (!how) return null; return api(path, body); }
  if (data.balance) showCredit(data.balance);
  if (typeof data.credits === "number") { acct.credits = data.credits; paintAcct(); }
  if (res.status === 429 && data.error === "locked") throw { say: w.locked };
  if (res.status === 402) { if (typeof data.credits === "number") { openWallet(data.price || 1); throw { say: w.walletNeed.replace("{p}", data.price || 1).replace("{n}", data.credits) }; } throw { say: w.capped }; }
  if (!res.ok) throw { say: w.failed };
  return data;
}
const sayError = (err) => (err instanceof TypeError ? w.offline : err?.say || w.failed);   // TypeError: the AI service cannot be reached

// ---- step 4: the review board, before anything costly ----
const inputs = () => ({ cv: cvText, job: $("job").value.trim(), company: $("company").value.trim() });
const reviewKey = () => JSON.stringify(inputs());
function showReview() {
  if (review && review.key === reviewKey()) return paintReview();
  review = null;
  $("summary").hidden = false;
  $("review").innerHTML = `<p class="hint">${esc(w.checkCost)}</p><button type="button" class="btn ghost" id="check">${esc(w.checkBtn)}</button>`;
  if (acct.signedIn && acct.owner) runCheck();                         // the owner's account: check straight away
}
async function runCheck() {
  $("review").innerHTML = `<p class="hint working">${esc(w.checking)}</p>`;
  try {
    const d = await api("/review", { ...inputs(), ui: lang });
    if (!d) return showReview();
    review = { ...d, key: reviewKey(), yes: {}, off: [], no: [], at: 0 };
    saveDraft(); paintReview();
  } catch (err) {
    $("review").innerHTML = `<p class="hint bad">${esc(sayError(err))}</p><button type="button" class="btn ghost" id="check">${esc(w.checkBtn)}</button>`;
  }
}
// the missing skills, one question at a time (APP-DR-004): Yes at a past job (one tap on the job), Yes elsewhere (optional note), or No
const jobName = (j) => [j.title, j.company].filter(Boolean).join(", ");
function askCard(r) {
  // one question at a time (APP-DR-004 round 2): first what the ad wants that the CV doesn't show, then each suggested change; the answers at the end, each with Change
  r.no = r.no || []; r.seen = r.seen || [];
  const M = r.missing.length, S = r.suggestions.length, N = M + S; r.at = Math.min(r.at ?? 0, N);
  const said = (i) => (i in r.yes ? (r.yes[i] || w.yes) : w.no);
  if (r.at >= N) return `<div class="ask-card done"><p><b>${esc(w.allDone)}</b></p>
    ${M ? `<p class="ask-n">${esc(w.missingQ)}</p><ol class="answers">${r.missing.map((m, i) => `<li><span>${esc(m.term)}</span><b>${esc(said(i))}</b><button type="button" class="link quiet" data-goto="${i}" aria-label="${esc(w.change)}: ${esc(m.term)}">${esc(w.change)}</button></li>`).join("")}</ol>` : ""}
    ${S ? `<p class="ask-n">${esc(w.suggest)}</p><ol class="answers sug-answers">${r.suggestions.map((t, k) => `<li><span>${esc(t)}</span><b>${esc(r.off.includes(k) ? w.sugOff : w.sugOn)}</b><button type="button" class="link quiet" data-goto="${M + k}" aria-label="${esc(w.change)}: ${esc(t)}">${esc(w.change)}</button></li>`).join("")}</ol>` : ""}</div>`;
  const i = r.at, back = i > 0 ? `<button type="button" class="link quiet" data-ans="prev">${esc(w.prev)}</button>` : "";
  if (i >= M) { const k = i - M, seen = r.seen.includes(k);
    return `<div class="ask-card" aria-live="polite"><p class="ask-n">${esc(w.sugOf.replace("{i}", k + 1).replace("{n}", S))}</p>
      <p class="ask-q">${esc(r.suggestions[k])}</p>
      <div class="ask-btns"><button type="button" class="btn ghost" data-ans="use">${esc(w.sugUse)}</button><button type="button" class="btn ghost" data-ans="skip">${esc(w.sugSkip)}</button></div>
      <p class="ask-foot">${back}${seen ? `<span class="hint">${esc(r.off.includes(k) ? w.sugOff : w.sugOn)}</span>` : ""}</p></div>`; }
  const m = r.missing[i], mode = r.mode && r.mode.i === i ? r.mode.kind : "", answered = i in r.yes || r.no.includes(i);
  const jobs = Array.isArray(r.jobs) ? r.jobs.filter((j) => j && (j.title || j.company)) : [];
  return `<div class="ask-card" aria-live="polite"><p class="ask-n">${esc(w.askOf.replace("{i}", i + 1).replace("{n}", M))}</p>
    <p class="ask-q">${esc(m.question || m.term)}</p>
    ${mode === "job" && jobs.length ? `<p class="hint">${esc(w.whichJob)}</p><div class="ask-jobs">${jobs.map((j, k) => `<button type="button" class="btn ghost" data-job="${k}">${esc(jobName(j))}</button>`).join("")}</div>`
    : mode === "job" ? `<input class="note" data-jobnote="${i}" maxlength="120" placeholder="${esc(w.whichJobType)}" aria-label="${esc(m.term)}: ${esc(w.whichJobType)}"><button type="button" class="btn" data-ans="jobnext">${esc(w.next)}</button>`
    : mode === "else" ? `<input class="note" data-note="${i}" maxlength="160" placeholder="${esc(w.elseWhere)}" aria-label="${esc(m.term)}: ${esc(w.elseWhere)}" value="${esc(r.yes[i] || "")}"><button type="button" class="btn" data-ans="next">${esc(w.next)}</button>`
    : `<div class="ask-btns"><button type="button" class="btn ghost" data-ans="job">${esc(w.yesJob)}</button><button type="button" class="btn ghost" data-ans="skill">${esc(w.yesSkill)}</button><button type="button" class="btn ghost" data-ans="else">${esc(w.yesElse)}</button><button type="button" class="btn ghost" data-ans="no">${esc(w.no)}</button></div>`}
    <p class="ask-foot">${mode ? `<button type="button" class="link quiet" data-ans="options">${esc(w.prev)}</button>` : back}${answered ? `<span class="hint">${esc(said(i))}</span>` : ""}</p></div>`;
}
function answer(kind, val) {
  const r = review, i = r.at, M = r.missing.length, N = M + r.suggestions.length; r.no = r.no || []; r.seen = r.seen || [];
  // after Change, an answer goes straight back to the list of answers
  const advance = () => { r.mode = null; r.at = r.back ? N : i + 1; r.back = false; };
  const yes = (text) => { r.no = r.no.filter((x) => x !== i); r.yes[i] = text; };
  if (kind === "job") { r.mode = { i, kind: "job" }; }
  else if (kind === "else") { r.mode = { i, kind: "else" }; yes(r.yes[i] && r.yes[i] !== w.asSkill && !/^(At |Em )/.test(r.yes[i]) ? r.yes[i] : ""); }
  else if (kind === "options") { r.mode = null; }
  else if (kind === "pick") { yes(w.atJob.replace("{job}", jobName(r.jobs.filter((j) => j && (j.title || j.company))[val]))); advance(); }
  else if (kind === "jobnext") { const typed = (($("review").querySelector("[data-jobnote]") || {}).value || "").trim(); yes(typed ? w.atJob.replace("{job}", typed) : w.atPastJob); advance(); }
  else if (kind === "skill") { yes(w.asSkill); advance(); }
  else if (kind === "no") { delete r.yes[i]; if (!r.no.includes(i)) r.no.push(i); advance(); }
  else if (kind === "use" || kind === "skip") { const k = i - M; r.off = r.off.filter((x) => x !== k); if (kind === "skip") r.off.push(k); if (!r.seen.includes(k)) r.seen.push(k); advance(); }
  else if (kind === "next") advance();
  else if (kind === "prev") { r.mode = null; r.back = false; r.at = Math.max(0, i - 1); }
  else if (kind === "goto") { r.mode = null; r.back = true; r.at = val; }
  saveDraft(); paintReview();
  const f = $("review").querySelector(".ask-card .note, .ask-card .btn, .ask-card button"); if (f) f.focus();
}
const stage = (r) => { const at = Math.min(r.at ?? 0, r.missing.length + r.suggestions.length); return at >= r.missing.length + r.suggestions.length ? "done" : at >= r.missing.length ? "sug" : "miss"; };
function paintReview() {
  const r = review;
  $("summary").hidden = true;
  $("review").innerHTML = `
    <div class="score" style="--s:${r.score}"><p><b>${esc(w.match.replace("{n}", r.score))}</b>${r.role ? ` · ${esc(r.role)}` : ""}</p><span class="meter" aria-hidden="true"><i></i></span><p class="muted">${esc(r.verdict)}</p></div>
    ${r.have.length ? `<h3>${esc(w.have)}</h3><p class="chips">${r.have.map((h) => `<span class="chip" title="${esc(h.evidence)}">${esc(h.term)}</span>`).join("")}</p>` : ""}
    ${r.missing.length + r.suggestions.length ? `<h3>${esc(stage(r) === "sug" ? w.suggest : stage(r) === "done" ? w.ansTitle : w.missingQ)}</h3>${stage(r) === "done" ? "" : `<p class="hint">${esc(stage(r) === "sug" ? w.sugHint : w.missingHint)}</p>`}${askCard(r)}` : ""}
    <button type="button" class="link quiet" id="recheck">${esc(w.recheck)}</button>`;
}
let lastAnswer = 0;
$("review").addEventListener("click", (e) => {
  if (e.target.id === "check" || e.target.id === "recheck") { review = null; runCheck(); return; }
  const b = e.target.closest("button"); if (!b || !review) return;
  // a double tap answers one question, not this one and the next (the next question's button appears under the same finger)
  if (Date.now() - lastAnswer < 400) return; if (b.dataset.ans || b.dataset.job !== undefined || b.dataset.goto !== undefined) lastAnswer = Date.now();
  if (b.dataset.ans) answer(b.dataset.ans); else if (b.dataset.job !== undefined) answer("pick", +b.dataset.job); else if (b.dataset.goto !== undefined) answer("goto", +b.dataset.goto);
});
$("review").addEventListener("keydown", (e) => { if (e.key !== "Enter") return; if (e.target.dataset.note !== undefined) { e.preventDefault(); answer("next"); } else if (e.target.dataset.jobnote !== undefined) { e.preventDefault(); answer("jobnext"); } });
$("review").addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.sug !== undefined) { const i = +t.dataset.sug; review.off = t.checked ? review.off.filter((x) => x !== i) : [...review.off, i]; const y = t.parentElement.querySelector(".yes"); if (y) y.textContent = t.checked ? w.sugOn : w.sugOff; }
  saveDraft();
});
$("review").addEventListener("input", (e) => { if (e.target.dataset.note !== undefined) { review.yes[+e.target.dataset.note] = e.target.value; saveDraft(); } });
const choices = () => !review ? undefined : {
  confirmed: Object.entries(review.yes).map(([i, note]) => ({ term: review.missing[i].term, note })),
  apply: review.suggestions.filter((_, i) => !review.off.includes(i)),
  skip: review.suggestions.filter((_, i) => review.off.includes(i)),
};

// ---- tailoring ----
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!cvText) return status("status", w.needCv, true);
  const job = $("job").value.trim(); if (!job) { $("job").focus(); return status("status", w.needJob, true); }
  $("tailor").disabled = true; status("status", w.working);
  try {
    const data = await api("/tailor", { ...inputs(), model: $("model").value, ui: lang, choices: review?.key === reviewKey() ? choices() : undefined });
    if (!data) return status("status", "");
    result = { ...data, job, sample: false };
    status("status", "");
    await show(result);
  } catch (err) {
    status("status", sayError(err), true);
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
  $("prep-out").replaceChildren(); $("prep-status").textContent = ""; $("tab-interview").hidden = !!r.sample;
  if (!r.sample) track(r);
  const note = $("result-note");
  note.classList.toggle("sample-note", !!r.sample);
  if (r.sample) { const b = document.createElement("strong"); b.textContent = w.sampleTitle; const s = document.createElement("span"); s.textContent = w.sampleText; note.replaceChildren(b, s); }
  else note.textContent = r.cached ? w.cached : r.cost ? w.cost.replace("{c}", r.cost).replace("{b}", r.balance || "") : "";
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
  for (const t of ["cv", "letter", "interview"]) { $(`tab-${t}`).setAttribute("aria-selected", String(t === which)); $(`panel-${t}`).hidden = t !== which; }
}
$("tab-cv").addEventListener("click", () => selectTab("cv"));
$("tab-letter").addEventListener("click", () => selectTab("letter"));
$("tab-interview").addEventListener("click", () => selectTab("interview"));
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const order = ["cv", "letter", "interview"].filter((t) => !$(`tab-${t}`).hidden);
  const cur = order.findIndex((t) => $(`tab-${t}`).getAttribute("aria-selected") === "true");
  const next = order[(cur + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
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
  try { sessionStorage.setItem("draft", JSON.stringify({ cv: cvText, cvFile, pasted: !$("cv-paste").hidden, job: $("job").value, company: $("company").value, model: $("model").value, at, review })); } catch (_) {}
}
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem("draft") || "null"); } catch (_) { return null; }
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);
const draft = loadDraft();
if (draft) { cvText = draft.cv || ""; cvFile = draft.cvFile || ""; review = draft.review || null; }
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
go(start, { first: true });

// ---- interview prep: likely questions answered from the CV, questions to ask, a thank-you note ----
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
$("prep").addEventListener("click", async () => {
  const b = $("prep"); b.disabled = true; $("prep-status").textContent = w.prepping;
  try {
    const d = await api("/interview", { ...inputs(), ui: lang });
    if (!d) { $("prep-status").textContent = ""; return; }
    $("prep-status").textContent = d.cached ? w.cached : w.prepCost.replace("{c}", d.cost || "");
    const out = [];
    for (const q of d.questions || []) { const det = el("details", "q"); det.append(el("summary", null, q.question), el("p", "why", `${w.qWhy}: ${q.why}`), el("p", "ans", q.answer)); out.push(det); }
    if (d.ask?.length) { const h = el("h3", null, w.askTitle), ul = el("ul", "ask"); for (const a of d.ask) ul.append(el("li", null, a)); out.push(h, ul); }
    if (d.thanks?.body) { const h = el("h3", null, w.thanksTitle), box = el("div", "thanks"); box.append(el("p", "subj", d.thanks.subject), el("p", null, d.thanks.body));
      const c = el("button", "btn ghost", w.copy); c.type = "button"; c.onclick = async () => { try { await navigator.clipboard.writeText(`${d.thanks.subject}\n\n${d.thanks.body}`); c.textContent = w.copied; } catch (_) {} };
      out.push(h, box, c); }
    $("prep-out").replaceChildren(...out);
  } catch (err) { $("prep-status").textContent = sayError(err); }
  b.disabled = false;
});

// ---- my applications: kept on this device only ----
const APPS_KEY = "applications";
const appsGet = () => { try { return JSON.parse(store.get(APPS_KEY) || "[]"); } catch (_) { return []; } };
const appsSet = (list) => store.set(APPS_KEY, JSON.stringify(list.slice(0, 200)));
function track(r) {
  const role = (r.cv?.title || $("job").value.split(/\n|·/)[0] || "").trim().slice(0, 80), company = (r.letter?.company || $("company").value.split("\n")[0] || "").trim().slice(0, 60);
  const list = appsGet(); const key = `${role}|${company}`.toLowerCase();
  if (!list.some((a) => a.key === key)) { list.unshift({ key, role, company, date: new Date().toISOString().slice(0, 10), status: "tailored", follow: "" }); appsSet(list); }
  renderApps();
}
function renderApps() {
  const list = appsGet(); $("apps").hidden = !list.length;
  const ST = ["tailored", "applied", "interview", "offer", "no"], NAME = { tailored: w.stTailored, applied: w.stApplied, interview: w.stInterview, offer: w.stOffer, no: w.stNo };
  $("app-list").replaceChildren(...list.map((a, i) => {
    const li = el("li", "app st-" + a.status); const head = el("div", "app-head");
    head.append(el("b", null, a.role || "—"), el("span", "co", a.company || ""), el("span", "date", new Date(a.date + "T12:00:00").toLocaleDateString(lang === "pt" ? "pt-PT" : "en-GB", { day: "numeric", month: "short" })));
    const sel = el("select"); sel.setAttribute("aria-label", a.role); for (const s of ST) { const o = el("option", null, NAME[s]); o.value = s; sel.append(o); } sel.value = a.status;
    sel.onchange = () => { const l = appsGet(); l[i].status = sel.value; appsSet(l); renderApps(); };
    const fl = el("label", "follow"); fl.append(el("span", null, w.followUp)); const fi = el("input"); fi.type = "date"; fi.value = a.follow || ""; fi.onchange = () => { const l = appsGet(); l[i].follow = fi.value; appsSet(l); }; fl.append(fi);
    const rm = el("button", "link-btn", w.remove); rm.type = "button"; rm.onclick = () => { const l = appsGet(); l.splice(i, 1); appsSet(l); renderApps(); };
    const row = el("div", "app-row"); row.append(sel, fl, rm); li.append(head, row); return li; }));
}
renderApps();
