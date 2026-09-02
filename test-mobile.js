const socket = io();
const pubId = window.location.pathname.split('/')[2] || "default_pub";

let nuvarandeState = null;
let mittSaldo = 0;
let html5QrCode = null;

socket.emit("join_pub", pubId);

function bytFlik(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('btn-tab-' + tab).classList.add('active');
    if(tab === 'dela') genereraDelaQR();
}

function genereraDelaQR() {
    const target = document.getElementById("share-qr-target");
    if (!target) return;
    target.innerHTML = "";
    new QRCode(target, { text: window.location.href, width: 200, height: 200 });
}

socket.on("state", (data) => {
    nuvarandeState = data;
    document.getElementById("pub-titel").innerText = data.pubNamn;

    // Kö-rendering med väntetider
    const queueLista = document.getElementById("queue-lista");
    const queue = data.fullQueue || [];
    if (queue.length === 0) {
        queueLista.innerHTML = "<div class='empty-msg'>Kön är tom. Sök efter en låt!</div>";
    } else {
        queueLista.innerHTML = queue.map((l, i) => {
            const isMySong = l.socketId === socket.id;
            const timeLabel = l.waitMinutes === 0 ? "Härnäst" : `ca ${l.waitMinutes} min`;
            return `
                <div class="song-row ${isMySong ? 'my-song' : ''}">
                    <div class="song-index">${i + 1}</div>
                    <div class="song-info">
                        <div class="song-title">${l.title}</div>
                        <div class="song-meta">
                            <span class="wait-tag">${timeLabel}</span>
                            ${isMySong ? '<span class="my-tag">DIN ÖNSKNING</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }

    // Saldo
    const knappSaldo = document.getElementById("knapp-saldo");
    knappSaldo.style.display = data.qrKrav ? "flex" : "none";
    knappSaldo.innerText = mittSaldo;
});

function sök() {
    const q = document.getElementById("query").value.trim();
    if (q) socket.emit("search", { query: q });
}

socket.on("searchResults", (data) => {
    const resDiv = document.getElementById("results");
    resDiv.innerHTML = data.results.map(s => `
        <div class="song-row">
            <img src="${s.thumbnail}" class="song-thumb">
            <div class="song-info">
                <div class="song-title">${s.title}</div>
                <div class="song-meta">${s.durationText}</div>
            </div>
            <button class="add-btn" onclick="önskaLåt('${s.videoId}','${s.title.replace(/'/g,"\\'")}','${s.thumbnail}')">ÖNSKA</button>
        </div>
    `).join("");
});

function önskaLåt(videoId, title, thumbnail) {
    socket.emit("addSong", { pubId, videoId, title, thumbnail, kupongKod: document.getElementById("kupong-input").value });
}

socket.on("kupong_success", (data) => {
    showToast("Låten tillagd!");
    bytFlik('queue');
});

// ... (startaScanner, stoppaScanner och setKupong som förut) ...

function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg; t.style.display = "block";
    setTimeout(() => t.style.display = "none", 3000);
}