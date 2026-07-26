export function isLocalProofHost(host: string | null) {
  if (!host) return false;
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:")
  );
}
