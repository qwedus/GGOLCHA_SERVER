import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { parse_log, parse_logbuf, to_uint } from './protocol.js';
import { createServer } from 'node:http';

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

const HTTP_PORT = process.env.HTTP_PORT || '8080';

// ---------------------------------------------------------------------------
// InfluxDB 클라이언트
// ---------------------------------------------------------------------------
const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ms');
const queryApi = influx.getQueryApi(INFLUX_ORG);

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
        } else if (typeof v === 'boolean') {
            point.booleanField(k, v);
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
// 세션 조회 / 소프트 삭제
// session 태그값 자체가 boot(unix seconds)라서, 별도로 시각을 조회할 필요 없이
// tagValues만 가져오면 목록+시작시각을 동시에 구한다.
// 삭제는 실제 데이터를 지우지 않고, session_meta measurement에 hidden=true 포인트를
// 하나 남겨서 조회 시 걸러내는 방식(soft delete)이다.
// ---------------------------------------------------------------------------
async function listSessions(device) {
    const sessionsFlux = `
        import "influxdata/influxdb/schema"
        schema.tagValues(bucket: "${INFLUX_BUCKET}", tag: "session",
            predicate: (r) => r.device == "${device}", start: -365d)`;

    const hiddenFlux = `
        from(bucket: "${INFLUX_BUCKET}")
          |> range(start: -365d)
          |> filter(fn: (r) => r._measurement == "session_meta" and r.device == "${device}" and r._field == "hidden")
          |> last()`;

    const [sessionRows, hiddenRows] = await Promise.all([queryApi.collectRows(sessionsFlux), queryApi.collectRows(hiddenFlux)]);

    const hidden = new Set(hiddenRows.map((r) => r.session));

    return sessionRows
        .map((r) => r._value)
        .filter((s) => !hidden.has(s))
        .map((s) => ({ session: s, start: Number(s) * 1000 }))
        .sort((a, b) => b.start - a.start);
}

async function hideSession(device, session) {
    const point = new Point('session_meta').tag('device', device).tag('session', String(session)).booleanField('hidden', true);
    writeApi.writePoint(point);
    await writeApi.flush();
}

// ---------------------------------------------------------------------------
// 세션 하나의 전체 로그 조회. Influx에 필드별로 쪼개져 저장된 point들을
// pivot()으로 시점(_time)별 하나의 row로 합친 다음, viewer.vue의 set_data()가
// 기대하는 log-record 형태({ type, timestamp, gps/analog/... })로 되돌린다.
// ---------------------------------------------------------------------------
const MEASUREMENT_TYPE = {
    gps: { type: 'GPS', key: 'gps' },
    analog: { type: 'ANALOG', key: 'analog' },
    digital: { type: 'DIGITAL', key: 'digital' },
    gyro: { type: 'GYROSCOPE', key: 'gyro' },
    can: { type: 'CAN', key: 'can' },
    vehicle: { type: 'VEHICLE', key: 'vehicle' },
    event: { type: 'SYSTEM', key: 'sys' } // SYSTEM/USER_EVENT 둘 다 이 measurement라 구분이 안 됨 (아래 설명 참고)
};

async function fetchMeasurement(device, session, measurement) {
    const flux = `
        from(bucket: "${INFLUX_BUCKET}")
          |> range(start: -365d)
          |> filter(fn: (r) => r._measurement == "${measurement}" and r.device == "${device}" and r.session == "${session}")
          |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])`;
    return queryApi.collectRows(flux);
}

async function getSessionData(device, session) {
    const boot = Number(session);
    const records = [];

    for (const [measurement, info] of Object.entries(MEASUREMENT_TYPE)) {
        const rows = await fetchMeasurement(device, session, measurement);

        for (const r of rows) {
            const { _time, _start, _stop, _measurement, table, result, device: _d, session: _s, ...fields } = r;

            // CAN data는 쓸 때 Uint8Array -> hex 문자열로 저장했으니, 그래프 쪽에서 쓰던
            // Uint8Array 형태로 되돌려줘야 can_byte/can_bit 디코딩이 정상 동작한다.
            if (measurement === 'can' && typeof fields.data === 'string') {
                const bytes = fields.data.match(/.{1,2}/g) || [];
                fields.data = Uint8Array.from(bytes.map((b) => parseInt(b, 16)));
            }

            records.push({
                type: info.type,
                timestamp: new Date(_time).getTime() - boot * 1000,
                [info.key]: fields
            });
        }
    }

    records.sort((a, b) => a.timestamp - b.timestamp);
    return records;
}

// ---------------------------------------------------------------------------
// 조회용 HTTP 서버. 웹 프론트는 nginx의 /api/sessions 프록시를 통해 이 서버로 들어온다.
// 쓰기(mqtt_logger 본연의 역할)와 같은 프로세스 안에서 InfluxDB 클라이언트/env를
// 공유하기 위해 별도 서비스로 분리하지 않았다.
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    try {
        const url = new URL(req.url, 'http://localhost');

        if (req.method === 'GET' && url.pathname === '/api/sessions') {
            const device = url.searchParams.get('device');
            if (!device) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'device is required' }));
                return;
            }

            const sessions = await listSessions(device);
            res.end(JSON.stringify({ sessions }));
            return;
        }

        // 여기가 새로 추가되는 부분
        const dataMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/data$/);
        if (req.method === 'GET' && dataMatch) {
            const device = url.searchParams.get('device');
            const session = dataMatch[1];

            if (!device) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'device is required' }));
                return;
            }

            const records = await getSessionData(device, session);
            res.end(JSON.stringify({ records }));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/sessions/hide') {
            let body = '';
            for await (const chunk of req) body += chunk;

            const { device, session } = JSON.parse(body || '{}');
            if (!device || !session) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'device and session are required' }));
                return;
            }

            await hideSession(device, session);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    } catch (e) {
        console.error('[http] error:', e.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'internal error' }));
    }
});

server.listen(HTTP_PORT, () => console.log(`[http] sessions API listening on :${HTTP_PORT}`));

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
    server.close();
    client.end();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
