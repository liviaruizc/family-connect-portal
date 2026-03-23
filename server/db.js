/**
 * db.js — Supabase client
 *
 * Creates and exports Supabase client helpers using the project URL
 * and anon key from environment variables.
 *
 * `supabase` is the default public client.
 * `createUserScopedSupabase(accessToken)` builds a request-scoped client
 * that executes queries with the signed-in user's JWT, allowing Row Level
 * Security (RLS) to enforce admin/volunteer permissions.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Both values come from your Supabase project dashboard:
// Settings -> API -> Project URL and Project API Keys.
export const supabaseUrl = process.env.SUPABASE_URL;
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Create a Supabase client that runs requests as the authenticated user.
 * @param {string} accessToken
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createUserScopedSupabase(accessToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
