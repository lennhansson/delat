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

const ORDERED_PLAYLISTS = ["happy birthday to you", "acdc", "celiks lista", "saras lista", "la muzika", "favoriter", "before i ieave", "highway man"];

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
            if (!staffYtPlayer || !nuvarandeState?.nowPlaying) return;
            const stateCode = staffYtPlayer.getPlayerState ? staffYtPlayer.getPlayerState() : -1;
            if (stateCode !== YT.PlayerState.PLAYING) {
                console.warn('Player stalled or unavailable; skipping current item.', { stateCode, videoId: nuvarandeState.nowPlaying.videoId });
                recoverFromPlayerError('player stalled');
            }
        } catch (error) {
            recoverFromPlayerError(error?.message || 'player health check failed');
        }
    }, 7000);
}

window.onYouTubeIframeAPIReady = function () {
    staffYtPlayer = new YT.Player("staff-yt-player", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 1, enablejsapi: 1, rel: 0, mute: 0 },
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
                updatePlaybackButtonState();
            },
            onError: (e) => recoverFromPlayerError(`YouTube error ${e?.data ?? 'unknown'}`)
        }
    });
};

if (!window.YT) {
    const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api";
    document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
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
    const isPlaying = currentState === YT.PlayerState.PLAYING;
    toggleBtn.textContent = isPlaying ? '❚❚' : '▶';
    toggleBtn.setAttribute('aria-label', isPlaying ? 'Pausa ljud' : 'Spela upp ljud');
}

function togglePlayback() {
    if (!staffYtPlayer) return;

    const currentState = staffYtPlayer.getPlayerState ? staffYtPlayer.getPlayerState() : -1;
    if (currentState === YT.PlayerState.PLAYING) {
        staffYtPlayer.pauseVideo();
    } else {
        hasInteracted = true;
        staffYtPlayer.unMute();
        staffYtPlayer.playVideo();
        if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState);
    }

    updatePlaybackButtonState();
}

function startaSpelaren() {
    hasInteracted = true;
    if (staffYtPlayer?.playVideo) {
        staffYtPlayer.unMute();
        staffYtPlayer.playVideo();
        if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState);
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
    if (val) socket.emit('player:byt_valv', { valvNamn: val });
}

function bytTempLista() {
    const val = document.getElementById("select-temp-playlist")?.value;
    socket.emit(val ? 'ADD_TEMP_PLAYLIST' : 'REMOVE_TEMP_PLAYLIST', { playlist: val });
}

function fillMobileDropdowns(state) {
    const mainSel = document.getElementById("select-main-playlist");
    const tempSel = document.getElementById("select-temp-playlist");
    const editSel = document.getElementById("select-edit-playlist");
    if (!mainSel) return;
    const playlists = getSortedPlaylistNames(state.valv);
    [mainSel, tempSel, editSel].forEach(sel => {
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = (sel === mainSel ? '' : '<option value="">Välj lista...</option>') +
            playlists.map(p => `<option value="${p}" ${p === currentVal ? 'selected' : ''}>${p.toUpperCase()}</option>`).join("");
        if (currentVal) sel.value = currentVal;
    });
    mainSel.value = state.aktivHuvudlista || "";
    tempSel.value = state.aktivTillfalligLista || "";
}

