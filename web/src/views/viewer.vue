<script setup>
defineOptions({ name: 'Viewer' });

import { ref, onMounted, onUnmounted } from 'vue';
import { dark } from '@/layout/composables/layout';
import { parse, convert, signed, can_filter_match } from '@/service/protocol';
import { fmt, digit, format_size } from '@/service/state';
import { views, units, can_decoder, colors } from '@/service/ui';
import { init_map, rebuild_hotline, HOTLINE_MODE } from '@/service/map';
import { plugin_wheel_zoom, plugin_touch_zoom } from '@/service/uplot';
import { fetch_sessions, hide_session, fetch_session_data, rename_session } from '@/service/sessions';
import { is_admin } from '@/service/admin';

import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';

import L from 'leaflet';

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import dayjs from 'dayjs/esm';
import { encode } from '@msgpack/msgpack';

const file = {
    device: ref(''),
    name: ref(''),
    boot: ref(''),
    duration: ref(''),
    statistic: ref('')
};

let bt = 0;
const parsed_data = ref([]);

const gps = ref(null);
const map = ref(null);
const line = ref(null);
const path = ref([]);
const path_history = [];
const hotlineMode = ref(HOTLINE_MODE.SPEED);
const slider = ref(0);
const timelapse_pos = ref(null);
const timelapse_time = ref('00:00:00.000');
const timelapse_coord = ref('00.0000000, 000.0000000');
const timelapse_speed = ref('0 km/h');
const timelapse_course = ref('0 °');

const chart = ref(null);
const graph = ref(null);
const container = ref(null);

let events = ref([]);
const can_stats = ref([]);

const current_device = localStorage.getItem('server/name');
const sessions = ref([]);
const db_page = ref(0);
const confirm = useConfirm();
const toast = useToast();
const editing_session = ref(null);
const edit_name_value = ref('');

// VEHICLE 채널 목록/개수를 한 곳에서 계산해서 인덱스 계산에 재사용
// (chart 시리즈는 fixed 채널(0~19) 뒤에 VEHICLE 채널, 그 뒤에 동적 CAN 채널 순서로 배치됨)
const VEHICLE_START = 19; // 마지막 고정 채널(SPD)의 인덱스
const VEHICLE_KEYS = Object.keys(views.vehicle.ch);
const CAN_START = VEHICLE_START + VEHICLE_KEYS.length;

function confirm_delete(s) {
    confirm.require({
        message: '이 세션을 목록에서 삭제하시겠습니까? (실제 데이터는 DB에 그대로 남습니다)',
        header: '세션 삭제',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: '삭제',
        rejectLabel: '취소',
        acceptProps: { severity: 'danger' },
        accept: () => delete_session(s)
    });
}

function start_rename(s) {
    editing_session.value = s.session;
    edit_name_value.value = s.name || dayjs(s.start).format('YYYY-MM-DD HH:mm:ss');
}

function cancel_rename() {
    editing_session.value = null;
    edit_name_value.value = '';
}

async function save_rename(s) {
    const name = edit_name_value.value.trim();

    if (!name) {
        cancel_rename();
        return;
    }

    try {
        await rename_session(current_device, s.session, name);
        s.name = name;
        toast.add({ severity: 'success', summary: '이름이 변경됐습니다', group: 'br', life: 2000 });
    } catch (e) {
        console.error('failed to rename session:', e);
        toast.add({ severity: 'error', summary: '이름 변경 실패', group: 'br', life: 3000 });
    } finally {
        cancel_rename();
    }
}

const show = {
    digital: { name: 'DIN', ref: ref(false) },
    analog: { name: 'AIN', ref: ref(false) },
    gyro: { name: 'Gyro', ref: ref(false) },
    gps: { name: 'GPS', ref: ref(false) },
    vehicle: { name: 'Vehicle', ref: ref(false) },
    can: { name: 'CAN', ref: ref(false) }
};

let sessions_timer = null;

onMounted(() => {
    init_map(map, line, path, gps, hotlineMode.value);
    load_sessions();
    sessions_timer = setInterval(load_sessions, 5000); // 5초마다 세션 목록 재조회
});

onUnmounted(() => {
    clearInterval(sessions_timer);
});

