const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const originalCwd = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paperless-thumb-migration-'));

  try {
    process.chdir(tempRoot);

    const legacyDir = path.join(tempRoot, 'public', 'images');
    await fs.mkdir(legacyDir, { recursive: true });

    const legacyCacheFile = path.join(legacyDir, '123.png');
    const nonLegacyFile = path.join(legacyDir, 'keep-me.png');

    await fs.writeFile(legacyCacheFile, Buffer.from('legacy-thumbnail'));
    await fs.writeFile(nonLegacyFile, Buffer.from('non-legacy-file'));

    const { runStartupMigrations, STARTUP_MIGRATION_STATE_PATH } = require('../services/startupMigrations');

    const firstRunSummary = await runStartupMigrations(console);
    const secThumbStep = firstRunSummary.find((step) => step.id === 'SEC-THUMB-001');

    assert(secThumbStep, 'SEC-THUMB-001 migration step should run on first start');
    assert.strictEqual(secThumbStep.status, 'applied', 'SEC-THUMB-001 should be applied on first start');

    assert.strictEqual(await exists(legacyCacheFile), false, 'legacy numeric cache file should be removed');
    assert.strictEqual(await exists(nonLegacyFile), true, 'non-legacy files should be preserved');
    assert.strictEqual(await exists(STARTUP_MIGRATION_STATE_PATH), true, 'migration state file should be created');

    const secondRunSummary = await runStartupMigrations(console);
    const secondRunStep = secondRunSummary.find((step) => step.id === 'SEC-THUMB-001');

    assert(secondRunStep, 'SEC-THUMB-001 migration step should be present in second run summary');
    assert.strictEqual(secondRunStep.status, 'skipped', 'SEC-THUMB-001 should be skipped after marker is persisted');

    console.log('PASS test-thumbnail-startup-migration');
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('FAIL test-thumbnail-startup-migration');
  console.error(error);
  process.exit(1);
});
