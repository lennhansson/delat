const fs = require('fs');
const path = require('path');

const LIBRARY_PATH = path.join(__dirname, 'data', 'alla_låtar.json');

let library = {};

function loadLibrary() {
    try {
        if (fs.existsSync(LIBRARY_PATH)) {
            const data = fs.readFileSync(LIBRARY_PATH, 'utf8');
            library = JSON.parse(data);
            console.log(`[Library] Laddat: ${Object.keys(library).length} låtar.`);
        } else {
            console.log("[Library] Hittade ingen fil, skapar ett tomt bibliotek.");
            library = {};
            saveLibrary();
        }
    } catch (err) {
        console.error("[Library] Fel vid laddning:", err);
        library = {};
    }
}

function saveLibrary() {
    try {
        const data = JSON.stringify(library, null, 2);
        fs.writeFileSync(LIBRARY_PATH, data);
    } catch (err) {
        console.error("[Library] Fel vid sparande:", err);
    }
}

function generateNextId() {
    const ids = Object.keys(library).map(id => parseInt(id)).filter(id => !isNaN(id));
    if (ids.length === 0) return "1001";
    return (Math.max(...ids) + 1).toString();
}

function cleanTitle(title) {
    if (!title) return "";
    return title
        .replace(/\(Official Video\)/gi, '')
        .replace(/\(Official Music Video\)/gi, '')
        .replace(/\[Official Video\]/gi, '')
        .replace(/\(Lyrics\)/gi, '')
        .replace(/\[HQ\]/gi, '')
        .replace(/\[HD\]/gi, '')
        .replace(/\(HD\)/gi, '')
        .replace(/- Topic/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function addOrUpdateSong(item, playlistName = null) {
    let videoId = item.id || item.videoId;
    if (typeof videoId === 'object' && videoId !== null) {
        videoId = videoId.videoId || videoId.id;
    }
    if (!videoId || typeof videoId !== 'string') return null;

    let entry = Object.values(library).find(s => s.videoId === videoId);

    if (!entry) {
        const newId = generateNextId();
        const cleaned = cleanTitle(item.title);
        let artist = "Okänd Artist";
        let title = cleaned;
        if (cleaned.includes(" - ")) {
            const parts = cleaned.split(" - ");
            artist = parts[0].trim();
            title = parts.slice(1).join(" - ").trim();
        }

        entry = {
            videoId: videoId,
            artist: artist,
            title: title,
            thumbnail: item.thumbnail?.thumbnails?.[0]?.url || item.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`,
            playlists: [],
            duration: item.duration || 0,
            future: ["F1", "F2", "F3", "F4"]
        };
        library[newId] = entry;
    } else {
        // Uppdatera duration om den saknas på befintlig låt
        if (item.duration && (!entry.duration || entry.duration === 0)) {
            entry.duration = item.duration;
        }
    }

    if (playlistName && !entry.playlists.includes(playlistName)) {
        entry.playlists.push(playlistName);
    }

    saveLibrary();
    return entry;
}

function removeSongFromPlaylist(songString, playlistName) {
    const entry = Object.values(library).find(s => {
        const full = `${s.artist} - ${s.title}`.toLowerCase();
        return full === songString.toLowerCase();
    });
    if (entry && entry.playlists) {
        entry.playlists = entry.playlists.filter(p => p !== playlistName);
        saveLibrary();
        return true;
    }
    return false;
}

function enrichLibraryFromSearch(results) {
    if (!results || !Array.isArray(results)) return 0;
    results.forEach(item => addOrUpdateSong(item));
}

function normalizeSearchText(value) {
    if (!value) return "";
    return String(value)
        .toLowerCase()
        .replace(/[\[\]()\-_–—]/g, ' ')
        .replace(/[^a-zåäö0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function searchLibrary(query, limit = 5) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    const queryWords = q.split(' ').filter(Boolean);

    const results = Object.values(library)
        .filter(song => {
            const artist = song.artist || "";
            const title = song.title || "";
            const videoId = song.videoId || "";
            const haystack = normalizeSearchText(`${artist} ${title} ${videoId}`);
            return queryWords.every(word => haystack.includes(word));
        })
        .slice(0, limit)
        .map(song => ({
            videoId: song.videoId,
            title: `${song.artist || 'Okänd Artist'} - ${song.title || 'Okänd titel'}`,
            thumbnail: song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/0.jpg`,
            durationSeconds: Number(song.duration) || 180,
            artist: song.artist || 'Okänd Artist',
            songTitle: song.title || 'Okänd titel'
        }));

    return results;
}

function getLibrary() { return library; }

loadLibrary();

module.exports = {
    getLibrary,
    enrichLibraryFromSearch,
    addOrUpdateSong,
    removeSongFromPlaylist,
    cleanTitle,
    searchLibrary,
    normalizeSearchText
};