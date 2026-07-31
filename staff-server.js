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

    if (hasMain && hasTemp) {
        if (step % 2 === 0) {
            return {
                title: pub.shuffledMain[Math.floor(step / 2) % pub.shuffledMain.length],
                addedBy: 'Bakgrundsvalv (Huvud)',
                playlist: pub.aktivtValv
            };
        } else {
            return {
                title: pub.shuffledTemp[Math.floor(step / 2) % pub.shuffledTemp.length],
                addedBy: 'Bakgrundsvalv (Extra)',
                playlist: pub.aktivTillfalligLista
            };
        }
    } else if (hasMain) {
        return {
            title: pub.shuffledMain[step % pub.shuffledMain.length],
            addedBy: 'Bakgrundsvalv',
            playlist: pub.aktivtValv
        };
    } else if (hasTemp) {
        return {
            title: pub.shuffledTemp[step % pub.shuffledTemp.length],
            addedBy: 'Bakgrundsvalv',
            playlist: pub.aktivTillfalligLista
        };
    }
    return null;
}

// --- PERSISTENCE ---
function sparaPubData(pubId) {
    const pub = pubar[pubId];
    if (!pub) return;
    const filePath = path.join(__dirname, 'data', `${pubId}.json`);

    // Vi sparar en platt struktur direkt
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

        // Standardvärden i platt struktur
        let initialData = {
            namn: `${pubId.toUpperCase()} Jukebox`,
            aktivtValv: '',
            aktivTillfalligLista: '',
            qrKrav: false,
            statistikKuponger: 0,
            statistikTotalt: 0,
            moments: {
                "birthday": { videoId: "hS7GAnO146U", title: "Ja må han leva (Standard)", thumbnail: "https://img.youtube.com/vi/hS7GAnO146U/0.jpg", defaultMessage: "GRATTIS PÅ FÖDELSEDAGEN! 🎂" },
                "closing": { videoId: "xGytDsqkQY8", title: "Closing Time - Semisonic", thumbnail: "https://img.youtube.com/vi/xGytDsqkQY8/0.jpg", defaultMessage: "Tack för ikväll, vi stänger nu! 🌙" },
                "lastcall": { videoId: "Ryt_mY8u9p8", title: "Ship Bell Signal", thumbnail: "https://img.youtube.com/vi/Ryt_mY8u9p8/0.jpg", defaultMessage: "Sista beställningen i baren! 🔔" },
                "shoutout": { videoId: "dQw4w9WgXcQ", title: "Fanfar", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg", defaultMessage: "Uppmärksamhet i huset! 📢" },
                "tack": { videoId: "h-mXUnmE_Z4", title: "Tack-musik", thumbnail: "https://img.youtube.com/vi/h-mXUnmE_Z4/0.jpg", defaultMessage: "Slut för idag, tack för ikväll!" }
            },
            consumedTickets: {}
        };

        if (fs.existsSync(filePath)) {
            try {
                const diskData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                // Hantera både gammalt format med config och det nya platta formatet
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

// --- TICKET VALIDATION ---
function validateTicket(kod) {
    if (!kod) return null;
    const delar = kod.split('-');
    if (delar.length !== 3) return null;
    const [id, antal, sig] = delar;

    const expectedSig = crypto.createHmac('sha256', MASTER_SECRET)
                              .update(`${id}-${antal}`)
                              .digest('hex')
                              .substring(0, 6).toUpperCase();

    if (sig !== expectedSig) return null;
    return { id, total: parseInt(antal) };
}

function getUpcomingListSongs(pub, limit = 2) {
    if (!pub) return [];
    const items = [];
    const start = pub.playlistCursor || 0;
    for (let i = 0; i < limit; i += 1) {
        const bgSong = getBackgroundSongAt(pub, start + i);
        if (bgSong) {
            items.push({
                id: `list_${pub.aktivtValv}_${start + i}`,
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

    // Återuppta avbruten låt om momentet är över
    if (!pub.activeMoment && pub.interruptedSong) {
        pub.nowPlaying = { ...pub.interruptedSong, id: 'resumed_' + Date.now() };
        pub.interruptedSong = null;
        broadcastState(pubId);
        return;
    }

    if (pub.activeMoment && (pub.activeMoment.type === 'pause' || pub.activeMoment.type === 'closing')) {
        return;
    }

    const nu = Date.now();
    // Tidsspärr ignoreras om vi inte har någon låt alls som spelas
    if (pub.nowPlaying && nu - pub.lastNextTrigger < 5000) return;
    pub.lastNextTrigger = nu;

    pub.isTransitioning = true;

    try {
        const lib = libraryManager.getLibrary();
        if (pub.queue && pub.queue.length > 0) {
            const nastaLat = pub.queue.shift();
            const videoId = nastaLat.videoId || await resolveVideoId(nastaLat.title);
            const entry = Object.values(lib).find(s => s.videoId === videoId);

            pub.nowPlaying = {
                id: nastaLat.id,
                title: nastaLat.title,
                videoId,
                thumbnail: nastaLat.thumbnail || entry?.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
                addedBy: nastaLat.addedBy || 'Gäst',
                isListSong: false
            };
            broadcastState(pubId);
        } else {
            const bgSong = getBackgroundSongAt(pub, pub.playlistCursor);
            if (bgSong) {
                const videoId = await resolveVideoId(bgSong.title);
                const entry = Object.values(lib).find(s => s.videoId === videoId);

                pub.nowPlaying = {
                    id: 'valv_' + pub.playlistCursor + '_' + Date.now(),
                    title: bgSong.title,
                    videoId,
                    thumbnail: entry?.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
                    addedBy: bgSong.addedBy,
                    isListSong: true
                };
                pub.playlistCursor++;
                broadcastState(pubId);
            } else {
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

        let resterande = undefined;
        if (pub.qrKrav) {
            const biljett = validateTicket(data.kupongKod);
            if (!biljett) return socket.emit("kupong_error", { msg: "Ogiltig biljett." });
            const usedCount = pub.consumedTickets[biljett.id] || 0;
            if (usedCount >= biljett.total) return socket.emit("kupong_error", { msg: "Biljetten är redan förbrukad." });
            pub.consumedTickets[biljett.id] = usedCount + 1;
            resterande = biljett.total - (usedCount + 1);
            pub.statistikKuponger++;
            sparaPubData(socket.pubId);
        }

        pub.queue.push({
            id: Math.random().toString(36).substr(2, 9),
            videoId: data.videoId || null,
            title: data.title,
            thumbnail: data.thumbnail || null,
            addedBy: 'Gäst'
        });
        pub.statistikTotalt++;
        socket.emit("kupong_success", { msg: "Låten tillagd!", resterande: resterande });
        if (!pub.nowPlaying && !pub.activeMoment) await korNastaLatLogik(socket.pubId);
        else broadcastState(socket.pubId);
    });

    socket.on('player:byt_valv', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.aktivtValv = data.valvNamn;
        pub.playlistCursor = 0;
        refreshShuffled(pub, 'main');
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
        if (!pub.nowPlaying && !pub.activeMoment) korNastaLatLogik(socket.pubId);
    });

    socket.on('admin:toggle_qr', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.qrKrav = !!data.qrKrav;
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('ADD_TEMP_PLAYLIST', (data) => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.aktivTillfalligLista = data.playlist;
        pub.playlistCursor = 0;
        refreshShuffled(pub, 'temp');
        broadcastState(socket.pubId);
        if (!pub.nowPlaying && !pub.activeMoment) korNastaLatLogik(socket.pubId);
    });

    socket.on('REMOVE_TEMP_PLAYLIST', () => {
        if (!socket.pubId) return;
        const pubarData = hämtaPubData(socket.pubId);
        if (!pubarData) return;
        pubarData.aktivTillfalligLista = '';
        pubarData.shuffledTemp = [];
        broadcastState(socket.pubId);
    });

    socket.on('player:skip', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;
        pub.nowPlaying = null;
        pub.interruptedSong = null;
        korNastaLatLogik(socket.pubId);
    });

    socket.on('player:ready_for_next', () => {
        if (!socket.pubId) return;
        const pub = hämtaPubData(socket.pubId);
        if (!pub) return;

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

        if (pub.nowPlaying && !pub.nowPlaying.isMoment) {
            pub.interruptedSong = pub.nowPlaying;
        }

        if (data.type === 'pause') {
            pub.activeMoment = { type: 'pause', message: data.message || "Paus" };
            pub.nowPlaying = null;
        } else {
            const cfg = pub.moments[data.type];
            if (!cfg) return;
            pub.activeMoment = { type: data.type, message: data.message || cfg.defaultMessage, videoId: cfg.videoId };
            pub.nowPlaying = {
                id: 'm_' + Date.now(),
                title: cfg.title,
                videoId: cfg.videoId,
                thumbnail: cfg.thumbnail || `https://img.youtube.com/vi/${cfg.videoId}/0.jpg`,
                addedBy: 'Staff',
                isMoment: true
            };
            pub.lastNextTrigger = 0; // Tvinga genom byte
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
        if (pub && pub.moments[data.type]) {
            pub.moments[data.type].videoId = data.videoId || pub.moments[data.type].videoId;
            pub.moments[data.type].title = data.title || pub.moments[data.type].title;
            pub.moments[data.type].thumbnail = data.thumbnail || pub.moments[data.type].thumbnail;
            pub.moments[data.type].defaultMessage = data.defaultMessage || pub.moments[data.type].defaultMessage;
            sparaPubData(socket.pubId); // VIKTIGT: Spara till disk!
            broadcastState(socket.pubId);
        }
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`Server körs på port ${PORT}. http://${getLocalIp()}:${PORT}/pub/test/staff`);
});