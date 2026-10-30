// The shape of a CV and a cover letter. The AI fills this shape; every output
// (preview, PDF, Word, the ATS check) reads only this shape, so the look and the
// rules live in one place and a new output is one more renderer.
//
// cv = {
//   lang: "en" | "pt",
//   name, headline,                                  // headline: the role this CV is for
//   contact: { email, phone, location, links: [{ label, url }] },
//   summary,                                         // 2-4 sentences, plain text
//   skills: [{ group, items: [] }],
//   experience: [{ title, company, location, start, end, bullets: [] }],   // dates "2021-03", end "present"
//   projects: [{ name, detail, bullets: [] }],
//   education: [{ degree, school, location, start, end, detail }],
//   certifications: [{ name, issuer, year }],
//   languages: [{ name, level }],
// }
// letter = { lang, date, company, recipient, greeting, paragraphs: [], closing, name, contact }

// Section titles that applicant tracking systems recognise, in both languages
export const LABELS = {
  en: { summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects", education: "Education",
    certifications: "Certifications", languages: "Languages", present: "Present",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
  pt: { summary: "Resumo", skills: "Competências", experience: "Experiência Profissional", projects: "Projetos", education: "Formação",
    certifications: "Certificações", languages: "Línguas", present: "Atual",
    months: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"] },
};

// The five colours for headings and lines. Each is dark enough to read as text on
// white (4.5:1 or more) and to print well in black and white.
export const COLOURS = {
  purple: { hex: "#5b3fa8", rgb: [0.357, 0.247, 0.659] },
  blue: { hex: "#1f4e99", rgb: [0.122, 0.306, 0.6] },
  red: { hex: "#a3262e", rgb: [0.639, 0.149, 0.18] },
  green: { hex: "#2e6b3f", rgb: [0.18, 0.42, 0.247] },
  yellow: { hex: "#8a5f00", rgb: [0.541, 0.373, 0] },          // a deep mustard: real yellow is unreadable on white
};

// "2021-03" → "Mar 2021"; "present" → "Present"; a bare year stays a year
export function fmtDate(d, lang) {
  const L = LABELS[lang] || LABELS.en;
  if (!d) return "";
  if (/^present|atual|now$/i.test(d)) return L.present;
  const m = /^(\d{4})-(\d{2})/.exec(d);
  return m ? `${L.months[+m[2] - 1]} ${m[1]}` : String(d);
}
export const dateRange = (a, b, lang) => [fmtDate(a, lang), fmtDate(b, lang)].filter(Boolean).join(" – ");

// The grey line under a title: "Feb 2022 – Present | Porto, Portugal"
export const meta = (...parts) => parts.filter(Boolean).join("  |  ");
// "English: Fluent (C1); Portuguese: Native"
export const langLine = (langs) => langs.map((l) => (l.level ? `${l.name}: ${l.level}` : l.name)).join("; ");

// The sections in the order recruiters and parsers expect
export function sections(cv) {
  const out = [];
  if (cv.summary) out.push("summary");
  if (cv.experience?.length) out.push("experience");
  if (cv.skills?.length) out.push("skills");
  if (cv.projects?.length) out.push("projects");
  if (cv.education?.length) out.push("education");
  if (cv.certifications?.length) out.push("certifications");
  if (cv.languages?.length) out.push("languages");
  return out;
}

// The contact line: email | phone | location | links (written out in full, so a parser can read them)
export const contactParts = (c = {}) => [c.email, c.phone, c.location, ...(c.links || []).map((l) => l.url.replace(/^https?:\/\/(www\.)?/, ""))].filter(Boolean);

// A file name parsers and recruiters both like: First-Last-CV.pdf
export const fileName = (name, kind, ext) => `${(name || "CV").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${kind}.${ext}`;

// A made-up person, for the example and the tests. Never put real CV data in this public repo.
export const SAMPLE = {
  cv: {
    lang: "en", name: "Alex Morgan", headline: "Senior QA Automation Engineer",
    contact: { email: "alex.morgan@example.com", phone: "+351 910 000 000", location: "Porto, Portugal", links: [{ label: "LinkedIn", url: "https://linkedin.com/in/alexmorgan-example" }] },
    summary: "QA automation engineer with 7 years of experience building reliable test suites for payment and trading platforms. Designs Playwright and Cucumber frameworks in TypeScript, runs them in CI/CD pipelines, and turns flaky suites into trusted release gates.",
    experience: [
      { title: "Senior QA Automation Engineer", company: "Northwind Payments", location: "Porto, Portugal", start: "2022-02", end: "present", bullets: [
        "Built a Playwright and TypeScript end-to-end framework covering 420 checkout scenarios across web and mobile web.",
        "Cut regression time from 2 days to 40 minutes by running suites in parallel in GitHub Actions.",
        "Reduced flaky tests from 9% to under 1% by replacing fixed waits with event-based checks.",
      ] },
      { title: "QA Engineer", company: "Contoso Markets", location: "Lisbon, Portugal", start: "2019-01", end: "2022-01", bullets: [
        "Automated REST API tests with Rest Assured and Postman for the order-routing service.",
        "Wrote Gherkin scenarios with product owners, used as living documentation for 3 teams.",
      ] },
    ],
    skills: [
      { group: "Test Automation", items: ["Playwright", "Cypress", "Selenium", "Cucumber (BDD)"] },
      { group: "Languages", items: ["TypeScript", "Java", "SQL"] },
      { group: "CI/CD and Tools", items: ["GitHub Actions", "Docker", "Jira", "Xray"] },
    ],
    education: [{ degree: "BSc in Computer Engineering", school: "University of Porto", location: "Porto, Portugal", start: "2014", end: "2018", detail: "" }],
    certifications: [{ name: "ISTQB Certified Tester, Foundation Level", issuer: "ISTQB", year: "2019" }],
    languages: [{ name: "English", level: "Fluent (C1)" }, { name: "Portuguese", level: "Native" }],
    projects: [],
  },
  letter: {
    lang: "en", date: "30 October 2026", company: "Fabrikam Health", recipient: "Hiring Team",
    greeting: "Dear Hiring Team,",
    paragraphs: [
      "I am applying for the Senior QA Automation Engineer role at Fabrikam Health. Your focus on safe, dependable software for patients matches how I work: I build test suites that teams trust enough to release on.",
      "At Northwind Payments I built a Playwright and TypeScript framework that now covers 420 checkout scenarios and runs in 40 minutes instead of 2 days. I also brought flaky tests down from 9% to under 1%, so a red build means a real problem.",
      "Fabrikam's value of “care in every detail” is the reason I would like to join. I would bring the same care to your release process, and I would welcome the chance to talk about it.",
    ],
    closing: "Kind regards,", name: "Alex Morgan",
    contact: { email: "alex.morgan@example.com", phone: "+351 910 000 000", location: "Porto, Portugal", links: [] },
  },
  // What the AI returns as the ad's key skills and terms (the local count is only a fallback)
  keywords: ["test automation", "Playwright", "TypeScript", "CI/CD", "GitHub Actions", "REST APIs", "API testing", "BDD", "Gherkin",
    "end-to-end testing", "accessibility testing", "performance testing", "Docker", "agile"],
  job: "Senior QA Automation Engineer. Fabrikam Health is looking for a QA automation engineer to own end-to-end testing of our patient portal. You will design Playwright tests in TypeScript, integrate them into CI/CD pipelines (GitHub Actions), test REST APIs, and work with product owners using BDD and Gherkin. Experience with accessibility testing, performance testing and Docker is a plus. Requirements: 5+ years in test automation, strong TypeScript, CI/CD, API testing, agile teams.",
  company: "Fabrikam Health builds software that helps clinics care for patients. Our values: care in every detail, honesty, and learning together.",
};
