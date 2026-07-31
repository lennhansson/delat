const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubId = urlDelar[urlDelar.indexOf('pub') + 1] || "default_pub";

let nuvarandeState = null;
let mittSaldo = 0;
let html5QrCode = null;
let momentTimeout = null;

socket.emit("join_pub", pubId);

window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const biljettKod = params.get('kod');
    if (biljettKod) {
        setKupong(biljettKod);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

function bytFlik(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const targetTab = document.getElementById('tab-' + tab);
    const targetBtn = document.getElementById('btn-tab-' + tab);
    if (targetTab) targetTab.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
}

function döljMomentOverlay() {
    const overlay = document.getElementById("moment-overlay");
    if (overlay) overlay.style.display = "none";
    if (momentTimeout) clearTimeout(momentTimeout);
}

socket.on("state", (data) => {
    if (!data) return;
    const gammaltMoment = nuvarandeState?.activeMoment?.type;
    nuvarandeState = data;

    const pubTitelEl = document.getElementById("pub-titel");
    if (pubTitelEl) pubTitelEl.innerText = data.pubNamn || "Jukebox";

    const npImg = document.getElementById("now-playing-img-container");
    const npText = document.getElementById("now-playing-text");
    const npMeta = document.getElementById("now-playing-meta");

    if (data.nowPlaying) {
        if (npImg) npImg.innerHTML = `<img src="${data.nowPlaying.thumbnail || 'https://via.placeholder.com/120?text=♫'}" class="now-playing-thumb">`;
        if (npText) npText.innerText = data.nowPlaying.title;
        if (npMeta) npMeta.innerText = `Lades till av: ${data.nowPlaying.addedBy}`;
    } else {
        if (npImg) npImg.innerHTML = "";
        if (npText) npText.innerText = "Tyst just nu...";
        if (npMeta) npMeta.innerText = "";
    }

    const queueLista = document.getElementById("queue-lista");
    if (queueLista) {
        const queue = data.fullQueue || [];
        if (queue.length === 0) {
            queueLista.innerHTML = "<div style='padding:10px; color:#666; font-size:13px;'>Kön är tom. Sök efter en låt för att önska!</div>";
        } else {
            queueLista.innerHTML = queue.map((l, i) => `
                <div class="song-row queue-row">
                    <div class="song-index">${i + 1}</div>
                    <div class="song-info">
                        <div class="song-title">${l.title}</div>
                        <div class="song-meta">${l.addedBy}</div>
                    </div>
                </div>
            `).join("");
        }
    }

    const knappSaldo = document.getElementById("knapp-saldo");
    if (knappSaldo) {
        if (data.qrKrav) {
            knappSaldo.style.display = "flex";
            knappSaldo.innerText = mittSaldo;
        } else {
            knappSaldo.style.display = "none";
        }
    }

    const overlay = document.getElementById("moment-overlay");
    if (overlay) {
        if (data.activeMoment) {
            const msgEl = document.getElementById("moment-msg");
            if (msgEl) msgEl.innerText = data.activeMoment.message || "";
            const titleEl = document.getElementById("moment-title");
            const iconEl = overlay.querySelector(".icon");
            if (data.activeMoment.type === 'birthday') { if(titleEl) titleEl.innerText = "FÖDELSEDAG! 🎂"; if(iconEl) iconEl.innerText = "🥳"; }
            else if (data.activeMoment.type === 'lastcall') { if(titleEl) titleEl.innerText = "SISTA BESTÄLLNINGEN"; if(iconEl) iconEl.innerText = "🔔"; }
            else if (data.activeMoment.type === 'closing') { if(titleEl) titleEl.innerText = "TACK FÖR IKVÄLL"; if(iconEl) iconEl.innerText = "🌙"; }
            else if (data.activeMoment.type === 'pause') { if(titleEl) titleEl.innerText = "MEDDELANDE"; if(iconEl) iconEl.innerText = "📢"; }

            if (data.activeMoment.type !== gammaltMoment) {
                overlay.style.display = "flex";
                if (momentTimeout) clearTimeout(momentTimeout);
                momentTimeout = setTimeout(() => {
                    overlay.style.display = "none";
                }, 10000);
            }
        } else {
            overlay.style.display = "none";
            if (momentTimeout) clearTimeout(momentTimeout);
        }
    }
});

function sök() {
    const q = document.getElementById("query").value.trim();
    if (!q) return;
    socket.emit("search", { query: q });
}

socket.on("searchResults", (data) => {
    const resDiv = document.getElementById("results");
    if (!resDiv) return;
    if (!data.results || data.results.length === 0) {
        resDiv.innerHTML = "<div style='padding:20px; text-align:center; color:#888;'>Inga låtar hittades.</div>";
        return;
    }
    resDiv.innerHTML = data.results.map(s => `
        <div class="song-row">
            <img src="${s.thumbnail}" class="song-thumb">
            <div class="song-info">
                <div class="song-title">${s.title}</div>
            </div>
            <button class="add-btn" onclick="önskaLåt('${s.videoId}', '${s.title.replace(/'/g, "\\'")}', '${s.thumbnail}')">ÖNSKA</button>
        </div>
    `).join("");
});

function önskaLåt(videoId, title, thumbnail) {
    const kupongKod = document.getElementById("kupong-input").value;
    socket.emit("addSong", {
        pubId,
        videoId,
        title,
        thumbnail,
        kupongKod
    });
}

socket.on("kupong_success", (data) => {
    showToast(data.msg || "Låten tillagd!");
    document.getElementById("query").value = "";
    const resDiv = document.getElementById("results");
    if (resDiv) resDiv.innerHTML = "";
    if (data.resterande !== undefined) {
        uppdateraSaldo(data.resterande);
    }
});

socket.on("kupong_error", (data) => {
    alert(data.msg || "Kunde inte lägga till låten.");
});

function showToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.innerText = msg;
    t.style.display = "block";
    setTimeout(() => { t.style.display = "none"; }, 3000);
}

function kontrolleraKrav() {
    if (nuvarandeState && nuvarandeState.qrKrav && mittSaldo <= 0) {
        bytFlik('qr');
    }
}

function startaScanner() {
    const scannerLayer = document.getElementById("scanner-layer");
    scannerLayer.style.display = "flex";
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
        stoppaScanner();
        let kod = decodedText;
        if (decodedText.includes("kod=")) {
            kod = decodedText.split("kod=")[1].split("&")[0];
        }
        setKupong(kod);
    }).catch(err => {
        stoppaScanner();
        alert("Kunde inte starta kameran.");
    });
}

function stoppaScanner() {
    document.getElementById("scanner-layer").style.display = "none";
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop();
    }
}

function setKupong(kod) {
    let renKod = kod;
    if (kod.includes("kod=")) renKod = kod.split("kod=")[1].split("&")[0];
    const input = document.getElementById("kupong-input");
    if (input) input.value = renKod;
    const delar = renKod.split('-');
    if (delar.length >= 2) {
        const antal = parseInt(delar[1]);
        if (!isNaN(antal)) {
            uppdateraSaldo(antal);
            showToast("Biljett aktiverad!");
            bytFlik('sok');
        }
    }
}

function uppdateraSaldo(nyttSaldo) {
    mittSaldo = nyttSaldo;
    const saldoText = document.getElementById("saldo-info-text");
    const knappSaldo = document.getElementById("knapp-saldo");
    if (saldoText) saldoText.innerText = mittSaldo;
    if (knappSaldo) {
        knappSaldo.innerText = mittSaldo;
        knappSaldo.style.display = (nuvarandeState && nuvarandeState.qrKrav) ? "flex" : "none";
    }
}