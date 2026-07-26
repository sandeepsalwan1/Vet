export function isLocalProofHost(host: string | null | undefined) {
  if (!host) return false;
  const hostname = host.toLowerCase().split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}
