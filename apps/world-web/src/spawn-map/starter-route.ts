import { worldPage } from '../api/world-address';

export function villageRoute(slug: string, continueStarter = false): string {
  return worldPage('/village', slug, continueStarter ? { starter: '1' } : {});
}

export function isStarterRoute(pathname: string, search: string): boolean {
  return pathname === '/spawn' || (pathname === '/village' && new URLSearchParams(search).get('starter') === '1');
}
