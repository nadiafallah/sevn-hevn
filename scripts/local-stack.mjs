#!/usr/bin/env node
// Local end-to-end test stack. It never points at production.
//
//   real Postgres 17 + real PostgREST (all migrations applied)
//   + small stand-ins for Supabase Auth (password sign-in, sign-up / recovery e-mails, JWTs)
//     and Storage (row-level security enforced by Postgres, files kept in memory)
//   + an SMTP sink that keeps e-mails for the tests (GET /__test/mail).
//
// Usage: node scripts/local-stack.mjs   (needs Homebrew postgresql@17 and postgrest)
// Then run the site with the variables written to $STACK_DIR/env (see tests/e2e/run.sh).
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { SMTPServer } from "smtp-server";

const DIR = process.env.STACK_DIR || join(tmpdir(), "sevn-hevn-stack");
const PG_BIN = process.env.PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
const POSTGREST = process.env.POSTGREST_BIN || "/opt/homebrew/bin/postgrest";
const PG_PORT = 54329;
const REST_PORT = 54321;
const GW_PORT = Number(process.env.GW_PORT || 54320);
const SMTP_PORT = 54325;
const JWT_SECRET = "local-test-jwt-secret-only-for-the-local-stack-0001";
const PUBLISHABLE = "sb_publishable_local_test_key";
const SERVER_KEY = "local-concierge-server-key-0123456789abcdef0123";
const GW = `http://127.0.0.1:${GW_PORT}`;

const root = join(import.meta.dirname, "..");
const migrations = join(root, "supabase", "migrations");

// ── Postgres ───────────────────────────────────────────────────────────────────────

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const pgdata = join(DIR, "pgdata");
execFileSync(join(PG_BIN, "initdb"), ["-U", "postgres", "-A", "trust", "-D", pgdata, "--no-instructions"], { stdio: "ignore" });
execFileSync(join(PG_BIN, "pg_ctl"), ["-D", pgdata, "-o", `-p ${PG_PORT} -c unix_socket_directories='' -c listen_addresses=127.0.0.1`, "-l", join(DIR, "pg.log"), "-w", "start"], { stdio: "ignore" });

const admin = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", database: "postgres" });
await admin.connect();

await admin.query(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role authenticator login password 'authenticator' noinherit;
  grant anon, authenticated, service_role to authenticator;
  create schema extensions; create schema storage; create schema vault; create schema net; create schema auth;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  create table vault.store (name text primary key, decrypted_secret text);
  create view vault.decrypted_secrets as select name, decrypted_secret from vault.store;
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ select 1::bigint $$;
  create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz, password_plain text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema public, storage, auth to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(migrations, file), "utf8").replace(/create extension if not exists pg_net[^;]*;/i, "");
  await admin.query(sql);
}
await admin.query("insert into private.server_keys (name, sha256_hex) values ('concierge', $1)", [createHash("sha256").update(SERVER_KEY).digest("hex")]);
// Team: one owner and one staff member, already confirmed (their first sign-in links them).
const OWNER = { id: randomUUID(), email: "owner@test.local", password: "owner-test-password-1" };
const STAFF = { id: randomUUID(), email: "staff@test.local", password: "staff-test-password-1" };
for (const u of [OWNER, STAFF]) {
  await admin.query("insert into auth.users (id, email, email_confirmed_at, password_plain) values ($1, $2, now(), $3)", [u.id, u.email, u.password]);
}
await admin.query("insert into public.staff_members (email, display_name, role) values ('owner@test.local', 'Test Owner', 'owner'), ('staff@test.local', 'Test Staff', 'staff')");
// A genuine test listing so price answers can be checked.
await admin.query(`insert into public.products (ref, published, status, name, category, brand, price_aed, stock, delivery)
  values ('SH-0001', true, 'available', 'Kelly 28 Togo', 'bags', 'Hermès', 85000, 1, 'Delivery in Dubai arranged personally')`);

// ── PostgREST ──────────────────────────────────────────────────────────────────────

const conf = join(DIR, "postgrest.conf");
writeFileSync(conf, [
  `db-uri = "postgres://authenticator:authenticator@127.0.0.1:${PG_PORT}/postgres"`,
  `db-schemas = "public"`,
  `db-anon-role = "anon"`,
  `jwt-secret = "${JWT_SECRET}"`,
  `server-host = "127.0.0.1"`,
  `server-port = ${REST_PORT}`,
  `log-level = "warn"`,
].join("\n"));
const rest = spawn(POSTGREST, [conf], { stdio: ["ignore", "inherit", "inherit"] });
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${REST_PORT}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

// ── Auth stand-in ──────────────────────────────────────────────────────────────────

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(user, ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + ttl });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = (token || "").split(".");
  if (!s || createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url") !== s) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  return p.exp * 1000 > Date.now() ? p : null;
}
const refreshTokens = new Map();
const emailTokens = new Map();
function session(user) {
  const refresh = randomBytes(24).toString("hex");
  refreshTokens.set(refresh, user.id);
  return { access_token: jwt(user), refresh_token: refresh, expires_in: 3600, token_type: "bearer", user: { id: user.id, email: user.email } };
}
const userBy = async (where, v) => (await admin.query(`select * from auth.users where ${where} = $1`, [v])).rows[0];

