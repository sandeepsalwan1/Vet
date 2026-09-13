import { createHmac, timingSafeEqual } from "node:crypto";

export const platformOperatorCookieName = "vet-platform-operator";
export const platformOperatorSessionMaxAgeSeconds = 60 * 60 * 12;

function configuredPasscode() {
  return process.env.PLATFORM_OPERATOR_PASSCODE?.trim() || "";
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionToken(expiresAtSeconds: number) {
  const passcode = configuredPasscode();
  if (!passcode) return "";
  const payload = `v1.${expiresAtSeconds}`;
  const signature = createHmac("sha256", passcode)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

export function platformOperatorConfigured() {
  return Boolean(configuredPasscode());
}

export function platformOperatorPasscodeMatches(passcode: string) {
  const configured = configuredPasscode();
  return Boolean(configured && secureEqual(passcode.trim(), configured));
}

function platformOperatorTokenMatches(
  token: string | null | undefined,
  now: Date
) {
  if (!token) return false;
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) return false;
  const [version, expiresAtText] = tokenParts;
  const expiresAt = Number(expiresAtText);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    version !== "v1" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + platformOperatorSessionMaxAgeSeconds
  ) {
    return false;
  }
  const expected = sessionToken(expiresAt);
  return Boolean(expected && secureEqual(token, expected));
}

export function platformOperatorRequestAuthorized(
  request: Request,
  now = new Date()
) {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${platformOperatorCookieName}=`))
    ?.slice(platformOperatorCookieName.length + 1);
  return platformOperatorTokenMatches(
    token ? decodeURIComponent(token) : "",
    now
  );
}

export function platformOperatorSessionToken(now = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return sessionToken(nowSeconds + platformOperatorSessionMaxAgeSeconds);
}

export function platformOperatorRequestIdentity(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return [
    "platform-operator",
    ip,
    request.headers.get("user-agent") || "unknown"
  ].join("|");
}

export function maskedPlatformOperatorEmail() {
  const email = process.env.PLATFORM_OPERATOR_EMAIL?.trim() || "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}${"•".repeat(Math.min(5, Math.max(2, local.length - 1)))}@${domain}`;
}
