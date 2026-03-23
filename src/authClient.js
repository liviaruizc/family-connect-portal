/**
 * src/authClient.js — Browser-side Supabase Auth bootstrap.
 *
 * The backend exposes the public Supabase URL and anon key at
 * GET /api/auth/config so Vite does not need separate VITE_* variables.
 */

import { createClient } from '@supabase/supabase-js';

let authClient = null;

export async function initAuthClient() {
  if (authClient) return authClient;

  const response = await fetch('/api/auth/config');
  if (!response.ok) {
    throw new Error('Could not load auth configuration.');
  }

  const config = await response.json();
  authClient = createClient(config.url, config.anonKey);
  return authClient;
}

export function getAuthClient() {
  if (!authClient) {
    throw new Error('Auth client has not been initialized yet.');
  }

  return authClient;
}

export async function signIn(email, password) {
  return getAuthClient().auth.signInWithPassword({ email, password });
}

export async function signUp(email, password, fullName) {
  return getAuthClient().auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });
}

export async function signOutUser() {
  return getAuthClient().auth.signOut();
}

export async function getCurrentSession() {
  return getAuthClient().auth.getSession();
}

export function onAuthChanged(handler) {
  return getAuthClient().auth.onAuthStateChange((_event, session) => {
    handler(session ?? null);
  });
}