async function load_sessions() {
    try {
        sessions.value = await fetch_sessions(current_device);
    } catch (e) {
        console.error('failed to load sessions:', e);
    }
}

async function delete_session(s) {
    try {
        await hide_session(current_device, s.session);
        sessions.value = sessions.value.filter((x) => x.session !== s.session);
    } catch (e) {
        console.error('failed to hide session:', e);
    }
}

async function load_session(s) {
    try {
        const records = await fetch_session_data(current_device, s.session);
        bt = Number(s.session);
        file.name.value = `${current_device}_${dayjs(s.start).format('YYYYMMDD_HHmmss')}`;
        file.device.value = current_device;
        file.boot.value = dayjs(bt * 1000).format('YYYY-MM-DD HH:mm:ss (UTC Z)');
        file.statistic.value = `${records.length.toLocaleString()} logs (from DB)`;
        parsed_data.value = records;

        const last = records.length ? records[records.length - 1].timestamp : 0;
        const d = dayjs.duration(last);
        const hours = Math.floor(d.asHours());
        const minutes = d.minutes();
        const seconds = d.seconds();

        file.duration.value = '';

        if (hours > 0) file.duration.value += `${hours} hr `;
        if (minutes > 0) file.duration.value += `${minutes} min `;
        file.duration.value += `${seconds} sec`;

        init_chart();
        set_data(records);
    } catch (e) {
        console.error('failed to load session data:', e);
    }
}

function upload(f) {
    file.name.value = f.files[0].name;

    const reader = new FileReader();
    reader.readAsArrayBuffer(f.files[0]);
    reader.onloadstart = () => {
        file.device.value = 'Parsing recorded logs...';
        file.statistic.value = "Analyzing driver's faults...";
        file.boot.value = 'Waking up all pit crews...';
        file.duration.value = 'Refueling beer...🍺';
    };
    reader.onerror = () => {
        file.device.value = 'File read failed.';
        file.statistic.value = '';
        file.boot.value = '';
        file.duration.value = '';
    };
    reader.onload = (e) => {
        let result;

        try {
            result = parse(new Uint8Array(e.target.result));

            if (result.error.length) {
                console.warn(result.error);
            }

            parsed_data.value = result.data;
        } catch (e) {
            file.device.value = "I'm sorry Dave,";
            file.statistic.value = "I'm afraid I can't do that.";
            file.boot.value = '';
            file.duration.value = 'Data parse failed.';
            console.error(e);
            return;
        }

        bt = result.header.boot.boot_time;
        file.device.value = result.header.boot.mac;
        file.boot.value = dayjs(bt * 1000).format('YYYY-MM-DD HH:mm:ss (UTC Z)');
        file.statistic.value = `${result.ok.toLocaleString()} valid / ${result.error.length.toLocaleString()} error (${format_size(f.files[0].size)})`;

        const d = dayjs.duration(result.latest.timestamp);
        const hours = Math.floor(d.asHours());
        const minutes = d.minutes();
        const seconds = d.seconds();

        file.duration.value = '';

        if (hours > 0) file.duration.value += `${hours} hr `;
        if (minutes > 0) file.duration.value += `${minutes} min `;
        file.duration.value += `${seconds} sec`;

        init_chart();
        set_data(result.data);
    };
}

const axis = {
    temp: { splits: [], min: 0, max: 0 },
    accel: { splits: [], min: 0, max: 0 },
    gyro: { splits: [], min: 0, max: 0 },
    speed: { splits: [], min: 0, max: 0 }
};

let resizeObserver = null;

