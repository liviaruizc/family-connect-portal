/**
 * resources.js — Express router for resource search & lookup
 *
 * Routes:
 *   GET /api/resources/search?q=<term>   Search by org name or category
 *   GET /api/resources/:id               Full details for one resource
 */

import { Router } from 'express';
import { supabase } from '../db.js';
import { requireAdminContext, requireAuthContext } from '../auth-utils.js';

const router = Router();

/**
 * Shared select used by summary list/search endpoints.
 * Includes nested categories so cards can display category badges.
 */
const resourceSummarySelect = `
  resource_id,
  organization_name,
  city,
  state,
  phone_number,
  email,
  description,
  resource_category(
    category( category_name )
  )
`;

/**
 * Convert Supabase nested category relations into a comma-separated string
 * for the resource cards shown in the UI.
 * @param {Array<Object>} resources
 * @returns {Array<Object>}
 */
function formatResourceSummaries(resources) {
  return (resources ?? [])
    .map(({ resource_category, ...rest }) => ({
      ...rest,
      categories: (resource_category ?? [])
        .map((rc) => rc.category?.category_name)
        .filter(Boolean)
        .sort()
        .join(', '),
    }))
    .sort((a, b) => a.organization_name.localeCompare(b.organization_name));
}

function normalizeLocationValue(value) {
  return String(value ?? '').trim();
}

function buildLocationKey(city, state) {
  return `${normalizeLocationValue(city)}||${normalizeLocationValue(state)}`;
}

function parseLocationKey(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (!key) return null;

  const [cityPart = '', statePart = ''] = key.split('||');
  const city = normalizeLocationValue(cityPart);
  const state = normalizeLocationValue(statePart);

  if (!city && !state) return null;
  return { city, state };
}

/* -----------------------------------------------------------------------
 * GET /api/resources
 *
 * Returns all organizations in alphabetical order for the initial page load.
 * Unauthenticated reads are allowed; RLS will filter based on Supabase policies.
 * --------------------------------------------------------------------- */
router.get('/', async (req, res) => {
  try {
    const locationFilter = parseLocationKey(req.query.location);

    let query = supabase
      .from('resource')
      .select(resourceSummarySelect)
      .order('organization_name');

    if (locationFilter?.city) query = query.eq('city', locationFilter.city);
    if (locationFilter?.state) query = query.eq('state', locationFilter.state);

    const { data, error } = await query;

    if (error) throw error;

    res.json(formatResourceSummaries(data));
  } catch (err) {
    console.error('[GET /resources] Supabase error:', err.message);
    res.status(500).json({ error: 'Database error while loading organizations.' });
  }
});

router.get('/locations', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('resource')
      .select('city, state');

    if (error) throw error;

    const seen = new Set();
    const locations = (data ?? [])
      .map((row) => {
        const city = normalizeLocationValue(row.city);
        const state = normalizeLocationValue(row.state);
        if (!city && !state) return null;

        const key = buildLocationKey(city, state);
        if (seen.has(key)) return null;
        seen.add(key);

        const label = [city, state].filter(Boolean).join(', ');
        return { key, city, state, label };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));

    res.json(locations);
  } catch (err) {
    console.error('[GET /resources/locations] Supabase error:', err.message);
    res.status(500).json({ error: 'Database error while loading locations.' });
  }
});

/**
 * Fetches one resource with related categories and services and reshapes
 * nested Supabase relations into the frontend response structure.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function fetchResourceById(id) {
  const { data, error } = await supabase
    .from('resource')
    .select(`
      *,
      resource_category(
        category( category_id, category_name )
      ),
      resource_service(
        service_id,
        service_name,
        service_description
      )
    `)
    .eq('resource_id', id)
    .single();

  if (error || !data) return null;

  const { resource_category, resource_service, ...fields } = data;

  return {
    ...fields,
    categories: (resource_category ?? [])
      .map((rc) => ({
        id: rc.category?.category_id,
        name: rc.category?.category_name,
      }))
      .filter((c) => c.id != null),
    services: (resource_service ?? []).map((s) => ({
      id: s.service_id,
      name: s.service_name,
      description: s.service_description,
    })),
  };
}

/* -----------------------------------------------------------------------
 * GET /api/resources/autocomplete?q=<partial term>
 *
 * Returns lightweight suggestions from:
 *   - organization_name values
 *   - category_name values
 *   - service_name values
 *
 * Response shape:
 *   [{ type: 'organization'|'category'|'service', label: string, value: string }, ...]
 * --------------------------------------------------------------------- */
