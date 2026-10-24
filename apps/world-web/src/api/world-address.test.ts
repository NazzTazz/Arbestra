import { expect, it } from 'vitest';
import { worldAddress } from './world-address';

const template = '{world}.arbestra.world';
const at = (href: string) => worldAddress(new URL(href), template);

it('reads the world from its subdomain once deployed', () => {
  expect(at('https://alpha-rc1.arbestra.world/village')).toEqual({ world: 'alpha-rc1' });
  expect(at('https://arbestra.world/village')).toEqual({});
  expect(at('https://a.b.arbestra.world/village')).toEqual({});
  expect(at('https://alpha-rc1.example.org/village')).toEqual({});
});

it('moves a former ?world= address to the subdomain, keeping the rest of the address', () => {
  expect(at('https://alpha.arbestra.world/village?world=alpha-rc1&starter=1#section=journal')).toEqual({
    world: 'alpha-rc1',
    redirect: 'https://alpha-rc1.arbestra.world/village?starter=1#section=journal',
  });
  // A crafted value never becomes another host.
  expect(at('https://alpha.arbestra.world/village?world=evil.example%2F')).toEqual({});
});

it('keeps the query locally, without a subdomain template', () => {
  expect(worldAddress(new URL('http://localhost:5174/village?world=rc1'), undefined)).toEqual({ world: 'rc1' });
  expect(worldAddress(new URL('http://localhost:5174/village'), undefined)).toEqual({});
});
