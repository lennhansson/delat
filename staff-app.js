const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubIndex = urlDelar.indexOf('pub');
const pubId = (pubIndex !== -1 && urlDelar[pubIndex + 1]) ? urlDelar[pubIndex + 1] : "default_pub";

let nuvarandeState = null;
let staffYtPlayer = null;
let aktivUniqueId = null;
let lanseradUniqueId = null; // commandDone-handskakning
let currentStopPos = 0;
let timeWatcher = null;
let editingMomentType = null;
let editingMomentCategory = null;
let selectedVideoId = null, selectedTitle = null, selectedSongTitle = null, selectedThumbnail = null;
let hasInteracted = false;
let playerRecoveryTimer = null;
let momentScheduleTimer = null;
const localCreatedPlaylists = new Set();

const ORDERED_PLAYLISTS = ["happy birthday to you", "acdc", "celiks lista", "saras lista", "la muzika", "favoriter", "before i ieave", "highway man"];

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatScheduleLabel(cfg) {
    const schedule = getMomentScheduleConfig(cfg);
    if (!schedule.enabled) return 'Ingen trigger';
    const dayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
    const dayLabels = (schedule.weekdays || []).map(code => {
        const idx = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(code);
        const dayName = idx >= 0 ? dayNames[idx] : code;
        return `${dayName} ${schedule.times[code] || schedule.time}`;
    });
    const daysText = dayLabels.length ? dayLabels.join(', ') : 'Inga dagar valda';
    return `Trigger: ${daysText}`;
}

function getMomentScheduleConfig(cfg) {
    const schedule = cfg?.schedule || {};
    const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
    const times = schedule.times && typeof schedule.times === 'object' && !Array.isArray(schedule.times) ? { ...schedule.times } : {};
    weekdays.forEach(day => {
        if (!times[day]) times[day] = schedule.time || '01:30';
    });
    return {
        enabled: !!schedule.enabled,
        time: schedule.time || '01:30',
        weekdays,
        times
    };
}

function checkScheduledMoments() {
    if (!document.getElementById('custom-drift') || !socket.connected) return;
    const state = nuvarandeState;
    if (!state?.scheduleEnabled || state.activeMoment || !state.momentsConfig) return;

    const now = new Date();
    const weekdayCode = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minuteStamp = `${dateStamp}T${timeStamp}`;
    const minuteKey = `jukebox:schedule-minute:${encodeURIComponent(pubId)}`;

    try {
        if (localStorage.getItem(minuteKey) === minuteStamp) return;
    } catch (error) {
        return;
    }

    for (const [momentType, cfg] of Object.entries(state.momentsConfig)) {
        const schedule = getMomentScheduleConfig(cfg);
        if (!schedule.enabled || !schedule.weekdays.includes(weekdayCode) || schedule.times[weekdayCode] !== timeStamp) continue;

        const firedKey = `jukebox:moment-fired:${encodeURIComponent(pubId)}:${encodeURIComponent(momentType)}`;
        try {
            if (localStorage.getItem(firedKey) === dateStamp) continue;
            localStorage.setItem(minuteKey, minuteStamp);
            localStorage.setItem(firedKey, dateStamp);
        } catch (error) {
            return;
        }

        try {
            socket.emit('moment:activate', { type: momentType });
        } catch (error) {
            console.error('Scheduled moment was not sent.', error);
        }
        return;
    }
}

function startMomentScheduleChecker() {
    if (!document.getElementById('custom-drift') || momentScheduleTimer) return;

    const checkAndScheduleNext = () => {
        try {
            checkScheduledMoments();
        } finally {
            momentScheduleTimer = setTimeout(checkAndScheduleNext, 60000 - (Date.now() % 60000) + 50);
        }
    };

    checkAndScheduleNext();
}

function syncScheduleDayTimeUI() {
    const enableEl = document.getElementById('modal-schedule-enable');
    const daysWrap = document.getElementById('modal-schedule-days');
    if (!daysWrap) return;
    daysWrap.querySelectorAll('[data-schedule-day]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const timeEl = row.querySelector('input[type="time"]');
        if (checkbox && timeEl) timeEl.disabled = !enableEl?.checked || !checkbox.checked;
    });
}

function syncScheduleFormUI() {
    const enableEl = document.getElementById('modal-schedule-enable');
    const bodyEl = document.getElementById('modal-schedule-body');
    if (!enableEl || !bodyEl) return;
    bodyEl.style.display = enableEl.checked ? 'block' : 'none';
    syncScheduleDayTimeUI();
}

