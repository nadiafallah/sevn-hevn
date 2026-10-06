import "server-only";

/**
 * Calls Supabase's REST API (PostgREST) without a client SDK, like the rest of the site.
 * - Concierge calls use the publishable key; the server key travels as a function argument and is
 *   checked inside the database (see supabase/migrations/*_concierge_crm.sql).
 * - Panel calls add the signed-in person's access token, so row-level security and the role checks
 *   in the admin_* functions apply to every read and write.
 */

export class DbError extends Error {
  constructor(
    message: string,
    /** Database error message, e.g. "rate_limited", "owner_only", "conflict". */
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Api {
  url: string;
  key: string;
}

const KNOWN = [
  "rate_limited", "conflict", "conversation_not_found", "conversation_too_long", "photo_limit", "photo_missing",
  "not_authorized", "owner_only", "invalid_request", "not_found", "last_owner", "has_order", "not_retryable",
];

function codeOf(message: string | undefined, status: number) {
  if (message && KNOWN.includes(message)) return message;
  if (message?.includes("violates check constraint") || message?.includes("invalid input")) return "invalid_request";
  if (message?.includes("duplicate key")) return "duplicate";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "not_authorized";
  return "db_error";
}

async function call<T>(api: Api, path: string, init: RequestInit & { token?: string; timeoutMs?: number }): Promise<T> {
  const { token, timeoutMs = 8000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${api.url}${path}`, {
      ...rest,
      headers: {
        apikey: api.key,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "application/json",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new DbError("Database unreachable", "unreachable", 503);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    const code = codeOf(err?.message, res.status);
    // Never log request bodies or tokens; the code is enough to diagnose.
    if (code === "db_error") console.error(`[db] ${path.split("?")[0]} failed with HTTP ${res.status}`);
    throw new DbError(err?.message ?? `HTTP ${res.status}`, code, res.status);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function rpc<T>(api: Api, fn: string, args: Record<string, unknown>, token?: string): Promise<T> {
  return call<T>(api, `/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args), token });
}

export function select<T>(api: Api, table: string, query: Record<string, string>, token?: string): Promise<T> {
  return call<T>(api, `/rest/v1/${table}?${new URLSearchParams(query)}`, { method: "GET", token });
}

/** Storage upload with the publishable key (allowed only into an open photo slot, by policy). */
export async function storageUpload(api: Api, bucket: string, path: string, body: Uint8Array, contentType: string) {
  let res: Response;
  try {
    res = await fetch(`${api.url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      // Publishable keys are not JWTs: send only `apikey`, so Storage applies the public role's policies.
      headers: { apikey: api.key, "content-type": contentType, "x-upsert": "false", "cache-control": "max-age=31536000" },
      body: Buffer.from(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new DbError("Storage unreachable", "unreachable", 503);
  }
  if (!res.ok) {
    console.error(`[storage] upload failed with HTTP ${res.status}`);
    throw new DbError(`Storage HTTP ${res.status}`, "storage_error", res.status);
  }
}

/** Short-lived signed URL, created with the signed-in team member's token (storage policy checks the role). */
export async function storageSignedUrl(api: Api, bucket: string, path: string, token: string, expiresIn = 300) {
  const data = await call<{ signedURL?: string }>(api, `/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn }),
    token,
  });
  return data?.signedURL ? `${api.url}/storage/v1${data.signedURL}` : null;
}

export async function storageRemove(api: Api, bucket: string, paths: string[], token: string) {
  if (!paths.length) return;
  await call(api, `/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths }), token });
}
