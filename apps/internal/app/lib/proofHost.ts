export function isLocalProofHost(host: string | null | undefined) {
  if (!host) return false;
  const hostname = host.split(":", 1)[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1";
}