router.get('/autocomplete', async (req, res) => {

  const raw = req.query.q ?? '';

  if (raw.length > 200) {
    return res.status(400).json({ error: 'Search term too long.' });
  }

  const term = raw.trim();
  if (term.length < 2) return res.json([]);

  try {
    // Pull both suggestion types in parallel for low latency.
    const [orgResponse, categoryResponse, serviceResponse] = await Promise.all([
      supabase
        .from('resource')
        .select('organization_name')
        .ilike('organization_name', `%${term}%`)
        .order('organization_name')
        .limit(6),
      supabase
        .from('category')
        .select('category_name')
        .ilike('category_name', `%${term}%`)
        .order('category_name')
        .limit(6),
      supabase
        .from('resource_service')
        .select('service_name')
        .ilike('service_name', `%${term}%`)
        .order('service_name')
        .limit(6),
    ]);

    if (orgResponse.error) throw orgResponse.error;
    if (categoryResponse.error) throw categoryResponse.error;
    if (serviceResponse.error) throw serviceResponse.error;

    const rawSuggestions = [
      ...(orgResponse.data ?? []).map((row) => ({
        type: 'organization',
        label: row.organization_name,
        value: row.organization_name,
      })),
      ...(categoryResponse.data ?? []).map((row) => ({
        type: 'category',
        label: row.category_name,
        value: row.category_name,
      })),
      ...(serviceResponse.data ?? []).map((row) => ({
        type: 'service',
        label: row.service_name,
        value: row.service_name,
      })),
    ];

    // Deduplicate text while preserving first occurrence order.
    const seen = new Set();
    const suggestions = rawSuggestions
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);

    res.json(suggestions);
  } catch (err) {
    console.error('[GET /autocomplete] Supabase error:', err.message);
    res.status(500).json({ error: 'Database error during autocomplete.' });
  }
});

/* -----------------------------------------------------------------------
 * GET /api/resources/search?q=<search term>
 *
 * Searches resources by organization_name, category name, or service name.
 * We run separate queries and merge them because the Supabase JS client
 * does not support OR filtering across related tables in a single query.
 * --------------------------------------------------------------------- */
router.get('/search', async (req, res) => {

  const raw = req.query.q ?? '';
  const locationFilter = parseLocationKey(req.query.location);

  // Reject suspiciously long inputs
  if (raw.length > 200) {
    return res.status(400).json({ error: 'Search term too long.' });
  }

  const term = raw.trim();
  if (!term) return res.json([]);

  try {
    // --- Query 1: match by organization name ----------------------------
    const { data: byName, error: nameErr } = await supabase
      .from('resource')
      .select(resourceSummarySelect)
      .ilike('organization_name', `%${term}%`);

    if (nameErr) throw nameErr;

    // --- Query 2: match by category name --------------------------------
    // First find category IDs whose name matches, then find the resources
    // linked to those categories through resource_category.
    const { data: matchedCategories, error: catErr } = await supabase
      .from('category')
      .select('category_id')
      .ilike('category_name', `%${term}%`);

    if (catErr) throw catErr;

    let byCategory = [];
  let byService = [];

    if (matchedCategories && matchedCategories.length > 0) {
      const categoryIds = matchedCategories.map((c) => c.category_id);

      // Find every resource_id linked to those categories
      const { data: junctionRows, error: jErr } = await supabase
        .from('resource_category')
        .select('resource_id')
        .in('category_id', categoryIds);

      if (jErr) throw jErr;

      const resourceIds = [...new Set((junctionRows ?? []).map((r) => r.resource_id))];

      if (resourceIds.length > 0) {
        const { data: catResources, error: rErr } = await supabase
          .from('resource')
          .select(resourceSummarySelect)
          .in('resource_id', resourceIds);

        if (rErr) throw rErr;
        byCategory = catResources ?? [];
      }
    }

    // --- Query 3: match by service name ---------------------------------
    // Find matching services first, then fetch the linked resources.
    const { data: matchedServices, error: serviceErr } = await supabase
      .from('resource_service')
      .select('resource_id')
      .ilike('service_name', `%${term}%`);

    if (serviceErr) throw serviceErr;

    const serviceResourceIds = [...new Set((matchedServices ?? []).map((row) => row.resource_id))];

    if (serviceResourceIds.length > 0) {
      const { data: serviceResources, error: srErr } = await supabase
        .from('resource')
        .select(resourceSummarySelect)
        .in('resource_id', serviceResourceIds);

      if (srErr) throw srErr;
      byService = serviceResources ?? [];
    }

    // --- Merge & deduplicate by resource_id -----------------------------
    const seen = new Set();
    const merged = [...(byName ?? []), ...byCategory, ...byService].filter((r) => {
      if (seen.has(r.resource_id)) return false;
      seen.add(r.resource_id);
      return true;
    });

    const locationFiltered = locationFilter
      ? merged.filter((row) => {
          const city = normalizeLocationValue(row.city);
          const state = normalizeLocationValue(row.state);
          if (locationFilter.city && city !== locationFilter.city) return false;
          if (locationFilter.state && state !== locationFilter.state) return false;
          return true;
        })
      : merged;

    const results = formatResourceSummaries(locationFiltered);

    res.json(results);
  } catch (err) {
    console.error('[GET /search] Supabase error:', err.message);
    res.status(500).json({ error: 'Database error during search.' });
  }
});

