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
const videoIdCache = new Map();
const MASTER_SECRET = "din-hemliga-globala-paniknyckel-2026";

// --- KONFIGURATION ---
const MAX_SONG_DURATION = 480; // 8 minuter i sekunder

// --- UTILS ---
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
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
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
            if (song.blocked) return;
            if (song.duration > MAX_SONG_DURATION) return;

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
                    if (!valv[playlistName].some(s => s.videoId === songObj.videoId)) {
                        valv[playlistName].push(songObj);
                    }
                });
            }
        });
        return valv;
    } catch (e) {
        console.error("Fel i hämtaGemensammaListor:", e);
        return {};
    }
}

function refreshShuffled(pub, type) {
    if (!pub) return;
    const valv = hämtaGemensammaListor();
    if (type === 'main') {
        const listName = pub.aktivtValv;
        pub.shuffledMain = (listName && valv[listName]) ? shuffleArray(valv[listName]) : [];
    } else if (type === 'temp') {
        const listName = pub.aktivTillfalligLista;
        pub.shuffledTemp = (listName && valv[listName]) ? shuffleArray(valv[listName]) : [];
    }
}

function getBackgroundSongAt(pub, step) {
    if (!pub) return null;
    const hasMain = Array.isArray(pub.shuffledMain) && pub.shuffledMain.length > 0;
    const hasTemp = Array.isArray(pub.shuffledTemp) && pub.shuffledTemp.length > 0;

    let selected = null;
    if (hasMain && hasTemp) {
        if (step % 2 === 0) {
            selected = pub.shuffledMain[Math.floor(step / 2) % pub.shuffledMain.length];
            return { ...selected, addedBy: 'Bakgrund (Huvud)', playlist: pub.aktivtValv };
        } else {
            selected = pub.shuffledTemp[Math.floor(step / 2) % pub.shuffledTemp.length];
            return { ...selected, addedBy: 'Bakgrund (Extra)', playlist: pub.aktivTillfalligLista };
        }
    } else if (hasMain) {
        selected = pub.shuffledMain[step % pub.shuffledMain.length];
        return { ...selected, addedBy: 'Bakgrund', playlist: pub.aktivtValv };
    } else if (hasTemp) {
        selected = pub.shuffledTemp[step % pub.shuffledTemp.length];
        return { ...selected, addedBy: 'Bakgrund', playlist: pub.aktivTillfalligLista };
    }
    return null;
}

function sparaPubData(pubId) {
    const pub = pubar[pubId];
    if (!pub) return;
    const filePath = path.join(__dirname, 'data', `${pubId}.json`);
    const dataToSave = {
        namn: pub.namn,
        aktivtValv: pub.aktivtValv,
        aktivTillfalligLista: pub.aktivTillfalligLista,
        qrKrav: pub.qrKrav,
        statistikKuponger: pub.statistikKuponger,
        statistikTotalt: pub.statistikTotalt,
        moments: pub.moments,
        consumedTickets: pub.consumedTickets || {}
    };
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
}

function hämtaPubData(pubId) {
    if (!pubId) return null;
    if (!pubar[pubId]) {
        const filePath = path.join(__dirname, 'data', `${pubId}.json`);
        let initialData = {
            namn: `${pubId.toUpperCase()} Jukebox`,
            aktivtValv: '', aktivTillfalligLista: '', qrKrav: false,
            statistikKuponger: 0, statistikTotalt: 0,
            moments: {
                "pause": { title: "TYST / PAUS", category: "drift", type: "pause", isLocked: true },
                "lastcall": { videoId: "Ryt_mY8u9p8", title: "Last Call", songTitle: "Last Call", thumbnail: "https://img.youtube.com/vi/Ryt_mY8u9p8/0.jpg", defaultMessage: "Sista beställningen i baren! 🔔", category: "drift" },
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
                const source = diskData.config ? diskData.config : diskData;
                Object.keys(initialData).forEach(key => { if (source[key] !== undefined) initialData[key] = source[key]; });
            } catch (e) { console.error("Fel vid inläsning av pubfil:", e); }
        }

        pubar[pubId] = {
            ...initialData, queue: [], nowPlaying: null, interruptedSong: null,
            playlistCursor: 0, shuffledMain: [], shuffledTemp: [], activeMoment: null,
            isTransitioning: false, lastNextTrigger: 0
        };
    }
    const pub = pubar[pubId];
    pub.valv = hämtaGemensammaListor();
    if (pub.shuffledMain.length === 0 && pub.aktivtValv) refreshShuffled(pub, 'main');
    if (pub.shuffledTemp.length === 0 && pub.aktivTillfalligLista) refreshShuffled(pub, 'temp');
    return pub;
}