function updateMomentsUI(state) {
    if (!state.momentsConfig) return;

    const mobileSelect = document.getElementById('select-moment-type');
    if (mobileSelect) {
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

    const launchpad = document.getElementById('custom-drift');
    if (!launchpad) {
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
            if (descEl) descEl.innerHTML = `<strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${displaySong}</small>`;
        } else if (key !== 'pause') {
            const container = document.getElementById('custom-' + (cfg.category || 'drift'));
            if (container) {
                const customCard = document.createElement('div');
                customCard.className = `moment-card moment-${cfg.category === 'drift' ? 'blue' : cfg.category === 'firande' ? 'gold' : 'red'}`;
                if (state.activeMoment?.type === key) customCard.classList.add('active');
                customCard.onclick = () => activateMoment(key);
                customCard.innerHTML = `<h4>${cfg.title.toUpperCase()}</h4><p><strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${displaySong}</small></p><button class="edit-btn" onclick="openMomentEdit(event, '${key}')">⚙️</button>`;
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

    input.value = "";
    const select = document.getElementById("select-edit-playlist");
    if (select) {
        let opt = Array.from(select.options).find(o => o.value.toLowerCase() === name);
        if (!opt) {
            opt = document.createElement("option");
            opt.value = name;
            opt.innerText = name.toUpperCase();
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

    target.innerHTML = songs.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #222; font-size:12px;">
            <span>${s.title}</span>
            <button style="color:#cd1a2b; background:none; border:none; font-weight:bold; padding:4px 8px; cursor:pointer;" onclick="taBortLatFranEdit('${playlistName.replace(/'/g, "\\'")}', '${s.title.replace(/'/g, "\\'")}')">✕</button>
        </div>
    `).join("");
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
    const modal = document.getElementById("moment-modal");
    if (modal) modal.style.display = "flex";
}

function saveMomentSettings() {
    const msgInput = document.getElementById("modal-msg-input");
    socket.emit("moment:save_settings", {
        type: editingMomentType, category: editingMomentCategory,
        videoId: selectedVideoId, title: selectedTitle,
        songTitle: selectedSongTitle, thumbnail: selectedThumbnail,
        defaultMessage: msgInput ? msgInput.value.trim() : ""
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
    return `<div class="${klass}" onclick="socket.emit('player:byt_valv', {valvNamn: '${safeName}'})"><div class="cover">${genInitialer(namn)}</div><div class="playlist-name">${namn}</div>${btn}</div>`;
}

function genInitialer(namn) { if (!namn) return ""; const delar = namn.split(' ').filter(n => n.length > 0); return delar.length === 1 ? delar[0].substring(0, 2).toUpperCase() : (delar[0][0] + delar[1][0]).toUpperCase(); }

function uppdateraPlayerVy() {
    const t = document.getElementById("player-queue-target"); if (!t) return;
    const q = nuvarandeState?.queue || [];
    t.innerHTML = q.map((l,i) => `
        <div class="song-row" style="padding:8px 0; border-bottom:1px solid #111;">
            <span>${i+1}. ${l.title}</span>
            <button class="btn-delete" style="color:#cd1a2b; border:none; background:none; font-weight:bold;" onclick="socket.emit('player:remove_song', {id: '${l.id}'})">✕</button>
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
                    <strong style="color:${event.recovered ? '#1ed760' : '#ffb703'};">${recovered} ${event.type || 'event'}</strong>
                    <span style="color:#888;">${time}</span>
                </div>
                <div style="color:#ddd;">${event.message || 'Ingen förklaring'}</div>
                ${event.details ? `<div style="color:#aaa; margin-top:4px;">${event.details}</div>` : ''}
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

// UPPDATERAD FLIK-LOGIK SÅ ATT IFRAMEN FAKTISKT LADDAS NÄR MAN KLICKAR PÅ EDIT
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
        const titleSafe = r.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const vId = r.videoId;
        const thumb = r.thumbnail || '';
        const dur = r.durationSeconds || 180;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #333; font-size:12px;">
                <div style="flex:1; margin-right:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title}</div>
                <button style="background:#1ed760; color:#000; border:none; border-radius:4px; padding:4px 8px; font-weight:bold; cursor:pointer;" onclick="laggTillLatIEdit('${playlistName.replace(/'/g, "\\'")}', '${vId}', '${titleSafe}', '${thumb}', ${dur})">+ LÄGG TILL</button>
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

    if (state.logs) renderPubLogs(state.logs); else fetchPubLogs();
    fillMobileDropdowns(state);
    renderaBibliotek(state);
    uppdateraPlayerVy();
    uppdateraStaffPlayer(state);
    updatePlaybackButtonState();
    updateMomentsUI(state);

    const editSelVal = document.getElementById("select-edit-playlist")?.value;
    if (editSelVal) uppdateraEditVyMobil(editSelVal);
});