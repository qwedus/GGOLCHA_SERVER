# GGOLCHA 텔레메트리 인수인계 문서

차량 센서 데이터를 서버에 실시간으로 저장하고 웹에서 보는 시스템이다.

```
센서 → Rear STM32 → (UART) → ESP32 → (MQTT) → EC2 서버(Mosquitto → MQTT Logger → InfluxDB) → 웹 대시보드
                                 └→ (UART) → Teensy 4.1 SD 카드 백업
```

| 문서 | 내용 | 언제 읽나 |
|---|---|---|
| [OPERATIONS.md](OPERATIONS.md) | 계정·접속 정보, 서버 끄고 켜기, 문제 해결 | 서버를 처음 받았을 때, 대회·테스트 전 |
| [DEPLOY.md](DEPLOY.md) | 서버를 새로 올리는 법 (AWS / 로컬 PC) | 서버를 옮기거나 새로 만들 때 |
| [CODE.md](CODE.md) | 코드 구조, 데이터 흐름, 센서 필드 추가 방법 | 코드를 고칠 때 |

- 서버: https://ggolcha.duckdns.org
- 이 시스템은 오픈소스 [luftaquila/monolith](https://github.com/luftaquila/monolith) (Monolith v2)를 기반으로 만들었다.
