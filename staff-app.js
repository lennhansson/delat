const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubIndex = urlDelar.indexOf('pub');
const pubId = (pubIndex !== -1 && urlDelar[pubIndex + 1]) ? urlDelar[pubIndex + 1] : "default_pub";

console.log("[Staff] Ansluter till pub:", pubId);

let nuvarandeState = null;
let staffYtPlayer = null;
let aktivUniqueId = null; // Vi kollar nu på unikt ID istället för bara videoId
let editingMomentType = null;
let selectedVideoId = null;
let selectedTitle = null;
let selectedThumbnail = null;
let hasInteracted = false;

// YouTube API Setup
window.onYouTubeIframeAPIReady = function () {
    console.log("[Player] Initierar YouTube API...");
    staffYtPlayer = new YT.Player("staff-yt-player", {
        width: "100%",
        height: "100%",
        playerVars: {
            autoplay: 1,
            controls: 1,
            origin: window.location.origin,
            enablejsapi: 1,
            rel: 0,
            mute: 0
        },
        events: {
            onReady: (e) => {
                console.log("[Player] Spelare redo.");
                if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState);
            },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) {
                    console.log("[Player] Video slutade.");
                    triggaSpelareReady();
                }
            },
            onError: (e) => {
                console.error("[Player] YT Error:", e.data);
                setTimeout(triggaSpelareReady, 5000);
            }
        }
    });
};

