# job.appdoivo.com

**Job**: upload a CV, paste a job ad (and, optionally, what the company stands for), and get
a CV tailored to that job, plus a cover letter, both built to pass applicant tracking systems
(ATS) and AI screeners. Nothing is invented: the AI may only reword, reorder and bring forward
what the CV already shows; what the ad asks for and the CV lacks is listed as a gap instead.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| The page | `index.html`, `app.js`, `job.css`, `words.js` | The machine: one box, one step at a time (CV, job, company, tailor) with Back/Continue, live validation, character limits matching the AI service, and what it understood shown under each input (name/contact/roles from the CV, the job's key terms, the company's values, a summary before tailoring). The result preview appears below. EN/PT, light/dark. |
| The CV shape | `lib/cv.js` | One description of a CV and a letter. The AI fills it; every output reads only it. Also the section titles, the five colours and a made-up example person. |
| PDF | `lib/pdf.js` | One column, real text in reading order, Helvetica, standard section titles, dates under each title (never at the right edge, where some parsers lose them), no tables, images or text boxes. pdf-lib. |
| Word | `lib/docx.js` | Real Word headings and bullets, Calibri, same layout. docx. |
| ATS check | `lib/ats.js` | Reads the finished PDF back with pdf.js, like a parser: text, name, contact, section titles and order, images, pages, dates under their job, file name, and how many of the ad's keywords the CV covers (the AI's list, or a local count as fallback). |
| Preview | `lib/preview.js` | The same layout as HTML. |
| AI service | `worker/` | A Cloudflare Worker that holds the Anthropic key. Passcode, monthly dollar cap and daily run limit per account, saved answers (the same CV + job costs nothing twice), cost of every run. Claude with a strict JSON schema. |

The colours (purple, blue, red, green, yellow) touch only headings and lines, and each one is
dark enough to read as text on white and to print in black and white.

## Cost

About $0.003 (Haiku), $0.05 (Sonnet, the default) or $0.10 (Opus) per CV + cover letter.
The worker refuses new runs past `MONTHLY_CAP_USD` (default $3); set a spending limit in the
Anthropic console as a second lock.

## Connecting the AI (once)

1. Create an API key at console.anthropic.com (its own key, so its spending shows on its own).
2. In `worker/`: `npx wrangler kv namespace create JOB`, put the id in `wrangler.toml`, then
   `npx wrangler secret put ANTHROPIC_API_KEY` and `npx wrangler secret put PASSCODE_HASH`
   (the SHA-256 of the passcode), and `npm run deploy`.
3. Route the worker to `job-api.appdoivo.com`.

## Later

Accounts with prepaid credits: spending is already kept per account (`spend:<account>:<month>`),
so credits change who pays, not how runs are counted.

## Tests

`npm test` (Playwright, desktop Chrome and iPhone/WebKit): the example passes every ATS check,
the downloads have clean names and read back in order, colours, the passcode and cap flows
(with the AI service faked), Portuguese words, sideways scroll, touch targets, accessibility.
The worker's passcode, cap and saved-answer rules were checked with `wrangler dev` and a fake key.

Libraries in `vendor/`: pdf-lib (MIT), pdf.js (Apache-2.0), mammoth (BSD-2), docx (MIT).
