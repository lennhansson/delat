const express = require('express');
const app = express();
const http = require('http').createServer(app);
app.use(express.static(__dirname));
const io = require('socket.io')(http, { cors: { origin: "*" } });
const fs = require('fs');
const path = require('path');
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

function shuffleArray(array) {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

function refreshShuffled(pub, type) {
    const valv = pub.valv || hämtaGemensammaListor();
    if (type === 'main') {
        pub.shuffledMain = pub.aktivtValv ? shuffleArray(valv[pub.aktivtValv] || []) : [];
    } else {
        pub.shuffledTemp = pub.aktivTillfalligLista ? shuffleArray(valv[pub.aktivTillfalligLista] || []) : [];
    }
}

function getBackgroundSongAt(pub, step) {
    const mainList = pub.shuffledMain || [];
    const tempList = pub.shuffledTemp || [];
    if (mainList.length > 0 && tempList.length > 0) {
        if (step % 2 === 0) return { ...mainList[Math.floor(step / 2) % mainList.length], addedBy: 'Bakgrund' };
        return { ...tempList[Math.floor(step / 2) % tempList.length], addedBy: 'Extra' };
    }
    if (mainList.length > 0) return { ...mainList[step % mainList.length], addedBy: 'Bakgrund' };
    if (tempList.length > 0) return { ...tempList[step % tempList.length], addedBy: 'Extra' };
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
                "lastcall": { videoId: "Ryt_mY8u9p8", title: "Last Call", songTitle: "Last Call", thumbnail: "https://img.youtube.com/vi/Ryt_mY8u9p8/0.jpg", defaultMessage: "Sista beställningen i baren! 🔔", category: "drift" },
                "birthday": { videoId: "hS7GAnO146U", title: "Födelsedag", songTitle: "Happy Birthday", thumbnail: "https://img.youtube.com/vi/hS7GAnO146U/0.jpg", defaultMessage: "GRATTIS PÅ FÖDELSEDAGEN! 🎂", category: "firande" },
                "shoutout": { videoId: "dQw4w9WgXcQ", title: "Hälsning", songTitle: "Attention", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg", defaultMessage: "Uppmärksamhet i houseet! 📢", category: "firande" },
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
        pubar[pubId] = { ...d, queue: [], nowPlaying: null, interruptedSong: null, playlistCursor: 0, shuffledMain: [], shuffledTemp: [], activeMoment: null, isTransitioning: false };
    }
    const p = pubar[pubId];

    // Kombinera heliga master-listor med barens egna unika editerbara listor
    const gemensamma = hämtaGemensammaListor();
    const egna = {};
    const egnaPath = path.join(__dirname, 'data', `${pubId}_låtar.json`);
    if (fs.existsSync(egnaPath)) {
        try {
            const diskEgna = JSON.parse(fs.readFileSync(egnaPath, 'utf8'));
            Object.assign(egna, diskEgna);
        } catch (e) { console.error("Fel vid inläsning av egna låtar:", e); }
    }
    p.valv = { ...gemensamma, ...egna };

    if (p.shuffledMain.length === 0 && p.aktivtValv) refreshShuffled(p, 'main');
    if (p.shuffledTemp.length === 0 && p.aktivTillfalligLista) refreshShuffled(p, 'temp');
    return p;
}

function getLinearQueue(pub) {
    let list = [...pub.queue];
    let bgStep = pub.playlistCursor;

    while (list.length < 15) {
        const bg = getBackgroundSongAt(pub, bgStep);
        if (bg) {
            list.push({ ...bg, id: 'bg_' + bgStep, isListSong: true });
            bgStep++;
        } else break;
    }
    return list;
}

function buildPayload(pubId) {
    const p = hämtaPubData(pubId);
    if (!p) return null;
    const q = getLinearQueue(p);
    let acc = 0;
    const mappedQ = q.map(s => {
        const wait = Math.floor(acc / 60);
        acc += (s.duration || 180);
        return { ...s, waitMinutes: wait };
    });
    const gemensamma = hämtaGemensammaListor();
    return {
        pubNamn: p.namn, qrKrav: !!p.qrKrav, statistikKuponger: p.statistikKuponger, statistikTotalt: p.statistikTotalt,
        aktivHuvudlista: p.aktivtValv, aktivTillfalligLista: p.aktivTillfalligLista,
        nowPlaying: p.nowPlaying, queue: mappedQ, fullQueue: mappedQ, valv: p.valv, activeMoment: p.activeMoment, momentsConfig: p.moments,
        masterPlaylists: Object.keys(gemensamma)
    };
}

function broadcastState(pubId) {
    if (!pubId) return;
    const payload = buildPayload(pubId);
    if (payload) io.to(pubId).emit('state', payload);
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
    try {
        const res = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        return flattenId(res?.items?.[0]?.id || null);
    } catch (e) { return null; }
}

async function korNastaLatLogik(pubId) {
    const p = hämtaPubData(pubId);
    if (!p || p.isTransitioning || p.activeMoment) {
        if (p) broadcastState(pubId);
        return;
    }
    p.isTransitioning = true;
    try {
        const q = getLinearQueue(p);
        let n = q.length > 0 ? q[0] : null;

        if (n) {
            const realIdx = p.queue.findIndex(s => s.id === n.id);
            if (realIdx !== -1) {
                p.queue.splice(realIdx, 1);
            } else {
                p.playlistCursor++;
            }

            const vid = flattenId(n.videoId) || await resolveVideoId(n.title);
            if (!vid) {
                p.isTransitioning = false;
                return korNastaLatLogik(pubId);
            }

            const lib = libraryManager.getLibrary();
            const meta = Object.values(lib).find(s => flattenId(s.videoId) === vid);

            p.nowPlaying = {
                id: n.id, title: n.title, videoId: vid,
                thumbnail: n.thumbnail || `https://img.youtube.com/vi/${vid}/0.jpg`,
                addedBy: n.addedBy || 'Gäst',
                startPosition: (meta?.future && !isNaN(meta.future[0])) ? parseFloat(meta.future[0]) : 0,
                stopPosition: (meta?.future && !isNaN(meta.future[1])) ? parseFloat(meta.future[1]) : 0
            };
        } else {
            p.nowPlaying = null;
        }
        broadcastState(pubId);
    } finally {
        p.isTransitioning = false;
    }
}

app.get(['/pub/:pubId', '/pub/:pubId/mobile'], (req, res) => res.sendFile(path.join(__dirname, 'test-mobile.html')));
app.get('/pub/:pubId/staff', (req, res) => res.sendFile(path.join(__dirname, 'staff-app.html')));
app.get('/pub/:pubId/player', (req, res) => res.sendFile(path.join(__dirname, 'test-player.html')));

// ROUTE FÖR DEN ISOLERADE SPELLISTE-EDITORN
app.get('/pub/:pubId/edit-library', (req, res) => res.sendFile(path.join(__dirname, 'edit-library.html')));

io.on('connection', (socket) => {
    socket.on('join_pub', (id) => {
        if (!id) return;
        socket.join(id);
        socket.pubId = id;
        hämtaPubData(id);
        broadcastState(id);
    });

    socket.on('addSong', async (d) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (p.qrKrav) {
            const t = validateTicket(d.kupongKod);
            if (!t) return socket.emit("kupong_error", { msg: "Ogiltig kod!" });
            if ((p.consumedTickets[t.id] || 0) >= t.total) return socket.emit("kupong_error", { msg: "Förbrukad!" });
            p.consumedTickets[t.id] = (p.consumedTickets[t.id] || 0) + 1;
            p.statistikKuponger++;
        }

        const newSong = { id: 'u_' + Date.now(), videoId: d.videoId, title: d.title, thumbnail: d.thumbnail, addedBy: 'Gäst', socketId: socket.id, uId: d.uId, duration: d.durationSeconds || 180 };

        if (p.queue.length > 0 && p.queue[p.queue.length - 1].uId === d.uId) {
            const bg = getBackgroundSongAt(p, p.playlistCursor);
            if (bg) {
                p.queue.push({ ...bg, id: 'bg_inject_' + p.playlistCursor, isListSong: true });
                p.playlistCursor++;
            }
        }

        p.queue.push(newSong);
        p.statistikTotalt++;
        sparaPubData(socket.pubId);
        socket.emit("kupong_success");
        broadcastState(socket.pubId);
        if (!p.nowPlaying && !p.activeMoment) await korNastaLatLogik(socket.pubId);
    });

    socket.on('player:ready_for_next', async (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (p.nowPlaying && data?.currentVideoId && p.nowPlaying.id !== data.currentVideoId && p.nowPlaying.videoId !== data.currentVideoId) {
            return;
        }
        await korNastaLatLogik(socket.pubId);
    });

    socket.on('player:skip', async () => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.nowPlaying = null;
        await korNastaLatLogik(socket.pubId);
    });

    socket.on('player:remove_song', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (data.id.startsWith('u_') || data.id.startsWith('bg_inject')) {
            p.queue = p.queue.filter(s => s.id !== data.id);
        } else if (data.id.startsWith('bg_')) {
            p.playlistCursor++;
        }
        broadcastState(socket.pubId);
    });

    socket.on('player:byt_valv', (data) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.aktivtValv = data.valvNamn;
        p.playlistCursor = 0;
        refreshShuffled(p, 'main');
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('admin:toggle_qr', (d) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.qrKrav = !!d.qrKrav;
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('ADD_TEMP_PLAYLIST', (d) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        if (!d || !d.playlist) return;
        p.aktivTillfalligLista = d.playlist;
        refreshShuffled(p, 'temp');
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('REMOVE_TEMP_PLAYLIST', () => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.aktivTillfalligLista = '';
        p.shuffledTemp = [];
        sparaPubData(socket.pubId);
        broadcastState(socket.pubId);
    });

    socket.on('moment:activate', (d) => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        const cfg = p.moments[d.type];
        if (!cfg) return;
        if (p.nowPlaying && !p.interruptedSong) p.interruptedSong = p.nowPlaying;
        p.activeMoment = { type: d.type, title: cfg.title, videoId: cfg.videoId, message: d.message || cfg.defaultMessage, thumbnail: cfg.thumbnail };
        p.nowPlaying = p.activeMoment.videoId ? { id: 'moment_' + Date.now(), title: cfg.title, videoId: cfg.videoId, thumbnail: cfg.thumbnail, addedBy: 'System' } : null;
        broadcastState(socket.pubId);
    });

    socket.on('moment:stop', () => {
        if (!socket.pubId) return;
        const p = hämtaPubData(socket.pubId);
        p.activeMoment = null;
        p.nowPlaying = p.interruptedSong || null;
        p.interruptedSong = null;
        if (!p.nowPlaying) korNastaLatLogik(socket.pubId);
        else broadcastState(socket.pubId);
    });

    socket.on('search', async (d) => {
        if (!socket.pubId) return;
        try {
            const res = await youtubeSearchApi.GetListByKeyword(d.query, false, 12);
            const results = (res.items || []).map(i => ({ videoId: flattenId(i.id), title: i.title, thumbnail: i.thumbnail?.thumbnails?.[0]?.url || "", durationSeconds: parseYouTubeDuration(i.length?.simpleText) })).filter(s => s.durationSeconds > 0 && s.durationSeconds <= MAX_SONG_DURATION);
            socket.emit('searchResults', { results });
        } catch (e) {}
    });

    // ISOLERAD HANTERING AV BARENS EGNA LÅTLISTOR (Sparar enbart i data/[pubId]_låtar.json)
    socket.on('library:add_song', (d) => {
        if (!socket.pubId || !d.playlistName) return;
        const pubId = socket.pubId;

        const gemensamma = hämtaGemensammaListor();
        if (Object.keys(gemensamma).map(k => k.toLowerCase().trim()).includes(d.playlistName.toLowerCase().trim())) {
            return; // Masterlistor är helt låsta för modifikation
        }

        const egnaPath = path.join(__dirname, 'data', `${pubId}_låtar.json`);
        let egnaData = {};
        if (fs.existsSync(egnaPath)) {
            try { egnaData = JSON.parse(fs.readFileSync(egnaPath, 'utf8')); } catch(e) {}
        }

        const pName = d.playlistName.toLowerCase().trim();
        if (!egnaData[pName]) egnaData[pName] = [];

        const songObj = {
            title: d.title,
            videoId: flattenId(d.videoId),
            thumbnail: d.thumbnail,
            duration: d.durationSeconds || 180,
            startPosition: 0,
            stopPosition: 0
        };

        if (!egnaData[pName].some(s => s.videoId === songObj.videoId)) {
            egnaData[pName].push(songObj);
            fs.writeFileSync(egnaPath, JSON.stringify(egnaData, null, 2), 'utf8');
        }

        hämtaPubData(pubId);
        broadcastState(pubId);
    });

    socket.on('library:remove_song', (d) => {
        if (!socket.pubId || !d.playlistName) return;
        const pubId = socket.pubId;

        const egnaPath = path.join(__dirname, 'data', `${pubId}_låtar.json`);
        if (!fs.existsSync(egnaPath)) return;

        let egnaData = {};
        try { egnaData = JSON.parse(fs.readFileSync(egnaPath, 'utf8')); } catch(e) { return; }

        const pName = d.playlistName.toLowerCase().trim();
        if (egnaData[pName]) {
            egnaData[pName] = egnaData[pName].filter(s => s.title.toLowerCase() !== d.songString.toLowerCase());
            if (egnaData[pName].length === 0) {
                delete egnaData[pName];
            }
            fs.writeFileSync(egnaPath, JSON.stringify(egnaData, null, 2), 'utf8');
        }

        hämtaPubData(pubId);
        broadcastState(pubId);
    });
});

function getFairQueue(pub) {
    const userQueues = {};
    pub.queue.forEach(s => {
        const uid = s.uId || s.socketId || 'anon';
        if (!userQueues[uid]) userQueues[uid] = [];
        userQueues[uid].push(s);
    });
    const fairList = [];
    let bgCursor = pub.playlistCursor;
    const tempQueues = {};
    Object.keys(userQueues).forEach(uid => tempQueues[uid] = [...userQueues[uid]]);
    let hasSongs = true;
    while (hasSongs) {
        hasSongs = false;
        Object.keys(tempQueues).forEach(uid => {
            if (tempQueues[uid].length > 0) {
                fairList.push(tempQueues[uid].shift());
                hasSongs = true;
            }
        });
        const bg = getBackgroundSongAt(pub, bgCursor);
        if (bg) { fairList.push({ ...bg, id: 'bg_' + bgCursor, isListSong: true }); bgCursor++; }
    }
    return fairList;
}

http.listen(process.env.PORT || 3001, () => { console.log("SERVER STARTAD"); });