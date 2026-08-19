import { ref } from 'vue';
import ToastEventBus from 'primevue/toasteventbus';

// 관리자 모드 유지 시간 — 이 시간이 지나면 자동으로 뷰어 모드로 전환됩니다.
const ADMIN_TTL_MS = 10 * 60 * 1000; // 10분

// 앱 전역에서 공유하는 관리자 상태. device.vue, viewer.vue 등 여러 컴포넌트에서
// import { is_admin } from '@/service/admin' 로 가져다 쓰면 항상 같은 값을 봅니다.
export const is_admin = ref(false);

let expire_timer = null;

// mqtt.js를 정적으로 import하면 mqtt.js -> admin.js -> mqtt.js 순환참조가 생기므로,
// 실제로 필요한 시점(관리자 진입/만료)에만 동적으로 불러와 재연결시킵니다.
async function reconnect_mqtt() {
    const { init_mqtt } = await import('@/service/mqtt');
    init_mqtt();
}

function schedule_expiry(remaining_ms) {
    if (expire_timer) {
        clearTimeout(expire_timer);
        expire_timer = null;
    }
    expire_timer = setTimeout(() => clear_admin_key(true), remaining_ms);
}

// mqtt.js의 publish()/init_mqtt()가 매 호출마다 이걸로 실시간 검사합니다.
// 타이머가 늦게 발화하거나 아예 이 모듈이 다른 탭에서 초기화되지 않았더라도,
// 실제 쓰기 동작 직전에 항상 만료 여부를 다시 확인하는 최종 방어선입니다.
export function has_valid_admin_key() {
    const key = localStorage.getItem('admin/key');
    const expires_at = Number(localStorage.getItem('admin/expires') || 0);
    return !!key && expires_at > Date.now();
}

export function get_active_admin_key() {
    return has_valid_admin_key() ? localStorage.getItem('admin/key') : null;
}

export function set_admin_key(key) {
    const trimmed = (key || '').trim();

    if (!trimmed) {
        clear_admin_key(false);
        return;
    }

    const expires_at = Date.now() + ADMIN_TTL_MS;
    localStorage.setItem('admin/key', trimmed);
    localStorage.setItem('admin/expires', String(expires_at));
    is_admin.value = true;
    schedule_expiry(ADMIN_TTL_MS);
    reconnect_mqtt();
}

export function clear_admin_key(expired = false) {
    const was_admin = is_admin.value;

    localStorage.removeItem('admin/key');
    localStorage.removeItem('admin/expires');
    is_admin.value = false;

    if (expire_timer) {
        clearTimeout(expire_timer);
        expire_timer = null;
    }

    if (was_admin) {
        reconnect_mqtt();
    }

    if (expired) {
        ToastEventBus.emit('add', {
            severity: 'info',
            summary: 'Admin Mode Expired',
            detail: '10분이 지나 자동으로 뷰어 모드로 전환되었습니다.',
            group: 'br',
            life: 6000
        });
    }
}

// 모듈이 처음 로드될 때(=앱이 처음 켜질 때) 딱 한 번 실행됩니다.
// 이전 세션에서 저장해둔 admin/expires가 아직 안 지났으면 남은 시간만큼 타이머를 다시 걸고,
// 이미 지났으면 즉시 정리합니다.
function init_admin_state() {
    const key = localStorage.getItem('admin/key');
    const expires_at = Number(localStorage.getItem('admin/expires') || 0);

    if (!key) {
        localStorage.removeItem('admin/expires');
        return;
    }

    if (!expires_at || expires_at <= Date.now()) {
        clear_admin_key(true);
        return;
    }

    is_admin.value = true;
    schedule_expiry(expires_at - Date.now());
}

init_admin_state();
