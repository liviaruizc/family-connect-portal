/**
 * src/main.js — Family Connect Portal
 *
 * Responsibilities:
 *  1. Require login / sign-up through Supabase Auth
 *  2. Load the signed-in profile and apply role-based UI rules
 *  3. Show all organizations on initial load, then support search/autocomplete
 *  4. Let admins add and edit organizations
 *  5. Let admins promote existing users to admin
 *  6. Export resource details as a PDF from the detail view
 */

import './style.css';
import { jsPDF } from 'jspdf';
import {
  createResource,
  deleteResource,
  getAllResourcesByLocation,
  getAutocompleteSuggestions,
  getCategories,
  getCurrentProfile,
  getLocations,
  getResource,
  listPromotableUsers,
  promoteUserToAdmin,
  searchResources,
  setApiAuthToken,
  updateResource,
} from './api.js';
import {
  getCurrentSession,
  initAuthClient,
  onAuthChanged,
  signIn,
  signOutUser,
  signUp,
} from './authClient.js';

const authShell = document.getElementById('auth-shell');
const appShell = document.getElementById('app-shell');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const authForm = document.getElementById('auth-form');
const authSubmit = document.getElementById('auth-submit');
const authStatus = document.getElementById('auth-status');
const fullNameRow = document.getElementById('full-name-row');
const confirmPasswordRow = document.getElementById('confirm-password-row');
const authFullName = document.getElementById('auth-full-name');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authConfirmPassword = document.getElementById('auth-confirm-password');
const logoutButton = document.getElementById('logout-button');
const userName = document.getElementById('user-name');
const userRole = document.getElementById('user-role');

const addOrgOpen = document.getElementById('add-org-open');
const addAdminOpen = document.getElementById('add-admin-open');

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const autocompleteList = document.getElementById('autocomplete-list');
const categorySelect = document.getElementById('category-select');
const locationSelect = document.getElementById('location-select');
const resultsSection = document.getElementById('results-section');
const resultsGrid = document.getElementById('results-grid');
const resultsCount = document.getElementById('results-count');
const exportAllPdfButton = document.getElementById('export-all-pdf');
const noResults = document.getElementById('no-results');

const detailModal = document.getElementById('detail-modal');
const detailContent = document.getElementById('detail-content');
const detailClose = document.getElementById('detail-close');

const addOrgModal = document.getElementById('add-org-modal');
const addOrgClose = document.getElementById('add-org-close');
const addOrgForm = document.getElementById('add-org-form');
const addOrgStatus = document.getElementById('add-org-status');
const addOrgSubmit = document.getElementById('add-org-submit');
const orgModalTitle = document.getElementById('org-modal-title');
const addOrgCategories = document.getElementById('org-categories');

const orgNameInput = document.getElementById('org-name');
const orgStreetInput = document.getElementById('org-street');
const orgCityInput = document.getElementById('org-city');
const orgStateInput = document.getElementById('org-state');
const orgZipInput = document.getElementById('org-zip');
const orgPhoneInput = document.getElementById('org-phone');
const orgEmailInput = document.getElementById('org-email');
const orgWebsiteInput = document.getElementById('org-website');
const orgDescInput = document.getElementById('org-description');
const orgServicesInput = document.getElementById('org-services');

const addAdminModal = document.getElementById('add-admin-modal');
const addAdminClose = document.getElementById('add-admin-close');
const addAdminForm = document.getElementById('add-admin-form');
const addAdminStatus = document.getElementById('add-admin-status');
const addAdminSubmit = document.getElementById('add-admin-submit');
const adminUserSelect = document.getElementById('admin-user-select');

let authMode = 'login';
let currentProfile = null;
let activeResource = null;
let autocompleteItems = [];
let highlightedSuggestion = -1;
let autocompleteTimer = null;
let orgFormMode = 'create';
let editingResourceId = null;
let currentResources = [];

loginTab.addEventListener('click', () => setAuthMode('login'));
signupTab.addEventListener('click', () => setAuthMode('signup'));
logoutButton.addEventListener('click', handleLogout);

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = searchInput.value.trim() || categorySelect.value;
  if (!query) {
    loadInitialDirectory(locationSelect.value);
    return;
  }

  hideAutocomplete();
  runSearch(query, locationSelect.value);
});

