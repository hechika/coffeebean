#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  deployIosRelease,
  ensureGhAuth,
  parseDeployArgs,
  resolveBuildNumber,
  run,
  UsageError,
} from "./deploy-ios-release.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_IOS_PROJECT_DIR = "../coffeebean-membership-ios";
const DEFAULT_WORKSPACE = "Coffeebean.xcworkspace";
const DEFAULT_TEAM_ID = "3X72XH5X9A";
const DEFAULT_EXPORT_METHOD = "ad-hoc";
const DEFAULT_SCHEMES = {
  dev: "Coffeebean_Dev",
  stg: "Coffeebean_Stg",
};

function logStep(message) {
  console.log(`- ${message}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/build-and-deploy-ios-release.mjs --env dev --version 2.0.68 --note "업데이트 내용"

Options:
  --env <dev|stg>                    iOS 배포 환경
  --version <x.y.z>                  앱 버전
  --ios-project-dir <path>           Xcode 프로젝트가 있는 디렉터리. 기본값: ${DEFAULT_IOS_PROJECT_DIR}
  --workspace <name.xcworkspace>     사용할 workspace. 기본값: ${DEFAULT_WORKSPACE}
  --project <name.xcodeproj>         workspace가 없을 때 사용할 project
  --scheme <name>                    archive할 scheme. 기본값: Coffeebean_Dev 또는 Coffeebean_Stg
  --configuration <name>             빌드 configuration. 기본값: Release
  --build-number <number>            같은 버전 내 빌드 번호. 생략하면 자동 산정
  --export-options-plist <path>      xcodebuild -exportArchive용 ExportOptions.plist. 생략하면 자동 생성
  --export-method <method>           ExportOptions method. 기본값: ${DEFAULT_EXPORT_METHOD}
  --team-id <id>                     Apple Developer Team ID. 기본값: ${DEFAULT_TEAM_ID}
  --allow-provisioning-updates       xcodebuild에 -allowProvisioningUpdates 추가
  --derived-data-path <path>         DerivedData 경로. 기본값: .build/DerivedData
  --archive-path <path>              archive 출력 경로. 기본값: .build/ios/{env}-{version}.xcarchive
  --export-path <path>               IPA export 경로. 기본값: .build/ios/export-{env}-{version}
  --note <text>                      업데이트 노트. 여러 번 입력 가능
  --notes <a|b|c>                    파이프(|)로 구분한 업데이트 노트 목록
  --repo <owner/name>                GitHub 저장소. 기본값: hechika/coffeebean
  --no-commit                        manifest/release JSON 변경사항을 커밋하지 않음
  --no-push                          커밋 후 git push를 하지 않음
  --skip-build                       기존 export 경로의 IPA를 사용해 배포만 실행
  --help                             도움말 출력
`);
}

function parseBuildArgs(argv) {
  const args = parseDeployArgsWithBuildOptions(argv);
  args["ios-project-dir"] ||= DEFAULT_IOS_PROJECT_DIR;
  args.workspace ||= args.project ? "" : DEFAULT_WORKSPACE;
  args.scheme ||= DEFAULT_SCHEMES[args.env] || "";
  args.configuration ||= "Release";
  args["team-id"] ||= DEFAULT_TEAM_ID;
  args["export-method"] ||= DEFAULT_EXPORT_METHOD;
  args["derived-data-path"] ||= ".build/DerivedData";
  args["archive-path"] ||= `.build/ios/${args.env || "ios"}-${args.version || "version"}.xcarchive`;
  args["export-path"] ||= `.build/ios/export-${args.env || "ios"}-${args.version || "version"}`;
  return args;
}

function parseDeployArgsWithBuildOptions(argv) {
  const deployArgv = [];
  const args = {};
  const buildKeys = new Set([
    "ios-project-dir",
    "workspace",
    "project",
    "scheme",
    "configuration",
    "build-number",
    "export-options-plist",
    "export-method",
    "team-id",
    "derived-data-path",
    "archive-path",
    "export-path",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      deployArgv.push(arg);
      continue;
    }

    if (arg === "--skip-build") {
      args["skip-build"] = true;
      continue;
    }

    if (arg === "--allow-provisioning-updates") {
      args["allow-provisioning-updates"] = true;
      continue;
    }

    const key = arg.startsWith("--") ? arg.slice(2) : "";
    if (buildKeys.has(key)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new UsageError(`Missing value for --${key}`);
      }
      args[key] = next;
      index += 1;
      continue;
    }

    deployArgv.push(arg);
    if (arg.startsWith("--") && !["--no-commit", "--no-push", "--draft", "--prerelease"].includes(arg)) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        deployArgv.push(next);
        index += 1;
      }
    }
  }

  return {
    ...parseDeployArgs(deployArgv),
    ...args,
  };
}

