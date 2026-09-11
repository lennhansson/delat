const socket = io();
const pubId = window.location.pathname.split('/')[2] || "default_pub";
let mittSaldo = 0;
let html5QrCode = null;

socket.emit("join_pub", pubId);

// --- NAVIGATION & SWIPE ---
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
    if(tab === 'dela') genereraDelaQR();
}

// --- DELA ---
function genereraDelaQR() {
    const target = document.getElementById("share-qr-target");
    if (!target || target.innerHTML !== "") return;
    new QRCode(target, { text: window.location.href, width: 180, height: 180 });
}

async function delaLank() {
    try {
        if (navigator.share) {
            await navigator.share({ title: 'Jukebox', text: 'Häng med och önska låtar!', url: window.location.href });
        } else {
            await navigator.clipboard.writeText(window.location.href);
            showToast("Länk kopierad! 📋");
        }
    } catch (e) { console.log("Dela avbröts"); }
}

// --- SÖK & KÖ ---
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
    const kupongKod = document.getElementById("kupong-input").value;
    socket.emit("addSong", { pubId, videoId, title, thumbnail, kupongKod });
}

socket.on("state", (data) => {
    document.getElementById("pub-titel").innerText = data.pubNamn;

    // Now Playing
    const np = data.nowPlaying;
    const npContainer = document.getElementById("now-playing-container");
    if (np) {
        npContainer.style.display = "flex";
        document.getElementById("np-thumb").src = np.thumbnail;
        document.getElementById("np-title").innerText = np.title;
        document.getElementById("np-meta").innerText = np.addedBy;
    } else { npContainer.style.display = "none"; }

    // Saldo
    const knappSaldo = document.getElementById("knapp-saldo");
    if (knappSaldo) {
        knappSaldo.style.display = data.qrKrav ? "flex" : "none";
        knappSaldo.innerText = mittSaldo;
    }
    const saldoText = document.getElementById("saldo-info-text");
    if (saldoText) saldoText.innerText = mittSaldo;

    // Kö (Top 3)
    const qList = document.getElementById("queue-lista");
    const displayQueue = (data.queue || []).slice(0, 3);
    if (displayQueue.length === 0) {
        qList.innerHTML = "<div style='text-align:center; color:#666; padding:20px;'>Kön är tom - önska nåt!</div>";
    } else {
        qList.innerHTML = displayQueue.map((l, i) => `
            <div class="song-row ${l.socketId === socket.id ? 'my-song' : ''}">
                <div class="song-index">${i + 1}</div>
                <div class="song-info">
                    <div class="song-title">${l.title}</div>
                    <div class="song-meta">${l.isListSong ? 'Bakgrund' : 'Gäst'} • ${l.addedBy}</div>
                </div>
            </div>
        `).join("");
    }
});

socket.on("kupong_success", () => {
    if (mittSaldo > 0) mittSaldo--;
    document.getElementById("results").innerHTML = "";
    document.getElementById("query").value = "";
    showToast("Låten tillagd! 🎵");
});

socket.on("kupong_error", (data) => showToast(data.msg, true));

// --- TICKET SCANNER ---
function startaScanner() {
    document.getElementById("scanner-layer").style.display = "block";
    html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        const parts = text.split('-');
        if (parts.length === 3) {
            document.getElementById("kupong-input").value = text;
            mittSaldo = parseInt(parts[1]);
            showToast("Kupong laddad: " + mittSaldo + " låtar");
            stoppaScanner();
        }
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