function init_chart() {
    resizeObserver?.disconnect();

    if (chart.value) {
        chart.value.destroy();
    }

    const scales = {
        digital: {
            range: (u, d_min, d_max) => {
                if (d_min === null && d_max === null) {
                    return [null, null];
                } else {
                    return [0, 1];
                }
            }
        }
    };

    const axes = [
        {
            size: 35,
            values: (u, v) => v.map((x) => dayjs(x * 1000).format('HH:mm:ss')),
            stroke: () => (dark.value ? '#fff' : '#000'),
            ticks: { stroke: () => (dark.value ? '#24282b' : '#ededed') },
            grid: { stroke: () => (dark.value ? '#24282b' : '#ededed') }
        },
        {
            scale: 'digital',
            size: 20,
            values: (u, v) => v.map((x) => (x ? 'HI' : 'LO')),
            splits: () => [0, 1],
            stroke: () => (dark.value ? '#fff' : '#000'),
            ticks: { show: false },
            grid: { stroke: () => (dark.value ? '#24282b' : '#ededed') }
        }
    ];

    for (const [i, [k, o]] of Object.entries(units).entries()) {
        axis[k] = { splits: [], min: 0, max: 0 };

        scales[k] = {
            range: (u, d_min, d_max) => {
                if (d_min === null && d_max === null) {
                    return [null, null];
                } else {
                    axis[k] = split_range(d_min, d_max);
                    return [axis[k].min, axis[k].max];
                }
            }
        };

        axes.push({
            scale: k,
            side: i % 2 ? 1 : 3,
            size: 50 + (o.unit.length - 1) * 6,
            values: (u, v) => v.map((x) => `${digit(x)}${o.unit}`),
            splits: () => axis[k].splits,
            stroke: () => (dark.value ? '#fff' : '#000'),
            ticks: { stroke: () => (dark.value ? '#24282b' : '#ededed') },
            grid: { stroke: () => (dark.value ? '#24282b' : '#ededed') }
        });

        fmt[k] = (u, v, sidx, didx) => {
            const d = u.data[sidx];

            if (didx == null && d) {
                const i = d.findLastIndex((x) => x !== null);

                if (i !== -1) {
                    v = d[i];
                } else {
                    v = d[d.length - 1];
                }
            }

            if (isNaN(v) || v === null || v === undefined) {
                return '-';
            } else {
                return `${digit(v)} ${o.unit}`;
            }
        };
    }

    const series = [
        { value: fmt.time },
        { label: views.digital.ch.din1.name, value: fmt.digital, scale: 'digital', spanGaps: true, show: false, stroke: colors[0] },
        { label: views.digital.ch.din2.name, value: fmt.digital, scale: 'digital', spanGaps: true, show: false, stroke: colors[1] },
        { label: views.digital.ch.din3.name, value: fmt.digital, scale: 'digital', spanGaps: true, show: false, stroke: colors[2] },
        { label: views.digital.ch.din4.name, value: fmt.digital, scale: 'digital', spanGaps: true, show: false, stroke: colors[3] },
        { label: views.analog.ch.ain1.name, value: fmt[views.analog.ch.ain1.unit], scale: views.analog.ch.ain1.unit || 'Volt', spanGaps: true, show: false, stroke: colors[4] },
        { label: views.analog.ch.ain2.name, value: fmt[views.analog.ch.ain2.unit], scale: views.analog.ch.ain2.unit || 'Volt', spanGaps: true, show: false, stroke: colors[5] },
        { label: views.analog.ch.ain3.name, value: fmt[views.analog.ch.ain3.unit], scale: views.analog.ch.ain3.unit || 'Volt', spanGaps: true, show: false, stroke: colors[6] },
        { label: views.analog.ch.ain4.name, value: fmt[views.analog.ch.ain4.unit], scale: views.analog.ch.ain4.unit || 'Volt', spanGaps: true, show: false, stroke: colors[7] },
        { label: views.analog.ch.ain5.name, value: fmt[views.analog.ch.ain5.unit], scale: views.analog.ch.ain5.unit || 'Volt', spanGaps: true, show: false, stroke: colors[8] },
        { label: views.analog.ch.ain6.name, value: fmt[views.analog.ch.ain6.unit], scale: views.analog.ch.ain6.unit || 'Volt', spanGaps: true, show: false, stroke: colors[9] },
        { label: views.analog.ch.volt.name, value: fmt.Volt, scale: 'Volt', spanGaps: true, show: false, stroke: colors[10] },
        { label: views.analog.ch.temp.name, value: fmt.Temperature, scale: 'Temperature', spanGaps: true, show: false, stroke: colors[11] },
        { label: 'Ax', value: fmt.Acceleration, scale: 'Acceleration', spanGaps: true, show: false, stroke: colors[12] },
        { label: 'Ay', value: fmt.Acceleration, scale: 'Acceleration', spanGaps: true, show: false, stroke: colors[13] },
        { label: 'Az', value: fmt.Acceleration, scale: 'Acceleration', spanGaps: true, show: false, stroke: colors[14] },
        { label: 'Gx', value: fmt['Angular Velocity'], scale: 'Angular Velocity', spanGaps: true, show: false, stroke: colors[15] },
        { label: 'Gy', value: fmt['Angular Velocity'], scale: 'Angular Velocity', spanGaps: true, show: false, stroke: colors[16] },
        { label: 'Gz', value: fmt['Angular Velocity'], scale: 'Angular Velocity', spanGaps: true, show: false, stroke: colors[17] },
        { label: 'SPD', value: fmt.Speed, scale: 'Speed', spanGaps: true, show: false, stroke: colors[18] }
    ];

    // VEHICLE 채널 (조향 엔코더 + CAN 유래 모터/배터리 값) — fixed 채널(index 19) 뒤에 고정 블록으로 추가
    for (const [key, ch] of Object.entries(views.vehicle.ch)) {
        series.push({
            label: ch.name,
            value: fmt[ch.unit],
            scale: ch.unit,
            spanGaps: true,
            show: false,
            stroke: colors[series.length - 1]
        });
    }

    for (const [k, o] of Object.entries(can_decoder)) {
        for (const x of o) {
            series.push({
                label: x.name,
                stroke: colors[series.length - 1],
                value: fmt[x.unit],
                points: { show: false },
                pxAlign: 0,
                scale: x.unit,
                spanGaps: true,
                show: false
            });
        }
    }

    const initWidth = container.value?.clientWidth || 600;

    chart.value = new uPlot(
        {
            width: initWidth,
            height: initWidth * 0.6,
            cursor: {
                hover: {
                    prox: 10,
                    bias: 0,
                    skip: [null]
                }
            },
            scales: scales,
            series: series,
            axes: axes,
            plugins: [plugin_touch_zoom(), plugin_wheel_zoom()]
        },
        null,
        graph.value
    );

    resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
            chart.value.setSize({
                width: entry.contentRect.width,
                height: entry.contentRect.width * 0.6
            });
        }
    });
    resizeObserver.observe(container.value);
}

