# GGOLCHA 텔레메트리 인수인계

차량 센서 데이터를 서버에 실시간으로 저장하고 웹에서 보는 시스템이다.

```
센서 → Rear STM32 →(UART)→ ESP32 →(WiFi·MQTT)→ 클라우드 서버 → 웹 대시보드
                              └→(UART)→ Teensy 4.1 SD 카드 백업
```

> **현재 상태 (2026-11)**: 3기 서버는 요금 정리를 위해 종료했다. 주행 기록은 백업 파일로 보관 중이다.
> 다음 기수는 [SETUP.md](SETUP.md) 에서 **AWS 서버** 또는 **내 PC** 중 하나를 골라 서버를 만들고 백업을 복원한다.

## 1. 필요한 것

### 넘겨받는 것

| 항목 | 용도 | 보관 위치 |
|---|---|---|
| 이 GitHub 레포 | 서버·웹 코드, 문서 | 자기 계정으로 **포크**해서 사용 ([SETUP.md](SETUP.md) 0장) |
| 백업 파일 `ggolcha-backup.tgz` | 3기 주행 기록 + 모든 키(.env) + MQTT 계정 | [팀 드라이브 경로] |
| ESP32 스케치 (Arduino) | 차량 ESP32 코드. 비밀번호가 들어 있어 레포에 없음 | [ ] |
| Rear STM32 프로젝트 `Rear_STM_CAN_TX` | 센서값을 모아 ESP32로 송신 | [ ] |
| Teensy 4.1 코드 | SD 카드 기록 | [ ] |

### 직접 만드는 것

| 항목 | 용도 | 비고 |
|---|---|---|
| AWS 계정 | 서버 (AWS를 고른 경우) | 팀 공용 이메일로 만들면 다음 인수인계가 쉽다 |
| DuckDNS 주소 | 무료 도메인 (AWS를 고른 경우) | 팀 공용 Google 계정으로 로그인 |
| GitHub 계정 | 레포 관리, 자동 배포 | |

### 설치할 프로그램

- **Arduino IDE 2**: ESP32 코드 수정·업로드 (도메인을 바꾸면 꼭 필요)
- STM32CubeIDE: STM32 코드를 고칠 때만
- Git: 레포를 PC에 받을 때
- Docker Desktop, Node.js: 내 PC를 서버로 쓸 때

## 2. 읽는 순서

| 순서 | 문서 | 내용 |
|---|---|---|
| 1 | [SETUP.md](SETUP.md) | **서버 준비**: AWS 서버 또는 내 PC 중 골라서 → 백업 복원 → ESP32 주소 변경 |
| 2 | [OPERATIONS.md](OPERATIONS.md) | 서버 끄고 켜기, 접속, 백업, 문제 해결 |
| 3 | [CODE.md](CODE.md) | 코드 구조, 데이터 흐름, 센서 필드 추가 방법 |
| - | [HANDOVER.md](HANDOVER.md) | 기수가 바뀔 때 넘기는 쪽이 할 일 |

이 시스템은 오픈소스 [luftaquila/monolith](https://github.com/luftaquila/monolith) (Monolith v2)를 기반으로 만들었다.
