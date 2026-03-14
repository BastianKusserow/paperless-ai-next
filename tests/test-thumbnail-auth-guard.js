/**
 * Thumbnail Auth Guard Integration Test
 *
 * Validates:
 * - Unauthenticated requests to /thumb/:documentId are redirected to /login
 * - Endpoint does not leak image content to unauthenticated clients
 *
 * Usage:
 * 1) Start server
 * 2) Run: node tests/test-thumbnail-auth-guard.js
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_DOCUMENT_ID = process.env.THUMB_TEST_DOCUMENT_ID || '1';

async function run() {
  console.log('\nThumbnail Auth Guard Integration Test');
  console.log('='.repeat(44));
  console.log(`BASE_URL: ${BASE_URL}`);

  const response = await axios.get(`${BASE_URL}/thumb/${encodeURIComponent(TEST_DOCUMENT_ID)}`, {
    validateStatus: () => true,
    maxRedirects: 0,
    headers: {
      Accept: 'image/*'
    }
  });

  if (response.status !== 302) {
    throw new Error(`Expected HTTP 302 for unauthenticated thumbnail request, got ${response.status}`);
  }

  const location = String(response.headers.location || '');
  if (location !== '/login') {
    throw new Error(`Expected redirect location '/login', got '${location || 'none'}'`);
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType.startsWith('image/')) {
    throw new Error(`Expected non-image response for unauthenticated request, got content-type '${contentType}'`);
  }

  console.log('[OK] Unauthenticated thumbnail request is redirected to /login');
  console.log('[RESULT] Thumbnail auth guard test passed');
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[FAIL]', error.message);
    process.exit(1);
  });
}