function set_data(raw) {
    events.value = [];
    const can_map = {};
    const dataset = Array.from({ length: chart.value.series.length }, () => []);

    for (const data of raw) {
        switch (data.type) {
            case 'DIGITAL':
                dataset[0].push(bt + data.timestamp / 1000);
                dataset[1].push(data.digital.din1);
                dataset[2].push(data.digital.din2);
                dataset[3].push(data.digital.din3);
                dataset[4].push(data.digital.din4);

                for (let i = 5; i < dataset.length; i++) {
                    dataset[i].push(null);
                }
                break;

            case 'ANALOG':
                dataset[0].push(bt + data.timestamp / 1000);
                dataset[5].push(convert.adc_to_v(data.analog.ain1) * views.analog.ch.ain1.multiplier * (views.analog.ch.ain1.divider ? 0.5 : 1));
                dataset[6].push(convert.adc_to_v(data.analog.ain2) * views.analog.ch.ain2.multiplier * (views.analog.ch.ain2.divider ? 0.5 : 1));
                dataset[7].push(convert.adc_to_v(data.analog.ain3) * views.analog.ch.ain3.multiplier * (views.analog.ch.ain3.divider ? 0.5 : 1));
                dataset[8].push(convert.adc_to_v(data.analog.ain4) * views.analog.ch.ain4.multiplier * (views.analog.ch.ain4.divider ? 0.5 : 1));
                dataset[9].push(convert.adc_to_v(data.analog.ain5) * views.analog.ch.ain5.multiplier);
                dataset[10].push(convert.adc_to_v(data.analog.ain6) * views.analog.ch.ain6.multiplier);
                dataset[11].push(convert.adc_to_v(data.analog.voltage) * views.analog.ch.volt.multiplier);
                dataset[12].push(data.analog.temperature * views.analog.ch.temp.multiplier);

                for (let i = 1; i < dataset.length; i++) {
                    if (i < 5 || i > 12) {
                        dataset[i].push(null);
                    }
                }
                break;

            case 'GYROSCOPE':
                dataset[0].push(bt + data.timestamp / 1000);
                dataset[13].push(convert.accel_to_g(data.gyro.accel_x));
                dataset[14].push(convert.accel_to_g(data.gyro.accel_y));
                dataset[15].push(convert.accel_to_g(data.gyro.accel_z));
                dataset[16].push(convert.gyro_to_dps(data.gyro.gyro_x));
                dataset[17].push(convert.gyro_to_dps(data.gyro.gyro_y));
                dataset[18].push(convert.gyro_to_dps(data.gyro.gyro_z));

                for (let i = 1; i < dataset.length; i++) {
                    if (i < 13 || i > 18) {
                        dataset[i].push(null);
                    }
                }
                break;

            case 'GPS':
                dataset[0].push(bt + data.timestamp / 1000);
                dataset[19].push(data.gps.speed);

                for (let i = 1; i < dataset.length; i++) {
                    if (i !== 19) {
                        dataset[i].push(null);
                    }
                }

                path.value.push([data.gps.latitude, data.gps.longitude, data.gps.speed]);
                path_history.push(data);
                break;

            case 'VEHICLE':
                dataset[0].push(bt + data.timestamp / 1000);

                VEHICLE_KEYS.forEach((key, i) => {
                    dataset[VEHICLE_START + 1 + i].push(data.vehicle[key]);
                });

                for (let i = 1; i < dataset.length; i++) {
                    if (i <= VEHICLE_START || i > CAN_START) {
                        dataset[i].push(null);
                    }
                }
                break;

            case 'CAN':
                if (!can_map[data.can.id]) {
                    can_map[data.can.id] = { id: data.can.id, extended: data.can.extended, count: 0, prev_ts: data.timestamp, interval_sum: 0, len: data.can.len, latest_data: data.can.data };
                } else {
                    can_map[data.can.id].interval_sum += data.timestamp - can_map[data.can.id].prev_ts;
                    can_map[data.can.id].prev_ts = data.timestamp;
                }
                can_map[data.can.id].count++;
                can_map[data.can.id].latest_data = data.can.data;

                if (can_decoder[data.can.id]) {
                    const exist = [];

                    for (const decoder of can_decoder[data.can.id]) {
                        if (decoder._filter && !can_filter_match(data.can.data, decoder._filter, decoder._mask)) {
                            continue;
                        }

                        let v;

                        if (decoder.mode === 'byte') {
                            v = convert.can_byte(data.can.data, decoder.start, decoder.end, decoder.endian);
                        } else {
                            v = convert.can_bit(data.can.data, decoder.start, decoder.end);
                        }

                        if (decoder.sign) {
                            v = signed(v, (decoder.end - decoder.start + 1) * (decoder.mode === 'byte' ? 8 : 1));
                        }

                        dataset[CAN_START + decoder.idx].push(v * decoder.multiplier + decoder.offset);
                        exist.push(decoder.idx);
                    }

                    if (exist.length) {
                        dataset[0].push(bt + data.timestamp / 1000);

                        for (let i = 1; i < dataset.length; i++) {
                            if (i <= CAN_START || !exist.includes(i - CAN_START)) {
                                dataset[i].push(null);
                            }
                        }
                    }
                }
                break;

            case 'SYSTEM':
            case 'USER_EVENT':
                events.value.push({
                    time: dayjs(bt * 1000 + data.timestamp).format('HH:mm:ss.SSS'),
                    type: data.type === 'SYSTEM' ? 'SYS' : 'USR',
                    msg: data.type === 'SYSTEM' ? data.sys.msg : data.user.msg
                });
                break;
        }
    }

    can_stats.value = Object.values(can_map)
        .sort((a, b) => a.id - b.id)
        .map((s) => ({
            ...s,
            id_hex: s.extended ? `0x${s.id.toString(16).toUpperCase().padStart(8, '0')}` : `0x${s.id.toString(16).toUpperCase().padStart(3, '0')}`,
            freq: s.count > 1 ? (1000 / (s.interval_sum / (s.count - 1))).toFixed(1) : '-',
            period: s.count > 1 ? (s.interval_sum / (s.count - 1)).toFixed(1) : '-',
            data_hex: Array.from(s.latest_data).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
        }));

    chart.value.setData(dataset);

    if (path.value.length) {
        rebuild_hotline(map, line, path, hotlineMode.value);
        map.value.setView(path.value[0], 17);

        L.circleMarker(path.value[0], {
            color: '#00FF00',
            fillColor: '#00FF00',
            fillOpacity: 1,
            radius: 5
        }).addTo(map.value);

        L.circleMarker(path.value[path.value.length - 1], {
            color: '#FF0000',
            fillColor: '#FF0000',
            fillOpacity: 1,
            radius: 5
        }).addTo(map.value);

        timelapse_pos.value = L.circleMarker(path.value[0], {
            color: '#FF00FF',
            fillColor: '#FF00FF',
            fillOpacity: 1,
            radius: 5,
            pane: 'markerPane'
        }).addTo(map.value);

        timelapse_time.value = dayjs(bt * 1000 + path_history[0].timestamp).format('HH:mm:ss.SSS');
        timelapse_coord.value = `${path_history[0].gps.latitude.toFixed(7)}, ${path_history[0].gps.longitude.toFixed(7)}`;
        timelapse_speed.value = `${digit(path_history[0].gps.speed)} km/h`;
        timelapse_course.value = `${digit(path_history[0].gps.course)} °`;
    }
}

