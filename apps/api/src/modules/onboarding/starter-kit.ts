import {createHash} from 'node:crypto';
import type {StarterKit} from '@arbestra/contracts';
import {STARTER_VILLAGE} from './starter-village.js';
// Capture the exported recipe in each installation so a later export cannot change an unposed kit.
export const STARTER_KIT:StarterKit={version:createHash('sha256').update(JSON.stringify(STARTER_VILLAGE)).digest('hex'),elements:STARTER_VILLAGE.buildings.map((b,i)=>({...b,key:`element-${i}`}))};