categorySelect.addEventListener('change', () => {
  if (!categorySelect.value) {
    if (!searchInput.value.trim()) {
      loadInitialDirectory(locationSelect.value);
    }
    return;
  }

  searchInput.value = '';
  hideAutocomplete();
  runSearch(categorySelect.value, locationSelect.value);
});

locationSelect.addEventListener('change', () => {
  hideAutocomplete();
  const query = searchInput.value.trim() || categorySelect.value;
  if (query) {
    runSearch(query, locationSelect.value);
  } else {
    loadInitialDirectory(locationSelect.value);
  }
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  highlightedSuggestion = -1;

  if (autocompleteTimer) clearTimeout(autocompleteTimer);

  if (query.length === 0) {
    hideAutocomplete();
    if (!categorySelect.value) {
      loadInitialDirectory(locationSelect.value);
    }
    return;
  }

  if (query.length < 2) {
    hideAutocomplete();
    return;
  }

  autocompleteTimer = setTimeout(async () => {
    try {
      const suggestions = await getAutocompleteSuggestions(query);
      renderAutocomplete(suggestions);
    } catch {
      hideAutocomplete();
    }
  }, 220);
});

searchInput.addEventListener('keydown', (event) => {
  const isOpen = !autocompleteList.classList.contains('hidden');
  if (!isOpen || autocompleteItems.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlightedSuggestion = Math.min(highlightedSuggestion + 1, autocompleteItems.length - 1);
    syncAutocompleteHighlight();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlightedSuggestion = Math.max(highlightedSuggestion - 1, 0);
    syncAutocompleteHighlight();
  } else if (event.key === 'Enter' && highlightedSuggestion >= 0) {
    event.preventDefault();
    applyAutocomplete(autocompleteItems[highlightedSuggestion].value);
  } else if (event.key === 'Escape') {
    hideAutocomplete();
  }
});

document.addEventListener('click', (event) => {
  if (event.target === searchInput || autocompleteList.contains(event.target)) return;
  hideAutocomplete();
});

exportAllPdfButton.addEventListener('click', () => {
  exportAllResourcesPdf(currentResources);
});

detailClose.addEventListener('click', closeDetailModal);
detailModal.addEventListener('click', (event) => {
  if (event.target === detailModal) closeDetailModal();
});

addOrgOpen.addEventListener('click', () => openOrganizationModal('create'));
addOrgClose.addEventListener('click', closeOrganizationModal);
addOrgModal.addEventListener('click', (event) => {
  if (event.target === addOrgModal) closeOrganizationModal();
});

addAdminOpen.addEventListener('click', openAddAdminModal);
addAdminClose.addEventListener('click', closeAddAdminModal);
addAdminModal.addEventListener('click', (event) => {
  if (event.target === addAdminModal) closeAddAdminModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (!addAdminModal.classList.contains('hidden')) closeAddAdminModal();
  else if (!addOrgModal.classList.contains('hidden')) closeOrganizationModal();
  else if (!detailModal.classList.contains('hidden')) closeDetailModal();
});

authForm.addEventListener('submit', handleAuthSubmit);
addOrgForm.addEventListener('submit', handleOrganizationSubmit);
addAdminForm.addEventListener('submit', handleAddAdminSubmit);

// Allow selecting multiple category options with simple clicks (no Ctrl/Cmd needed).
addOrgCategories.addEventListener('mousedown', (event) => {
  const option = event.target;
  if (!(option instanceof HTMLOptionElement)) return;

  event.preventDefault();
  option.selected = !option.selected;
  addOrgCategories.focus();
});

bootstrap().catch((error) => {
  setAuthStatus(error.message, 'error');
});

