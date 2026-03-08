import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Import from built dist to avoid TS loaders
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const lib = await import(resolve(__dirname, '../dist/envx.js'));
const {
  DEFAULTS,
  configureDefaults,
  checkEnvVar,
  validateEnvVar,
  getEnvVar,
  loadEnv
} = lib;

test('configureDefaults merges correctly and booleanStrict flag toggles', () => {
  configureDefaults({ verbose: true, booleanStrict: true });
  configureDefaults({ ...DEFAULTS }); // reset
});

test('checkEnvVar presence and emptiness', () => {
  process.env.TEST_PRESENT = 'ok';
  assert.equal(checkEnvVar('TEST_PRESENT'), true);

  process.env.TEST_EMPTY = '   ';
  assert.throws(() => checkEnvVar('TEST_EMPTY'), /empty/);

  delete process.env.TEST_MISSING;
  assert.throws(() => checkEnvVar('TEST_MISSING'), /not defined/);

  process.env.TEST_EMPTY2 = '   ';
  assert.equal(checkEnvVar('TEST_EMPTY2', { allowEmpty: true }), true);
});

test('validateEnvVar types (strict boolean)', () => {
  configureDefaults({ booleanStrict: true });

  process.env.BOOL_T = 'true';
  assert.equal(validateEnvVar('BOOL_T', { type: 'boolean' }), true);

  process.env.BOOL_F = 'false';
  assert.equal(validateEnvVar('BOOL_F', { type: 'boolean' }), false);

  process.env.BOOL_BAD = 'yes';
  assert.throws(() => validateEnvVar('BOOL_BAD', { type: 'boolean' }), /boolean/);

  // per-call override back to loose
  process.env.BOOL_YES = 'yes';
  assert.equal(validateEnvVar('BOOL_YES', { type: 'boolean', booleanStrict: false }), true);

  // reset
  configureDefaults({ ...DEFAULTS });
});

test('number and int', () => {
  process.env.NUM_I = '42';
  assert.equal(validateEnvVar('NUM_I', { type: 'int' }), 42);

  process.env.NUM_I_BAD = '3.14';
  assert.throws(() => validateEnvVar('NUM_I_BAD', { type: 'int' }), /integer/);

  process.env.NUM_F = '3.14';
  assert.equal(validateEnvVar('NUM_F', { type: 'number' }), 3.14);
});

test('pattern, length, choices, custom', () => {
  process.env.CODE = 'ABCD1234';
  assert.equal(validateEnvVar('CODE', { pattern: /^[A-Z0-9]+$/, minLength: 4, maxLength: 10 }), 'ABCD1234');

  process.env.CODE2 = 'abc';
  assert.throws(() => validateEnvVar('CODE2', { pattern: /^[A-Z0-9]+$/ }), /pattern/);

  process.env.CODE3 = 'ABCDEFGHIJK';
  assert.throws(() => validateEnvVar('CODE3', { maxLength: 10 }), /no more than 10/);

  process.env.COLOR = 'red';
  assert.equal(validateEnvVar('COLOR', { choices: ['red', 'green'] }), 'red');

  process.env.COLOR2 = 'yellow';
  assert.throws(() => validateEnvVar('COLOR2', { choices: ['red', 'green'] }), /one of/);

  process.env.COLOR3 = 'pink';
  assert.equal(
    validateEnvVar('COLOR3', { choices: (v) => typeof v === 'string' && v.startsWith('p') }),
    'pink'
  );
});

test('getEnvVar defaults and optional', () => {
  delete process.env.OPT1;
  assert.equal(getEnvVar('OPT1', { required: false }), undefined);

  delete process.env.OPT2;
  assert.equal(getEnvVar('OPT2', { type: 'int', default: '5' }), 5);

  process.env.OPT3 = ' true ';
  assert.equal(getEnvVar('OPT3', { type: 'boolean', booleanStrict: false }), true);

  process.env.OPT4 = 'xyz';
  assert.equal(getEnvVar('OPT4', { default: 'abc' }), 'xyz');
});

test('validation errors do not expose raw secret values', () => {
  process.env.SECRET_BOOL = 'super-secret-value';
  assert.throws(
    () => validateEnvVar('SECRET_BOOL', { type: 'boolean', booleanStrict: true }),
    (err) => {
      assert.match(err.message, /expected a boolean/);
      assert.doesNotMatch(err.message, /super-secret-value/);
      return true;
    }
  );

  process.env.SECRET_INT = '123abc-secret';
  assert.throws(
    () => validateEnvVar('SECRET_INT', { type: 'int' }),
    (err) => {
      assert.match(err.message, /expected an integer/);
      assert.doesNotMatch(err.message, /123abc-secret/);
      return true;
    }
  );
});


test('loadEnv loads kv pairs', async () => {
  const fs = await import('node:fs/promises');
  await fs.writeFile('.env.test', 'X=1\nY=foo bar\nZ=\"quoted value\"\\n\n# comment\n');
  try {
    const out = await loadEnv({ paths: '.env.test' });
    assert.equal(process.env.X, '1');
    assert.equal(process.env.Y, 'foo bar');
    assert.equal(process.env.Z, 'quoted value\\n');
    assert.deepEqual(out, { X: '1', Y: 'foo bar', Z: 'quoted value\\n' });
  } finally {
    await fs.rm('.env.test', { force: true });
  }
});