function applyMomentScheduleToForm(cfg) {
    const enableEl = document.getElementById('modal-schedule-enable');
    const bodyEl = document.getElementById('modal-schedule-body');
    const daysWrap = document.getElementById('modal-schedule-days');
    if (!enableEl || !bodyEl || !daysWrap) return;

    const schedule = getMomentScheduleConfig(cfg);
    enableEl.checked = !!schedule.enabled;
    daysWrap.querySelectorAll('[data-schedule-day]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const timeEl = row.querySelector('input[type="time"]');
        if (!checkbox || !timeEl) return;
        checkbox.checked = schedule.weekdays.includes(checkbox.value);
        timeEl.value = schedule.times[checkbox.value] || schedule.time || '01:30';
    });
    bodyEl.style.display = enableEl.checked ? 'block' : 'none';
    syncScheduleDayTimeUI();
}

function getSelectedScheduleFromForm() {
    const enableEl = document.getElementById('modal-schedule-enable');
    const daysWrap = document.getElementById('modal-schedule-days');
    const weekdays = [];
    const times = {};
    daysWrap?.querySelectorAll('[data-schedule-day]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const timeEl = row.querySelector('input[type="time"]');
        if (!checkbox?.checked || !timeEl) return;
        weekdays.push(checkbox.value);
        times[checkbox.value] = timeEl.value || '01:30';
    });
    return {
        enabled: !!enableEl?.checked,
        time: times[weekdays[0]] || '01:30',
        weekdays,
        times
    };
}

function recoverFromPlayerError(reason) {
    console.warn('YouTube player recovery:', reason);
    lanseradUniqueId = null;
    aktivUniqueId = null;
    if (playerRecoveryTimer) clearTimeout(playerRecoveryTimer);
    socket.emit('player:skip');
    updatePlaybackButtonState();
}

function schedulePlayerRecovery() {
    if (playerRecoveryTimer) clearTimeout(playerRecoveryTimer);
    playerRecoveryTimer = setTimeout(() => {
        try {
            if (!staffYtPlayer || !nuvarandeState?.nowPlaying || !hasInteracted) return;
            const stateCode = staffYtPlayer.getPlayerState ? staffYtPlayer.getPlayerState() : -1;
            if (stateCode !== YT.PlayerState.PLAYING && stateCode !== YT.PlayerState.BUFFERING) {
                console.warn('Player stalled or unavailable; skipping current item.', { stateCode, videoId: nuvarandeState.nowPlaying.videoId });
                recoverFromPlayerError('player stalled');
            }
        } catch (error) {
            recoverFromPlayerError(error?.message || 'player health check failed');
        }
    }, 12000);
}

window.onYouTubeIframeAPIReady = function () {
    staffYtPlayer = new YT.Player("staff-yt-player", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 1, enablejsapi: 1, rel: 0, mute: 0, origin: window.location.origin },
        events: {
            onReady: () => { if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState); },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) triggaSpelareReady();
                if (e.data === YT.PlayerState.PLAYING) {
                    if (playerRecoveryTimer) clearTimeout(playerRecoveryTimer);
                    startWatcher();
                    if (nuvarandeState?.nowPlaying) {
                        lanseradUniqueId = nuvarandeState.nowPlaying.id;
                    }
                }
                if (e.data === YT.PlayerState.CUED || e.data === YT.PlayerState.PAUSED) {
                    if (hasInteracted && staffYtPlayer?.playVideo) {
                        try { staffYtPlayer.playVideo(); } catch (err) {}
                    }
                }
                updatePlaybackButtonState();
            },
            onError: (e) => recoverFromPlayerError(`YouTube error ${e?.data ?? 'unknown'}`)
        }
    });
};

if (!window.YT) {
    const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api";
    document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
} else if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
}

function startWatcher() {
    if (timeWatcher) clearInterval(timeWatcher);
    timeWatcher = setInterval(() => {
        if (staffYtPlayer?.getCurrentTime) {
            const now = staffYtPlayer.getCurrentTime();
            if (currentStopPos > 0 && now >= currentStopPos && now > 2) {
                triggaSpelareReady();
            }
        }
    }, 500);
}

function updatePlaybackButtonState() {
    const toggleBtn = document.getElementById('mobile-play-toggle');
    if (!toggleBtn) return;

    const currentState = staffYtPlayer?.getPlayerState ? staffYtPlayer.getPlayerState() : -1;
    const isPlaying = typeof YT !== 'undefined' && currentState === YT.PlayerState.PLAYING;
    toggleBtn.textContent = isPlaying ? '❚❚' : '▶';
    toggleBtn.setAttribute('aria-label', isPlaying ? 'Pausa ljud' : 'Spela upp ljud');
}

