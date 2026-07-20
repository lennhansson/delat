const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const fs = require('fs');
const path = require('path');
const youtubeSearchApi = require('youtube-search-api');

const MAPPE = path.join(__dirname, 'låtlista');
const pubar = {};
const videoIdCache = new Map();

function hämtaGemensammaListor() {
    if (!fs.existsSync(MAPPE)) fs.mkdirSync(MAPPE, { recursive: true });
    const valv = {};
    const filer = fs.readdirSync(MAPPE);
    filer.forEach((fil) => {
        if (fil.endsWith('.json')) {
            const listNamn = fil.replace('.json', '');
            try {
                valv[listNamn] = JSON.parse(fs.readFileSync(path.join(MAPPE, fil), 'utf8'));
            } catch (e) {
                valv[listNamn] = [];
            }
        }
    });
    return valv;
}

function hämtaPubData(pubId) {
    if (!pubId) return null;
    if (!pubar[pubId]) {
        pubar[pubId] = {
            queue: [],
            nowPlaying: null,
            playlistCursor: 0,
            config: {
                namn: `${pubId.toUpperCase()} Jukebox`,
                aktivtValv: '',
                qrKrav: false,
                statistikKuponger: 0,
                statistikTotalt: 0,
                användaKoder: {},
                valv: {}
            }
        };
    }

    const pub = pubar[pubId];
    pub.config.valv = hämtaGemensammaListor();
    if (!pub.config.aktivtValv || !pub.config.valv[pub.config.aktivtValv]) {
        const availableValv = Object.keys(pub.config.valv);
        pub.config.aktivtValv = availableValv.length > 0 ? availableValv[0] : '';
    }
    return pub;
}

function getPlaylistSongs(pub) {
    const activeList = pub.config.aktivtValv;
    const valv = pub.config.valv || {};
    return Array.isArray(valv[activeList]) ? valv[activeList] : [];
}

