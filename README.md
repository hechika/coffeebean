# Coffeebean App Download Page

커피빈 앱 iOS/Android 테스트 버전을 배포하기 위한 GitHub Pages 정적 웹 페이지입니다.

메인 페이지는 `download.html`이며, 앱 버전/업데이트 날짜/업데이트 노트/이전 버전 다운로드 정보는 `releases.json`과 iOS manifest 파일을 함께 사용해 관리합니다.

## 주요 파일

| 파일                                      | 역할                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `download.html`                           | 앱 다운로드 카드, 설치 안내, 업데이트 노트 모달을 표시하는 메인 페이지 |
| `releases.json`                           | 버전별 업데이트 날짜, 업데이트 노트, 이전 버전 다운로드 URL 관리       |
| `IPA/manifest_dev.plist`                  | iOS DEV 최신 설치 manifest                                             |
| `IPA/manifest_stg.plist`                  | iOS STG 최신 설치 manifest                                             |
| `IPA/hist/manifest_{env}_{version}.plist` | iOS 이전 버전 설치용 manifest                                          |
| `assets/css/cover.css`                    | 다운로드 페이지 스타일                                                 |
| `scripts/build-and-deploy-ios-release.mjs` | iOS 프로젝트 빌드, IPA 생성, GitHub Releases 업로드, Pages 배포 자동화 |
| `scripts/deploy-ios-release.mjs`          | iOS IPA 업로드부터 GitHub Pages 배포까지 자동화하는 스크립트           |
| `scripts/update-ios-release.mjs`          | iOS manifest와 `releases.json` 업데이트 자동화 스크립트                |

## 공통 업데이트 원칙

1. 앱 파일은 GitHub Pages 저장소에 직접 올리지 않고, GitHub Releases 또는 외부 파일 저장소에 업로드합니다.
2. `download.html`에는 최신 버전 다운로드 버튼 URL을 연결합니다.
3. `releases.json`에는 버전, 업데이트 날짜, 업데이트 노트, 이전 버전 다운로드 URL을 기록합니다.
4. 사용자가 업데이트 노트 모달에서 화살표를 누르면 `releases.json`에 등록된 버전별 노트를 확인할 수 있습니다.
5. 이전 버전 다운로드 버튼은 해당 버전의 `downloadUrl`이 있을 때만 표시됩니다.

## iOS 앱 업데이트 관리

iOS는 APK처럼 파일을 직접 다운로드하는 방식이 아니라 `itms-services://` URL이 plist manifest를 읽고, manifest 안의 IPA URL을 통해 설치를 시작합니다.

### 빌드부터 배포까지 전체 자동화

현재 폴더 구조에서는 iOS 앱 소스가 `../coffeebean-membership-ios`에 있고, 스크립트가 `Coffeebean.xcworkspace`, DEV/STG scheme, AdHoc ExportOptions를 기본값으로 사용합니다. 따라서 보통은 환경, 버전, 업데이트 노트만 지정하면 IPA 생성부터 GitHub Pages 배포까지 한 번에 처리됩니다.

```bash
node scripts/build-and-deploy-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

STG 배포 예시:

```bash
node scripts/build-and-deploy-ios-release.mjs \
  --env stg \
  --version 2.0.68 \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

빌드 자동화 스크립트가 처리하는 항목:

- `xcodebuild clean archive`로 `.xcarchive` 생성
- 자동 생성한 AdHoc ExportOptions로 `xcodebuild -exportArchive`를 실행해 IPA 생성
- 생성된 IPA를 GitHub Release asset으로 업로드
- 최신 iOS manifest와 히스토리 manifest 갱신
- `releases.json` 갱신
- 변경된 배포 파일 커밋 후 `git push`

빌드는 건너뛰고 기존 export 경로의 IPA로 배포만 다시 하려면 `--skip-build`를 사용합니다.

