const express = require('express');
const app = express();
const http = require('http').createServer(app);
app.use(express.static(__dirname));
const io = require('socket.io')(http, { cors: { origin: "*" } });
const fs = require('fs');
const path = require('path');
const os = require('os');
const youtubeSearchApi = require('youtube-search-api');
const libraryManager = require('./library-manager');

const pubar = {};
const videoIdCache = new Map();

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

function hämtaGemensammaListor() {
    try {
        const lib = libraryManager.getLibrary();
        const valv = {};
        Object.values(lib).forEach(song => {
            if (song.playlists && Array.isArray(song.playlists)) {
                const songString = `${song.artist} - ${song.title}`;
                song.playlists.forEach(playlistName => {
                    if (!valv[playlistName]) valv[playlistName] = [];
                    if (!valv[playlistName].includes(songString)) {
                        valv[playlistName].push(songString);
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
    if (!pub || !pub.config) return;
    const valv = hämtaGemensammaListor();
    if (type === 'main') {
        const listName = pub.config.aktivtValv;
        pub.shuffledMain = (listName && valv[listName]) ? shuffleArray(valv[listName]) : [];
    } else if (type === 'temp') {
        const listName = pub.config.aktivTillfalligLista;
        pub.shuffledTemp = (listName && valv[listName]) ? shuffleArray(valv[listName]) : [];
    }
}

function getBackgroundSongAt(pub, step) {
    if (!pub) return null;
    const hasMain = Array.isArray(pub.shuffledMain) && pub.shuffledMain.length > 0;
    const hasTemp = Array.isArray(pub.shuffledTemp) && pub.shuffledTemp.length > 0;

    if (hasMain && hasTemp) {
        if (step % 2 === 0) {
            return {
                title: pub.shuffledMain[Math.floor(step / 2) % pub.shuffledMain.length],
                addedBy: 'Bakgrundsvalv (Huvud)',
                playlist: pub.config.aktivtValv
            };
        } else {
            return {
                title: pub.shuffledTemp[Math.floor(step / 2) % pub.shuffledTemp.length],
                addedBy: 'Bakgrundsvalv (Extra)',
                playlist: pub.config.aktivTillfalligLista
            };
        }
    } else if (hasMain) {
        return {
            title: pub.shuffledMain[step % pub.shuffledMain.length],
            addedBy: 'Bakgrundsvalv',
            playlist: pub.config.aktivtValv
        };
    } else if (hasTemp) {
        return {
            title: pub.shuffledTemp[step % pub.shuffledTemp.length],
            addedBy: 'Bakgrundsvalv',
            playlist: pub.config.aktivTillfalligLista
        };
    }
    return null;
}

// --- CORE LOGIC ---
function hämtaPubData(pubId) {
    if (!pubId) return null;
    if (!pubar[pubId]) {
        pubar[pubId] = {
            queue: [],
            nowPlaying: null,
            playlistCursor: 0,
            shuffledMain: [],
            shuffledTemp: [],
            activeMoment: null,
            isTransitioning: false,
            lastNextTrigger: 0,
            config: {
                namn: `${pubId.toUpperCase()} Jukebox`,
                aktivtValv: '',
                aktivTillfalligLista: '',
                qrKrav: false,
                statistikKuponger: 0,
                statistikTotalt: 0,
                moments: {
                    "birthday": { videoId: "hS7GAnO146U", title: "Ja må han leva (Standard)", defaultMessage: "GRATTIS PÅ FÖDELSEDAGEN! 🎂" },
                    "closing": { videoId: "xGytDsqkQY8", title: "Closing Time - Semisonic", defaultMessage: "Tack för ikväll, vi stänger nu! 🌙" },
                    "lastcall": { videoId: "Ryt_mY8u9p8", title: "Ship Bell Signal", defaultMessage: "Sista beställningen i baren! 🔔" },
                    "shoutout": { videoId: "dQw4w9WgXcQ", title: "Fanfar", defaultMessage: "Uppmärksamhet i huset! 📢" },
                    "tack": { videoId: "h-mXUnmE_Z4", title: "Tack-musik", defaultMessage: "Slut för idag, tack för ikväll!" }
                }
            }
        };
    }

    const pub = pubar[pubId];
    pub.config.valv = hämtaGemensammaListor();

    if (pub.shuffledMain.length === 0 && pub.config.aktivtValv) refreshShuffled(pub, 'main');
    if (pub.shuffledTemp.length === 0 && pub.config.aktivTillfalligLista) refreshShuffled(pub, 'temp');

    return pub;
}

function getUpcomingListSongs(pub, limit = 2) {
    if (!pub) return [];
    const items = [];
    const start = pub.playlistCursor || 0;
    for (let i = 0; i < limit; i += 1) {
        const bgSong = getBackgroundSongAt(pub, start + i);
        if (bgSong) {
            items.push({
                id: `list_${pub.config.aktivtValv}_${start + i}`,
                title: bgSong.title,
                addedBy: bgSong.addedBy,
                isListSong: true
            });
        }
    }
    return items;
}

function buildPayload(pubId) {
    const pub = hämtaPubData(pubId);
    if (!pub) return null;

    const requestedQueue = Array.isArray(pub.queue) ? pub.queue : [];
    const listSongs = getUpcomingListSongs(pub, 2);
    const displayQueue = [...requestedQueue, ...listSongs];

    return {
        pubNamn: pub.config.namn || pubId,
        qrKrav: !!pub.config.qrKrav,
        statistikKuponger: pub.config.statistikKuponger || 0,
        statistikTotalt: pub.config.statistikTotalt || 0,
        aktivHuvudlista: pub.config.aktivtValv || '',
        aktivTillfalligLista: pub.config.aktivTillfalligLista || '',
        nowPlaying: pub.nowPlaying,
        queue: displayQueue,
        fullQueue: displayQueue,
        valv: pub.config.valv || {},
        activeMoment: pub.activeMoment,
        momentsConfig: pub.config.moments
    };
}

function broadcastState(pubId, socket = null) {
    const payload = buildPayload(pubId);
    if (!payload) return;
    if (socket) {
        socket.emit('staff_state', payload);
        socket.emit('state', payload);
    } else {
        io.to(pubId).emit('staff_state', payload);
        io.to(pubId).emit('state', payload);
    }
}

async function resolveVideoId(song) {
    if (!song) return 'dQw4w9WgXcQ';
    const text = typeof song === 'object' ? (song.title || 'dQw4w9WgXcQ') : String(song);
    const cacheKey = text.toLowerCase();

    try {
        const lib = libraryManager.getLibrary();
        const entry = Object.values(lib).find(s => {
            const full = (s.artist + " - " + s.title).toLowerCase();
            return (full === cacheKey) || (s.title.toLowerCase() === cacheKey);
        });
        if (entry && entry.videoId) return entry.videoId;
    } catch (e) { }

    if (videoIdCache.has(cacheKey)) return videoIdCache.get(cacheKey);

    try {
        const result = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        const firstResult = result?.items?.[0];
        let id = firstResult?.id || firstResult?.videoId || null;
        if (typeof id === 'object' && id !== null) id = id.videoId || id.id;
        if (id && typeof id === 'string') {
            videoIdCache.set(cacheKey, id);
            return id;
        }
    } catch (err) { }
    return 'dQw4w9WgXcQ';
}

async function korNastaLatLogik(pubId) {
    const pub = hämtaPubData(pubId);
    if (!pub || pub.isTransitioning) return;

    // Om ett permanent moment är aktivt (Paus/Stängning), byt inte låt!
    if (pub.activeMoment && (pub.activeMoment.type === 'pause' || pub.activeMoment.type === 'closing')) {
        return;
    }

    const nu = Date.now();
    if (nu - pub.lastNextTrigger < 5000) return; // Stenhård 5s-spärr
    pub.lastNextTrigger = nu;

    pub.isTransitioning = true;

    try {
        if (pub.queue && pub.queue.length > 0) {
            const nastaLat = pub.queue.shift();
            console.log(`[Server] Spelar från kö för ${pubId}: ${nastaLat.title}`);
            const videoId = nastaLat.videoId || await resolveVideoId(nastaLat.title);
            pub.nowPlaying = {
                id: nastaLat.id,
                title: nastaLat.title,
                videoId,
                addedBy: nastaLat.addedBy || 'Gäst',
                isListSong: false
            };
            broadcastState(pubId);
        } else {
            const bgSong = getBackgroundSongAt(pub, pub.playlistCursor);
            if (bgSong) {
                console.log(`[Server] Spelar bakgrund för ${pubId}: ${bgSong.title} (Index: ${pub.playlistCursor})`);
                const videoId = await resolveVideoId(bgSong.title);
                pub.nowPlaying = {
                    id: 'valv_' + pub.playlistCursor + '_' + Date.now(),
                    title: bgSong.title,
                    videoId,
                    addedBy: bgSong.addedBy,
                    isListSong: true
                };
                pub.playlistCursor++;
                broadcastState(pubId);
            } else {
                console.log(`[Server] Inga låtar kvar att spela för ${pubId}.`);
                if (pub.nowPlaying) {
                    pub.nowPlaying = null;
                    broadcastState(pubId);
                }
            }
        }
    } catch (e) {
        console.error("Fel i korNastaLatLogik:", e);
    } finally {
        pub.isTransitioning = false;
    }
}



app.get('/pub/:pubId/staff', (req, res) => { res.sendFile(path.join(__dirname, 'staff-app.html')); });
app.get('/pub/:pubId/mobile', (req, res) => { res.sendFile(path.join(__dirname, 'test-mobile.html')); });

io.on('connection', (socket) => {
    socket.on('join_pub', (pubId) => {
        if (!pubId) return;
        socket.join(pubId);
        socket.pubId = pubId;
        hämtaPubData(pubId);
        broadcastState(pubId, socket);
    });

    socket.on('search', async (data) => {
        try {
            const res = await youtubeSearchApi.GetListByKeyword(data.query, false, 8);
            const results = (res.items || []).map(i => ({
                videoId: (typeof i.id === 'object' ? i.id.videoId : i.id),
                title: i.title,
                thumbnail: i.thumbnail?.thumbnails?.[0]?.url || ""
            }));
            socket.emit('searchResults', { results });
        } catch (e) { console.error(e); }
    });

    socket.on('addSong', async (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.queue.push({
            id: Math.random().toString(36).substr(2, 9),
            videoId: data.videoId || null,
            title: data.title,
            addedBy: 'Gäst'
        });
        if (!pub.nowPlaying && !pub.activeMoment) await korNastaLatLogik(socket.pubId);
        else broadcastState(socket.pubId);
    });

    socket.on('player:byt_valv', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.config.aktivtValv = data.valvNamn;
        pub.playlistCursor = 0;
        refreshShuffled(pub, 'main');
        broadcastState(socket.pubId);
        if (!pub.nowPlaying && !pub.activeMoment) korNastaLatLogik(socket.pubId);
    });

    socket.on('ADD_TEMP_PLAYLIST', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.config.aktivTillfalligLista = data.playlist;
        pub.playlistCursor = 0;
        refreshShuffled(pub, 'temp');
        broadcastState(socket.pubId);
        if (!pub.nowPlaying && !pub.activeMoment) korNastaLatLogik(socket.pubId);
    });

    socket.on('REMOVE_TEMP_PLAYLIST', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.config.aktivTillfalligLista = '';
        pub.shuffledTemp = [];
        broadcastState(socket.pubId);
    });

    socket.on('player:skip', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.nowPlaying = null;
        korNastaLatLogik(socket.pubId);
    });

    socket.on('player:ready_for_next', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        const nu = Date.now();
        if (nu - pub.lastNextTrigger < 5000) return;

        // Om ett engångs-moment (fanfar/grattis) precis slutade, rensa det
        if (pub.activeMoment && !['pause', 'closing'].includes(pub.activeMoment.type)) {
            pub.activeMoment = null;
        }

        pub.nowPlaying = null;
        korNastaLatLogik(socket.pubId);
    });

    socket.on('admin:add_to_valv', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        libraryManager.addOrUpdateSong({ title: data.lat }, data.valvNamn);
        refreshShuffled(pub, 'main');
        broadcastState(socket.pubId);
    });

    socket.on('moment:activate', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;

        console.log("[Moment] Aktiverar:", data.type);

        if (data.type === 'pause') {
            pub.activeMoment = { type: 'pause', message: data.message || "Paus" };
            pub.nowPlaying = null; // Stoppa all musik
        } else {
            const cfg = pub.config.moments[data.type];
            if (!cfg) return;
            pub.activeMoment = { type: data.type, message: data.message || cfg.defaultMessage, videoId: cfg.videoId };
            pub.nowPlaying = {
                id: 'm_' + Date.now(),
                title: cfg.title,
                videoId: cfg.videoId,
                addedBy: 'Staff',
                isMoment: true
            };
            pub.lastNextTrigger = Date.now();
        }
        broadcastState(socket.pubId);
    });

    socket.on('moment:stop', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.activeMoment = null;
        pub.nowPlaying = null;
        korNastaLatLogik(socket.pubId);
    });

    socket.on('moment:save_settings', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (pub && pub.config.moments[data.type]) {
            pub.config.moments[data.type].videoId = data.videoId || pub.config.moments[data.type].videoId;
            pub.config.moments[data.type].title = data.title || pub.config.moments[data.type].title;
            pub.config.moments[data.type].defaultMessage = data.defaultMessage || pub.config.moments[data.type].defaultMessage;
            broadcastState(socket.pubId);
        }
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`Server körs på port ${PORT}. http://${getLocalIp()}:${PORT}/pub/test/staff`);
});