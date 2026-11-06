// job-api: tailors a CV (and a cover letter) to one job ad with Claude.
//   POST /job     { url }                          reads a job ad from its link (free)
//   POST /review  { cv, job, company, ui }         a quick match check before paying for the CV (Haiku, ~$0.002)
//   POST /tailor  { cv, job, company, model, choices }  the tailored CV and letter
// Every call needs the header x-passcode.
// The money rules live here, where nobody can change them from the browser:
//  - a passcode (only the owner, for now), locked for an hour after 10 wrong tries
//  - prepaid credit per account: each run's real cost is taken from its balance
//  - a daily run limit per account, so a stuck loop cannot drain the credit
//  - the same request again is answered from the saved result, at no cost
import Anthropic from "@anthropic-ai/sdk";

const MODELS = {
  haiku: { id: "claude-haiku-5-5", in: 0.10, out: 0.50 },          // US dollars per million tokens
  sonnet: { id: "claude-sonnet-5-5", in: 2, out: 10 },
  opus: { id: "claude-opus-5-5", in: 4, out: 20 },
};
const LIMITS = { cv: 30000, job: 20000, company: 10000 };          // characters
const CACHE_DAYS = 30;

// ---- the answer's shape: exactly what the page's templates read (lib/cv.js) ----
const str = { type: "string" }, strs = { type: "array", items: str };
const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const list = (props) => ({ type: "array", items: obj(props) });
// Kept small on purpose: the API turns the schema into a grammar and refuses one that
// is too large. The contact block is defined once and reused; the letter always has
// the same shape (no anyOf) and is empty when there is no company text.
const SCHEMA = {
  ...obj({
    cv: obj({
      lang: str, name: str, headline: str, contact: { $ref: "#/$defs/contact" }, summary: str,
      skills: list({ group: str, items: strs }),
      experience: list({ title: str, company: str, location: str, start: str, end: str, bullets: strs }),
      projects: list({ name: str, detail: str, bullets: strs }),
      education: list({ degree: str, school: str, location: str, start: str, end: str, detail: str }),
      certifications: list({ name: str, issuer: str, year: str }),
      languages: list({ name: str, level: str }),
    }),
    letter: obj({ date: str, company: str, recipient: str, greeting: str, paragraphs: strs, closing: str }),
    keywords: strs,
    notes: obj({ changes: strs, gaps: strs }),
  }),
  $defs: { contact: obj({ email: str, phone: str, location: str, links: list({ label: str, url: str }) }) },
};

const REVIEW_SCHEMA = obj({
  role: str, company: str, score: { type: "integer" }, verdict: str,
  have: list({ term: str, evidence: str }),
  missing: list({ term: str, question: str }),
  suggestions: strs,
});

const SYSTEM = `You tailor a candidate's CV to one job ad, and write a cover letter when a company description is given.

TRUTH COMES FIRST
- Never add a skill, tool, employer, job title, date, degree, certification, number, result or responsibility that is not in the original CV or in the candidate's own confirmations (<candidate_choices>). Not even one that is likely.
- A confirmed item goes where it is true and fits (skills, or a role the candidate names), worded modestly; never invent numbers or results for it.
- You may reword, reorder, merge and shorten. Prefer merging over leaving out: keep every skill, method and responsibility from the CV that the ad mentions or that is standard for this kind of role (for example Agile/Scrum, test strategy, traceability). Leave out only what clearly does not help this job.
- Use the ad's exact words only where the CV already shows the same thing (CV "end-to-end tests with Playwright" and ad "E2E testing" → "end-to-end (E2E) testing with Playwright").
- Keep every number exactly as the CV gives it. Keep job titles as they were, except for obvious spelling fixes.
- Anything the ad asks for that the CV does not show (and the candidate did not confirm) goes in notes.gaps, never into the CV or the letter.

LANGUAGE
- Write in the language of the job ad: "en" (British English) or "pt" (European Portuguese, never Brazilian; impersonal and gender-neutral, no "tu" or "você").
- No first person in the CV ("Led the migration…", not "I led…"). The letter is in the first person.

THE CV (it must pass applicant tracking systems and AI screeners)
- name and contact: copied exactly from the CV. Links as full URLs. Empty string when missing.
- headline: the ad's job title if the experience truthfully supports it, otherwise the closest true title.
- summary: 2 to 4 sentences, the candidate's strongest true match to the ad's main requirements, using the ad's terms.
- experience: most recent first. 3 to 6 bullets for recent relevant roles, most relevant first, each starting with a strong verb and saying what was done and what it achieved. Older or unrelated roles get fewer bullets.
- skills: 3 to 6 groups; the ad's terms first; only skills the CV shows or the candidate confirmed.
- dates: "YYYY-MM" or "YYYY"; a current role ends with "present".
- Length: aim for one A4 page under 10 years of experience, but never cut content that answers the ad just to save space; two pages at most.
- Plain text only: no emoji, symbols, markdown, tables or special characters beyond normal punctuation.
- Leave arrays empty when the CV has nothing for them.

THE COVER LETTER (only when a company description is given)
- 3 or 4 paragraphs, 220 to 320 words. Specific, warm and plain; no clichés such as "I am writing to express my interest".
- Paragraph 1: the role and one honest reason this company (use their stated values or mission, in their words where natural).
- Paragraph 2 (and 3): two or three achievements from the CV that answer the ad's main needs.
- Last paragraph: what the candidate would bring, and a simple invitation to talk.
- greeting: "Dear Hiring Team," (pt: "Exma. Equipa de Recrutamento,"), or the person's name when the ad gives one.
- closing: "Kind regards," (pt: "Com os melhores cumprimentos,"). date: the given date, written out in the letter's language.
- With no company description, return the letter with every field empty and no paragraphs.

ALSO RETURN
- keywords: the 12 to 20 skills and terms the ad cares about most, in the ad's own short wording, most important first.
- notes.changes: 2 to 5 short sentences on what you changed and why.
- notes.gaps: the ad's requirements the CV does not show (empty when none).`;