```bash
node scripts/build-and-deploy-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --export-path .build/ios/export-dev-2.0.68 \
  --skip-build \
  --note "업데이트 내용"
```

### IPA 생성 후 전체 자동화

IPA 파일을 생성한 뒤 아래 명령을 실행하면 GitHub Releases 업로드부터 다운로드 페이지 배포까지 한 번에 처리합니다.

```bash
node scripts/deploy-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --ipa ./Coffeebean_Dev_2.0.68.ipa \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

STG 배포는 `--env stg`와 STG IPA 파일 경로를 사용합니다.

```bash
node scripts/deploy-ios-release.mjs \
  --env stg \
  --version 2.0.68 \
  --ipa ./Coffeebean_Stg_2.0.68.ipa \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

전체 자동화 스크립트가 처리하는 항목:

- GitHub Release 태그 생성 또는 기존 Release 재사용
  - DEV: `ios-dev-{version}`
  - STG: `ios-stg-{version}`
- IPA 파일을 GitHub Release asset으로 업로드
- 업로드된 IPA URL로 `IPA/manifest_{env}.plist`의 IPA URL과 `bundle-version` 수정
- `IPA/hist/manifest_{env}_{version}.plist` 생성 또는 갱신
- `releases.json`의 `ios.{env}` 배열에 버전, 배포일, 업데이트 노트, 이전 버전 다운로드 URL 추가 또는 갱신
- 변경된 manifest와 `releases.json`만 커밋
- `git push`로 GitHub Pages 배포 반영

사전 조건:

- GitHub CLI가 설치되어 있어야 합니다.
- `gh auth status`가 정상이어야 합니다. 토큰이 만료되었으면 `gh auth login -h github.com`으로 다시 로그인합니다.
- 현재 브랜치가 GitHub Pages 배포 브랜치여야 합니다. 현재 프로젝트는 `main` 브랜치를 기준으로 사용합니다.

커밋이나 푸시 없이 파일 변경까지만 확인하려면 아래 옵션을 붙입니다.

```bash
node scripts/deploy-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --ipa ./Coffeebean_Dev_2.0.68.ipa \
  --note "업데이트 내용" \
  --no-commit \
  --no-push
```

업데이트 노트가 여러 개라면 `--note`를 여러 번 입력할 수 있습니다.

```bash
node scripts/deploy-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --ipa ./Coffeebean_Dev_2.0.68.ipa \
  --note "첫 번째 변경사항" \
  --note "두 번째 변경사항"
```

### manifest/release JSON만 갱신

IPA 파일을 GitHub Releases 또는 외부 파일 저장소에 업로드한 뒤, 업로드된 HTTPS IPA URL을 사용해 아래 명령을 실행합니다.

```bash
node scripts/update-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --ipa-url https://github.com/hechika/coffeebean/releases/download/ios-dev-2.0.68/Coffeebean_Dev_2.0.68.ipa \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

STG 배포는 `--env stg`와 STG IPA URL을 사용합니다.

```bash
node scripts/update-ios-release.mjs \
  --env stg \
  --version 2.0.68 \
  --ipa-url https://github.com/hechika/coffeebean/releases/download/ios-stg-2.0.68/Coffeebean_Stg_2.0.68.ipa \
  --released-at 2026-07-20 \
  --note "업데이트 내용"
```

스크립트가 자동으로 처리하는 항목:

- `IPA/manifest_{env}.plist`의 IPA URL과 `bundle-version` 수정
- `IPA/hist/manifest_{env}_{version}.plist` 생성 또는 갱신
- `releases.json`의 `ios.{env}` 배열에 버전, 배포일, 업데이트 노트, 이전 버전 다운로드 URL 추가 또는 갱신

업데이트 노트가 여러 개라면 `--note`를 여러 번 입력할 수 있습니다.

```bash
node scripts/update-ios-release.mjs \
  --env dev \
  --version 2.0.68 \
  --ipa-url https://github.com/hechika/coffeebean/releases/download/ios-dev-2.0.68/Coffeebean_Dev_2.0.68.ipa \
  --note "첫 번째 변경사항" \
  --note "두 번째 변경사항"