function togglePlayback() {
    if (!staffYtPlayer) {
        if (!nuvarandeState?.nowPlaying) socket.emit('player:skip');
        return;
    }

    const currentState = staffYtPlayer.getPlayerState ? staffYtPlayer.getPlayerState() : -1;
    if (currentState === YT.PlayerState.PLAYING) {
        staffYtPlayer.pauseVideo();
    } else {
        hasInteracted = true;
        try { staffYtPlayer.unMute(); } catch (e) {}
        if (!nuvarandeState?.nowPlaying) {
            socket.emit('player:skip');
        } else {
            const vidIdStr = String(nuvarandeState.nowPlaying.videoId || '');
            if (vidIdStr && staffYtPlayer.loadVideoById) {
                aktivUniqueId = nuvarandeState.nowPlaying.id;
                currentStopPos = nuvarandeState.nowPlaying.stopPosition || 0;
                const loadOptions = { videoId: vidIdStr, startSeconds: nuvarandeState.nowPlaying.startPosition || 0 };
                if (currentStopPos > loadOptions.startSeconds) loadOptions.endSeconds = currentStopPos;
                staffYtPlayer.loadVideoById(loadOptions);
            }
            if (staffYtPlayer.playVideo) {
                try { staffYtPlayer.playVideo(); } catch (e) {}
            }
        }
    }

    updatePlaybackButtonState();
}

function startaSpelaren() {
    hasInteracted = true;
    if (!nuvarandeState?.nowPlaying) {
        socket.emit('player:skip');
    } else if (staffYtPlayer) {
        try { staffYtPlayer.unMute(); } catch (e) {}
        const vidIdStr = String(nuvarandeState.nowPlaying.videoId || '');
        if (vidIdStr && staffYtPlayer.loadVideoById) {
            aktivUniqueId = nuvarandeState.nowPlaying.id;
            currentStopPos = nuvarandeState.nowPlaying.stopPosition || 0;
            const loadOptions = { videoId: vidIdStr, startSeconds: nuvarandeState.nowPlaying.startPosition || 0 };
            if (currentStopPos > loadOptions.startSeconds) loadOptions.endSeconds = currentStopPos;
            staffYtPlayer.loadVideoById(loadOptions);
        }
        if (staffYtPlayer.playVideo) {
            try { staffYtPlayer.playVideo(); } catch (e) {}
        }
    }
    updatePlaybackButtonState();
}

function uppdateraStaffPlayer(state) {
    if (!staffYtPlayer?.loadVideoById) return;
    if (state.activeMoment?.type === 'pause') { staffYtPlayer.stopVideo(); aktivUniqueId = null; lanseradUniqueId = null; updatePlaybackButtonState(); return; }
    if (!state.nowPlaying) { if (aktivUniqueId !== null) { staffYtPlayer.stopVideo(); aktivUniqueId = null; lanseradUniqueId = null; } updatePlaybackButtonState(); return; }

    const vidIdStr = String(state.nowPlaying.videoId || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(vidIdStr)) {
        console.warn('Skipping invalid or unavailable YouTube ID:', vidIdStr);
        recoverFromPlayerError('invalid video id');
        return;
    }

    if (state.nowPlaying.id !== aktivUniqueId && vidIdStr.length > 0) {
        aktivUniqueId = state.nowPlaying.id;
        currentStopPos = state.nowPlaying.stopPosition || 0;
        const loadOptions = { videoId: vidIdStr, startSeconds: state.nowPlaying.startPosition || 0 };
        if (currentStopPos > loadOptions.startSeconds) loadOptions.endSeconds = currentStopPos;
        staffYtPlayer.loadVideoById(loadOptions);
        schedulePlayerRecovery();
    }
}

function triggaSpelareReady() {
    if (!lanseradUniqueId) return;
    if (timeWatcher) clearInterval(timeWatcher);

    const idToFinish = lanseradUniqueId;
    lanseradUniqueId = null;
    aktivUniqueId = null;

    socket.emit("player:ready_for_next", { currentVideoId: idToFinish });
}

function getSortedPlaylistNames(valv) {
    const allNames = Object.keys(valv || {});
    const sorted = [];
    ORDERED_PLAYLISTS.forEach(name => { if (allNames.includes(name)) sorted.push(name); });
    const remaining = allNames.filter(n => !ORDERED_PLAYLISTS.includes(n)).sort();
    return [...sorted, ...remaining];
}