async function bootstrap() {
  await initAuthClient();
  const { data } = await getCurrentSession();
  await handleSessionChange(data.session ?? null);
  onAuthChanged((session) => {
    handleSessionChange(session).catch((error) => {
      setAuthStatus(error.message, 'error');
    });
  });
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === 'signup';

  loginTab.classList.toggle('active', !isSignup);
  signupTab.classList.toggle('active', isSignup);
  fullNameRow.classList.toggle('hidden', !isSignup);
  confirmPasswordRow.classList.toggle('hidden', !isSignup);
  authSubmit.textContent = isSignup ? 'Create Account' : 'Login';
  setAuthStatus('', '');
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value;
  const confirmPassword = authConfirmPassword.value;
  const fullName = authFullName.value.trim();

  if (!email || !password) {
    setAuthStatus('Email and password are required.', 'error');
    return;
  }

  if (authMode === 'signup' && !fullName) {
    setAuthStatus('Full name is required when creating an account.', 'error');
    return;
  }

  if (authMode === 'signup' && password !== confirmPassword) {
    setAuthStatus('Password and confirm password must match.', 'error');
    return;
  }

  authSubmit.disabled = true;
  authSubmit.textContent = authMode === 'signup' ? 'Creating...' : 'Signing In...';

  try {
    if (authMode === 'signup') {
      const { data, error } = await signUp(email, password, fullName);
      if (error) throw error;

      if (!data.session) {
        setAuthStatus('Account created. Check your email confirmation link, then log in.', 'success');
        setAuthMode('login');
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) throw error;
    }
  } catch (error) {
    setAuthStatus(error.message, 'error');
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === 'signup' ? 'Create Account' : 'Login';
  }
}

async function handleSessionChange(session) {
  setApiAuthToken(session?.access_token ?? null);

  if (!session) {
    currentProfile = null;
    updateRoleControls();
    showAuthShell();
    return;
  }

  const profilePayload = await getCurrentProfile();
  currentProfile = profilePayload.profile;

  userName.textContent =
    sanitizeFormValue(currentProfile.full_name)
    || sanitizeFormValue(profilePayload.user.email)
    || 'User';
  userRole.textContent = sanitizeFormValue(currentProfile.role) || 'volunteer';

  showAppShell();
  updateRoleControls();
  setAuthStatus('', '');

  await loadCategories();
  await loadLocations();
  await loadInitialDirectory(locationSelect.value);
}

async function handleLogout() {
  await signOutUser();
}

function showAuthShell() {
  authShell.classList.remove('hidden');
  appShell.classList.add('hidden');
  closeDetailModal();
  closeOrganizationModal();
  closeAddAdminModal();
  syncBodyLock();
}

function showAppShell() {
  authShell.classList.add('hidden');
  appShell.classList.remove('hidden');
}

function updateRoleControls() {
  const admin = currentProfile?.role === 'admin';
  addOrgOpen.classList.toggle('hidden', !admin);
  addAdminOpen.classList.toggle('hidden', !admin);
}

function isAdmin() {
  return currentProfile?.role === 'admin';
}

async function loadCategories() {
  const categories = await getCategories();

  categorySelect.innerHTML = '<option value="">Browse by category…</option>';
  addOrgCategories.innerHTML = '';

  categories.forEach(({ category_id, category_name }) => {
    const searchOption = document.createElement('option');
    searchOption.value = category_name;
    searchOption.textContent = category_name;
    categorySelect.appendChild(searchOption);

    const formOption = document.createElement('option');
    formOption.value = String(category_id);
    formOption.textContent = category_name;
    addOrgCategories.appendChild(formOption);
  });
}

async function loadLocations() {
  const locations = await getLocations();
  locationSelect.innerHTML = '<option value="">All locations</option>';

  locations.forEach((location) => {
    const option = document.createElement('option');
    option.value = location.key;
    option.textContent = location.label;
    locationSelect.appendChild(option);
  });
}

async function loadInitialDirectory(locationKey = '') {
  resultsSection.classList.remove('hidden');
  resultsGrid.innerHTML = '<p class="loading">Loading organizations…</p>';
  noResults.classList.add('hidden');
  setCurrentResources([]);

  try {
    const resources = await getAllResourcesByLocation(locationKey);
    const activeLocationLabel = locationSelect.options[locationSelect.selectedIndex]?.textContent;
    const label = locationKey && activeLocationLabel
      ? `All organizations in ${activeLocationLabel}`
      : 'All organizations';
    renderResults(resources, null, label);
  } catch (error) {
    resultsGrid.innerHTML = `<p class="error-msg">Error: ${escapeHtml(error.message)}</p>`;
  }
}

async function runSearch(query, locationKey = '') {
  resultsSection.classList.remove('hidden');
  resultsGrid.innerHTML = '<p class="loading">Searching…</p>';
  noResults.classList.add('hidden');
  setCurrentResources([]);
  resultsCount.textContent = '';

  try {
    const resources = await searchResources(query, locationKey);
    renderResults(resources, query);
  } catch (error) {
    resultsGrid.innerHTML = `<p class="error-msg">Error: ${escapeHtml(error.message)}</p>`;
  }
}