function buildPayload(pubId) {
    const pub = hämtaPubData(pubId);
    if (!pub) return null;

    const requestedQueue = Array.isArray(pub.queue) ? pub.queue : [];
    // Visa 5 kommande låtar från bakgrundslistorna
    const listSongs = getUpcomingListSongs(pub, 5);
    const combinedQueue = [...requestedQueue, ...listSongs];

    // Beräkna ungefärlig väntetid
    let accumSeconds = 0;
    const queueWithEstimates = combinedQueue.map(song => {
        const waitTime = Math.floor(accumSeconds / 60);
        let d = song.duration || 180; // Fallback 3 min
        accumSeconds += d;
        return { ...song, waitMinutes: waitTime };
    });

    return {
        pubNamn: pub.namn || pubId, qrKrav: !!pub.qrKrav,
        statistikKuponger: pub.statistikKuponger || 0, statistikTotalt: pub.statistikTotalt || 0,
        aktivHuvudlista: pub.aktivtValv || '', aktivTillfalligLista: pub.aktivTillfalligLista || '',
        nowPlaying: pub.nowPlaying, queue: queueWithEstimates, fullQueue: queueWithEstimates,
        valv: pub.valv || {}, activeMoment: pub.activeMoment, momentsConfig: pub.moments
    };
}

function broadcastState(pubId, socket = null) {
    const payload = buildPayload(pubId);
    if (!payload) return;
    if (socket) { socket.emit('staff_state', payload); socket.emit('state', payload); }
    else { io.to(pubId).emit('staff_state', payload); io.to(pubId).emit('state', payload); }
}

function getUpcomingListSongs(pub, limit = 5) {
    if (!pub) return [];
    const items = [];
    const start = pub.playlistCursor || 0;
    for (let i = 0; i < limit; i += 1) {
        const bgSong = getBackgroundSongAt(pub, start + i);
        if (bgSong) items.push({
            id: `list_${pub.aktivtValv}_${start + i}`,
            title: bgSong.title,
            videoId: bgSong.videoId,
            duration: bgSong.duration,
            addedBy: bgSong.addedBy,
            isListSong: true
        });
    }
    return items;
}

function validateTicket(kod) {
    if (!kod) return null;
    const delar = kod.split('-');
    if (delar.length !== 3) return null;
    const [id, antal, sig] = delar;
    const expectedSig = crypto.createHmac('sha256', MASTER_SECRET).update(`${id}-${antal}`).digest('hex').substring(0, 6).toUpperCase();
    return (sig === expectedSig) ? { id, total: parseInt(antal) } : null;
}

async function resolveVideoId(song) {
    const text = typeof song === 'object' ? (song.title || 'dQw4w9WgXcQ') : String(song);
    const cacheKey = text.toLowerCase();
    try {
        const lib = libraryManager.getLibrary();
        const entry = Object.values(lib).find(s => (s.artist + " - " + s.title).toLowerCase() === cacheKey);
        if (entry && entry.videoId) return flattenId(entry.videoId);
    } catch (e) { }
    if (videoIdCache.has(cacheKey)) return videoIdCache.get(cacheKey);
    try {
        const result = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        let id = flattenId(result?.items?.[0]?.id || result?.items?.[0]?.videoId || null);
        if (id) { videoIdCache.set(cacheKey, id); return id; }
    } catch (err) { }
    return 'dQw4w9WgXcQ';
}

