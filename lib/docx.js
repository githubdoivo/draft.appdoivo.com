// CV and cover letter as Word (.docx), the format many applicant tracking systems
// read best: real Word headings and bullets, one column, Calibri, dates on their own
// line under each title (never a table, text box or tab-aligned column). Uses docx (vendor/docx.iife.js, MIT).
import { LABELS, COLOURS, sections, dateRange, contactParts, meta, langLine } from "./cv.js";

const D = () => window.docx;
const PT = (n) => n * 2;                                   // docx sizes are half-points
const TW = (mm) => Math.round(mm * 56.7);                   // millimetres to twentieths of a point
const RIGHT = TW(210 - 2 * 19);                             // right tab stop at the text edge (A4, 19 mm margins)

function base(colourKey, children, meta) {
  const { Document } = D();
  const hex = (COLOURS[colourKey] || COLOURS.blue).hex.slice(1);
  return new Document({
    creator: meta.author, title: meta.title, description: meta.subject,
    styles: {
      default: { document: { run: { font: "Calibri", size: PT(10.5), color: "1A1A1F" }, paragraph: { spacing: { after: 40, line: 264 } } } },
      paragraphStyles: [{
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Calibri", size: PT(11.5), bold: true, color: hex, allCaps: true },
        paragraph: { spacing: { before: 220, after: 80 }, border: { bottom: { style: "single", size: 8, color: hex, space: 2 } } },
      }],
    },
    numbering: { config: [{ reference: "dots", levels: [{ level: 0, format: "bullet", text: "•", alignment: "left",
      style: { paragraph: { indent: { left: TW(5), hanging: TW(4) } }, run: { color: hex } } }] }] },
    sections: [{ properties: { page: { size: { width: TW(210), height: TW(297) }, margin: { top: TW(18), bottom: TW(18), left: TW(19), right: TW(19) } } }, children }],
  });
}

const P = (text, opts = {}) => new (D().Paragraph)({ children: [new (D().TextRun)({ text, ...(opts.run || {}) })], ...(opts.para || {}) });

function headerParas(name, sub, contact, hex) {
  const out = [P(name, { run: { bold: true, size: PT(22) }, para: { spacing: { after: 40 } } })];
  if (sub) out.push(P(sub, { run: { size: PT(12), color: hex } }));
  const parts = contactParts(contact);
  if (parts.length) out.push(P(parts.join("  |  "), { run: { size: PT(9.5), color: "55555C" }, para: { spacing: { after: 120 } } }));
  return out;
}

const bullet = (text) => new (D().Paragraph)({ text, numbering: { reference: "dots", level: 0 }, spacing: { after: 30 } });
const heading = (text) => new (D().Paragraph)({ text, heading: D().HeadingLevel.HEADING_1 });

export async function cvDocx(cv, colourKey = "blue") {
  const L = LABELS[cv.lang] || LABELS.en, hex = (COLOURS[colourKey] || COLOURS.blue).hex.slice(1);
  const kids = headerParas(cv.name, cv.headline, cv.contact, hex);
  for (const s of sections(cv)) {
    kids.push(heading(L[s]));
    if (s === "summary") kids.push(P(cv.summary));
    if (s === "experience") cv.experience.forEach((e) => {
      kids.push(P(`${e.title}, ${e.company}`, { run: { bold: true, size: PT(10.5) }, para: { spacing: { before: 140, after: 10 } } }));
      kids.push(P(meta(dateRange(e.start, e.end, cv.lang), e.location), { run: { color: "55555C", size: PT(9.5) } }));
      (e.bullets || []).forEach((t) => kids.push(bullet(t)));
    });
    if (s === "skills") cv.skills.forEach((g) => kids.push(new (D().Paragraph)({ children: [new (D().TextRun)({ text: `${g.group}: `, bold: true }), new (D().TextRun)(g.items.join(", "))] })));
    if (s === "projects") cv.projects.forEach((p) => {
      kids.push(P(p.name, { run: { bold: true }, para: { spacing: { before: 100 } } }));
      if (p.detail) kids.push(P(p.detail));
      (p.bullets || []).forEach((t) => kids.push(bullet(t)));
    });
    if (s === "education") cv.education.forEach((e) => {
      kids.push(P(`${e.degree}, ${e.school}`, { run: { bold: true, size: PT(10.5) }, para: { spacing: { before: 120, after: 10 } } }));
      kids.push(P(meta(dateRange(e.start, e.end, cv.lang), e.location, e.detail), { run: { color: "55555C", size: PT(9.5) } }));
    });
    if (s === "certifications") cv.certifications.forEach((c) => kids.push(P([c.name, c.issuer, c.year].filter(Boolean).join(", "))));
    if (s === "languages") kids.push(P(langLine(cv.languages)));
  }
  return D().Packer.toBlob(base(colourKey, kids, { title: `${cv.name} - CV`, author: cv.name, subject: cv.headline || "CV" }));
}

export async function letterDocx(letter, colourKey = "blue") {
  const hex = (COLOURS[colourKey] || COLOURS.blue).hex.slice(1);
  const kids = headerParas(letter.name, "", letter.contact, hex);
  kids.push(new (D().Paragraph)({ border: { bottom: { style: "single", size: 8, color: hex, space: 2 } }, spacing: { after: 240 } }));
  kids.push(P(letter.date, { run: { color: "55555C" }, para: { spacing: { after: 200 } } }));
  kids.push(P([letter.recipient, letter.company].filter(Boolean).join(", "), { run: { bold: true }, para: { spacing: { after: 240 } } }));
  kids.push(P(letter.greeting, { para: { spacing: { after: 160 } } }));
  letter.paragraphs.forEach((t) => kids.push(P(t, { para: { spacing: { after: 160, line: 288 } } })));
  kids.push(P(letter.closing, { para: { spacing: { before: 120, after: 40 } } }));
  kids.push(P(letter.name, { run: { bold: true } }));
  return D().Packer.toBlob(base(colourKey, kids, { title: `${letter.name} - Cover Letter`, author: letter.name, subject: `Cover letter for ${letter.company}` }));
}
