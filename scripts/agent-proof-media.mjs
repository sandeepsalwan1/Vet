import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { AgentError, runCommand } from "./agent-lib.mjs";

function publishedArtifactFiles(root) {
  const base = resolve(root);
  const baseInfo = lstatSync(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) {
    throw new AgentError("published proof artifact directory is invalid", 1);
  }
  const realBase = realpathSync(base);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new AgentError("published proof artifact contains a symlink", 1);
      }
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const info = lstatSync(path);
      if (!info.isFile() || info.size <= 0) {
        throw new AgentError("published proof artifact contains an invalid file", 1);
      }
      const realPath = realpathSync(path);
      const offset = relative(realBase, realPath);
      if (!offset || offset.startsWith("..")) {
        throw new AgentError("published proof artifact path escapes its bundle", 1);
      }
      files.push({
        name: offset.replaceAll("\\", "/"),
        path: realPath,
        sha256: createHash("sha256")
          .update(readFileSync(realPath))
          .digest("hex")
      });
    }
  };
  visit(base);
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function publishedMediaKind(name) {
  const extension = extname(name).toLowerCase();
  if (extension === ".gif") return "gif";
  if (extension === ".mp4" || extension === ".webm") return "video";
  if (extension === ".png") return "screenshot";
  return "";
}

function probePublishedMedia(path, kind) {
  const probe = runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,width,height,nb_read_frames,duration:format=duration",
      "-of",
      "json",
      path
    ],
    { check: false }
  );
  if (probe.status !== 0) {
    throw new AgentError(`published ${kind} proof media is not playable`, 1);
  }
  let value;
  try {
    value = JSON.parse(probe.stdout);
  } catch {
    throw new AgentError(`published ${kind} proof media probe is invalid`, 1);
  }
  const stream = value?.streams?.[0];
  const codec = String(stream?.codec_name ?? "");
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const frames = Number(stream?.nb_read_frames ?? 0);
  const durationSeconds = Number(
    stream?.duration ?? value?.format?.duration ?? 0
  );
  const expectedCodec =
    kind === "gif" ? "gif" : kind === "screenshot" ? "png" : "";
  if (
    !stream ||
    !codec ||
    (expectedCodec && codec !== expectedCodec) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    (kind === "gif" && (!Number.isFinite(frames) || frames < 2)) ||
    (kind === "video" &&
      (!Number.isFinite(durationSeconds) || durationSeconds <= 0))
  ) {
    throw new AgentError(`published ${kind} proof media is not playable`, 1);
  }
  return {
    codec,
    width,
    height,
    frames: Number.isFinite(frames) ? frames : 0,
    durationSeconds: Number.isFinite(durationSeconds)
      ? durationSeconds
      : 0
  };
}

function expectedDigestFor(file, expectedDigests) {
  const exact = expectedDigests.filter((record) => record.name === file.name);
  if (exact.length === 1) return exact[0];

  // GitHub may wrap uploaded files in another directory. Basename fallback is
  // safe only when it identifies exactly one sealed record.
  const byBasename = expectedDigests.filter(
    (record) => basename(record.name) === basename(file.name)
  );
  return byBasename.length === 1 ? byBasename[0] : null;
}

function assertExpectedDigests(files, expectedDigests) {
  for (const record of expectedDigests) {
    const exact = files.filter((file) => file.name === record.name);
    const matches = exact.length
      ? exact
      : files.filter(
          (file) => basename(file.name) === basename(record.name)
        );
    if (matches.length !== 1 || matches[0].sha256 !== record.sha256) {
      throw new AgentError(
        `published proof artifact digest mismatch: ${record.name}`,
        1
      );
    }
  }
}

export function inspectPublishedProofMedia({
  artifactDir,
  expectedDigests,
  headSha,
  proofKind,
  requireHeadMarker,
  probe = probePublishedMedia
}) {
  const files = publishedArtifactFiles(artifactDir);
  assertExpectedDigests(files, expectedDigests);

  if (
    requireHeadMarker &&
    !files.some(
      (file) =>
        extname(file.name).toLowerCase() === ".log" &&
        readFileSync(file.path, "utf8").includes(`AGENT_PROOF_HEAD_OK ${headSha}`)
    )
  ) {
    throw new AgentError(
      "published proof artifact is not bound to the exact pull request head",
      1
    );
  }

  const media = files
    .map((file) => ({ ...file, kind: publishedMediaKind(file.name) }))
    .filter((file) => file.kind);
  const requiredKinds =
    proofKind === "GIF" ? ["gif", "video"] : ["screenshot"];
  for (const kind of requiredKinds) {
    if (!media.some((file) => file.kind === kind)) {
      throw new AgentError(
        `published proof artifact has no reviewable ${kind} media`,
        1
      );
    }
  }

  const verifiedFiles = media.map((file) => {
    const expectedRecord = expectedDigestFor(file, expectedDigests);
    if (!expectedRecord || expectedRecord.sha256 !== file.sha256) {
      throw new AgentError(
        `published proof media digest mismatch: ${file.name}`,
        1
      );
    }
    return {
      name: file.name,
      sha256: file.sha256,
      kind: file.kind,
      ...probe(file.path, file.kind)
    };
  });
  return {
    version: 1,
    status: "passed",
    headSha,
    proofKind,
    files: verifiedFiles,
    summary: `Downloaded and opened ${verifiedFiles.length} exact-head proof media file(s).`
  };
}

export function validatePublishedMediaOutcome(
  outcome,
  request,
  proofResult = null
) {
  if (
    !outcome ||
    Array.isArray(outcome) ||
    JSON.stringify(Object.keys(outcome).sort()) !==
      JSON.stringify(
        ["files", "headSha", "proofKind", "status", "summary", "version"].sort()
      ) ||
    outcome.version !== 1 ||
    outcome.status !== "passed" ||
    outcome.headSha !== request.sha ||
    outcome.proofKind !== request.proofKind ||
    typeof outcome.summary !== "string" ||
    !outcome.summary ||
    !Array.isArray(outcome.files) ||
    outcome.files.length === 0 ||
    outcome.files.some(
      (file) =>
        !file ||
        typeof file.name !== "string" ||
        !file.name ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? "") ||
        !["gif", "video", "screenshot"].includes(file.kind) ||
        typeof file.codec !== "string" ||
        !file.codec ||
        !Number.isFinite(file.width) ||
        file.width <= 0 ||
        !Number.isFinite(file.height) ||
        file.height <= 0 ||
        !Number.isFinite(file.frames) ||
        file.frames < 0 ||
        !Number.isFinite(file.durationSeconds) ||
        file.durationSeconds < 0 ||
        (file.kind === "gif" && file.frames < 2) ||
        (file.kind === "video" && file.durationSeconds <= 0)
    )
  ) {
    throw new AgentError("published proof media outcome is invalid", 1);
  }
  const requiredKinds =
    request.proofKind === "GIF" ? ["gif", "video"] : ["screenshot"];
  if (
    requiredKinds.some(
      (kind) => !outcome.files.some((file) => file.kind === kind)
    )
  ) {
    throw new AgentError("published proof media outcome is incomplete", 1);
  }
  if (
    proofResult &&
    outcome.files.some(
      (file) =>
        !proofResult.artifactDigests?.some(
          (record) =>
            record.sha256 === file.sha256 &&
            (record.name === file.name ||
              basename(record.name) === basename(file.name))
        )
    )
  ) {
    throw new AgentError(
      "published proof media outcome does not match the proof result",
      1
    );
  }
  return outcome;
}