async function korNastaLatLogik(pubId) {
    const pub = hämtaPubData(pubId);
    if (!pub || pub.isTransitioning) return;
    if (!pub.activeMoment && pub.interruptedSong) {
        pub.nowPlaying = { ...pub.interruptedSong, id: 'resumed_' + Date.now() };
        pub.interruptedSong = null;
        broadcastState(pubId);
        return;
    }
    // STOPPA ALL LOGIK om ett moment körs
    if (pub.activeMoment) return;

    const nu = Date.now();
    if (pub.nowPlaying && nu - pub.lastNextTrigger < 1000) return;
    pub.lastNextTrigger = nu;
    pub.isTransitioning = true;

    try {
        let nastaLat = null;
        if (pub.queue && pub.queue.length > 0) nastaLat = pub.queue.shift();
        else {
            const bgSong = getBackgroundSongAt(pub, pub.playlistCursor);
            if (bgSong) { nastaLat = { ...bgSong, id: 'valv_' + pub.playlistCursor + '_' + Date.now(), isListSong: true }; pub.playlistCursor++; }
        }

        if (nastaLat) {
            let videoId = flattenId(nastaLat.videoId);
            if (!videoId) videoId = await resolveVideoId(nastaLat.title);

            const lib = libraryManager.getLibrary();
            const meta = Object.values(lib).find(s => flattenId(s.videoId) === videoId);

            pub.nowPlaying = {
                id: nastaLat.id, title: nastaLat.title, videoId,
                thumbnail: nastaLat.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
                addedBy: nastaLat.addedBy || 'Gäst', isListSong: !!nastaLat.isListSong,
                startPosition: (meta?.future && !isNaN(meta.future[0])) ? parseFloat(meta.future[0]) : 0,
                stopPosition: (meta?.future && !isNaN(meta.future[1])) ? parseFloat(meta.future[1]) : 0
            };
            broadcastState(pubId);
        } else if (pub.nowPlaying) { pub.nowPlaying = null; broadcastState(pubId); }
    } catch (e) { console.error("Fel i korNastaLatLogik:", e); } finally { pub.isTransitioning = false; }
}

// --- ROUTES ---
app.get('/pub/:pubId', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-mobile.html'));
});

app.get('/pub/:pubId/staff', (req, res) => {
    res.sendFile(path.join(__dirname, 'staff-app.html'));
});

app.get('/pub/:pubId/player', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-player.html'));
});

