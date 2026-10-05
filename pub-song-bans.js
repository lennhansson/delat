const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isValidVideoId(videoId) {
    return typeof videoId === 'string' && VIDEO_ID_PATTERN.test(videoId);
}

function normalizeBannedSongs(bannedSongs) {
    if (!bannedSongs || typeof bannedSongs !== 'object' || Array.isArray(bannedSongs)) return {};

    return Object.fromEntries(Object.entries(bannedSongs)
        .filter(([videoId]) => isValidVideoId(videoId))
        .map(([videoId, song]) => [videoId, {
            title: typeof song === 'string' ? song : (typeof song?.title === 'string' ? song.title : videoId)
        }]));
}

function isSongBanned(pub, videoId) {
    return isValidVideoId(videoId) && Object.hasOwn(pub?.bannedSongs || {}, videoId);
}

function filterAvailableSongs(pub, songs) {
    return (Array.isArray(songs) ? songs : []).filter(song => !isSongBanned(pub, song?.videoId));
}

function getBannedSongEntries(pub) {
    return Object.entries(normalizeBannedSongs(pub?.bannedSongs))
        .map(([videoId, song]) => ({ videoId, title: song.title }));
}

function setSongBan(pub, videoId, title, banned) {
    if (!pub || typeof pub !== 'object' || !isValidVideoId(videoId)) return false;
    if (!pub.bannedSongs || typeof pub.bannedSongs !== 'object' || Array.isArray(pub.bannedSongs)) {
        pub.bannedSongs = {};
    }

    if (banned) {
        pub.bannedSongs[videoId] = { title: String(title || videoId).slice(0, 300) };
    } else {
        delete pub.bannedSongs[videoId];
    }
    return true;
}

module.exports = {
    filterAvailableSongs,
    getBannedSongEntries,
    isSongBanned,
    isValidVideoId,
    normalizeBannedSongs,
    setSongBan
};