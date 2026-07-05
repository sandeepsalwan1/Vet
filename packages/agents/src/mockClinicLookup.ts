import type { MockClinicData } from "./contracts";

export function id(prefix: string, seed: string) {
  return `${prefix}-${seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"}`;
}

function clean(value: string | undefined | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function looseMatch(source: string, query: string) {
  const left = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(right && left.includes(right));
}

export function clientFor(data: MockClinicData, clientId: string) {
  return data.clients.find((client) => client.id === clientId) ?? null;
}

export function petFor(data: MockClinicData, petId: string) {
  return data.pets.find((pet) => pet.id === petId) ?? null;
}

export function firstClient(data: MockClinicData, clientName?: string | null, phone?: string | null) {
  const phoneDigits = clean(phone).replace(/[^0-9]/g, "");
  return data.clients.find((client) => {
    const nameOk = clientName ? looseMatch(client.fullName, clientName) : false;
    const phoneOk = phoneDigits
      ? client.phone.replace(/[^0-9]/g, "").endsWith(phoneDigits.slice(-7))
      : false;
    return nameOk || phoneOk;
  }) ?? null;
}

export function firstPet(data: MockClinicData, clientId: string, petName?: string | null) {
  const pets = data.pets.filter((pet) => pet.clientId === clientId);
  return petName
    ? pets.find((pet) => looseMatch(pet.name, petName)) ?? null
    : pets[0] ?? null;
}