io.on('connection', (socket) => {
    socket.on('join_pub', (pubId) => { if (!pubId) return; socket.join(pubId); socket.pubId = pubId; hämtaPubData(pubId); broadcastState(pubId, socket); });

    socket.on('search', async (data) => {
        try {
            const res = await youtubeSearchApi.GetListByKeyword(data.query, false, 12);
            const results = (res.items || []).map(i => {
                const dText = i.length?.simpleText || "";
                const dSec = parseYouTubeDuration(dText);
                return {
                    videoId: flattenId(i.id || i.videoId), title: i.title,
                    thumbnail: i.thumbnail?.thumbnails?.[0]?.url || "",
                    durationText: dText, durationSeconds: dSec
                };
            })
            .filter(s => s.videoId && s.durationSeconds > 0 && s.durationSeconds <= MAX_SONG_DURATION);

            results.forEach(item => {
                libraryManager.addOrUpdateSong({
                    videoId: item.videoId, title: item.title, thumbnail: item.thumbnail, duration: item.durationSeconds
                });
            });
            socket.emit('searchResults', { results });
        } catch (e) { }
    });

    socket.on('addSong', async (data) => {
        const pub = hämtaPubData(data.pubId || socket.pubId);
        if (!pub) return;
        const videoId = flattenId(data.videoId);
        const lib = libraryManager.getLibrary();
        const meta = Object.values(lib).find(s => flattenId(s.videoId) === videoId);

        pub.queue.push({
            id: Math.random().toString(36).substr(2, 9), videoId, title: data.title,
            thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
            addedBy: 'Gäst', socketId: socket.id,
            duration: meta?.duration || 0
        });
        pub.statistikTotalt++; sparaPubData(socket.pubId || data.pubId);
        socket.emit("kupong_success", { msg: "Låten tillagd!" });
        if (!pub.nowPlaying && !pub.activeMoment) await korNastaLatLogik(socket.pubId || data.pubId); else broadcastState(socket.pubId || data.pubId);
    });

    // Hantering av bibliotek och valv
    socket.on('admin:add_to_valv', (data) => {
        if (!socket.pubId) return;
        libraryManager.addOrUpdateSong(data, data.valvNamn);
        broadcastState(socket.pubId);
    });

    socket.on('admin:remove_from_valv', (data) => {
        if (!socket.pubId) return;
        libraryManager.removeSongFromPlaylist(data.latNamn, data.valvNamn);
        broadcastState(socket.pubId);
    });

    socket.on('admin:request_valv_data', (data) => {
        if (!socket.pubId) return;
        const valv = hämtaGemensammaListor();
        socket.emit('admin:valv_data', { valvNamn: data.valvNamn, songs: valv[data.valvNamn] || [] });
    });

    socket.on('player:byt_valv', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivtValv = data.valvNamn; p.playlistCursor = 0; refreshShuffled(p, 'main'); sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('ADD_TEMP_PLAYLIST', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivTillfalligLista = data.playlist; refreshShuffled(p, 'temp'); sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('REMOVE_TEMP_PLAYLIST', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.aktivTillfalligLista = ''; p.shuffledTemp = []; sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('admin:toggle_qr', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.qrKrav = !!data.qrKrav; sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('player:skip', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.nowPlaying = null; p.interruptedSong = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:ready_for_next', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); if (p.activeMoment && !['pause','closing'].includes(p.activeMoment.type)) p.activeMoment = null; p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:remove_song', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.queue = p.queue.filter(s => s.id !== data.id); sparaPubData(socket.pubId); broadcastState(socket.pubId); } });

    // Hantering av moments
    socket.on('moment:save_settings', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.moments[data.type] = {
            videoId: data.videoId,
            title: data.title,
            songTitle: data.songTitle,
            thumbnail: data.thumbnail,
            defaultMessage: data.defaultMessage,
            category: data.category
        };
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('moment:activate', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (p.nowPlaying && !p.nowPlaying.isMoment) p.interruptedSong = p.nowPlaying;
        if (data.type === 'pause') { p.activeMoment = { type: 'pause', message: data.message || "Paus", time: Date.now() }; p.nowPlaying = null; }
        else {
            const cfg = p.moments[data.type]; if (!cfg) return;
            const vid = flattenId(cfg.videoId);
            const lib = libraryManager.getLibrary();
            const meta = Object.values(lib).find(s => flattenId(s.videoId) === vid);
            p.activeMoment = { type: data.type, message: data.message || cfg.defaultMessage, videoId: vid, time: Date.now() };
            p.nowPlaying = {
                id: 'm_'+Date.now(), title: cfg.title, videoId: vid, thumbnail: cfg.thumbnail, addedBy: 'Staff', isMoment: true,
                startPosition: (meta?.future && !isNaN(meta.future[0])) ? parseFloat(meta.future[0]) : 0,
                stopPosition: (meta?.future && !isNaN(meta.future[1])) ? parseFloat(meta.future[1]) : 0
            };
        }
        broadcastState(socket.pubId);
    });
    socket.on('moment:stop', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.activeMoment = null; p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
});

http.listen(process.env.PORT || 3001, () => {
    console.log(`SERVER KÖRS! http://${getLocalIp()}:3001/pub/7-an/staff`);
});