function bytHuvudLista() {
    const val = document.getElementById("select-main-playlist")?.value;
    socket.emit('player:byt_valv', { valvNamn: val || "" });
}

function bytTempLista() {
    const val = document.getElementById("select-temp-playlist")?.value;
    socket.emit(val ? 'ADD_TEMP_PLAYLIST' : 'REMOVE_TEMP_PLAYLIST', { playlist: val });
}

function fillMobileDropdowns(state) {
    const mainSel = document.getElementById("select-main-playlist");
    const tempSel = document.getElementById("select-temp-playlist");
    const editSel = document.getElementById("select-edit-playlist");
    if (!mainSel && !editSel) return;

    const allPlaylists = getSortedPlaylistNames(state.valv);
    const masterListor = (state.masterPlaylists || []).map(l => l.toLowerCase().trim());
    const editablePlaylists = Array.from(new Set([
        ...Object.keys(state.valv || {}).filter(p => !masterListor.includes(p.toLowerCase().trim())),
        ...localCreatedPlaylists
    ])).sort();

    if (mainSel) {
        const currentMain = mainSel.value;
        mainSel.innerHTML = '<option value="">Välj lista...</option>' +
            allPlaylists.map(p => `<option value="${p}">${p.toUpperCase()}</option>`).join("");
        mainSel.value = state.aktivHuvudlista || currentMain || "";
    }

    if (tempSel) {
        const currentTemp = tempSel.value;
        tempSel.innerHTML = '<option value="">Ingen extra lista</option>' +
            allPlaylists.map(p => `<option value="${p}">${p.toUpperCase()}</option>`).join("");
        tempSel.value = state.aktivTillfalligLista || currentTemp || "";
    }

    if (editSel) {
        const currentVal = editSel.value;
        if (editablePlaylists.length === 0) {
            editSel.innerHTML = '<option value="">-- Inga egna spellistor --</option>';
        } else {
            editSel.innerHTML = '<option value="">Välj egen lista...</option>' +
                editablePlaylists.map(p => `<option value="${p}">${p.toUpperCase()} (EGEN)</option>`).join("");
        }
        if (currentVal) {
            let opt = Array.from(editSel.options).find(o => o.value.toLowerCase() === currentVal.toLowerCase());
            if (!opt) {
                opt = document.createElement("option");
                opt.value = currentVal;
                opt.innerText = currentVal.toUpperCase() + ' (EGEN)';
                editSel.appendChild(opt);
            }
            editSel.value = currentVal;
        }
    }
}

function updateMobileMomentSelect(state) {
    const mobileSelect = document.getElementById('select-moment-type');
    if (!mobileSelect || !state?.momentsConfig) return;

    const currentValue = mobileSelect.value;
    const entries = Object.keys(state.momentsConfig).map(key => ({
        key,
        label: (state.momentsConfig[key]?.title || key).toUpperCase()
    }));

    mobileSelect.innerHTML = '<option value="">Välj Moment...</option>' + entries.map(({ key, label }) => `
        <option value="${key}">${label}</option>
    `).join('');
    if (currentValue) mobileSelect.value = currentValue;
}

