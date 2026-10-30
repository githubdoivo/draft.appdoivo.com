// Reading files the way an applicant tracking system (ATS) does, and checking a
// finished CV against what those systems and recruiters' AI screeners need.
// pdf.js (vendor/pdf.min.mjs, Apache-2.0) reads PDFs; mammoth (BSD-2) reads Word.
import { LABELS, sections, dateRange } from "./cv.js";

let pdfjs = null;
async function pdfLib() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

// The text of a PDF in reading order, one line per visual line, plus what is in it
export async function readPdf(bytes) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes), isEvalSupported: false }).promise;
  const lines = [];
  let images = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let last = null, line = "";
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      if (last !== null && Math.abs(y - last) > 2) { lines.push(line.trim()); line = ""; }
      line += (line && !line.endsWith(" ") && it.str && !it.str.startsWith(" ") ? " " : "") + it.str;
      last = y;
    }
    if (line.trim()) lines.push(line.trim());
    const ops = await page.getOperatorList();
    images += ops.fnArray.filter((f) => f === lib.OPS.paintImageXObject || f === lib.OPS.paintInlineImageXObject).length;
  }
  return { text: lines.filter(Boolean).join("\n"), pages: doc.numPages, images };
}

// The text of an uploaded CV: PDF, Word or plain text
export async function readUpload(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return (await readPdf(buf)).text;
  if (/\.docx$/i.test(file.name)) return (await window.mammoth.extractRawText({ arrayBuffer: buf.buffer })).value;
  if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/")) return new TextDecoder().decode(buf);
  throw new Error("unsupported");
}

// ---- keywords: the words and phrases the job ad leans on ----
const STOP = new Set(("a an and are as at be been by for from has have in into is it its of on or our that the their this to we will with you your " +
  "who what when where which while would can could should may must etc also plus more most other such than then them they these those very within " +
  "work working role team teams job position candidate candidates experience years year strong good great excellent ability able skills skill knowledge " +
  "requirements requirement responsibilities responsibility qualifications nice bonus preferred required what offer offers benefits " +
  "requisitos responsabilidades funções oferecemos valorizamos including include includes using use used based across about well new looking join help make sure across company us " +
  "o a os as de do da dos das e em no na nos nas ao aos um uma por para com que se ou mais muito como sua seu suas seus ser sobre entre " +
  "experiência anos equipa trabalho empresa conhecimento conhecimentos capacidade boa bom forte procuramos").split(/\s+/));
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const tokens = (text) => (text.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9+#./-]*[A-Za-zÀ-ÿ0-9+#]|[A-Za-zÀ-ÿ]/g) || []);

// A word's stem, so "testing", "tests" and "tested" all match "test"
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.length === 4 && w.endsWith("s") ? w.slice(0, 3) : w);   // "apis" → "api"
const isTech = (w) => /[A-Z].*[A-Z]|[+#/.]|\d/.test(w.slice(1)) || /^[A-Z]{2,}/.test(w);

// The words and short phrases a job ad leans on, most important first.
// `skip`: names that are not skills (the company's own name, the candidate's).
export function keywords(job, max = 24, skip = []) {
  const no = new Set(skip.flatMap((s) => tokens(s).map(norm)));
  const score = new Map();
  const add = (k, n, show) => { const e = score.get(k) || { show, n: 0, tech: false }; e.n += n; e.tech ||= isTech(show) || /[A-Z]/.test(show[0]); score.set(k, e); };
  // Phrases never cross a sentence, a comma or a bracket
  for (const clause of job.split(/[.;:!?()\n,]+|\s[-–—]\s/)) {
    const ws = tokens(clause).filter((w) => !/^\d+\+?$/.test(w));
    ws.forEach((w, i) => {
      const k = norm(w);
      if (k.length < 2 || STOP.has(k) || no.has(k)) return;
      add(stem(k), isTech(w) ? 2 : 1, w);
      const nx = ws[i + 1], kn = nx && norm(nx);
      if (nx && kn.length > 2 && !STOP.has(kn) && !no.has(kn)) add(`${stem(k)} ${stem(kn)}`, 1, `${w} ${nx}`);
    });
  }
  // Keep a phrase only when it repeats or names a tool; keep a word when it repeats or is a proper term
  return [...score.entries()]
    .filter(([k, e]) => (k.includes(" ") ? e.n >= 2 || (isTech(e.show.split(" ")[0]) && isTech(e.show.split(" ")[1])) : e.n >= 2 || e.tech))
    .sort((a, b) => b[1].n - a[1].n).slice(0, max).map(([, e]) => e.show.replace(/[.,;:]$/, ""));
}

// Does the text contain the keyword? Case, accents and word endings ignored.
export function hasKeyword(text, k) {
  const words = (s) => tokens(s).map((w) => stem(norm(w)));
  const t = ` ${words(text).join(" ")} `, n = words(k).join(" ");
  return n.length > 0 && t.includes(` ${n} `);
}

// ---- the check: what a parser would get out of the file ----
// Each result: { id, ok, warn (ok but worth a look), detail }
export async function checkCv(pdfBytes, cv, job, file, company = "", given = null) {
  const r = await readPdf(pdfBytes), t = r.text, L = LABELS[cv.lang] || LABELS.en, top = t.split("\n").slice(0, 6).join("\n");
  const out = [];
  const add = (id, ok, detail = "", warn = false) => out.push({ id, ok, warn, detail });
  add("text", t.length > 300, `${t.split(/\s+/).length}`);
  add("name", top.includes(cv.name));
  add("email", /[\w.+-]+@[\w-]+\.[\w.]+/.test(top));
  add("phone", /\+?\d[\d\s().-]{7,}\d/.test(top), "", !cv.contact?.phone);
  const want = sections(cv).map((s) => L[s].toUpperCase());
  const pos = want.map((h) => t.indexOf(h));
  add("headings", pos.every((p) => p >= 0), want.filter((_, i) => pos[i] < 0).join(", "));
  add("order", pos.every((p, i) => i === 0 || p > pos[i - 1]));            // one column: sections come out in order
  add("images", r.images === 0);
  add("pages", r.pages <= 2, `${r.pages}`, r.pages === 2);
  // Every job has dates, and a parser finds them right under that job's title (not somewhere later)
  const flat = t.replace(/\s+/g, " ");
  const dated = (cv.experience || []).every((e, i, all) => {
    if (!e.start || !e.end) return false;
    const at = flat.indexOf(`${e.title}, ${e.company}`), d = flat.indexOf(dateRange(e.start, e.end, cv.lang), at);
    const next = all[i + 1] ? flat.indexOf(`${all[i + 1].title}, ${all[i + 1].company}`, at + 1) : Infinity;
    return at >= 0 && d > at && d < next;
  });
  add("dates", dated);
  add("filename", /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*-(CV|Cover-Letter)\.(pdf|docx)$/.test(file));
  // Keyword match against the job ad
  const ks = given?.length ? given : job ? keywords(job, 24, [cv.name, company || ""]) : [];   // the AI's list when there is one
  const found = ks.filter((k) => hasKeyword(t, k)), missing = ks.filter((k) => !hasKeyword(t, k));
  const pct = ks.length ? Math.round((found.length / ks.length) * 100) : 100;
  add("keywords", pct >= 60, `${pct}`, pct < 75);
  return { checks: out, found, missing, pct, text: t };
}
