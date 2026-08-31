import { reactive, watch } from 'vue';
import dayjs from 'dayjs/esm';

export const connection = reactive({
    server: { value: 'Uninitialized', severity: 'danger' },
    device: { value: 'Offline', severity: 'danger' },
    status: 'text-gray-500'
});

export const config = reactive({
    server: {
        addr: { value: '', loading: false },
        name: { value: '', loading: false },
        key: { value: '', loading: false }
    },
    net: {
        ssid: { value: '', loading: false },
        passwd: { value: '', loading: false }
    },
    dev: {
        tz: { value: '', loading: false },
        intv: { value: 0, loading: false }
    },
    can: {
        en: { value: false, loading: false },
        bps: { value: 0, loading: false },
        filter: { value: '', loading: false },
        mask: { value: '', loading: false }
    },
    gps: {
        en: { value: false, loading: false },
        dev: { value: 0, loading: false }
    },
    anl: {
        en: { value: false, loading: false }
    },
    dgt: {
        en: { value: false, loading: false }
    },
    current_loading: '',
    disabled: false
});

export const files = reactive({
    buf: [],
    list: [],
    loading: {
        list: false,
        del: false,
        download: false
    },
    disabled: false,
    download: {
        name: '',
        nonce: '',
        progress: 0,
        size: 0,
        transferred: 0,
        time: null,
        speed: '',
        phase: '',
        lastTime: null,
        lastBytes: 0
    }
});


export const state = reactive([
    { name: '', text: 'UNKNOWN', status: 'secondary', hidden: false }, // hide core state
    { name: 'NVS', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'RTC', text: 'UNKNOWN', status: 'secondary', hidden: true },   // 기본 숨김
    { name: 'SD', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'WIFI', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'MQTT', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'CAN', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'GPS', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'Steering', text: 'UNKNOWN', status: 'secondary', hidden: false },
    { name: 'DIGITAL', text: 'UNKNOWN', status: 'secondary', hidden: true }, // 기본 숨김
    { name: 'GYRO', text: 'UNKNOWN', status: 'secondary', hidden: false }
]);

// 저장된 숨김 설정 불러오기 (state 배열 선언 바로 다음에 추가)
(function loadStateHidden() {
    const saved = localStorage.getItem('state/hidden');
    if (!saved) return;
    try {
        const parsed = JSON.parse(saved);
        state.forEach((item) => {
            if (item.name && parsed[item.name] !== undefined) {
                item.hidden = parsed[item.name];
            }
        });
    } catch (e) {
        // 무시
    }
})();

// hidden 값 바뀔 때마다 자동 저장
watch(
    () => state.map((item) => item.hidden),
    () => {
        const toSave = {};
        state.forEach((item) => {
            if (item.name) toSave[item.name] = item.hidden;
        });
        localStorage.setItem('state/hidden', JSON.stringify(toSave));
    }
);

export const times = reactive({
    boot: { label: 'Boot', value: '-', raw: null },
    current: { label: 'Current', value: '-' },
    uptime: { label: 'Uptime', value: '-' },
    firmware: { label: 'Firmware', value: 'UNKNOWN', severity: 'secondary' }
});

export const cons = reactive({
    usrevt: '',
    can: { id: '', data: Array.from({ length: 8 }, () => '') }
});

export const telemetry = reactive({
    chart: {},
    digital: { din1: false, din2: false, din3: false, din4: false },
    analog: [[], [], [], [], [], [], [], [], []],
    gyro: [[], [], [], [], [], [], []],
    can: [[]],
    // [0]=timestamp, 1~8 = rpm_L, rpm_R, throttle_L, throttle_R, voltage, current, soc_pct, encoder_angle
    vehicle: [[], [], [], [], [], [], [], [], []]
});

export function format_size(size) {
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(2) + ' MB';
    if (size >= 1024) return (size / 1024).toFixed(2) + ' KB';
    return size + ' B';
}

export const digit = (num) => num.toFixed(Math.max(0, 3 - Math.trunc(Math.abs(num)).toString().length));

export const fmt = {
    time: (u, v, sidx, didx) => {
        const d = u.data[sidx];

        if (didx == null && d) {
            v = d[d.length - 1];
        }

        return dayjs(v * 1000).format('HH:mm:ss.SSS');
    },
    digital: (u, v, sidx, didx) => {
        const d = u.data[sidx];

        if (didx == null && d) {
            v = d[d.length - 1];
        }

        switch (v) {
            case 0:
                return 'LOW';
            case 1:
                return 'HIGH';
            default:
                return '-';
        }
    }
};
