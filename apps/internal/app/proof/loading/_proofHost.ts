export function isLocalProofHost(host: string | null | undefined) {
  if (!host) return false;
  const normalized = host.toLowerCase();
  const hostname = normalized.split(":", 1)[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}
