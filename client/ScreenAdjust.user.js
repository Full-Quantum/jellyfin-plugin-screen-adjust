// ==UserScript==
// @name         Jellyfin Screen Adjust
// @namespace    jellyfin-screen-adjust
// @version      1.0.25
// @description  Apply per-user playback size, position, and border presets in Jellyfin Web.
// @match        http://*/web/*
// @match        https://*/web/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    if (window.__screenAdjustLoaded) {
        return;
    }
    window.__screenAdjustLoaded = true;

    const profileUrl = '../ScreenAdjust/profile';
    const defaultBorderColor = '#ffffff';
    let profile;
    let activePreset;
    let previewPreset;
    let loadErrorReported = false;
    let pendingSettingsMenuUntil = 0;

    function createPresetId() {
        if (globalThis.crypto?.randomUUID) {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function isEditableTarget(target) {
        return target instanceof Element
            && (target.matches('input, textarea, select')
                || target.isContentEditable
                || target.closest('[contenteditable]:not([contenteditable="false"])'));
    }

    function normalizePreset(preset) {
        const color = preset.borderColor ?? preset.BorderColor;
        return {
            id: preset.id ?? preset.Id,
            name: preset.name ?? preset.Name,
            widthPercent: preset.widthPercent ?? preset.WidthPercent,
            heightPercent: preset.heightPercent ?? preset.HeightPercent,
            offsetXPercent: preset.offsetXPercent ?? preset.OffsetXPercent,
            offsetYPercent: preset.offsetYPercent ?? preset.OffsetYPercent,
            borderEnabled: preset.borderEnabled ?? preset.BorderEnabled ?? false,
            borderColor: /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : defaultBorderColor,
            borderWidthPx: preset.borderWidthPx ?? preset.BorderWidthPx ?? 4,
            borderTransparencyPercent: preset.borderTransparencyPercent
                ?? preset.BorderTransparencyPercent
                ?? 0
        };
    }

    function getBorderOutline(preset) {
        const color = /^#[0-9a-fA-F]{6}$/.test(preset.borderColor || '')
            ? preset.borderColor
            : defaultBorderColor;
        const width = Math.max(1, Math.min(20, Number(preset.borderWidthPx) || 4));
        const transparency = Math.max(
            0,
            Math.min(100, Number(preset.borderTransparencyPercent) || 0));
        const red = Number.parseInt(color.slice(1, 3), 16);
        const green = Number.parseInt(color.slice(3, 5), 16);
        const blue = Number.parseInt(color.slice(5, 7), 16);
        return preset.borderEnabled
            ? `${width}px solid rgba(${red}, ${green}, ${blue}, ${(100 - transparency) / 100})`
            : '';
    }

    async function apiRequest(path, method = 'GET', body) {
        const apiClient = globalThis.ApiClient;
        if (typeof apiClient?.setRequestHeaders !== 'function'
            || typeof apiClient.serverAddress !== 'function') {
            throw new Error('Jellyfin Web request authorization is not available.');
        }

        const headers = {};
        apiClient.setRequestHeaders(headers);
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const serverAddress = apiClient.serverAddress();
        if (!serverAddress) {
            throw new Error('Could not determine the connected Jellyfin server address.');
        }

        const response = await fetch(new URL(path, `${serverAddress.replace(/\/+$/, '')}/`), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(`Jellyfin returned HTTP ${response.status} for Screen Adjust.`);
        }
        return response.status === 204 ? null : response.json();
    }

    function getActivePreset() {
        if (profile.useFullSize) {
            return null;
        }
        const selectedPersonal = profile.presets.find((preset) => preset.id === profile.selectedPresetId);
        const selectedDefault = profile.defaultPresets.find(
            (preset) => preset.id === profile.selectedDefaultPresetId);
        return selectedPersonal || selectedDefault || profile.defaultPresets[0] || null;
    }

    function applyPreset() {
        if (!profile) {
            return;
        }
        activePreset = previewPreset || getActivePreset();
        document.querySelectorAll('video').forEach((video) => {
            if (!activePreset) {
                video.style.removeProperty('transform');
                video.style.removeProperty('transform-origin');
                video.style.removeProperty('outline');
                video.style.removeProperty('outline-offset');
                video.removeAttribute('data-screen-adjust');
                return;
            }

            const width = Math.max(50, Math.min(100, Number(activePreset.widthPercent)));
            const height = Math.max(50, Math.min(100, Number(activePreset.heightPercent)));
            const x = Math.max(-20, Math.min(20, Number(activePreset.offsetXPercent)));
            const y = Math.max(-20, Math.min(20, Number(activePreset.offsetYPercent)));
            video.style.transformOrigin = 'center center';
            video.style.transform = `translate(${x}vw, ${y}vh) scale(${width / 100}, ${height / 100})`;
            video.style.outline = getBorderOutline(activePreset);
            video.style.outlineOffset = '0px';
            video.setAttribute('data-screen-adjust', 'true');
        });
    }

    async function saveProfile() {
        await apiRequest(profileUrl, 'PUT', profile);
    }

    async function reloadProfile() {
        const response = await apiRequest(profileUrl);
        profile = {
            presets: (response.presets ?? response.Presets ?? []).map(normalizePreset),
            defaultPresets: (response.defaultPresets ?? response.DefaultPresets ?? []).map(normalizePreset),
            selectedPresetId: response.selectedPresetId ?? response.SelectedPresetId ?? null,
            selectedDefaultPresetId: response.selectedDefaultPresetId
                ?? response.SelectedDefaultPresetId
                ?? null,
            useFullSize: response.useFullSize ?? response.UseFullSize ?? false
        };
        profile.presets ||= [];
        profile.defaultPresets ||= [];
        profile.selectedDefaultPresetId ||= null;
        profile.useFullSize ||= false;
        applyPreset();
    }

    async function initializeAdminPage() {
        const page = document.querySelector('#screenAdjustConfigPage');
        if (!page || page.dataset.screenAdjustInitialized === 'true') {
            return;
        }

        page.dataset.screenAdjustInitialized = 'true';
        const list = page.querySelector('#screenAdjustPresets');
        const status = page.querySelector('#screenAdjustStatus');
        const addButton = page.querySelector('#screenAdjustAdd');
        const restoreButton = page.querySelector('#screenAdjustRestore');
        const saveButton = page.querySelector('#screenAdjustSave');
        const builtInPresets = [
            normalizePreset({ id: 'default', name: 'Default', widthPercent: 100, heightPercent: 100, offsetXPercent: 0, offsetYPercent: 0 }),
            normalizePreset({ id: 'centered-50', name: '50% - Centered', widthPercent: 50, heightPercent: 50, offsetXPercent: 0, offsetYPercent: 0 }),
            normalizePreset({ id: 'centered-75', name: '75% - Centered', widthPercent: 75, heightPercent: 75, offsetXPercent: 0, offsetYPercent: 0 }),
            normalizePreset({ id: 'centered-85', name: '85% - Centered', widthPercent: 85, heightPercent: 85, offsetXPercent: 0, offsetYPercent: 0 })
        ];

        const addRow = (preset) => {
            const row = document.createElement('fieldset');
            row.className = 'screen-adjust-preset';
            row.dataset.id = preset.id || createPresetId();
            row.innerHTML = `
                <legend>Default preset</legend>
                <label>Name <input class="preset-name" maxlength="40" required></label>
                <label>Width % <input class="preset-width" type="number" min="50" max="100" required></label>
                <label>Height % <input class="preset-height" type="number" min="50" max="100" required></label>
                <label>Horizontal offset % <input class="preset-x" type="number" min="-20" max="20" step="0.1" required></label>
                <label>Vertical offset % <input class="preset-y" type="number" min="-20" max="20" step="0.1" required></label>
                <label><input class="preset-border-enabled" type="checkbox"> Enable border</label>
                <label>Border color <input class="preset-border-color" type="color"></label>
                <label>Border width (px) <input class="preset-border-width" type="number" min="1" max="20" required></label>
                <label>Border transparency % <input class="preset-border-transparency" type="number" min="0" max="100" required></label>
                <button class="preset-remove" type="button">Remove</button>`;
            row.querySelector('.preset-name').value = preset.name || '';
            row.querySelector('.preset-width').value = preset.widthPercent ?? 90;
            row.querySelector('.preset-height').value = preset.heightPercent ?? 90;
            row.querySelector('.preset-x').value = preset.offsetXPercent ?? 0;
            row.querySelector('.preset-y').value = preset.offsetYPercent ?? 0;
            row.querySelector('.preset-border-enabled').checked = preset.borderEnabled ?? false;
            row.querySelector('.preset-border-color').value = preset.borderColor ?? defaultBorderColor;
            row.querySelector('.preset-border-width').value = preset.borderWidthPx ?? 4;
            row.querySelector('.preset-border-transparency').value = preset.borderTransparencyPercent ?? 0;
            row.querySelector('.preset-remove').addEventListener('click', () => row.remove());
            list.appendChild(row);
        };

        const loadPresets = async () => {
            const response = await apiRequest('../ScreenAdjust/defaults');
            const presets = response.map(normalizePreset);
            list.replaceChildren();
            presets.forEach(addRow);
        };

        const readRows = () => [...list.querySelectorAll('.screen-adjust-preset')].map((row) => ({
            id: row.dataset.id,
            name: row.querySelector('.preset-name').value.trim(),
            widthPercent: Number(row.querySelector('.preset-width').value),
            heightPercent: Number(row.querySelector('.preset-height').value),
            offsetXPercent: Number(row.querySelector('.preset-x').value),
            offsetYPercent: Number(row.querySelector('.preset-y').value),
            borderEnabled: row.querySelector('.preset-border-enabled').checked,
            borderColor: row.querySelector('.preset-border-color').value,
            borderWidthPx: Number(row.querySelector('.preset-border-width').value),
            borderTransparencyPercent: Number(row.querySelector('.preset-border-transparency').value)
        }));

        addButton.addEventListener('click', () => {
            if (list.querySelectorAll('.screen-adjust-preset').length >= 20) {
                status.textContent = 'A maximum of 20 shared presets is supported.';
                return;
            }

            addRow({
                id: createPresetId(),
                name: 'New preset',
                widthPercent: 90,
                heightPercent: 90,
                offsetXPercent: 0,
                offsetYPercent: 0,
                borderEnabled: false,
                borderColor: defaultBorderColor,
                borderWidthPx: 4,
                borderTransparencyPercent: 0
            });
        });

        restoreButton.addEventListener('click', async () => {
            try {
                await loadPresets();
                const builtInIds = new Set(builtInPresets.map((preset) => preset.id));
                const current = readRows().filter((preset) => !builtInIds.has(preset.id));
                list.replaceChildren();
                current.concat(builtInPresets).forEach(addRow);
                status.textContent = 'Built-in presets restored. Click Save defaults to apply them for everyone.';
            } catch (error) {
                console.error('Screen Adjust could not restore built-in defaults.', error);
                status.textContent = `Could not restore built-in defaults: ${error.message || error}`;
            }
        });

        saveButton.addEventListener('click', async () => {
            const presets = readRows();
            if (presets.length > 20 || presets.some((preset) =>
                !preset.name || !Number.isFinite(preset.widthPercent)
                || !Number.isFinite(preset.heightPercent)
                || !Number.isFinite(preset.offsetXPercent)
                || !Number.isFinite(preset.offsetYPercent)
                || !/^#[0-9a-fA-F]{6}$/.test(preset.borderColor)
                || !Number.isFinite(preset.borderWidthPx)
                || !Number.isFinite(preset.borderTransparencyPercent)
                || preset.widthPercent < 50 || preset.widthPercent > 100
                || preset.heightPercent < 50 || preset.heightPercent > 100
                || preset.offsetXPercent < -20 || preset.offsetXPercent > 20
                || preset.offsetYPercent < -20 || preset.offsetYPercent > 20
                || preset.borderWidthPx < 1 || preset.borderWidthPx > 20
                || preset.borderTransparencyPercent < 0 || preset.borderTransparencyPercent > 100)) {
                status.textContent = 'Check preset values. Sizes must be 50-100%, offsets -20-20%, border width 1-20 px, and transparency 0-100%.';
                return;
            }

            try {
                await apiRequest('../ScreenAdjust/defaults', 'PUT', presets);
                await loadPresets();
                status.textContent = 'Defaults saved.';
            } catch (error) {
                console.error('Screen Adjust could not save defaults.', error);
                status.textContent = `Could not save defaults: ${error.message || error}`;
            }
        });

        try {
            await loadPresets();
            status.textContent = '';
        } catch (error) {
            console.error('Screen Adjust could not load defaults.', error);
            status.textContent = `Could not load defaults: ${error.message || error}`;
        }
    }

    function promptForPreset(existing) {
        const name = prompt('Preset name:', existing?.name || 'CRT preset');
        if (name === null || !name.trim()) {
            return null;
        }

        const readNumber = (label, current, minimum, maximum, allowDecimal = false) => {
            const value = prompt(`${label} (${minimum} to ${maximum}):`, String(current));
            const pattern = allowDecimal ? /^-?\d+(?:\.\d+)?$/ : /^-?\d+$/;
            if (value === null || !pattern.test(value.trim())) {
                return null;
            }
            const parsed = Number(value);
            return parsed >= minimum && parsed <= maximum ? parsed : null;
        };

        const widthPercent = readNumber('Width percent', existing?.widthPercent ?? 90, 50, 100);
        const heightPercent = readNumber('Height percent', existing?.heightPercent ?? 90, 50, 100);
        const offsetXPercent = readNumber('Horizontal offset percent', existing?.offsetXPercent ?? 0, -20, 20, true);
        const offsetYPercent = readNumber('Vertical offset percent', existing?.offsetYPercent ?? 0, -20, 20, true);
        if ([widthPercent, heightPercent, offsetXPercent, offsetYPercent].some((value) => value === null)) {
            alert('Values were not saved. Sizes must be 50-100 and offsets -20 to 20.');
            return null;
        }

        const borderChoice = prompt(
            'Enable a border for this preset? (y/n)',
            existing?.borderEnabled ? 'y' : 'n');
        if (borderChoice === null) {
            return null;
        }
        const borderEnabled = borderChoice.trim().toLowerCase();
        if (!['y', 'n'].includes(borderEnabled)) {
            alert('Choose y or n for the border option.');
            return null;
        }

        let borderColor = existing?.borderColor || defaultBorderColor;
        let borderWidthPx = existing?.borderWidthPx ?? 4;
        let borderTransparencyPercent = existing?.borderTransparencyPercent ?? 0;
        if (borderEnabled === 'y') {
            const enteredColor = prompt('Border color (six-digit hex, e.g. #ffffff):', borderColor);
            if (enteredColor === null) {
                return null;
            }
            if (!/^#[0-9a-fA-F]{6}$/.test(enteredColor.trim())) {
                alert('Border color must be a six-digit hex value such as #ffffff.');
                return null;
            }
            borderColor = enteredColor.trim();
            borderWidthPx = readNumber('Border width in pixels', borderWidthPx, 1, 20);
            borderTransparencyPercent = readNumber(
                'Border transparency percent',
                borderTransparencyPercent,
                0,
                100);
            if (borderWidthPx === null || borderTransparencyPercent === null) {
                alert('Border width must be 1-20 pixels and transparency must be 0-100%.');
                return null;
            }
        }

        return {
            id: existing?.id || createPresetId(),
            name: name.trim().slice(0, 40),
            widthPercent,
            heightPercent,
            offsetXPercent,
            offsetYPercent,
            borderEnabled: borderEnabled === 'y',
            borderColor,
            borderWidthPx,
            borderTransparencyPercent
        };
    }

    async function openPresetMenu() {
        if (!profile) {
            alert('Screen Adjust is still loading. Try again in a moment.');
            return;
        }

        const options = profile.presets
            .map((preset, index) => `${index + 1}. Apply ${preset.name}`)
            .concat(profile.defaultPresets.map((preset, index) =>
                `${profile.presets.length + index + 1}. Apply server preset: ${preset.name}`))
            .concat(['A. Add a personal preset']);
        if (profile.presets.length) {
            options.push('E. Edit selected personal preset', 'D. Delete selected personal preset');
        }
        options.push('0. Use server default');

        const choice = prompt(`Screen Adjust\n\n${options.join('\n')}\n\nEnter a choice:`);
        if (choice === null) {
            return;
        }

        const normalized = choice.trim().toLowerCase();
        if (normalized === '0') {
            profile.selectedPresetId = null;
            profile.selectedDefaultPresetId = null;
            profile.useFullSize = false;
        } else if (normalized === 'a') {
            if (profile.presets.length >= 20) {
                alert('A maximum of 20 personal presets is supported.');
                return;
            }
            const preset = promptForPreset();
            if (preset) {
                profile.presets.push(preset);
                profile.selectedPresetId = preset.id;
                profile.selectedDefaultPresetId = null;
                profile.useFullSize = false;
            } else {
                return;
            }
        } else if (normalized === 'e' || normalized === 'd') {
            const selected = profile.presets.find((preset) => preset.id === profile.selectedPresetId)
                || profile.presets[0];
            if (!selected) {
                return;
            }
            if (normalized === 'e') {
                const updated = promptForPreset(selected);
                if (!updated) {
                    return;
                }
                profile.presets = profile.presets.map((preset) => preset.id === updated.id ? updated : preset);
            } else {
                profile.presets = profile.presets.filter((preset) => preset.id !== selected.id);
                profile.selectedPresetId = profile.presets[0]?.id || null;
                profile.selectedDefaultPresetId = null;
                profile.useFullSize = false;
            }
        } else {
            const index = Number(normalized) - 1;
            if (!Number.isInteger(index) || index < 0
                || index >= profile.presets.length + profile.defaultPresets.length) {
                return;
            }
            if (index < profile.presets.length) {
                profile.selectedPresetId = profile.presets[index].id;
                profile.selectedDefaultPresetId = null;
                profile.useFullSize = false;
            } else {
                profile.selectedPresetId = null;
                profile.selectedDefaultPresetId = profile.defaultPresets[index - profile.presets.length].id;
                profile.useFullSize = false;
            }
        }

        try {
            await saveProfile();
            applyPreset();
        } catch (error) {
            console.error('Screen Adjust could not save this account profile.', error);
            alert(`Could not save your Screen Adjust profile: ${error.message || error}`);
        }
    }

    function createSlider(labelText, value, minimum, maximum) {
        const wrapper = document.createElement('label');
        wrapper.className = 'screen-adjust-control';
        const title = document.createElement('span');
        const output = document.createElement('output');
        const input = document.createElement('input');
        title.textContent = labelText;
        output.value = String(value);
        input.type = 'range';
        input.min = String(minimum);
        input.max = String(maximum);
        input.step = labelText.includes('position') ? '0.1' : '1';
        input.value = String(value);
        wrapper.append(title, output, input);
        return { wrapper, input, output };
    }

    function releaseEmptyMenuContainer(container) {
        if (!container || container.childElementCount !== 0) {
            return;
        }

        container.style.pointerEvents = 'none';
        const hasOpenDialog = [...document.querySelectorAll('.dialogContainer')]
            .some(candidate => candidate.childElementCount > 0)
            || document.querySelector('dialog[open], .dialog.opened');
        if (!hasOpenDialog) {
            document.querySelectorAll('.dialogBackdrop').forEach(backdrop => backdrop.remove());
        }
    }

    function closeSettingsMenu(menu) {
        const container = menu.closest('.dialogContainer');
        if (typeof menu.close === 'function') {
            menu.close();
        } else {
            menu.remove();
        }
        releaseEmptyMenuContainer(container);
        return container;
    }

    function openPlayerAdjustments(menuContainer) {
        if (!profile) {
            alert('Screen Adjust is still loading. Refresh Jellyfin Web and try again.');
            return;
        }

        document.querySelector('.screen-adjust-dialog')?.remove();
        const current = getActivePreset() || {
            id: null,
            name: profile.useFullSize ? 'Full size' : 'Custom',
            widthPercent: 100,
            heightPercent: 100,
            offsetXPercent: 0,
            offsetYPercent: 0,
            borderEnabled: false,
            borderColor: defaultBorderColor,
            borderWidthPx: 4,
            borderTransparencyPercent: 0
        };
        previewPreset = { ...current };

        const dialog = document.createElement('div');
        dialog.className = 'screen-adjust-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'screen-adjust-title');
        dialog.tabIndex = -1;
        const panel = document.createElement('section');
        panel.className = 'screen-adjust-player-panel';
        const header = document.createElement('header');
        const heading = document.createElement('h2');
        heading.id = 'screen-adjust-title';
        heading.textContent = 'Screen Adjust';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'screen-adjust-close emby-button';
        closeButton.setAttribute('aria-label', 'Close Screen Adjust');
        closeButton.textContent = '×';
        header.append(heading, closeButton);
        const description = document.createElement('p');
        description.textContent = 'Choose a shared or personal preset, or adjust the video live. Save a personal preset to keep your changes.';
        const presetSelect = document.createElement('select');
        presetSelect.setAttribute('aria-label', 'Select a screen preset');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a preset';
        presetSelect.appendChild(placeholder);
        profile.presets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = `personal:${preset.id}`;
            option.textContent = `Personal: ${preset.name}`;
            presetSelect.appendChild(option);
        });
        profile.defaultPresets.forEach((preset) => {
            const option = document.createElement('option');
            option.value = `default:${preset.id}`;
            option.textContent = `Shared: ${preset.name}`;
            presetSelect.appendChild(option);
        });
        if (current.id) {
            const kind = profile.presets.some((preset) => preset.id === current.id)
                ? 'personal'
                : 'default';
            presetSelect.value = `${kind}:${current.id}`;
        }

        const controls = document.createElement('div');
        controls.className = 'screen-adjust-player-controls';
        const status = document.createElement('p');
        status.className = 'screen-adjust-player-status';
        status.setAttribute('role', 'status');
        const presetName = document.createElement('input');
        presetName.type = 'text';
        presetName.maxLength = 40;
        presetName.value = `${current.name} copy`;
        presetName.setAttribute('aria-label', 'Personal preset name');
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'emby-button raised';
        saveButton.textContent = 'Save personal preset';
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'emby-button screen-adjust-delete';
        deleteButton.textContent = 'Delete selected personal preset';
        deleteButton.hidden = !presetSelect.value.startsWith('personal:');
        const restoreButton = document.createElement('button');
        restoreButton.type = 'button';
        restoreButton.className = 'emby-button screen-adjust-reset';
        restoreButton.textContent = 'Restore to default';

        const sliders = [
            createSlider('Width %', previewPreset.widthPercent, 50, 100),
            createSlider('Height %', previewPreset.heightPercent, 50, 100),
            createSlider('Horizontal position %', previewPreset.offsetXPercent, -20, 20),
            createSlider('Vertical position %', previewPreset.offsetYPercent, -20, 20)
        ];
        const sliderKeys = ['widthPercent', 'heightPercent', 'offsetXPercent', 'offsetYPercent'];
        const updateSliders = (preset) => {
            sliders.forEach(({ input, output }, index) => {
                input.value = String(preset[sliderKeys[index]]);
                output.value = input.value;
            });
        };
        sliders.forEach(({ wrapper, input, output }, index) => {
            input.addEventListener('input', () => {
                previewPreset[sliderKeys[index]] = Number(input.value);
                output.value = input.value;
                applyPreset();
            });
            controls.appendChild(wrapper);
        });

        const borderEnabledLabel = document.createElement('label');
        const borderEnabledInput = document.createElement('input');
        borderEnabledInput.type = 'checkbox';
        borderEnabledInput.setAttribute('aria-label', 'Enable border');
        borderEnabledLabel.append(borderEnabledInput, document.createTextNode(' Enable border'));
        const borderColorLabel = document.createElement('label');
        borderColorLabel.textContent = 'Border color ';
        const borderColorInput = document.createElement('input');
        borderColorInput.type = 'color';
        borderColorInput.setAttribute('aria-label', 'Border color');
        borderColorLabel.appendChild(borderColorInput);
        const borderWidthSlider = createSlider(
            'Border width (px)',
            previewPreset.borderWidthPx ?? 4,
            1,
            20);
        const borderTransparencySlider = createSlider(
            'Border transparency %',
            previewPreset.borderTransparencyPercent ?? 0,
            0,
            100);
        const updateBorderControls = (preset) => {
            borderEnabledInput.checked = preset.borderEnabled ?? false;
            borderColorInput.value = preset.borderColor || defaultBorderColor;
            borderWidthSlider.input.value = String(preset.borderWidthPx ?? 4);
            borderWidthSlider.output.value = borderWidthSlider.input.value;
            borderTransparencySlider.input.value = String(preset.borderTransparencyPercent ?? 0);
            borderTransparencySlider.output.value = borderTransparencySlider.input.value;
        };
        borderEnabledInput.addEventListener('change', () => {
            previewPreset.borderEnabled = borderEnabledInput.checked;
            applyPreset();
        });
        borderColorInput.addEventListener('input', () => {
            previewPreset.borderColor = borderColorInput.value;
            applyPreset();
        });
        borderWidthSlider.input.addEventListener('input', () => {
            previewPreset.borderWidthPx = Number(borderWidthSlider.input.value);
            borderWidthSlider.output.value = borderWidthSlider.input.value;
            applyPreset();
        });
        borderTransparencySlider.input.addEventListener('input', () => {
            previewPreset.borderTransparencyPercent = Number(borderTransparencySlider.input.value);
            borderTransparencySlider.output.value = borderTransparencySlider.input.value;
            applyPreset();
        });
        controls.append(
            borderEnabledLabel,
            borderColorLabel,
            borderWidthSlider.wrapper,
            borderTransparencySlider.wrapper);
        updateBorderControls(previewPreset);

        const style = document.createElement('style');
        style.textContent = `
            .screen-adjust-player-panel { box-sizing: border-box; max-height: 85vh; overflow-y: auto; padding: 1em; min-width: min(22em, 80vw); }
            .screen-adjust-dialog { position: fixed; inset: 0; z-index: 1000000; display: grid; place-items: center; box-sizing: border-box; padding: 1rem; background: rgba(0,0,0,.72); }
            .screen-adjust-player-panel { box-sizing: border-box; width: min(34rem, calc(100vw - 2rem)); max-height: min(85dvh, calc(100dvh - 2rem)); min-width: 0; overflow-y: auto; padding: 1.25rem; border: 1px solid rgba(255,255,255,.2); border-radius: .5rem; color: inherit; background: var(--backgroundFloating, #202020); }
            .screen-adjust-player-panel header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
            .screen-adjust-player-panel h2 { margin: 0 0 .5em; }
            .screen-adjust-player-panel .screen-adjust-close,
            .screen-adjust-player-panel .screen-adjust-reset,
            .screen-adjust-player-panel .screen-adjust-delete { color: #fff !important; background-color: #424242 !important; border: 1px solid rgba(255,255,255,.45); }
            .screen-adjust-close { min-width: 2.5rem; font-size: 1.4rem; }
            .screen-adjust-player-panel .screen-adjust-close:focus-visible,
            .screen-adjust-player-panel .screen-adjust-reset:focus-visible,
            .screen-adjust-player-panel .screen-adjust-delete:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
            .screen-adjust-player-panel p { margin: .5em 0; }
            .screen-adjust-player-controls { display: grid; gap: .7em; }
            .screen-adjust-control { display: grid; grid-template-columns: 1fr auto; gap: .25em .75em; align-items: center; }
            .screen-adjust-control input { grid-column: 1 / -1; width: 100%; }
            .screen-adjust-player-controls > label { display: flex; gap: .5em; align-items: center; }
            .screen-adjust-player-controls > label input[type="checkbox"] { width: auto; }
            .screen-adjust-player-panel > input,
            .screen-adjust-player-panel > select { box-sizing: border-box; width: 100%; margin: .75em 0; }
            .screen-adjust-player-panel > button { margin: .4rem .4rem .4rem 0; }
            .screen-adjust-player-status { min-height: 1.3em; }
        `;

        if (!document.querySelector('#screen-adjust-player-styles')) {
            style.id = 'screen-adjust-player-styles';
            document.head.appendChild(style);
        }

        panel.append(
            header,
            description,
            presetSelect,
            controls,
            presetName,
            saveButton,
            deleteButton,
            restoreButton,
            status);
        dialog.appendChild(panel);
        document.body.appendChild(dialog);
        dialog.focus();
        let persistedSelection = presetSelect.value;

        const updateDeleteButton = () => {
            deleteButton.hidden = !presetSelect.value.startsWith('personal:');
        };

        presetSelect.addEventListener('change', async () => {
            updateDeleteButton();
            const [kind, id] = presetSelect.value.split(':', 2);
            const presets = kind === 'personal' ? profile.presets : profile.defaultPresets;
            const selected = presets.find((preset) => preset.id === id);
            if (!selected) {
                status.textContent = 'That preset is no longer available. Reload the page and try again.';
                return;
            }

            const previousPreview = previewPreset
                ? { ...previewPreset }
                : {
                    id: null,
                    name: profile.useFullSize ? 'Full size' : 'Custom',
                    widthPercent: profile.useFullSize ? 100 : 90,
                    heightPercent: profile.useFullSize ? 100 : 90,
                    offsetXPercent: 0,
                    offsetYPercent: 0
                };
            const previousSelection = persistedSelection;
            const previousName = presetName.value;
            const previousFullSize = profile.useFullSize;
            previewPreset = { ...selected };
            updateSliders(previewPreset);
            updateBorderControls(previewPreset);
            presetName.value = `${selected.name} copy`;
            const previousPersonalId = profile.selectedPresetId;
            const previousDefaultId = profile.selectedDefaultPresetId;
            profile.useFullSize = false;
            profile.selectedPresetId = kind === 'personal' ? id : null;
            profile.selectedDefaultPresetId = kind === 'default' ? id : null;
            applyPreset();
            try {
                await saveProfile();
                persistedSelection = presetSelect.value;
                status.textContent = `Using "${selected.name}". Adjustments apply immediately.`;
            } catch (error) {
                profile.selectedPresetId = previousPersonalId;
                profile.selectedDefaultPresetId = previousDefaultId;
                profile.useFullSize = previousFullSize;
                previewPreset = previousPreview;
                updateSliders(previewPreset);
                updateBorderControls(previewPreset);
                presetSelect.value = persistedSelection;
                updateDeleteButton();
                presetName.value = previousName;
                applyPreset();
                status.textContent = `Could not save preset selection: ${error.message || error}`;
            }
        });

        deleteButton.addEventListener('click', async () => {
            const [, id] = presetSelect.value.split(':', 2);
            const selected = profile.presets.find((preset) => preset.id === id);
            if (!selected || !confirm(`Delete the personal preset "${selected.name}"?`)) {
                return;
            }

            const previousPresets = profile.presets;
            const previousPersonalId = profile.selectedPresetId;
            const previousDefaultId = profile.selectedDefaultPresetId;
            const previousFullSize = profile.useFullSize;
            const previousPreview = { ...previewPreset };
            const previousSelection = persistedSelection;
            profile.presets = profile.presets.filter((preset) => preset.id !== id);
            profile.selectedPresetId = profile.presets[0]?.id || null;
            profile.selectedDefaultPresetId = null;
            profile.useFullSize = false;
            previewPreset = null;
            applyPreset();
            try {
                await saveProfile();
                presetSelect.querySelector(`option[value="personal:${CSS.escape(id)}"]`)?.remove();
                const fallbackSelection = profile.selectedPresetId
                    ? `personal:${profile.selectedPresetId}`
                    : '';
                presetSelect.value = fallbackSelection;
                persistedSelection = fallbackSelection;
                const fallback = getActivePreset() || {
                    widthPercent: 100,
                    heightPercent: 100,
                    offsetXPercent: 0,
                    offsetYPercent: 0,
                    borderEnabled: false,
                    borderColor: defaultBorderColor,
                    borderWidthPx: 4,
                    borderTransparencyPercent: 0
                };
                updateSliders(fallback);
                updateBorderControls(fallback);
                presetName.value = `${fallback.name || 'Custom'} copy`;
                updateDeleteButton();
                status.textContent = 'Personal preset deleted.';
            } catch (error) {
                profile.presets = previousPresets;
                profile.selectedPresetId = previousPersonalId;
                profile.selectedDefaultPresetId = previousDefaultId;
                profile.useFullSize = previousFullSize;
                previewPreset = previousPreview;
                presetSelect.value = previousSelection;
                updateDeleteButton();
                updateSliders(previewPreset);
                updateBorderControls(previewPreset);
                applyPreset();
                status.textContent = `Could not delete preset: ${error.message || error}`;
            }
        });

        saveButton.addEventListener('click', async () => {
            const name = presetName.value.trim();
            if (!name) {
                status.textContent = 'Enter a name for this preset.';
                presetName.focus();
                return;
            }
            if (profile.presets.length >= 20) {
                status.textContent = 'A maximum of 20 personal presets is supported.';
                return;
            }

            const preset = { ...previewPreset, id: createPresetId(), name: name.slice(0, 40) };
            const previousPersonalId = profile.selectedPresetId;
            const previousDefaultId = profile.selectedDefaultPresetId;
            const previousFullSize = profile.useFullSize;
            const previousSelection = persistedSelection;
            profile.presets.push(preset);
            profile.selectedPresetId = preset.id;
            profile.selectedDefaultPresetId = null;
            profile.useFullSize = false;
            try {
                await saveProfile();
                previewPreset = { ...preset };
                const option = document.createElement('option');
                option.value = `personal:${preset.id}`;
                option.textContent = `Personal: ${preset.name}`;
                presetSelect.appendChild(option);
                presetSelect.value = option.value;
                persistedSelection = option.value;
                updateDeleteButton();
                applyPreset();
                status.textContent = 'Personal preset saved.';
            } catch (error) {
                profile.presets = profile.presets.filter((item) => item.id !== preset.id);
                profile.selectedPresetId = previousPersonalId;
                profile.selectedDefaultPresetId = previousDefaultId;
                profile.useFullSize = previousFullSize;
                presetSelect.value = previousSelection;
                updateDeleteButton();
                status.textContent = `Could not save preset: ${error.message || error}`;
            }
        });

        restoreButton.addEventListener('click', async () => {
            const previousPersonalId = profile.selectedPresetId;
            const previousDefaultId = profile.selectedDefaultPresetId;
            const previousFullSize = profile.useFullSize;
            const previousPreview = { ...previewPreset };
            profile.selectedPresetId = null;
            profile.selectedDefaultPresetId = null;
            profile.useFullSize = true;
            previewPreset = {
                id: null,
                name: 'Full size',
                widthPercent: 100,
                heightPercent: 100,
                offsetXPercent: 0,
                offsetYPercent: 0
            };
            applyPreset();
            try {
                await saveProfile();
                persistedSelection = '';
                presetSelect.value = '';
                updateDeleteButton();
                presetName.value = 'Full size copy';
                updateSliders({
                    widthPercent: 100,
                    heightPercent: 100,
                    offsetXPercent: 0,
                    offsetYPercent: 0,
                    borderEnabled: false,
                    borderColor: defaultBorderColor,
                    borderWidthPx: 4,
                    borderTransparencyPercent: 0
                });
                updateBorderControls(previewPreset);
                status.textContent = 'Restored to full-size, centered playback.';
            } catch (error) {
                profile.selectedPresetId = previousPersonalId;
                profile.selectedDefaultPresetId = previousDefaultId;
                profile.useFullSize = previousFullSize;
                previewPreset = previousPreview;
                applyPreset();
                status.textContent = `Could not restore defaults: ${error.message || error}`;
            }
        });

        const closeDialog = () => {
            previewPreset = null;
            applyPreset();
            dialog.remove();
            releaseEmptyMenuContainer(menuContainer);
            document.body.classList.remove('noScroll');
        };
        closeButton.addEventListener('click', closeDialog);
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                closeDialog();
            }
        });
        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog();
            }
        });
    }

    function addPlayerMenuItem(menu) {
        if (menu.dataset.screenAdjustAdded === 'true'
            || !menu.querySelector('.actionSheetMenuItem')) {
            return false;
        }

        const scroller = menu.querySelector('.actionSheetScroller');
        if (!scroller) {
            return false;
        }
        menu.dataset.screenAdjustAdded = 'true';
        menu.dataset.screenAdjustBounded = 'true';
        if (!document.querySelector('#screen-adjust-menu-styles')) {
            const style = document.createElement('style');
            style.id = 'screen-adjust-menu-styles';
            style.textContent = `
                .actionSheet[data-screen-adjust-bounded="true"] {
                    animation: none !important;
                    transition: none !important;
                    transform: none !important;
                    position: fixed !important;
                    top: auto !important;
                    left: auto !important;
                    right: 1rem !important;
                    bottom: 8rem !important;
                    margin: 0 !important;
                    max-height: calc(100vh - 9rem) !important;
                }
                .actionSheet[data-screen-adjust-bounded="true"] .actionSheetScroller {
                    max-height: calc(100vh - 11rem);
                    max-height: calc(100dvh - 11rem);
                    overflow-y: auto;
                    overscroll-behavior: contain;
                }
            `;
            document.head.appendChild(style);
        }
        const item = document.createElement('button');
        item.setAttribute('is', 'emby-button');
        item.type = 'button';
        item.className = 'listItem listItem-button actionSheetMenuItem';
        item.dataset.id = 'screenadjust';
        const icon = document.createElement('span');
        icon.className = 'listItemIcon listItemIcon-transparent material-icons';
        icon.textContent = 'crop_free';
        const text = document.createElement('div');
        text.className = 'listItemBody actionSheetItemText';
        text.textContent = 'Screen Adjust';
        item.append(icon, text);
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const container = closeSettingsMenu(menu);
            openPlayerAdjustments(container);
        });
        scroller.insertBefore(item, scroller.firstChild);
        const container = menu.closest('.dialogContainer');
        if (container) {
            container.style.pointerEvents = '';
        }
        return true;
    }

    function injectPlayerMenuItem() {
        if (Date.now() > pendingSettingsMenuUntil) {
            return;
        }
        const menu = [...document.querySelectorAll('.actionSheet')]
            .find((candidate) => candidate.querySelector('.actionSheetMenuItem')
                && candidate.dataset.screenAdjustAdded !== 'true');
        if (menu) {
            if (addPlayerMenuItem(menu)) {
                pendingSettingsMenuUntil = 0;
            }
        }
    }

    document.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.btnVideoOsdSettings')) {
            pendingSettingsMenuUntil = Date.now() + 5000;
            setTimeout(injectPlayerMenuItem, 0);
        }
    }, true);

    window.addEventListener('keydown', (event) => {
        const target = event.target instanceof Element
            ? event.target
            : document.activeElement;
        if (isEditableTarget(target)) {
            event.stopImmediatePropagation();
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (isEditableTarget(event.target)) {
            return;
        }

        if (event.altKey && event.shiftKey && event.code === 'KeyS') {
            event.preventDefault();
            openPresetMenu();
        }
    });

    const observer = new MutationObserver(() => {
        applyPreset();
        initializeAdminPage();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    initializeAdminPage();

    const menuObserver = new MutationObserver(injectPlayerMenuItem);
    menuObserver.observe(document.documentElement, { childList: true, subtree: true });

    reloadProfile().catch((error) => {
        if (!loadErrorReported) {
            console.error('Screen Adjust could not load this account profile.', error);
            loadErrorReported = true;
        }
    });
})();