const REVIEW_SYSTEM = `You check how well a CV matches one job ad, before a tailored CV is written. Be honest, specific and brief. Write every sentence in the interface language given; keep the ad's own terms as they are.
- role and company: from the ad (empty string if not named).
- score: 0 to 100, how much of what the ad requires the CV truthfully shows. Do not flatter.
- verdict: one sentence on the match and its main strength or gap.
- have: up to 12 of the ad's most important terms the CV already shows, most important first; evidence: 2 to 6 words saying where (e.g. "Euronext, test automation").
- missing: up to 8 things the ad asks for that the CV does not show, most important first; question: a short yes/no question asking the candidate whether they have it (e.g. "Have you worked with Kubernetes?").
- suggestions: 3 to 6 concrete changes for the tailored CV, one short imperative sentence each (e.g. "Lead the summary with event-driven testing"). Only reorder, reword or bring forward what the CV already shows; never suggest adding something it does not.`;

// ---- small helpers ----
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const day = () => new Date().toISOString().slice(0, 10);
const usd = (n) => `$${Math.abs(n) < 0.01 && n !== 0 ? n.toFixed(4) : n.toFixed(2)}`;
const clean = (v, max) => String(v ?? "").slice(0, max).trim();
const strList = (v, n, max) => (Array.isArray(v) ? v.slice(0, n).map((x) => clean(x, max)).filter(Boolean) : []);

function cors(req, env) {
  const origin = req.headers.get("origin") || "";
  const ok = env.ALLOWED_ORIGINS.split(",").includes(origin);
  return ok ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, x-passcode", "access-control-allow-methods": "POST, OPTIONS", "access-control-max-age": "600", vary: "origin" } : {};
}

// Who pays for this run. Today: the owner, by passcode. Later: an account with prepaid credits.
async function account(req, env) {
  const pass = req.headers.get("x-passcode") || "";
  // Both sides hashed, so the comparison always takes the same time
  if (pass && env.PASSCODE && sameText(await sha256(pass), await sha256(env.PASSCODE))) return "owner";
  return null;
}

// ---- credit: a prepaid balance per account, in dollars ----
async function balance(env, who) {
  const v = await env.JOB.get(`credit:${who}`);
  if (v !== null) return Number(v);
  // The owner's first balance; later, buying a pack adds to it
  const start = Number(env.START_CREDIT || 0);
  await env.JOB.put(`credit:${who}`, String(start));
  return start;
}
const charge = async (env, who, cost) => { const left = (await balance(env, who)) - cost; await env.JOB.put(`credit:${who}`, String(left)); return left; };
const costOf = (m, u = {}) => ((u.input_tokens || 0) * m.in + (u.cache_creation_input_tokens || 0) * m.in * 1.25 + (u.cache_read_input_tokens || 0) * m.in * 0.1 + (u.output_tokens || 0) * m.out) / 1e6;

