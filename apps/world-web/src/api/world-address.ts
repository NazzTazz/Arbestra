/**
 * Deployed, each world is served on its own subdomain (`VITE_WORLD_HOST`, e.g.
 * `{world}.arbestra.world`); locally, without that template, it stays in `?world=`.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The world this address names, and where a former `?world=` address now lives. */
export function worldAddress(url: URL, template: string | undefined): { world?: string; redirect?: string } {
  const query = url.searchParams.get('world');
  if (!template) return query === null ? {} : { world: query };
  const suffix = template.replace('{world}', '');
  if (query !== null) {
    if (!SLUG.test(query)) return {};
    const target = new URL(url);
    target.hostname = query + suffix;
    target.searchParams.delete('world');
    return { world: query, redirect: target.href };
  }
  const label = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : '';
  return SLUG.test(label) ? { world: label } : {};
}

const template: string | undefined = import.meta.env.VITE_WORLD_HOST || undefined;
// Unit tests import this module without a browser address.
const address = typeof location === 'undefined' ? {} : worldAddress(new URL(location.href), template);
export const addressedWorld = address.world;
export const addressRedirect = address.redirect;

/** A page of the same world; the world goes in the query only without subdomains. */
export function worldPage(path: string, world: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(template ? params : { world, ...params }).toString();
  return search ? `${path}?${search}` : path;
}
