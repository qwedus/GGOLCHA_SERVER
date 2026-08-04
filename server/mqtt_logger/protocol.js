const PROTOCOL_VERSION = 1;
const LOG_MAGIC = 0xae;
const LOG_SIZE = 24;

const LOG_TYPE = ['INVALID', 'BOOT', 'CAN', 'GPS', 'ANALOG', 'DIGITAL', 'GYROSCOPE', 'SYSTEM', 'USER_EVENT', 'VEHICLE'];

// ---------------------------------------------------------------------------
// FIELD_SCHEMA: 각 로그 타입의 "필드가 존재한다"는 사실을 여기 한 곳에만 정의한다.
//
// 필드 추가/삭제/타입 변경  -> 이 배열만 수정하면 됨 (parse_log의 switch, InfluxDB
//                             저장 로직은 건드릴 필요 없음)
// 완전히 새로운 로그 타입 추가 -> LOG_TYPE 배열 + 여기에 새 스키마 추가 + switch에
//                             한 줄(parse_fields 호출) 추가는 여전히 필요함
//
// 각 필드 항목:
//   name      : 결과 객체의 key (예: log.analog.ain1)
//   offset    : LOG_SIZE(24바이트) 버퍼 내 오프셋
//   bits      : 8 | 16 | 32 | 64 (to_uint/to_int가 요구하는 2의 거듭제곱)
//   signed    : true면 to_int, false/생략이면 to_uint 사용
//   transform : (rawValue) => finalValue. 스케일링/단위 변환이 필요한 경우에만 사용
//   type      : 'string'인 경우 offset~offset+length 구간을 널 종료 문자열로 읽음
//   length    : type: 'string'일 때 문자열 최대 길이
// ---------------------------------------------------------------------------

function to_dms(raw) {
    // raw: 1e7 스케일된 정수 좌표 (예: 37.5665 -> 375665000)
    const v = raw / 10000000;
    return Math.floor(v) + ((v % 1) * 100) / 60;
}

const FIELD_SCHEMA = {
    ANALOG: [
        { name: 'ain1', offset: 8, bits: 16, signed: true },
        { name: 'ain2', offset: 10, bits: 16, signed: true },
        { name: 'ain3', offset: 12, bits: 16, signed: true },
        { name: 'ain4', offset: 14, bits: 16, signed: true },
        { name: 'ain5', offset: 16, bits: 16, signed: true },
        { name: 'ain6', offset: 18, bits: 16, signed: true },
        { name: 'voltage', offset: 20, bits: 16, signed: true },
        { name: 'temperature', offset: 22, bits: 16, signed: true }
    ],

    DIGITAL: [
        { name: 'din1', offset: 8, bits: 32, signed: false },
        { name: 'din2', offset: 12, bits: 32, signed: false },
        { name: 'din3', offset: 16, bits: 32, signed: false },
        { name: 'din4', offset: 20, bits: 32, signed: false }
    ],

    GYRO: [
        { name: 'accel_x', offset: 8, bits: 16, signed: true },
        { name: 'accel_y', offset: 10, bits: 16, signed: true },
        { name: 'accel_z', offset: 12, bits: 16, signed: true },
        { name: 'temperature', offset: 14, bits: 16, signed: true },
        { name: 'gyro_x', offset: 16, bits: 16, signed: true },
        { name: 'gyro_y', offset: 18, bits: 16, signed: true },
        { name: 'gyro_z', offset: 20, bits: 16, signed: true }
    ],

    GPS: [
        { name: 'latitude', offset: 8, bits: 32, signed: false, transform: to_dms },
        { name: 'longitude', offset: 12, bits: 32, signed: false, transform: to_dms },
        { name: 'lat_dir', offset: 16, type: 'string', length: 1 },
        { name: 'lon_dir', offset: 17, type: 'string', length: 1 },
        { name: 'speed', offset: 20, bits: 16, signed: false, transform: (v) => v / 100 },
        { name: 'course', offset: 22, bits: 16, signed: false, transform: (v) => v / 100 }
    ],

    SYS: [{ name: 'msg', offset: 8, type: 'string', length: 16 }],

    USER: [{ name: 'msg', offset: 8, type: 'string', length: 16 }]

    // BOOT, CAN은 각각 MAC 바이트 포맷팅 / 가변 길이 데이터 슬라이싱이 필요해서
    // 스키마 자동화 대상이 아니라 parse_log 안에서 그대로 특별 처리한다.
};

