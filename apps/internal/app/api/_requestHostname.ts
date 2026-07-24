export function requestHostname(request: Request) {
  return request.headers.get("host") || new URL(request.url).host;
}