// ── Mail sink ──────────────────────────────────────────────────────────────────────

const mail = [];
let smtpFail = false;
const smtp = new SMTPServer({
  authOptional: true,
  secure: false,
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _s, cb) {
    cb(null, { user: auth.username });
  },
  onRcptTo(_a, _s, cb) {
    cb(smtpFail ? Object.assign(new Error("Mailbox unavailable (test)"), { responseCode: 550 }) : null);
  },
  onData(stream, s, cb) {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => {
      const subject = /^Subject: (.*)$/im.exec(raw)?.[1] ?? "";
      mail.push({ to: s.envelope.rcptTo.map((r) => r.address), subject, raw });
      cb();
    });
  },
});
smtp.listen(SMTP_PORT, "127.0.0.1");
function sendMail(to, subject, text) {
  mail.push({ to: [to], subject, raw: text });
}

// ── Gateway ────────────────────────────────────────────────────────────────────────

const files = new Map();
const readBody = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function asRole(claims, fn) {
  const c = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", database: "postgres" });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${claims ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, GW);
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const claims = bearer.split(".").length === 3 ? verifyJwt(bearer) : null;
  const keyless = url.pathname.startsWith("/__") || url.pathname.includes("/object/sign/") && req.method === "GET" || url.pathname.startsWith("/auth/v1/verify");
  if (!keyless && req.headers.apikey !== PUBLISHABLE) return send(res, 401, { message: "Invalid API key" });
  try {
    // REST → PostgREST
    if (url.pathname.startsWith("/rest/v1/")) {
      if (bearer.split(".").length === 3 && !claims) return send(res, 401, { code: "PGRST301", message: "JWT expired" });
      const body = await readBody(req);
      const r = await fetch(`http://127.0.0.1:${REST_PORT}${url.pathname.slice(8)}${url.search}`, {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
          accept: req.headers.accept || "application/json",
          ...(req.headers.prefer ? { prefer: req.headers.prefer } : {}),
          ...(claims ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      return send(res, r.status, Buffer.from(await r.arrayBuffer()), { "content-type": r.headers.get("content-type") || "application/json" });
    }

    // Auth stand-in
    if (url.pathname.startsWith("/auth/v1/")) {
      const path = url.pathname.slice(9);
      const body = req.method === "GET" ? {} : JSON.parse((await readBody(req)).toString() || "{}");
      if (path === "token" && url.searchParams.get("grant_type") === "password") {
        const u = await userBy("lower(email)", String(body.email).toLowerCase());
        if (!u || u.password_plain !== body.password) return send(res, 400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
        if (!u.email_confirmed_at) return send(res, 400, { error_code: "email_not_confirmed" });
        return send(res, 200, session(u));
      }
      if (path === "token" && url.searchParams.get("grant_type") === "refresh_token") {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return send(res, 400, { error_code: "refresh_token_not_found" });
        refreshTokens.delete(body.refresh_token);
        return send(res, 200, session(await userBy("id", uid)));
      }
      if (path === "logout") {
        if (claims) for (const [k, v] of refreshTokens) if (v === claims.sub) refreshTokens.delete(k);
        return send(res, 204, "");
      }
      if (path === "signup") {
        const email = String(body.email).toLowerCase();
        if (await userBy("lower(email)", email)) return send(res, 200, { id: randomUUID() });
        const id = randomUUID();
        await admin.query("insert into auth.users (id, email, password_plain) values ($1, $2, $3)", [id, email, body.password]);
        const t = randomBytes(16).toString("hex");
        emailTokens.set(t, { id, type: "signup", redirect: url.searchParams.get("redirect_to") });
        sendMail(email, "Confirm your signup", `${GW}/auth/v1/verify?token=${t}&type=signup`);
        return send(res, 200, { id });
      }
      if (path === "recover") {
        const u = await userBy("lower(email)", String(body.email).toLowerCase());
        if (u) {
          const t = randomBytes(16).toString("hex");
          emailTokens.set(t, { id: u.id, type: "recovery", redirect: url.searchParams.get("redirect_to") });
          sendMail(u.email, "Reset your password", `${GW}/auth/v1/verify?token=${t}&type=recovery`);
        }
        return send(res, 200, {});
      }
      if (path === "verify") {
        const t = emailTokens.get(url.searchParams.get("token"));
        if (!t) return send(res, 303, "", { location: "http://localhost:3000#error=access_denied" });
        emailTokens.delete(url.searchParams.get("token"));
        if (t.type === "signup") {
          await admin.query("update auth.users set email_confirmed_at = now() where id = $1", [t.id]);
          return send(res, 303, "", { location: t.redirect || "http://localhost:3000" });
        }
        const s = session(await userBy("id", t.id));
        return send(res, 303, "", { location: `${t.redirect}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&type=recovery` });
      }
      if (path === "user" && req.method === "PUT") {
        if (!claims) return send(res, 401, { error_code: "no_authorization" });
        if (typeof body.password === "string" && body.password.length < 6) return send(res, 422, { error_code: "weak_password" });
        await admin.query("update auth.users set password_plain = $2 where id = $1", [claims.sub, body.password]);
        return send(res, 200, { id: claims.sub });
      }
      return send(res, 404, { message: "not found" });
    }

    // Storage stand-in (policies enforced by Postgres as the caller's role)
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length));
      if (req.method === "GET" && path.startsWith("sign/")) {
        const key = path.slice(5);
        const expected = createHmac("sha256", JWT_SECRET).update(`${key}:${url.searchParams.get("exp")}`).digest("hex");
        if (url.searchParams.get("token") !== expected || Number(url.searchParams.get("exp")) < Date.now()) return send(res, 400, { message: "invalid signature" });
        const f = files.get(key);
        return f ? send(res, 200, f.bytes, { "content-type": f.type }) : send(res, 404, { message: "not found" });
      }
      if (req.method === "POST" && path.startsWith("sign/")) {
        const key = path.slice(5);
        const [bucket, ...p] = key.split("/");
        const found = await asRole(claims, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, p.join("/")]));
        if (!found.rows.length) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        const exp = Date.now() + (JSON.parse((await readBody(req)).toString() || "{}").expiresIn ?? 60) * 1000;
        const token = createHmac("sha256", JWT_SECRET).update(`${key}:${exp}`).digest("hex");
        return send(res, 200, { signedURL: `/object/sign/${key}?token=${token}&exp=${exp}` });
      }
      if (req.method === "POST") {
        const [bucket, ...p] = path.split("/");
        const name = p.join("/");
        const bytes = await readBody(req);
        const b = (await admin.query("select * from storage.buckets where id = $1", [bucket])).rows[0];
        if (!b) return send(res, 404, { message: "Bucket not found" });
        if (b.file_size_limit && bytes.length > Number(b.file_size_limit)) return send(res, 413, { message: "Payload too large" });
        if (b.allowed_mime_types && !b.allowed_mime_types.includes(req.headers["content-type"])) return send(res, 415, { message: "mime type not supported" });
        try {
          await asRole(claims, (c) => c.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, name, claims?.sub ?? null]));
        } catch (e) {
          return send(res, 403, { statusCode: "403", error: "Unauthorized", message: e.message });
        }
        files.set(`${bucket}/${name}`, { bytes, type: req.headers["content-type"] });
        return send(res, 200, { Key: `${bucket}/${name}` });
      }
      if (req.method === "DELETE") {
        const bucket = path.split("/")[0];
        const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
        const del = await asRole(claims, (c) => c.query("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [bucket, prefixes]));
        for (const r of del.rows) files.delete(`${bucket}/${r.name}`);
        return send(res, 200, del.rows);
      }
    }

    // Test hooks (local stack only)
    if (url.pathname === "/__test/mail") return send(res, 200, mail);
    if (url.pathname === "/__test/smtp-fail") {
      smtpFail = url.searchParams.get("on") === "1";
      return send(res, 200, { smtpFail });
    }
    if (url.pathname === "/__test/file") {
      const f = files.get(url.searchParams.get("key"));
      return f ? send(res, 200, f.bytes, { "content-type": f.type }) : send(res, 404, {});
    }
    if (url.pathname === "/__test/sql") {
      const { sql, params } = JSON.parse((await readBody(req)).toString());
      return send(res, 200, (await admin.query(sql, params)).rows);
    }
    if (url.pathname.startsWith("/__ai/")) {
      // Stand-in AI provider that always fails, to prove the chat works without AI.
      return send(res, 500, { type: "error", error: { type: "api_error", message: "test outage" } });
    }
    return send(res, 404, { message: "not found" });
  } catch (e) {
    console.error("[stack]", e);
    return send(res, 500, { message: "stack error" });
  }
});
server.listen(GW_PORT, "127.0.0.1");

const env = {
  SUPABASE_URL: GW,
  SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  CONCIERGE_SERVER_KEY: SERVER_KEY,
  CONCIERGE_ALLOW_NON_PRODUCTION: "true",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3300",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(SMTP_PORT),
  SMTP_TLS: "off",
  SMTP_USER: "info@test.local",
  SMTP_PASSWORD: "local-smtp",
  NOTIFY_EMAIL_TO: "team@test.local",
  NOTIFY_EMAIL_FROM: "SEVN HEVN <info@test.local>",
  CONCIERGE_AI_ENABLED: "true",
  ANTHROPIC_API_KEY: "local-test-not-a-real-key",
  ANTHROPIC_BASE_URL: `${GW}/__ai`,
};
writeFileSync(join(DIR, "env"), Object.entries(env).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n");
writeFileSync(join(DIR, "users.json"), JSON.stringify({ owner: OWNER, staff: STAFF }));
console.log(`[stack] ready on ${GW} (env in ${join(DIR, "env")})`);

const stop = () => {
  rest.kill();
  server.close();
  smtp.close();
  try {
    execFileSync(join(PG_BIN, "pg_ctl"), ["-D", pgdata, "-m", "fast", "stop"], { stdio: "ignore" });
  } catch {}
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
