# DA Registry · Chainlink CRE · Noves

이 예제는 공식 공개 서비스로 연결을 점검한다. 기존 Canton 사설망은 별도 실행 경로다.

## 공개 서비스 조회

저장소 루트에서 실행한다.

```powershell
node .\integrations\read-services.mjs
```

- DA Registry의 공식 DevNet에서 운영자 Party ID를 읽고 그 Party가 관리하는 `TestToken`의 ID, 기호, 소수 자릿수를 조회한다. [종목 메타데이터 API 명세](https://github.com/canton-network/splice/blob/17c6a5957eb2f193d9f7fa8f5283bbac5e30d9a1/token-standard/splice-api-token-metadata-v1/openapi/token-metadata-v1.yaml)
- Noves의 공개 Canton Data Studio에 접속할 수 있는지 확인한다. 구조화된 Noves HTTP API의 `/chains`는 Noves API 키가 있어야 호출할 수 있다. [Noves API 문서](https://docs.noves.fi/reference/welcome-canton-apis)

## CRE 워크플로

`cre/main.ts`는 공식 CRE SDK의 Cron 트리거를 등록한다. [워크플로](cre/registry-workflow.ts)는 DA Registry에서 운영자와 테스트 종목의 메타데이터를 순서대로 읽는다. CRE는 노드들이 읽은 식별자와 종목 정보가 일치하는지 집계한다.

```powershell
cd integrations/cre
npm ci
npm test
npm run build
```

테스트는 HTTP 응답을 모의한다. 빌드는 공식 컴파일러로 실행 파일 `dist/registry.wasm`을 만든다. CLI 1.41.0을 설치하고 인증된 시뮬레이션 환경을 갖춘 사용자는 `integrations` 폴더에서 다음 명령으로 Cron 트리거 한 번을 실행한다. 로컬 증권 발행 승인 워커는 Temporal이 담당한다. [CLI 로그인](https://docs.chain.link/cre/guides/cli/cli-login) · [시뮬레이션 준비](https://docs.chain.link/cre/getting-started/part-1-project-setup)

```powershell
cre workflow simulate ./cre --target local --wasm ./cre/dist/registry.wasm --non-interactive --trigger-index 0
```

## Noves 공식 도구

저장소 루트에서 실행한다. 공식 `@noves/canton-mcp`를 로컬 프로세스로 시작하고 MCP로 제공 도구 목록을 읽는다.

```powershell
cd integrations/noves
npm ci
npm run tools
```

Noves 키가 있는 사용자는 이 폴더에서 `npm run configure`로 공식 도구에 키를 설정한 뒤 `npm run balance -- noves.unverified.cns`로 공개 네트워크 Party의 잔액을 조회할 수 있다. 우리 로컬 종목의 계약과 잔액은 각 기관 Lens와 Ledger API에서 조회한다. [Noves 공식 서버와 설정](https://github.com/Noves-Inc/canton-mcp)

## 실제 연동에 필요한 접근

- **DA Registry 발행** · DevNet Registrar 온보딩과 종목 설정이 선행한다. 공개 운영자 조회는 발행 권한을 확인하지 않는다. [Registrar 온보딩](https://docs.digitalasset.com/registry/guides/registrar-onboarding) · [Mint 가이드](https://docs.digitalasset.com/registry/guides/mint)
- **Noves** · 공개 API는 Noves 발급 키가 필요하다. 기관의 비공개 계약 분석에는 별도 Data App 배포와 Participant 연결이 필요하며, 현재 배포 가이드는 Global Synchronizer 식별을 전제로 한다. [Data App 설치 조건](https://github.com/Noves-Inc/canton-data-app/blob/master/docs/docker-compose.md)

**확인됨 · 2026-11-23 · Windows 직접 실행.** DA DevNet 운영자와 `TestToken` 메타데이터(소수 10자리)를 읽었다. CRE SDK 테스트 두 건과 WASM 빌드가 성공했고 CLI 시뮬레이션은 로그인 요구에서 멈췄다. Noves Studio에서 HTTP 200을 받았고, 공식 MCP 0.2.3 프로세스가 도구 9개를 반환했다. Noves 키를 사용한 잔액 조회와 DA Registry를 통한 DevNet 발행은 미검증이다.