// ---- reading a job ad from its link ----
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", bull: "•" };
function htmlText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/section|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// Most job sites describe the ad for search engines (schema.org JobPosting): the cleanest source
function jobPosting(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch (_) { continue; }
    const all = [data].flat().flatMap((d) => [d, ...(d?.["@graph"] || [])]);
    const p = all.find((d) => [d?.["@type"]].flat().includes("JobPosting"));
    if (p?.description) {
      const org = typeof p.hiringOrganization === "string" ? p.hiringOrganization : p.hiringOrganization?.name || "";
      return { title: htmlText(p.title || ""), company: htmlText(org), text: htmlText(p.description) };
    }
  }
  return null;
}
export async function readJob(raw) {
  let url; try { url = new URL(raw); } catch (_) { return null; }
  if (!/^https?:$/.test(url.protocol) || url.port || url.username || /^(localhost|[\d.]+|\[.*\])$/i.test(url.hostname) || !url.hostname.includes(".")) return null;
  // LinkedIn shows job pages only to signed-in people, but has a public page per job
  const li = url.hostname.endsWith("linkedin.com") && (url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/) || [null, url.searchParams.get("currentJobId")])[1];
  const target = li ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li}` : url.href;
  const res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(8000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; draft.appdoivo.com; reads one job ad on request)", accept: "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9,pt;q=0.8" } });
  if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
  const html = (await res.text()).slice(0, 2_000_000);
  if (li) {
    const desc = html.match(/class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    if (desc) return { title: htmlText(html.match(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || ""), company: htmlText(html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ""), text: htmlText(desc) };
  }
  const p = jobPosting(html);
  if (p && p.text.length > 200) return p;
  if (url.pathname.length < 2) return null;                       // a site's front page is not an ad
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || "";
  const text = htmlText(main);
  return text.length > 300 ? { title: htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""), company: "", text } : null;
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (!["/tailor", "/review", "/job"].includes(url.pathname) || req.method !== "POST") return json({ error: "not_found" }, 404, h);
    if (Number(req.headers.get("content-length") || 0) > 200_000) return json({ error: "too_large" }, 413, h);

    // Ten wrong passcodes from one address lock it out for an hour
    const ip = req.headers.get("cf-connecting-ip") || "?", failKey = `fail:${ip}`;
    const fails = Number((await env.JOB.get(failKey)) || 0);
    if (fails >= 10) return json({ error: "locked" }, 429, h);
    const who = await account(req, env);
    if (!who) { await env.JOB.put(failKey, String(fails + 1), { expirationTtl: 3600 }); return json({ error: "passcode" }, 401, h); }

    let input;
    // The size is checked on what actually arrived, not only on the header (which can be left out)
    const raw = await req.text();
    if (raw.length > 200_000) return json({ error: "too_large" }, 413, h);
    try { input = JSON.parse(raw); } catch (_) { return json({ error: "bad_request" }, 400, h); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "bad_request" }, 400, h);

    if (url.pathname === "/job") {
      const found = await readJob(clean(input.url, 2000)).catch(() => null);
      return found ? json({ ...found, text: found.text.slice(0, LIMITS.job) }, 200, h) : json({ error: "unreadable" }, 422, h);
    }

    const cv = clean(input.cv, LIMITS.cv), job = clean(input.job, LIMITS.job), company = clean(input.company, LIMITS.company);
    if (cv.length < 200 || job.length < 80) return json({ error: "too_short" }, 400, h);
    const review = url.pathname === "/review";
    const ui = input.ui === "pt" ? "pt" : "en";
    const model = review ? "haiku" : MODELS[input.model] ? input.model : "sonnet";
    // What the candidate decided on the review board
    const c = input.choices || {};
    const choices = review ? null : {
      confirmed: (Array.isArray(c.confirmed) ? c.confirmed.slice(0, 12) : []).map((x) => ({ term: clean(x?.term, 80), note: clean(x?.note, 160) })).filter((x) => x.term),
      apply: strList(c.apply, 8, 200), skip: strList(c.skip, 8, 200),
    };

    // The same request again: the saved answer, free
    const key = `cache:${await sha256(JSON.stringify([url.pathname, model, cv, job, company, review ? ui : choices]))}`;
    const left = await balance(env, who);
    const saved = await env.JOB.get(key, "json");
    if (saved) return json({ ...saved, cached: true, cost: usd(0), balance: usd(left) }, 200, h);

    if (left <= 0) return json({ error: "credit", balance: usd(left) }, 402, h);
    const runsKey = `runs:${who}:${day()}`, runs = Number((await env.JOB.get(runsKey)) || 0);
    if (runs >= Number(env.DAILY_RUNS || 40)) return json({ error: "daily_limit" }, 429, h);

    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    let user = `Today's date: ${today}\n\n<cv>\n${cv}\n</cv>\n\n<job_ad>\n${job}\n</job_ad>\n\n` +
      (company ? `<company>\n${company}\n</company>` : "<company>(none: leave the letter empty)</company>");
    if (review) user = `Interface language: ${ui === "pt" ? "European Portuguese" : "British English"}\n\n<cv>\n${cv}\n</cv>\n\n<job_ad>\n${job}\n</job_ad>`;
    else if (choices.confirmed.length || choices.apply.length || choices.skip.length) {
      user += "\n\n<candidate_choices>" +
        (choices.confirmed.length ? `\nThe candidate confirms these are true (not in the CV text; include them only where they fit):\n${choices.confirmed.map((x) => `- ${x.term}${x.note ? `: ${x.note}` : ""}`).join("\n")}` : "") +
        (choices.apply.length ? `\nApply these changes:\n${choices.apply.map((x) => `- ${x}`).join("\n")}` : "") +
        (choices.skip.length ? `\nDo not make these changes:\n${choices.skip.map((x) => `- ${x}`).join("\n")}` : "") +
        "\n</candidate_choices>";
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const m = MODELS[model], schema = review ? REVIEW_SCHEMA : SCHEMA;
    // Sonnet and Opus: if a safety filter ever declines, the API retries on a suitable model by itself
    const fallback = model === "haiku" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
    const ask = (strict) => client.beta.messages.create({
      model: m.id, max_tokens: review ? 3000 : 16000, system: review ? REVIEW_SYSTEM : SYSTEM,
      messages: [{ role: "user", content: strict ? user : `${user}\n\nReply with only one JSON object, no other text, following this JSON schema:\n${JSON.stringify(schema)}` }],
      output_config: strict ? { effort: review ? "low" : "medium", format: { type: "json_schema", schema } } : { effort: review ? "low" : "medium" },
      ...fallback,
    });
    let res;
    try {
      try { res = await ask(true); }
      catch (e) {
        // The schema itself refused (nothing was generated or charged): plain JSON instead
        if (e?.status !== 400 || !/grammar|schema/i.test(e?.error?.error?.message || "")) throw e;
        console.error("schema_refused", e?.error?.error?.message);
        res = await ask(false);
      }
    } catch (e) {
      // What the API said (type and message only: never the key or the CV)
      console.error("ai_error", e?.status, e?.error?.error?.type, e?.error?.error?.message || e?.message);
      return json({ error: "ai", detail: e?.status || "" }, e instanceof Anthropic.RateLimitError ? 429 : 502, h);
    }
    await env.JOB.put(runsKey, String(runs + 1), { expirationTtl: 2 * 86400 });

    // What it cost, taken from the credit even when the answer is unusable (the tokens were spent)
    const cost = costOf(m, res.usage), after = await charge(env, who, cost);
    const paid = { cost: usd(cost), balance: usd(after) };

    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return json({ error: res.stop_reason, ...paid }, 502, h);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let out;
    try { out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch (_) { return json({ error: "parse", ...paid }, 502, h); }
    if (review) {
      if (!Array.isArray(out?.have)) return json({ error: "parse", ...paid }, 502, h);
      out.score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
    } else {
      if (!out?.cv?.name && !out?.cv?.experience?.length) return json({ error: "parse", ...paid }, 502, h);
      out.cv.lang = /^pt/i.test(out.cv.lang || "") ? "pt" : "en";
      // The page reads the letter as the CV's sibling with its own lang, name and contact
      out.letter = out.letter?.paragraphs?.length ? { ...out.letter, lang: out.cv.lang, name: out.cv.name, contact: out.cv.contact } : null;
    }
    await env.JOB.put(key, JSON.stringify(out), { expirationTtl: CACHE_DAYS * 86400 });
    return json({ ...out, cached: false, model, ...paid }, 200, h);
  },
};
