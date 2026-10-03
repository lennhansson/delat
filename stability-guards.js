function withTimeout(promise, timeoutMs, fallbackValue) {
  let timer;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeSongCandidate(item, fallbackDuration = 180) {
  if (!item || typeof item !== 'object') {
    return { valid: false, reason: 'invalid-item' };
  }

  const rawVideoId = item.videoId || item.id;
  const videoId = typeof rawVideoId === 'object' ? (rawVideoId.videoId || rawVideoId.id || '') : String(rawVideoId || '').trim();

  if (!videoId) {
    return { valid: false, reason: 'missing-video-id' };
  }

  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Okänd titel';
  const rawDuration = Number(item.duration ?? item.durationSeconds ?? fallbackDuration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= 480 ? rawDuration : fallbackDuration;
  const thumbnail = item.thumbnail || `https://img.youtube.com/vi/${videoId}/0.jpg`;

  return {
    valid: true,
    videoId,
    title,
    thumbnail,
    duration
  };
}

function hasRecoverableSongCandidate(item) {
  return !!normalizeSongCandidate(item).valid;
}

function buildSafeSearchResults(entries, limit = 5) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => normalizeSongCandidate(entry))
    .filter(result => result.valid)
    .slice(0, limit)
    .map(({ videoId, title, thumbnail, duration }) => ({
      videoId,
      title,
      thumbnail,
      duration
    }));
}

module.exports = {
  withTimeout,
  normalizeSongCandidate,
  hasRecoverableSongCandidate,
  buildSafeSearchResults
};