function toggle_axis(key) {
    switch (key) {
        case 'digital':
            for (let i = 1; i <= 4; i++) {
                chart.value.setSeries(i, { show: show[key].ref });
            }
            break;
        case 'analog':
            for (let i = 5; i <= 12; i++) {
                chart.value.setSeries(i, { show: show[key].ref });
            }
            break;
        case 'gyro':
            for (let i = 13; i <= 18; i++) {
                chart.value.setSeries(i, { show: show[key].ref });
            }
            break;
        case 'gps':
            chart.value.setSeries(19, { show: show[key].ref });
            break;
        case 'vehicle':
            for (let i = VEHICLE_START + 1; i <= CAN_START; i++) {
                chart.value.setSeries(i, { show: show[key].ref });
            }
            break;
        case 'can':
            for (let i = CAN_START + 1; i < chart.value.series.length; i++) {
                chart.value.setSeries(i, { show: show[key].ref });
            }
            break;
    }
}

function split_range(d_min, d_max) {
    if (d_min === d_max) {
        if (d_min === 0) {
            // [수정] 0===0일 때 0.85/1.15를 곱해도 여전히 0이라 step이 0/0=NaN이 되는 버그.
            // 값이 딱 0으로 고정된 축(정지 상태 자이로 등)에서 차트 전체가 깨지는 원인이었음.
            d_min = -1;
            d_max = 1;
        } else {
            d_min *= 0.85;
            d_max *= 1.15;
        }
    }

    const tick = 5;
    const step = (d_max - d_min) / (tick - 1);
    const min = Math.floor(d_min / step) * step;
    const max = min + step * tick;
    const splits = Array.from({ length: tick + 1 }, (_, i) => min + i * step);
    return { min, max, splits };
}