/* -----------------------------------------------------------------------
 * POST /api/resources
 *
 * Creates a new organization resource and optionally links:
 *   - category IDs via resource_category
 *   - services via resource_service
 * --------------------------------------------------------------------- */
router.post('/', async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) return;

  const {
    organization_name,
    street_address,
    city,
    state,
    zip_code,
    email,
    phone_number,
    website,
    description,
    category_ids,
    services,
  } = req.body ?? {};

  const orgName = String(organization_name ?? '').trim();
  if (!orgName) {
    return res.status(400).json({ error: 'Organization name is required.' });
  }

  // Normalize and validate category IDs.
  const normalizedCategoryIds = Array.isArray(category_ids)
    ? category_ids
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    : [];

  if (normalizedCategoryIds.length === 0) {
    return res.status(400).json({ error: 'At least one category is required.' });
  }

  const normalizedEmail = String(email ?? '').trim() || null;
  const normalizedPhoneNumber = String(phone_number ?? '').trim() || null;
  const normalizedWebsite = String(website ?? '').trim() || null;

  if (!normalizedEmail && !normalizedPhoneNumber && !normalizedWebsite) {
    return res.status(400).json({
      error: 'At least one contact method is required: phone number, email, or website.',
    });
  }

  // Normalize and validate services.
  const normalizedServices = Array.isArray(services)
    ? services
        .map((service) => ({
          name: String(service?.name ?? '').trim(),
          description: String(service?.description ?? '').trim() || null,
        }))
        .filter((service) => service.name.length > 0)
    : [];

  try {
    // 1) Insert the base resource record first.
    const { data: insertedResource, error: resourceErr } = await context.supabase
      .from('resource')
      .insert({
        organization_name: orgName,
        street_address: String(street_address ?? '').trim() || null,
        city: String(city ?? '').trim() || null,
        state: String(state ?? '').trim() || null,
        zip_code: String(zip_code ?? '').trim() || null,
        email: normalizedEmail,
        phone_number: normalizedPhoneNumber,
        website: normalizedWebsite,
        description: String(description ?? '').trim() || null,
      })
      .select('resource_id')
      .single();

    if (resourceErr) throw resourceErr;

    const resourceId = insertedResource.resource_id;

    // 2) Create resource -> category links in the junction table.
    if (normalizedCategoryIds.length > 0) {
      const categoryRows = normalizedCategoryIds.map((categoryId) => ({
        resource_id: resourceId,
        category_id: categoryId,
      }));

      const { error: categoryErr } = await context.supabase
        .from('resource_category')
        .insert(categoryRows);

      if (categoryErr) throw categoryErr;
    }

    // 3) Insert optional services for the resource.
    if (normalizedServices.length > 0) {
      const serviceRows = normalizedServices.map((service) => ({
        resource_id: resourceId,
        service_name: service.name,
        service_description: service.description,
      }));

      const { error: serviceErr } = await context.supabase
        .from('resource_service')
        .insert(serviceRows);

      if (serviceErr) throw serviceErr;
    }

    // Return full object in the same shape used by GET /:id.
    const created = await fetchResourceById(resourceId);
    res.status(201).json(created);
  } catch (err) {
    console.error('[POST /resources] Supabase error:', err.message);
    res.status(500).json({
      error: 'Could not create organization. Check Supabase RLS insert policies.',
    });
  }
});

