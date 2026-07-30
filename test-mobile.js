const socket = io();
const urlDelar = window.location.pathname.split('/');
const pubId = urlDelar[urlDelar.indexOf('pub') + 1] || "default_pub";

let nuvarandeState = null;
let mittSaldo = 0;

// Gå med i pubens rum för att få realtidsuppdateringar
socket.emit("join_pub", pubId);

// FLIK-NAVIGERING
function bytFlik(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const targetTab = document.getElementById('tab-' + tab);
    const targetBtn = document.getElementById('btn-tab-' + tab);

    if (targetTab) targetTab.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
}

// UPPDATERA STATE (Låtlista, nu spelas, etc)
socket.on("state", (data) => {
    if (!data) return;
    nuvarandeState = data;

    // Pub Titel
    const pubTitelEl = document.getElementById("pub-titel");
    if (pubTitelEl) pubTitelEl.innerText = data.pubNamn || "Jukebox";

    // Nu Spelas
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

    // Låtlistan (Kön)
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

    // Saldo / QR Krav
    const knappSaldo = document.getElementById("knapp-saldo");
    if (knappSaldo) {
        if (data.qrKrav) {
            knappSaldo.style.display = "flex";
            knappSaldo.innerText = mittSaldo;
        } else {
            knappSaldo.style.display = "none";
        }
    }

    // MOMENT HANDLING (Overlay)
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
            else { if(titleEl) titleEl.innerText = "Viktigt meddelande"; if(iconEl) iconEl.innerText = "📢"; }

            overlay.style.display = "flex";
        } else {
            overlay.style.display = "none";
        }
    }
});

// SÖK-FUNKTION
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

// ÖNSKA LÅT
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
    if (data.resterande !== undefined) {
        mittSaldo = data.resterande;
        const saldoText = document.getElementById("saldo-info-text");
        const knappSaldo = document.getElementById("knapp-saldo");
        if (saldoText) saldoText.innerText = mittSaldo;
        if (knappSaldo) knappSaldo.innerText = mittSaldo;
    }
    document.getElementById("query").value = "";
    const resDiv = document.getElementById("results");
    if (resDiv) resDiv.innerHTML = "";
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

// KONTROLLERA OM QR KRÄVS
function kontrolleraKrav() {
    if (nuvarandeState && nuvarandeState.qrKrav && mittSaldo <= 0) {
        bytFlik('qr');
    }
}

// QR SKANNING (SIMULERAD)
function scannaQR() {
    document.getElementById("qr-camera-input").click();
}

function lasQR(input) {
    if (input.files && input.files[0]) {
        // Simulerar avkodning av QR
        const demoKod = "TEST-5-" + Math.floor(Math.random()*1000);
        setKupong(demoKod);
    }
}

function setKupong(kod) {
    const input = document.getElementById("kupong-input");
    if (input) input.value = kod;

    const delar = kod.split('-');
    if (delar.length === 3) {
        mittSaldo = parseInt(delar[1]);
        const saldoText = document.getElementById("saldo-info-text");
        const knappSaldo = document.getElementById("knapp-saldo");
        if (saldoText) saldoText.innerText = mittSaldo;
        if (knappSaldo) {
            knappSaldo.innerText = mittSaldo;
            knappSaldo.style.display = "flex";
        }
        showToast("Biljett aktiverad!");
        bytFlik('sok');
    }
}