```

### 최신 버전 배포 흐름

1. IPA 파일을 생성합니다.
   - 예: `Coffeebean_Dev_2.0.67.ipa`
   - 예: `Coffeebean_Stg_2.0.67.ipa`

2. IPA 파일을 GitHub Releases에 업로드합니다.
   - DEV 예시 태그: `ios-dev-2.0.67`
   - STG 예시 태그: `ios-stg-2.0.67`
   - IPA URL 예시:

```text
https://github.com/hechika/coffeebean/releases/download/ios-dev-2.0.67/Coffeebean_Dev_2.0.67.ipa
```

3. 최신 manifest를 수정합니다.
   - DEV: `IPA/manifest_dev.plist`
   - STG: `IPA/manifest_stg.plist`

수정해야 하는 값:

```xml
<key>url</key>
<string>https://github.com/hechika/coffeebean/releases/download/ios-dev-2.0.67/Coffeebean_Dev_2.0.67.ipa</string>

<key>bundle-version</key>
<string>2.0.67</string>
```

4. 같은 내용을 버전 히스토리 manifest로 복사합니다.
   - DEV 예시: `IPA/hist/manifest_dev_2.0.67.plist`
   - STG 예시: `IPA/hist/manifest_stg_2.0.67.plist`

5. `download.html`의 최신 iOS 설치 버튼은 항상 최신 manifest를 바라보게 유지합니다.

```text
itms-services://?action=download-manifest&url=https://hechika.github.io/coffeebean/IPA/manifest_dev.plist
```

6. `releases.json`에 새 버전을 추가합니다.

```json
{
  "version": "2.0.67",
  "releasedAt": "2026-07-10",
  "downloadUrl": "itms-services://?action=download-manifest&url=https://hechika.github.io/coffeebean/IPA/hist/manifest_dev_2.0.67.plist",
  "notes": ["퀵계좌이체 결제수단 추가"]
}
```

### iOS에서 특히 주의할 점

- `download.html`의 카드 버전은 `IPA/manifest_dev.plist`, `IPA/manifest_stg.plist`의 `bundle-version`에서 동적으로 표시됩니다.
- 최신 설치 버튼은 `IPA/manifest_{env}.plist`를 사용합니다.
- 이전 버전 다운로드는 `IPA/hist/manifest_{env}_{version}.plist`를 사용합니다.
- manifest 안의 `software-package` URL은 실제 IPA 파일을 가리켜야 합니다.
- iOS 설치는 HTTPS URL에서만 안정적으로 동작합니다.
- 사용자의 iPhone이 배포 프로파일에 등록되어 있지 않으면 설치가 실패할 수 있습니다.

## Android 앱 업데이트 관리

Android는 APK 파일 URL을 다운로드 버튼에 직접 연결합니다. 현재 페이지의 Android 카드에는 DEV, STG, REAL 환경이 있습니다.

### 최신 버전 배포 흐름

1. APK 파일을 생성합니다.
   - DEV 예시: `app-dev-debug.apk`
   - STG 예시: `app-stg-release.apk`
   - REAL 예시: `app-prod-release.apk`

2. APK 파일을 GitHub Releases 또는 외부 파일 저장소에 업로드합니다.

3. `download.html`에서 해당 환경의 Android 다운로드 버튼 URL을 새 APK URL로 교체합니다.

```html
<a class="download-button" href="https://example.com/app-dev-debug.apk">
  APK 다운로드
