/**
 * auth.js — API endpoints that support frontend authentication state.
 *
 * Login and sign-up are handled directly by the Supabase JS client in the
 * browser. These routes expose the public auth config, current profile, and
 * the admin-only action to promote an existing user to admin.
 */

import { Router } from 'express';
import { supabaseAnonKey, supabaseUrl } from '../db.js';
import { requireAdminContext, requireAuthContext } from '../auth-utils.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  });
});

router.get('/me', async (req, res) => {
  const context = await requireAuthContext(req, res);
  if (!context) return;

  res.json({
    profile: context.profile,
    user: {
      id: context.user.id,
      email: context.user.email,
    },
  });
});

router.get('/users', async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) return;

  const { data, error } = await context.supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('role', 'volunteer')
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true });

  if (error) {
    return res.status(500).json({ error: 'Could not load users.' });
  }

  res.json({ users: data ?? [] });
});

router.post('/promote-admin', async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) return;

  const profileId = String(req.body?.profileId ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!profileId && !email) {
    return res.status(400).json({ error: 'Profile selection is required.' });
  }

  let query = context.supabase.from('profiles').update({ role: 'admin' });
  query = profileId ? query.eq('id', profileId) : query.eq('email', email);

  const { data, error } = await query.select('id, email, full_name, role').single();

  if (error || !data) {
    return res.status(404).json({ error: 'User not found. They must sign up first.' });
  }

  res.json({ profile: data });
});

export default router;