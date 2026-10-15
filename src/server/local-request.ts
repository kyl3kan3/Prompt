/** A loopback listener alone does not stop browser CSRF or DNS rebinding. */
export function isAllowedLocalRequest(input: {
  host: string | undefined;
  origin: string | undefined;
  method: string;
  localPort: number | undefined;
  fetchSite: string | undefined;
}): boolean {
  if (!input.localPort || !input.host) return false;
  const hosts = ["127.0.0.1", "localhost", "[::1]"];
  if (!hosts.some((host) => input.host === `${host}:${input.localPort}`)) return false;
  if (input.fetchSite && !["same-origin", "none"].includes(input.fetchSite)) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) return true;
  // Browser same-origin mutations send Origin. Missing/null origins fail shut;
  // CLI clients must explicitly send the listener's exact origin as well.
  return input.origin === `http://${input.host}`;
}
