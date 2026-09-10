const socket = io();
const pubId = window.location.pathname.split('/')[2] || "default_pub";

socket.emit("join_pub", pubId);

function bytFlik(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if(tab === 'dela') genereraDelaQR();
}

function genereraDelaQR() {
    const target = document.getElementById("share-qr-target");
    if (!target) return;
    target.innerHTML = "";
    new QRCode(target, { text: window.location.href, width: 200, height: 200 });
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
    socket.emit("addSong", { videoId, title, thumbnail });
    document.getElementById("results").innerHTML = "";
    document.getElementById("query").value = "";
    showToast("Låt tillagd!");
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
    // VIKTIGT: Visa endast de 3 första låtarna
    const displayQueue = (data.queue || []).slice(0, 3);
    qList.innerHTML = displayQueue.map((l, i) => `
        <div class="song-row ${l.socketId === socket.id ? 'my-song' : ''}">
            <div class="song-index">${i + 1}</div>
            <div class="song-info">
                <div class="song-title">${l.title}</div>
                <div class="song-meta">${l.isListSong ? 'Bakgrund' : 'Önskad'} • ${l.addedBy}</div>
            </div>
        </div>
    `).join("");
});

async function delaLank() {
    if (navigator.share) {
        navigator.share({ title: 'Jukebox', url: window.location.href });
    } else {
        navigator.clipboard.writeText(window.location.href);
        showToast("Länk kopierad!");
    }
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg; t.style.display = "block";
    setTimeout(() => t.style.display = "none", 3000);
}