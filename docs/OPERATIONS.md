# 서버 운영

서버가 돌고 있는 동안의 운영 방법이다. 서버를 처음 만들거나 다음 기수에게 넘길 때는 [HANDOVER.md](HANDOVER.md) 를 본다.

## 1. 계정·접속 정보

> 현재 담당자가 채운다. 이 레포는 **공개 저장소**이므로 비밀번호·키는 쓰지 말고 **보관 위치**만 적는다.

| 항목 | 값 |
|---|---|
| AWS 루트 계정 | [이메일] / 비밀번호·MFA 보관 위치: [ ] |
| 서버 주소 | [ ].duckdns.org |
| 리전 | 아시아 태평양(서울) `ap-northeast-2` |
| 인스턴스 유형 | [ ] |
| 키 페어 | [이름] / `.pem` 보관 위치: [ ] |
| 탄력적 IP | [있음 / 없음] |
| DuckDNS | 로그인 계정: [ ] |
| 서버의 `.env`, `mosquitto.passwd` | 서버 `~/GGOLCHA_SERVER/server/` 에만 있음 (git에 없음). 백업 위치: [ ] |
| 웹 뷰어 키 / 관리자 키 | 보관 위치: [ ] |

AWS 루트 계정은 MFA가 필수다. MFA 기기를 잃어버리면 로그인 화면의 "MFA 문제 해결" → **대체 인증 요소로 로그인**(가입 이메일 + 등록된 전화번호)으로 복구한다.

## 2. 서버 끄고 켜기

대회·테스트 기간이 아니면 비용을 아끼기 위해 서버를 중지해 둔다. 중지해도 데이터(InfluxDB, `.env`, MQTT 계정)는 디스크에 남는다. 디스크 비용은 중지 중에도 조금씩 나간다.

### 끄기

EC2 → 인스턴스 → 서버 선택 → **인스턴스 상태 → 인스턴스 중지**

> ⚠️ **인스턴스 종료(Terminate)** 는 서버와 디스크가 영구 삭제된다. 절대 누르지 않는다.

### 켜기

1. EC2 → 인스턴스 → 서버 선택 → **인스턴스 상태 → 인스턴스 시작**
2. 상세 화면에서 **퍼블릭 IPv4 주소** 확인. 탄력적 IP가 없으면 켤 때마다 바뀐다.
3. IP가 바뀌었으면
   - duckdns.org 로그인 → `ggolcha` 항목의 IP를 새 주소로 변경
   - GitHub 레포 Settings → Secrets and variables → Actions → `EC2_HOST` 가 IP면 새 주소로 변경
4. 2~3분 뒤 `https://서버주소` 접속 확인
5. 사이트가 안 뜨면 서버에 접속해서 컨테이너를 올린다.
   ```bash
   cd ~/GGOLCHA_SERVER/server && docker compose up -d
   ```

### 서버가 꺼져 있을 때

- 웹 접속, 차량 텔레메트리 수신, 자동 배포가 모두 안 된다.
- 차량 데이터는 Teensy SD 카드에만 기록된다.
- 꺼져 있는 동안 main에 push했다면, 켠 뒤 서버에서 `cd ~/GGOLCHA_SERVER && git pull` 후 배포 명령([DEPLOY.md](DEPLOY.md) 5단계)을 다시 실행한다.

## 3. 서버 접속

**브라우저(추천)**: EC2 → 인스턴스 → 서버 선택 → **연결** → EC2 Instance Connect 탭 → 사용자 이름 `ubuntu` → 연결

**내 PC 터미널**: 키 페어의 `.pem` 파일이 있어야 한다.

```powershell
ssh -i "키이름.pem" ubuntu@서버주소
```

Windows에서 `UNPROTECTED PRIVATE KEY FILE` 오류가 나면 키 파일 권한을 줄인다.

```powershell
icacls "키이름.pem" /inheritance:r
icacls "키이름.pem" /grant:r "$($env:USERNAME):(R)"
```

`Permission denied (publickey)` 가 나면 키 파일이 이 서버 것이 아니다. 인스턴스 상세의 키 페어 이름과 파일 이름을 확인한다.

## 4. 백업

대회 후나 담당자가 바뀔 때 백업 파일을 만들어 팀 드라이브에 보관한다. 절차는 [HANDOVER.md](HANDOVER.md) 2-1~2-3과 같다.

## 5. 자동 배포

`main` 브랜치에서 `server/` 또는 `web/` 아래 파일이 바뀌면 GitHub Actions(`.github/workflows/deploy.yml`)가 서버에 접속해 아래를 실행한다.

1. `git pull` 2. 웹 빌드 3. 컨테이너 재빌드·재시작 4. mosquitto 설정이 바뀌었으면 mosquitto 재시작

필요한 GitHub Secrets: `EC2_HOST`(서버 주소), `EC2_SSH_KEY`(`.pem` 파일 내용 전체)

> 배포 중 `git pull` 이 실패해도 워크플로는 성공으로 표시된다. 배포 후 사이트에 변경이 반영됐는지 직접 확인한다.
> main 히스토리를 강제로 바꾼 뒤에는(`push --force`) 서버의 `git pull` 이 실패한다. 서버에서 한 번 실행한다.
> ```bash
> cd ~/GGOLCHA_SERVER && git fetch origin main && git reset --hard origin/main
> ```

## 6. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 사이트가 안 열림 | 인스턴스가 실행 중인지 → DuckDNS IP가 현재 공인 IP와 같은지 → 서버에서 `docker compose ps` |
| 웹은 열리는데 "Authentication Failed" | Device Configuration의 Name(`honeycar`)과 Key가 맞는지 |
| 웹에 Device가 Offline | 차량 전원, ESP32 WiFi 연결(핫스팟은 2.4GHz), ESP32의 `MQTT_HOST`·`MQTT_PASS` |
| ESP32 WiFi를 바꿔야 함 | 휴대폰으로 `GGOLCHA-XXXXXX` WiFi에 접속 → 뜨는 창(또는 `http://192.168.4.1`)에서 새 SSID·비밀번호 입력. 운영 중이면 웹 Device Configuration의 "WiFi 변경" 사용 |
| 데이터가 Data Viewer에 저장되지 않음 | 서버에서 `docker compose logs -f mqtt_logger` |
| HTTPS 인증서 오류 | `docker compose logs traefik`. 80·443 포트가 열려 있고 도메인이 서버 IP를 가리켜야 발급된다. |

컨테이너 로그는 모두 `~/GGOLCHA_SERVER/server` 에서 `docker compose logs <서비스명>` 으로 본다.
