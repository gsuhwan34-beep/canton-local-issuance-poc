# DSRV Canton Lens에서 모의 발행 결과 읽기

**Lens가 읽을 주소는 이 노트북의 Participant에 열린 `http://localhost:7575`다.** 조회하는 사람은 브라우저에서 Lens에 로그인한다. Lens 백엔드가 그 사람의 토큰으로 Participant에 계약을 요청한다. 이 경로는 로컬에서 구성할 수 있다.

**현재 확인 수준** · 2026-11-22 · 직접 실행 및 DSRV 배포 문서 대조. 이 프로젝트에서 모의 발행과 Party별 조회는 Daml 스크립트로 검증했다. 아래는 사용자별 로그인을 붙이는 연동 절차다. 로그인 서버 구성과 Lens 화면에서의 종단 검증은 남아 있다.

## 1. 누가 어떤 계약을 볼지 연결한다

1. OIDC 로그인 서버에 브라우저용 공개 클라이언트를 등록한다. Lens 권장 흐름은 Authorization Code + PKCE(S256)다. 로컬 리디렉션 주소는 `http://localhost:5173/`이고, 브라우저에서 로그인·토큰 발급에 접근할 수 있어야 한다.
2. Participant의 `ledger-api.auth-services`에 로그인 서버의 서명 검증 키(JWKS)와 이 Participant가 받을 토큰의 audience를 설정한다. 예제의 기본 sandbox에는 이 로그인 구성이 들어 있지 않다. 인증을 켠 환경에서 발행 데모를 실행하려면 Party 할당과 각 Party 명령 제출 권한을 가진 데모 실행 계정의 인증도 구성한다. 메모리 sandbox를 재시작하면 Party와 계약을 다시 만든다.
3. 새로 생성한 Alice·Bob의 **전체 Party ID**를 확인한다. Ledger 관리자가 두 로그인 사용자의 토큰 `sub`에 대응하는 Ledger 사용자를 만들고, 각각 자기 Party에만 `CanReadAs` 권한을 준다. 로그인 사용자와 Daml Party는 별개다. 예를 들어 Bob으로 가입했다는 사실만으로 Bob의 계약이 보이지는 않는다.

인증 환경을 구성할 때는 저장소 루트에서 아래처럼 SDK에 설정 파일과 토큰을 전달한다. 두 경로는 운영자가 준비한 파일로 교체한다. 토큰 파일은 저장소 밖에 둔다. 첫 명령이 준비되면 같은 폴더의 다른 터미널에서 두 번째 명령을 실행한다. 두 터미널 모두 아래 환경변수가 필요하다.

```powershell
$env:DPM_HOME = (Resolve-Path .dpm).Path
$env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
$dpm = (Resolve-Path tools/dpm.exe).Path
$dar = (Resolve-Path issuance/.daml/dist/local-mock-issuance-0.0.1.dar).Path
Set-Location issuance
# Terminal 1
& $dpm sandbox --config C:\local-config\ledger-auth.conf --ledger-api-port 6865 --json-api-port 7575 --dar $dar
# Terminal 2
& $dpm script --dar $dar --script-name Main:demo --ledger-host localhost --ledger-port 6865 --user-id demo-runner --access-token-file C:\local-config\demo-runner.jwt
```

확인됨 · 2026-11-22 · SDK 3.7.3 명령 도움말, 인증과 권한 구성 방법. [Canton 공식 개발 문서](https://docs.canton.network/appdev/deep-dives/authorization) · [Ledger 사용자 권한](https://docs.digitalasset.com/operate/3.4/howtos/operate/identity_management.html) · [DSRV 인증 프로필](https://github.com/dsrvlabs/canton-lens/blob/9e4751bd0604ea4ed1778b95c155975c5c100e16/docs/deployment.md#browser-oidc)

## 2. Lens를 노트북에서 띄운다

Node.js 22.18 이상, pnpm 9, Git이 필요하다. 모의 발행 저장소의 상위 폴더에서 다음을 실행해 Lens를 별도 폴더에 설치한다.

```powershell
git clone https://github.com/dsrvlabs/canton-lens.git
cd canton-lens
git checkout 9e4751bd0604ea4ed1778b95c155975c5c100e16
pnpm install --frozen-lockfile
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/frontend/.env.example apps/frontend/.env
```

- **백엔드** · `apps/backend/.env`에서 `LEDGER_AUTH_MODE=caller-bearer`, `LEDGER_BASE=http://localhost:7575`를 사용한다. 백엔드는 `127.0.0.1:7600`에서 실행한다. 이 모드에서는 예제의 `SHARED_IDENTITY_*` 줄을 주석 상태로 둔다.
- **브라우저** · `apps/frontend/.env`에서 `VITE_AUTH_MODE=browser-oidc`를 사용한다. `VITE_OIDC_ISSUER`와 `VITE_OIDC_CLIENT_ID`는 1단계 로그인 서버의 실제 값으로 바꾼다. `VITE_OIDC_REDIRECT_URI=http://localhost:5173/`, `BACKEND_PROXY_TARGET=http://localhost:7600`를 확인한다. 발급자가 audience 파라미터를 요구하면 `VITE_OIDC_AUDIENCE`도 맞춘다.
- **실행** · Lens 폴더에서 PowerShell 창 두 개를 열고 각각 `pnpm dev:backend`와 `pnpm dev:frontend`를 실행한다. 브라우저에서 [로컬 Lens](http://localhost:5173/)를 연다.

확인됨 · 2026-11-22 · DSRV 원본의 실행 명령 및 환경변수. [실행 안내](https://github.com/dsrvlabs/canton-lens/tree/9e4751bd0604ea4ed1778b95c155975c5c100e16) · [백엔드 설정 예제](https://github.com/dsrvlabs/canton-lens/blob/9e4751bd0604ea4ed1778b95c155975c5c100e16/apps/backend/.env.example) · [브라우저 설정 예제](https://github.com/dsrvlabs/canton-lens/blob/9e4751bd0604ea4ed1778b95c155975c5c100e16/apps/frontend/.env.example)

## 3. 발행 결과를 확인한다

**검증할 화면** · 작성자 해석 · 2026-11-22 · [모의 계약](issuance/daml/Main.daml)과 [Lens 계약 조회 화면](https://github.com/dsrvlabs/canton-lens/blob/9e4751bd0604ea4ed1778b95c155975c5c100e16/docs/images/contracts.png) 기준.

1. 발행을 한 번 실행한 원장에서 Alice로 로그인한다. **Contracts**에서 `Main:MockAsset` 계약을 열고 `symbol = DEMO-BOND`, `quantity = 900`을 확인한다. 이 예제의 수량은 커스텀 계약의 필드에 있다.
2. 별도의 브라우저 세션에서 Bob으로 로그인한다. Bob의 100개 계약이 보이고 Alice의 900개 계약은 검색되지 않아야 한다. 다른 Party의 읽기 권한이 함께 부여돼 있으면 권한 설정부터 확인한다.
3. 두 계정 모두 비어 있으면 같은 sandbox에서 데모가 성공했는지, 재시작 전 Party ID에 읽기 권한을 부여했는지 점검한다. 로그인 후 API 요청이 거절되면 먼저 토큰의 issuer·audience·사용자 ID와 Ledger 사용자 권한을 확인한다.
