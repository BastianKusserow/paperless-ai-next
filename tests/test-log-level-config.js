const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configModulePath = require.resolve('../config/config');
const originalLogLevel = process.env.LOG_LEVEL;
const originalConfigSourceMode = process.env.CONFIG_SOURCE_MODE;
const originalCwd = process.cwd();
const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'paperless-ai-log-level-'));
fs.mkdirSync(path.join(tempCwd, 'data'), { recursive: true });

function loadConfigWithLogLevel(logLevel) {
  delete require.cache[configModulePath];
  process.chdir(tempCwd);

  if (typeof logLevel === 'undefined') {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = logLevel;
  }

  return require('../config/config');
}

function restoreEnvironment() {
  process.chdir(originalCwd);

  if (typeof originalLogLevel === 'undefined') {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = originalLogLevel;
  }

  if (typeof originalConfigSourceMode === 'undefined') {
    delete process.env.CONFIG_SOURCE_MODE;
  } else {
    process.env.CONFIG_SOURCE_MODE = originalConfigSourceMode;
  }

  delete require.cache[configModulePath];
}

try {
  process.env.CONFIG_SOURCE_MODE = 'runtime-first';

  let config = loadConfigWithLogLevel('DEBUG');
  assert.strictEqual(config.logLevel, 'debug', 'Expected DEBUG to normalize to debug');
  assert.strictEqual(process.env.LOG_LEVEL, 'debug', 'Expected process.env.LOG_LEVEL to be normalized to debug');

  config = loadConfigWithLogLevel('warn');
  assert.strictEqual(config.logLevel, 'warn', 'Expected warn to remain warn');

  config = loadConfigWithLogLevel('verbose');
  assert.strictEqual(config.logLevel, 'info', 'Expected invalid LOG_LEVEL to fall back to info');
  assert.strictEqual(process.env.LOG_LEVEL, 'info', 'Expected process.env.LOG_LEVEL to fall back to info');

  config = loadConfigWithLogLevel(undefined);
  assert.strictEqual(config.logLevel, 'info', 'Expected missing LOG_LEVEL to default to info');

  restoreEnvironment();
  console.log('[PASS] LOG_LEVEL configuration parsing and fallback checks passed');
} catch (error) {
  restoreEnvironment();
  console.error('[FAIL] LOG_LEVEL config test failed:', error.message);
  process.exit(1);
}
