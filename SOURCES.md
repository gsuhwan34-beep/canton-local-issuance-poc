# 외부 코드와 제품

## 실행에 사용한 구성

- **Canton OSS와 IOU** · Canton 3.7.3의 전용 Synchronizer 및 Participant 구성, 공식 IOU 예제를 사용한다. 재배포한 원본의 Apache-2.0 고지는 [network/LICENSE-Canton](network/LICENSE-Canton)에 있다. [공식 소스](https://github.com/digital-asset/canton/tree/v3.7.3/community/app/src/pack/examples/01-simple-topology)
- **CIP-0056** · Splice의 표준 인터페이스와 TestTokenV1을 고정 커밋에서 받아 빌드한다. 재사용하는 원본 소스의 라이선스는 Apache-2.0이다. 이 저장소에는 실행 순서와 검증 코드를 둔다. [Splice 고정 소스](https://github.com/canton-network/splice/tree/17c6a5957eb2f193d9f7fa8f5283bbac5e30d9a1/token-standard)
- **Digital Asset Quickstart** · 모달과 명령 ID 유틸을 가져오고, Keycloak과 기관별 PQS 구성을 참고했다. 원본 0BSD 고지는 [platform/src/upstream](platform/src/upstream)에 있다. [Quickstart 고정 소스](https://github.com/digital-asset/cn-quickstart/tree/374f2d6e04f66ab919a2fab27401834235ccecd9)
- **DSRV Canton Lens** · 고정 커밋을 받아 두 Participant의 권한 범위 내 계약을 조회한다. Lens는 Apache-2.0으로 제공된다. [Lens 원본과 고지](https://github.com/dsrvlabs/canton-lens)
- **Temporal** · 워크플로 제출, 재시도, 양쪽 PQS 반영 확인을 수행한다. npm 의존성과 CLI 버전은 각각 잠금 파일과 시작 스크립트에 고정돼 있다. [Temporal 개발 문서](https://docs.temporal.io/quickstarts)

## 외부 제품 연결 확인

[외부 서비스 코드 및 실행 기록](integrations/README.md)에 실제 공개 응답, CRE SDK 테스트, 이후 필요한 접근을 적었다.

- **DA Registry** · 운영자·Registrar 온보딩과 종목 설정을 거쳐 발행·이전·소각을 제공하는 제품이다. 현 데모는 공식 Splice 테스트 토큰으로 CIP-0056을 실증한다. [DA Registry 발행 절차](https://docs.digitalasset.com/registry/guides/mint)
- **Chainlink CRE** · 이 저장소의 크론 워크플로는 공식 SDK의 HTTP 기능으로 DA DevNet 종목을 조회한다. SDK 1.23.0 패키지는 BUSL-1.1로 배포된다. [SDK 소스와 이용 조건](https://github.com/smartcontractkit/cre-sdk-typescript/tree/main/packages/cre-sdk) · [워크플로 구성](https://docs.chain.link/cre/reference/project-configuration)
- **Noves** · 공개 Studio와 API는 공개 Canton 활동을 조회한다. 자체 설치하는 Data App은 Participant 데이터를 인덱싱하는 후보이며, 현재 배포 가이드의 Global Synchronizer 식별 조건을 확인해야 한다. [Noves Public Data API](https://docs.noves.fi/reference/welcome-canton-apis) · [Data App 배포 가이드](https://github.com/Noves-Inc/canton-data-app/blob/master/docs/docker-compose.md)
- **Noves MCP** · 선택 설치하는 공식 MCP 서버 0.2.3(MIT)에 클라이언트를 연결해 공개 데이터 도구를 호출한다. [공식 구현과 라이선스](https://github.com/Noves-Inc/canton-mcp)
