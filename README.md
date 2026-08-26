# svncutter

TortoiseSVN 로그에서 복사한 커밋 경로 목록을 붙여넣으면, 배포용 파일(`.class`, 리소스, `.jsp`/`.js` 등)을 자동으로 찾아 배포 폴더 형태로 묶어주는 Node CLI 도구입니다.

## 전제 조건

- Node.js 설치
- 대상 프로젝트가 **Maven 표준 디렉터리 구조**를 따를 것
  - `src/main/java`, `src/main/resources`, `src/main/webapp`
  - 컴파일된 class는 `target/classes` 아래 위치
- java 파일이 포함된 경우, **실행 전에 빌드가 되어 있어야** 함 (그래야 `target/classes`에서 `.class`를 찾을 수 있음)
- 원격 서버 배포 기능(`--deploy-config`)을 쓰려면 `ssh2-sftp-client` 의존성 설치가 필요 (아래 설치 참고)

## 설치

```
npm install
```

로컬 배포 폴더만 만드는 용도라면 설치 없이도 바로 실행 가능합니다.

```
node bin/svncutter.js --wc <작업복사본 경로> --target <배포 대상 경로>
```

전역 명령(`svncutter`)으로 쓰고 싶다면 프로젝트 폴더에서:

```
npm link
```

이후 어디서든:

```
svncutter --wc <작업복사본 경로> --target <배포 대상 경로>
```

## 사용법

1. TortoiseSVN 로그 창에서 원하는 리비전(들)을 선택
2. 변경된 경로 목록만 클립보드로 복사 (파일 경로만, 상태 표시 여부는 상관없음)
3. 아래 명령을 실행하면 붙여넣기 대기 상태가 됨

```
svncutter --wc D:\svn\somtg --target D:\deploy\somtg
```

4. 복사해둔 경로 목록을 터미널에 붙여넣기 (마우스 우클릭 붙여넣기 또는 `Ctrl+V`)
5. 붙여넣기가 끝나면 **`Enter` 를 한 번 더 눌러 빈 줄을 입력** → 입력 종료 (취소하려면 `Ctrl+C`)

파일로 저장해둔 경로 목록을 쓰고 싶다면 붙여넣기 대기 없이 바로 실행됩니다:

```
svncutter --wc D:\svn\somtg --target D:\deploy\somtg --input paths.txt
```

## 옵션

| 옵션 | 필수 | 설명 |
|---|---|---|
| `--wc <path>` | O | `src/main/java`, `src/main/resources`, `src/main/webapp`를 포함하는 로컬 모듈 루트 경로 |
| `--target <path>` | O | 배포 결과물을 만들 베이스 폴더. 이 아래에 날짜 폴더가 자동 생성됨 |
| `--input <path>` | X | 경로 목록이 담긴 텍스트 파일. 생략하면 터미널에서 붙여넣기를 대기함 (빈 줄 입력으로 종료) |
| `--deploy-config <path>` | X | 원격 서버 SFTP 배포 설정 파일(JSON) 경로. 지정하면 로컬 배포 폴더 생성 후 원격 서버로도 업로드 |
| `-h`, `--help` | X | 사용법 출력 |

## 경로 판별 방식

각 SVN 경로에서 아래 세 가지 기준(anchor) 중 하나를 찾아 타입을 판별합니다. 저장소 절대경로의 앞부분(브랜치/모듈 경로 등)은 무시하므로 신경 쓰지 않아도 됩니다.

- `.../src/main/java/...` → Java 소스
- `.../src/main/resources/...` → 리소스 (properties, xml 등)
- `.../src/main/webapp/...` → 웹 리소스 (jsp, js, css 등)

이 세 가지에 해당하지 않는 경로는 처리하지 않고 **건너뜀** 목록에 표시됩니다.

## add/modified vs deleted 판별

경로 목록에 상태 표시가 없어도, `--wc`로 지정한 로컬 작업 복사본에서 **파일 실제 존재 여부**로 자동 판별합니다.

- 파일이 존재 → add/modified로 간주하고 배포 폴더로 복사
- 파일이 존재하지 않음 → deleted로 간주하고 `deleted-list.txt`에 기록 (실제 삭제는 수동으로 서버에서 진행)

## Java 처리 (inner class 포함)

`.java` 파일 하나당, `target/classes`의 같은 패키지 경로에서 아래 패턴에 맞는 모든 class 파일을 찾아 복사합니다.

- `ClassName.class`
- `ClassName$1.class`, `ClassName$InnerClass.class` 등 inner class / 익명 클래스 전부

빌드가 안 되어 `target/classes`에 class가 없으면 복사하지 않고 **경고**로 표시됩니다.

## 출력 구조

