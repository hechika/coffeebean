#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE_BASE_URL = "https://hechika.github.io/coffeebean";
const IOS_ENVS = new Set(["dev", "stg"]);

export function printUsage() {
  console.log(`Usage:
  node scripts/update-ios-release.mjs --env dev --version 2.0.68 --ipa-url https://github.com/hechika/coffeebean/releases/download/ios-dev-2.0.68/Coffeebean_Dev_2.0.68.ipa --released-at 2026-07-20 --note "업데이트 내용"

Options:
  --env <dev|stg>          iOS 배포 환경
  --version <x.y.z>        앱 버전
  --ipa-url <https-url>    GitHub Releases 등에 업로드된 IPA 파일 URL
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

  if (!IOS_ENVS.has(args.env)) {
    throw new Error("--env must be one of: dev, stg");
  }

  if (!args.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(args.version)) {
    throw new Error("--version must look like 2.0.68");
  }

  if (!args["ipa-url"]) {
    throw new Error("--ipa-url is required");
  }

  const ipaUrl = new URL(args["ipa-url"]);
  if (ipaUrl.protocol !== "https:") {
    throw new Error("--ipa-url must start with https://");
  }

  if (!ipaUrl.pathname.endsWith(".ipa")) {
    throw new Error("--ipa-url must point to an .ipa file");
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

function extractPlistValue(xml, key) {
  const pattern = new RegExp(
    `<key>${escapeRegExp(key)}</key>\\s*<string>([^<]*)</string>`,
    "m",
  );
  const match = xml.match(pattern);
  return match?.[1] || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createManifest({ ipaUrl, version, bundleIdentifier, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>items</key>
\t<array>
\t\t<dict>
\t\t\t<key>assets</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>kind</key>
\t\t\t\t\t<string>software-package</string>
\t\t\t\t\t<key>url</key>
\t\t\t\t\t<string>${escapeXml(ipaUrl)}</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t\t<key>metadata</key>
\t\t\t<dict>
\t\t\t\t<key>bundle-identifier</key>
\t\t\t\t<string>${escapeXml(bundleIdentifier)}</string>
\t\t\t\t<key>bundle-version</key>
\t\t\t\t<string>${escapeXml(version)}</string>
\t\t\t\t<key>kind</key>
\t\t\t\t<string>software</string>
\t\t\t\t<key>platform-identifier</key>
\t\t\t\t<string>com.apple.platform.iphoneos</string>
\t\t\t\t<key>title</key>
\t\t\t\t<string>${escapeXml(title)}</string>
\t\t\t</dict>
\t\t</dict>
\t</array>
</dict>
</plist>
`;
}

function upsertRelease(releases, { env, version, buildNumber, releasedAt, notes, downloadUrl }) {
  releases.ios ||= {};
  releases.ios[env] ||= [];

  const nextRelease = {
    version,
    buildNumber,
    releasedAt,
    downloadUrl,
  };

  if (notes.length) {
    nextRelease.notes = notes;
  }

  const existingIndex = releases.ios[env].findIndex(
    (release) =>
      release.version === version &&
      normalizeBuildNumber(release.buildNumber) === buildNumber,
  );

  if (existingIndex >= 0) {
    releases.ios[env][existingIndex] = {
      ...releases.ios[env][existingIndex],
      ...nextRelease,
    };
  } else {
    releases.ios[env].push(nextRelease);
  }

  releases.ios[env].sort(compareReleaseEntries);
}

function normalizeBuildNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function resolveBuildNumber(releases, env, version, requestedBuildNumber) {
  if (requestedBuildNumber) {
    return normalizeBuildNumber(requestedBuildNumber);
  }

  const matchingBuilds = (releases.ios?.[env] || [])
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

function isSameReleaseEntry(left, right) {
  return (
    left?.version === right?.version &&
    normalizeBuildNumber(left?.buildNumber) === normalizeBuildNumber(right?.buildNumber)
  );
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

export function updateIosRelease(args) {
  const env = args.env;
  const version = args.version;
  const ipaUrl = args["ipa-url"];
  const releasedAt =
    args["released-at"] || new Date().toISOString().slice(0, 10);
  const releases = JSON.parse(readText("releases.json"));
  const buildNumber = resolveBuildNumber(
    releases,
    env,
    version,
    args["build-number"],
  );
  const latestManifestPath = `manifests/ios/manifest_${env}.plist`;
  const historyManifestPath = `manifests/ios/hist/manifest_${env}_${version}_build_${buildNumber}.plist`;
  const latestManifest = readText(latestManifestPath);
  const bundleIdentifier = extractPlistValue(latestManifest, "bundle-identifier");
  const title = extractPlistValue(latestManifest, "title");

  if (!bundleIdentifier || !title) {
    throw new Error(`Could not read bundle metadata from ${latestManifestPath}`);
  }

  const manifestContent = createManifest({
    ipaUrl,
    version,
    bundleIdentifier,
    title,
  });

  writeText(historyManifestPath, manifestContent);

  const manifestUrl = `${SITE_BASE_URL}/${historyManifestPath}`;
  const downloadUrl = `itms-services://?action=download-manifest&url=${manifestUrl}`;
  const currentRelease = {
    version,
    buildNumber,
  };

  upsertRelease(releases, {
    env,
    version,
    buildNumber,
    releasedAt,
    notes: args.notes,
    downloadUrl,
  });

  const latestRelease = releases.ios[env][releases.ios[env].length - 1];
  if (isSameReleaseEntry(latestRelease, currentRelease)) {
    writeText(latestManifestPath, manifestContent);
  }

  writeText("releases.json", `${JSON.stringify(releases, null, 2)}\n`);

  if (!args.quiet) {
    console.log(`배포 파일 갱신 완료: iOS ${env.toUpperCase()} ${version} build ${buildNumber}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  validateArgs(args);
  updateIosRelease(args);
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
