import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import type {GeneratedLandscape} from '@arbestra/contracts';
import {artifactChecksum,canonicalJSON} from './artifact.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
it('preserves canonical checksums with nested arrays, sorted keys and Unicode tokens',()=>{
 const value={z:[1,2,-0,null,1e-9],a:{label:'é🌳'.repeat(70000),b:[]}} as unknown as GeneratedLandscape;
 expect(artifactChecksum(value)).toBe(createHash('sha256').update(canonicalJSON(value)).digest('hex'));
});
it('preserves the signed RC1 checksum while detecting an altered value',()=>{
 const artifact=JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json',import.meta.url),'utf8')) as GeneratedLandscape;
 expect(artifactChecksum(artifact)).toBe(RC1_CANONICAL_CHECKSUM);
 artifact.seed++;expect(artifactChecksum(artifact)).not.toBe(RC1_CANONICAL_CHECKSUM);
});
