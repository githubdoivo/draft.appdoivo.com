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

test("no passcode: every AI endpoint says 401; reading a link is free (no AI) and needs none", async () => {
  for (const p of ["/tailor", "/review", "/interview"]) assert.equal((await call(p)).status, 401, p);
  assert.notEqual((await call("/job", { body: { url: "not a link" } })).status, 401, "/job is open");
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

// ---- accounts (APP-DR-003): a real passkey made here, so the whole path is checked ----
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString("base64url");
function cborEnc(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  if (typeof v === "number") return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === "string") { const b = enc.encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  if (v instanceof Map) { const parts = [Uint8Array.from(head(5, v.size))]; for (const [k, x] of v) parts.push(cborEnc(k), cborEnc(x)); return Uint8Array.from(parts.flatMap((p) => [...p])); }
  throw new Error("cbor");
}
async function makePasskey() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey), credId = crypto.getRandomValues(new Uint8Array(16));
  return { kp, credId, cose: cborEnc(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]])) };
}
const rpHash = async () => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(new URL(SITE).hostname)));
const clientData = (type, challenge, origin = SITE) => enc.encode(JSON.stringify({ type, challenge, origin }));
function rawToDer(raw) {   // WebCrypto signs r||s; passkeys send DER, which the worker turns back
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [2, b.length, ...b]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32)); return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];

test("accounts: Face ID creates an account with 5 credits; signing in works; a failed run costs nothing", async () => {
  const me0 = await (await call("/me", { method: "GET" })).json();
  assert.equal(me0.signedIn, false); assert.equal(me0.start, 5); assert.equal(me0.prices["/tailor"], 3);
  // signed out: asked to sign in, and it doesn't count as a wrong passcode
  const r0 = await call("/tailor", { body: { cv: "x".repeat(300), job: "y".repeat(100) } });
  assert.equal(r0.status, 401); assert.equal((await r0.json()).error, "signin");
  // create
  const o = await (await call("/account/options", { body: { mode: "create", name: "Alex" } })).json();
  assert.equal(o.rp.id, "draft.appdoivo.com");
  const pk = await makePasskey();
  const ad = Uint8Array.from([...(await rpHash()), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 16, ...pk.credId, ...pk.cose]);
  const att = cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]));
  const cr = await call("/account/create", { body: { name: "Alex", userId: o.user.id, clientDataJSON: b64u(clientData("webauthn.create", o.challenge)), attestationObject: b64u(att) } });
  assert.equal(cr.status, 200); const acc = await cr.json(); assert.equal(acc.credits, 5); assert.equal(acc.name, "Alex");
  const cookie = cookieOf(cr); assert.match(cookie, /^dsess=/);
  // the same challenge can't be used twice
  const again = await call("/account/create", { body: { name: "Alex", userId: o.user.id, clientDataJSON: b64u(clientData("webauthn.create", o.challenge)), attestationObject: b64u(att) } });
  assert.equal(again.status, 400);
  const me1 = await (await call("/me", { method: "GET", headers: { cookie } })).json(); assert.equal(me1.signedIn, true); assert.equal(me1.credits, 5);
  // sign in with the passkey
  const so = await (await call("/account/options", { body: {} })).json();
  const ad2 = Uint8Array.from([...(await rpHash()), 0x05, 0, 0, 0, 1]), cd2 = clientData("webauthn.get", so.challenge);
  const signed = Uint8Array.from([...ad2, ...new Uint8Array(await crypto.subtle.digest("SHA-256", cd2))]);
  const sig = rawToDer(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pk.kp.privateKey, signed)));
  const si = await call("/account/signin", { body: { id: b64u(pk.credId), clientDataJSON: b64u(cd2), authenticatorData: b64u(ad2), signature: b64u(sig) } });
  assert.equal(si.status, 200); assert.equal((await si.json()).credits, 5);
  // a tampered signature is refused
  const so2 = await (await call("/account/options", { body: {} })).json(), cd3 = clientData("webauthn.get", so2.challenge);
  const bad = await call("/account/signin", { body: { id: b64u(pk.credId), clientDataJSON: b64u(cd3), authenticatorData: b64u(ad2), signature: b64u(sig) } });
  assert.equal(bad.status, 401);
  // a run that fails (the fake AI key) takes no credits
  const t = await call("/tailor", { headers: { cookie }, body: { cv: "Alex Morgan, QA engineer. ".repeat(20), job: "We need a QA engineer with Playwright. ".repeat(5) } });
  assert.notEqual(t.status, 200);
  assert.equal((await (await call("/me", { method: "GET", headers: { cookie } })).json()).credits, 5);
  // sign out ends the session
  await call("/account/signout", { headers: { cookie } });
  assert.equal((await (await call("/me", { method: "GET", headers: { cookie } })).json()).signedIn, false);
});

test("accounts: a forged session or another site gets nothing", async () => {
  const r = await call("/tailor", { headers: { cookie: "dsess=forged" }, body: { cv: "x".repeat(300), job: "y".repeat(100) } });
  assert.equal(r.status, 401);
  assert.equal((await call("/account/options", { origin: "https://evil.example", body: { mode: "create" } })).status, 404);
  assert.equal((await call("/account/create", { body: { attestationObject: "!!", clientDataJSON: "!!" } })).status, 400);
});
