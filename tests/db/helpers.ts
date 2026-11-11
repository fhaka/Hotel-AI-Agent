import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Helpers for exercising Row Level Security exactly as Supabase does:
 * each "request" runs in a transaction with `SET LOCAL ROLE authenticated`
 * and the JWT claims placed in `request.jwt.claims`, which is what
 * `auth.uid()` reads.
 */

const url = process.env.DATABASE_URL_TEST;
if (!url) {
  throw new Error("DATABASE_URL_TEST is not set. Run the DB tests with `npm run test:db`.");
}

export const pool = new pg.Pool({ connectionString: url, max: 10 });

export type Db = pg.PoolClient;

/** Creates an auth user (as Supabase Auth would) and returns its id. */
export async function createUser(email = `user-${randomUUID()}@example.test`, fullName = "Test User") {
  const { rows } = await pool.query<{ id: string }>(
    `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
     values ($1, $2, jsonb_build_object('full_name', $3::text), now()) returning id`,
    [randomUUID(), email, fullName],
  );
  return rows[0].id;
}

/**
 * Runs `fn` as the given authenticated user (or anon when userId is null)
 * inside a transaction that is always rolled back unless `commit` is set.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (db: Db) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (userId) {
      await client.query(
        "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
        [JSON.stringify({ sub: userId, role: "authenticated" }), userId],
      );
      await client.query("set local role authenticated");
    } else {
      await client.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      await client.query("set local role anon");
    }
    const result = await fn(client);
    await client.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Runs `fn` with the service role (bypasses RLS) and commits. */
export async function asService<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Creates a workspace through the real RPC as `userId`, committed. */
export async function createWorkspace(
  userId: string,
  name = "Hotel Test",
  industry: "hotel" | "restaurant" = "hotel",
): Promise<string> {
  return asUser(
    userId,
    async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select public.create_business_workspace($1, $2::public.industry, 'Europe/Berlin', 'en', array['en','de'], 'DE', 'Berlin', null) as id",
        [name, industry],
      );
      return rows[0].id;
    },
    { commit: true },
  );
}

/** Adds an existing user to a business with a role (service role, committed). */
export async function addMember(businessId: string, userId: string, role: string) {
  await asService((db) =>
    db.query(
      `insert into public.business_members (business_id, user_id, role, invitation_status)
       values ($1, $2, $3::public.business_role, 'active')`,
      [businessId, userId, role],
    ),
  );
}

export function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}
