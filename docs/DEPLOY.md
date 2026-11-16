# 서버 올리는 법

두 가지 방법이 있다.

| | 클라우드 (AWS EC2) | 로컬 PC |
|---|---|---|
| 용도 | 실제 운영 (현재 방식) | 비용 없이 개발·시험 |
| 접속 | 어디서나 `https://도메인` | 같은 네트워크에서 `http://PC_IP:7000` |
| 비용 | 서버 시간 + 디스크 | 없음 |
| 검증 | 현재 운영 중 | ⚠️ 코드 기준으로 정리한 절차. 실제 실행 검증 전 |

두 방법 모두 **공통 준비**(`.env` 작성, MQTT 계정 생성)를 거친다.

---

## 공통 준비

### 1. 레포 받기

```bash
git clone https://github.com/qwedus/GGOLCHA_SERVER.git ~/GGOLCHA_SERVER
cd ~/GGOLCHA_SERVER/server
```

> 클라우드는 폴더 이름이 꼭 `~/GGOLCHA_SERVER` 여야 한다. 자동 배포 스크립트가 이 경로를 쓴다.

### 2. `.env` 작성

```bash
cp .env.example .env
nano .env
```

| 변수 | 의미 | 예 |
|---|---|---|
| `ACME_EMAIL` | HTTPS 인증서 발급용 이메일 | 담당자 이메일 |
| `DOMAIN_NAME` | 서버 도메인 | `ggolcha.duckdns.org` |
| `ANNOUNCEMENT` | 웹 상단 공지. 비워두면 표시 안 함 | |
| `INFLUX_PASSWORD` | InfluxDB 관리자 비밀번호 (8자 이상) | |
| `INFLUX_TOKEN` | InfluxDB API 토큰. 긴 무작위 문자열 | `openssl rand -hex 32` 결과 |
| `HONEYCAR_MQTT_KEY` | **뷰어 키**. ESP32 코드의 `MQTT_PASS` 와 같아야 한다 | |
| `ADMIN_MQTT_KEY` | **관리자 키**. 웹에서 설정 변경할 때 입력 | |

> `INFLUX_PASSWORD`, `INFLUX_TOKEN` 은 InfluxDB를 **처음 띄울 때만** 적용된다. 나중에 바꾸려면 `_data/influxdb` 를 지우고 다시 만들어야 한다(저장된 데이터도 지워짐).

### 3. MQTT 계정 만들기

`.env` 의 두 키와 **같은 비밀번호**로 계정 2개를 만든다. 비밀번호 자리를 실제 값으로 바꿔 실행한다.

```bash
docker run --rm -v "$PWD/config:/mosquitto/config" eclipse-mosquitto:2.1.2-alpine \
  mosquitto_passwd -b -c /mosquitto/config/mosquitto.passwd honeycar 뷰어키
docker run --rm -v "$PWD/config:/mosquitto/config" eclipse-mosquitto:2.1.2-alpine \
  mosquitto_passwd -b /mosquitto/config/mosquitto.passwd honeycar-admin 관리자키
```

| 계정 | 쓰는 곳 | 권한 (`config/mosquitto.acl`) |
|---|---|---|
| `honeycar` | ESP32, MQTT Logger, 웹 뷰어 | 읽기 + 일부 명령 |
| `honeycar-admin` | 웹 관리자 모드 | 전체 쓰기 |

> `-c` 는 파일을 새로 만든다. 두 번째 계정에는 붙이지 않는다.
> `.env` 와 `mosquitto.passwd` 는 git에 올라가지 않는다. 따로 백업한다.

---

## A. 클라우드 (AWS EC2)

1. **인스턴스 만들기**: EC2 → 인스턴스 시작 → Ubuntu → 키 페어 새로 만들기(`.pem` 다운로드, 잃어버리면 SSH 불가) → 저장소 20GB 이상
2. **포트 열기**: 보안 그룹 인바운드 규칙에 `22`(SSH), `80`, `443`(웹), `1883`(ESP32) 추가
3. **IP 고정**: 탄력적 IP 할당 → 인스턴스에 연결 (안 하면 재시작마다 IP가 바뀜)
4. **도메인 연결**: duckdns.org 로그인 → 도메인 IP를 서버 공인 IP로 설정
5. **서버 준비**: [OPERATIONS.md](OPERATIONS.md) 3장대로 접속한 뒤
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu          # 실행 후 접속을 끊고 다시 접속
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs          # 웹 빌드용 (Node 20.19 이상 필요)
   docker network create traefik
   ```
6. **공통 준비** 1~3 실행
7. **첫 실행**
   ```bash
   cd ~/GGOLCHA_SERVER/web && npm install && npm run build
   cd ../server && docker compose up -d --build
   ```
8. **확인**: 1~2분 뒤 `https://도메인` 접속 → Device Configuration에 Name `honeycar`, Key(뷰어 키) 저장
9. **자동 배포 연결**: GitHub 레포 Settings → Secrets and variables → Actions에 등록
   - `EC2_HOST`: 도메인 또는 탄력적 IP
   - `EC2_SSH_KEY`: `.pem` 파일 내용 전체

   이후 `main` 에 push하면 자동 배포된다.

---

## B. 로컬 PC

> ⚠️ 코드를 보고 정리한 절차다. 실제로 실행해 본 뒤 이 문서를 고쳐 주세요.

로컬에는 도메인과 HTTPS 인증서가 없어서, traefik을 빼고 nginx 포트(7000)를 직접 연다.

1. **설치**: Docker Desktop, Node.js 22 LTS, Git
2. **공통 준비** 1~3 실행 (`DOMAIN_NAME`, `ACME_EMAIL` 은 아무 값)
3. **네트워크 만들기**: `docker network create traefik`
4. **nginx 포트 열기**: `server/docker-compose.override.yml` 을 새로 만든다.
   ```yaml
   services:
     nginx:
       ports:
         - "7000:7000"
   ```
5. **웹 접속 방식 변경**: `web/src/service/mqtt.js` 의 `mqtt.connect({...})` 에서
   - `protocol: 'wss'` → `protocol: 'ws'`
   - `port: 443` → `port: 7000`

   이 수정은 **커밋하지 않는다** (클라우드 배포가 깨진다).
6. **실행** (traefik 제외)
   ```bash
   cd web && npm install && npm run build
   cd ../server
   docker compose up -d --build init-log mosquitto mqtt-proxy nginx file-cleanup influxdb mqtt_logger
   ```
7. **웹 접속**: `http://localhost:7000` → Device Configuration에서 Address를 `localhost`, Name `honeycar`, Key(뷰어 키) 저장
8. **ESP32 연결**
   - PC와 ESP32를 **같은 핫스팟(2.4GHz)** 에 연결
   - ESP32 코드의 `MQTT_HOST` 를 PC의 IP로 바꿔 업로드 (Windows: `ipconfig` 의 IPv4 주소)
   - Windows 방화벽에서 `1883` 포트 인바운드 허용
