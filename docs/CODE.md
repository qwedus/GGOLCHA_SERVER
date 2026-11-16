# 코드 구조

## 1. 어디에 무엇이 있나

| 위치 | 언어 | 역할 |
|---|---|---|
| Rear STM32 `Core/Src/telemetry.c` (별도 프로젝트) | C | 센서값으로 24바이트 프레임 3종을 만들어 100ms마다 UART 송신 |
| ESP32 스케치 (별도) | C++ (Arduino) | 프레임 검증 → MQTT 발행, Teensy로 전달, WiFi 설정·복구 |
| `server/mqtt_logger/index.js` | JavaScript | MQTT 구독 → 파싱 → InfluxDB 저장, 세션 조회 API(:8080) |
| `server/mqtt_logger/protocol.js` | JavaScript | 24바이트 프레임 파서 (**웹의 `protocol.js` 와 같은 파일**) |
| `server/config/` | 설정 | `mosquitto.acl`(계정 권한), `nginx.conf`(경로), `mqtt-proxy.cfg` |
| `server/docker-compose.yml` | 설정 | traefik, nginx, mosquitto, mqtt-proxy, influxdb, mqtt_logger |
| `web/src/service/` | JavaScript | `mqtt.js`(실시간 수신), `protocol.js`, `telemetry.js`(차트 데이터), `sessions.js`(세션 API), `admin.js`(관리자 모드), `state.js`, `ui.js`(채널 이름·단위) |
| `web/src/views/` | Vue | `telemetry.vue`(실시간), `viewer.vue`(저장된 세션), `device.vue`(설정), `ui.vue`(화면 설정) |
| `.github/workflows/deploy.yml` | YAML | main push 시 EC2 자동 배포 |

> `device/firmware/` 는 오픈소스(Monolith v2)의 ESP32 펌웨어로, 실제 차량에서는 쓰지 않는다. 실제 ESP32 코드는 Arduino 스케치다.

## 2. 데이터 흐름

```
STM32 ──UART 115200──> ESP32 ──MQTT 1883──> Mosquitto ──┬──> MQTT Logger ──> InfluxDB
 100ms마다              체크섬 확인                       │        ↑
 VEHICLE·GPS·GYRO       시각을 ESP 기준으로 재작성         │   /api/sessions
                        └─UART─> Teensy SD                └──> 웹(WebSocket, 실시간)
```

### 24바이트 프레임 (little endian)

| 바이트 | 0 | 1 | 2-3 | 4-7 | 8-23 |
|---|---|---|---|---|---|
| 내용 | `0xAE` | 타입 | 체크섬 | 시각(ms) | 타입별 데이터 |

타입: `3` GPS, `6` GYROSCOPE, `9` VEHICLE. 각 필드의 위치·스케일은 `protocol.js` 의 `FIELD_SCHEMA` 에 있다.

체크섬: 2-3번을 0으로 두고 24바이트를 4바이트씩 XOR → 상위 16비트 + 하위 16비트.

### MQTT 토픽 (`{장치명}` = `honeycar`)

| 토픽 | 보내는 쪽 | 내용 |
|---|---|---|
| `{장치명}/d/boot` | ESP32 | 부팅 시각(UTC 초, 4B). 연결이 끊기면 브로커가 `OFFLINE` 발행 |
| `{장치명}/d` | ESP32, 100ms | 104B 묶음: 시각(4) + 상태 비트(4) + GPS 프레임(24) + GYRO 프레임(24) + 빈 칸(48) |
| `{장치명}/d/vh` | ESP32, 100ms | VEHICLE 프레임(24B) |
| `{장치명}/cfg/wifi` | 웹(관리자) | `"SSID,비밀번호"` 원격 WiFi 변경 |

상태 비트는 **켜져 있으면 이상**이다. 비트 번호 = `web/src/service/state.js` 의 `state` 배열 순서 (3 SD, 4 WIFI, 5 MQTT, 6 CAN, 7 GPS, 8 Steering, 10 GYRO).

## 3. 저장 형태 (InfluxDB)

- bucket `telemetry`, org `ggolcha`
- measurement: `gps`, `gyro`, `vehicle` (+ 오픈소스에서 쓰던 `analog`, `digital`, `can`, `event`)
- 태그: `device`(장치명), `session`(부팅 시각, 초)
- 시각: `session × 1000 + 프레임의 ms`
- 필드: `FIELD_SCHEMA` 의 `name` 그대로, 스케일 변환이 끝난 값
- `session_meta`: 웹에서 세션을 숨기거나(`hidden`) 이름을 바꾼(`name`) 기록. 원래 데이터는 지우지 않는다.

`d/boot` 를 받기 전에 들어온 프레임은 세션을 알 수 없어 저장하지 않는다.

## 4. 센서 필드를 추가할 때

예: VEHICLE에 모터 온도를 추가. **4곳을 같이 고쳐야 한다.**

1. **STM32** `telemetry.c` 의 `Log_BuildVehicle()` — 비어 있는 바이트(22-23)에 값을 쓴다. 위치·스케일을 정한다.
2. **ESP32** — VEHICLE은 그대로 전달하므로 수정 없음. **새 타입**을 만들면 `handleFrame()` 에 `case` 를 추가하고 발행 토픽을 정한다.
3. **`protocol.js` 두 벌** (`web/src/service/`, `server/mqtt_logger/`) — `FIELD_SCHEMA.VEHICLE` 에 `{ name, offset, bits, signed, transform }` 한 줄 추가. **두 파일을 똑같이** 고친다.
4. **웹 화면**
   - `web/src/service/ui.js` 의 `views.vehicle.ch` 에 채널 이름·단위 추가
   - `web/src/service/telemetry.js` 의 `update_vehicle()` 과 `telemetry.vehicle` 배열 개수에 추가
   - 저장된 세션 화면(`viewer.vue`)은 `views.vehicle.ch` 를 따라가서 보통 수정이 필요 없다

서버(MQTT Logger)는 `FIELD_SCHEMA` 에 있는 필드를 자동으로 저장하므로 수정할 필요가 없다. **새 타입**이면 `index.js` 의 `TYPE_MAP` 과 구독 토픽 처리(`switch (subtopic)`)에 추가한다.

## 5. 알아둘 것

- MQTT(1883)는 암호화되지 않는다. 키는 공개 저장소·카페에 올리지 않는다.
- WiFi가 끊긴 동안의 데이터는 서버에 남지 않는다. Teensy SD 카드에서 확인한다.
- ESP32가 MQTT에 다시 연결될 때마다 `d/boot` 를 새로 보내서, 주행 중 끊기면 세션이 둘로 나뉜다.
- ESP32 설정용 AP(`GGOLCHA-XXXXXX`)는 비밀번호가 없다. 브라우저에서 `http://192.168.4.1` 로도 들어갈 수 있다.
