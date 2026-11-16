# 인수인계

3기 서버(3기 담당자 AWS 계정)는 요금 정리를 위해 종료했다. 주행 기록과 설정은 **백업 파일** 하나로 남아 있고, 다음 기수가 **자기 AWS 계정**에 서버를 새로 만들어 그 파일을 복원하면 그대로 이어서 쓸 수 있다.

- [1. 넘겨받을 것](#1-넘겨받을-것)
- [2. 3기: 서버 종료 전 할 일](#2-3기-서버-종료-전-할-일)
- [3. 4기: 서버 다시 시작하기](#3-4기-서버-다시-시작하기)
- [4. 동작 확인](#4-동작-확인)

---

## 1. 넘겨받을 것

비밀번호·키는 이 문서(공개 저장소)에 쓰지 않는다. **보관 위치**만 적는다.

| 항목 | 내용 | 보관 위치 |
|---|---|---|
| 백업 파일 `ggolcha-backup.tgz` | 주행 기록 DB, `.env`(모든 키), MQTT 계정 파일 | [팀 드라이브 경로] |
| GitHub 레포 | `qwedus/GGOLCHA_SERVER` (서버·웹 코드, 이 문서) | 3.6 참고 |
| ESP32 스케치 | Arduino 코드 1개. **MQTT 비밀번호가 들어 있어 레포에 없음** | [ ] |
| Rear STM32 프로젝트 | `Rear_STM_CAN_TX` (STM32CubeIDE) | [ ] |
| Teensy 4.1 코드 | SD 카드 기록 | [ ] (3기 기준 위치 미확인) |
| 설계백서 | 3기 종합보고서 "데이터 로깅 서버 구축" 파트 | [ ] |

---

## 2. 3기: 서버 종료 전 할 일

순서대로 한다. **2-3까지 끝내기 전에는 인스턴스를 종료하지 않는다** (종료하면 서버 디스크가 영구 삭제된다).

### 2-1. 서버에서 백업 파일 만들기

AWS 콘솔 → EC2 → 인스턴스 → 서버 선택 → **연결** → EC2 Instance Connect(사용자 `ubuntu`)

```bash
cd ~/GGOLCHA_SERVER/server
docker compose stop influxdb mqtt_logger
sudo tar czf ~/ggolcha-backup.tgz _data/influxdb .env config/mosquitto.passwd
sudo chown ubuntu ~/ggolcha-backup.tgz
ls -lh ~/ggolcha-backup.tgz        # 파일 크기 기억
```

### 2-2. PC로 내려받기

PC에 SSH 키를 만들고 서버에 등록한 뒤 `scp` 로 받는다.

```powershell
# PC PowerShell
ssh-keygen -t ed25519                              # 전부 Enter (이미 있으면 n)
type $env:USERPROFILE\.ssh\id_ed25519.pub          # 출력된 한 줄 복사
```

```bash
# Instance Connect 터미널
echo "복사한 한 줄" >> ~/.ssh/authorized_keys
```

```powershell
# PC PowerShell
cd $env:USERPROFILE\Downloads
scp ubuntu@서버주소:~/ggolcha-backup.tgz .      # 3기: ggolcha.duckdns.org
dir ggolcha-backup.tgz                             # 크기가 2-1과 같으면 성공
```

`Connection timed out` → EC2 → 서버의 **보안 그룹** → 인바운드 규칙에 `SSH / 내 IP` 추가 후 다시 실행.

### 2-3. 백업 파일 보관

`ggolcha-backup.tgz` 를 **팀 공용 비공개 드라이브**에 올리고 1장 표에 경로를 적는다. GitHub·카페에는 올리지 않는다.

### 2-4. AWS 정리 (요금 0원 만들기)

| 순서 | EC2 콘솔 위치 | 할 일 |
|---|---|---|
| 1 | 인스턴스 | 서버 선택 → 인스턴스 상태 → **인스턴스 종료** |
| 2 | 볼륨 | 상태가 "사용 가능"인 볼륨이 남아 있으면 삭제 |
| 3 | 탄력적 IP | 남아 있으면 **릴리스** (연결 안 된 IP도 요금 발생) |
| 4 | 스냅샷, AMI | 남아 있으면 삭제 (AMI는 등록 취소 → 스냅샷 삭제) |
| 5 | 다른 리전 | 리전을 **스톡홀름**으로 바꿔 1~4 반복 (이전 서버). 왼쪽 위 **EC2 Global View** 로 모든 리전 확인 |
| 6 | 결제 및 비용 관리 | 다음 달 청구서에 남은 항목이 없는지 확인. **Budgets** 에 월 1달러 알림을 만들어 두면 안전 |

보안 그룹, 키 페어는 요금이 없다.

### 2-5. GitHub 자동 배포 끄기

레포 → Actions → **Deploy to Seoul Server** → `...` → **Disable workflow**
(서버가 없는데 켜 두면 `server/`, `web/` 을 고칠 때마다 배포가 실패한다.)

### 2-6. 1장 표 채우기

보관 위치 칸을 모두 채우고 이 문서를 커밋한다.

---

## 3. 4기: 서버 다시 시작하기

### 3-1. AWS 계정 준비

AWS 가입 → 루트 계정 **MFA 등록**(필수) → 서울 리전 선택.
> 팀 공용 이메일로 계정을 만들면 다음 인수인계가 쉽다.

### 3-2. 서버 만들기

[DEPLOY.md](DEPLOY.md) **A. 클라우드** 의 1~5단계(인스턴스 생성, 포트, 탄력적 IP, 도메인, Docker·Node 설치)를 진행한다. 도메인은 3-4를 먼저 보고 정한다.

### 3-3. 백업 복원

[DEPLOY.md](DEPLOY.md) **공통 준비 1** 로 레포를 받은 뒤, `.env` 를 새로 쓰는 대신 백업 파일을 푼다.

```bash
# 백업 파일을 서버로 올리기 (PC PowerShell)
scp ggolcha-backup.tgz ubuntu@서버주소:~/

# 서버에서
cd ~/GGOLCHA_SERVER/server
sudo tar xzf ~/ggolcha-backup.tgz
nano .env        # DOMAIN_NAME, ACME_EMAIL 을 새 값으로 수정
```

키(`INFLUX_TOKEN`, `HONEYCAR_MQTT_KEY`, `ADMIN_MQTT_KEY`)는 **바꾸지 않는다.** DB와 ESP32 코드가 이 값에 맞춰져 있다.

이어서 [DEPLOY.md](DEPLOY.md) **A. 클라우드 7~8단계**(첫 실행, 확인)를 진행한다.

### 3-4. 도메인

`ggolcha.duckdns.org` 는 3기 담당자 개인 계정에 묶여 있어 넘길 수 없다. **새 주소를 만든다.**

1. duckdns.org → 팀 공용 Google 계정으로 로그인 (개인 계정이면 다음 인수인계 때 또 바꿔야 함)
2. 새 이름 등록 (예: `ggolcha4`) → **current ip** 에 서버 공인 IP 입력 → update ip
3. 새 주소를 아래 3곳에 반영

| 위치 | 바꿀 것 |
|---|---|
| 서버 `server/.env` | `DOMAIN_NAME=새주소.duckdns.org` |
| ESP32 스케치 | `const char* MQTT_HOST = "새주소.duckdns.org";` → 차량 ESP32에 다시 업로드 |
| `web/src/service/mqtt.js` | `localStorage.setItem('server/addr', '새주소.duckdns.org')` → 커밋 (웹 처음 접속 시 기본 주소) |

### 3-5. ESP32 확인

ESP32 스케치의 `MQTT_USER`(`honeycar`), `MQTT_PASS` 가 백업의 `HONEYCAR_MQTT_KEY` 와 같은지 확인한다. 같으면 3-4의 `MQTT_HOST` 만 바꾸면 된다.

### 3-6. GitHub 레포와 자동 배포

자동 배포에 필요한 Secrets는 **레포 소유자만** 등록할 수 있다. 둘 중 하나를 고른다.

- **레포 이전 (권장)**: 3기 담당자가 레포 Settings → Danger Zone → **Transfer ownership** → 4기 담당자 또는 팀 GitHub 조직으로 이전
- **포크**: 4기 담당자가 레포를 Fork해서 자기 레포로 사용

그다음 레포 Settings → Secrets and variables → Actions 에 등록하고, Actions 탭에서 **Deploy to Seoul Server** 를 다시 Enable 한다.

| Secret | 값 |
|---|---|
| `EC2_HOST` | 새 도메인 또는 탄력적 IP |
| `EC2_SSH_KEY` | 3-2에서 받은 `.pem` 파일 내용 전체 |

---

## 4. 동작 확인

- [ ] `https://새주소` 접속 → Device Configuration에 Address(새 주소), Name `honeycar`, Key(뷰어 키) 저장
- [ ] 상단 Connections의 Server가 Online
- [ ] Data Viewer에 3기 세션 목록이 보이고, 하나 열면 차트가 그려짐 (백업 복원 확인)
- [ ] 차량 전원 → ESP32가 핫스팟(2.4GHz)에 연결 → Device가 Online, Live Telemetry에 값이 들어옴
- [ ] 짧게 주행 후 Data Viewer에 새 세션이 생김
- [ ] `main` 에 `web/` 아래 사소한 수정을 push → Actions의 배포 성공, 사이트에 반영

운영 중 끄고 켜기, 문제 해결은 [OPERATIONS.md](OPERATIONS.md) 를 본다.
