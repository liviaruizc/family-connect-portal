/**
 * src/api.js — Thin wrapper around the Family Connect REST API.
 *
 * All network calls live here so the rest of the app never needs to
 * know about endpoint URLs, auth headers, or response parsing rules.
 */

const BASE = '/api';

let authToken = null;

export function setApiAuthToken(token) {
  authToken = token;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  return fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
}

async function parseJsonOrThrow(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? fallbackMessage);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Auth / profile
// ---------------------------------------------------------------------------

export async function getCurrentProfile() {
  const response = await apiFetch('/auth/me');
  return parseJsonOrThrow(response, 'Could not load current user profile.');
}

export async function listPromotableUsers() {
  const response = await apiFetch('/auth/users');
  return parseJsonOrThrow(response, 'Could not load users.');
}

export async function promoteUserToAdmin(profileId) {
  const response = await apiFetch('/auth/promote-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });

  return parseJsonOrThrow(response, 'Could not promote user to admin.');
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function getAllResources() {
  const response = await apiFetch('/resources');
  return parseJsonOrThrow(response, 'Could not load organizations.');
}

export async function getAllResourcesByLocation(locationKey = '') {
  const params = new URLSearchParams();
  if (locationKey) params.set('location', locationKey);

  const path = params.size ? `/resources?${params}` : '/resources';
  const response = await apiFetch(path);
  return parseJsonOrThrow(response, 'Could not load organizations.');
}

export async function searchResources(query, locationKey = '') {
  const params = new URLSearchParams({ q: query });
  if (locationKey) params.set('location', locationKey);
  const response = await apiFetch(`/resources/search?${params}`);
  return parseJsonOrThrow(response, 'Search failed.');
}

export async function getLocations() {
  const response = await apiFetch('/resources/locations');
  return parseJsonOrThrow(response, 'Could not load locations.');
}

export async function getAutocompleteSuggestions(query) {
  const params = new URLSearchParams({ q: query });
  const response = await apiFetch(`/resources/autocomplete?${params}`);
  return parseJsonOrThrow(response, 'Autocomplete failed.');
}

export async function getResource(id) {
  const response = await apiFetch(`/resources/${encodeURIComponent(id)}`);
  return parseJsonOrThrow(response, 'Could not load resource.');
}

export async function createResource(payload) {
  const response = await apiFetch('/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonOrThrow(response, 'Could not create organization.');
}

export async function updateResource(id, payload) {
  const response = await apiFetch(`/resources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonOrThrow(response, 'Could not update organization.');
}

export async function deleteResource(id) {
  const response = await apiFetch(`/resources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Could not delete organization.');
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function getCategories() {
  const response = await apiFetch('/categories');
  return parseJsonOrThrow(response, 'Could not load categories.');
}
