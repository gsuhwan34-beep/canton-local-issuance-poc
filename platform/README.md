# Canton 사설망 업무 플랫폼

보고서 그림 2-1의 업무 화면, 업무 처리 프로그램, 업무 DB, 사설 Canton을 구현한 시연 구성이다. 기존 IOU 데모와 같은 전용 Synchronizer 및 Participant 두 개에 발행 승인 패키지를 추가했다.

![Canton 사설망 업무 플랫폼 구성도](architecture.png)

## 거래가 처리되는 순서

1. **발행 요청** · `issuer-demo`로 Keycloak에 로그인한다. 업무 백엔드는 업무 DB에서 로그인과 Party의 연결을 찾아 발행기관 Participant에 `IssuanceRequest` 생성을 제출한다. 승인기관에 대기 계약이 보인다.
2. **승인** · 별도 브라우저 세션에서 `approver-demo`로 로그인해 승인한다. 백엔드는 승인기관 Participant로 명령을 제출하고, Daml의 `Approve`가 승인 Party의 권한을 확인한다. 한 거래에서 대기 계약을 소비하고 `IssuedHolding` 계약을 만든다.
3. **결과 조회** · PQS가 각 Participant의 Ledger API에서 권한 범위 안의 이벤트를 읽어 기관별 PostgreSQL DB에 적재한다. 업무 화면은 백엔드를 통해 해당 DB를 조회한다. DSRV Lens에서도 동일 계약 ID를 확인할 수 있다.

## 구성 요소와 재사용 코드

- **사설망** · Canton OSS `3.7.3`, Participant 두 개, Sequencer와 Mediator, 노드별 H2 저장소. [공식 simple-topology 예제](https://github.com/digital-asset/canton/tree/v3.7.3/community/app/src/pack/examples/01-simple-topology)
- **인증과 업무 앱** · Keycloak을 기존 Quickstart의 역할에 맞춰 로컬에 배치했다. Quickstart의 확인 모달과 명령 ID 유틸을 재사용했다. 발행 화면과 Ledger API 백엔드는 이 PoC에서 작성했다. [Quickstart 고정 버전](https://github.com/digital-asset/cn-quickstart/tree/374f2d6e04f66ab919a2fab27401834235ccecd9) · [재사용 소스 및 라이선스](src/upstream)
- **조회 DB** · 공식 PQS `3.6.2`의 배포 JAR를 사용한다. Quickstart의 기관별 PQS 분리 패턴을 Windows 로컬 실행에 적용했다. 발행기관의 `pqs_issuer`, 승인기관의 `pqs_broker`와 별개로, 연결 정보를 담는 `poc_workflow`를 만든다. 승인 상태는 Daml 계약에 기록한다. [Quickstart의 PQS 설정](https://github.com/digital-asset/cn-quickstart/blob/374f2d6e04f66ab919a2fab27401834235ccecd9/quickstart/docker/modules/pqs/compose.yaml) · [PQS 공식 소스](https://github.com/digital-asset/participant-query-store)
- **업무 규칙** · [Issuance.daml](model/daml/Issuance.daml)의 `IssuanceRequest`와 `IssuedHolding`. 승인자 선택과 계정·Party 매핑은 [provision.mjs](provision.mjs)에서 확인할 수 있다.

## 실행

Windows x64, JDK 21, Node.js 22.18 이상, Git, PowerShell이 필요하다. 저장소 루트에서 실행한다.

```powershell
# 설치·빌드 및 시작
.\Start-CantonPlatform.ps1 -Prepare
# 설치 후 다시 시작
.\Start-CantonPlatform.ps1
```

- [업무 화면](http://127.0.0.1:18090/) · [발행기관 Lens](http://127.0.0.1:5173/#/contracts?template=Issuance%3AIssuedHolding) · [승인기관 Lens](http://127.0.0.1:5174/#/contracts?template=Issuance%3AIssuedHolding)
- 로컬 시연용 계정은 `%LOCALAPPDATA%\CantonPrivatePoc\runtime\platform-demo-accounts.json`에 생성된다. 계정이 다른 점을 보려면 각각 별도 브라우저 프로필 또는 일반 창과 InPrivate 창에서 연다.

## 2026-11-23 확인 기록

**확인됨 · 직접 실행.** Windows에서 발행기관 로그인, 수량 125개 발행 요청, 발행기관의 승인 시도 HTTP 403, 승인기관 로그인과 승인, 두 PQS 조회 DB 및 두 DSRV Lens에서 최종 계약 ID 일치까지 확인했다. PostgreSQL을 종료하고 시작 스크립트를 다시 실행한 뒤 두 계정의 화면에서 같은 계약을 재조회했다. 다른 PC의 최초 설치와 통합 플랫폼 전체의 재부팅 복구는 미검증이다.

**작성자 해석 · PoC 설계.** 화면에서 승인자가 실행하는 작업은 현재 백엔드와 Daml로 처리한다. Temporal과 Chainlink CRE, 외부 서명 및 타 시스템 대사는 후속 통합 범위다. 데모는 loopback 주소로 실행한다.