function renderResults(resources, query, customLabel = '') {
  resultsGrid.innerHTML = '';

  if (resources.length === 0) {
    noResults.classList.remove('hidden');
    resultsCount.textContent = '';
    setCurrentResources([]);
    return;
  }
  setCurrentResources(resources);

  resultsCount.textContent = customLabel
    ? `${resources.length} organization${resources.length !== 1 ? 's' : ''} in ${customLabel}`
    : `${resources.length} result${resources.length !== 1 ? 's' : ''} for "${query}"`;

  noResults.classList.add('hidden');
  resources.forEach((resource) => {
    resultsGrid.appendChild(buildResourceCard(resource));
  });
}

function buildResourceCard(resource) {
  const card = document.createElement('article');
  card.className = 'resource-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  const organizationName = sanitizeFormValue(resource.organization_name) || 'Organization';
  card.setAttribute('aria-label', `View details for ${organizationName}`);

  const city = sanitizeFormValue(resource.city);
  const state = sanitizeFormValue(resource.state);
  const location = [city, state].filter(Boolean).join(', ') || 'Location not listed';
  const description = sanitizeFormValue(resource.description);
  const categoryBadges = sanitizeFormValue(resource.categories)
    ? sanitizeFormValue(resource.categories)
        .split(', ')
        .map((category) => sanitizeFormValue(category))
        .filter(Boolean)
        .map((category) => `<span class="badge">${escapeHtml(category)}</span>`)
        .join('')
    : '';

  card.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">${escapeHtml(organizationName)}</h3>
      <div class="card-categories">${categoryBadges}</div>
    </div>
    <div class="card-body">
      <p class="card-location">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
        ${escapeHtml(location)}
      </p>
      ${description ? `<p class="card-desc">${escapeHtml(truncate(description, 120))}</p>` : ''}
    </div>
    <div class="card-footer">
      <span class="view-details">View Details →</span>
    </div>
  `;

  const openDetail = () => openDetailModal(resource.resource_id);
  card.addEventListener('click', openDetail);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail();
    }
  });

  return card;
}

async function openDetailModal(id) {
  detailContent.innerHTML = '<p class="loading">Loading details…</p>';
  detailModal.classList.remove('hidden');
  detailModal.setAttribute('aria-hidden', 'false');
  syncBodyLock();

  try {
    const resource = await getResource(id);
    activeResource = resource;
    detailContent.innerHTML = buildDetailHtml(resource);

    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      exportResourcePdf(resource);
    });

    if (isAdmin()) {
      document.getElementById('btn-edit-organization').addEventListener('click', () => {
        openOrganizationModal('edit', resource);
      });

      document.getElementById('btn-delete-organization').addEventListener('click', () => {
        handleDeleteOrganization(resource);
      });
    }
  } catch (error) {
    detailContent.innerHTML = `<p class="error-msg">Could not load resource: ${escapeHtml(error.message)}</p>`;
  }
}

function buildDetailHtml(resource) {
  const organizationName = sanitizeFormValue(resource.organization_name) || 'Organization';
  const streetAddress = sanitizeFormValue(resource.street_address);
  const city = sanitizeFormValue(resource.city);
  const state = sanitizeFormValue(resource.state);
  const zipCode = sanitizeFormValue(resource.zip_code);
  const phoneNumber = sanitizeFormValue(resource.phone_number);
  const email = sanitizeFormValue(resource.email);
  const website = sanitizeFormValue(resource.website);
  const description = sanitizeFormValue(resource.description);

  const address = [
    streetAddress,
    city,
    state,
    zipCode,
  ].filter(Boolean).join(', ') || 'Not provided';

  const categoryBadges = Array.isArray(resource.categories) && resource.categories.length
    ? resource.categories
        .map((category) => sanitizeFormValue(category?.name))
        .filter(Boolean)
        .map((categoryName) => `<span class="badge">${escapeHtml(categoryName)}</span>`)
        .join('')
    : '<em>None listed</em>';

  const servicesHtml = Array.isArray(resource.services) && resource.services.length
    ? resource.services.map((service) => {
        const serviceName = sanitizeFormValue(service?.name);
        const serviceDescription = sanitizeFormValue(service?.description);
        if (!serviceName) return null;
        return `
        <li class="service-item">
          <strong>${escapeHtml(serviceName)}</strong>
          ${serviceDescription ? `<p>${escapeHtml(serviceDescription)}</p>` : ''}
        </li>
      `;
      }).filter(Boolean).join('')
    : '<li><em>No services listed.</em></li>';

  return `
    <div class="detail-header">
      <h2>${escapeHtml(organizationName)}</h2>
      <div class="detail-categories">${categoryBadges}</div>
    </div>
    <div class="detail-grid">
      <section class="detail-section">
        <h3>Contact &amp; Location</h3>
        <dl>
          <dt>Address</dt><dd>${escapeHtml(address)}</dd>
          <dt>Phone</dt><dd>${phoneNumber ? `<a href="tel:${escapeHtml(phoneNumber)}">${escapeHtml(phoneNumber)}</a>` : 'Not provided'}</dd>
          <dt>Email</dt><dd>${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : 'Not provided'}</dd>
          <dt>Website</dt><dd>${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(website)}</a>` : 'Not provided'}</dd>
        </dl>
      </section>
      <section class="detail-section">
        <h3>About</h3>
        <p>${description ? escapeHtml(description) : '<em>No description available.</em>'}</p>
      </section>
    </div>
    <section class="detail-section">
      <h3>Services Offered</h3>
      <ul class="services-list">${servicesHtml}</ul>
    </section>
    <div class="detail-actions">
      ${isAdmin() ? '<button id="btn-edit-organization" class="btn btn-outline">Edit Organization</button>' : ''}
      ${isAdmin() ? '<button id="btn-delete-organization" class="btn btn-outline">Delete Organization</button>' : ''}
      <button id="btn-export-pdf" class="btn btn-primary">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h1z"/></svg>
        Export PDF
      </button>
    </div>
  `;
}