if (!window.YT) {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// Lås upp ljudet vid första klicket på sidan
document.addEventListener('click', () => {
    if (hasInteracted) return;
    hasInteracted = true;
    if (staffYtPlayer && typeof staffYtPlayer.unMute === 'function') {
        staffYtPlayer.unMute();
        staffYtPlayer.setVolume(100);
        console.log("[Player] Ljud upplåst via interaktion.");
    }
}, { once: true });

function startaSpelaren() {
    console.log("[Staff] Startar spelaren manuellt...");
    hasInteracted = true;
    if (staffYtPlayer) {
        if (typeof staffYtPlayer.unMute === 'function') staffYtPlayer.unMute();
        if (typeof staffYtPlayer.setVolume === 'function') staffYtPlayer.setVolume(100);
        staffYtPlayer.playVideo();
    }
    socket.emit("player:ready_for_next");
}

function toggleQrKrav() {
    const chk = document.getElementById("chk-qr-krav");
    if (!chk) return;
    socket.emit("admin:toggle_qr", { qrKrav: chk.checked });
}

function uppdateraStaffPlayer(state) {
    if (!staffYtPlayer || typeof staffYtPlayer.loadVideoById !== 'function') return;

    if (state.activeMoment && state.activeMoment.type === 'pause') {
        staffYtPlayer.stopVideo();
        aktivUniqueId = null;
        return;
    }

    if (!state.nowPlaying) {
        if (aktivUniqueId !== null) {
            staffYtPlayer.stopVideo();
            aktivUniqueId = null;
        }
        return;
    }

    const nyId = state.nowPlaying.videoId;
    const uniqueId = state.nowPlaying.id;

    // Vi triggar på unikt ID för att tillåta omstart av samma låt/moment
    if (uniqueId && uniqueId !== aktivUniqueId) {
        aktivUniqueId = uniqueId;
        staffYtPlayer.loadVideoById(nyId);
        console.log("[Player] Laddar:", state.nowPlaying.title, "(ID:", uniqueId, ")");
    }
}

function triggaSpelareReady() {
    aktivUniqueId = null;
    socket.emit("player:ready_for_next");
}

function skipLat() {
    aktivUniqueId = null;
    socket.emit("player:skip");
}

function updateMomentsUI(state) {
    document.querySelectorAll('.moment-card').forEach(c => c.classList.remove('active'));
    const stopBtn = document.getElementById("btn-stop-moment");

    if (state.activeMoment) {
        const card = document.getElementById("m-" + state.activeMoment.type);
        if (card) card.classList.add('active');
        if (stopBtn) {
            stopBtn.style.display = (state.activeMoment.type === 'pause' || state.activeMoment.type === 'closing') ? "block" : "none";
        }
    } else if (stopBtn) {
        stopBtn.style.display = "none";
    }

    if (state.momentsConfig) {
        Object.keys(state.momentsConfig).forEach(type => {
            const el = document.getElementById(`txt-${type}-desc`);
            if (el) {
                const cfg = state.momentsConfig[type];
                el.innerHTML = `<strong>Msg:</strong> ${cfg.defaultMessage || "-"}<br><small style="color:#aaa;">🎵 ${cfg.title || "Standard"}</small>`;
            }
        });
    }
}

function activateMoment(type) {
    const input = document.getElementById("moment-text-input");
    const manualMsg = input ? input.value.trim() : "";
    socket.emit("moment:activate", { type: type, message: manualMsg });
    if (input) input.value = "";
}

function stopMoment() { socket.emit("moment:stop"); }

function openMomentEdit(e, type) {
    e.stopPropagation();
    editingMomentType = type;
    const config = nuvarandeState.momentsConfig[type];
    document.getElementById("modal-title").innerText = "Programmera: " + type.toUpperCase();
    document.getElementById("modal-msg-input").value = config ? (config.defaultMessage || "") : "";
    selectedVideoId = config ? config.videoId : null;
    selectedTitle = config ? config.title : null;
    selectedThumbnail = config ? config.thumbnail : null;
    document.getElementById("moment-modal").style.display = "flex";
}

function closeModal() {
    document.getElementById("moment-modal").style.display = "none";
    document.getElementById("modal-results").innerHTML = "";
}

function searchMomentVideo() {
    const q = document.getElementById("modal-search-input").value;
    if (q) socket.emit("search", { query: q });
}

function pickVideo(id, title, thumbnail) {
    selectedVideoId = id;
    selectedTitle = title;
    selectedThumbnail = thumbnail;
    document.getElementById("modal-results").innerHTML = `<div style="padding:15px; color:#1ed760; font-weight:bold;">VALD: ${title}</div>`;
}

function saveMomentSettings() {
    socket.emit("moment:save_settings", {
        type: editingMomentType,
        videoId: selectedVideoId,
        title: selectedTitle,
        thumbnail: selectedThumbnail,
        defaultMessage: document.getElementById("modal-msg-input").value.trim()
    });
    closeModal();
}

function genInitialer(namn) {
    if (!namn) return "";
    const rentNamn = namn.replace(/_/g, ' ');
    const delar = rentNamn.split(' ').filter(n => n.length > 0);
    if (delar.length === 0) return "";
    if (delar.length === 1) return delar[0].substring(0, 2).toUpperCase();
    return (delar[0][0] + delar[1][0]).toUpperCase();
}

function byggPlaylistHtml(namn, typ) {
    const isMain = (typ === 'main');
    const isTemp = (typ === 'temp');
    let klassNamn = "playlist";
    let extraElement = "";
    if (isMain) klassNamn = "playlist active";
    else if (isTemp) {
        klassNamn = "playlist temp-active";
        extraElement = `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('REMOVE_TEMP_PLAYLIST')">-</button>`;
    } else {
        extraElement = `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('ADD_TEMP_PLAYLIST', {playlist: '${namn.replace(/'/g, "\\'")}'})">+</button>`;
    }
    return `
        <div class="${klassNamn}" onclick="socket.emit('player:byt_valv', {valvNamn: '${namn.replace(/'/g, "\\'")}'})">
            <div class="cover">${genInitialer(namn)}</div>
            <div class="playlist-name">${namn.replace(/_/g, ' ')}</div>
            ${extraElement}
        </div>
    `;
}

function renderaBibliotek(state) {
    const stickyTarget = document.getElementById("active-sticky-target");
    const scrollTarget = document.getElementById("playlist-library-target");
    if (!stickyTarget || !scrollTarget) return;

    const allaListor = Object.keys(state.valv || {});
    let stickyHtml = "", scrollHtml = "";
    if (state.aktivHuvudlista) stickyHtml += byggPlaylistHtml(state.aktivHuvudlista, 'main');
    if (state.aktivTillfalligLista) stickyHtml += byggPlaylistHtml(state.aktivTillfalligLista, 'temp');
    allaListor.forEach(n => {
        if (n !== state.aktivHuvudlista && n !== state.aktivTillfalligLista) {
            scrollHtml += byggPlaylistHtml(n, 'inactive');
        }
    });
    stickyTarget.innerHTML = stickyHtml || "Ingen aktiv.";
    scrollTarget.innerHTML = scrollHtml || "Tomt.";
}

function uppdateraEditVy() {
    const aktiv = nuvarandeState?.aktivHuvudlista;
    const content = document.getElementById("edit-view-content");
    if (!content) return;
    if (!aktiv) { content.style.display = "none"; return; }
    document.getElementById("edit-view-title").innerText = "Edit: " + aktiv;
    content.style.display = "block";
    const latar = nuvarandeState.valv[aktiv] || [];
    document.getElementById("edit-song-list-target").innerHTML = latar.map(l => `
        <div class="song-row">
            <span>${l}</span>
            <button class="btn-delete" onclick="socket.emit('admin:remove_from_valv', {valvNamn: '${aktiv.replace(/'/g, "\\'")}', latNamn: '${l.replace(/'/g, "\\'")}'})">✕</button>
        </div>
    `).join("");
}

function uppdateraPlayerVy() {
    const target = document.getElementById("player-queue-target");
    if (!target) return;
    const q = nuvarandeState?.queue || [];
    target.innerHTML = q.map((l,i) => `
        <div class="song-row">
            <span>${i+1}. ${l.title}</span>
            <button class="btn-delete" onclick="socket.emit('player:remove_song', {id: '${l.id}'})">✕</button>
        </div>
    `).join("");
}

function switchTab(t) {
    document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active"));
    const tab = document.getElementById("tab-" + t);
    if (tab) tab.classList.add("active");
    document.querySelectorAll(".tab-view").forEach(v => v.style.display = "none");
    const view = document.getElementById("view-" + t);
    if (view) view.style.display = "block";
}

function laggTillLatIFil() {
    const input = document.getElementById("txt-ny-lat");
    const lat = input ? input.value.trim() : "";
    if (lat) {
        socket.emit("admin:add_to_valv", { valvNamn: nuvarandeState.aktivHuvudlista, lat: lat });
        if (input) input.value = "";
    }
}

// --- SOCKET LISTENERS ---

socket.on('connect', () => {
    console.log("[Staff] Ansluten, skickar join_pub för:", pubId);
    socket.emit("join_pub", pubId);
});

socket.on("staff_state", (state) => {
    try {
        nuvarandeState = state;
        const lbl = document.getElementById("lbl-now-playing");
        if (lbl) lbl.innerText = state.nowPlaying ? state.nowPlaying.title : "Tyst...";

        const qrChk = document.getElementById("chk-qr-krav");
        if (qrChk) qrChk.checked = !!state.qrKrav;

        const statKup = document.getElementById("stat-kuponger");
        const statTot = document.getElementById("stat-totalt");
        if (statKup) statKup.innerText = state.statistikKuponger || 0;
        if (statTot) statTot.innerText = state.statistikTotalt || 0;

        renderaBibliotek(state);
        uppdateraEditVy();
        uppdateraPlayerVy();
        uppdateraStaffPlayer(state);
        updateMomentsUI(state);
    } catch (err) {
        console.error("Fel vid uppdatering av state:", err);
    }
});

socket.on("searchResults", (data) => {
    const modal = document.getElementById("moment-modal");
    if (modal && modal.style.display === "flex") {
        document.getElementById("modal-results").innerHTML = data.results.map(i => `
            <div class="song-row" style="cursor:pointer; padding:8px; border-bottom:1px solid #333;" onclick="pickVideo('${i.videoId}', '${i.title.replace(/'/g, "")}', '${i.thumbnail}')">
                <img src="${i.thumbnail}" style="width:40px; vertical-align:middle; margin-right:10px;">
                <span style="font-size:12px;">${i.title}</span>
            </div>
        `).join("");
    }
});