/**
 * categories.js — Express router for the category list
 *
 * Route:
 *   GET /api/categories   Returns all categories ordered alphabetically.
 *                         Used to populate the filter dropdown in the UI.
 */

import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();

/* -----------------------------------------------------------------------
 * GET /api/categories
 * --------------------------------------------------------------------- */
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('category')
      .select('category_id, category_name')
      .order('category_name');

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('[GET /categories] Supabase error:', err.message);
    res.status(500).json({ error: 'Database error while fetching categories.' });
  }
});

export default router;
