const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const appGradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'gradle/libs.versions.toml'), 'utf8');
const api = fs.readFileSync(path.join(root, 'app/src/main/java/com/newgenchat/app/data/NewgenApi.kt'), 'utf8');

test('Android BuildConfig API URL is generated and sourced from Gradle property or environment', () => {
  assert.match(appGradle, /buildConfig\s*=\s*true/);
  assert.match(appGradle, /buildConfigField\("String",\s*"API_BASE_URL"/);
  assert.match(appGradle, /gradleProperty\("NEWGEN_API_BASE_URL"\)/);
  assert.match(appGradle, /environmentVariable\("NEWGEN_API_BASE_URL"\)/);
  assert.match(api, /BuildConfig\.API_BASE_URL/);
});

test('Android plugin aliases referenced by app module exist in version catalog', () => {
  assert.match(appGradle, /alias\(libs\.plugins\.android\.application\)/);
  assert.match(appGradle, /alias\(libs\.plugins\.kotlin\.compose\)/);
  assert.match(catalog, /android-application\s*=/);
  assert.match(catalog, /kotlin-compose\s*=/);
  assert.doesNotMatch(appGradle, /libs\.plugins\.kotlin\.android/);
});

test('Android API coroutine dispatcher has an explicit runtime dependency', () => {
  assert.match(appGradle, /implementation\(libs\.kotlinx\.coroutines\.android\)/);
  assert.match(catalog, /kotlinx-coroutines-android\s*=/);
});
