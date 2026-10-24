"use client";
// Better Auth client for the browser. Same origin as the app, so no baseURL.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, changePassword } = authClient;
