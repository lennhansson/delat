const fs = require('fs');
const path = require('path');

function ensureDataDirs(DATA_DIR, LISTOR_DIR) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LISTOR_DIR)) fs.mkdirSync(LISTOR_DIR, { recursive: true });
}

function getPlaylistFiles(LISTOR_DIR) {
  const valv = {};
  if (!fs.existsSync(LISTOR_DIR)) return valv;
  const filer = fs.readdirSync(LISTOR_DIR);
  filer.forEach((fil) => {
    if (fil.endsWith('.json')) {
      const listNamn = fil.replace('.json', '');
      try {
        valv[listNamn] = JSON.parse(fs.readFileSync(path.join(LISTOR_DIR, fil), 'utf8'));
      } catch (e) {
        valv[listNamn] = [];
      }
    }
  });
  return valv;
}

function buildPubState(pubId, pubar, hämtaPubData, io) {
  const pub = hämtaPubData(pubId);
  const config = pub.config;
  const valv = getPlaylistFiles(path.join(path.dirname(__filename), 'låtlista'));
  config.valv = valv;

  if (!config.aktivtValv || !config.valv[config.aktivtValv]) {
    const availableValv = Object.keys(config.valv);
    config.aktivtValv = availableValv.length > 0 ? availableValv[0] : 'radio';
  }

  const nowPlaying = pub.nowPlaying;
  const queue = pub.queue || [];
  const payload = {
    pubNamn: config.namn || pubId,
    qrKrav: !!config.qrKrav,
    statistikKuponger: config.statistikKuponger || 0,
    statistikTotalt: config.statistikTotalt || 0,
    aktivHuvudlista: config.aktivtValv || '',
    aktivTillfalligLista: '',
    aktivtValv: config.aktivtValv || '',
    nowPlaying,
    fullQueue: queue,
    valv: config.valv || {}
  };

  io.to(pubId).emit('staff_state', payload);
  io.to(pubId).emit('state', payload);
  return payload;
}

function hanteraSpelning(pubId, pubar, hämtaPubData, io) {
  const pub = hämtaPubData(pubId);
  if (!pub) return null;

  const queue = pub.queue || [];
  const nowPlaying = pub.nowPlaying;

  if (!nowPlaying && queue.length > 0) {
    const nextSong = queue.shift();
    pub.nowPlaying = nextSong;
    pub.queue = queue;
    buildPubState(pubId, pubar, hämtaPubData, io);
    return pub.nowPlaying;
  }

  if (!nowPlaying && pub.config && pub.config.aktivtValv) {
    const valv = getPlaylistFiles(path.join(path.dirname(__filename), 'låtlista'));
    const playlist = valv[pub.config.aktivtValv] || [];
    if (playlist.length > 0) {
      const randomIndex = Math.floor(Math.random() * playlist.length);
      const selected = playlist[randomIndex];
      pub.nowPlaying = { id: 'radio_' + Date.now(), title: selected, videoId: selected.videoId || selected, addedBy: 'Bakgrundsvalv', isRadio: true };
      buildPubState(pubId, pubar, hämtaPubData, io);
      return pub.nowPlaying;
    }
  }

  buildPubState(pubId, pubar, hämtaPubData, io);
  return pub.nowPlaying;
}

module.exports = { hanteraSpelning };
