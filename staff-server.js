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

// --- UTILS ---
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

// HJÄLPFUNKTION FÖR ATT SÄKERSTÄLLA STRÄNG-ID OCH TA BORT OBJEKT-RESTER
function flattenId(id) {
    if (!id) return "";
    if (typeof id === 'object') {
        if (id.videoId) return String(id.videoId);
        if (id.id) return String(id.id);
        return "";
    }
    return String(id);
}

function hämtaGemensammaListor() {
    try {
        const lib = libraryManager.getLibrary();
        const valv = {};
        Object.values(lib).forEach(song => {
            if (song.playlists && Array.isArray(song.playlists)) {
                const songObj = {
                    title: `${song.artist} - ${song.title}`,
                    videoId: flattenId(song.videoId),
                    thumbnail: song.thumbnail
                };
                song.playlists.forEach(playlistName => {
                    if (!valv[playlistName]) valv[playlistName] = [];
                    if (!valv[playlistName].some(s => s.videoId === songObj.videoId && s.title === songObj.title)) {
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

// --- PERSISTENCE ---
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
            aktivtValv: '',
            aktivTillfalligLista: '',
            qrKrav: false,
            statistikKuponger: 0,
            statistikTotalt: 0,
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

                Object.keys(initialData).forEach(key => {
                    if (source[key] !== undefined) {
                        if (key === 'moments' && typeof source[key] === 'object') {
                            initialData.moments = { ...initialData.moments, ...source[key] };
                        } else {
                            initialData[key] = source[key];
                        }
                    }
                });
                if (diskData.consumedTickets) initialData.consumedTickets = diskData.consumedTickets;
            } catch (e) { console.error("Fel vid inläsning av pubfil:", e); }
        }

        pubar[pubId] = {
            ...initialData,
            queue: [],
            nowPlaying: null,
            interruptedSong: null,
            playlistCursor: 0,
            shuffledMain: [],
            shuffledTemp: [],
            activeMoment: null,
            isTransitioning: false,
            lastNextTrigger: 0
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
    const listSongs = getUpcomingListSongs(pub, 2);
    const displayQueue = [...requestedQueue, ...listSongs];
    return {
        pubNamn: pub.namn || pubId,
        qrKrav: !!pub.qrKrav,
        statistikKuponger: pub.statistikKuponger || 0,
        statistikTotalt: pub.statistikTotalt || 0,
        aktivHuvudlista: pub.aktivtValv || '',
        aktivTillfalligLista: pub.aktivTillfalligLista || '',
        nowPlaying: pub.nowPlaying,
        queue: displayQueue,
        fullQueue: displayQueue,
        valv: pub.valv || {},
        activeMoment: pub.activeMoment,
        momentsConfig: pub.moments
    };
}

function broadcastState(pubId, socket = null) {
    const payload = buildPayload(pubId);
    if (!payload) return;
    if (socket) { socket.emit('staff_state', payload); socket.emit('state', payload); }
    else { io.to(pubId).emit('staff_state', payload); io.to(pubId).emit('state', payload); }
}

function getUpcomingListSongs(pub, limit = 2) {
    if (!pub) return [];
    const items = [];
    const start = pub.playlistCursor || 0;
    for (let i = 0; i < limit; i += 1) {
        const bgSong = getBackgroundSongAt(pub, start + i);
        if (bgSong) {
            items.push({ id: `list_${pub.aktivtValv}_${start + i}`, title: bgSong.title, addedBy: bgSong.addedBy, isListSong: true });
        }
    }
    return items;
}

function validateTicket(kod) {
    if (!kod) return null;
    const delar = kod.split('-');
    if (delar.length !== 3) return null;
    const [id, antal, sig] = delar;
    const expectedSig = crypto.createHmac('sha256', MASTER_SECRET).update(`${id}-${antal}`).digest('hex').substring(0, 6).toUpperCase();
    if (sig !== expectedSig) return null;
    return { id, total: parseInt(antal) };
}

async function resolveVideoId(song) {
    if (!song) return 'dQw4w9WgXcQ';
    const text = typeof song === 'object' ? (song.title || 'dQw4w9WgXcQ') : String(song);
    const cacheKey = text.toLowerCase();
    try {
        const lib = libraryManager.getLibrary();
        const entry = Object.values(lib).find(s => (s.artist + " - " + s.title).toLowerCase() === cacheKey || s.title.toLowerCase() === cacheKey);
        if (entry && entry.videoId) return flattenId(entry.videoId);
    } catch (e) { }
    if (videoIdCache.has(cacheKey)) return videoIdCache.get(cacheKey);
    try {
        const result = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        const firstResult = result?.items?.[0];
        let id = flattenId(firstResult?.id || firstResult?.videoId || null);
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
    if (pub.activeMoment && (pub.activeMoment.type === 'pause' || pub.activeMoment.type === 'closing')) return;
    const nu = Date.now();

    // Snabbare trigger (1 sek skydd istället för 5)
    if (pub.nowPlaying && nu - pub.lastNextTrigger < 1000) return;
    pub.lastNextTrigger = nu;
    pub.isTransitioning = true;

    try {
        let nastaLat = null;
        if (pub.queue && pub.queue.length > 0) {
            nastaLat = pub.queue.shift();
        } else {
            const bgSong = getBackgroundSongAt(pub, pub.playlistCursor);
            if (bgSong) {
                nastaLat = {
                    ...bgSong,
                    id: 'valv_' + pub.playlistCursor + '_' + Date.now(),
                    isListSong: true
                };
                pub.playlistCursor++;
            }
        }

        if (nastaLat) {
            let videoId = flattenId(nastaLat.videoId);

            // Om ID saknas i biblioteket, sök och spara det permanent
            if (!videoId || videoId === "") {
                console.log(`[System] Saknar ID för "${nastaLat.title}", söker...`);
                videoId = await resolveVideoId(nastaLat.title);
                libraryManager.addOrUpdateSong({ videoId, title: nastaLat.title });
            }

            pub.nowPlaying = {
                id: nastaLat.id,
                title: nastaLat.title,
                videoId,
                thumbnail: nastaLat.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
                addedBy: nastaLat.addedBy || 'Gäst',
                isListSong: !!nastaLat.isListSong
            };
            broadcastState(pubId);
        } else {
            if (pub.nowPlaying) { pub.nowPlaying = null; broadcastState(pubId); }
        }
    } catch (e) {
        console.error("Fel i korNastaLatLogik:", e);
    } finally {
        pub.isTransitioning = false;
    }
}

// --- ROUTES ---
app.get('/', (req, res) => {
    const files = fs.readdirSync(path.join(__dirname, 'data')).filter(f => f.endsWith('.json'));
    const defaultPub = files.length > 0 ? files[0].replace('.json', '') : '7-an';
    res.redirect(`/pub/${defaultPub}/staff`);
});
app.get('/pub/:pubId/staff', (req, res) => { res.sendFile(path.join(__dirname, 'staff-app.html')); });
app.get('/pub/:pubId/staff-mobile', (req, res) => { res.sendFile(path.join(__dirname, 'staff-mobile.html')); });
app.get('/pub/:pubId/mobile', (req, res) => { res.sendFile(path.join(__dirname, 'test-mobile.html')); });
app.get('/pub/:pubId/player', (req, res) => { res.sendFile(path.join(__dirname, 'test-player.html')); });

io.on('connection', (socket) => {
    socket.on('join_pub', (pubId) => { if (!pubId) return; socket.join(pubId); socket.pubId = pubId; hämtaPubData(pubId); broadcastState(pubId, socket); });
    socket.on('search', async (data) => {
        try {
            const res = await youtubeSearchApi.GetListByKeyword(data.query, false, 8);
            const results = (res.items || []).map(i => ({ videoId: flattenId(i.id || i.videoId), title: i.title, thumbnail: i.thumbnail?.thumbnails?.[0]?.url || "" }));
            socket.emit('searchResults', { results });
        } catch (e) { }
    });
    socket.on('addSong', async (data) => {
        const activePubId = data.pubId || socket.pubId;
        if (!activePubId) return;
        const pub = hämtaPubData(activePubId);
        if (!pub) return;

        let resObj = { msg: "Låten tillagd!" };
        if (pub.qrKrav) {
            const biljett = validateTicket(data.kupongKod);
            if (!biljett) return socket.emit("kupong_error", { msg: "Ogiltig biljett." });

            const used = pub.consumedTickets[biljett.id] || 0;
            if (used >= biljett.total) return socket.emit("kupong_error", { msg: "Biljetten är slut." });

            pub.consumedTickets[biljett.id] = used + 1;
            pub.statistikKuponger++;
            resObj.resterande = biljett.total - pub.consumedTickets[biljett.id];
        }

        const videoId = flattenId(data.videoId) || await resolveVideoId(data.title);

        pub.queue.push({
            id: Math.random().toString(36).substr(2, 9),
            videoId: videoId,
            title: data.title,
            thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
            addedBy: 'Gäst'
        });
        pub.statistikTotalt++;
        sparaPubData(activePubId);

        socket.emit("kupong_success", resObj);

        if (!pub.nowPlaying && !pub.activeMoment) await korNastaLatLogik(activePubId);
        else broadcastState(activePubId);
    });
    socket.on('player:byt_valv', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        pub.aktivtValv = data.valvNamn;
        pub.playlistCursor = 0;
        refreshShuffled(pub, 'main');
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });
    socket.on('ADD_TEMP_PLAYLIST', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        pub.aktivTillfalligLista = data.playlist;
        refreshShuffled(pub, 'temp');
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });
    socket.on('REMOVE_TEMP_PLAYLIST', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        pub.aktivTillfalligLista = '';
        pub.shuffledTemp = [];
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });
    socket.on('admin:add_to_valv', async (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);

        let songData = { title: data.lat };
        if (data.videoId) {
            songData = { videoId: flattenId(data.videoId), title: data.title, thumbnail: data.thumbnail };
        } else {
            songData.videoId = await resolveVideoId(data.lat);
        }

        libraryManager.addOrUpdateSong(songData, data.valvNamn);

        if (data.valvNamn === pub.aktivtValv) refreshShuffled(pub, 'main');
        if (data.valvNamn === pub.aktivTillfalligLista) refreshShuffled(pub, 'temp');
        broadcastState(socket.pubId);
    });
    socket.on('admin:remove_from_valv', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        libraryManager.removeSongFromPlaylist(data.latNamn, data.valvNamn);
        if (data.valvNamn === pub.aktivtValv) refreshShuffled(pub, 'main');
        if (data.valvNamn === pub.aktivTillfalligLista) refreshShuffled(pub, 'temp');
        broadcastState(socket.pubId);
    });
    socket.on('admin:toggle_qr', (data) => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.qrKrav = !!data.qrKrav; sparaPubData(socket.pubId); broadcastState(socket.pubId); } });
    socket.on('player:skip', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.nowPlaying = null; p.interruptedSong = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:ready_for_next', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); if (p.activeMoment && !['pause','closing'].includes(p.activeMoment.type)) p.activeMoment = null; p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
    socket.on('player:remove_song', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        pub.queue = pub.queue.filter(s => s.id !== data.id);
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });
    socket.on('moment:activate', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (p.nowPlaying && !p.nowPlaying.isMoment) p.interruptedSong = p.nowPlaying;
        if (data.type === 'pause') { p.activeMoment = { type: 'pause', message: data.message || "Paus", time: Date.now() }; p.nowPlaying = null; }
        else {
            const cfg = p.moments[data.type];
            if (!cfg) return;
            const vid = flattenId(cfg.videoId);
            p.activeMoment = { type: data.type, message: data.message || cfg.defaultMessage, videoId: vid, time: Date.now() };
            p.nowPlaying = { id: 'm_'+Date.now(), title: cfg.title, videoId: vid, thumbnail: cfg.thumbnail, addedBy: 'Staff', isMoment: true };
            p.lastNextTrigger = 0;
        }
        broadcastState(socket.pubId);
    });
    socket.on('moment:stop', () => { if (socket.pubId) { const p = hämtaPubData(socket.pubId); p.activeMoment = null; p.nowPlaying = null; korNastaLatLogik(socket.pubId); } });
    socket.on('moment:save_settings', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (!p.moments[data.type]) p.moments[data.type] = { category: data.category };
        Object.assign(p.moments[data.type], {
            videoId: flattenId(data.videoId),
            title: data.title,
            songTitle: data.songTitle,
            thumbnail: data.thumbnail,
            defaultMessage: data.defaultMessage
        });
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });
});

http.listen(process.env.PORT || 3001, () => {
    const ip = getLocalIp();
    console.log(`\n=================================================`);
    console.log(`SERVER KÖRS!`);
    console.log(`-------------------------------------------------`);
    console.log(`Staff App (PC/Padda): http://${ip}:3001/pub/7-an/staff`);
    console.log(`Staff Mobile (Mobil): http://${ip}:3001/pub/7-an/staff-mobile`);
    console.log(`Utskrift biljetter:   http://${ip}:3001/skriv-ut-kuponger.html`);
    console.log(`-------------------------------------------------`);
    console.log(`Gäst-sida: http://${ip}:3001/pub/7-an/mobile`);
    console.log(`=================================================\n`);
});