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

let ip = RUN_IP;                                               // account calls are limited per address: later groups of tests use their own
const freshIp = () => { ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`; };
const call = (path, { pass, body, raw, method = "POST", origin = SITE, headers = {} } = {}) =>
  w.fetch(path, { method, headers: { "content-type": "application/json", origin, "cf-connecting-ip": ip, ...(pass ? { "x-passcode": pass } : {}), ...headers },
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
  const code = (await (await call("/admin/invite", { pass: PASS })).json()).code;
  const o = await (await call("/account/options", { body: { mode: "create", name: "Alex", invite: code } })).json();
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
  // the tailoring streams (APP-DR-004): its real status rides in the body
  const tb = await t.json(); assert.ok(tb.error, "the run failed"); assert.ok(tb._status >= 400, "with an error status inside");
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

// ---- invite codes and the owner's People window (APP-DR-003 round 2) ----
const newAccount = async (invite, name = "Sam") => {
  const or = await call("/account/options", { body: { mode: "create", name, invite } });
  if (or.status !== 200) return { status: or.status, error: (await or.json()).error };
  const o = await or.json(), pk = await makePasskey();
  const ad = Uint8Array.from([...(await rpHash()), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 16, ...pk.credId, ...pk.cose]);
  const att = cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]));
  const send = () => call("/account/create", { body: { name, userId: o.user.id, clientDataJSON: b64u(clientData("webauthn.create", o.challenge)), attestationObject: b64u(att) } });
  const cr = await send(); const data = await cr.json();
  return { status: cr.status, error: data.error, data, cookie: cr.status === 200 ? cookieOf(cr) : "", pk, send };
};
const people = async () => (await call("/admin/people", { pass: PASS })).json();

test("invites: no code, a wrong code or a used code can't create an account; one code makes exactly one", async () => {
  for (const invite of [undefined, "", "NOPE-NOPE", "a".repeat(500), "../inv", { a: 1 }]) {
    const r = await newAccount(invite); assert.equal(r.status, 403, JSON.stringify(invite)); assert.equal(r.error, "invite");
  }
  const invited = `Invited ${Date.now()}`, second = `Second ${Date.now()}`;
  const { code } = await (await call("/admin/invite", { pass: PASS })).json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  // typed the way people type it: lower case, with a dash and spaces
  const a = await newAccount(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()} `, invited);
  assert.equal(a.status, 200); assert.equal(a.data.credits, 5);
  const again = await newAccount(code, second); assert.equal(again.status, 403); assert.equal(again.error, "invite_used");
  const p = await people();
  assert.equal(p.users.filter((u) => u.name === second).length, 0);
  const inv = p.invites.find((i) => i.code === code); assert.equal(inv.usedName, invited); assert.ok(inv.usedAt);
  assert.equal(p.users.find((u) => u.name === invited).credits, 5);
});

test("invites: two people starting with the same code at once get one account between them", async () => {
  const { code } = await (await call("/admin/invite", { pass: PASS })).json();
  const mk = async (name) => { const o = await (await call("/account/options", { body: { mode: "create", name, invite: code } })).json(), pk = await makePasskey();
    const ad = Uint8Array.from([...(await rpHash()), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 16, ...pk.credId, ...pk.cose]);
    return () => call("/account/create", { body: { name, userId: o.user.id, clientDataJSON: b64u(clientData("webauthn.create", o.challenge)), attestationObject: b64u(cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]))) } }); };
  const tag = `Race ${Date.now()} `;                                    // local storage survives between runs: this run's own names
  const one = await mk(tag + "One"), two = await mk(tag + "Two");          // both got their Face ID prompt before either finished
  const r1 = await one(), r2 = await two();
  assert.deepEqual([r1.status, r2.status], [200, 403]); assert.equal((await r2.json()).error, "invite_used");
  assert.equal((await people()).users.filter((u) => u.name.startsWith(tag)).length, 1);
});

test("People is the owner's only: no passcode, a wrong one, or a signed-in account gets nothing", async () => {
  freshIp();
  const { code } = await (await call("/admin/invite", { pass: PASS })).json();
  const a = await newAccount(code, "Not The Owner"); assert.equal(a.status, 200);
  for (const path of ["/admin/people", "/admin/invite", "/admin/invite/delete", "/admin/user/delete"]) {
    assert.equal((await call(path, { body: {} })).status, 401, path);
    assert.equal((await call(path, { headers: { cookie: a.cookie }, body: {} })).status, 401, path + " with an account");
    assert.equal((await call(path, { method: "GET" })).status, 404, path + " GET");
  }
  assert.equal((await call("/admin/people", { pass: "wrong-one", headers: { "cf-connecting-ip": "198.51.100.251" } })).status, 401);
  assert.equal((await call("/admin/nothing", { pass: PASS })).status, 404);
  assert.equal((await call("/admin/people", { pass: PASS, origin: "https://evil.example" })).headers.get("access-control-allow-origin"), null);
});

