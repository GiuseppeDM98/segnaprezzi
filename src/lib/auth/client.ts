/**
 * Better Auth client for React components ("use client" consumers).
 * baseURL is omitted on purpose: the client calls same-origin /api/auth.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
