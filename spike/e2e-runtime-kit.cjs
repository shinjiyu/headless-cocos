#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { kitStatus, ENGINE_VERSION } = require('./runtime-kit.cjs');

const REPO = path.resolve(__dirname, '..');
const st = kitStatus({ repoRoot: REPO });
assert.equal(st.version, '3.8.8');
assert.ok(st.engine, 'engine snapshot');
assert.ok(st.npm, 'packer node_modules');
assert.ok(st.uuid, 'uuid util');
assert.ok(st.ready, JSON.stringify(st));
assert.equal(ENGINE_VERSION, '3.8.8');
console.log('[e2e-runtime-kit] SUCCESS', st);