test("the owner removes an unused invite (it stops working) and an account (its passkey and session stop working)", async () => {
  freshIp();
  const { code } = await (await call("/admin/invite", { pass: PASS })).json();
  assert.equal((await call("/admin/invite/delete", { pass: PASS, body: { code } })).status, 200);
  assert.equal((await newAccount(code)).error, "invite");
  assert.equal((await call("/admin/invite/delete", { pass: PASS, body: { code } })).status, 404, "a second tap finds nothing");
  const c2 = (await (await call("/admin/invite", { pass: PASS })).json()).code;
  const gone = `To Remove ${Date.now()}`;
  const a = await newAccount(c2, gone); assert.equal(a.status, 200);
  const id = (await people()).users.find((u) => u.name === gone).id;
  const del = await call("/admin/user/delete", { pass: PASS, body: { id } }); assert.equal(del.status, 200);
  assert.equal((await del.json()).users.filter((u) => u.id === id).length, 0);
  assert.equal((await (await call("/me", { method: "GET", headers: { cookie: a.cookie } })).json()).signedIn, false);
  const so = await (await call("/account/options", { body: {} })).json();
  const ad2 = Uint8Array.from([...(await rpHash()), 0x05, 0, 0, 0, 1]), cd2 = clientData("webauthn.get", so.challenge);
  const sig = rawToDer(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, a.pk.kp.privateKey, Uint8Array.from([...ad2, ...new Uint8Array(await crypto.subtle.digest("SHA-256", cd2))]))));
  assert.equal((await call("/account/signin", { body: { id: b64u(a.pk.credId), clientDataJSON: b64u(cd2), authenticatorData: b64u(ad2), signature: b64u(sig) } })).status, 401);
  assert.equal((await call("/admin/user/delete", { pass: PASS, body: { id } })).status, 404, "a second tap finds nothing");
  for (const bad of [{}, { id: "" }, { id: "../credits" }, { id: { x: 1 } }]) assert.equal((await call("/admin/user/delete", { pass: PASS, body: bad })).status, 404);
  // the used code can't be used again after its account is gone
  assert.equal((await newAccount(c2)).error, "invite_used");
});

// ---- the owner's account (APP-DR-003 round 4): no passcode to use Draft; one account is the owner's, with People and no credit limit ----
test("owner: a signed-in account becomes the owner's with the secret, once; then its session alone opens People", async () => {
  freshIp();
  const { code } = await (await call("/admin/invite", { pass: PASS })).json();
  const a = await newAccount(code, `Boss ${Date.now()}`); assert.equal(a.status, 200); assert.equal(a.data.owner, false);
  // not signed in, no secret, a wrong secret: nothing changes
  assert.equal((await call("/account/owner", { pass: PASS })).status, 401);
  assert.equal((await call("/account/owner", { headers: { cookie: a.cookie } })).status, 401);
  assert.equal((await call("/account/owner", { pass: "not-it", headers: { cookie: a.cookie, "cf-connecting-ip": "198.51.100.252" } })).status, 401);
  assert.equal((await (await call("/me", { method: "GET", headers: { cookie: a.cookie } })).json()).owner, false);
  assert.equal((await call("/admin/people", { headers: { cookie: a.cookie } })).status, 401);
  const ok = await call("/account/owner", { pass: PASS, headers: { cookie: a.cookie } }); assert.equal(ok.status, 200); assert.equal((await ok.json()).owner, true);
  assert.equal((await (await call("/me", { method: "GET", headers: { cookie: a.cookie } })).json()).owner, true);
  const p = await call("/admin/people", { headers: { cookie: a.cookie } }); assert.equal(p.status, 200);
  const mine = (await p.json()).users.find((u) => u.owner && u.name.startsWith("Boss ")); assert.ok(mine);
  // the owner's account can't be removed from People (not even by a second tap), and a run is never refused for credits
  assert.equal((await call("/admin/user/delete", { headers: { cookie: a.cookie }, body: { id: mine.id } })).status, 409);
  const t = await call("/tailor", { headers: { cookie: a.cookie }, body: { cv: "Alex Morgan, QA engineer. ".repeat(20), job: "We need a QA engineer with Playwright. ".repeat(5) } });
  assert.notEqual(t.status, 402); assert.notEqual(t.status, 401);
  // another site can't use the owner's session
  assert.equal((await call("/admin/people", { headers: { cookie: a.cookie }, origin: "https://evil.example" })).headers.get("access-control-allow-origin"), null);
});
test("owner: the first account needs no invite when the owner's secret is given; without it, or with a wrong one, an invite is still needed", async () => {
  freshIp();
  const mk = async (headers) => { const or = await call("/account/options", { headers, body: { mode: "create", name: "First" } }); if (or.status !== 200) return { status: or.status };
    const o = await or.json(), pk = await makePasskey(), ad = Uint8Array.from([...(await rpHash()), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 16, ...pk.credId, ...pk.cose]);
    const cr = await call("/account/create", { body: { name: "First", userId: o.user.id, clientDataJSON: b64u(clientData("webauthn.create", o.challenge)), attestationObject: b64u(cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]))) } });
    return { status: cr.status, data: await cr.json() }; };
  assert.equal((await mk({})).status, 403);
  assert.equal((await mk({ "x-passcode": "wrong", "cf-connecting-ip": "198.51.100.253" })).status, 403);
  const boss = await mk({ "x-passcode": PASS }); assert.equal(boss.status, 200); assert.equal(boss.data.owner, true);
  // an invite code typed as the word OWNER is just a wrong code
  assert.equal((await newAccount("OWNER")).error, "invite"); assert.equal((await newAccount("!owner")).error, "invite");
});