// 스키마를 순회하며 raw 버퍼 -> { name: value, ... } 객체로 변환하는 단일 엔진.
// 이 함수는 어떤 로그 타입에 어떤 필드가 있는지 전혀 몰라도 되고,
// FIELD_SCHEMA만 보고 동작한다.
function parse_fields(buf, schema) {
    const result = {};

    for (const f of schema) {
        let value;

        if (f.type === 'string') {
            value = to_string(buf, f.offset, f.offset + f.length);
        } else {
            value = f.signed ? to_int(f.bits, buf, f.offset) : to_uint(f.bits, buf, f.offset);
            if (f.transform) value = f.transform(value);
        }

        result[f.name] = value;
    }

    return result;
}

const LOG_POS = {
    MAGIC: 0,
    TYPE: 1,
    CHECKSUM: 2,
    TIMESTAMP: 4,
    BOOT: {
        PROTOCOL_VERSION: 8,
        _RESERVED: 9,
        MAC: 10,
        BOOT_TIME: 16
    },
    CAN: {
        ID: 8,
        EXTENDED: 12,
        REMOTE: 13,
        LEN: 14,
        _RESERVED: 15,
        DATA: 16
    }
};

const NVS_POS = {
    WIFI: {
        MAC: 0,
        MACADDR: 6,
        SSID: 24,
        PASSWD: 56
    },
    DEVICE: {
        SERVER: 88,
        NAME: 152,
        KEY: 184,
        TZ: 216,
        INTV: 256
    },
    EN: {
        CAN: 260,
        GPS: 261,
        ANALOG: 262,
        DIGITAL: 263
    },
    CAN: {
        BPS: 264,
        FILTER: 268,
        MASK: 272
    },
    GPS: {
        DEV: 276
    }
};

const LOGBUF_POS = {
    TIMESTAMP: 0,
    STATE: 4,
    GPS: 8,
    GYRO: 32,
    ANALOG: 56,
    DIGITAL: 80
};

const STATE = ['CORE', 'NVS', 'RTC', 'SD', 'WIFI', 'MQTT', 'CAN', 'GPS', 'ANALOG', 'DIGITAL', 'GYRO'];
const STATE_COMPONENT_MAX = 12;

export function parse(buf) {
    const logs = {
        ok: 0,
        error: [],
        data: [],
        header: null,
        latest: null
    };

    let i = 0;
    let header = false;

    while (i < buf.length) {
        let ret;
        try {
            ret = parse_log(buf.slice(i, i + LOG_SIZE));
        } catch (e) {
            logs.error.push(`#${i}: ${e.message}`);

            do {
                i++;
            } while (i < buf.length && buf[i] !== LOG_MAGIC);

            continue;
        }

        if (!header && i === 0 && ret.type !== 'BOOT') {
            logs.error.push(`#${i}: No valid header found`);
            i += LOG_SIZE;
            continue;
        }

        if (ret.type === 'BOOT') {
            if (header) {
                logs.error.push(`#${i}: Multiple headers found`);
                i += LOG_SIZE;
                continue;
            } else if (ret.boot.protocol_version !== PROTOCOL_VERSION) {
                logs.error.push(`#${i}: Unsupported protocol version ${ret.boot.protocol_version}`);
                i += LOG_SIZE;
                continue;
            } else {
                header = true;
                logs.header = ret;
            }
        } else {
            logs.data.push(ret);
            logs.latest = ret;
            logs.ok++;
        }

        i += LOG_SIZE;
    }

    return logs;
}

export function parse_cfg(buf) {
    return {
        wifi: {
            mac: to_string(buf, NVS_POS.WIFI.MACADDR, NVS_POS.WIFI.SSID),
            ssid: to_string(buf, NVS_POS.WIFI.SSID, NVS_POS.WIFI.PASSWD),
            passwd: to_string(buf, NVS_POS.WIFI.PASSWD, NVS_POS.DEVICE.SERVER)
        },
        device: {
            server: to_string(buf, NVS_POS.DEVICE.SERVER, NVS_POS.DEVICE.NAME),
            name: to_string(buf, NVS_POS.DEVICE.NAME, NVS_POS.DEVICE.KEY),
            key: to_string(buf, NVS_POS.DEVICE.KEY, NVS_POS.DEVICE.TZ),
            tz: to_string(buf, NVS_POS.DEVICE.TZ, NVS_POS.EN.CAN),
            intv: to_uint(32, buf, NVS_POS.DEVICE.INTV)
        },
        en: {
            can: to_uint(8, buf, NVS_POS.EN.CAN),
            gps: to_uint(8, buf, NVS_POS.EN.GPS),
            analog: to_uint(8, buf, NVS_POS.EN.ANALOG),
            digital: to_uint(8, buf, NVS_POS.EN.DIGITAL)
        },
        can: {
            bps: to_uint(8, buf, NVS_POS.CAN.BPS),
            filter: to_uint(32, buf, NVS_POS.CAN.FILTER),
            mask: to_uint(32, buf, NVS_POS.CAN.MASK)
        },
        gps: {
            dev: to_uint(8, buf, NVS_POS.GPS.DEV)
        }
    };
}

