// Attack-style tests for job-api, run locally (wrangler's local runtime, a fake AI key and a
// throwaway KV store): nothing real is reached or paid for.
//  - no passcode, wrong passcode, wrong site, wrong method or path: refused
//  - hostile bodies: always a clear 4xx, never a crash
//  - the link reader refuses anything that is not a public web page (internal addresses,
//    other schemes, credentials in the link)
//  - ten wrong passcodes lock the address, even for the right passcode
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

const PASS = "test-passcode-only-here";
const SITE = "https://draft.appdoivo.com";
let w;
// Local storage survives between runs, so each run (and the lockout test) uses its own address
const RUN_IP = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

before(async () => {
  w = await unstable_dev("src/index.js", {
    config: "wrangler.toml", local: true, logLevel: "none",
    vars: { PASSCODE: PASS, ANTHROPIC_API_KEY: "sk-ant-fake-for-tests", START_CREDIT: "5", ALLOWED_ORIGINS: SITE, DAILY_RUNS: "40" },
    experimental: { disableExperimentalWarning: true },
  });
});
after(async () => { await w?.stop(); });

const call = (path, { pass, body, raw, method = "POST", origin = SITE, headers = {} } = {}) =>
  w.fetch(path, { method, headers: { "content-type": "application/json", origin, "cf-connecting-ip": RUN_IP, ...(pass ? { "x-passcode": pass } : {}), ...headers },
    body: method === "GET" ? undefined : raw !== undefined ? raw : JSON.stringify(body ?? {}) });

test("no passcode: every endpoint says 401", async () => {
  for (const p of ["/tailor", "/review", "/job"]) assert.equal((await call(p)).status, 401, p);
});

test("unknown paths and methods are 404, and another site gets no CORS permission", async () => {
  assert.equal((await call("/admin", { pass: PASS })).status, 404);
  assert.equal((await call("/tailor", { pass: PASS, method: "GET" })).status, 404);
  assert.equal((await call("/../tailor", { pass: PASS, method: "GET" })).status, 404);
  const evil = await call("/review", { origin: "https://evil.example" });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

test("hostile bodies with the right passcode: always a clear 4xx, never a crash", async () => {
  const bodies = [
    { raw: "{" }, { raw: "null" }, { raw: "[]" }, { raw: '"x"' }, { raw: "" },
    { body: { cv: {}, job: [] } }, { body: { cv: null, job: 1e308 } }, { body: { cv: ["a"], job: { a: 1 } } },
    { body: { cv: "x", job: "y", model: "../../etc" } }, { body: { __proto__: { cv: "a".repeat(500) } } },
    { body: { cv: "short", job: "short", choices: { confirmed: "x".repeat(10) } } },
  ];
  for (const p of ["/review", "/tailor"]) for (const b of bodies) {
    const r = await call(p, { pass: PASS, ...b });
    assert.ok(r.status >= 400 && r.status < 500, `${p} ${JSON.stringify(b).slice(0, 60)} -> ${r.status}`);
  }
  const big = await call("/tailor", { pass: PASS, raw: JSON.stringify({ cv: "a".repeat(300000) }) });
  assert.equal(big.status, 413);
});

test("the link reader refuses anything that is not a public web page", async () => {
  const links = ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x", "https://user:pw@example.com/job",
    "https://example.com:8443/job", "not a url", "", "a".repeat(5000), "http://0x7f000001/", "http://2130706433/"];
  for (const url of links) {
    const r = await call("/job", { pass: PASS, body: { url } });
    assert.equal(r.status, 422, `${url.slice(0, 50)} -> ${r.status}`);
  }
});

test("ten wrong passcodes lock the address for an hour, even for the right passcode", async () => {
  const headers = { "cf-connecting-ip": `203.0.113.${Math.floor(Math.random() * 250) + 1}` };                      // an address of its own
  for (let i = 0; i < 10; i++) assert.equal((await call("/review", { pass: `wrong${i}`, headers })).status, 401);
  const r = await call("/review", { pass: PASS, body: {}, headers });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, "locked");
});
