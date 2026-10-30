// job-api: tailors a CV (and a cover letter) to one job ad with Claude.
// POST /tailor  { cv, job, company, model, ui }  header x-passcode
// The money rules live here, where nobody can change them from the browser:
//  - a passcode (only the owner, for now)
//  - a monthly cap in dollars and a daily run limit, per account
//  - the same CV + job + company + model is answered from the saved result, at no cost
// Spending is kept per account ("owner" today), so prepaid credits per user can be
// added later by changing who pays, not how runs are counted.
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
const contact = obj({ email: str, phone: str, location: str, links: { type: "array", items: obj({ label: str, url: str }) } });
const SCHEMA = obj({
  cv: obj({
    lang: { type: "string", enum: ["en", "pt"] }, name: str, headline: str, contact, summary: str,
    skills: { type: "array", items: obj({ group: str, items: strs }) },
    experience: { type: "array", items: obj({ title: str, company: str, location: str, start: str, end: str, bullets: strs }) },
    projects: { type: "array", items: obj({ name: str, detail: str, bullets: strs }) },
    education: { type: "array", items: obj({ degree: str, school: str, location: str, start: str, end: str, detail: str }) },
    certifications: { type: "array", items: obj({ name: str, issuer: str, year: str }) },
    languages: { type: "array", items: obj({ name: str, level: str }) },
  }),
  letter: { anyOf: [{ type: "null" }, obj({
    lang: { type: "string", enum: ["en", "pt"] }, date: str, company: str, recipient: str, greeting: str,
    paragraphs: strs, closing: str, name: str, contact,
  })] },
  keywords: strs,
  notes: obj({ changes: strs, gaps: strs }),
});

const SYSTEM = `You tailor a candidate's CV to one job ad, and write a cover letter when a company description is given.

TRUTH COMES FIRST
- Never add a skill, tool, employer, job title, date, degree, certification, number, result or responsibility that is not in the original CV. Not even one that is likely.
- You may reword, reorder, merge, shorten, and leave out what does not help this job.
- Use the ad's exact words only where the CV already shows the same thing (CV "end-to-end tests with Playwright" and ad "E2E testing" → "end-to-end (E2E) testing with Playwright").
- Keep every number exactly as the CV gives it. Keep job titles as they were, except for obvious spelling fixes.
- Anything the ad asks for that the CV does not show goes in notes.gaps, never into the CV or the letter.

LANGUAGE
- Write in the language of the job ad: "en" (British English) or "pt" (European Portuguese, never Brazilian; impersonal and gender-neutral, no "tu" or "você").
- No first person in the CV ("Led the migration…", not "I led…"). The letter is in the first person.

THE CV (it must pass applicant tracking systems and AI screeners)
- name and contact: copied exactly from the CV. Links as full URLs. Empty string when missing.
- headline: the ad's job title if the experience truthfully supports it, otherwise the closest true title.
- summary: 2 to 4 sentences, the candidate's strongest true match to the ad's main requirements, using the ad's terms.
- experience: most recent first. 2 to 5 bullets per role, most relevant first, each starting with a strong verb and saying what was done and what it achieved. Older or unrelated roles get fewer bullets.
- skills: 2 to 5 groups; the ad's terms first; only skills the CV shows.
- dates: "YYYY-MM" or "YYYY"; a current role ends with "present".
- Keep it to one page for under 10 years of experience, two pages at most.
- Plain text only: no emoji, symbols, markdown, tables or special characters beyond normal punctuation.
- Leave arrays empty when the CV has nothing for them.

THE COVER LETTER (only when a company description is given; otherwise letter is null)
- 3 or 4 paragraphs, 220 to 320 words. Specific, warm and plain; no clichés such as "I am writing to express my interest".
- Paragraph 1: the role and one honest reason this company (use their stated values or mission, in their words where natural).
- Paragraph 2 (and 3): two or three achievements from the CV that answer the ad's main needs.
- Last paragraph: what the candidate would bring, and a simple invitation to talk.
- greeting: "Dear Hiring Team," (pt: "Exma. Equipa de Recrutamento,"), or the person's name when the ad gives one.
- closing: "Kind regards," (pt: "Com os melhores cumprimentos,"). date: the given date, written out in the letter's language. contact: as in the CV.

ALSO RETURN
- keywords: the 12 to 20 skills and terms the ad cares about most, in the ad's own short wording, most important first.
- notes.changes: 2 to 5 short sentences on what you changed and why.
- notes.gaps: the ad's requirements the CV does not show (empty when none).`;

