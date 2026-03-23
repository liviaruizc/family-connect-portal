/**
 * auth-utils.js — Request-scoped Supabase auth helpers
 *
 * These helpers verify the incoming bearer token, fetch the caller's
 * profile row, and expose admin-only guards for protected routes.
 */

import { createUserScopedSupabase } from './db.js';

function getBearerToken(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * Resolve the authenticated user and profile for this request.
 * @param {import('express').Request} req
 * @returns {Promise<{supabase:any,user:any,profile:any}|{error:string,status:number}>}
 */
export async function getRequestContext(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return { error: 'Missing authorization token.', status: 401 };
  }

  const scopedSupabase = createUserScopedSupabase(accessToken);
  const { data: authData, error: authError } = await scopedSupabase.auth.getUser(accessToken);

  if (authError || !authData?.user) {
    return { error: 'Invalid or expired session.', status: 401 };
  }

  const { data: profile, error: profileError } = await scopedSupabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    // Fallback path: if signup trigger failed/missed, create a default volunteer profile.
    const newProfilePayload = {
      id: authData.user.id,
      email: authData.user.email ?? null,
      full_name:
        authData.user.user_metadata?.full_name ??
        authData.user.user_metadata?.name ??
        authData.user.email ??
        'User',
      role: 'volunteer',
    };

    const { data: insertedProfile, error: insertError } = await scopedSupabase
      .from('profiles')
      .insert(newProfilePayload)
      .select('id, email, full_name, role')
      .single();

    if (insertError || !insertedProfile) {
      return {
        error: 'User profile was not found and could not be created automatically.',
        status: 403,
      };
    }

    return {
      supabase: scopedSupabase,
      user: authData.user,
      profile: insertedProfile,
    };
  }

  return {
    supabase: scopedSupabase,
    user: authData.user,
    profile,
  };
}

/**
 * Require any authenticated user.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function requireAuthContext(req, res) {
  const context = await getRequestContext(req);
  if ('error' in context) {
    res.status(context.status).json({ error: context.error });
    return null;
  }

  return context;
}

/**
 * Require an authenticated admin user.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function requireAdminContext(req, res) {
  const context = await requireAuthContext(req, res);
  if (!context) return null;

  if (context.profile.role !== 'admin') {
    res.status(403).json({ error: 'Admin access is required for this action.' });
    return null;
  }

  return context;
}