// testserver.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');
const fs = require('fs');

const { hanteraSpelning } = require('./jukebox-player-logic');

const DATA_DIR = process.env.DATA_DIR || process.env.RENDER_DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const LISTOR_DIR = path.join(DATA_DIR, 'låtlista');
const pubar = {};

function hämtaGemensammaListor() {
  if (!fs.existsSync(LISTOR_DIR)) fs.mkdirSync(LISTOR_DIR, { recursive: true });
  const valv = {};
  const filer = fs.readdirSync(LISTOR_DIR);
  filer.forEach(fil => {
    if (fil.endsWith('.json')) {
      const listNamn = fil.replace('.json', '');
      try { valv[listNamn] = JSON.parse(fs.readFileSync(path.join(LISTOR_DIR, fil), 'utf8')); } catch (e) { valv[listNamn] = []; }
    }
  });
  return valv;
}

function hämtaPubData(pubId) {
  if (!pubId) return null;
  const filStig = path.join(DATA_DIR, `${pubId}.json`);
  
  if (!fs.existsSync(filStig)) {
    const standardConfig = {
      namn: `${pubId.toUpperCase()} Jukebox`,
      aktivtValv: "Standard Rock",
      qrKrav: false,
      användaKoder: {},
      statistikKuponger: 0,
      statistikTotalt: 0
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    fs.writeFileSync(filStig, JSON.stringify(standardConfig, null, 2));
  }

  const config = JSON.parse(fs.readFileSync(filStig, 'utf8'));
  if (!config.användaKoder || Array.isArray(config.användaKoder)) config.användaKoder = {};
  config.valv = hämtaGemensammaListor();
  
  if (!pubar[pubId]) {
    pubar[pubId] = { queue: [], nowPlaying: null, config: config };
  } else {
    pubar[pubId].config = config;
  }
  return pubar[pubId];
}

app.get('/pub/:pubId/mobile', (req, res) => { hämtaPubData(req.params.pubId); res.sendFile(path.join(__dirname, 'test-mobile.html')); });
app.get('/pub/:pubId/player', (req, res) => { hämtaPubData(req.params.pubId); res.sendFile(path.join(__dirname, 'test-player.html')); });

io.on('connection', (socket) => {
  socket.on("join_pub", (pubId) => {
    socket.join(pubId);
    socket.pubId = pubId;
    hanteraSpelning(pubId, pubar, hämtaPubData, io);
  });

  socket.on("search", async (data) => {
    try {
      const searchResult = await youTubeSearchApi.GetListByKeyword(data.query, false, 8);
      const results = searchResult.items.map(item => ({
        videoId: item.id,
        title: item.title,
        thumbnail: item.thumbnail?.thumbnails[0]?.url || `https://img.youtube.com/vi/${item.id}/0.jpg`
      }));
      socket.emit("searchResults", { results });
    } catch (err) { console.error(err); }
  });

  socket.on("addSong", (data) => {
    const pubId = data.pubId || socket.pubId; 
    if (!pubId || !pubar[pubId]) return;
    const pub = pubar[pubId];
    
    let registreringGodkand = false;

    if (pub.config.qrKrav) {
      const råKod = data.kupongKod ? data.kupongKod.trim().toUpperCase() : "";
      if (!råKod) return socket.emit("kupong_error", { msg: "🔒 QR-kod krävs!" });
      if (pub.config.användaKoder[råKod]) return socket.emit("kupong_error", { msg: "Koden är förbrukad!" });

      pub.config.användaKoder[råKod] = 1; 
      pub.config.statistikKuponger += 1;
      registreringGodkand = true;
    } else {
      registreringGodkand = true;
    }

    if (registreringGodkand) {
      pub.config.statistikTotalt += 1;
      fs.writeFileSync(path.join(DATA_DIR, `${pubId}.json`), JSON.stringify(pub.config, null, 2));

      const nyLåt = {
        id: Math.random().toString(36).substr(2, 9),
        videoId: data.videoId,
        title: data.title,
        addedBy: pub.config.qrKrav ? "Biljett" : "Gäst",
        isRadio: false
      };

      const radioIdx = pub.queue.findIndex(l => l.isRadio);
      if (radioIdx !== -1) pub.queue.splice(radioIdx, 0, nyLåt);
      else pub.queue.push(nyLåt);

      socket.emit("kupong_success", { msg: "Låten tillagd!", resterande: 0 });
      hanteraSpelning(pubId, pubar, hämtaPubData, io);
    }
  });

  socket.on("player:toggle_qr", (data) => {
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.qrKrav = data.qrKrav;
    fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2));
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io);
  });

  socket.on("player:skip", () => { if(!socket.pubId || !pubar[socket.pubId]) return; pubar[socket.pubId].nowPlaying = null; hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); });
  socket.on("player:remove_song", (data) => { if(!socket.pubId || !pubar[socket.pubId]) return; pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => l.id !== data.id); hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); });
  socket.on("player:byt_valv", (data) => { if(!socket.pubId || !pubar[socket.pubId]) return; pubar[socket.pubId].config.aktivtValv = data.valvNamn; pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => !l.isRadio); fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2)); hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); });
  socket.on("player:ready_for_next", () => { if(!socket.pubId || !pubar[socket.pubId]) return; pubar[socket.pubId].nowPlaying = null; hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); });

  // ==========================================
  // HÄR ÄR DE SAKNADE FUNKTIONERNA SOM GÖR ATT FIL-KNAPPARNA FUNGERAR:
  // ==========================================
  socket.on("admin:add_to_valv", (data) => {
    try {
      const filStig = path.join(LISTOR_DIR, `${data.valvNamn}.json`);
      let listInnehåll = [];
      if (fs.existsSync(filStig)) {
        listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8'));
      }
      if (!listInnehåll.includes(data.lat)) {
        listInnehåll.push(data.lat);
        fs.writeFileSync(filStig, JSON.stringify(listInnehåll, null, 2));
      }
      hanteraSpelning(socket.pubId, pubar, hämtaPubData, io);
      io.to(socket.pubId).emit("admin:valv_data", { valvNamn: data.valvNamn, songs: listInnehåll });
    } catch (e) { console.error("Fel vid tillägg i fil:", e); }
  });

  socket.on("admin:remove_from_valv", (data) => {
    try {
      const filStig = path.join(LISTOR_DIR, `${data.valvNamn}.json`);
      if (fs.existsSync(filStig)) {
        let listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8'));
        if (typeof data.index === 'number' && data.index >= 0 && data.index < listInnehåll.length) {
          listInnehåll.splice(data.index, 1);
          fs.writeFileSync(filStig, JSON.stringify(listInnehåll, null, 2));
        }
        io.to(socket.pubId).emit("admin:valv_data", { valvNamn: data.valvNamn, songs: listInnehåll });
      }
      hanteraSpelning(socket.pubId, pubar, hämtaPubData, io);
    } catch (e) { console.error("Fel vid borttagning från fil:", e); }
  });

  socket.on("admin:request_valv_data", (data) => {
    try {
      const filStig = path.join(LISTOR_DIR, `${data.valvNamn}.json`);
      let listInnehåll = [];
      if (fs.existsSync(filStig)) {
        listInnehåll = JSON.parse(fs.readFileSync(filStig, 'utf8'));
      }
      socket.emit("admin:valv_data", { valvNamn: data.valvNamn, songs: listInnehåll });
    } catch (e) {
      console.error("Fel vid hämtning av valvdata:", e);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Jukebox-server igång på port ${PORT}`); });