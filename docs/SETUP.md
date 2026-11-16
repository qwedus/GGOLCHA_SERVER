# 서버 새로 만들기 (AWS)

자기 AWS 계정에 서버를 만들고, 무료 도메인을 붙이고, 3기 백업을 복원하는 전체 절차다. 위에서부터 순서대로 하면 된다.

| 단계 | 할 일 | 걸리는 곳 |
|---|---|---|
| 0 | 레포 포크 | GitHub 웹 |
| 1 | AWS 계정 만들기 | AWS 웹 |
| 2 | 서버(EC2) 만들기 | AWS 웹 |
| 3 | 도메인 발급 (DuckDNS) | DuckDNS 웹 |
| 4 | 서버에 프로그램 설치 | 서버 터미널 |
| 5 | 코드 받기 + 백업 복원 | 서버 터미널 |
| 6 | 도메인 적용 | 서버, 레포, ESP32 |
| 7 | 서버 실행 + 확인 | 서버 터미널, 웹 |
| 8 | 자동 배포 연결 | GitHub 웹 |

백업 파일 없이 처음부터 만드는 경우는 [부록 A](#부록-a-백업-없이-처음부터-만들기), 내 PC에서 띄우는 경우는 [부록 B](#부록-b-로컬-pc에서-띄우기)를 본다.

---

## 0. 레포 포크

이전 기수의 레포를 내 GitHub 계정으로 복사한다. 이후 코드 수정과 자동 배포는 **내 포크**에서 한다.

1. 이전 기수 레포 페이지 → 오른쪽 위 **Fork** → Owner를 내 계정(또는 팀 조직)으로 → **Create fork**
2. 레포 이름은 바꾸지 않는다 (`GGOLCHA_SERVER`)

> 포크한 레포는 원본처럼 **공개**다. 비밀번호·키는 커밋하지 않는다.

## 1. AWS 계정 만들기

1. https://aws.amazon.com → **AWS 계정 생성** (이메일, 카드 등록 필요)
2. 로그인 후 오른쪽 위 계정 이름 → **보안 자격 증명** → **MFA 할당** → 휴대폰 인증 앱(Google Authenticator 등)으로 등록. 루트 계정은 MFA가 필수다.
3. 오른쪽 위 리전을 **아시아 태평양(서울)** 으로 바꾼다. 이후 모든 작업은 서울 리전에서 한다.
4. 계정 이름 → **결제 및 비용 관리** → **Budgets** → 월 예산 알림을 만들어 둔다 (예: 월 20달러 넘으면 메일).

> 팀 공용 이메일로 계정을 만들면 다음 기수에게 넘기기 쉽다.

## 2. 서버(EC2) 만들기

### 2-1. 인스턴스 생성

검색창에 **EC2** → **인스턴스 시작**

| 항목 | 값 |
|---|---|
| 이름 | `ggolcha-server` |
| OS 이미지 | **Ubuntu Server 24.04 LTS** |
| 인스턴스 유형 | **t3.small** (메모리 2GB). t3.micro(1GB)는 웹 빌드 중 메모리가 부족할 수 있다 |
| 키 페어 | **새 키 페어 생성** → 이름 입력 → RSA, `.pem` → 생성. `.pem` 파일이 다운로드된다. **잃어버리면 다시 받을 수 없으니** 팀 드라이브에 보관한다 |
| 네트워크 설정 | **편집** → 보안 그룹 생성 → 아래 2-2의 규칙 추가 |
| 스토리지 | **20GiB**, gp3 |

**인스턴스 시작** 클릭

### 2-2. 포트 열기 (보안 그룹 인바운드 규칙)

| 유형 | 포트 | 소스 | 용도 |
|---|---|---|---|
| SSH | 22 | 0.0.0.0/0 (Anywhere) | 접속, GitHub 자동 배포 |
| HTTP | 80 | 0.0.0.0/0 | 웹 |
| HTTPS | 443 | 0.0.0.0/0 | 웹 |
| 사용자 지정 TCP | 1883 | 0.0.0.0/0 | 차량 ESP32 → MQTT |

> SSH를 "내 IP"로 막으면 GitHub 자동 배포가 접속하지 못한다. SSH는 키 파일 없이는 들어올 수 없으므로 Anywhere로 둔다.

인스턴스를 만든 뒤에 바꾸려면: 인스턴스 선택 → **보안** 탭 → 보안 그룹 클릭 → **인바운드 규칙 편집**

### 2-3. IP 고정 (탄력적 IP)

서버를 껐다 켜도 IP가 바뀌지 않게 한다.

왼쪽 메뉴 **탄력적 IP** → **탄력적 IP 주소 할당** → 할당 → 만들어진 IP 선택 → 작업 → **탄력적 IP 주소 연결** → 2-1의 인스턴스 선택 → 연결

이 IP를 적어둔다. 3장(도메인)에서 쓴다.

### 2-4. 서버 접속

인스턴스 선택 → **연결** → **EC2 Instance Connect** 탭 → 사용자 이름 `ubuntu` → **연결**

검은 터미널 창이 열리면 성공이다. 4장부터는 이 창에서 명령을 실행한다.

## 3. 도메인 발급 (DuckDNS)

`이름.duckdns.org` 형태의 무료 도메인을 만든다. 웹과 ESP32는 IP 대신 이 주소로 서버에 접속한다.

1. https://www.duckdns.org 접속 → 위쪽에서 **Google**(또는 GitHub)로 로그인
   > 개인 계정으로 만들면 그 사람만 관리할 수 있다. **팀 공용 Google 계정**을 쓴다.
2. **sub domain** 칸에 원하는 이름 입력 (예: `ggolcha4`) → **add domain**
3. 아래 목록에 생긴 도메인의 **current ip** 칸에 2-3의 탄력적 IP 입력 → **update ip**
4. 확인: PC PowerShell에서
   ```powershell
   nslookup ggolcha4.duckdns.org
   ```
   `Address:` 에 탄력적 IP가 나오면 성공이다. 바로 안 나오면 몇 분 뒤 다시 확인한다.

> 3기 주소 `ggolcha.duckdns.org` 는 3기 담당자 개인 계정에 묶여 있어 쓸 수 없다.

## 4. 서버에 프로그램 설치

서버 터미널(2-4)에서 한 줄씩 실행한다.

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# Node.js (웹 빌드용)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**터미널 창을 닫고 2-4대로 다시 접속한다** (docker 권한 적용). 그다음:

```bash
docker network create traefik
docker --version && node --version        # 버전이 나오면 성공
```

t3.micro를 골랐다면 메모리 부족을 막기 위해 스왑을 추가한다.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. 코드 받기 + 백업 복원

### 5-1. 코드 받기

```bash
git clone https://github.com/내GitHub아이디/GGOLCHA_SERVER.git ~/GGOLCHA_SERVER
```

> 0장에서 만든 **내 포크** 주소로 받는다. 폴더 이름은 꼭 `~/GGOLCHA_SERVER` 여야 한다. 자동 배포가 이 경로를 쓴다.

### 5-2. 백업 파일 올리기

팀 드라이브에서 `ggolcha-backup.tgz` 를 PC로 받은 뒤, **PC PowerShell**에서:

```powershell
cd 백업파일이_있는_폴더
scp -i "2-1에서받은키.pem" ggolcha-backup.tgz ubuntu@탄력적IP:~/
```

Windows에서 `UNPROTECTED PRIVATE KEY FILE` 오류가 나면 키 파일 권한을 줄이고 다시 실행한다.

```powershell
icacls "키이름.pem" /inheritance:r
icacls "키이름.pem" /grant:r "$($env:USERNAME):(R)"
```

### 5-3. 복원

서버 터미널에서:

```bash
cd ~/GGOLCHA_SERVER/server
sudo tar xzf ~/ggolcha-backup.tgz
ls -a                                 # .env, _data 가 보이면 성공
```

3기의 주행 기록(InfluxDB), 키(`.env`), MQTT 계정(`config/mosquitto.passwd`)이 그대로 들어온다.

## 6. 도메인 적용

3장에서 만든 새 주소를 아래 **5곳**에 넣는다. 예시는 새 주소가 `ggolcha4.duckdns.org` 인 경우다.

| # | 위치 | 바꿀 것 | 바꾼 뒤 |
|---|---|---|---|
| 1 | 서버 `~/GGOLCHA_SERVER/server/.env` | `DOMAIN_NAME=ggolcha4.duckdns.org`<br>`ACME_EMAIL=담당자이메일` | 7장에서 실행하면 HTTPS 인증서가 자동 발급됨 |
| 2 | 내 포크 `web/src/service/mqtt.js` 41번째 줄 | `'ggolcha.duckdns.org'` → `'ggolcha4.duckdns.org'` | 커밋·push (웹을 처음 여는 사람의 기본 주소) |
| 3 | ESP32 스케치 상단 | `const char* MQTT_HOST = "ggolcha4.duckdns.org";` | 차량 ESP32에 다시 업로드 (6-2) |
| 4 | 내 포크의 GitHub Secret `EC2_HOST` | `ggolcha4.duckdns.org` | 8장에서 등록 |
| 5 | 이미 웹을 써 본 브라우저 | 웹 → Device Configuration → **Address** 를 새 주소로 저장 | 브라우저에 예전 주소가 저장돼 있어서 2번만으로는 안 바뀐다 |

`.env` 의 **키 값**(`INFLUX_TOKEN`, `HONEYCAR_MQTT_KEY`, `ADMIN_MQTT_KEY`)은 **바꾸지 않는다.** 3기 DB와 ESP32 코드가 이 값에 맞춰져 있다.

### 6-1. `.env` 수정 (서버 터미널)

```bash
cd ~/GGOLCHA_SERVER/server
nano .env
```

`DOMAIN_NAME`, `ACME_EMAIL` 줄을 고치고 `Ctrl+O` → Enter → `Ctrl+X` 로 저장·종료한다.

### 6-2. ESP32 다시 업로드 (PC)

1. **Arduino IDE 2** 설치
2. 파일 → 기본 설정 → "추가 보드 관리자 URL"에 아래 주소 입력
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. 왼쪽 **보드 매니저** → `esp32` 검색 → **esp32 by Espressif Systems** 설치
4. 왼쪽 **라이브러리 매니저** → `PubSubClient` 검색 → **PubSubClient by Nick O'Leary** 설치
5. ESP32 스케치 열기 → `MQTT_HOST` 수정
   - `MQTT_USER`(`honeycar`)와 `MQTT_PASS` 는 `.env` 의 `HONEYCAR_MQTT_KEY` 와 같아야 한다. 백업을 복원했다면 그대로 둔다.
6. ESP32를 USB로 연결 → 위쪽에서 보드(**ESP32 Dev Module** 등 차량 ESP32에 맞는 것)와 포트 선택 → **업로드(→)**

## 7. 서버 실행 + 확인

서버 터미널에서:

```bash
cd ~/GGOLCHA_SERVER/web && npm install && npm run build
cd ../server && docker compose up -d --build
docker compose ps                     # 모든 컨테이너가 running 이면 성공
```

1~2분 뒤 확인한다.

- [ ] `https://ggolcha4.duckdns.org` 가 열린다 (자물쇠 표시 = 인증서 정상)
- [ ] Device Configuration → **Address** 새 주소, **Name** `honeycar`, **Key** 뷰어 키(`.env` 의 `HONEYCAR_MQTT_KEY`) 저장 → Server가 Online
- [ ] **Data Viewer** 에 3기 세션 목록이 보이고, 하나 열면 차트가 그려진다 (백업 복원 확인)
- [ ] 차량 전원 → ESP32가 핫스팟(2.4GHz)에 연결 → **Live Telemetry** 에 값이 들어온다

안 되면 [OPERATIONS.md](OPERATIONS.md) 6장(문제 해결)을 본다.

## 8. 자동 배포 연결

내 포크의 `main` 브랜치에 push하면 서버에 자동 반영되게 한다.

1. 내 포크 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

   | Name | Secret |
   |---|---|
   | `EC2_HOST` | 새 도메인 (예: `ggolcha4.duckdns.org`) |
   | `EC2_SSH_KEY` | 2-1에서 받은 `.pem` 파일을 메모장으로 열어 **내용 전체** 복사 |

2. 내 포크 → **Actions** 탭 → **I understand my workflows, go ahead and enable them** 클릭 (포크는 처음에 Actions가 꺼져 있다) → 왼쪽 **Deploy to Seoul Server** 가 꺼져 있으면 **Enable workflow**
3. 확인: 6장 2번(`mqtt.js` 주소 수정)을 커밋·push → Actions 탭에서 초록색 체크 → 웹에 반영됐는지 확인

> 배포 중 `git pull` 이 실패해도 초록색으로 표시될 수 있다. 실패가 의심되면 Actions 실행 로그에서 `fatal` 이 있는지 본다.

---

## 부록 A. 백업 없이 처음부터 만들기

5-2, 5-3 대신 아래를 한다. 주행 기록은 비어 있는 상태로 시작한다.

### `.env` 작성

```bash
cd ~/GGOLCHA_SERVER/server
cp .env.example .env
nano .env
```

| 변수 | 의미 | 예 |
|---|---|---|
| `ACME_EMAIL` | HTTPS 인증서 발급용 이메일 | 담당자 이메일 |
| `DOMAIN_NAME` | 서버 도메인 | `ggolcha4.duckdns.org` |
| `ANNOUNCEMENT` | 웹 상단 공지. 비워두면 표시 안 함 | |
| `INFLUX_PASSWORD` | InfluxDB 관리자 비밀번호 (8자 이상) | |
| `INFLUX_TOKEN` | InfluxDB API 토큰 | `openssl rand -hex 32` 결과 |
| `HONEYCAR_MQTT_KEY` | **뷰어 키**. ESP32의 `MQTT_PASS` 와 같게 | |
| `ADMIN_MQTT_KEY` | **관리자 키**. 웹에서 설정 변경할 때 입력 | |

> `INFLUX_PASSWORD`, `INFLUX_TOKEN` 은 InfluxDB를 **처음 띄울 때만** 적용된다.

### MQTT 계정 만들기

`.env` 의 두 키와 **같은 비밀번호**로 만든다.

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

이후 6장부터 같다.

## 부록 B. 로컬 PC에서 띄우기

비용 없이 개발·시험할 때 쓴다. 도메인과 HTTPS 없이 같은 네트워크에서만 접속된다.

1. **설치**: Docker Desktop, Node.js 22 LTS, Git
2. 레포 clone → `server/` 에서 백업 복원(5-3과 같은 `tar xzf`) 또는 부록 A
3. `docker network create traefik`
4. `server/docker-compose.override.yml` 을 새로 만든다.
   ```yaml
   services:
     nginx:
       ports:
         - "7000:7000"
   ```
5. `web/src/service/mqtt.js` 의 `mqtt.connect({...})` 에서 `protocol: 'wss'` → `'ws'`, `port: 443` → `7000`
   (이 수정은 **커밋하지 않는다.** 클라우드 배포가 깨진다.)
6. 실행 (traefik 제외)
   ```bash
   cd web && npm install && npm run build
   cd ../server
   docker compose up -d --build init-log mosquitto mqtt-proxy nginx file-cleanup influxdb mqtt_logger
   ```
7. `http://localhost:7000` → Device Configuration에서 Address `localhost`, Name `honeycar`, Key 저장
8. ESP32: PC와 같은 핫스팟(2.4GHz)에 연결, `MQTT_HOST` 를 PC IP(`ipconfig` 의 IPv4)로 바꿔 업로드, Windows 방화벽에서 1883 포트 허용
