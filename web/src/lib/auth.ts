// Better Auth on the server. Email + password only, accounts live in Postgres via Prisma.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { getEnv } from "./env";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_NAME_LENGTH = 80;

function checkName(name: unknown): void {
  if (typeof name === "string" && name.length > MAX_NAME_LENGTH) {
    throw new APIError("BAD_REQUEST", { message: `Use ${MAX_NAME_LENGTH} characters or fewer.` });
  }
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      disableSignUp: !env.ALLOW_SIGNUP,
    },
    rateLimit: {
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    // The client address comes from X-Forwarded-For only behind a trusted proxy. Otherwise
    // the auth route handler removes the header (see lib/client-ip.ts).
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            checkName(user.name);
          },
        },
        update: {
          before: async (user) => {
            checkName(user.name);
          },
        },
      },
    },
    // nextCookies lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { auth?: Auth };

// Lazy for the same reason as getDb(): `next build` must not need env vars.
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}

export type SessionInfo = { userId: string; email: string; name: string };

/** Reads the session from request headers. Returns null when signed out. */
export async function getSessionInfo(requestHeaders: Headers): Promise<SessionInfo | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

/** For server components and layouts: redirects to the login page when signed out. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSessionInfo(await headers());
  if (!session) redirect("/login");
  return session;
}