function closeDetailModal() {
  detailModal.classList.add('hidden');
  detailModal.setAttribute('aria-hidden', 'true');
  activeResource = null;
  syncBodyLock();
}

function openOrganizationModal(mode, resource = null) {
  orgFormMode = mode;
  editingResourceId = resource?.resource_id ?? null;
  addOrgForm.reset();
  setAddOrgStatus('', '');

  orgModalTitle.textContent = mode === 'edit' ? 'Edit Organization' : 'Add New Organization';
  addOrgSubmit.textContent = mode === 'edit' ? 'Save Changes' : 'Save Organization';

  Array.from(addOrgCategories.options).forEach((option) => {
    option.selected = false;
  });

  if (resource) {
    orgNameInput.value = sanitizeFormValue(resource.organization_name);
    orgStreetInput.value = sanitizeFormValue(resource.street_address);
    orgCityInput.value = sanitizeFormValue(resource.city);
    orgStateInput.value = sanitizeFormValue(resource.state);
    orgZipInput.value = sanitizeFormValue(resource.zip_code);
    orgPhoneInput.value = sanitizeFormValue(resource.phone_number);
    orgEmailInput.value = sanitizeFormValue(resource.email);
    orgWebsiteInput.value = sanitizeFormValue(resource.website);
    orgDescInput.value = sanitizeFormValue(resource.description);

    const selectedCategoryIds = new Set((resource.categories ?? []).map((category) => String(category.id)));
    Array.from(addOrgCategories.options).forEach((option) => {
      option.selected = selectedCategoryIds.has(option.value);
    });

    orgServicesInput.value = (resource.services ?? [])
      .map((service) => service.description ? `${service.name} | ${service.description}` : service.name)
      .join('\n');
  }

  addOrgModal.classList.remove('hidden');
  addOrgModal.setAttribute('aria-hidden', 'false');
  syncBodyLock();
  orgNameInput.focus();
}

function closeOrganizationModal() {
  addOrgModal.classList.add('hidden');
  addOrgModal.setAttribute('aria-hidden', 'true');
  syncBodyLock();
}

