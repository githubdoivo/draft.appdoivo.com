// Reading a LinkedIn job link (APP-DR-005): LinkedIn often answers "busy" to a first request, Share can give a short
// lnkd.in link, and a link that really can't be read must still say so. LinkedIn is faked here: no request leaves the machine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readJob } from "../src/index.js";

const AD = `<h2 class="top-card-layout__title">Senior Quality Engineer</h2><a class="topcard__org-name-link" href="#">Five9</a>
<div class="show-more-less-html__markup">Join us in bringing joy to customer experience. ${"We test with Playwright. ".repeat(20)}</div>`;
const html = (body, url) => { const r = new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }); if (url) Object.defineProperty(r, "url", { value: url }); return r; };
const busy = () => new Response("busy", { status: 429 });
const real = globalThis.fetch; let calls = [];
const fake = (answers) => { calls = []; globalThis.fetch = async (u) => { calls.push(String(u)); const a = answers[calls.length - 1]; if (a === "throw") throw new Error("timeout"); return a ? a() : busy(); }; };
afterEach(() => { globalThis.fetch = real; });
const ID = "4486077010", GUEST = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${ID}`, VIEW = `https://www.linkedin.com/jobs/view/${ID}/`;

test("happy: every shape of a LinkedIn job link reads the same public page, in one request", async () => {
  for (const link of [`https://www.linkedin.com/jobs/view/${ID}/`, `https://www.linkedin.com/jobs/view/${ID}`, `https://www.linkedin.com/jobs/view/${ID}/?utm_source=share&trk=public_jobs`,
    `https://pt.linkedin.com/jobs/view/senior-quality-engineer-at-five9-${ID}?position=1`, `https://www.linkedin.com/comm/jobs/view/${ID}/`, `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=${ID}`, `https://www.linkedin.com/jobs/search/?currentJobId=${ID}&keywords=qa`]) {
    fake([() => html(AD)]);
    const job = await readJob(link, 0);
    assert.equal(job?.title, "Senior Quality Engineer", link); assert.equal(job.company, "Five9"); assert.match(job.text, /^Join us/);
    assert.deepEqual(calls, [GUEST], link);
  }
});
test("busy once: the second public page is read", async () => {
  fake([busy, () => html(AD)]);
  assert.equal((await readJob(VIEW, 0))?.company, "Five9"); assert.deepEqual(calls, [GUEST, VIEW]);
});
test("busy twice (or a timeout): the first page is tried once more after a short wait, and read", async () => {
  fake([busy, "throw", () => html(AD)]);
  const t = Date.now(); const job = await readJob(VIEW, 60);
  assert.equal(job?.title, "Senior Quality Engineer"); assert.deepEqual(calls, [GUEST, VIEW, GUEST]); assert.ok(Date.now() - t >= 50, "it waited before the last try");
});
test("a page that answers without the ad (a sign-in wall) counts as not read: the next page is tried", async () => {
  fake([() => html("<html><body>Sign in to LinkedIn</body></html>"), () => html(AD)]);
  assert.equal((await readJob(VIEW, 0))?.company, "Five9"); assert.equal(calls.length, 2);
});
test("negative: busy three times gives up after exactly three requests, with no ad", async () => {
  fake([busy, busy, busy, () => html(AD)]);
  assert.equal(await readJob(VIEW, 0), null); assert.equal(calls.length, 3);
});
test("a short lnkd.in share link is followed to its job", async () => {
  fake([() => html("<html>redirected</html>", `https://www.linkedin.com/jobs/view/${ID}?trk=share`), () => html(AD)]);
  assert.equal((await readJob("https://lnkd.in/dAbC123", 0))?.title, "Senior Quality Engineer"); assert.deepEqual(calls, ["https://lnkd.in/dAbC123", GUEST]);
});
test("edge: a short link that goes nowhere, a look-alike site, and a made-up job number are not treated as LinkedIn jobs", async () => {
  fake(["throw"]); assert.equal(await readJob("https://lnkd.in/gone", 0), null); assert.equal(calls.length, 1);
  fake([() => html(AD)]); await readJob(`https://notlinkedin.com/jobs/view/${ID}/`, 0); assert.deepEqual(calls, [`https://notlinkedin.com/jobs/view/${ID}/`], "a look-alike is read as an ordinary page, never sent to LinkedIn");
  fake([() => html("<html><body>short</body></html>")]); assert.equal(await readJob("https://www.linkedin.com/jobs/search/?currentJobId=abc", 0), null); assert.equal(calls.length, 1);
});