function switchHotlineMode(mode) {
    hotlineMode.value = mode;
    rebuild_hotline(map, line, path, mode);
}

function serialize_log(log) {
    const obj = { timestamp: log.timestamp, type: log.type };
    switch (log.type) {
        case 'DIGITAL':
            Object.assign(obj, log.digital);
            break;
        case 'ANALOG':
            Object.assign(obj, log.analog);
            break;
        case 'GYROSCOPE':
            Object.assign(obj, log.gyro);
            break;
        case 'GPS':
            Object.assign(obj, log.gps);
            break;
        case 'VEHICLE':
            Object.assign(obj, log.vehicle);
            break;
        case 'CAN':
            obj.id = log.can.id;
            obj.extended = log.can.extended;
            obj.remote = log.can.remote;
            obj.len = log.can.len;
            obj.data = Array.from(log.can.data).map(b => b.toString(16).padStart(2, '0')).join('');
            break;
        case 'SYSTEM':
            obj.msg = log.sys.msg;
            break;
        case 'USER_EVENT':
            obj.msg = log.user.msg;
            break;
    }
    return obj;
}

function trigger_download(blob, ext) {
    const name = file.name.value.replace(/\.[^.]+$/, '') + ext;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
}

function download_jsonl() {
    const chunks = [];
    for (const log of parsed_data.value) {
        chunks.push(JSON.stringify(serialize_log(log)));
    }
    trigger_download(new Blob([chunks.join('\n')], { type: 'application/x-jsonlines' }), '.jsonl');
}