async function handleOrganizationSubmit(event) {
  event.preventDefault();

  const organizationName = orgNameInput.value.trim();
  if (!organizationName) {
    setAddOrgStatus('Organization name is required.', 'error');
    return;
  }

  if (orgEmailInput.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmailInput.value.trim())) {
    setAddOrgStatus('Please enter a valid organization email.', 'error');
    return;
  }

  if (orgWebsiteInput.value.trim()) {
    try {
      const parsed = new URL(orgWebsiteInput.value.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch {
      setAddOrgStatus('Please enter a valid website URL starting with http:// or https://.', 'error');
      return;
    }
  }

  const selectedCategoryIds = Array.from(addOrgCategories.selectedOptions)
    .map((option) => Number.parseInt(option.value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (selectedCategoryIds.length === 0) {
    setAddOrgStatus('Please select at least one category.', 'error');
    return;
  }

  const hasPhone = Boolean(valueOrNull(orgPhoneInput.value));
  const hasEmail = Boolean(valueOrNull(orgEmailInput.value));
  const hasWebsite = Boolean(valueOrNull(orgWebsiteInput.value));

  if (!hasPhone && !hasEmail && !hasWebsite) {
    setAddOrgStatus('Provide at least one contact method: phone number, email, or website.', 'error');
    return;
  }

  const payload = {
    organization_name: organizationName,
    street_address: valueOrNull(orgStreetInput.value),
    city: valueOrNull(orgCityInput.value),
    state: valueOrNull(orgStateInput.value),
    zip_code: valueOrNull(orgZipInput.value),
    phone_number: valueOrNull(orgPhoneInput.value),
    email: valueOrNull(orgEmailInput.value),
    website: valueOrNull(orgWebsiteInput.value),
    description: valueOrNull(orgDescInput.value),
    category_ids: selectedCategoryIds,
    services: parseServices(orgServicesInput.value),
  };

  addOrgSubmit.disabled = true;
  addOrgSubmit.textContent = orgFormMode === 'edit' ? 'Saving...' : 'Creating...';

  try {
    const resource = orgFormMode === 'edit'
      ? await updateResource(editingResourceId, payload)
      : await createResource(payload);

    closeOrganizationModal();
    searchInput.value = resource.organization_name;
    categorySelect.value = '';
    await runSearch(resource.organization_name);
    await openDetailModal(resource.resource_id);
  } catch (error) {
    setAddOrgStatus(error.message, 'error');
  } finally {
    addOrgSubmit.disabled = false;
    addOrgSubmit.textContent = orgFormMode === 'edit' ? 'Save Changes' : 'Save Organization';
  }
}

function setAddOrgStatus(message, type) {
  addOrgStatus.textContent = message;
  addOrgStatus.className = type ? `email-status ${type}` : 'email-status';
}

async function handleDeleteOrganization(resource) {
  const confirmed = window.confirm(
    `Delete "${sanitizeFormValue(resource.organization_name) || 'this organization'}"? This cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await deleteResource(resource.resource_id);
    closeDetailModal();

    // Keep list in sync after deletion based on current filter/search state.
    const activeQuery = searchInput.value.trim() || categorySelect.value;
    if (activeQuery) {
      await runSearch(activeQuery, locationSelect.value);
    } else {
      await loadInitialDirectory(locationSelect.value);
    }
  } catch (error) {
    detailContent.innerHTML = `<p class="error-msg">Could not delete organization: ${escapeHtml(error.message)}</p>`;
  }
}

async function openAddAdminModal() {
  addAdminForm.reset();
  setAddAdminStatus('', '');
  addAdminSubmit.disabled = true;
  addAdminSubmit.textContent = 'Loading users...';
  addAdminModal.classList.remove('hidden');
  addAdminModal.setAttribute('aria-hidden', 'false');
  syncBodyLock();

  try {
    await loadPromotableUsers();
    adminUserSelect.focus();
  } catch (error) {
    setAddAdminStatus(error.message, 'error');
  } finally {
    addAdminSubmit.disabled = false;
    addAdminSubmit.textContent = 'Promote to Admin';
  }
}

function closeAddAdminModal() {
  addAdminModal.classList.add('hidden');
  addAdminModal.setAttribute('aria-hidden', 'true');
  syncBodyLock();
}

async function handleAddAdminSubmit(event) {
  event.preventDefault();

  const selectedUserId = adminUserSelect.value;
  if (!selectedUserId) {
    setAddAdminStatus('Please select a user.', 'error');
    return;
  }

  addAdminSubmit.disabled = true;
  addAdminSubmit.textContent = 'Promoting...';

  try {
    const payload = await promoteUserToAdmin(selectedUserId);
    const displayName = payload.profile.full_name || payload.profile.email;
    setAddAdminStatus(`${displayName} is now an admin.`, 'success');
    await loadPromotableUsers();
  } catch (error) {
    setAddAdminStatus(error.message, 'error');
  } finally {
    addAdminSubmit.disabled = false;
    addAdminSubmit.textContent = 'Promote to Admin';
  }
}

function setAddAdminStatus(message, type) {
  addAdminStatus.textContent = message;
  addAdminStatus.className = type ? `email-status ${type}` : 'email-status';
}

function renderAutocomplete(items) {
  autocompleteItems = items;
  highlightedSuggestion = -1;
  autocompleteList.innerHTML = '';

  if (!items.length) {
    hideAutocomplete();
    return;
  }

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.id = `autocomplete-option-${idx}`;
    li.innerHTML = `
      <button type="button" class="autocomplete-item" data-index="${idx}">
        <span>${escapeHtml(item.label)}</span>
        <span class="autocomplete-type">${escapeHtml(item.type)}</span>
      </button>
    `;
    li.querySelector('button').addEventListener('click', () => applyAutocomplete(item.value));
    autocompleteList.appendChild(li);
  });

  autocompleteList.classList.remove('hidden');
  searchInput.setAttribute('aria-expanded', 'true');
}

function applyAutocomplete(value) {
  searchInput.value = value;
  hideAutocomplete();
  runSearch(value);
}

function hideAutocomplete() {
  autocompleteItems = [];
  highlightedSuggestion = -1;
  autocompleteList.innerHTML = '';
  autocompleteList.classList.add('hidden');
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
}

function syncAutocompleteHighlight() {
  const buttons = autocompleteList.querySelectorAll('.autocomplete-item');
  buttons.forEach((button) => button.classList.remove('active'));

  const activeButton = buttons[highlightedSuggestion];
  if (!activeButton) return;

  activeButton.classList.add('active');
  activeButton.scrollIntoView({ block: 'nearest' });
  searchInput.setAttribute('aria-activedescendant', `autocomplete-option-${highlightedSuggestion}`);
}

function exportResourcePdf(resource) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginLeft = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - (marginLeft * 2);
  let cursorY = 56;

  const address = [
    sanitizeFormValue(resource.street_address),
    sanitizeFormValue(resource.city),
    sanitizeFormValue(resource.state),
    sanitizeFormValue(resource.zip_code),
  ].filter(Boolean).join(', ') || 'Not provided';

  const categories = Array.isArray(resource.categories) && resource.categories.length
    ? resource.categories
        .map((category) => sanitizeFormValue(category?.name))
        .filter(Boolean)
        .join(', ')
    : 'None listed';

  const services = Array.isArray(resource.services) && resource.services.length
    ? resource.services.map((service) => {
        const serviceName = sanitizeFormValue(service?.name);
        const serviceDescription = sanitizeFormValue(service?.description);
        if (!serviceName) return null;
        const detail = serviceDescription ? `: ${serviceDescription}` : '';
        return `- ${serviceName}${detail}`;
      }).filter(Boolean).join('\n')
    : 'No services listed.';

  const phoneNumber = sanitizeFormValue(resource.phone_number);
  const email = sanitizeFormValue(resource.email);
  const website = sanitizeFormValue(resource.website);
  const description = sanitizeFormValue(resource.description);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Family Connect Resource Information', marginLeft, cursorY);
  cursorY += 30;

  doc.setFontSize(12);
  cursorY = writePdfSection(doc, 'Organization', sanitizeFormValue(resource.organization_name) || 'Not provided', marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Address', address, marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Phone', phoneNumber || 'Not provided', marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Email', email || 'Not provided', marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Website', website || 'Not provided', marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Categories', categories || 'None listed', marginLeft, cursorY, contentWidth);
  cursorY = writePdfSection(doc, 'Description', description || 'No description available.', marginLeft, cursorY, contentWidth);
  writePdfSection(doc, 'Services Offered', services, marginLeft, cursorY, contentWidth);

  doc.save(`${slugifyFileName(resource.organization_name)}.pdf`);
}

function exportAllResourcesPdf(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 48;
  const marginRight = 48;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let cursorY = 56;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Family Connect Resources', marginLeft, cursorY);
  cursorY += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${resources.length} organization${resources.length !== 1 ? 's' : ''} currently displayed`, marginLeft, cursorY);
  cursorY += 28;

  resources.forEach((resource, index) => {
    if (index > 0) {
      cursorY += 10;
    }

    cursorY = ensurePdfSpace(doc, cursorY, 90);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);

    const title = `${index + 1}. ${sanitizeFormValue(resource.organization_name) || 'Organization'}`;
    const titleLines = doc.splitTextToSize(title, contentWidth);
    doc.text(titleLines, marginLeft, cursorY);
    cursorY += (titleLines.length * 16) + 6;

    const city = sanitizeFormValue(resource.city);
    const state = sanitizeFormValue(resource.state);
    const address = [
      sanitizeFormValue(resource.street_address),
      [city, state].filter(Boolean).join(', '),
      sanitizeFormValue(resource.zip_code),
    ].filter(Boolean).join(', ') || 'Location not listed';

    const categories = normalizeCategoriesForPdf(resource.categories);
    const phoneNumber = sanitizeFormValue(resource.phone_number);
    const email = sanitizeFormValue(resource.email);
    const website = sanitizeFormValue(resource.website);
    const description = sanitizeFormValue(resource.description) || 'No description available.';

    const lines = [
      `Location: ${address}`,
      `Categories: ${categories || 'None listed'}`,
      phoneNumber ? `Phone: ${phoneNumber}` : '',
      email ? `Email: ${email}` : '',
      website ? `Website: ${website}` : '',
      `Description: ${description}`,
    ].filter(Boolean);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    lines.forEach((line) => {
      const wrappedLines = doc.splitTextToSize(line, contentWidth);
      const blockHeight = wrappedLines.length * 13;
      cursorY = ensurePdfSpace(doc, cursorY, blockHeight);
      doc.text(wrappedLines, marginLeft, cursorY);
      cursorY += blockHeight + 4;
    });
  });

  doc.save('family-connect-resources.pdf');
}

function setCurrentResources(resources) {
  currentResources = Array.isArray(resources) ? resources : [];
  const hasResources = currentResources.length > 0;
  exportAllPdfButton.classList.toggle('hidden', !hasResources);
  exportAllPdfButton.disabled = !hasResources;
}

function normalizeCategoriesForPdf(categories) {
  if (Array.isArray(categories)) {
    return categories
      .map((category) => sanitizeFormValue(category?.name ?? category))
      .filter(Boolean)
      .join(', ');
  }

  return sanitizeFormValue(categories);
}

function ensurePdfSpace(doc, cursorY, requiredHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 56;

  if (cursorY + requiredHeight <= pageHeight - bottomMargin) {
    return cursorY;
  }

  doc.addPage();
  return 56;
}

function writePdfSection(doc, label, value, marginLeft, cursorY, contentWidth) {
  doc.setFont('helvetica', 'bold');
  doc.text(label, marginLeft, cursorY);
  cursorY += 16;

  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(String(value), contentWidth);
  doc.text(lines, marginLeft, cursorY);
  return cursorY + (lines.length * 14) + 16;
}

function syncBodyLock() {
  const hasOpenModal = !detailModal.classList.contains('hidden')
    || !addOrgModal.classList.contains('hidden')
    || !addAdminModal.classList.contains('hidden');

  document.body.classList.toggle('modal-open', hasOpenModal);
}

function setAuthStatus(message, type) {
  authStatus.textContent = message;
  authStatus.className = type ? `email-status ${type}` : 'email-status';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen).trimEnd() + '…';
}

function valueOrNull(raw) {
  const value = String(raw ?? '').trim();
  return value.length ? value : null;
}

function sanitizeFormValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  return lower === 'null' || lower === 'undefined' ? '' : normalized;
}

function parseServices(raw) {
  return String(raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [namePart, ...descParts] = line.split('|');
      return {
        name: namePart.trim(),
        description: descParts.join('|').trim() || null,
      };
    })
    .filter((service) => service.name.length > 0);
}

function slugifyFileName(value) {
  return String(value ?? 'resource')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resource';
}

async function loadPromotableUsers() {
  const payload = await listPromotableUsers();
  const users = payload.users ?? [];

  adminUserSelect.innerHTML = '<option value="">Select a user...</option>';

  users.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    const labelName = sanitizeFormValue(user.full_name) || 'Unnamed User';
    const email = sanitizeFormValue(user.email) || 'no-email';
    option.textContent = `${labelName} (${email})`;
    adminUserSelect.appendChild(option);
  });

  const hasUsers = users.length > 0;
  adminUserSelect.disabled = !hasUsers;
  addAdminSubmit.disabled = !hasUsers;

  if (!hasUsers) {
    setAddAdminStatus('No volunteer users available to promote right now.', '');
  }
}
