const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubIndex = urlDelar.indexOf('pub');
const pubId = (pubIndex !== -1 && urlDelar[pubIndex + 1]) ? urlDelar[pubIndex + 1] : "default_pub";

let nuvarandeState = null;
let staffYtPlayer = null;
let aktivUniqueId = null;
let currentStopPos = 0;
let timeWatcher = null;
let editingMomentType = null;
let editingMomentCategory = null;
let selectedVideoId = null, selectedTitle = null, selectedSongTitle = null, selectedThumbnail = null;
let hasInteracted = false;
let deferredPrompt;

// 1. FÅNGA INSTALLATIONSEVENTET
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'block';
});

const ORDERED_PLAYLISTS = ["happy birthday to you", "acdc", "celiks lista", "saras lista", "la muzika", "favoriter", "before i ieave", "highway man"];

window.onYouTubeIframeAPIReady = function () {
    staffYtPlayer = new YT.Player("staff-yt-player", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 1, origin: window.location.origin, enablejsapi: 1, rel: 0, mute: 0 },
        events: {
            onReady: () => { if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState); },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) triggaSpelareReady();
                if (e.data === YT.PlayerState.PLAYING) startWatcher();
            },
            onError: () => triggaSpelareReady()
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
            if (currentStopPos > 0 && now >= currentStopPos && now > 2) triggaSpelareReady();
        }
    }, 500);
}

function startaSpelaren() {
    hasInteracted = true;
    if (staffYtPlayer) {
        if (staffYtPlayer.unMute) staffYtPlayer.unMute();
        staffYtPlayer.playVideo();
        if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState);
    }
}

function uppdateraStaffPlayer(state) {
    if (!staffYtPlayer?.loadVideoById) return;
    if (state.activeMoment?.type === 'pause') { staffYtPlayer.stopVideo(); aktivUniqueId = null; return; }
    if (!state.nowPlaying) { if (aktivUniqueId !== null) { staffYtPlayer.stopVideo(); aktivUniqueId = null; } return; }

    const vidIdStr = String(state.nowPlaying.videoId);
    if (state.nowPlaying.id !== aktivUniqueId && vidIdStr.length > 0) {
        aktivUniqueId = state.nowPlaying.id;
        currentStopPos = state.nowPlaying.stopPosition || 0;
        const loadOptions = { videoId: vidIdStr, startSeconds: state.nowPlaying.startPosition || 0 };
        if (currentStopPos > loadOptions.startSeconds) loadOptions.endSeconds = currentStopPos;
        staffYtPlayer.loadVideoById(loadOptions);
    }
}

function getSortedPlaylistNames(valv) {
    const allNames = Object.keys(valv || {});
    const sorted = [];
    ORDERED_PLAYLISTS.forEach(name => { if (allNames.includes(name)) sorted.push(name); });
    const remaining = allNames.filter(n => !ORDERED_PLAYLISTS.includes(n)).sort();
    return [...sorted, ...remaining];
}

function updateMomentsUI(state) {
    if (!state.momentsConfig) return;
    ['drift', 'firande', 'avslut'].forEach(c => {
        const el = document.getElementById('custom-'+c);
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
            if (!container) return;
            const customCard = document.createElement('div');
            customCard.className = `moment-card moment-${cfg.category === 'drift' ? 'blue' : cfg.category === 'firande' ? 'gold' : 'red'}`;
            if (state.activeMoment?.type === key) customCard.classList.add('active');
            customCard.onclick = () => activateMoment(key);
            customCard.innerHTML = `<h4>${cfg.title.toUpperCase()}</h4><p><strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${displaySong}</small></p><button class="edit-btn" onclick="openMomentEdit(event, '${key}')">⚙️</button>`;
            container.appendChild(customCard);
        }
    });
    const stopBtn = document.getElementById("btn-stop-moment");
    if (stopBtn) stopBtn.style.display = state.activeMoment ? "block" : "none";
}

function openMomentEdit(e, type) {
    e.stopPropagation();
    editingMomentType = type;
    const cfg = nuvarandeState.momentsConfig[type];
    editingMomentCategory = cfg.category;
    document.getElementById("modal-title").innerText = "Edit: " + (cfg.title || type).toUpperCase();
    document.getElementById("modal-msg-input").value = cfg.defaultMessage || "";
    selectedVideoId = cfg.videoId; selectedTitle = cfg.title; selectedSongTitle = cfg.songTitle; selectedThumbnail = cfg.thumbnail;
    document.getElementById("moment-modal").style.display = "flex";
}

function saveMomentSettings() {
    socket.emit("moment:save_settings", { type: editingMomentType, category: editingMomentCategory, videoId: selectedVideoId, title: selectedTitle, songTitle: selectedSongTitle, thumbnail: selectedThumbnail, defaultMessage: document.getElementById("modal-msg-input").value.trim() });
    closeModal();
}

function activateMoment(type) { socket.emit("moment:activate", { type, message: document.getElementById("moment-text-input").value.trim() }); document.getElementById("moment-text-input").value = ""; }
function stopMoment() { socket.emit("moment:stop"); }
function closeModal() { document.getElementById("moment-modal").style.display = "none"; }

function sokLatTillEdit() { const q = document.getElementById("txt-edit-search").value.trim(); if (q) socket.emit("search", { query: q }); }