router.put('/:id', async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) return;

  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid resource ID.' });
  }

  const {
    organization_name,
    street_address,
    city,
    state,
    zip_code,
    email,
    phone_number,
    website,
    description,
    category_ids,
    services,
  } = req.body ?? {};

  const orgName = String(organization_name ?? '').trim();
  if (!orgName) {
    return res.status(400).json({ error: 'Organization name is required.' });
  }

  const normalizedCategoryIds = Array.isArray(category_ids)
    ? category_ids
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (normalizedCategoryIds.length === 0) {
    return res.status(400).json({ error: 'At least one category is required.' });
  }

  const normalizedEmail = String(email ?? '').trim() || null;
  const normalizedPhoneNumber = String(phone_number ?? '').trim() || null;
  const normalizedWebsite = String(website ?? '').trim() || null;

  if (!normalizedEmail && !normalizedPhoneNumber && !normalizedWebsite) {
    return res.status(400).json({
      error: 'At least one contact method is required: phone number, email, or website.',
    });
  }

  const normalizedServices = Array.isArray(services)
    ? services
        .map((service) => ({
          name: String(service?.name ?? '').trim(),
          description: String(service?.description ?? '').trim() || null,
        }))
        .filter((service) => service.name.length > 0)
    : [];

  try {
    const { error: resourceErr } = await context.supabase
      .from('resource')
      .update({
        organization_name: orgName,
        street_address: String(street_address ?? '').trim() || null,
        city: String(city ?? '').trim() || null,
        state: String(state ?? '').trim() || null,
        zip_code: String(zip_code ?? '').trim() || null,
        email: normalizedEmail,
        phone_number: normalizedPhoneNumber,
        website: normalizedWebsite,
        description: String(description ?? '').trim() || null,
      })
      .eq('resource_id', id);

    if (resourceErr) throw resourceErr;

    const { error: deleteCategoryErr } = await context.supabase
      .from('resource_category')
      .delete()
      .eq('resource_id', id);

    if (deleteCategoryErr) throw deleteCategoryErr;

    if (normalizedCategoryIds.length > 0) {
      const { error: insertCategoryErr } = await context.supabase
        .from('resource_category')
        .insert(normalizedCategoryIds.map((categoryId) => ({ resource_id: id, category_id: categoryId })));

      if (insertCategoryErr) throw insertCategoryErr;
    }

    const { error: deleteServiceErr } = await context.supabase
      .from('resource_service')
      .delete()
      .eq('resource_id', id);

    if (deleteServiceErr) throw deleteServiceErr;

    if (normalizedServices.length > 0) {
      const { error: insertServiceErr } = await context.supabase
        .from('resource_service')
        .insert(normalizedServices.map((service) => ({
          resource_id: id,
          service_name: service.name,
          service_description: service.description,
        })));

      if (insertServiceErr) throw insertServiceErr;
    }

    const updated = await fetchResourceById(id);
    res.json(updated);
  } catch (err) {
    console.error(`[PUT /resources/${id}] Supabase error:`, err.message);
    res.status(500).json({ error: 'Could not update organization.' });
  }
});

router.delete('/:id', async (req, res) => {
  const context = await requireAdminContext(req, res);
  if (!context) return;

  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid resource ID.' });
  }

  try {
    // Clean up junction/service rows before deleting the base resource.
    const { error: deleteCategoryErr } = await context.supabase
      .from('resource_category')
      .delete()
      .eq('resource_id', id);

    if (deleteCategoryErr) throw deleteCategoryErr;

    const { error: deleteServiceErr } = await context.supabase
      .from('resource_service')
      .delete()
      .eq('resource_id', id);

    if (deleteServiceErr) throw deleteServiceErr;

    const { error: deleteResourceErr } = await context.supabase
      .from('resource')
      .delete()
      .eq('resource_id', id);

    if (deleteResourceErr) throw deleteResourceErr;

    res.status(204).send();
  } catch (err) {
    console.error(`[DELETE /resources/${id}] Supabase error:`, err.message);
    res.status(500).json({ error: 'Could not delete organization.' });
  }
});

/* -----------------------------------------------------------------------
 * GET /api/resources/:id
 *
 * Returns the full record for a single resource, including:
 *   - All address / contact fields
 *   - categories: [{ id, name }, ...]
 *   - services:   [{ id, name, description }, ...]
 * --------------------------------------------------------------------- */
router.get('/:id', async (req, res) => {

  const id = parseInt(req.params.id, 10);

  // Validate that the id is a number to prevent injection
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid resource ID.' });
  }

  try {
    const resource = await fetchResourceById(id);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    res.json(resource);
  } catch (err) {
    console.error(`[GET /${id}] Supabase error:`, err.message);
    res.status(500).json({ error: 'Database error while fetching resource.' });
  }
});

export default router;
