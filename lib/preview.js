// The CV and the cover letter as HTML, laid out like the PDF, for the preview on the page.
import { LABELS, COLOURS, sections, dateRange, contactParts, meta, langLine } from "./cv.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function head(name, sub, contact) {
  return `<header class="pv-head"><p class="pv-name">${esc(name)}</p>${sub ? `<p class="pv-sub">${esc(sub)}</p>` : ""}
    <p class="pv-contact">${contactParts(contact).map(esc).join('<span aria-hidden="true">  |  </span>')}</p></header>`;
}

export function cvHtml(cv, colourKey) {
  const L = LABELS[cv.lang] || LABELS.en;
  const item = (title, sub) => `<p><b>${esc(title)}</b></p><p class="pv-loc">${esc(sub)}</p>`;
  const list = (items) => (items?.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "");
  const body = sections(cv).map((s) => {
    let h = "";
    if (s === "summary") h = `<p>${esc(cv.summary)}</p>`;
    if (s === "experience") h = cv.experience.map((e) => `<div class="pv-item">${item(`${e.title}, ${e.company}`, meta(dateRange(e.start, e.end, cv.lang), e.location))}${list(e.bullets)}</div>`).join("");
    if (s === "skills") h = cv.skills.map((g) => `<p><b>${esc(g.group)}:</b> ${esc(g.items.join(", "))}</p>`).join("");
    if (s === "projects") h = cv.projects.map((p) => `<div class="pv-item"><p><b>${esc(p.name)}</b></p>${p.detail ? `<p>${esc(p.detail)}</p>` : ""}${list(p.bullets)}</div>`).join("");
    if (s === "education") h = cv.education.map((e) => `<div class="pv-item">${item(`${e.degree}, ${e.school}`, meta(dateRange(e.start, e.end, cv.lang), e.location, e.detail))}</div>`).join("");
    if (s === "certifications") h = cv.certifications.map((c) => `<p>${esc([c.name, c.issuer, c.year].filter(Boolean).join(", "))}</p>`).join("");
    if (s === "languages") h = `<p>${esc(langLine(cv.languages))}</p>`;
    return `<section><h3>${esc(L[s])}</h3>${h}</section>`;
  }).join("");
  return `<article class="paper" lang="${cv.lang}" style="--c:${(COLOURS[colourKey] || COLOURS.blue).hex}">${head(cv.name, cv.headline, cv.contact)}${body}</article>`;
}

export function letterHtml(l, colourKey) {
  return `<article class="paper letter" lang="${l.lang}" style="--c:${(COLOURS[colourKey] || COLOURS.blue).hex}">${head(l.name, "", l.contact)}<hr>
    <p class="pv-loc">${esc(l.date)}</p><p><b>${esc([l.recipient, l.company].filter(Boolean).join(", "))}</b></p>
    <p>${esc(l.greeting)}</p>${l.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
    <p>${esc(l.closing)}</p><p><b>${esc(l.name)}</b></p></article>`;
}