function getUpcomingListSongs(pub, limit = 2) {
    const songs = getPlaylistSongs(pub);
    if (!songs.length) return [];
    const items = [];
    const start = pub.playlistCursor || 0;
    for (let i = 0; i < limit; i += 1) {
        const index = (start + i) % songs.length;
        items.push({
            id: `list_${Date.now()}_${i}`,
            title: songs[index],
            addedBy: 'Bakgrundsvalv',
            isListSong: true
        });
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
        aktivtValv: pub.config.aktivtValv || '',
        nowPlaying: pub.nowPlaying,
        queue: displayQueue,
        fullQueue: displayQueue,
        requestedQueue: requestedQueue,
        valv: pub.config.valv || {}
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
    if (typeof song === 'object') {
        if (song.videoId) return song.videoId;
        if (song.title) return resolveVideoId(song.title);
        return 'dQw4w9WgXcQ';
    }
    const text = String(song);
    const cacheKey = text.toLowerCase();
    if (videoIdCache.has(cacheKey)) return videoIdCache.get(cacheKey);
    try {
        const result = await youtubeSearchApi.GetListByKeyword(text, false, 1);
        const id = result?.items?.[0]?.id || result?.items?.[0]?.videoId || null;
        if (id) {
            videoIdCache.set(cacheKey, id);
            return id;
        }
    } catch (err) { console.error(err); }
    return 'dQw4w9WgXcQ';
}

async function korNastaLatLogik(pubId) {
    const pub = hämtaPubData(pubId);
    if (!pub) return null;

    if (pub.queue && pub.queue.length > 0) {
        const nastaLat = pub.queue.shift();
        const videoId = nastaLat.videoId || await resolveVideoId(nastaLat.title || nastaLat);
        pub.nowPlaying = {
            id: nastaLat.id,
            title: nastaLat.title || nastaLat,
            videoId,
            addedBy: nastaLat.addedBy || 'Gäst',
            isListSong: false
        };
        broadcastState(pubId);
        return pub.nowPlaying;
    }

    if (pub.nowPlaying) return pub.nowPlaying;

    const songs = getPlaylistSongs(pub);
    if (songs.length > 0) {
        const nextIndex = pub.playlistCursor || 0;
        const valdLat = songs[nextIndex % songs.length];
        pub.playlistCursor = (nextIndex + 1) % songs.length;
        const videoId = await resolveVideoId(valdLat);
        pub.nowPlaying = {
            id: 'valv_' + Date.now(),
            title: valdLat,
            videoId,
            addedBy: 'Bakgrundsvalv',
            isListSong: true
        };
        broadcastState(pubId);
        return pub.nowPlaying;
    }

    pub.nowPlaying = null;
    broadcastState(pubId);
    return null;
}

setInterval(() => {
    Object.keys(pubar).forEach((pubId) => {
        const pub = pubar[pubId];
        if (!pub.nowPlaying) {
            korNastaLatLogik(pubId).catch((err) => console.error(err));
        }
    });
}, 5000);

app.get('/pub/:pubId/staff', (req, res) => { res.sendFile(path.join(__dirname, 'staff-app.html')); });
app.get('/pub/:pubId/mobile', (req, res) => { res.sendFile(path.join(__dirname, 'test-mobile.html')); });

io.on('connection', (socket) => {
    socket.on('join_pub', (pubId) => {
        socket.join(pubId);
        socket.pubId = pubId;
        hämtaPubData(pubId);
        broadcastState(pubId, socket);
    });

    socket.on('search', async (data) => {
        try {
            const searchResult = await youtubeSearchApi.GetListByKeyword(data.query, false, 8);
            const results = (searchResult.items || []).map((item) => ({
                videoId: item.id,
                title: item.title,
                thumbnail: item.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.id}/0.jpg`
            }));
            socket.emit('searchResults', { results });
        } catch (err) { console.error(err); }
    });

    socket.on('addSong', async (data) => {
        if (!data || !data.title) return;
        const pubId = data.pubId || socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        const pub = pubar[pubId];

        let resterandeKrediter = 0;
        let addedBy = 'Gäst';

        if (pub.config.qrKrav) {
            const kod = (data.kupongKod && typeof data.kupongKod === 'string') ? data.kupongKod.trim() : "";
            if (!kod) return socket.emit('kupong_error', { msg: 'QR-kod krävs!' });

            const delar = kod.split("-");
            if (delar.length !== 3) return socket.emit('kupong_error', { msg: 'Ogiltigt kodformat!' });

            let antal = parseInt(delar[1]);
            if (isNaN(antal) || antal <= 0) return socket.emit('kupong_error', { msg: 'Kupongen är förbrukad!' });

            antal--;
            resterandeKrediter = antal;
            addedBy = `Biljett (${delar[0]})`;
            pub.config.statistikKuponger = (pub.config.statistikKuponger || 0) + 1;
        }

        pub.config.statistikTotalt = (pub.config.statistikTotalt || 0) + 1;

        const nyLåt = {
            id: Math.random().toString(36).substr(2, 9),
            videoId: data.videoId || null,
            title: data.title,
            addedBy: addedBy,
            isRadio: false
        };

        pub.queue.push(nyLåt);
        socket.emit('kupong_success', { msg: 'Låten tillagd!', resterande: resterandeKrediter });
        if (!pub.nowPlaying) { await korNastaLatLogik(pubId); }
        else { broadcastState(pubId); }
    });

    socket.on('player:toggle_qr', (data) => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].config.qrKrav = !!data.qrKrav;
        broadcastState(pubId);
    });

    socket.on('player:skip', async () => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].nowPlaying = null;
        await korNastaLatLogik(pubId);
    });

    socket.on('player:remove_song', (data) => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].queue = pubar[pubId].queue.filter((l) => l.id !== data.id);
        broadcastState(pubId);
    });

    socket.on('player:byt_valv', (data) => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].config.aktivtValv = data.valvNamn;
        pubar[pubId].playlistCursor = 0;
        broadcastState(pubId);
    });

    socket.on('player:ready_for_next', async () => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].nowPlaying = null;
        await korNastaLatLogik(pubId);
    });

    socket.on('ADD_TEMP_PLAYLIST', (data) => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].config.aktivTillfalligLista = data.playlist;
        broadcastState(pubId);
    });

    socket.on('REMOVE_TEMP_PLAYLIST', () => {
        const pubId = socket.pubId;
        if (!pubId || !pubar[pubId]) return;
        pubar[pubId].config.aktivTillfalligLista = '';
        broadcastState(pubId);
    });

    socket.on('admin:add_to_valv', (data) => {
        try {
            const pubId = socket.pubId || data.pubId;
            const filStig = path.join(MAPPE, `${data.valvNamn}.json`);
            let listInnehåll = [];
            if (fs.existsSync(filStig)) { listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8')); }
            if (!listInnehåll.includes(data.lat)) {
                listInnehåll.push(data.lat);
                fs.writeFileSync(filStig, JSON.stringify(listInnehåll, null, 2));
            }
            hämtaPubData(pubId);
            broadcastState(pubId);
        } catch (e) { console.error(e); }
    });

    socket.on('admin:request_valv_data', (data) => {
        try {
            const filStig = path.join(MAPPE, `${data.valvNamn}.json`);
            let listInnehåll = [];
            if (fs.existsSync(filStig)) { listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8')); }
            socket.emit('admin:valv_data', { valvNamn: data.valvNamn, songs: listInnehåll });
        } catch (e) { console.error(e); }
    });

    socket.on('admin:remove_from_valv', (data) => {
        try {
            const pubId = socket.pubId || data.pubId;
            const filStig = path.join(MAPPE, `${data.valvNamn}.json`);
            if (fs.existsSync(filStig)) {
                let listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8'));
                if (Number.isInteger(data.index)) { listInnehåll.splice(data.index, 1); }
                else { listInnehåll = listInnehåll.filter((t) => t !== data.latNamn); }
                fs.writeFileSync(filStig, JSON.stringify(listInnehåll, null, 2));
            }
            hämtaPubData(pubId);
            broadcastState(pubId);
        } catch (e) { console.error(e); }
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => { console.log(`JUKEBOX SERVER STARTAD PÅ PORT ${PORT}`); });