`--target` 아래 `YYYYMMDD` 폴더가 자동 생성됩니다. 같은 이름이 이미 있으면 `YYYYMMDD_1`, `YYYYMMDD_2`... 로 증가합니다.

```
<target>/20260722/
├── WEB-INF/
│   ├── classes/           ← java(.class, inner class 포함) + resources 결과물
│   └── jsp/                ← jsp 파일
├── js/, css/ 등             ← webapp 하위 기타 리소스 (경로 그대로)
├── deleted-list.txt         ← 삭제 대상 목록 (삭제된 파일이 있을 때만 생성)
└── result.txt                ← 처리 결과 리포트
```

## 처리 결과 확인 (result.txt)

실행할 때마다 배포 폴더 안에 `result.txt`가 생성되어 터미널을 닫아도 나중에 확인할 수 있습니다.

- 상태: `OK`(정상) / `WARN`(경고 있음 — 예: 빌드 누락으로 class를 못 찾음)
- 처리 일시, 작업 복사본 경로, 배포 폴더 경로
- 복사된 Java class / 리소스 / 웹 리소스 목록
- 삭제 대상 개수
- 경고 및 건너뜀 목록

경고가 있으면 CLI 종료 코드도 `2`로 반환되어, 배치 스크립트 등에서 자동으로 성공/실패를 판단할 수 있습니다. (정상 종료는 `0`)

## 원격 서버 배포 (SFTP)

로컬 배포 폴더를 만드는 것에 더해, SSH/SFTP로 원격 서버에 직접 업로드할 수도 있습니다.

### 설정 파일 만들기

프로젝트에 있는 `svncutter.deploy.example.json`을 복사해서 실제 값을 채운 설정 파일을 만드세요 (파일명/위치는 자유).

```json
{
  "host": "192.168.0.10",
  "port": 22,
  "username": "deploy",
  "remotePath": "/home/tomcat/webapps/somtg",
  "privateKeyPath": "C:\\Users\\me\\.ssh\\id_rsa"
}
```

- `host`, `username`, `remotePath` 는 필수
- `port` 생략 시 기본값 22
- `privateKeyPath` 를 지정하면 SSH 개인키로 인증 (패스프레이즈 없는 키만 지원)
- `privateKeyPath` 를 생략하면 실행할 때마다 비밀번호를 화면에 노출하지 않고 입력받음 (저장되지 않음)
- **이 설정 파일에는 서버 정보/키 경로가 들어있으니 커밋하거나 공유하지 마세요.** 채팅이나 이슈 등에도 붙여넣지 않는 것을 권장합니다.

### 실행

```
svncutter --wc D:\svn\somtg --target D:\deploy\somtg --deploy-config D:\svn\somtg.deploy.json
```

1. 기존과 동일하게 로컬 배포 폴더를 먼저 생성
2. 업로드/삭제될 파일 목록과 대상 서버 정보를 보여줌
3. `y` 로 확인해야 실제로 진행 (다른 입력은 모두 취소로 처리, 원격 서버에는 아무 변화도 없음)
4. 확인 후에만 인증 정보를 입력받아 접속
5. 업로드할 파일이 원격에 이미 있으면 **덮어쓰기 전에** 원격 서버의 `<remotePath>/_backup/<날짜시각>/` 폴더로 기존 파일을 먼저 복사
6. 삭제 대상 파일도 같은 방식으로 백업 후 원격에서 삭제
7. 결과는 로컬 `result.txt`에 이어서 기록됨 (업로드/삭제 성공 수, 백업 위치, 오류 목록)

### 주의

- SFTP 계정에 대상 경로에 대한 읽기/쓰기 권한이 필요합니다.
- 문제가 생겨 되돌려야 할 경우, 원격 백업 폴더(`_backup/날짜시각/`)에서 파일을 원래 위치로 다시 옮기면 됩니다.
- 실제 운영 서버에 적용하기 전에, 테스트용/스테이징 경로로 한 번 실행해서 결과를 확인해 보는 것을 권장합니다.

## 주의 사항

- 실행 전에 반드시 최신 소스로 **빌드를 먼저** 해두어야 java class가 정상적으로 수집됩니다.
- `--deploy-config` 없이 로컬 배포 폴더만 만든 경우, `deleted-list.txt`에 있는 항목은 자동으로 삭제되지 않으니 서버 배포 시 수동으로 삭제해야 합니다. (`--deploy-config`를 쓰면 원격 삭제까지 자동 처리됩니다.)
- inner class는 소스가 남아있는 경우(add/modified)에만 자동으로 전부 수집됩니다. 소스 자체가 삭제된 경우에는 `deleted-list.txt`에 대표 class 이름만 기록되며, 관련 inner class가 더 있을 수 있다는 안내 문구가 함께 표시됩니다.
