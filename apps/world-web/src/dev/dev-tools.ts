let optedIn: boolean | undefined;
/**
 * Developer tools (laboratory drawer, statistics overlay, render lab): always in
 * development; in a deployed build only on a device that opted in with
 * localStorage['arbestra:dev'] = '1'. Diagnostics only, never a gameplay action.
 */
export function devToolsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (optedIn === undefined) {
    try {
      optedIn = localStorage.getItem('arbestra:dev') === '1';
    } catch {
      optedIn = false;
    }
  }
  return optedIn;
}
