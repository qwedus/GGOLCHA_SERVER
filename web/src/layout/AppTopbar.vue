<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useLayout } from '@/layout/composables/layout';
import AppConfigurator from './AppConfigurator.vue';
import { connection } from '@/service/state';

const { toggleMenu, toggleDarkMode, isDarkTheme } = useLayout();

const connectionsOpen = ref(false);
const connectionsWrapper = ref(null);

const toggle_connections = () => {
    connectionsOpen.value = !connectionsOpen.value;
};

function handleOutsideClick(event) {
    if (connectionsOpen.value && connectionsWrapper.value && !connectionsWrapper.value.contains(event.target)) {
        connectionsOpen.value = false;
    }
}

onMounted(() => document.addEventListener('click', handleOutsideClick));
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick));
</script>

<template>
    <div class="layout-topbar">
        <div class="layout-topbar-logo-container">
            <button class="layout-menu-button layout-topbar-action" @click="toggleMenu">
                <i class="pi pi-bars"></i>
            </button>
            <router-link to="/" class="layout-topbar-logo">
                <img src="/honeycar.png" alt="logo" class="layout-topbar-logo-image" />
                <span>GGOOL CHA</span>
            </router-link>
        </div>

        <div class="layout-topbar-actions">
            <div class="layout-config-menu">
                <button type="button" class="layout-topbar-action" @click="toggleDarkMode">
                    <i :class="['pi', { 'pi-moon': isDarkTheme, 'pi-sun': !isDarkTheme }]"></i>
                </button>

                <AppConfigurator />

                <div class="connections-wrapper" ref="connectionsWrapper">
                    <button type="button" class="layout-topbar-action" @click="toggle_connections">
                        <i class="pi pi-sitemap" :class="connection.status"></i>
                        <span>Connections</span>
                    </button>

                    <div v-if="connectionsOpen" class="connections-panel">
                        <div class="flex flex-col gap-4">
                            <div>Server <Tag :value="connection.server.value" :severity="connection.server.severity" class="ml-2"></Tag></div>
                            <div>Device <Tag :value="connection.device.value" :severity="connection.device.severity" class="ml-2"></Tag></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* .layout-topbar가 position: fixed라, 이 안에서는 position:relative + position:absolute만으로
   스크롤과 무관하게 버튼 바로 아래에 항상 고정된다. */
.connections-wrapper {
    position: relative;
}

.connections-panel {
    position: absolute;
    top: calc(100% + 0.75rem);
    right: 0;
    z-index: 1000;
    min-width: 12rem;
    padding: 1rem;
    border-radius: var(--content-border-radius, 12px);
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
</style>
