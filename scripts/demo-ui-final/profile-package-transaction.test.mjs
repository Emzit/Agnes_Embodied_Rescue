import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire}from'node:module';
import {withdrawPackageDeclaration,beginPackageProfileTransaction,restorePackageProfileTransaction}from'./profile-package-transaction.mjs';
const R='/data-ssd/zhongchengkai/agnes',require=createRequire(R+'/third_party/agnes-harness/packages/base/package.json'),{parse}=require('yaml');
const target='embodied-rescue-plugin';
const source='# retain comments and exact formatting on restore\nmodel: agnes-3.0-flash\npackages:\n  - id: another-plugin\n    enabled: true\n  - id: embodied-rescue-plugin\n    source: file:./packages/embodied-rescue-plugin\n    enabled: true\nsetting: KEEP_PRIVATE\n';
function fixture(){const dir=R+'/artifacts/map-selector-repair-20261014/tests/'+crypto.randomUUID();fs.mkdirSync(dir,{recursive:true});const profilePath=dir+'/profile.yaml';fs.writeFileSync(profilePath,source);return {profilePath,jobDir:dir+'/job',packageId:target};}
test('withdraw only the target package, preserving every other semantic field',()=>{const expected=parse(source);expected.packages=expected.packages.filter(p=>p.id!==target);assert.deepEqual(parse(withdrawPackageDeclaration(source,target)),expected);});
test('absent declarations remain byte-for-byte unchanged',()=>{const value='model: agnes\n';assert.equal(withdrawPackageDeclaration(value,target),value);assert.equal(withdrawPackageDeclaration(source,'missing'),source);});
test('ambiguous duplicate and invalid YAML declarations fail closed',()=>{assert.throws(()=>withdrawPackageDeclaration('packages: [{id: embodied-rescue-plugin}, {id: embodied-rescue-plugin}]',target),/DUPLICATE/);assert.throws(()=>withdrawPackageDeclaration('packages: {bad: value}',target),/INVALID_PROFILE_PACKAGES/);assert.throws(()=>withdrawPackageDeclaration('packages: [',target),/INVALID_PROFILE_YAML/);});
test('transaction restores exact original bytes and is idempotent',()=>{const f=fixture(),m=beginPackageProfileTransaction(f);assert.notEqual(m.original_sha256,m.withdrawn_sha256);assert.equal(parse(fs.readFileSync(f.profilePath,'utf8')).packages.length,1);assert.equal(restorePackageProfileTransaction(f.jobDir).restored,true);assert.equal(fs.readFileSync(f.profilePath,'utf8'),source);assert.equal(restorePackageProfileTransaction(f.jobDir).restored,true);});
test('concurrent profile edits are preserved instead of overwritten',()=>{const f=fixture();beginPackageProfileTransaction(f);fs.appendFileSync(f.profilePath,'concurrent: true\n');const changed=fs.readFileSync(f.profilePath);assert.throws(()=>restorePackageProfileTransaction(f.jobDir),/PROFILE_CHANGED_DURING/);assert.deepEqual(fs.readFileSync(f.profilePath),changed);});
test('damaged backup is never restored',()=>{const f=fixture();beginPackageProfileTransaction(f);fs.appendFileSync(f.jobDir+'/profile-before.yaml','bad');assert.throws(()=>restorePackageProfileTransaction(f.jobDir),/BACKUP_HASH/);});
test('already-original profile safely recovers an interrupted transaction',()=>{const f=fixture();beginPackageProfileTransaction(f);fs.writeFileSync(f.profilePath,source);assert.equal(restorePackageProfileTransaction(f.jobDir).restored,true);assert.equal(fs.readFileSync(f.profilePath,'utf8'),source);});
test('paths outside the project are rejected before reading or writing',()=>{assert.throws(()=>beginPackageProfileTransaction({profilePath:'/tmp/outside.yaml',jobDir:R+'/artifacts/test',packageId:target}),/OUTSIDE_PROJECT/);});
