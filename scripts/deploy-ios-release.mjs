#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseArgs,
  validateArgs as validateUpdateArgs,
  updateIosRelease,
} from "./update-ios-release.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_REPO = "hechika/coffeebean";

export class UsageError extends Error {}

export function printUsage() {
  console.log(`Usage:
  node scripts/deploy-ios-release.mjs --env dev --version 2.0.68 --ipa ./Coffeebean_Dev_2.0.68.ipa --released-at 2026-07-20 --note "업데이트 내용"

Options:
  --env <dev|stg>          iOS 배포 환경
  --version <x.y.z>        앱 버전
  --ipa <path>             업로드할 IPA 파일 경로
  --released-at <date>     배포일. YYYY-MM-DD 형식. 생략하면 오늘 날짜 사용
  --build-number <number>  같은 버전 내 빌드 번호. 생략하면 자동 산정
  --note <text>            업데이트 노트. 여러 번 입력 가능
  --notes <a|b|c>          파이프(|)로 구분한 업데이트 노트 목록
  --repo <owner/name>      GitHub 저장소. 기본값: ${DEFAULT_REPO}
  --no-commit              manifest/release JSON 변경사항을 커밋하지 않음
  --no-push                커밋 후 git push를 하지 않음
  --draft                  GitHub Release를 draft로 생성
  --prerelease             GitHub Release를 prerelease로 표시
  --help                   도움말 출력
`);
}

export function parseDeployArgs(argv) {
  const args = parseArgsForDeploy(argv);
  args.repo ||= DEFAULT_REPO;
  args.notes ||= [];
  return args;
}

