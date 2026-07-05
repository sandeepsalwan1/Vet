export function GET() {
  return new Response(`User-agent: *
Disallow: /
`, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
