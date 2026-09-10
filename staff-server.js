const express = require('express');
const app = express();
const http = require('http').createServer(app);
app.use(express.static(__dirname));
const io = require('socket.io')(http, { cors: { origin: "*" } });
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const youtubeSearchApi = require('youtube-search-api');
const libraryManager = require('./library-manager');

const pubar = {};
const MASTER_SECRET = "din-hemliga-globala-paniknyckel-2026";
const MAX_SONG_DURATION = 480;

function parseYouTubeDuration(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) return alias.address;
        }
    }
    return 'localhost';
}

function shuffleArray(array) {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

function flattenId(id) {
    if (!id) return "";
    if (typeof id === 'object') return id.videoId || id.id || "";
    return String(id);
}

function hämtaGemensammaListor() {
    try {
        const lib = libraryManager.getLibrary();
        const valv = {};
        Object.values(lib).forEach(song => {
            if (song.blocked || song.duration > MAX_SONG_DURATION) return;
            if (song.playlists && Array.isArray(song.playlists)) {
                const songObj = {
                    title: `${song.artist} - ${song.title}`,
                    videoId: flattenId(song.videoId),
                    thumbnail: song.thumbnail,
                    duration: song.duration || 0,
                    startPosition: (song.future && !isNaN(song.future[0])) ? parseFloat(song.future[0]) : 0,
                    stopPosition: (song.future && !isNaN(song.future[1])) ? parseFloat(song.future[1]) : 0
                };
                song.playlists.forEach(playlistName => {
                    if (!valv[playlistName]) valv[playlistName] = [];
                    if (!valv[playlistName].some(s => s.videoId === songObj.videoId)) valv[playlistName].push(songObj);
                });
            }
        });
        return valv;
    } catch (e) { return {}; }
}

function refreshShuffled(pub, type) {
    const valv = hämtaGemensammaListor();
    if (type === 'main') {
        pub.shuffledMain = pub.aktivtValv ? shuffleArray(valv[pub.aktivtValv] || []) : [];
    } else {
        pub.shuffledTemp = pub.aktivTillfalligLista ? shuffleArray(valv[pub.aktivTillfalligLista] || []) : [];
    }
}

function getBackgroundSongAt(pub, step) {
    const hasMain = pub.shuffledMain && pub.shuffledMain.length > 0;
    const hasTemp = pub.shuffledTemp && pub.shuffledTemp.length > 0;
    if (hasMain && hasTemp) {
        if (step % 2 === 0) return { ...pub.shuffledMain[Math.floor(step / 2) % pub.shuffledMain.length], addedBy: 'Bakgrund' };
        return { ...pub.shuffledTemp[Math.floor(step / 2) % pub.shuffledTemp.length], addedBy: 'Extra' };
    }
    if (hasMain) return { ...pub.shuffledMain[step % pub.shuffledMain.length], addedBy: 'Bakgrund' };
    if (hasTemp) return { ...pub.shuffledTemp[step % pub.shuffledTemp.length], addedBy: 'Bakgrund' };
    return null;
}

function sparaPubData(pubId) {
    const pub = pubar[pubId];
    if (!pub) return;
    const data = {
        namn: pub.namn, aktivtValv: pub.aktivtValv, aktivTillfalligLista: pub.aktivTillfalligLista,
        qrKrav: pub.qrKrav, statistikKuponger: pub.statistikKuponger, statistikTotalt: pub.statistikTotalt,
        moments: pub.moments, consumedTickets: pub.consumedTickets || {}
    };
    fs.writeFileSync(path.join(__dirname, 'data', `${pubId}.json`), JSON.stringify(data, null, 2));
}

function hämtaPubData(pubId) {
    if (!pubId) return null;
    if (!pubar[pubId]) {
        const filePath = path.join(__dirname, 'data', `${pubId}.json`);
        let d = {
            namn: `${pubId.toUpperCase()} Jukebox`, aktivtValv: '', aktivTillfalligLista: '', qrKrav: false,
            statistikKuponger: 0, statistikTotalt: 0,
            moments: {
                "pause": { title: "TYST / PAUS", category: "drift", type: "pause", isLocked: true },
                "lastcall": { videoId: "Ryt_mY8u9p8", title: "Sista beställningen", songTitle: "Last Call", thumbnail: "https://img.youtube.com/vi/Ryt_mY8u9p8/0.jpg", defaultMessage: "Sista beställningen i baren! 🔔", category: "drift" },
                "birthday": { videoId: "hS7GAnO146U", title: "Födelsedag", songTitle: "Happy Birthday", thumbnail: "https://img.youtube.com/vi/hS7GAnO146U/0.jpg", defaultMessage: "GRATTIS PÅ FÖDELSEDAGEN! 🎂", category: "firande" },
                "shoutout": { videoId: "dQw4w9WgXcQ", title: "Hälsning", songTitle: "Attention", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg", defaultMessage: "Uppmärksamhet i huset! 📢", category: "firande" },
                "closing": { videoId: "xGytDsqkQY8", title: "Stängning", songTitle: "Closing Time", thumbnail: "https://img.youtube.com/vi/xGytDsqkQY8/0.jpg", defaultMessage: "Tack för ikväll, vi stänger nu! 🌙", category: "avslut" },
                "tack": { videoId: "h-mXUnmE_Z4", title: "Tack", songTitle: "Thank You", thumbnail: "https://img.youtube.com/vi/h-mXUnmE_Z4/0.jpg", defaultMessage: "Slut för idag, tack för ikväll!", category: "avslut" }
            },
            consumedTickets: {}
        };
        if (fs.existsSync(filePath)) {
            try {
                const diskData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                Object.assign(d, diskData);
            } catch (e) { console.error("Fel vid inläsning av pubfil:", e); }
        }
        pubar[pubId] = { ...d, queue: [], nowPlaying: null, interruptedSong: null, playlistCursor: 0, shuffledMain: [], shuffledTemp: [], activeMoment: null, isTransitioning: false, lastNextTrigger: 0 };
    }
    const p = pubar[pubId];
    p.valv = hämtaGemensammaListor();
    if (p.shuffledMain.length === 0 && p.aktivtValv) refreshShuffled(p, 'main');
    if (p.shuffledTemp.length === 0 && p.aktivTillfalligLista) refreshShuffled(p, 'temp');
    return p;
}

function getFairQueue(pub) {
    const userQueues = {};
    pub.queue.forEach(s => {
        const uid = s.socketId || 'anon';
        if (!userQueues[uid]) userQueues[uid] = [];
        userQueues[uid].push(s);
    });
    const userIds = Object.keys(userQueues).filter(uid => userQueues[uid].length > 0);
    const fairList = [];
    let bgCursor = pub.playlistCursor;
    const tempQueues = {};
    userIds.forEach(uid => tempQueues[uid] = [...userQueues[uid]]);

    let hasSongs = true;
    while (hasSongs) {
        hasSongs = false;
        const activeUsers = userIds.filter(uid => tempQueues[uid].length > 0);
        if (activeUsers.length === 0) break;
        if (activeUsers.length > 1) {
            activeUsers.forEach(uid => {
                if (tempQueues[uid].length > 0) { fairList.push(tempQueues[uid].shift()); hasSongs = true; }
            });
        } else {
            const uid = activeUsers[0];
            while (tempQueues[uid].length > 0) {
                fairList.push(tempQueues[uid].shift());
                if (tempQueues[uid].length > 0) {
                    const bg = getBackgroundSongAt(pub, bgCursor++);
                    if (bg) fairList.push({ ...bg, id: 'bg_' + Date.now() + '_' + bgCursor, isListSong: true, duration: 180 });
                }
            }
            hasSongs = false;
        }
    }
    while (fairList.length < 15) {
        const bg = getBackgroundSongAt(pub, bgCursor++);
        if (bg) fairList.push({ ...bg, id: 'bg_' + Date.now() + '_' + bgCursor, isListSong: true, duration: 180 });
        else break;
    }
    return fairList;
}

function buildPayload(pubId) {
    const p = hämtaPubData(pubId);
    if (!p) return null;
    const fairQ = getFairQueue(p);
    let acc = 0;
    const q = fairQ.map(s => {
        const wait = Math.floor(acc / 60);
        acc += (s.duration || 180);
        return { ...s, waitMinutes: wait };
    });
    return {
        pubNamn: p.namn, qrKrav: !!p.qrKrav, statistikKuponger: p.statistikKuponger, statistikTotalt: p.statistikTotalt,
        aktivHuvudlista: p.aktivtValv, aktivTillfalligLista: p.aktivTillfalligLista,
        nowPlaying: p.nowPlaying, queue: q, fullQueue: q, valv: p.valv, activeMoment: p.activeMoment, momentsConfig: p.moments
    };
}

function broadcastState(pubId) {
    const payload = buildPayload(pubId);
    if (payload) {
        io.to(pubId).emit('state', payload);
        io.to(pubId).emit('staff_state', payload);
    }
}

function validateTicket(kod) {
    if (!kod) return null;
    const parts = kod.split('-');
    if (parts.length !== 3) return null;
    const expected = crypto.createHmac('sha256', MASTER_SECRET).update(`${parts[0]}-${parts[1]}`).digest('hex').substring(0, 6).toUpperCase();
    return (parts[2] === expected) ? { id: parts[0], total: parseInt(parts[1]) } : null;
}

async function resolveVideoId(song) {
    const text = typeof song === 'object' ? song.title : String(song);
    const lib = libraryManager.getLibrary();
    const entry = Object.values(lib).find(s => (s.artist + " - " + s.title).toLowerCase() === text.toLowerCase());
    if (entry && entry.videoId) return flattenId(entry.videoId);
    try {
        const res = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        return flattenId(res?.items?.[0]?.id || 'dQw4w9WgXcQ');
    } catch (e) { return 'dQw4w9WgXcQ'; }
}

async function korNastaLatLogik(pubId) {
    const p = hämtaPubData(pubId);
    if (!p || p.isTransitioning || p.activeMoment) return;
    p.isTransitioning = true;
    try {
        const fairQ = getFairQueue(p);
        let n = fairQ.length > 0 ? fairQ[0] : null;
        if (n) {
            if (!n.isListSong) {
                const idx = p.queue.findIndex(s => s.id === n.id);
                if (idx !== -1) p.queue.splice(idx, 1);
            } else { p.playlistCursor++; }
            const vid = flattenId(n.videoId) || await resolveVideoId(n.title);
            const lib = libraryManager.getLibrary();
            const meta = Object.values(lib).find(s => flattenId(s.videoId) === vid);
            p.nowPlaying = { id: n.id, title: n.title, videoId: vid, thumbnail: n.thumbnail || `https://img.youtube.com/vi/${vid}/0.jpg`, addedBy: n.addedBy || 'Bakgrund', startPosition: meta?.future?.[0] || 0, stopPosition: meta?.future?.[1] || 0 };
        } else { p.nowPlaying = null; }
        broadcastState(pubId);
    } finally { p.isTransitioning = false; }
}

app.get(['/pub/:pubId', '/pub/:pubId/mobile'], (req, res) => res.sendFile(path.join(__dirname, 'test-mobile.html')));
app.get('/pub/:pubId/staff', (req, res) => res.sendFile(path.join(__dirname, 'staff-app.html')));
app.get('/pub/:pubId/player', (req, res) => res.sendFile(path.join(__dirname, 'test-player.html')));

io.on('connection', (socket) => {
    socket.on('join_pub', (id) => { if (!id) return; socket.join(id); socket.pubId = id; hämtaPubData(id); broadcastState(id); });
    socket.on('search', async (d) => {
        const res = await youtubeSearchApi.GetListByKeyword(d.query, false, 12);
        const results = (res.items || []).map(i => ({ videoId: flattenId(i.id), title: i.title, thumbnail: i.thumbnail?.thumbnails?.[0]?.url || "", durationText: i.length?.simpleText || "", durationSeconds: parseYouTubeDuration(i.length?.simpleText) }))
            .filter(s => s.durationSeconds > 0 && s.durationSeconds <= MAX_SONG_DURATION);
        results.forEach(s => libraryManager.addOrUpdateSong(s));
        socket.emit('searchResults', { results });
    });
    socket.on('addSong', async (d) => {
        const p = hämtaPubData(socket.pubId || d.pubId);
        if (!p) return;
        if (p.qrKrav) {
            const t = validateTicket(d.kupongKod);
            if (!t) return socket.emit("kupong_error", { msg: "Ogiltig kod!" });
            if ((p.consumedTickets[t.id] || 0) >= t.total) return socket.emit("kupong_error", { msg: "Förbrukad!" });
            p.consumedTickets[t.id] = (p.consumedTickets[t.id] || 0) + 1;
            p.statistikKuponger++;
        }
        p.queue.push({ id: 'u_'+Date.now(), videoId: d.videoId, title: d.title, thumbnail: d.thumbnail, addedBy: 'Gäst', socketId: socket.id, duration: d.durationSeconds || 180 });
        p.statistikTotalt++; sparaPubData(socket.pubId);
        socket.emit("kupong_success");
        if (!p.nowPlaying && !p.activeMoment) await korNastaLatLogik(socket.pubId); else broadcastState(socket.pubId);
    });

    socket.on('admin:toggle_qr', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.qrKrav = !!data.qrKrav; sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('player:byt_valv', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivtValv = data.valvNamn; p.playlistCursor = 0; refreshShuffled(p, 'main'); sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('ADD_TEMP_PLAYLIST', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivTillfalligLista = data.playlist; refreshShuffled(p, 'temp'); broadcastState(socket.pubId); } });
    socket.on('REMOVE_TEMP_PLAYLIST', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivTillfalligLista = ''; broadcastState(socket.pubId); } });
    socket.on('player:ready_for_next', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:skip', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:remove_song', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.queue = p.queue.filter(s => s.id !== data.id); broadcastState(socket.pubId); } });
    socket.on('moment:activate', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        const cfg = p.moments[data.type];
        if (data.type === 'pause') { p.activeMoment = { type: 'pause' }; p.nowPlaying = null; }
        else if (cfg) { p.activeMoment = { type: data.type, videoId: flattenId(cfg.videoId) }; p.nowPlaying = { id: 'm_'+Date.now(), title: cfg.title, videoId: flattenId(cfg.videoId), thumbnail: cfg.thumbnail, addedBy: 'Staff', isMoment: true }; }
        broadcastState(socket.pubId);
    });
    socket.on('moment:stop', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.activeMoment = null; p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
});

http.listen(process.env.PORT || 3001, () => console.log("SERVER KÖRS!"));