export function parse_log(buf) {
    const log = {
        magic: to_uint(8, buf, LOG_POS.MAGIC),
        type: LOG_TYPE[buf[LOG_POS.TYPE]],
        checksum: to_uint(16, buf, LOG_POS.CHECKSUM),
        timestamp: to_uint(32, buf, LOG_POS.TIMESTAMP)
    };

    if (log.magic !== LOG_MAGIC) {
        throw new Error('log magic failure');
    }

    if (!validate_checksum(buf)) {
        throw new Error('log checksum failure');
    }

    switch (log.type) {
        // BOOT: MAC 주소 hex 포맷팅이 필요해서 스키마 엔진을 안 쓰고 그대로 둠
        case 'BOOT':
            log.boot = {
                protocol_version: to_uint(8, buf, LOG_POS.BOOT.PROTOCOL_VERSION),
                mac: Array.from(buf.slice(LOG_POS.BOOT.MAC, LOG_POS.BOOT.MAC + 6))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join(':')
                    .toUpperCase(),
                boot_time: to_uint(64, buf, LOG_POS.BOOT.BOOT_TIME)
            };
            break;

        // CAN: DATA 필드 길이가 len 값에 따라 가변이라 스키마 엔진을 안 쓰고 그대로 둠
        case 'CAN':
            log.can = {
                id: to_uint(32, buf, LOG_POS.CAN.ID),
                extended: to_uint(8, buf, LOG_POS.CAN.EXTENDED),
                remote: to_uint(8, buf, LOG_POS.CAN.REMOTE),
                len: to_uint(8, buf, LOG_POS.CAN.LEN)
            };
            log.can.data = buf.slice(LOG_POS.CAN.DATA, LOG_POS.CAN.DATA + log.can.len);
            break;

        // 아래 5개 타입은 전부 동일한 parse_fields 엔진 호출 한 줄로 끝남.
        // 필드 추가/삭제는 FIELD_SCHEMA만 고치면 되고 여기는 절대 안 건드림.
        case 'GPS':
            log.gps = parse_fields(buf, FIELD_SCHEMA.GPS);
            break;

        case 'ANALOG':
            log.analog = parse_fields(buf, FIELD_SCHEMA.ANALOG);
            break;

        case 'DIGITAL':
            log.digital = parse_fields(buf, FIELD_SCHEMA.DIGITAL);
            break;

        case 'GYROSCOPE':
            log.gyro = parse_fields(buf, FIELD_SCHEMA.GYRO);
            break;

        case 'SYSTEM':
            log.sys = parse_fields(buf, FIELD_SCHEMA.SYS);
            break;

        case 'USER_EVENT':
            log.user = parse_fields(buf, FIELD_SCHEMA.USER);
            break;

        case 'INVALID':
        default:
            throw new Error('log type failure');
    }

    return log;
}

function parse_state_bit(value, component) {
    component = STATE.indexOf(component);

    if (value & (1 << (component + STATE_COMPONENT_MAX))) {
        return 'FATAL';
    } else if (value & (1 << component)) {
        return 'ERROR';
    } else {
        return 'OK';
    }
}

