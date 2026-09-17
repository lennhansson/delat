const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubIndex = urlDelar.indexOf('pub');
const pubId = (pubIndex !== -1 && urlDelar[pubIndex + 1]) ? urlDelar[pubIndex + 1] : "default_pub";

let nuvarandeState = null;
let staffYtPlayer = null;
let aktivUniqueId = null;
let lanseradUniqueId = null; // CommandDone-handskakning: Håller koll på vilken låt som FAKTISKT har startat
let currentStopPos = 0;
let timeWatcher = null;
let hasInteracted = false;

const ORDERED_PLAYLISTS = ["happy birthday to you", "acdc", "celiks lista", "saras lista", "la muzika", "favoriter", "before i ieave", "highway man"];

window.onYouTubeIframeAPIReady = function () {
    staffYtPlayer = new YT.Player("staff-yt-player", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 1, origin: window.location.origin, enablejsapi: 1, rel: 0, mute: 0 },
        events: {
            onReady: () => { if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState); },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED) triggaSpelareReady();
                if (e.data === YT.PlayerState.PLAYING) {
                    startWatcher();
                    // HANDSHAKE KVITTENS: Låten har officiellt börjat spela (commandDone)
                    if (nuvarandeState?.nowPlaying) {
                        lanseradUniqueId = nuvarandeState.nowPlaying.id;
                    }
                }
            },
            onError: () => {
                // Säkring: Om en video inte kan spelas, nollställ handskakningen och begär en skip direkt
                lanseradUniqueId = null;
                aktivUniqueId = null;
                socket.emit("player:skip");
            }
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

function startaSpelaren() {
    hasInteracted = true;
    if (staffYtPlayer?.playVideo) {
        staffYtPlayer.unMute();
        staffYtPlayer.playVideo();
        if (nuvarandeState) uppdateraStaffPlayer(nuvarandeState);
    }
}

function uppdateraStaffPlayer(state) {
    if (!staffYtPlayer?.loadVideoById) return;
    if (state.activeMoment?.type === 'pause') { staffYtPlayer.stopVideo(); aktivUniqueId = null; lanseradUniqueId = null; return; }
    if (!state.nowPlaying) { if (aktivUniqueId !== null) { staffYtPlayer.stopVideo(); aktivUniqueId = null; lanseradUniqueId = null; } return; }

    const vidIdStr = String(state.nowPlaying.videoId);
    if (state.nowPlaying.id !== aktivUniqueId && vidIdStr.length > 0) {
        aktivUniqueId = state.nowPlaying.id;
        currentStopPos = state.nowPlaying.stopPosition || 0;
        const loadOptions = { videoId: vidIdStr, startSeconds: state.nowPlaying.startPosition || 0 };
        if (currentStopPos > loadOptions.startSeconds) loadOptions.endSeconds = currentStopPos;
        staffYtPlayer.loadVideoById(loadOptions);
    }
}

function triggaSpelareReady() {
    // COMMAND_DONE VERIFIERING
    if (!lanseradUniqueId) return; // Avbryt om det är en falsk/eftersläpande signal innan låten lanserats

    if (timeWatcher) clearInterval(timeWatcher);

    const idToFinish = lanseradUniqueId;
    lanseradUniqueId = null; // Nollställ handskakningen omedelbart
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
    if (!mainSel) return;
    const playlists = getSortedPlaylistNames(state.valv);
    [mainSel, tempSel].forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = (sel === mainSel ? '' : '<option value="">Välj lista...</option>') +
            playlists.map(p => `<option value="${p}" ${p === currentVal ? 'selected' : ''}>${p.toUpperCase()}</option>`).join("");
    });
    mainSel.value = state.aktivHuvudlista || "";
    tempSel.value = state.aktivTillfalligLista || "";
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
    let btn = isTemp ? `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('REMOVE_TEMP_PLAYLIST')">✕</button>` :
              (isMain ? "" : `<button class="macro-btn" onclick="event.stopPropagation(); socket.emit('ADD_TEMP_PLAYLIST', {playlist: '${namn.replace(/'/g, "\\'")}'})">+</button>`);
    return `<div class="${klass}" onclick="socket.emit('player:byt_valv', {valvNamn: '${namn.replace(/'/g, "\\'")}'})"><div class="cover">${genInitialer(namn)}</div><div class="playlist-name">${namn}</div>${btn}</div>`;
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

function toggleQrKrav() { socket.emit("admin:toggle_qr", { qrKrav: document.getElementById("chk-qr-krav").checked }); }
function switchTab(t) { document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active")); document.getElementById("tab-"+t).classList.add("active"); document.querySelectorAll(".tab-view").forEach(v => v.style.display = "none"); document.getElementById("view-"+t).style.display = "block"; }

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

    fillMobileDropdowns(state);
    renderaBibliotek(state);
    uppdateraPlayerVy();
    uppdateraStaffPlayer(state);
});