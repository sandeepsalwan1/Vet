import { z } from "zod";
import type { FieldErrors } from "./clientRequestTypes";

export const requestSchema = z.object({
  requestType: z
    .enum(["prescription", "labs_xrays", "records_request", "scheduling"])
    .default("scheduling"),
  clientName: z.string().trim().max(120),
  clarityId: z.string().trim().max(120).optional().nullable(),
  clientPhone: z.string().trim().max(80),
  clientDateOfBirth: z.string().trim(),
  petName: z.string().trim().max(120),
  petWeight: z.string().trim().max(80).optional().nullable(),
  lastVisit: z.string().optional().nullable(),
  request: z.string().trim().max(4000)
});

export type ParsedClientRequest = z.infer<typeof requestSchema>;

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function looksLikeJunk(value: string) {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const letters = compact.replace(/[^a-z]/g, "");
  if (!compact) return true;
  if (/(asdf|qwer|zxcv|dfasdf|fasdf|sdaf)/.test(compact)) return true;
  if (/([a-z0-9])\1{3,}/.test(compact)) return true;
  if (letters.length >= 12 && new Set(letters).size <= 5) return true;
  return compact.length > 18 && !/\s/.test(value.trim());
}

function realNameError(value: string, label: string) {
  const letters = value.replace(/[^A-Za-z]/g, "");
  if (!value.trim()) return `${label} is required.`;
  if (letters.length < 2) return `${label} needs at least 2 letters.`;
  if (looksLikeJunk(value)) return `Use a real ${label.toLowerCase()}.`;
  return null;
}

function petDateError(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Use the pet's real date of birth.";
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return "Use the pet's real date of birth.";
  if (date > today) return "Pet's date of birth can't be in the future.";
  if (date.getFullYear() < 1980) return "Use the pet's real date of birth.";
  return null;
}

function petWeightError(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean) return null;
  if (!/\d/.test(clean)) return "Pet's weight should include a number.";
  if (looksLikeJunk(clean)) return "Pet's weight should look like a real weight.";
  return null;
}

export function validateFields(value: ParsedClientRequest) {
  const errors: FieldErrors = {};
  const nameError = realNameError(value.clientName, "Your name");
  if (nameError) errors.clientName = nameError;

  const phoneDigits = digits(value.clientPhone);
  if (!value.clientPhone.trim()) {
    errors.clientPhone = "Phone is required.";
  } else if (phoneDigits.length < 10) {
    errors.clientPhone = "Enter a real phone # with at least 10 digits.";
  } else if (new Set(phoneDigits).size < 3) {
    errors.clientPhone = "Enter a real phone #.";
  }

  const dateError = petDateError(value.clientDateOfBirth);
  if (dateError) errors.clientDateOfBirth = dateError;

  const petNameError = realNameError(value.petName, "Pet's name");
  if (petNameError) errors.petName = petNameError;

  const weightError = petWeightError(value.petWeight);
  if (weightError) errors.petWeight = weightError;

  const words = value.request.match(/[A-Za-z]{2,}/g) ?? [];
  if (!value.request.trim()) {
    errors.request = "Request is required.";
  } else if (value.request.trim().length < 15 || words.length < 3) {
    errors.request = "Describe the request in a few real words.";
  } else if (looksLikeJunk(value.request)) {
    errors.request = "Describe the request in a few real words.";
  }

  return errors;
}

export function hasErrors(errors: FieldErrors) {
  return Object.keys(errors).length > 0;
}
