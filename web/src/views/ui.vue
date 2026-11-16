<script setup>
import { ref } from 'vue';
import { views, units, defaults } from '@/service/ui';
import { state } from '@/service/state';

import { useConfirm } from 'primevue/useconfirm';
import ToastEventBus from 'primevue/toasteventbus';

const confirm = useConfirm();

const file = ref('');

const display_import = ref(false);

function import_cfg(f) {
    f = f.files[0];

    if (!f) {
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            Object.assign(views, data.views);
            Object.assign(units, data.units);
            ToastEventBus.emit('add', { severity: 'success', summary: 'Configuration Imported', group: 'br', life: 5000 });
            display_import.value = false;
            window.location.reload();
        } catch (error) {
            ToastEventBus.emit('add', { severity: 'error', summary: 'Invalid Configuration File', group: 'br', life: 5000 });
        }
    };
    reader.readAsText(f);
    file.value = f.name;
}

function reset_cfg() {
    confirm.require({
        header: 'UI Reset Confirmation',
        message: 'Reset the UI configuration to default?',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: {
            label: 'Cancel',
            severity: 'secondary',
            outlined: true
        },
        acceptProps: {
            label: 'Reset',
            severity: 'danger'
        },
        accept: () => {
            Object.keys(views).forEach((key) => delete views[key]);
            Object.keys(units).forEach((key) => delete units[key]);
            Object.assign(views, defaults.views);
            Object.assign(units, defaults.units);
            ToastEventBus.emit('add', { severity: 'success', summary: 'UI Reset Done', group: 'br', life: 5000 });
            window.location.reload();
        }
    });
}

function export_cfg() {
    const data = JSON.stringify({ views: views, units: units }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
</script>

<template>
    <Fluid>
        <div class="flex flex-col md:flex-row gap-8">
            <div class="md:w-1/2">
                <div class="card flex flex-col gap-6">
                    <div class="font-semibold text-xl">Import / Export Configurations</div>
                    <span><span class="pi pi-info-circle mr-2"></span> Refresh the page to apply changes.</span>
                    <div class="flex gap-6">
                        <Button class="flex-1" label="Import" icon="pi pi-file-import" severity="success" @click="display_import = true" />
                        <Button class="flex-1" label="Export" icon="pi pi-file-export" severity="info" @click="export_cfg" />
                        <Button class="flex-1" label="Reset" icon="pi pi-sparkles" severity="danger" @click="reset_cfg" />
                    </div>
                </div>

                <div class="card flex flex-col gap-4">
                    <div class="font-semibold text-xl mb-2">Display</div>
                    <div>
                        <div class="text-lg font-semibold">Telemetry</div>
                        <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <template v-for="(view, key) in views" :key="key">
                                <li class="flex items-center justify-between cardview">
                                    <label :for="key" class="font-medium pr-3">{{ view.name }}</label>
                                    <ToggleSwitch :inputId="key" v-model="view.display.telemetry" />
                                </li>
                            </template>
                        </ul>
                    </div>
                    <div>
                        <div class="text-lg font-semibold">Viewer</div>
                        <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <li class="flex items-center justify-between cardview">
                                <label for="viewer-gps" class="font-medium pr-3">GPS</label>
                                <ToggleSwitch inputId="viewer-gps" v-model="views.gps.display.viewer" />
                            </li>
                            <li class="flex items-center justify-between cardview">
                                <label for="viewer-can" class="font-medium pr-3">CAN</label>
                                <ToggleSwitch inputId="viewer-can" v-model="views.can.display.viewer" />
                            </li>
                        </ul>
                    </div>
                </div>

                <div class="card flex flex-col gap-4">
                    <div class="font-semibold text-xl mb-2">System State</div>
                    <ul class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <template v-for="item in state" :key="item.name">
                            <li v-if="item.name" class="flex items-center justify-between cardview">
                                <label :for="'state-' + item.name" class="font-medium pr-3">{{ item.name }}</label>
                                <ToggleSwitch :inputId="'state-' + item.name" :modelValue="!item.hidden" @update:modelValue="(v) => (item.hidden = !v)" />
                            </li>
                        </template>
                    </ul>
                </div>
            </div>

            <ConfirmDialog style="maxwidth: 400px" />

            <Dialog v-model:visible="display_import" modal header="Import UI Configurations" :style="{ width: '25rem' }">
                <div class="flex justify-start mt-4 w-full" style="align-items: center">
                    <FileUpload mode="basic" accept=".json" @uploader="import_cfg" :auto="true" customUpload chooseIcon="pi pi-file" chooseLabel="Select" />
                    <span class="ml-4"> {{ file.value ? file.value : 'Select a file to import' }}</span>
                </div>
            </Dialog>

        </div>
    </Fluid>
</template>

<style>
input[type='number'] {
    -moz-appearance: textfield !important;
    appearance: textfield !important;
}

input[type='number']::-webkit-outer-spin-button,
input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none !important;
    display: none !important;
    margin: 0;
}
</style>
