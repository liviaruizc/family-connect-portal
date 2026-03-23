/**
 * email.js — Express router for sending resource information by email
 *
 * Route:
 *   POST /api/email/send
 *
 * Expected JSON body:
 *   {
 *     "to":       "recipient@example.com",
 *     "resource": { ...full resource object from /api/resources/:id }
 *   }
 *
 * Uses Nodemailer with SMTP credentials from environment variables.
 * Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in .env
 */

import { Router } from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// ---------------------------------------------------------------------------
// Build the Nodemailer transport once when the module loads.
// All SMTP settings come from environment variables — never hardcoded.
// ---------------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true = TLS on port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* -----------------------------------------------------------------------
 * Helper — build a plain-text version of the resource for the email body
 * --------------------------------------------------------------------- */
function buildEmailBody(resource) {
  const addr = [
    resource.street_address,
    resource.city,
    resource.state,
    resource.zip_code,
  ]
    .filter(Boolean)
    .join(', ');

  const categories =
    Array.isArray(resource.categories) && resource.categories.length
      ? resource.categories.map((c) => c.name).join(', ')
      : 'N/A';

  const services =
    Array.isArray(resource.services) && resource.services.length
      ? resource.services
          .map((s) => `  • ${s.name}${s.description ? ': ' + s.description : ''}`)
          .join('\n')
      : '  None listed';

  return `
Family Connect Resource Information
====================================

Organization : ${resource.organization_name}
Address      : ${addr || 'Not provided'}
Phone        : ${resource.phone_number || 'Not provided'}
Email        : ${resource.email || 'Not provided'}
Categories   : ${categories}

Description
-----------
${resource.description || 'No description available.'}

Services Offered
----------------
${services}

---
This information was shared from the Family Connect Resource Portal.
For questions, contact the organization directly using the details above.
`.trim();
}

/* -----------------------------------------------------------------------
 * Helper — build an HTML version of the resource for richer email clients
 * --------------------------------------------------------------------- */
function buildEmailHtml(resource) {
  const addr = [
    resource.street_address,
    resource.city,
    resource.state,
    resource.zip_code,
  ]
    .filter(Boolean)
    .join(', ');

  const categories =
    Array.isArray(resource.categories) && resource.categories.length
      ? resource.categories.map((c) => `<span class="tag">${c.name}</span>`).join(' ')
      : 'N/A';

  const servicesHtml =
    Array.isArray(resource.services) && resource.services.length
      ? resource.services
          .map(
            (s) =>
              `<li><strong>${s.name}</strong>${
                s.description ? `: ${s.description}` : ''
              }</li>`
          )
          .join('')
      : '<li>None listed</li>';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 32px auto; background: #fff;
                 border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    h1 { color: #2563eb; font-size: 20px; margin-bottom: 4px; }
    .label { color: #64748b; font-size: 13px; font-weight: 600;
             text-transform: uppercase; letter-spacing: .5px; }
    .value { color: #1e293b; font-size: 15px; margin-bottom: 16px; }
    .tag { background: #dbeafe; color: #1d4ed8; border-radius: 9999px;
           padding: 2px 10px; font-size: 13px; margin-right: 4px; }
    ul { padding-left: 18px; }
    li { margin-bottom: 8px; font-size: 14px; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8;
              border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Family Connect — Resource Information</h1>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">

    <div class="label">Organization</div>
    <div class="value">${resource.organization_name}</div>

    <div class="label">Address</div>
    <div class="value">${addr || 'Not provided'}</div>

    <div class="label">Phone</div>
    <div class="value">${resource.phone_number || 'Not provided'}</div>

    <div class="label">Email</div>
    <div class="value">${resource.email || 'Not provided'}</div>

    <div class="label">Categories</div>
    <div class="value">${categories}</div>

    <div class="label">Description</div>
    <div class="value">${resource.description || 'No description available.'}</div>

    <div class="label">Services Offered</div>
    <ul>${servicesHtml}</ul>

    <div class="footer">
      This information was shared from the Family Connect Resource Portal.
      Please contact the organization directly for further assistance.
    </div>
  </div>
</body>
</html>`;
}

/* -----------------------------------------------------------------------
 * POST /api/email/send
 *
 * Validates input, builds email content, and dispatches via Nodemailer.
 * --------------------------------------------------------------------- */
router.post('/send', async (req, res) => {
  const { to, resource } = req.body;

  // --- Input validation ---------------------------------------------------
  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Recipient email address is required.' });
  }

  // Basic email format check (defense-in-depth; the UI also validates)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return res.status(400).json({ error: 'Invalid recipient email address.' });
  }

  if (!resource || typeof resource !== 'object') {
    return res.status(400).json({ error: 'Resource data is required.' });
  }
  // -----------------------------------------------------------------------

  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || `"Family Connect" <${process.env.SMTP_USER}>`,
      to,
      subject: `Family Connect Resource: ${resource.organization_name}`,
      text:    buildEmailBody(resource),
      html:    buildEmailHtml(resource),
    });

    res.json({ message: 'Email sent successfully.' });
  } catch (err) {
    console.error('[POST /email/send] Mail error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

export default router;
