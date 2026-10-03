import { expect, it } from 'vitest';
import { knowledgeProfile, prerequisitesMet, programVisible, SCIENCE_PROGRAMS } from './programs.js';

it('cartography alone never reveals the global model or hidden astronomy branch', () => {
  const levels = { mathematics: 0, geography: 2, astronomy: 0 };
  expect(knowledgeProfile(levels, 100000).globalModelAvailable).toBe(false);
  expect(programVisible(SCIENCE_PROGRAMS.find(p => p.code === 'astronomy-1')!, levels)).toBe(false);
});
it('maths 3 and geography 2 reveal the spontaneous campaign, not its result', () => {
  const program = SCIENCE_PROGRAMS.find(p => p.code === 'astronomy-1')!;
  const levels = { mathematics: 3, geography: 2, astronomy: 0 };
  expect(prerequisitesMet(program, levels)).toBe(true);
  expect(prerequisitesMet(program, { ...levels, geography: 1 })).toBe(false);
  expect(programVisible(program, levels)).toBe(true);
  expect(knowledgeProfile(levels, 2).globalModelAvailable).toBe(false);
  expect(knowledgeProfile({ ...levels, astronomy: 1 }, 2).globalModelAvailable).toBe(true);
});
