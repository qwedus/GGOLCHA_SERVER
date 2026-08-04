import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { parse_log, parse_logbuf, to_uint } from './protocol.js';

// ---------------------------------------------------------------------------
// 설정: 전부 환경변수로 주입 (docker-compose.yml의 environment/.env에서 관리)
// ---------------------------------------------------------------------------
const MQTT_HOST = process.env.MQTT_HOST || 'mosquitto';
const MQTT_PORT = process.env.MQTT_PORT || '1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'logger';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

const INFLUX_URL = process.env.INFLUX_URL || 'http://influxdb:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const INFLUX_ORG = process.env.INFLUX_ORG || 'ggolcha';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'telemetry';

// ---------------------------------------------------------------------------
// InfluxDB 클라이언트
// ---------------------------------------------------------------------------
const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ms');

// 주기적으로 배치 flush (기본은 write 호출마다 바로 안 나가고 버퍼링됨)
setInterval(() => {
    writeApi.flush().catch((e) => console.error('[influx] flush error:', e.message));
}, 1000);

// ---------------------------------------------------------------------------
// log.type -> InfluxDB measurement / log 안에서 실제 데이터가 들어있는 key 매핑.
// protocol.js의 FIELD_SCHEMA가 필드 목록을 정의하듯, 여기는 "타입 -> 저장 위치"만
// 정의한다. 필드 자체가 늘어나도 이 매핑은 안 바뀜 (Object.entries로 자동 순회하니까).
// ---------------------------------------------------------------------------
const TYPE_MAP = {
    GPS: { measurement: 'gps', key: 'gps' },
    ANALOG: { measurement: 'analog', key: 'analog' },
    DIGITAL: { measurement: 'digital', key: 'digital' },
    GYROSCOPE: { measurement: 'gyro', key: 'gyro' },
    SYSTEM: { measurement: 'event', key: 'sys' },
    USER_EVENT: { measurement: 'event', key: 'user' },
    CAN: { measurement: 'can', key: 'can' },
    VEHICLE: { measurement: 'vehicle', key: 'vehicle' }
};

// device 이름 -> 마지막으로 관측된 부팅 시각(unix seconds).
// 세션 구분용 tag이자, 로그의 상대 timestamp(ms since boot)를 절대 시각으로
// 바꾸는 기준값으로도 쓴다. 디바이스가 OFFLINE 되면 삭제되어, 재부팅 전까지는
// 안전하게 값을 버린다 (부팅 시각을 모르는 상태로 잘못된 절대시각을 쓰지 않기 위함).
const bootTime = new Map();

function writeLog(device, log) {
    const boot = bootTime.get(device);
    if (boot === undefined) return; // 아직 이 디바이스의 부팅 시각을 모름 -> 버림

    const map = TYPE_MAP[log.type];
    if (!map) return; // BOOT 등 로깅 대상이 아닌 타입

    const data = log[map.key];
    if (!data) return;

    const point = new Point(map.measurement)
        .tag('device', device)
        .tag('session', String(boot))
        .timestamp(new Date(boot * 1000 + log.timestamp));

    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') {
            point.floatField(k, v);
        } else if (typeof v === 'string') {
            point.stringField(k, v);
        } else if (v instanceof Uint8Array) {
            point.stringField(k, Buffer.from(v).toString('hex'));
        }
    }

    writeApi.writePoint(point);
}

// 24바이트 단위 로그가 여러 개 이어 붙은 payload(d/can, d/sl 등)를 순회 파싱
function writeLogBatch(device, message) {
    for (let offset = 0; offset + 24 <= message.length; offset += 24) {
        try {
            const log = parse_log(message.subarray(offset, offset + 24));
            writeLog(device, log);
        } catch (e) {
            console.error(`[parse] ${device}: ${e.message}`);
        }
    }
}

// ---------------------------------------------------------------------------
// MQTT 연결. mosquitto와 같은 docker 네트워크 안이라 TLS 없이 내부 포트(1883)로 접속.
// mqtt.js 라이브러리는 기본적으로 연결 끊기면 자동 재연결한다 (reconnectPeriod 기본 1s).
// ---------------------------------------------------------------------------
const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    keepalive: 30,
    clientId: 'ggolcha-mqtt-logger'
});

client.on('connect', () => {
    console.log('[mqtt] connected, subscribing to all device data topics');
    // 모든 디바이스(+)의 데이터 토픽(d, d/boot, d/can, d/sl 등)을 구독.
    // ack/#, d/cfg 처럼 원격제어 응답/설정 관련 토픽은 로깅 대상이 아니라 제외.
    client.subscribe('+/d/#');
});

client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
client.on('error', (e) => console.error('[mqtt] error:', e.message));
client.on('close', () => console.warn('[mqtt] connection closed'));

client.on('message', (topic, message) => {
    const parts = topic.split('/');
    const device = parts[0];
    const subtopic = parts.slice(1).join('/');

    try {
        switch (subtopic) {
            case 'd/boot': {
                if (message.toString() === 'OFFLINE') {
                    bootTime.delete(device);
                    console.log(`[device] ${device} offline`);
                } else {
                    const boot = to_uint(32, message, 0);
                    bootTime.set(device, boot);
                    console.log(`[device] ${device} boot @ ${boot}`);
                }
                break;
            }

            case 'd': {
                // 주기적 스냅샷: 내부에 gps/gyro/analog/digital 서브 로그를 포함
                const logbuf = parse_logbuf(message);
                for (const key of ['gps', 'gyro', 'analog', 'digital']) {
                    if (logbuf[key]) writeLog(device, logbuf[key]);
                }
                break;
            }

            case 'd/can': // CAN 로그 배치
            case 'd/sl': // 시스템 로그 배치
            case 'd/vh': // VEHICLE 로그 배치
                writeLogBatch(device, message);
                break;

            default:
                break; // d/ver, d/cfg 등은 로깅 대상 아님
        }
    } catch (e) {
        console.error(`[parse] ${device} ${subtopic}: ${e.message}`);
    }
});

// ---------------------------------------------------------------------------
// 정상 종료 시 버퍼에 남은 포인트 flush
// ---------------------------------------------------------------------------
async function shutdown() {
    console.log('shutting down, flushing remaining points...');
    try {
        await writeApi.close();
    } catch (e) {
        console.error('flush on shutdown failed:', e.message);
    }
    client.end();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
