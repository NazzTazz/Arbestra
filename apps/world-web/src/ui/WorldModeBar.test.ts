import {createElement} from 'react';
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorldModeBar} from './WorldModeBar';
describe('installation HUD',()=>{
 it('locks population and exploitation until the authoritative town hall exists',()=>{
  const before=renderToStaticMarkup(createElement(WorldModeBar,{mode:'construction',beforeTownHall:true,onChoose:()=>{}}));
  const after=renderToStaticMarkup(createElement(WorldModeBar,{mode:'construction',onChoose:()=>{}}));
  expect((before.match(/aria-disabled="true"/g)??[]).length).toBe(2);
  expect(before).toContain('Posez l’hôtel de ville');expect(after).not.toContain('aria-disabled="true"');
 });
});
