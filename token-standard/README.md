# CIP-0056 토큰 실습

[Splice의 TestTokenV1](https://github.com/canton-network/splice/blob/17c6a5957eb2f193d9f7fa8f5283bbac5e30d9a1/token-standard/examples/splice-test-token-v1/daml/Splice/Testing/Tokens/TestTokenV1.daml)과 표준 인터페이스를 로컬 Canton에서 실행한다. [CIP-0056 개발자 문서](https://docs.canton.network/overview/reference/cip-0056)

## 실행

저장소 루트에서 `.\Start-CantonPlatform.ps1 -Prepare`로 로컬 네트워크와 계정을 준비한 뒤 실행한다.

```powershell
.\Run-CantonTokenStandard.ps1 -Prepare
```

첫 실행은 고정한 Git 커밋을 `.token-standard/`에 받아 빌드한다. 이 과정에는 수 분이 걸릴 수 있다. 이후 `.\Run-CantonTokenStandard.ps1`은 이미 빌드한 DAR를 사용한다. 각 실행에서 고유한 모의 종목 ID를 사용한다.

## 검증 흐름

1. 발행기관 Party를 Registry 관리자와 초기 보유자로 두고 Splice 테스트 토큰 125개를 생성한다. 발행기관 Participant의 Ledger API에서 표준 `Holding`으로 125개를 읽는다. 상대 기관 조회에서는 이 종목의 계약이 0개인지 확인한다.
2. 공식 `TransferFactory_Transfer`로 50개 이전을 제안한다. 송신 측 명령이 끝나더라도 수신 Participant의 조회 반영은 늦을 수 있으므로, 해당 제안이 수신 측의 활성 계약으로 조회된 뒤 `TransferInstruction_Accept`를 실행한다.
3. 표준 `Holding`을 다시 조회해 발행기관 소유 75개와 상대 기관 소유 50개를 확인한다. 콘솔에 종목 ID, 각 보유량, 수신 계약 ID를 출력한다.

이 실습의 Registry는 Splice의 테스트 패키지다. 스크립트가 로컬에서 발행 권한을 행사하고 TransferFactory 계약 ID를 사용한다. 별도 Registry HTTP 서비스와 범용 지갑 검색은 후속 연동 범위다. [업무 플랫폼](../platform/README.md)에서도 같은 Splice 테스트 토큰을 사용한다. 이미 승인한 종목을 처음 이전하거나 매도할 때 표준 토큰으로 전환하며, 동시결제에는 표준 Allocation 인터페이스를 호출한다.

**실행 확인 · 2026-11-23.** Windows에서 Splice 인터페이스와 테스트 토큰 DAR를 Canton SDK 3.7.3으로 빌드했다. 두 Participant에 배포한 뒤 표준 인터페이스로 발행 125개, 이전 50개, 최종 보유량 75개와 50개를 확인했다.
