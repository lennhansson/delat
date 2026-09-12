const socket = io();
const pubId = window.location.pathname.split('/')[2] || "default_pub";
let mittSaldo = 0;
let html5QrCode = null;
let nuvarandeKupongKod = ""; // Sparar koden internt

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

function sök() {
    const q = document.getElementById("query").value.trim();
    if (q) socket.emit("search", { query: q });
}

socket.on("searchResults", (data) => {
    document.getElementById("results").innerHTML = data.results.map(s => `
        <div class="song-row">
            <img src="${s.thumbnail}" class="song-thumb">
            <div class="song-info"><div class="song-title">${s.title}</div></div>
            <button class="add-btn" onclick="önskaLåt('${s.videoId}','${s.title.replace(/'/g,"\\'")}','${s.thumbnail}')">ÖNSKA</button>
        </div>
    `).join("");
});

function önskaLåt(videoId, title, thumbnail) {
    // Använder den lagrade variabeln istället för ett input-fält
    socket.emit("addSong", { pubId, videoId, title, thumbnail, kupongKod: nuvarandeKupongKod });
}

socket.on("state", (data) => {
    document.getElementById("pub-titel").innerText = data.pubNamn;
    const np = data.nowPlaying;
    const npContainer = document.getElementById("now-playing-container");
    if (np) {
        npContainer.style.display = "flex";
        document.getElementById("np-thumb").src = np.thumbnail;
        document.getElementById("np-title").innerText = np.title;
        document.getElementById("np-meta").innerText = np.addedBy;
    } else { npContainer.style.display = "none"; }

    const qList = document.getElementById("queue-lista");
    const displayQueue = (data.queue || []).slice(0, 3);
    qList.innerHTML = displayQueue.length === 0 ? "<div style='text-align:center; color:#666; padding:20px;'>Kön är tom</div>" : displayQueue.map((l, i) => `
        <div class="song-row ${l.socketId === socket.id ? 'my-song' : ''}">
            <div class="song-index">${i + 1}</div>
            <div class="song-info">
                <div class="song-title">${l.title}</div>
                <div class="song-meta">${l.isListSong ? 'Bakgrund' : 'Gäst'} • ${l.addedBy}</div>
            </div>
        </div>
    `).join("");

    const saldoText = document.getElementById("saldo-info-text");
    if (saldoText) saldoText.innerText = mittSaldo;
});

socket.on("kupong_success", () => {
    if (mittSaldo > 0) mittSaldo--;
    document.getElementById("results").innerHTML = "";
    document.getElementById("query").value = "";
    showToast("Låt tillagd! 🎵");
});

socket.on("kupong_error", (d) => showToast(d.msg, true));

async function delaLank() {
    try {
        if (navigator.share) await navigator.share({ title: 'Jukebox', url: window.location.href });
        else { await navigator.clipboard.writeText(window.location.href); showToast("Länk kopierad!"); }
    } catch (e) {}
}

function startaScanner() {
    document.getElementById("scanner-layer").style.display = "block";
    html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        nuvarandeKupongKod = text; // Sparar den skannade koden i variabeln
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
        document.getElementById("scanner-layer").style.display = "none";
        html5QrCode = null;
    });
}

function showToast(msg, isError) {
    const t = document.getElementById("toast");
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
    const savedBright = localStorage.getItem('bg_bright') || '85';

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