function updateMomentsUI(state) {
    if (!state.momentsConfig) return;

    const summaryEl = document.getElementById('moment-trigger-summary');
    const scheduled = Object.entries(state.momentsConfig)
        .filter(([, cfg]) => getMomentScheduleConfig(cfg).enabled)
        .map(([key, cfg]) => `<div><strong>${escapeHtml(cfg.title || key)}</strong> — ${escapeHtml(formatScheduleLabel(cfg))}</div>`);
    if (summaryEl) {
        if (scheduled.length) {
            summaryEl.innerHTML = scheduled.join('');
        } else {
            summaryEl.textContent = 'Inga aktiva triggers ännu.';
        }
    }

    updateMobileMomentSelect(state);

    const launchpad = document.getElementById('custom-drift');
    const hasDesktopMomentLayout = !!launchpad;
    if (!hasDesktopMomentLayout) {
        const stopBtnMobile = document.getElementById("btn-stop-moment");
        if (stopBtnMobile) stopBtnMobile.style.display = state.activeMoment ? "block" : "none";
        return;
    }
    ['drift', 'firande', 'avslut'].forEach(c => {
        const el = document.getElementById('custom-' + c);
        if (el) el.innerHTML = '';
    });
    Object.keys(state.momentsConfig).forEach(key => {
        const cfg = state.momentsConfig[key];
        const descEl = document.getElementById(`txt-${key}-desc`);
        const card = document.getElementById(`m-${key}`);
        const displaySong = cfg.songTitle || cfg.title || "-";
        if (card) {
            card.classList.toggle('active', state.activeMoment?.type === key);
            if (descEl) descEl.innerHTML = `<strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${displaySong}</small><br><small style="color:#81d4fa;">${escapeHtml(formatScheduleLabel(cfg))}</small>`;
        } else if (key !== 'pause') {
            const container = document.getElementById('custom-' + (cfg.category || 'drift'));
            if (container) {
                const customCard = document.createElement('div');
                customCard.className = `moment-card moment-${cfg.category === 'drift' ? 'blue' : cfg.category === 'firande' ? 'gold' : 'red'}`;
                if (state.activeMoment?.type === key) customCard.classList.add('active');
                customCard.onclick = () => activateMoment(key);
                customCard.innerHTML = `<h4>${cfg.title.toUpperCase()}</h4><p><strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${displaySong}</small><br><small style="color:#81d4fa;">${escapeHtml(formatScheduleLabel(cfg))}</small></p><button class="edit-btn" onclick="openMomentEdit(event, '${key}')">⚙️</button>`;
                container.appendChild(customCard);
            }
        }
    });
    const stopBtn = document.getElementById("btn-stop-moment");
    if (stopBtn) stopBtn.style.display = state.activeMoment ? "block" : "none";
}

function skapaNyListaMobil() {
    const input = document.getElementById("txt-new-playlist");
    const name = input?.value?.trim()?.toLowerCase();
    if (!name) return;

    const masterListor = (nuvarandeState?.masterPlaylists || []).map(l => l.toLowerCase().trim());
    if (masterListor.includes(name)) {
        alert("Du kan inte skapa en spellista med samma namn som en låst master-spellista!");
        return;
    }

    localCreatedPlaylists.add(name);
    input.value = "";
    const select = document.getElementById("select-edit-playlist");
    if (select) {
        let opt = Array.from(select.options).find(o => o.value.toLowerCase() === name);
        if (!opt) {
            opt = document.createElement("option");
            opt.value = name;
            opt.innerText = name.toUpperCase() + ' (EGEN)';
            select.appendChild(opt);
        }
        select.value = name;
        uppdateraEditVyMobil(name);
    }
}