// ---- small helpers ----
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const month = () => new Date().toISOString().slice(0, 7), day = () => new Date().toISOString().slice(0, 10);
const usd = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

function cors(req, env) {
  const origin = req.headers.get("origin") || "";
  const ok = env.ALLOWED_ORIGINS.split(",").includes(origin);
  return ok ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, x-passcode", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" } : {};
}

// Who pays for this run. Today: the owner, by passcode. Later: an account with prepaid credits.
async function account(req, env) {
  const pass = req.headers.get("x-passcode") || "";
  if (pass && sameText(await sha256(pass), env.PASSCODE_HASH || "")) return "owner";
  return null;
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname !== "/tailor" || req.method !== "POST") return json({ error: "not_found" }, 404, h);

    const who = await account(req, env);
    if (!who) return json({ error: "passcode" }, 401, h);

    let input;
    try { input = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400, h); }
    const cv = String(input.cv || "").slice(0, LIMITS.cv).trim(), job = String(input.job || "").slice(0, LIMITS.job).trim();
    const company = String(input.company || "").slice(0, LIMITS.company).trim();
    const model = MODELS[input.model] ? input.model : "sonnet";
    if (cv.length < 200 || job.length < 80) return json({ error: "too_short" }, 400, h);

    const cap = Number(env.MONTHLY_CAP_USD || 3), spentKey = `spend:${who}:${month()}`, runsKey = `runs:${who}:${day()}`;
    const spent = Number((await env.JOB.get(spentKey)) || 0);
    const status = () => ({ month: usd(spent), cap: usd(cap) });

    // The same request again: the saved answer, free
    const key = `cache:${await sha256(JSON.stringify([model, cv, job, company]))}`;
    const saved = await env.JOB.get(key, "json");
    if (saved) return json({ ...saved, cached: true, cost: usd(0), ...status() }, 200, h);

    if (spent >= cap) return json({ error: "cap", ...status() }, 402, h);
    const runs = Number((await env.JOB.get(runsKey)) || 0);
    if (runs >= Number(env.DAILY_RUNS || 40)) return json({ error: "daily_limit" }, 429, h);

    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const user = `Today's date: ${today}\n\n<cv>\n${cv}\n</cv>\n\n<job_ad>\n${job}\n</job_ad>\n\n` +
      (company ? `<company>\n${company}\n</company>` : "<company>(none: set letter to null)</company>");

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const m = MODELS[model];
    let res;
    try {
      // Sonnet and Opus: if a safety filter ever declines, the API retries on a suitable model by itself
      const fallback = model === "haiku" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
      res = await client.beta.messages.create({
        model: m.id, max_tokens: 16000, system: SYSTEM,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        ...fallback,
      });
    } catch (e) {
      const status = e instanceof Anthropic.RateLimitError ? 429 : 502;
      return json({ error: "ai", detail: e?.status || "" }, status, h);
    }
    await env.JOB.put(runsKey, String(runs + 1), { expirationTtl: 2 * 86400 });

    // What it cost, counted even when the answer is unusable (the tokens were spent)
    const u = res.usage || {};
    const cost = ((u.input_tokens || 0) * m.in + (u.cache_creation_input_tokens || 0) * m.in * 1.25 + (u.cache_read_input_tokens || 0) * m.in * 0.1 + (u.output_tokens || 0) * m.out) / 1e6;
    const total = spent + cost;
    await env.JOB.put(spentKey, String(total), { expirationTtl: 40 * 86400 });

    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return json({ error: res.stop_reason, cost: usd(cost) }, 502, h);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let out;
    try { out = JSON.parse(text); } catch (_) { return json({ error: "parse", cost: usd(cost) }, 502, h); }

    await env.JOB.put(key, JSON.stringify(out), { expirationTtl: CACHE_DAYS * 86400 });
    return json({ ...out, cached: false, model, cost: usd(cost), month: usd(total), cap: usd(cap) }, 200, h);
  },
};
