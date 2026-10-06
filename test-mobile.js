const socket = io();
const pubId = window.location.pathname.split('/')[2] || "default_pub";

// Skapa eller hämta ett unikt ID för denna enhet
let uId = localStorage.getItem('jukebox_uid');
if (!uId) {
    uId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('jukebox_uid', uId);
}

let mittSaldo = 0;
let html5QrCode = null;
let nuvarandeKupongKod = "";
let nuvarandeQuery = "";
let nuvarandeOffset = 0;
let debounceTimer = null;
let senasteFörslag = [];
let senasteSökResultat = [];

socket.on('connect', () => {
    socket.emit("join_pub", pubId);
});
socket.emit("join_pub", pubId);

// SWIPE
let touchstartX = 0;
let touchendX = 0;
function handleGesture() {
    if (touchendX < touchstartX - 70) bytFlik('dela');
    if (touchendX > touchstartX + 70) bytFlik('jukebox');
}
document.addEventListener('touchstart', e => touchstartX = e.changedTouches[0].screenX);
document.addEventListener('touchend', e => { touchendX = e.changedTouches[0].screenX; handleGesture(); });

function bytFlik(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const target = document.getElementById('tab-' + tab);
    if(target) target.classList.add('active');
    const btn = document.getElementById('btn-tab-' + (tab === 'jukebox' ? 'jukebox' : 'dela'));
    if(btn) btn.classList.add('active');

    const container = document.querySelector('.app-container');
    if (container) {
        if (tab === 'dela') {
            container.classList.add('dela-active');
        } else {
            container.classList.remove('dela-active');
        }
    }

    if(tab === 'dela') genereraDelaQR();
}

function genereraDelaQR() {
    const target = document.getElementById("share-qr-target");
    if (!target || target.innerHTML !== "") return;
    new QRCode(target, { text: window.location.href, width: 180, height: 180 });
}

function hanteraSokInput() {
    const queryInput = document.getElementById("query");
    const suggestBox = document.getElementById("suggest-box");
    if (!queryInput || !suggestBox) return;

    const q = queryInput.value.trim();

    if (q.length < 3) {
        suggestBox.style.display = "none";
        suggestBox.innerHTML = "";
        return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        socket.emit("suggest", { query: q });
    }, 150);
}