</a>
```

4. `releases.json`의 `android` 섹션에 버전 정보를 추가합니다.

```json
{
  "version": "2.0.67",
  "releasedAt": "2026-07-10",
  "downloadUrl": "https://example.com/app-dev-debug-2.0.67.apk",
  "notes": ["퀵계좌이체 결제수단 추가"]
}
```

5. Android 카드에 버전/업데이트 날짜/업데이트 노트를 표시하려면 `releases.json`의 해당 환경 배열에 최신 버전을 등록합니다.

```json
{
  "android": {
    "dev": [
      {
        "version": "2.0.67",
        "releasedAt": "2026-07-10",
        "downloadUrl": "https://example.com/app-dev-debug-2.0.67.apk",
        "notes": ["퀵계좌이체 결제수단 추가"]
      }
    ],
    "stg": [],
    "real": []
  }
}
```

### Android에서 특히 주의할 점

- Android는 manifest 파일을 사용하지 않습니다.
- 최신 다운로드 버튼은 `download.html`의 APK URL이 기준입니다.
- 이전 버전 다운로드는 `releases.json`의 `downloadUrl`이 기준입니다.
- Android 버전 정보는 `releases.json`에 등록된 값을 사용합니다.
- APK URL이 Dropbox 공유 링크라면 직접 다운로드 가능한 URL인지 확인해야 합니다.
- GitHub Releases로 이관하면 버전별 APK 파일을 태그 단위로 관리할 수 있어 히스토리 관리가 쉬워집니다.

## `releases.json` 작성 규칙

기본 구조:

```json
{
  "ios": {
    "dev": [],
    "stg": []
  },
  "android": {
    "dev": [],
    "stg": [],
    "real": []
  }
}
```

버전 객체 필드:

| 필드          | 필수 여부 | 설명                                 |
| ------------- | --------- | ------------------------------------ |
| `version`     | 권장      | 앱 버전                              |
| `releasedAt`  | 권장      | 업데이트 날짜. `YYYY-MM-DD` 형식     |
| `downloadUrl` | 선택      | 이전 버전 다운로드 버튼에 사용할 URL |
| `notes`       | 선택      | 업데이트 노트 목록                   |

운영 팁:

- 새 버전을 추가할 때는 해당 환경 배열에 버전 객체를 추가합니다.
- `releasedAt`이 있으면 다운로드 카드에 업데이트 날짜가 표시됩니다.
- `notes`가 있으면 업데이트 노트 버튼이 표시됩니다.
- `downloadUrl`이 있으면 업데이트 노트 모달에서 해당 버전을 다운로드할 수 있습니다.
- Android처럼 manifest에서 버전을 읽지 않는 플랫폼은 최신 버전을 배열의 가장 앞에 두는 방식으로 관리하는 것이 좋습니다.

## 배포 전 체크리스트

### iOS

- [ ] IPA 파일을 GitHub Releases에 업로드했는지 확인
- [ ] `IPA/manifest_{env}.plist`의 IPA URL과 `bundle-version`을 최신 값으로 수정
- [ ] `IPA/hist/manifest_{env}_{version}.plist`를 추가
- [ ] `releases.json`에 `itms-services://` 형식의 `downloadUrl` 추가
- [ ] iPhone Safari에서 설치 버튼을 눌러 설치 확인 팝업이 뜨는지 확인

### Android

- [ ] APK 파일을 업로드했는지 확인
- [ ] `download.html`의 APK 다운로드 URL을 최신 파일로 수정
- [ ] `releases.json`에 Android 버전, 업데이트 날짜, 업데이트 노트, 이전 버전 다운로드 URL 추가
- [ ] Android Chrome에서 APK 다운로드가 시작되는지 확인
- [ ] 기존 앱 업데이트가 실패하면 삭제 후 재설치가 필요한지 안내 확인

## 로컬 테스트

정적 파일만으로 동작하므로 간단한 로컬 서버로 확인할 수 있습니다.

```bash
python3 -m http.server 8080
```

브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:8080/download.html
```

모바일 기기에서 확인하려면 같은 Wi-Fi에 연결한 뒤 PC의 로컬 IP로 접속합니다.

```text
http://{PC_LOCAL_IP}:8080/download.html
```