function uppdateraEditVyMobil(playlistName) {
    const content = document.getElementById("edit-view-content");
    const target = document.getElementById("edit-song-list-target");
    const titleEl = document.getElementById("edit-view-title");
    if (!content || !target) return;

    if (!playlistName) {
        content.style.display = "none";
        return;
    }

    content.style.display = "block";
    if (titleEl) titleEl.textContent = `Låtar i listan (${playlistName.toUpperCase()}):`;

    const songs = nuvarandeState?.valv?.[playlistName] || [];
    if (songs.length === 0) {
        target.innerHTML = "<div style='padding:8px; color:#888; font-size:12px;'>Inga låtar i listan. Sök ovan för att lägga till.</div>";
        return;
    }

    const safePName = playlistName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    target.innerHTML = songs.map(s => {
        const safeSTitle = (s.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #222; font-size:12px;">
                <span>${escapeHtml(s.title)}</span>
                <button style="color:#cd1a2b; background:none; border:none; font-weight:bold; padding:4px 8px; cursor:pointer;" onclick="taBortLatFranEdit('${safePName}', '${safeSTitle}')">✕</button>
            </div>
        `;
    }).join("");
}

function taBortLatFranEdit(playlistName, songTitle) {
    socket.emit('library:remove_song', { playlistName, songString: songTitle });
}

function sokLatTillEdit() {
    const q = document.getElementById("txt-edit-search")?.value?.trim();
    if (!q) return;
    const resEl = document.getElementById("edit-search-results");
    if (resEl) resEl.innerHTML = "<div style='padding:8px; color:#aaa; font-size:12px;'>Söker...</div>";
    socket.emit('search', { query: q });
}

function laggTillLatIEdit(playlistName, videoId, title, thumbnail, durationSeconds) {
    socket.emit('library:add_song', { playlistName, videoId, title, thumbnail, durationSeconds });
    const resEl = document.getElementById("edit-search-results");
    if (resEl) resEl.innerHTML = "";
    const searchInput = document.getElementById("txt-edit-search");
    if (searchInput) searchInput.value = "";
}

function addNewMoment(cat) {
    const name = prompt("Namn på momentet?");
    if (!name) return;
    editingMomentType = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    editingMomentCategory = cat;
    selectedTitle = name; selectedSongTitle = ""; selectedVideoId = null; selectedThumbnail = null;
    const modalTitle = document.getElementById("modal-title");
    if (modalTitle) modalTitle.innerText = "Nytt: " + name.toUpperCase();
    const msgInput = document.getElementById("modal-msg-input");
    if (msgInput) msgInput.value = "";
    const modal = document.getElementById("moment-modal");
    if (modal) modal.style.display = "flex";
    applyMomentScheduleToForm({ schedule: { enabled: false, time: '01:30', weekdays: [] } });
}

function openMomentEdit(e, type) {
    e.stopPropagation();
    editingMomentType = type;
    const cfg = nuvarandeState?.momentsConfig?.[type];
    if (!cfg) return;
    editingMomentCategory = cfg.category;
    const modalTitle = document.getElementById("modal-title");
    if (modalTitle) modalTitle.innerText = "Edit: " + (cfg.title || type).toUpperCase();
    const msgInput = document.getElementById("modal-msg-input");
    if (msgInput) msgInput.value = cfg.defaultMessage || "";
    selectedVideoId = cfg.videoId; selectedTitle = cfg.title; selectedSongTitle = cfg.songTitle; selectedThumbnail = cfg.thumbnail;
    applyMomentScheduleToForm(cfg);
    const modal = document.getElementById("moment-modal");
    if (modal) modal.style.display = "flex";
}

function saveMomentSettings() {
    const msgInput = document.getElementById("modal-msg-input");
    const schedule = getSelectedScheduleFromForm();
    socket.emit("moment:save_settings", {
        type: editingMomentType, category: editingMomentCategory,
        videoId: selectedVideoId, title: selectedTitle,
        songTitle: selectedSongTitle, thumbnail: selectedThumbnail,
        defaultMessage: msgInput ? msgInput.value.trim() : "",
        schedule
    });
    closeModal();
}

function activateMoment(type) {
    const input = document.getElementById("moment-text-input");
    const msg = input ? input.value.trim() : "";
    socket.emit("moment:activate", { type, message: msg });
    if (input) input.value = "";
}

function stopMoment() { socket.emit("moment:stop"); }
function closeModal() {
    const modal = document.getElementById("moment-modal");
    if (modal) modal.style.display = "none";
}

function toggleSchedule() {
    const btn = document.getElementById("btn-toggle-schedule");
    const status = document.getElementById("lbl-schedule-status");
    if (!btn || !status) return;
    const isCurrentlyOn = btn.textContent.trim() === "PÅ";
    const newState = !isCurrentlyOn;
    btn.textContent = newState ? "PÅ" : "AV";
    btn.style.background = newState ? "#1ed760" : "#555";
    status.textContent = newState ? "PÅ" : "AV";
    status.style.color = newState ? "#1ed760" : "#888";
    socket.emit("admin:toggle_schedule", { enabled: newState });
}

function setScheduleToggleUI(enabled) {
    const btn = document.getElementById("btn-toggle-schedule");
    const status = document.getElementById("lbl-schedule-status");
    if (!btn || !status) return;
    const isOn = !!enabled;
    btn.textContent = isOn ? "PÅ" : "AV";
    btn.style.background = isOn ? "#1ed760" : "#555";
    status.textContent = isOn ? "PÅ" : "AV";
    status.style.color = isOn ? "#1ed760" : "#888";
}

function searchMomentVideo() {
    const queryEl = document.getElementById("modal-search-input");
    const query = queryEl?.value?.trim();
    if (!query) return;
    const resultsEl = document.getElementById("modal-results");
    if (resultsEl) resultsEl.innerHTML = "<div style='padding:10px; color:#aaa; font-size:12px;'>Söker...</div>";
    socket.emit("search", { query, source: "moment_modal" });
}

function renderaBibliotek(state) {
    const s = document.getElementById("active-sticky-target"), sc = document.getElementById("playlist-library-target");
    if (!s || !sc) return;
    let sH = "", scH = "";
    if (state.aktivHuvudlista) sH += byggPlaylistHtml(state.aktivHuvudlista, 'main');
    if (state.aktivTillfalligLista) sH += byggPlaylistHtml(state.aktivTillfalligLista, 'temp');
    getSortedPlaylistNames(state.valv).forEach(n => {
        if (n !== state.aktivHuvudlista && n !== state.aktivTillfalligLista) scH += byggPlaylistHtml(n, 'inactive');
    });
    s.innerHTML = sH; sc.innerHTML = scH;
}

function byggPlaylistHtml(namn, typ) {
    const isMain = typ === 'main', isTemp = typ === 'temp';
    let klass = isMain ? "playlist active" : (isTemp ? "playlist temp-active" : "playlist");
    const safeName = namn.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    let btn = isTemp ? `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('REMOVE_TEMP_PLAYLIST')">✕</button>` :
              (isMain ? "" : `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('ADD_TEMP_PLAYLIST', {playlist: '${safeName}'})">+</button>`);
    return `<div class="${klass}" onclick="socket.emit('player:byt_valv', {valvNamn: '${safeName}'})"><div class="cover">${genInitialer(namn)}</div><div class="playlist-name">${escapeHtml(namn)}</div>${btn}</div>`;
}

function genInitialer(namn) { if (!namn) return ""; const delar = namn.split(' ').filter(n => n.length > 0); return delar.length === 1 ? delar[0].substring(0, 2).toUpperCase() : (delar[0][0] + delar[1][0]).toUpperCase(); }

function uppdateraPlayerVy() {
    const t = document.getElementById("player-queue-target"); if (!t) return;
    const q = nuvarandeState?.queue || [];
    t.innerHTML = q.map((l,i) => `
        <div class="song-row" style="padding:8px 0; border-bottom:1px solid #111;">
            <span>${i+1}. ${escapeHtml(l.title)}</span>
            <button class="btn-delete" style="color:#cd1a2b; border:none; background:none; font-weight:bold; cursor:pointer;" onclick="socket.emit('player:remove_song', {id: '${l.id}'})">✕</button>
        </div>`).join("");
}

function skipLat() {
    if (timeWatcher) clearInterval(timeWatcher);
    lanseradUniqueId = null;
    aktivUniqueId = null;
    socket.emit("player:skip");
}

function toggleQrKrav() {
    const el = document.getElementById("chk-qr-krav");
    if (el) socket.emit("admin:toggle_qr", { qrKrav: el.checked });
}

function renderPubLogs(events) {
    const listEl = document.getElementById("pub-log-list");
    const statusEl = document.getElementById("pub-log-status");
    if (!listEl || !statusEl) return;

    const safeEvents = Array.isArray(events) ? events.slice(-5).reverse() : [];
    if (!safeEvents.length) {
        statusEl.textContent = "Inga fel eller recovery-händelser registrerade ännu.";
        listEl.innerHTML = "<div style='padding:8px 10px; border:1px solid #2a2a2a; border-radius:6px; color:#aaa;'>Säkerhetsstatus: stabil.</div>";
        return;
    }

    statusEl.textContent = `Senaste ${safeEvents.length} händelser för ${pubId}`;
    listEl.innerHTML = safeEvents.map(event => {
        const recovered = event.recovered ? "✅" : "⚠️";
        const time = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "nu";
        return `
            <div style="padding:8px 10px; border:1px solid #2a2a2a; border-radius:6px; background:#111; line-height:1.4;">
                <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:4px;">
                    <strong style="color:${event.recovered ? '#1ed760' : '#ffb703'};">${recovered} ${escapeHtml(event.type || 'event')}</strong>
                    <span style="color:#888;">${time}</span>
                </div>
                <div style="color:#ddd;">${escapeHtml(event.message || 'Ingen förklaring')}</div>
                ${event.details ? `<div style="color:#aaa; margin-top:4px;">${escapeHtml(event.details)}</div>` : ''}
            </div>
        `;
    }).join("");
}

async function fetchPubLogs() {
    try {
        const response = await fetch(`/pub/${pubId}/logs`);
        if (!response.ok) throw new Error('log-request-failed');
        const data = await response.json();
        renderPubLogs(data.events || []);
    } catch (error) {
        const listEl = document.getElementById("pub-log-list");
        const statusEl = document.getElementById("pub-log-status");
        if (listEl && statusEl) {
            statusEl.textContent = "Kunde inte hämta fellogg.";
            listEl.innerHTML = "<div style='padding:8px 10px; border:1px solid #2a2a2a; border-radius:6px; color:#ffb703;'>Loggning är tillgänglig men kunde inte laddas just nu.</div>";
        }
    }
}

function switchTab(t) {
    document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active"));
    const tabEl = document.getElementById("tab-"+t);
    if (tabEl) tabEl.classList.add("active");
    document.querySelectorAll(".tab-view").forEach(v => v.style.display = "none");
    const viewEl = document.getElementById("view-"+t);
    if (viewEl) viewEl.style.display = "block";

    if (t === 'edit') {
        const frame = document.getElementById("isolated-editor-frame");
        if (frame && (!frame.src || !frame.src.includes('edit-library'))) {
            frame.src = `/pub/${pubId}/edit-library`;
        }
    }
}

// PWA-installation och iOS-stöd
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('pwa-install-btn');
    const unavailableMsg = document.getElementById('pwa-unavailable');
    if (installBtn) installBtn.style.display = 'block';
    if (unavailableMsg) unavailableMsg.style.display = 'none';
});

document.addEventListener('DOMContentLoaded', () => {
    const enableEl = document.getElementById('modal-schedule-enable');
    if (enableEl) {
        enableEl.addEventListener('change', syncScheduleFormUI);
    }

            const daysWrap = document.getElementById('modal-schedule-days');
            if (daysWrap) {
                daysWrap.addEventListener('change', event => {
                    if (event.target.matches('input[type="checkbox"]')) syncScheduleDayTimeUI();
                });
            }

    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none';
                const installedMsg = document.getElementById('pwa-status-installed');
                if (installedMsg) installedMsg.style.display = 'block';
            }
            deferredPrompt = null;
        });
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (isStandalone) {
        const installedMsg = document.getElementById('pwa-status-installed');
        const unavailableMsg = document.getElementById('pwa-unavailable');
        if (installedMsg) installedMsg.style.display = 'block';
        if (unavailableMsg) unavailableMsg.style.display = 'none';
    } else if (isIOS) {
        const iosInst = document.getElementById('pwa-ios-instruktion');
        const unavailableMsg = document.getElementById('pwa-unavailable');
        if (iosInst) iosInst.style.display = 'block';
        if (unavailableMsg) unavailableMsg.style.display = 'none';
    }
});