function laggTillLatIPermanentLista(videoId, title, thumbnail) {
    const valv = nuvarandeState?.aktivHuvudlista;
    if (valv) {
        socket.emit("admin:add_to_valv", { valvNamn: valv, videoId, title, thumbnail });
        document.getElementById("edit-search-results").innerHTML = `<div style="padding:15px; color:#1ed760;">✓ TILLAGD: ${title}</div>`;
        document.getElementById("txt-edit-search").value = "";
    }
}

function switchTab(t) { document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active")); document.getElementById("tab-"+t).classList.add("active"); document.querySelectorAll(".tab-view").forEach(v => v.style.display = "none"); document.getElementById("view-"+t).style.display = "block"; }

function triggaSpelareReady() { socket.emit("player:ready_for_next", { currentVideoId: aktivUniqueId }); }
function skipLat() { socket.emit("player:skip"); }
function toggleQrKrav() { socket.emit("admin:toggle_qr", { qrKrav: document.getElementById("chk-qr-krav").checked }); }

socket.on('connect', () => socket.emit("join_pub", pubId));
socket.on("state", (state) => {
    nuvarandeState = state;
    document.getElementById("lbl-now-playing").innerText = state.nowPlaying ? state.nowPlaying.title : "Tyst...";
    const qrKravEl = document.getElementById("chk-qr-krav");
    if (qrKravEl) qrKravEl.checked = !!state.qrKrav;
    const statKup = document.getElementById("stat-kuponger");
    if (statKup) statKup.innerText = state.statistikKuponger || 0;
    const statTot = document.getElementById("stat-totalt");
    if (statTot) statTot.innerText = state.statistikTotalt || 0;

    renderaBibliotek(state);
    uppdateraEditVy();
    uppdateraPlayerVy();
    uppdateraStaffPlayer(state);
    updateMomentsUI(state);
});

socket.on("searchResults", (data) => {
    const editRes = document.getElementById("edit-search-results");
    if (editRes) {
        editRes.innerHTML = data.results.map(i => `
            <div class="song-row" style="padding:10px;">
                <img src="${i.thumbnail}" style="width:40px; margin-right:10px; border-radius:4px;">
                <span style="flex:1;">${i.title}</span>
                <button class="btn-action" style="background:#1ed760; color:#000;" onclick="laggTillLatIPermanentLista('${i.videoId}', '${i.title.replace(/'/g, "\\'")}', '${i.thumbnail}')">LÄGG TILL</button>
            </div>`).join("");
    }
});

function genInitialer(namn) { if (!namn) return ""; const delar = namn.split(' ').filter(n => n.length > 0); return delar.length === 1 ? delar[0].substring(0, 2).toUpperCase() : (delar[0][0] + delar[1][0]).toUpperCase(); }

function byggPlaylistHtml(namn, typ) {
    const isMain = typ === 'main', isTemp = typ === 'temp';
    let klass = isMain ? "playlist active" : (isTemp ? "playlist temp-active" : "playlist");
    let btn = isTemp ? `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('REMOVE_TEMP_PLAYLIST')">-</button>` : (isMain ? "" : `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('ADD_TEMP_PLAYLIST', {playlist: '${namn.replace(/'/g, "\\'")}'})">+</button>`);
    return `<div class="${klass}" onclick="socket.emit('player:byt_valv', {valvNamn: '${namn.replace(/'/g, "\\'")}'})"><div class="cover">${genInitialer(namn)}</div><div class="playlist-name">${namn}</div>${btn}</div>`;
}

function renderaBibliotek(state) {
    const s = document.getElementById("active-sticky-target"), sc = document.getElementById("playlist-library-target");
    if (!s || !sc) return;
    let sH = "", scH = "";
    if (state.aktivHuvudlista) sH += byggPlaylistHtml(state.aktivHuvudlista, 'main');
    if (state.aktivTillfalligLista) sH += byggPlaylistHtml(state.aktivTillfalligLista, 'temp');
    getSortedPlaylistNames(state.valv).forEach(n => { if (n !== state.aktivHuvudlista && n !== state.aktivTillfalligLista) scH += byggPlaylistHtml(n, 'inactive'); });
    s.innerHTML = sH; sc.innerHTML = scH;
}

function uppdateraEditVy() {
    const a = nuvarandeState?.aktivHuvudlista;
    const target = document.getElementById("edit-song-list-target");
    if (!a || !target) return;
    document.getElementById("edit-view-title").innerText = "Edit: " + a;
    document.getElementById("edit-view-content").style.display = "block";
    target.innerHTML = (nuvarandeState.valv[a] || []).map(l => `<div class="song-row"><span>${l.title}</span><button class="btn-delete" onclick="socket.emit('admin:remove_from_valv', {valvNamn: '${a.replace(/'/g, "\\'")}', latNamn: '${l.title.replace(/'/g, "\\'")}'})">✕</button></div>`).join("");
}

function uppdateraPlayerVy() {
    const t = document.getElementById("player-queue-target"); if (!t) return;
    const q = nuvarandeState?.queue || [];
    t.innerHTML = q.map((l,i) => `
        <div class="song-row" style="padding:8px 0; border-bottom:1px solid #111;">
            <span>${i+1}. ${l.title}</span>
            <button class="btn-delete" style="color:#cd1a2b; border:none; background:none; font-weight:bold;" onclick="socket.emit('player:remove_song', {id: '${l.id}'})">✕</button>
        </div>`).join("");
}