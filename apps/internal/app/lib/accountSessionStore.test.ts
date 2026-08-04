import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_SESSION_KEY,
  SESSION_KEY,
  type Account
} from "./accountModel";
import { getSession, logout, saveSession } from "./accountSessionStore";

class MemoryStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

const staffAccount: Account = {
  id: "staff-1",
  role: "staff",
  name: "Front Desk",
  email: "staff@clinic.demo",
  passwordHash: "test-only",
  createdAt: "2026-08-04T00:00:00.000Z"
};

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage }
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage
  });
  return storage;
}

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("account and task-board sessions use independent storage", () => {
  const storage = installStorage();
  const boardSession = JSON.stringify({ role: "staff", name: "Front Desk" });
  storage.setItem(LEGACY_SESSION_KEY, boardSession);

  saveSession(staffAccount);

  assert.equal(storage.getItem(LEGACY_SESSION_KEY), boardSession);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY) ?? "null").source, "account");
  assert.equal(getSession()?.accountId, staffAccount.id);
});

test("legacy account sessions migrate without consuming task-board sessions", () => {
  const storage = installStorage();
  storage.setItem(
    LEGACY_SESSION_KEY,
    JSON.stringify({
      accountId: staffAccount.id,
      role: staffAccount.role,
      name: staffAccount.name,
      email: staffAccount.email,
      source: "account"
    })
  );

  assert.equal(getSession()?.accountId, staffAccount.id);
  assert.equal(storage.getItem(LEGACY_SESSION_KEY), null);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY) ?? "null").source, "account");

  storage.removeItem(SESSION_KEY);
  const boardSession = JSON.stringify({ role: "staff", name: "Front Desk" });
  storage.setItem(LEGACY_SESSION_KEY, boardSession);
  assert.equal(getSession(), null);
  assert.equal(storage.getItem(LEGACY_SESSION_KEY), boardSession);
});

test("logout preserves the task-board session", () => {
  const storage = installStorage();
  const boardSession = JSON.stringify({ role: "staff", name: "Front Desk" });
  storage.setItem(LEGACY_SESSION_KEY, boardSession);
  saveSession(staffAccount);

  logout();

  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(storage.getItem(LEGACY_SESSION_KEY), boardSession);
});
