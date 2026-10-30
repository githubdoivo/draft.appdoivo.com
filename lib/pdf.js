// CV and cover letter as PDF, built for applicant tracking systems (ATS):
// one column, real text in reading order (dates sit under each title, never at the right
// edge, where some parsers lose them), standard fonts (Helvetica, which every
// parser knows), standard section titles, no tables, text boxes, images or icons.
// Colour touches only headings and lines. Uses pdf-lib (vendor/pdf-lib.min.js, MIT).
import { LABELS, COLOURS, sections, dateRange, contactParts, meta, langLine } from "./cv.js";

const A4 = [595.28, 841.89];
const M = { left: 54, right: 54, top: 52, bottom: 54 };
const INK = [0.1, 0.1, 0.12], GREY = [0.33, 0.33, 0.36];

// Helvetica covers Latin-1 (all Portuguese letters); anything else is spelled the
// closest way it can be rather than breaking the file.
function safe(font, text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    try { font.encodeText(ch); out += ch; }
    catch (_) {
      const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += { "‑": "-", "‒": "-", "―": "-", "−": "-", " ": " ", " ": " ", " ": " " }[ch] ?? (plain && plain !== ch ? safe(font, plain) : "");
    }
  }
  return out;
}

class Writer {
  constructor(doc, fonts, colour) {
    this.doc = doc; this.f = fonts; this.c = PDFLib.rgb(...colour); this.y = 0; this.page = null;
    this.width = A4[0] - M.left - M.right;
    this.newPage();
  }
  newPage() { this.page = this.doc.addPage(A4); this.y = A4[1] - M.top; }
  need(h) { if (this.y - h < M.bottom) this.newPage(); }
  // Split text into lines that fit `width` at `size`
  wrap(text, font, size, width) {
    const words = safe(font, text).split(/\s+/).filter(Boolean), lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }
  text(str, { font = this.f.reg, size = 10, colour = INK, x = M.left, width = this.width, lead = 1.38, after = 0 } = {}) {
    for (const line of this.wrap(str, font, size, width)) {
      this.need(size * lead);
      this.y -= size * lead;
      this.page.drawText(line, { x, y: this.y + size * 0.28, size, font, color: PDFLib.rgb(...colour) });
    }
    this.y -= after;
  }
  bullet(str, size = 10) {
    const indent = 13, lines = this.wrap(str, this.f.reg, size, this.width - indent);
    lines.forEach((line, i) => {
      this.need(size * 1.38); this.y -= size * 1.38;
      if (i === 0) this.page.drawText("•", { x: M.left + 2, y: this.y + size * 0.28, size, font: this.f.reg, color: this.c });
      this.page.drawText(line, { x: M.left + indent, y: this.y + size * 0.28, size, font: this.f.reg, color: PDFLib.rgb(...INK) });
    });
  }
  heading(str) {
    this.need(40);
    this.y -= 16;
    this.page.drawText(safe(this.f.bold, str.toUpperCase()), { x: M.left, y: this.y, size: 11, font: this.f.bold, color: this.c });
    this.y -= 6;
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + this.width, y: this.y }, thickness: 0.9, color: this.c });
    this.y -= 2;
  }
}

async function start(meta) {
  const doc = await PDFLib.PDFDocument.create();
  // Document properties: some parsers read the title and author
  doc.setTitle(meta.title); doc.setAuthor(meta.author); doc.setSubject(meta.subject); doc.setCreator("job.appdoivo.com"); doc.setProducer("job.appdoivo.com");
  doc.setLanguage(meta.lang === "pt" ? "pt-PT" : "en-GB");
  const fonts = {
    reg: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
    bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
    ital: await doc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
  };
  return { doc, fonts };
}

function header(w, name, sub, contact) {
  w.y -= 4;
  w.text(name, { font: w.f.bold, size: 22, lead: 1.1 });
  if (sub) w.text(sub, { font: w.f.reg, size: 12, colour: w.c ? [w.c.red, w.c.green, w.c.blue] : INK, lead: 1.5 });
  const parts = contactParts(contact);
  if (parts.length) w.text(parts.join("  |  "), { size: 9.5, colour: GREY, lead: 1.6 });
}

export async function cvPdf(cv, colourKey = "blue") {
  const L = LABELS[cv.lang] || LABELS.en, colour = (COLOURS[colourKey] || COLOURS.blue).rgb;
  const { doc, fonts } = await start({ title: `${cv.name} - CV`, author: cv.name, subject: cv.headline || "CV", lang: cv.lang });
  const w = new Writer(doc, fonts, colour);
  header(w, cv.name, cv.headline, cv.contact);
  for (const s of sections(cv)) {
    w.heading(L[s]);
    if (s === "summary") w.text(cv.summary, { after: 2 });
    if (s === "experience") cv.experience.forEach((e, i) => {
      if (i) w.y -= 7;
      w.text(`${e.title}, ${e.company}`, { font: w.f.bold, size: 10.5, lead: 1.4 });
      w.text(meta(dateRange(e.start, e.end, cv.lang), e.location), { size: 9.5, colour: GREY, lead: 1.3, after: 1 });
      (e.bullets || []).forEach((b) => w.bullet(b));
    });
    if (s === "skills") cv.skills.forEach((g) => w.text(`${g.group}: ${g.items.join(", ")}`, { after: 1 }));
    if (s === "projects") cv.projects.forEach((p, i) => {
      if (i) w.y -= 5;
      w.text(p.name, { font: w.f.bold, size: 10.5 });
      if (p.detail) w.text(p.detail);
      (p.bullets || []).forEach((b) => w.bullet(b));
    });
    if (s === "education") cv.education.forEach((e, i) => {
      if (i) w.y -= 5;
      w.text(`${e.degree}, ${e.school}`, { font: w.f.bold, size: 10.5, lead: 1.4 });
      w.text(meta(dateRange(e.start, e.end, cv.lang), e.location, e.detail), { size: 9.5, colour: GREY, lead: 1.3 });
    });
    if (s === "certifications") cv.certifications.forEach((c) => w.text([c.name, c.issuer, c.year].filter(Boolean).join(", ")));
    if (s === "languages") w.text(langLine(cv.languages));
  }
  return doc.save();
}

export async function letterPdf(letter, colourKey = "blue") {
  const colour = (COLOURS[colourKey] || COLOURS.blue).rgb;
  const { doc, fonts } = await start({ title: `${letter.name} - Cover Letter`, author: letter.name, subject: `Cover letter for ${letter.company}`, lang: letter.lang });
  const w = new Writer(doc, fonts, colour);
  header(w, letter.name, "", letter.contact);
  w.y -= 8;
  w.page.drawLine({ start: { x: M.left, y: w.y }, end: { x: M.left + w.width, y: w.y }, thickness: 0.9, color: w.c });
  w.y -= 18;
  w.text(letter.date, { colour: GREY, after: 10 });
  w.text([letter.recipient, letter.company].filter(Boolean).join(", "), { font: w.f.bold, after: 14 });
  w.text(letter.greeting, { after: 8 });
  letter.paragraphs.forEach((p) => w.text(p, { size: 10.5, lead: 1.45, after: 9 }));
  w.y -= 4;
  w.text(letter.closing, { after: 2 });
  w.text(letter.name, { font: w.f.bold });
  return doc.save();
}