function download_msgpack() {
    const data = parsed_data.value.map(serialize_log);
    trigger_download(new Blob([encode(data)], { type: 'application/x-msgpack' }), '.msgpack');
}

function timelapse() {
    if (!path.value.length || !timelapse_pos.value) {
        return;
    }

    const pos = Math.floor(((path.value.length - 1) * slider.value) / 100);
    timelapse_pos.value.setLatLng(path.value[pos]);
    timelapse_time.value = dayjs(bt * 1000 + path_history[pos].timestamp).format('HH:mm:ss.SSS');
    timelapse_coord.value = `${path_history[pos].gps.latitude.toFixed(7)}, ${path_history[pos].gps.longitude.toFixed(7)}`;
    timelapse_speed.value = `${digit(path_history[pos].gps.speed)} km/h`;
    timelapse_course.value = `${digit(path_history[pos].gps.course)} °`;
}
</script>

<template>
    <ConfirmDialog />
    <div class="grid grid-cols-12 gap-8">
        <div class="col-span-full lg:col-span-12">
            <div class="card">
                <div class="font-semibold text-xl">File</div>
                <div class="flex justify-start mt-4 w-full" style="align-items: center">
                    <FileUpload mode="basic" accept=".log" @uploader="upload" :auto="true" customUpload chooseIcon="pi pi-file" chooseLabel="Select" />
                    <span class="ml-4"> {{ file.name.value ? file.name : 'Select a file to view' }}</span>
                </div>
                <div v-if="file.name" class="mt-6 space-y-5">
                    <div class="flex">
                        <span class="font-semibold w-24">Device:</span>
                        <span class="flex-1">{{ file.device }}</span>
                    </div>
                    <div class="flex">
                        <span class="font-semibold w-24">Logs:</span>
                        <span class="flex-1">{{ file.statistic }}</span>
                    </div>
                    <div class="flex">
                        <span class="font-semibold w-24">Boot:</span>
                        <span class="flex-1">{{ file.boot }}</span>
                    </div>
                    <div class="flex">
                        <span class="font-semibold w-24">Duration:</span>
                        <span class="flex-1">{{ file.duration }}</span>
                    </div>
                    <div v-if="parsed_data.length" class="flex items-center gap-2">
                        <span class="font-semibold w-24">Export:</span>
                        <Button label="JSONL" icon="pi pi-download" @click="download_jsonl" severity="secondary" size="small" />
                        <Button label="MessagePack" icon="pi pi-download" @click="download_msgpack" severity="secondary" size="small" />
                    </div>
                </div>
            </div>

            <div class="card" ref="container">
                <div class="font-semibold text-xl mb-6">Graph</div>
                <div v-show="chart">
                    <div class="flex flex-wrap justify-start items-center mb-6 gap-3">
                        <ToggleButton v-for="(tag, key) in show" :key="key" v-model="tag.ref" :onLabel="tag.name" :offLabel="tag.name" @click="toggle_axis(key)" />
                    </div>
                    <div class="chart" ref="graph"></div>
                    <span><span class="pi pi-info-circle mr-2 mt-6"></span> Click and drag to zoom, double click to reset.</span>
                </div>
                <div v-show="!chart" class="text-center text-gray-400">Please select a file to view the graph.</div>
            </div>

            <div v-if="views.gps.display.viewer" class="card">
                <div class="font-semibold text-xl mb-6">GPS</div>
                <div class="flex items-center mb-6 gap-4">
                    <span class="font-semibold">Trail</span>
                    <SelectButton
                        :modelValue="hotlineMode"
                        @update:modelValue="switchHotlineMode"
                        :options="[{ label: 'Speed', value: HOTLINE_MODE.SPEED }, { label: 'Time', value: HOTLINE_MODE.TIME }]"
                        optionLabel="label"
                        optionValue="value"
                        :allowEmpty="false"
                    />
                </div>
                <div class="flex items-center mb-6">
                    <span class="font-semibold mr-6">{{ timelapse_time }}</span>
                    <Slider v-model="slider" :step="0.01" class="w-full" @change="timelapse" />
                </div>
                <div class="mb-6 space-y-5">
                    <div class="flex">
                        <span class="font-semibold w-24">Coord:</span>
                        <Tag :value="timelapse_coord" severity="info" />
                    </div>
                    <div class="flex">
                        <span class="font-semibold w-24">Speed:</span>
                        <Tag :value="timelapse_speed" severity="info" />
                    </div>
                    <div class="flex">
                        <span class="font-semibold w-24">Course:</span>
                        <Tag :value="timelapse_course" severity="info" />
                    </div>
                </div>
                <div ref="gps" style="width: 100%; aspect-ratio: 1 / 0.7"></div>
            </div>

            <div v-if="views.can.display.viewer" class="card">
                <div class="font-semibold text-xl mb-6">CAN</div>
                <div v-if="can_stats.length" style="overflow-x: auto">
                    <DataTable :value="can_stats" size="small" stripedRows sortField="count" :sortOrder="-1">
                        <Column field="id_hex" header="ID" sortable :sortField="'id'" style="width: 10%; white-space: nowrap; font-family: monospace" />
                        <Column field="count" header="Count" sortable style="width: 10%; white-space: nowrap">
                            <template #body="{ data }">{{ data.count.toLocaleString() }}</template>
                        </Column>
                        <Column header="Interval" sortable sortField="freq" style="width: 10%; white-space: nowrap">
                            <template #body="{ data }">{{ data.freq === '-' ? '-' : `${data.freq} Hz (${data.period} ms)` }}</template>
                        </Column>
                        <Column field="len" header="DLC" sortable style="width: 10%; white-space: nowrap" />
                        <Column field="data_hex" header="Last Data" style="width: 10%; white-space: nowrap; font-family: monospace" />
                    </DataTable>
                </div>
                <div v-else-if="chart" class="text-center text-gray-400">No CAN data found.</div>
                <div v-else class="text-center text-gray-400">Please select a file to view CAN data.</div>
            </div>

            <div class="card">
                <div class="font-semibold text-xl mb-6">Events</div>
                <DataView :value="events">
                    <template #empty>
                        <div class="p-4 text-center text-gray-400">No events found.</div>
                    </template>
                    <template #list="slotProps">
                        <div class="flex flex-col">
                            <div v-for="(item, index) in slotProps.items" :key="index" class="flex items-center py-2 px-2 gap-2">
                                <div class="w-8 text-center">{{ index + 1 }}</div>
                                <Tag :value="item.time" severity="success" />
                                <Tag :value="item.type" :severity="item.msg.includes('FAIL') ? 'warn' : item.type === 'SYS' ? 'info' : 'primary'" />
                                <Tag :value="item.msg" severity="secondary" />
                            </div>
                        </div>
                    </template>
                </DataView>
            </div>

            <div class="card">
                <div class="font-semibold text-xl mb-6">DB</div>
                <DataView :value="sessions.slice(db_page * 4, db_page * 4 + 4)">
                    <template #empty>
                        <div class="p-4 text-center text-gray-400">No logged sessions.</div>
                    </template>
                    <template #list="{ items }">
                        <div class="flex flex-col gap-2">
                            <div v-for="s in items" :key="s.session" class="flex items-center justify-between py-2 px-2 gap-2">
                                <template v-if="editing_session === s.session">
                                    <InputText v-model="edit_name_value" size="small" class="flex-1" autofocus @keyup.enter="save_rename(s)" @keyup.esc="cancel_rename" />
                                    <Button icon="pi pi-check" severity="success" text @click="save_rename(s)" />
                                    <Button icon="pi pi-times" severity="secondary" text @click="cancel_rename" />
                                </template>
                                <template v-else>
                                    <span class="font-semibold cursor-pointer hover:underline" @click="load_session(s)">
                                        {{ s.name || dayjs(s.start).format('YYYY-MM-DD HH:mm:ss') }}
                                    </span>
                                    <div class="flex items-center gap-1" v-if="is_admin">
                                        <Button icon="pi pi-pencil" severity="secondary" text @click="start_rename(s)" />
                                         <Button icon="pi pi-trash" severity="danger" text @click="confirm_delete(s)" />
                                    </div>
                                </template>
                             </div>
                        </div>
                    </template>
                </DataView>
                <Paginator v-if="sessions.length > 4" :rows="4" :totalRecords="sessions.length" @page="(e) => (db_page = e.page)" />
            </div>
        </div>
    </div>
</template>
