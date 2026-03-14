const path = require('path');

const THUMBNAIL_CACHE_DIR = path.join(process.cwd(), 'data', 'thumb-cache');
const LEGACY_PUBLIC_THUMBNAIL_CACHE_DIR = path.join(process.cwd(), 'public', 'images');

function getThumbnailCachePath(documentId) {
  return path.join(THUMBNAIL_CACHE_DIR, `${documentId}.png`);
}

module.exports = {
  THUMBNAIL_CACHE_DIR,
  LEGACY_PUBLIC_THUMBNAIL_CACHE_DIR,
  getThumbnailCachePath
};
