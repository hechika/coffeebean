#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ANDROID_ENVS = new Set(["dev", "stg", "real"]);

export function printUsage() {
  console.log(`Usage:
  node scripts/update-android-release.mjs --env dev --version 2.0.68 --apk-url https://github.com/hechika/coffeebean/releases/download/android-dev-2.0.68-build.1/app-dev-debug.apk --released-at 2026-09-01 --note "업데이트 내용"

Options:
  --env <dev|stg|real>    Android 배포 환경
  --version <x.y.z>        앱 버전
  --apk-url <https-url>    GitHub Releases 등에 업로드된 APK 파일 URL
  --released-at <date>     배포일. YYYY-MM-DD 형식. 생략하면 오늘 날짜 사용
  --build-number <number>  같은 버전 내 빌드 번호. 생략하면 자동 산정
  --note <text>            업데이트 노트. 여러 번 입력 가능
  --notes <a|b|c>          파이프(|)로 구분한 업데이트 노트 목록
  --help                   도움말 출력
`);
}

export function parseArgs(argv) {
  const args = {
    notes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    index += 1;

    if (key === "note") {
      args.notes.push(next);
    } else if (key === "notes") {
      args.notes.push(
        ...next
          .split("|")
          .map((note) => note.trim())
          .filter(Boolean),
      );
    } else {
      args[key] = next;
    }
  }

  return args;
}

export function validateArgs(args) {
  if (args.help) {
    return;
  }

  if (!ANDROID_ENVS.has(args.env)) {
    throw new Error("--env must be one of: dev, stg, real");
  }

  if (!args.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(args.version)) {
    throw new Error("--version must look like 2.0.68");
  }

  if (!args["apk-url"]) {
    throw new Error("--apk-url is required");
  }

  const apkUrl = new URL(args["apk-url"]);
  if (apkUrl.protocol !== "https:") {
    throw new Error("--apk-url must start with https://");
  }

  if (!apkUrl.pathname.endsWith(".apk")) {
    throw new Error("--apk-url must point to an .apk file");
  }

  if (args["released-at"] && !/^\d{4}-\d{2}-\d{2}$/.test(args["released-at"])) {
    throw new Error("--released-at must use YYYY-MM-DD");
  }

  if (args["build-number"] && !/^\d+$/.test(args["build-number"])) {
    throw new Error("--build-number must be a positive integer");
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function writeText(relativePath, content) {
  fs.writeFileSync(path.join(ROOT_DIR, relativePath), content, "utf8");
}

function upsertRelease(releases, { env, version, buildNumber, releasedAt, notes, downloadUrl }) {
  releases.android ||= {};
  releases.android[env] ||= [];

  const nextRelease = {
    version,
    buildNumber,
    releasedAt,
    downloadUrl,
  };

  if (notes.length) {
    nextRelease.notes = notes;
  }

  const existingIndex = releases.android[env].findIndex(
    (release) =>
      release.version === version &&
      normalizeBuildNumber(release.buildNumber) === buildNumber,
  );

  if (existingIndex >= 0) {
    releases.android[env][existingIndex] = {
      ...releases.android[env][existingIndex],
      ...nextRelease,
    };
  } else {
    releases.android[env].push(nextRelease);
  }

  releases.android[env].sort(compareReleaseEntries);
}

function normalizeBuildNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function resolveBuildNumber(releases, env, version, requestedBuildNumber) {
  if (requestedBuildNumber) {
    return normalizeBuildNumber(requestedBuildNumber);
  }

  const matchingBuilds = (releases.android?.[env] || [])
    .filter((release) => release.version === version)
    .map((release) => normalizeBuildNumber(release.buildNumber));

  return matchingBuilds.length ? Math.max(...matchingBuilds) + 1 : 1;
}

function compareReleaseEntries(left, right) {
  const versionCompared = compareVersions(left.version, right.version);
  if (versionCompared !== 0) {
    return versionCompared;
  }

  return normalizeBuildNumber(left.buildNumber) - normalizeBuildNumber(right.buildNumber);
}

function compareVersions(left, right) {
  const leftParts = String(left).split(/[.+-]/);
  const rightParts = String(right).split(/[.+-]/);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || "0";
    const rightPart = rightParts[index] || "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      continue;
    }

    const compared = leftPart.localeCompare(rightPart);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

export function updateAndroidRelease(args) {
  const env = args.env;
  const version = args.version;
  const apkUrl = args["apk-url"];
  const releasedAt =
    args["released-at"] || new Date().toISOString().slice(0, 10);
  const releases = JSON.parse(readText("releases.json"));
  const buildNumber = resolveBuildNumber(
    releases,
    env,
    version,
    args["build-number"],
  );

  upsertRelease(releases, {
    env,
    version,
    buildNumber,
    releasedAt,
    notes: args.notes,
    downloadUrl: apkUrl,
  });

  writeText("releases.json", `${JSON.stringify(releases, null, 2)}\n`);

  if (!args.quiet) {
    console.log(`배포 파일 갱신 완료: Android ${env.toUpperCase()} ${version} build ${buildNumber}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  validateArgs(args);
  updateAndroidRelease(args);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("");
    printUsage();
    process.exit(1);
  }
}
