#!/usr/bin/env node
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  AgentError,
  fail,
  finish,
  loadConfig,
  parseArgs,
  requireValue,
  setGitHubOutput
} from "./agent-lib.mjs";

const MAX_ALLOWED_GLOBAL = 15;
const SAFE_GROUP_PREFIX = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentError(`${name} must be a positive integer`, 2);
  }
  return value;
}

export function validateConcurrencyConfig(config) {
  const concurrency = config?.concurrency;
  if (!concurrency || typeof concurrency !== "object" || Array.isArray(concurrency)) {
    throw new AgentError("missing concurrency config", 2);
  }

  const hardMaxGlobal = positiveInteger(concurrency.hardMaxGlobal, "concurrency.hardMaxGlobal");
  const maxGlobal = positiveInteger(concurrency.maxGlobal, "concurrency.maxGlobal");
  if (hardMaxGlobal > MAX_ALLOWED_GLOBAL) {
    throw new AgentError(`concurrency.hardMaxGlobal cannot exceed ${MAX_ALLOWED_GLOBAL}`, 2);
  }
  if (maxGlobal > hardMaxGlobal) {
    throw new AgentError("concurrency.maxGlobal cannot exceed concurrency.hardMaxGlobal", 2);
  }

  const groupPrefix = String(concurrency.groupPrefix ?? "");
  if (!SAFE_GROUP_PREFIX.test(groupPrefix)) {
    throw new AgentError("concurrency.groupPrefix is invalid", 2);
  }

  const configuredLanes = concurrency.lanes;
  if (!configuredLanes || typeof configuredLanes !== "object" || Array.isArray(configuredLanes)) {
    throw new AgentError("concurrency.lanes must be an object", 2);
  }

  const lanes = Object.entries(configuredLanes)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, capacity]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        throw new AgentError(`invalid concurrency lane ${name}`, 2);
      }
      return { name, capacity: positiveInteger(capacity, `concurrency.lanes.${name}`) };
    });
  if (lanes.length === 0) {
    throw new AgentError("concurrency.lanes cannot be empty", 2);
  }

  const allocated = lanes.reduce((total, lane) => total + lane.capacity, 0);
  if (allocated > maxGlobal) {
    throw new AgentError(
      `configured lane capacity ${allocated} exceeds concurrency.maxGlobal ${maxGlobal}`,
      2
    );
  }

  return { allocated, groupPrefix, hardMaxGlobal, lanes, maxGlobal };
}

function bucketForKey(key, capacity) {
  const normalized = String(requireValue(key, "concurrency key"));
  const digest = createHash("sha256").update(normalized, "utf8").digest();
  return digest.readUInt32BE(0) % capacity;
}

export function concurrencySlot(config, laneName, key) {
  const validated = validateConcurrencyConfig(config);
  const lane = validated.lanes.find((candidate) => candidate.name === laneName);
  if (!lane) {
    throw new AgentError(`unknown concurrency lane ${laneName}`, 2);
  }

  // Disjoint lane ranges let one GitHub concurrency group enforce both caps.
  const offset = validated.lanes
    .slice(0, validated.lanes.indexOf(lane))
    .reduce((total, candidate) => total + candidate.capacity, 0);
  const laneSlot = bucketForKey(key, lane.capacity) + 1;
  const globalSlot = offset + laneSlot;

  return {
    allocated: validated.allocated,
    globalSlot,
    group: `${validated.groupPrefix}-slot-${globalSlot}`,
    lane: lane.name,
    laneCapacity: lane.capacity,
    laneSlot,
    maxGlobal: validated.maxGlobal
  };
}

async function main() {
  const args = parseArgs();
  const result = concurrencySlot(
    loadConfig(),
    requireValue(args.lane, "lane"),
    requireValue(args.key, "concurrency key")
  );
  setGitHubOutput({
    global_slot: result.globalSlot,
    group: result.group,
    lane_slot: result.laneSlot
  });
  finish({ ok: true, message: `concurrency group: ${result.group}`, ...result }, Boolean(args.json));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