socket.on("suggestResults", (data) => {
    const suggestBox = document.getElementById("suggest-box");
    if (!suggestBox) return;

    const suggestions = data.suggestions || [];
    senasteFörslag = suggestions;

    if (suggestions.length === 0) {
        suggestBox.style.display = "none";
        suggestBox.innerHTML = "";
        return;
    }

    suggestBox.style.display = "block";
    suggestBox.innerHTML = suggestions.map((item, idx) => {
        const tagKlass = item.type === 'artist' ? 'artist' : 'song';
        const tagText = item.type === 'artist' ? '🎤 ARTIST' : '🎵 LÅT';
        const safeLabel = (item.label || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        return `
            <div class="suggest-item" onclick="valjForslagIndex(${idx})">
                <span class="suggest-tag ${tagKlass}">${tagText}</span>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeLabel}</span>
            </div>
        `;
    }).join("");
});

function valjForslagIndex(index) {
    const item = senasteFörslag[index];
    if (item && item.query) {
        valjForslag(item.query);
    }
}

function valjForslag(queryText) {
    const queryInput = document.getElementById("query");
    const suggestBox = document.getElementById("suggest-box");
    if (queryInput) queryInput.value = queryText;
    if (suggestBox) {
        suggestBox.style.display = "none";
        suggestBox.innerHTML = "";
    }
    sök();
}

function sök(isLoadMore = false) {
    const suggestBox = document.getElementById("suggest-box");
    if (suggestBox) {
        suggestBox.style.display = "none";
        suggestBox.innerHTML = "";
    }

    const queryInput = document.getElementById("query");
    const q = queryInput ? queryInput.value.trim() : "";
    if (!q) return;

    if (!isLoadMore) {
        nuvarandeQuery = q;
        nuvarandeOffset = 0;
    }

    socket.emit("search", { query: nuvarandeQuery, offset: nuvarandeOffset, limit: 5 });
}

function laddaFler() {
    nuvarandeOffset += 5;
    sök(true);
}

socket.on("searchResults", (data) => {
    const resultsContainer = document.getElementById("results");
    if (!resultsContainer) return;

    const isLoadMore = (data.offset || 0) > 0;
    const items = data.results || [];

    if (!isLoadMore) {
        senasteSökResultat = items;
    } else {
        senasteSökResultat = [...senasteSökResultat, ...items];
    }

    const startIdx = isLoadMore ? (senasteSökResultat.length - items.length) : 0;
    const itemsHtml = items.map((s, idx) => {
        const globalIdx = startIdx + idx;
        const safeTitle = (s.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        return `
            <div class="song-row" onclick="önskaLåtIndex(${globalIdx})">
                <img src="${s.thumbnail}" class="song-thumb">
                <div class="song-info">
                    <div class="song-title">${safeTitle}</div>
                </div>
            </div>
        `;
    }).join("");

    const existingBtnContainer = document.getElementById("btn-load-more-container");
    if (existingBtnContainer) existingBtnContainer.remove();

    if (isLoadMore) {
        resultsContainer.innerHTML += itemsHtml;
    } else {
        resultsContainer.innerHTML = itemsHtml;
    }

    if (data.results && data.results.length === 5) {
        const loadMoreBtnHtml = `
            <div id="btn-load-more-container">
                <button class="btn-load-more" onclick="laddaFler()">➕ VISA FLER RESULTAT</button>
            </div>
        `;
        resultsContainer.innerHTML += loadMoreBtnHtml;
    }
});

function önskaLåtIndex(index) {
    const s = senasteSökResultat[index];
    if (!s) return;
    önskaLåt(s.videoId, s.title, s.thumbnail);
}

function önskaLåt(videoId, title, thumbnail) {
    socket.emit("addSong", { pubId, videoId, title, thumbnail, kupongKod: nuvarandeKupongKod, uId: uId });
}

socket.on("state", (data) => {
    const pubTitle = document.getElementById("pub-titel");
    if (pubTitle) pubTitle.innerText = data.pubNamn;

    const np = data.nowPlaying;
    const npContainer = document.getElementById("now-playing-container");
    if (npContainer) {
        if (np) {
            npContainer.style.display = "flex";
            const npThumb = document.getElementById("np-thumb");
            const npTitle = document.getElementById("np-title");
            if (npThumb) npThumb.src = np.thumbnail;
            if (npTitle) npTitle.innerText = np.title;
        } else {
            npContainer.style.display = "none";
        }
    }

    const qList = document.getElementById("queue-lista");
    if (qList) {
        const displayQueue = (data.queue || []).slice(0, 3);
        qList.innerHTML = displayQueue.length === 0 ? "<div style='text-align:center; color:#666; padding:20px;'>Kön är tom</div>" : displayQueue.map((l, i) => `
            <div class="song-row ${l.uId === uId ? 'my-song' : ''}">
                <div class="song-index">${i + 1}</div>
                <div class="song-thumb-container" style="display:flex; align-items:center;">
                    <img src="${l.thumbnail || 'https://img.youtube.com/vi/'+l.videoId+'/0.jpg'}" class="song-thumb">
                </div>
                <div class="song-info">
                    <div class="song-title">${l.title}</div>
                </div>
            </div>
        `).join("");
    }

    const saldoText = document.getElementById("saldo-info-text");
    if (saldoText) saldoText.innerText = mittSaldo;
});

socket.on("kupong_success", () => {
    if (mittSaldo > 0) mittSaldo--;
    const results = document.getElementById("results");
    const query = document.getElementById("query");
    if (results) results.innerHTML = "";
    if (query) query.value = "";
    showToast("Låt tillagd! 🎵");
});

socket.on("kupong_error", (d) => showToast(d.msg, true));
socket.on("song_banned", (d) => showToast(d?.msg || "Den låten är inte tillgänglig här.", true));

async function delaLank() {
    try {
        if (navigator.share) await navigator.share({ title: 'Jukebox', url: window.location.href });
        else { await navigator.clipboard.writeText(window.location.href); showToast("Länk kopierad!"); }
    } catch (e) {}
}

function startaScanner() {
    const scannerLayer = document.getElementById("scanner-layer");
    if (scannerLayer) scannerLayer.style.display = "block";
    html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        nuvarandeKupongKod = text;
        const parts = text.split('-');
        if (parts.length === 3) {
            mittSaldo = parseInt(parts[1]);
            showToast("Kupong laddad!");
        }
        stoppaScanner();
    }).catch(() => stoppaScanner());
}

function stoppaScanner() {
    if (html5QrCode) html5QrCode.stop().finally(() => {
        const scannerLayer = document.getElementById("scanner-layer");
        if (scannerLayer) scannerLayer.style.display = "none";
        html5QrCode = null;
    });
}

function showToast(msg, isError) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.innerText = msg; t.style.background = isError ? "#e91429" : "#1db954";
    t.style.display = "block";
    setTimeout(() => t.style.display = "none", 3000);
}

function initBgSettings() {
    const zoomSlider = document.getElementById('bg-zoom');
    const brightSlider = document.getElementById('bg-brightness');
    const zoomVal = document.getElementById('zoom-val');
    const brightVal = document.getElementById('bright-val');

    if (!zoomSlider || !brightSlider) return;

    const savedZoom = localStorage.getItem('bg_zoom') || '100';
    const savedBright = localStorage.getItem('bg_bright') || '30';

    const apply = () => {
        const z = zoomSlider.value;
        const b = brightSlider.value;
        document.body.style.setProperty('--bg-zoom', z + '%');
        document.body.style.setProperty('--bg-overlay', (b / 100));
        if (zoomVal) zoomVal.innerText = z + '%';
        if (brightVal) brightVal.innerText = b + '%';
        localStorage.setItem('bg_zoom', z);
        localStorage.setItem('bg_bright', b);
    };

    zoomSlider.value = savedZoom;
    brightSlider.value = savedBright;
    zoomSlider.oninput = apply;
    brightSlider.oninput = apply;
    apply();
}

initBgSettings();