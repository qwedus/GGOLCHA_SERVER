# 기수 교체 시 넘기는 쪽이 할 일

담당자가 바뀔 때 **넘기는 사람**이 하는 절차다. 받는 사람은 [SETUP.md](SETUP.md) 를 본다.

| 단계 | 할 일 |
|---|---|
| 1 | 서버 데이터 백업 → 팀 드라이브 보관 |
| 2 | 넘길 자료 보관 위치 정리 ([README.md](README.md) 1장 표 채우기) |
| 3 | AWS 정리 (내 계정 서버를 없앨 때) |

> **1장(백업)을 끝내기 전에는 인스턴스를 종료하지 않는다.** 종료하면 서버 디스크가 영구 삭제된다.
> 이 레포는 **공개 저장소**다. 비밀번호·키는 문서에 쓰지 말고 **보관 위치**만 적는다.

---

## 1. 서버 데이터 백업

백업 파일 하나에 주행 기록(InfluxDB), 모든 키(`.env`), MQTT 계정(`mosquitto.passwd`)이 들어간다.

### 1-1. 서버에서 백업 파일 만들기

AWS 콘솔 → EC2 → 인스턴스 → 서버 선택 → **연결** → EC2 Instance Connect(사용자 `ubuntu`)

```bash
cd ~/GGOLCHA_SERVER/server
docker compose stop influxdb mqtt_logger
sudo tar czf ~/ggolcha-backup.tgz _data/influxdb .env config/mosquitto.passwd
sudo chown ubuntu ~/ggolcha-backup.tgz
ls -lh ~/ggolcha-backup.tgz        # 파일 크기 기억
```

서버를 계속 쓸 거면 백업 후 `docker compose start influxdb mqtt_logger` 로 다시 켠다.

### 1-2. PC로 내려받기

PC PowerShell:

```powershell
ssh-keygen -t ed25519                              # 전부 Enter (이미 있으면 n)
type $env:USERPROFILE\.ssh\id_ed25519.pub          # 출력된 한 줄 복사
```

서버 터미널 (따옴표 안에 붙여넣기):

```bash
echo "복사한 한 줄" >> ~/.ssh/authorized_keys
```

PC PowerShell:

```powershell
cd $env:USERPROFILE\Downloads
scp ubuntu@서버주소:~/ggolcha-backup.tgz .
dir ggolcha-backup.tgz                             # 크기가 1-1과 같으면 성공
tar -tzf ggolcha-backup.tgz | Select-String "\.env|passwd"   # 두 파일이 보이면 정상
```

`Connection timed out` → EC2 → 서버의 **보안 그룹** → 인바운드 규칙에 `SSH / 내 IP` 추가 후 다시 실행.

### 1-3. 팀 드라이브에 보관

`ggolcha-backup.tgz` 를 **팀 공용 비공개 드라이브**에 올리고, 경로를 [README.md](README.md) 1장 표에 적는다. GitHub·카페에는 올리지 않는다.

레포는 넘기지 않고 그대로 둔다. 받는 사람이 **포크**해서 자기 레포로 쓴다 ([SETUP.md](SETUP.md) 1장). 원본 레포는 지우지 않는다.

## 2. 넘길 자료 정리

[README.md](README.md) 1장 "넘겨받는 것" 표의 보관 위치를 모두 채우고 커밋한다.

- 백업 파일 경로
- ESP32 스케치 (MQTT 비밀번호가 들어 있어 레포에 넣지 않는다)
- Rear STM32 프로젝트
- Teensy 4.1 코드
- 설계백서

## 3. AWS 정리 (요금 0원 만들기)

내 계정의 서버를 없앨 때만 한다. 1장 백업이 팀 드라이브에 올라간 것을 확인한 뒤 진행한다.

| 순서 | EC2 콘솔 위치 | 할 일 |
|---|---|---|
| 1 | 인스턴스 | 서버 선택 → 인스턴스 상태 → **인스턴스 종료** ("중지"가 아님) |
| 2 | 탄력적 IP | 남아 있으면 선택 → 작업 → **릴리스** (연결 안 된 IP도 요금 발생) |
| 3 | 볼륨 | 몇 분 뒤 확인. "사용 가능" 상태가 남아 있으면 삭제 |
| 4 | 스냅샷, AMI | 남아 있으면 삭제 (AMI는 등록 취소 → 스냅샷 삭제) |
| 5 | 다른 리전 | 왼쪽 위 **EC2 Global View** 로 모든 리전에 남은 리소스가 없는지 확인 |
| 6 | 결제 및 비용 관리 | **Budgets** 에 월 1달러 알림. 다음 달 청구서가 0원인지 확인 |

보안 그룹, 키 페어는 요금이 없다.

그다음 GitHub 레포 → **Actions** → **Deploy to Seoul Server** → `...` → **Disable workflow**. 서버가 없는데 켜 두면 배포가 계속 실패한다. 받는 사람은 자기 포크에서 따로 켠다.

---

## 기록

| 날짜 | 넘긴 사람 | 내용 |
|---|---|---|
| 2026-11 | 3기 | 서버 백업(약 2MB) 후 AWS 정리. 원본 레포 `qwedus/GGOLCHA_SERVER` 유지(4기는 포크). 도메인 `ggolcha.duckdns.org` 는 개인 계정이라 넘기지 않음 → 4기는 새 주소 발급 |
