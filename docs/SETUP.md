# 서버 준비하기

텔레메트리를 쓰려면 서버가 하나 있어야 한다. 아래 두 방법 중 **하나를 골라** 그 장만 따라 하면 된다.

| | 경로 1. AWS 서버 | 경로 2. 내 PC (로컬) |
|---|---|---|
| 이럴 때 | **활동 기간 동안 언제 어디서든** 접속해서 보고 싶다 | AWS가 어렵거나 막혔다. 테스트 때만 잠깐 쓰면 된다 |
| 접속 | 어디서나 `https://주소` | PC와 **같은 핫스팟**에 연결된 기기에서만 |
| 서버 켜두기 | AWS가 24시간 켜둠 | 주행·테스트 동안 **PC를 켜두고** 핫스팟에 연결 |
| 비용 | 새로 가입한 계정은 **프리 티어로 최대 6개월 무료** (아래 1-1). 이후 월 요금 | 없음 |
| 준비 | AWS 계정, 도메인 | Docker Desktop |
| 바로가기 | [경로 1](#경로-1-aws-서버) | [경로 2](#경로-2-내-pc-로컬) |

두 경로 모두 [0. 레포 포크](#0-공통-레포-포크) 를 먼저 하고, 마지막에 [ESP32 코드 업로드](#esp32-코드-업로드-공통) 를 한다.

> ⚠️ **경로 1(AWS)을 고른 경우: 대회가 끝나면 인수인계 기간에 반드시 백업 후 인스턴스를 종료한다** ([HANDOVER.md](HANDOVER.md) 1·3장). 켜 둔 채로 두면 아무도 안 쓰는 서버에 요금이 계속 나간다.

3기 주행 기록이 담긴 **백업 파일**(`ggolcha-backup.tgz`)을 복원하는 것을 기준으로 쓴다. 백업 없이 새로 시작하면 [부록 A](#부록-a-백업-없이-처음부터-만들기) 를 본다.

---

## 0. 공통: 레포 포크

이전 기수의 레포를 내 GitHub 계정으로 복사한다. 이후 코드 수정은 **내 포크**에서 한다.

1. 이전 기수 레포 페이지 → 오른쪽 위 **Fork** → Owner를 내 계정(또는 팀 조직)으로 → **Create fork**
2. 레포 이름은 바꾸지 않는다 (`GGOLCHA_SERVER`)

> 포크한 레포도 **공개**다. 비밀번호·키는 커밋하지 않는다.

---

## 경로 1. AWS 서버

| 단계 | 할 일 |
|---|---|
| 1-1 | AWS 계정 만들기 |
| 1-2 | 서버(EC2) 만들기 |
| 1-3 | 도메인 발급 (DuckDNS) |
| 1-4 | 내 포크에 도메인 반영 |
| 1-5 | 서버에 프로그램 설치 |
| 1-6 | 코드 받기 + 백업 복원 |
| 1-7 | 서버 실행 + 확인 |

### 1-1. AWS 계정 만들기

1. https://aws.amazon.com → **AWS 계정 생성** (이메일, 카드 등록 필요)
2. 로그인 후 오른쪽 위 계정 이름 → **보안 자격 증명** → **MFA 할당** → 휴대폰 인증 앱(Google Authenticator 등)으로 등록. 루트 계정은 MFA가 필수다.
3. 오른쪽 위 리전을 **아시아 태평양(서울)** 으로 바꾼다. 이후 모든 작업은 서울 리전에서 한다.
4. 계정 이름 → **결제 및 비용 관리** → **Budgets** → 월 예산 알림을 만들어 둔다 (예: 월 20달러 넘으면 메일).

> 팀 공용 이메일로 계정을 만들면 다음 기수에게 넘기기 쉽다.

**프리 티어 (2025-07-15 이후 새로 가입한 계정)**

- 가입할 때 **Free plan** 을 고르면 크레딧(최대 200달러) 안에서 **최대 6개월 무료**로 쓸 수 있다. 1-2에서 권장하는 `t3.small` 도 무료 대상이다.
- 6개월이 지나거나 크레딧을 다 쓰면 **계정이 자동으로 닫히고 서버와 데이터에 접근할 수 없게 된다.** 만료 전에 AWS에서 메일과 콘솔 알림이 온다.
- 6개월 넘게 쓸 거면 만료 전에 콘솔에서 **Paid plan 으로 업그레이드**하거나, [HANDOVER.md](HANDOVER.md) 1장대로 **백업부터** 받아 둔다.
- 업그레이드 후에는 남은 크레딧을 먼저 쓰고, 다 쓰면 요금이 청구된다.
- 정확한 조건은 가입 시점에 [AWS 프리 티어 안내](https://aws.amazon.com/free/) 에서 확인한다.

### 1-2. 서버(EC2) 만들기

**인스턴스 생성**: 검색창에 **EC2** → **인스턴스 시작**

| 항목 | 값 |
|---|---|
| 이름 | `ggolcha-server` |
| OS 이미지 | **Ubuntu Server 24.04 LTS** |
| 인스턴스 유형 | **t3.small** (메모리 2GB). t3.micro(1GB)는 웹 빌드 중 메모리가 부족할 수 있다 |
| 키 페어 | **새 키 페어 생성** → 이름 입력 → RSA, `.pem` → 생성. `.pem` 파일이 다운로드된다. **잃어버리면 다시 받을 수 없으니** 팀 드라이브에 보관한다 |
| 네트워크 설정 | **편집** → 보안 그룹 생성 → 아래 포트 규칙 추가 |
| 스토리지 | **20GiB**, gp3 |

| 유형 | 포트 | 소스 | 용도 |
|---|---|---|---|
| SSH | 22 | 내 IP | 서버 접속 |
| HTTP | 80 | 0.0.0.0/0 | 웹 |
| HTTPS | 443 | 0.0.0.0/0 | 웹 |
| 사용자 지정 TCP | 1883 | 0.0.0.0/0 | 차량 ESP32 → MQTT |

**인스턴스 시작** 클릭

**IP 고정 (탄력적 IP)**: 서버를 껐다 켜도 IP가 바뀌지 않게 한다.
왼쪽 메뉴 **탄력적 IP** → **탄력적 IP 주소 할당** → 할당 → 만들어진 IP 선택 → 작업 → **탄력적 IP 주소 연결** → 방금 만든 인스턴스 선택 → 연결.
이 IP를 적어둔다.

**서버 접속**: 인스턴스 선택 → **연결** → **EC2 Instance Connect** 탭 → 사용자 이름 `ubuntu` → **연결**.
검은 터미널 창이 열리면 성공이다. 이후 "서버 터미널"은 이 창을 말한다.

> 포트 규칙을 나중에 바꾸려면: 인스턴스 선택 → **보안** 탭 → 보안 그룹 클릭 → **인바운드 규칙 편집**

### 1-3. 도메인 발급 (DuckDNS)

`이름.duckdns.org` 형태의 무료 도메인을 만든다. 웹과 ESP32는 IP 대신 이 주소로 서버에 접속한다.

1. https://www.duckdns.org 접속 → 위쪽에서 **Google**(또는 GitHub)로 로그인
   > 개인 계정으로 만들면 그 사람만 관리할 수 있다. **팀 공용 Google 계정**을 쓴다.
2. **sub domain** 칸에 원하는 이름 입력 (예: `ggolcha4`) → **add domain**
3. 아래 목록에 생긴 도메인의 **current ip** 칸에 탄력적 IP 입력 → **update ip**
4. 확인: PC PowerShell에서 `nslookup ggolcha4.duckdns.org` → `Address:` 에 탄력적 IP가 나오면 성공. 바로 안 나오면 몇 분 뒤 다시 확인한다.

> 3기 주소 `ggolcha.duckdns.org` 는 3기 담당자 개인 계정에 묶여 있어 쓸 수 없다.

**새 주소를 넣는 곳** (아래 단계에서 차례로 한다. 예시 주소는 `ggolcha4.duckdns.org`)

| 위치 | 바꿀 것 | 하는 단계 |
|---|---|---|
| 내 포크 `web/src/service/mqtt.js` | 웹의 기본 서버 주소 | 1-4 |
| 서버 `server/.env` | `DOMAIN_NAME` (HTTPS 인증서가 이 주소로 발급됨) | 1-6 |
| ESP32 스케치 | `MQTT_HOST` | [ESP32 코드 업로드](#esp32-코드-업로드-공통) |
| 이미 웹을 써 본 브라우저 | Device Configuration의 **Address** | 1-7 |

### 1-4. 내 포크에 도메인 반영

GitHub 웹에서 내 포크 → `web/src/service/mqtt.js` → 연필 아이콘(편집) → 41번째 줄 근처

```js
localStorage.setItem('server/addr', 'ggolcha.duckdns.org');
```

의 주소를 새 주소(`ggolcha4.duckdns.org`)로 바꾸고 → **Commit changes**

### 1-5. 서버에 프로그램 설치

서버 터미널에서 한 줄씩 실행한다.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**터미널 창을 닫고 다시 접속한다** (docker 권한 적용). 그다음:

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

### 1-6. 코드 받기 + 백업 복원

**코드 받기** (서버 터미널, 내 포크 주소로):

```bash
git clone https://github.com/내GitHub아이디/GGOLCHA_SERVER.git ~/GGOLCHA_SERVER
```

**백업 파일 올리기** (PC PowerShell): 팀 드라이브에서 `ggolcha-backup.tgz` 를 PC로 받은 뒤

```powershell
cd 백업파일이_있는_폴더
scp -i "1-2에서받은키.pem" ggolcha-backup.tgz ubuntu@탄력적IP:~/
```

`UNPROTECTED PRIVATE KEY FILE` 오류가 나면 키 파일 권한을 줄이고 다시 실행한다.

```powershell
icacls "키이름.pem" /inheritance:r
icacls "키이름.pem" /grant:r "$($env:USERNAME):(R)"
```

**복원 + 도메인 설정** (서버 터미널):

```bash
cd ~/GGOLCHA_SERVER/server
sudo tar xzf ~/ggolcha-backup.tgz
nano .env
```

`DOMAIN_NAME=ggolcha4.duckdns.org`, `ACME_EMAIL=담당자이메일` 로 고치고 `Ctrl+O` → Enter → `Ctrl+X` 로 저장·종료한다.

> `.env` 의 **키 값**(`INFLUX_TOKEN`, `HONEYCAR_MQTT_KEY`, `ADMIN_MQTT_KEY`)은 **바꾸지 않는다.** 3기 DB와 ESP32 코드가 이 값에 맞춰져 있다.

### 1-7. 서버 실행 + 확인

```bash
cd ~/GGOLCHA_SERVER/web && npm install && npm run build
cd ../server && docker compose up -d --build
docker compose ps                     # 모든 컨테이너가 running 이면 성공
```

1~2분 뒤 확인한다.

- [ ] `https://ggolcha4.duckdns.org` 가 열린다 (자물쇠 표시 = 인증서 정상)
- [ ] Device Configuration → **Address** 새 주소, **Name** `honeycar`, **Key** 뷰어 키(`.env` 의 `HONEYCAR_MQTT_KEY`) 저장 → Server가 Online
- [ ] **Data Viewer** 에 3기 세션 목록이 보이고, 하나 열면 차트가 그려진다

이제 [ESP32 코드 업로드](#esp32-코드-업로드-공통) 로 넘어간다. 서버 끄고 켜기는 [OPERATIONS.md](OPERATIONS.md) 를 본다.

**코드를 고친 뒤 서버에 반영하기**: 내 포크에서 수정·커밋한 다음 서버 터미널에서

```bash
cd ~/GGOLCHA_SERVER && git pull
cd web && npm install && npm run build
cd ../server && docker compose up -d --build
```

---

## 경로 2. 내 PC (로컬)

PC가 서버 역할을 한다. 차량 ESP32와 PC를 **같은 휴대폰 핫스팟**에 연결해서 쓴다.

> 주행·테스트 중에는 PC를 켜두고 핫스팟에 연결해 둬야 한다. 데이터는 PC에 저장된다.

| 단계 | 할 일 |
|---|---|
| 2-1 | 프로그램 설치 |
| 2-2 | 코드 받기 + 백업 복원 |
| 2-3 | 로컬용 설정 |
| 2-4 | 실행 + 확인 |
| 2-5 | 핫스팟 연결과 방화벽 |

### 2-1. 프로그램 설치 (Windows 기준)

| 프로그램 | 설치 |
|---|---|
| Docker Desktop | https://www.docker.com/products/docker-desktop → 설치 중 **WSL 2 사용** 체크 → 설치 후 재부팅 → Docker Desktop 실행 |
| Node.js 22 LTS | https://nodejs.org → LTS 다운로드 |
| Git | https://git-scm.com → 기본값으로 설치 |

PowerShell에서 확인: `docker --version`, `node --version`, `git --version` 이 모두 나오면 성공.

### 2-2. 코드 받기 + 백업 복원

```powershell
cd $env:USERPROFILE
git clone https://github.com/내GitHub아이디/GGOLCHA_SERVER.git
cd GGOLCHA_SERVER\server
tar -xzf 백업파일경로\ggolcha-backup.tgz
dir -Force                            # .env, _data 가 보이면 성공
```

### 2-3. 로컬용 설정

**1) 네트워크 만들기**

```powershell
docker network create traefik
```

**2) 포트 열기 파일 만들기**: `server` 폴더에 `docker-compose.override.yml` 파일을 새로 만들고 아래 내용을 넣는다 (메모장으로 만들 때 확장자가 `.txt` 가 되지 않게 주의).

```yaml
services:
  nginx:
    ports:
      - "7000:7000"
```

**3) 웹 접속 방식 바꾸기**: `web\src\service\mqtt.js` 를 메모장으로 열어 `mqtt.connect({` 부분에서

- `protocol: 'wss'` → `protocol: 'ws'`
- `port: 443` → `port: 7000`

로 바꾸고 저장한다.

> 2)·3)은 로컬 전용 설정이다. 나중에 경로 1(AWS)로 옮길 때는 되돌려야 하니 내 포크에 커밋하지 않는다.

### 2-4. 실행 + 확인

```powershell
cd $env:USERPROFILE\GGOLCHA_SERVER\web
npm install
npm run build
cd ..\server
docker compose up -d --build init-log mosquitto mqtt-proxy nginx file-cleanup influxdb mqtt_logger
docker compose ps                     # 7개 컨테이너가 running 이면 성공
```

> `traefik` 은 도메인·HTTPS용이라 로컬에서는 띄우지 않는다.

- [ ] 브라우저에서 `http://localhost:7000` 이 열린다
- [ ] Device Configuration → **Address** `localhost`, **Name** `honeycar`, **Key** 뷰어 키(`.env` 의 `HONEYCAR_MQTT_KEY`) 저장 → Server가 Online
- [ ] **Data Viewer** 에 3기 세션 목록이 보이고, 하나 열면 차트가 그려진다

다음부터는 Docker Desktop만 켜면 컨테이너가 자동으로 다시 뜬다.

### 2-5. 핫스팟 연결과 방화벽

1. 휴대폰 핫스팟을 켠다. **2.4GHz** 여야 한다 (아이폰은 "호환성 최대화" 켜기).
2. PC를 핫스팟에 연결 → PowerShell에서 `ipconfig` → **Wi-Fi 어댑터의 IPv4 주소** 확인 (예: `172.20.10.2`). 이 주소를 ESP32의 `MQTT_HOST` 에 넣는다.
3. **관리자 권한** PowerShell에서 방화벽 열기 (한 번만):
   ```powershell
   New-NetFirewallRule -DisplayName "GGOLCHA MQTT" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow
   New-NetFirewallRule -DisplayName "GGOLCHA Web" -Direction Inbound -Protocol TCP -LocalPort 7000 -Action Allow
   ```
4. 같은 핫스팟에 연결한 휴대폰에서도 `http://PC의IPv4주소:7000` 으로 볼 수 있다 (Address도 그 주소로 저장).

> 핫스팟에 다시 연결하면 PC의 IP가 바뀔 수 있다. 차량 데이터가 안 들어오면 `ipconfig` 로 IP가 그대로인지 먼저 확인한다. 바뀌었으면 ESP32의 `MQTT_HOST` 를 고쳐 다시 업로드한다.

이제 [ESP32 코드 업로드](#esp32-코드-업로드-공통) 로 넘어간다.

---

## ESP32 코드 업로드 (공통)

서버 주소가 바뀌면 차량 ESP32 코드의 `MQTT_HOST` 를 고쳐 다시 업로드해야 한다.

| 경로 | `MQTT_HOST` 에 넣을 값 |
|---|---|
| 1. AWS | 새 도메인 (예: `ggolcha4.duckdns.org`) |
| 2. 로컬 | PC의 IPv4 주소 (예: `172.20.10.2`) |

1. **Arduino IDE 2** 설치 (https://www.arduino.cc/en/software)
2. 파일 → 기본 설정 → "추가 보드 관리자 URL"에 입력
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. 왼쪽 **보드 매니저** → `esp32` 검색 → **esp32 by Espressif Systems** 설치
4. 왼쪽 **라이브러리 매니저** → `PubSubClient` 검색 → **PubSubClient by Nick O'Leary** 설치
5. ESP32 스케치 열기 → 상단의 `const char* MQTT_HOST = "...";` 수정
   - `MQTT_USER`(`honeycar`)와 `MQTT_PASS` 는 `.env` 의 `HONEYCAR_MQTT_KEY` 와 같아야 한다. 백업을 복원했다면 그대로 둔다.
6. ESP32를 USB로 연결 → 위쪽에서 보드(**ESP32 Dev Module** 등 차량 ESP32에 맞는 것)와 포트 선택 → **업로드(→)**

**확인**: 차량 전원을 켜고 ESP32가 핫스팟에 연결되면, 웹 **Live Telemetry** 에 값이 들어온다.

ESP32가 연결할 WiFi(핫스팟)를 바꾸려면: 휴대폰으로 `GGOLCHA-XXXXXX` WiFi에 접속 → 자동으로 뜨는 창(안 뜨면 `http://192.168.4.1`)에서 핫스팟 이름·비밀번호 입력.

---

## 부록 A. 백업 없이 처음부터 만들기

백업 복원(1-6 또는 2-2의 `tar`) 대신 아래를 한다. 주행 기록은 비어 있는 상태로 시작한다. 명령은 `server` 폴더에서 실행한다.

**`.env` 작성**: `.env.example` 을 복사해 `.env` 로 만들고 값을 채운다.

| 변수 | 의미 | 예 |
|---|---|---|
| `ACME_EMAIL` | HTTPS 인증서 발급용 이메일 (로컬은 아무 값) | 담당자 이메일 |
| `DOMAIN_NAME` | 서버 도메인 (로컬은 아무 값) | `ggolcha4.duckdns.org` |
| `ANNOUNCEMENT` | 웹 상단 공지. 비워두면 표시 안 함 | |
| `INFLUX_PASSWORD` | InfluxDB 관리자 비밀번호 (8자 이상) | |
| `INFLUX_TOKEN` | InfluxDB API 토큰. 긴 무작위 문자열 | |
| `HONEYCAR_MQTT_KEY` | **뷰어 키**. ESP32의 `MQTT_PASS` 와 같게 | |
| `ADMIN_MQTT_KEY` | **관리자 키**. 웹에서 설정 변경할 때 입력 | |

> `INFLUX_PASSWORD`, `INFLUX_TOKEN` 은 InfluxDB를 **처음 띄울 때만** 적용된다.

**MQTT 계정 만들기**: `.env` 의 두 키와 **같은 비밀번호**로 만든다. (Windows PowerShell은 `"$PWD/config:/mosquitto/config"` 대신 `"${PWD}\config:/mosquitto/config"` 로 쓰고, 줄 끝의 `\` 를 빼고 한 줄로 입력한다.)

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

---

## 부록 B. 자동 배포 (개발용, 경로 1 전용)

서버 코드를 자주 고칠 때만 설정한다. 내 포크의 `main` 에 push하면 서버에 자동으로 반영된다 (`.github/workflows/deploy.yml`). 설정하지 않으면 1-7의 "코드를 고친 뒤 서버에 반영하기"를 손으로 하면 된다.

1. 보안 그룹의 SSH(22) 소스를 **0.0.0.0/0** 으로 바꾼다. GitHub가 매번 다른 IP에서 접속하기 때문이다 (키 파일 없이는 들어올 수 없다).
2. 내 포크 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

   | Name | Secret |
   |---|---|
   | `EC2_HOST` | 새 도메인 (예: `ggolcha4.duckdns.org`) |
   | `EC2_SSH_KEY` | 1-2에서 받은 `.pem` 파일을 메모장으로 열어 **내용 전체** 복사 |

3. 내 포크 → **Actions** 탭 → **I understand my workflows, go ahead and enable them** (포크는 처음에 Actions가 꺼져 있다) → 왼쪽 **Deploy to Seoul Server** 가 꺼져 있으면 **Enable workflow**
4. 확인: `web/` 아래 파일을 아무거나 고쳐 커밋 → Actions 탭에 초록색 체크 → 웹에 반영됐는지 확인

> 배포 중 `git pull` 이 실패해도 초록색으로 표시될 수 있다. 반영이 안 됐으면 Actions 실행 로그에서 `fatal` 을 찾는다.