function parseArgsForDeploy(argv) {
  const args = {
    notes: [],
    commit: true,
    push: true,
    draft: false,
    prerelease: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--no-commit") {
      args.commit = false;
      continue;
    }

    if (arg === "--no-push") {
      args.push = false;
      continue;
    }

    if (arg === "--draft") {
      args.draft = true;
      continue;
    }

    if (arg === "--prerelease") {
      args.prerelease = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new UsageError(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      throw new UsageError(`Missing value for --${key}`);
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

export function validateDeployArgs(args) {
  if (args.help) {
    return;
  }

  if (!args.ipa) {
    throw new UsageError("--ipa is required");
  }

  const ipaPath = path.resolve(ROOT_DIR, args.ipa);
  if (!fs.existsSync(ipaPath)) {
    throw new UsageError(`IPA file not found: ${ipaPath}`);
  }

  if (!ipaPath.endsWith(".ipa")) {
    throw new UsageError("--ipa must point to an .ipa file");
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repo)) {
    throw new UsageError("--repo must look like owner/name");
  }

  printUpdateUsageIfInvalid(args);
}

function printUpdateUsageIfInvalid(args) {
  try {
    const updateArgs = parseArgs([
      "--env",
      args.env || "",
      "--version",
      args.version || "",
      "--ipa-url",
      "https://example.com/app.ipa",
      ...(args["released-at"] ? ["--released-at", args["released-at"]] : []),
    ]);
    validateUpdateArgs(updateArgs);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  if (!["dev", "stg"].includes(args.env)) {
    throw new UsageError("--env must be one of: dev, stg");
  }

  if (!args.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(args.version)) {
    throw new UsageError("--version must look like 2.0.68");
  }

  if (args["released-at"] && !/^\d{4}-\d{2}-\d{2}$/.test(args["released-at"])) {
    throw new UsageError("--released-at must use YYYY-MM-DD");
  }

  if (args["build-number"] && !/^\d+$/.test(args["build-number"])) {
    throw new UsageError("--build-number must be a positive integer");
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
    stdio: options.stream ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(formatCommandError(command, args, result));
  }

  return result.stdout?.trim() || "";
}

function formatCommandError(command, args, result) {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const tail = output ? tailLines(output, 40) : "출력 없음";
  return [
    `명령 실행 실패: ${command} ${args.join(" ")}`,
    `종료 코드: ${result.status}`,
    tail,
  ].join("\n");
}

function tailLines(value, count) {
  const lines = value.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

function logStep(message) {
  console.log(`- ${message}`);
}
export function ensureGhAuth() {
  run("gh", ["auth", "status"], { capture: true });
}

export function releaseExists({ repo, tag }) {
  const result = spawnSync("gh", ["release", "view", tag, "--repo", repo], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (/not found|HTTP 404/i.test(output)) {
    return false;
  }

  throw new Error(output.trim() || `Could not check release ${tag}`);
}

export function createOrUploadRelease({ args, tag, ipaPath, buildNumber }) {
  const title = `iOS ${args.env.toUpperCase()} ${args.version} build ${buildNumber}`;
  const notes = args.notes.length ? args.notes.join("\n") : title;

  if (releaseExists({ repo: args.repo, tag })) {
    throw new Error(`이미 존재하는 GitHub Release입니다: ${tag}`);
  }

  const releaseArgs = [
    "release",
    "create",
    tag,
    ipaPath,
    "--repo",
    args.repo,
    "--title",
    title,
    "--notes",
    notes,
  ];

  if (args.draft) {
    releaseArgs.push("--draft");
  }

  if (args.prerelease) {
    releaseArgs.push("--prerelease");
  }

  run("gh", releaseArgs);
}

export function resolveBuildNumber(args) {
  if (args["build-number"]) {
    return normalizeBuildNumber(args["build-number"]);
  }

  const releasesPath = path.join(ROOT_DIR, "releases.json");
  const releases = JSON.parse(fs.readFileSync(releasesPath, "utf8"));
  const matchingBuilds = (releases.ios?.[args.env] || [])
    .filter((release) => release.version === args.version)
    .map((release) => normalizeBuildNumber(release.buildNumber));

  return matchingBuilds.length ? Math.max(...matchingBuilds) + 1 : 1;
}

function normalizeBuildNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

export function assetDownloadUrl({ repo, tag, ipaPath }) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(
    tag,
  )}/${encodeURIComponent(path.basename(ipaPath))}`;
}

export function gitHasChanges(paths) {
  const output = run("git", ["status", "--short", "--", ...paths], {
    capture: true,
  });
  return output.length > 0;
}

export function commitAndPush({ args, paths }) {
  if (!args.commit) {
    return;
  }

  if (!gitHasChanges(paths)) {
    logStep("커밋할 배포 파일 변경사항 없음");
    return;
  }

  run("git", ["add", "--", ...paths]);
  run("git", [
    "commit",
    "-m",
    `Deploy iOS ${args.env.toUpperCase()} ${args.version} build ${args["build-number"]}`,
  ]);

  if (args.push) {
    run("git", ["push"]);
  }
}

export function deployIosRelease(args, options = {}) {
  const ipaPath = path.resolve(ROOT_DIR, args.ipa);
  const buildNumber = resolveBuildNumber(args);
  args["build-number"] = String(buildNumber);
  const tag = `ios-${args.env}-${args.version}-build.${buildNumber}`;
  const ipaUrl = assetDownloadUrl({
    repo: args.repo,
    tag,
    ipaPath,
  });
  const latestManifestPath = `IPA/manifest_${args.env}.plist`;
  const historyManifestPath = `IPA/hist/manifest_${args.env}_${args.version}_build_${buildNumber}.plist`;
  const changedPaths = [latestManifestPath, historyManifestPath, "releases.json"];

  if (!options.skipAuth) {
    logStep("GitHub 인증 확인 중");
    ensureGhAuth();
  }

  logStep(`GitHub Release에 IPA 업로드 중 (build ${buildNumber})`);
  createOrUploadRelease({ args, tag, ipaPath, buildNumber });

  logStep("다운로드 페이지 배포 파일 갱신 중");
  updateIosRelease({
    env: args.env,
    version: args.version,
    "ipa-url": ipaUrl,
    "released-at": args["released-at"],
    "build-number": String(buildNumber),
    notes: args.notes,
    quiet: true,
  });

  logStep(args.commit ? "배포 파일 커밋 중" : "커밋 건너뜀");
  commitAndPush({ args, paths: changedPaths });

  console.log("");
  console.log(`완료: iOS ${args.env.toUpperCase()} ${args.version} build ${buildNumber}`);
  console.log(`Release: https://github.com/${args.repo}/releases/tag/${tag}`);
}

function main() {
  const args = parseDeployArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  validateDeployArgs(args);
  deployIosRelease(args);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof UsageError) {
      console.error("");
      printUsage();
    }
    process.exit(1);
  }
}