socket.on('connect', () => {
    socket.emit("join_pub", pubId);
    fetchPubLogs();
});

socket.on('searchResults', (data) => {
    const resEl = document.getElementById("edit-search-results");
    if (!resEl) return;
    const playlistName = document.getElementById("select-edit-playlist")?.value;
    if (!playlistName) {
        resEl.innerHTML = "<div style='padding:8px; color:#ffb703; font-size:12px;'>Välj en lista först!</div>";
        return;
    }
    const results = data?.results || [];
    if (results.length === 0) {
        resEl.innerHTML = "<div style='padding:8px; color:#aaa; font-size:12px;'>Inga resultat hittades.</div>";
        return;
    }
    resEl.innerHTML = results.map(r => {
        const titleSafe = r.title.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const vId = r.videoId;
        const thumb = r.thumbnail || '';
        const dur = r.durationSeconds || 180;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #333; font-size:12px;">
                <div style="flex:1; margin-right:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(r.title)}</div>
                <button style="background:#1ed760; color:#000; border:none; border-radius:4px; padding:4px 8px; font-weight:bold; cursor:pointer;" onclick="laggTillLatIEdit('${playlistName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${vId}', '${titleSafe}', '${thumb}', ${dur})">+ LÄGG TILL</button>
            </div>
        `;
    }).join('');
});

socket.on("state", (state) => {
    nuvarandeState = state;
    const lblNowPlaying = document.getElementById("lbl-now-playing");
    if (lblNowPlaying) lblNowPlaying.innerText = state.nowPlaying ? state.nowPlaying.title : "Tyst...";
    const qrKravEl = document.getElementById("chk-qr-krav");
    if (qrKravEl) qrKravEl.checked = !!state.qrKrav;
    const statKup = document.getElementById("stat-kuponger");
    if (statKup) statKup.innerText = state.statistikKuponger || 0;
    const statTot = document.getElementById("stat-totalt");
    if (statTot) statTot.innerText = state.statistikTotalt || 0;
    setScheduleToggleUI(!!state.scheduleEnabled);

    if (state.logs) renderPubLogs(state.logs); else fetchPubLogs();
    fillMobileDropdowns(state);
    renderaBibliotek(state);
    uppdateraPlayerVy();
    uppdateraStaffPlayer(state);
    updatePlaybackButtonState();
    updateMomentsUI(state);
    startMomentScheduleChecker();

    const editSelVal = document.getElementById("select-edit-playlist")?.value;
    if (editSelVal) uppdateraEditVyMobil(editSelVal);
});