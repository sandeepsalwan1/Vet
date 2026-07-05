export function phoneDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function localPhoneDigits(value: string) {
  const digits = phoneDigits(value);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function formatPhoneInput(value: string) {
  if (value.includes("@")) return value;
  const digits = phoneDigits(value);
  const local = localPhoneDigits(value);
  const prefix = digits.length === 11 && digits.startsWith("1") ? "+1 " : "";
  if (local.length === 0) return "";
  if (local.length <= 3) return `${prefix}${local}`;
  if (local.length <= 6) return `${prefix}(${local.slice(0, 3)}) ${local.slice(3)}`;
  if (local.length <= 10) {
    return `${prefix}(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return value;
}

export function formatPhoneDisplay(value: string | null | undefined, emptyText = "Not listed") {
  const clean = value?.trim();
  if (!clean) return emptyText;
  if (clean.includes("@")) return clean;
  const digits = phoneDigits(clean);
  const local = localPhoneDigits(clean);
  if (local.length === 10) {
    const formatted = `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
    return digits.length === 11 ? `+1 ${formatted}` : formatted;
  }
  if (local.length === 7) return `${local.slice(0, 3)}-${local.slice(3)}`;
  return clean;
}

export function smsPhoneReady(value: string | null | undefined) {
  const digits = phoneDigits(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}