function validateBuildArgs(args) {
  if (args.help) {
    return;
  }

  const projectDir = path.resolve(ROOT_DIR, args["ios-project-dir"]);
  if (!fs.existsSync(projectDir)) {
    throw new UsageError(`iOS project directory not found: ${projectDir}`);
  }

  if (!args.workspace && !args.project) {
    throw new UsageError("--workspace or --project is required");
  }

  if (args.workspace && args.project) {
    throw new UsageError("Use only one of --workspace or --project");
  }

  if (!args.scheme) {
    throw new UsageError("--scheme is required");
  }

  if (
    args["export-options-plist"] &&
    !fs.existsSync(path.resolve(projectDir, args["export-options-plist"]))
  ) {
    const exportOptionsPath = path.resolve(projectDir, args["export-options-plist"]);
    throw new UsageError(`ExportOptions.plist not found: ${exportOptionsPath}`);
  }

  if (!["dev", "stg"].includes(args.env)) {
    throw new UsageError("--env must be one of: dev, stg");
  }

  if (!args.version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(args.version)) {
    throw new UsageError("--version must look like 2.0.68");
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repo)) {
    throw new UsageError("--repo must look like owner/name");
  }

  if (args["released-at"] && !/^\d{4}-\d{2}-\d{2}$/.test(args["released-at"])) {
    throw new UsageError("--released-at must use YYYY-MM-DD");
  }

  if (args["build-number"] && !/^\d+$/.test(args["build-number"])) {
    throw new UsageError("--build-number must be a positive integer");
  }

  if (args["skip-build"]) {
    findIpa(path.resolve(projectDir, args["export-path"]), { required: true });
  }
}

function xcodebuildTargetArgs(args) {
  if (args.workspace) {
    return ["-workspace", args.workspace];
  }

  return ["-project", args.project];
}

function buildIpa(args) {
  const projectDir = path.resolve(ROOT_DIR, args["ios-project-dir"]);
  const archivePath = path.resolve(projectDir, args["archive-path"]);
  const exportPath = path.resolve(projectDir, args["export-path"]);
  const derivedDataPath = path.resolve(projectDir, args["derived-data-path"]);
  const exportOptionsPath = ensureExportOptionsPlist(args, projectDir);

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.mkdirSync(exportPath, { recursive: true });
  fs.mkdirSync(derivedDataPath, { recursive: true });

  logStep(`Xcode archive 생성 중 (${args.scheme})`);
  run(
    "xcodebuild",
    [
      ...xcodebuildTargetArgs(args),
      "-scheme",
      args.scheme,
      "-configuration",
      args.configuration,
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archivePath,
      "-derivedDataPath",
      derivedDataPath,
      `MARKETING_VERSION=${args.version}`,
      ...(args["build-number"]
        ? [`CURRENT_PROJECT_VERSION=${args["build-number"]}`]
        : []),
      ...(args["allow-provisioning-updates"]
        ? ["-allowProvisioningUpdates"]
        : []),
      "clean",
      "archive",
    ],
    { cwd: projectDir },
  );

  logStep("IPA export 중");
  run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      exportOptionsPath,
      ...(args["allow-provisioning-updates"]
        ? ["-allowProvisioningUpdates"]
        : []),
    ],
    { cwd: projectDir },
  );

  const ipaPath = findIpa(exportPath, { required: true });
  logStep(`IPA 생성 완료: ${path.basename(ipaPath)}`);
  return ipaPath;
}

function ensureExportOptionsPlist(args, projectDir) {
  if (args["export-options-plist"]) {
    return path.resolve(projectDir, args["export-options-plist"]);
  }

  const generatedPath = path.resolve(
    projectDir,
    `.build/ios/ExportOptions.${args.env}.plist`,
  );
  fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
  fs.writeFileSync(
    generatedPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>method</key>
\t<string>${escapeXml(args["export-method"])}</string>
\t<key>signingStyle</key>
\t<string>automatic</string>
\t<key>teamID</key>
\t<string>${escapeXml(args["team-id"])}</string>
\t<key>compileBitcode</key>
\t<false/>
\t<key>stripSwiftSymbols</key>
\t<true/>
</dict>
</plist>
`,
    "utf8",
  );
  return generatedPath;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(String.fromCharCode(34), "&quot;")
    .replaceAll(String.fromCharCode(39), "&apos;");
}

function findIpa(exportPath, { required }) {
  if (!fs.existsSync(exportPath)) {
    if (required) {
      throw new UsageError(`IPA export path not found: ${exportPath}`);
    }
    return "";
  }

  const ipaFiles = fs
    .readdirSync(exportPath)
    .filter((name) => name.endsWith(".ipa"))
    .sort();

  if (!ipaFiles.length) {
    if (required) {
      throw new UsageError(`No IPA file found in: ${exportPath}`);
    }
    return "";
  }

  return path.join(exportPath, ipaFiles[0]);
}

function main() {
  const args = parseBuildArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  validateBuildArgs(args);
  const buildNumber = resolveBuildNumber(args);
  args["build-number"] = String(buildNumber);
  if (args["archive-path"] === `.build/ios/${args.env}-${args.version}.xcarchive`) {
    args["archive-path"] = `.build/ios/${args.env}-${args.version}-build-${buildNumber}.xcarchive`;
  }
  if (args["export-path"] === `.build/ios/export-${args.env}-${args.version}`) {
    args["export-path"] = `.build/ios/export-${args.env}-${args.version}-build-${buildNumber}`;
  }
  logStep(`배포 빌드 번호: build ${buildNumber}`);
  logStep("GitHub 인증 확인 중");
  ensureGhAuth();

  const projectDir = path.resolve(ROOT_DIR, args["ios-project-dir"]);
  const exportPath = path.resolve(projectDir, args["export-path"]);
  const ipaPath = args["skip-build"]
    ? findIpa(exportPath, { required: true })
    : buildIpa(args);

  deployIosRelease(
    {
      ...args,
      ipa: ipaPath,
    },
    { skipAuth: true },
  );
}

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
