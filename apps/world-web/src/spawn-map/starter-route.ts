export function villageRoute(slug: string, continueStarter = false): string {
  const params = new URLSearchParams({ world: slug });
  if (continueStarter) params.set('starter', '1');
  return `/village?${params}`;
}

export function isStarterRoute(pathname: string, search: string): boolean {
  return pathname === '/spawn' || (pathname === '/village' && new URLSearchParams(search).get('starter') === '1');
}