export function parse_logbuf(buf) {
    const state = to_uint(32, buf, LOGBUF_POS.STATE);

    const logbuf = {
        timestamp: to_uint(32, buf, LOGBUF_POS.TIMESTAMP),
        state: {
            core: parse_state_bit(state, 'CORE'),
            nvs: parse_state_bit(state, 'NVS'),
            rtc: parse_state_bit(state, 'RTC'),
            sd: parse_state_bit(state, 'SD'),
            wifi: parse_state_bit(state, 'WIFI'),
            mqtt: parse_state_bit(state, 'MQTT'),
            can: parse_state_bit(state, 'CAN'),
            gps: parse_state_bit(state, 'GPS'),
            analog: parse_state_bit(state, 'ANALOG'),
            digital: parse_state_bit(state, 'DIGITAL'),
            gyro: parse_state_bit(state, 'GYRO')
        }
    };

    try {
        logbuf.gps = parse_log(buf.slice(LOGBUF_POS.GPS, LOGBUF_POS.GPS + LOG_SIZE));
    } catch (e) {
        if (buf[LOGBUF_POS.GPS] !== 0) {
            console.error(`GPS: ${e}`);
            console.error(buf.slice(LOGBUF_POS.GPS, LOGBUF_POS.GPS + LOG_SIZE));
        }
    }

    try {
        logbuf.gyro = parse_log(buf.slice(LOGBUF_POS.GYRO, LOGBUF_POS.GYRO + LOG_SIZE));
    } catch (e) {
        if (buf[LOGBUF_POS.GYRO] !== 0) {
            console.error(`GYRO: ${e}`);
            console.error(buf.slice(LOGBUF_POS.GYRO, LOGBUF_POS.GYRO + LOG_SIZE));
        }
    }

    try {
        logbuf.analog = parse_log(buf.slice(LOGBUF_POS.ANALOG, LOGBUF_POS.ANALOG + LOG_SIZE));
    } catch (e) {
        if (buf[LOGBUF_POS.ANALOG] !== 0) {
            console.error(`ANALOG: ${e}`);
            console.error(buf.slice(LOGBUF_POS.ANALOG, LOGBUF_POS.ANALOG + LOG_SIZE));
        }
    }

    try {
        logbuf.digital = parse_log(buf.slice(LOGBUF_POS.DIGITAL, LOGBUF_POS.DIGITAL + LOG_SIZE));
    } catch (e) {
        if (buf[LOGBUF_POS.DIGITAL] !== 0) {
            console.error(`DIGITAL: ${e}`);
            console.error(buf.slice(LOGBUF_POS.DIGITAL, LOGBUF_POS.DIGITAL + LOG_SIZE));
        }
    }

    return logbuf;
}

export function validate_checksum(buf) {
    const original = to_uint(16, buf, LOG_POS.CHECKSUM);
    buf[LOG_POS.CHECKSUM] = 0;
    buf[LOG_POS.CHECKSUM + 1] = 0;

    let checksum = 0;

    for (let i = 0; i < LOG_SIZE; i += 4) {
        checksum ^= to_uint(32, buf, i);
    }

    checksum = ((checksum & 0xffff) + (checksum >>> 16)) & 0xffff;

    if (checksum === original) {
        return true;
    } else {
        console.warn(`Checksum mismatch: expected ${original}, got ${checksum}`);
        return false;
    }
}

export const convert = {
    adc_to_v: (v) => (v / (1 << 15)) * 4.096, // +-4.096V FSR
    accel_to_g: (v) => (v / (1 << 15)) * 8, // +-8g FSR
    gyro_to_dps: (v) => (v / (1 << 15)) * 500,
    can_byte: (v, start, end, endian) => to_uint((end - start + 1) * 8, v, start, endian === 'big'),
    can_bit: (v, start, end) => Number((new DataView(v.buffer, v.byteOffset, 8).getBigUint64(0, true) >> BigInt(start)) & ((1n << BigInt(end - start + 1)) - 1n))
};

export function can_filter_match(data, filter, mask) {
    for (let i = 0; i < mask.length; i++) {
        if ((data[i] & mask[i]) !== (filter[i] & mask[i])) return false;
    }
    return true;
}

export function parse_hex_bytes(hex) {
    const padded = hex.length % 2 ? '0' + hex : hex;
    return Uint8Array.from({ length: padded.length / 2 }, (_, i) => parseInt(padded.slice(i * 2, i * 2 + 2), 16));
}

export function to_string(buffer, start, end) {
    const str = String.fromCharCode(...buffer.slice(start, end));
    const nl = str.indexOf('\u0000');
    return nl === -1 ? str : str.slice(0, nl);
}

export function to_uint(bit, buffer, start, be = false) {
    if (bit <= 0 || bit & (bit - 1 !== 0)) {
        throw new Error('Invalid bit count: bit must be a power of two');
    }

    let ret = 0;

    for (let i = 0; i < bit / 8; i++) {
        const idx = be ? start + bit / 8 - 1 - i : start + i;
        ret += buffer[idx] * Math.pow(2, i * 8);
    }

    return ret >>> 0;
}

export function to_int(bit, buffer, start) {
    return signed(to_uint(bit, buffer, start), bit);
}

export function signed(value, bit) {
    return value > Math.pow(2, bit - 1) - 1 ? value - Math.pow(2, bit) : value;
}

export function to_float(buffer, start) {
    return new DataView(buffer.buffer, buffer.byteOffset + start, 4).getFloat32(0, true); // little endian
}
