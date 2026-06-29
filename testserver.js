// testserver.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');
const fs = require('fs');
const crypto = require('crypto');

// Importera den separerade spel- och kömotorn
const { hanteraSpelning } = require('./jukebox-player-logic');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');
const pubar = {};
const MASTER_SECRET = "din-hemliga-globala-paniknyckel-2026";

function hämtaPubData(pubId) {
  if (!pubId) return null;
  const filStig = path.join(DATA_DIR, `${pubId}.json`);
  
  if (!fs.existsSync(filStig)) {
    const standardConfig = {
      namn: `${pubId.toUpperCase()} Jukebox`,
      aktivtValv: "Standard Rock",
      qrKrav: false,
      låtarPerBiljett: 1,
      valv: {
        "Standard Rock": ["Creedence - Have You Ever Seen The Rain", "Eddie Meduza - Gasen i botten", "Volbeat - Still Counting"],
        "Schlager & Party": ["Gyllene Tider - Sommartider", "Arvingarna - Eloise", "Fronda - Rullar fram"]
      },
      användaKoder: {}
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    fs.writeFileSync(filStig, JSON.stringify(standardConfig, null, 2));
  }

  const config = JSON.parse(fs.readFileSync(filStig, 'utf8'));
  if (!config.användaKoder || Array.isArray(config.användaKoder)) config.användaKoder = {};
  if (config.qrKrav === undefined) config.qrKrav = false;
  if (config.låtarPerBiljett === undefined) config.låtarPerBiljett = 1;

  if (!pubar[pubId]) {
    pubar[pubId] = { queue: [], nowPlaying: null, config: config };
  } else {
    pubar[pubId].config = config;
  }

  return pubar[pubId];
}

// Webbsidor
app.get('/pub/:pubId/mobile', (req, res) => {
  hämtaPubData(req.params.pubId);
  res.sendFile(path.join(__dirname, 'test-mobile.html'));
});

app.get('/pub/:pubId/player', (req, res) => {
  hämtaPubData(req.params.pubId);
  res.sendFile(path.join(__dirname, 'test-player.html'));
});

app.get('/generate', (req, res) => {
  res.sendFile(path.join(__dirname, 'skriv-ut-kuponger.html'));
});

// Leverera den nya PWA-logikfilen till mobilerna
app.get('/jukebox-pwa.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'jukebox-pwa.js'));
});

// Socket-kommunikation
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
    } catch (err) {}
  });

  socket.on("addSong", (data) => {
    const pubId = data.pubId || socket.pubId; 
    if (!pubId || !pubar[pubId]) return;
    const pub = pubar[pubId];
    
    let registreringGodkand = false;
    let textKvar = 999;

    if (pub.config.qrKrav) {
      const fullKod = data.kupongKod ? data.kupongKod.trim().toUpperCase() : "";
      const delar = fullKod.split("-");
      
      if (delar.length !== 3) {
        return socket.emit("kupong_error", { msg: "Ogiltigt kodformat på lappen." });
      }

      const [kupongId, maxLåtarStr, inskickadSignatur] = delar;
      const maxLåtar = parseInt(maxLåtarStr) || 1;
      const användaGånger = pub.config.användaKoder[kupongId] || 0;

      if (användaGånger >= maxLåtar) {
        return socket.emit("kupong_error", { msg: `Denna biljett är redan förbrukad.` });
      }

      const strängAttSignera = `${kupongId}-${maxLåtar}`;
      const förväntadMasterSig = crypto.createHmac('sha256', MASTER_SECRET).update(strängAttSignera).digest('hex').substr(0, 6).toUpperCase();

      if (inskickadSignatur !== förväntadMasterSig) {
        return socket.emit("kupong_error", { msg: "Ogiltig signatur! Felaktig biljett." });
      }

      pub.config.användaKoder[kupongId] = användaGånger + 1;
      fs.writeFileSync(path.join(DATA_DIR, `${pubId}.json`), JSON.stringify(pub.config, null, 2));
      
      textKvar = maxLåtar - (användaGånger + 1);
      registreringGodkand = true;
    } else {
      registreringGodkand = true;
    }

    if (registreringGodkand) {
      const nyGästLåt = {
        id: Math.random().toString(36).substr(2, 9),
        videoId: data.videoId,
        title: data.title,
        addedBy: pub.config.qrKrav ? "Kupong" : "Gäst",
        isRadio: false
      };

      const förstaRadioIndex = pub.queue.findIndex(l => l.isRadio);
      if (förstaRadioIndex !== -1) {
        pub.queue.splice(förstaRadioIndex, 0, nyGästLåt);
      } else {
        pub.queue.push(nyGästLåt);
      }

      socket.emit("kupong_success", { 
        msg: pub.config.qrKrav ? `Låt tillagd! Du har ${textKvar} låtar kvar.` : "Låten har lagts till i kön!", 
        resterande: textKvar 
      });

      hanteraSpelning(pubId, pubar, hämtaPubData, io);
    }
  });

  socket.on("player:add_to_valv", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId] || !data.valvNamn || !data.title) return;
    const pub = pubar[pubId];
    if (!pub.config.valv[data.valvNamn]) pub.config.valv[data.valvNamn] = [];
    
    if (!pub.config.valv[data.valvNamn].includes(data.title)) {
      pub.config.valv[data.valvNamn].push(data.title);
      fs.writeFileSync(path.join(DATA_DIR, `${pubId}.json`), JSON.stringify(pub.config, null, 2));
      hanteraSpelning(pubId, pubar, hämtaPubData, io);
    }
  });

  socket.on("player:toggle_qr", (data) => {
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.qrKrav = data.qrKrav;
    fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2));
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io);
  });

  socket.on("player:set_lator_per_biljett", (data) => {
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.låtarPerBiljett = parseInt(data.antal) || 1;
    fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2));
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io);
  });

  socket.on("player:skip", () => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].nowPlaying = null; 
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); 
  });

  socket.on("player:remove_song", (data) => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => l.id !== data.id); 
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); 
  });

  socket.on("player:byt_valv", (data) => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.aktivtValv = data.valvNamn; 
    pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => !l.isRadio); 
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); 
  });

  socket.on("player:ready_for_next", () => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].nowPlaying = null; 
    hanteraSpelning(socket.pubId, pubar, hämtaPubData, io); 
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Jukebox-server rullar på port ${PORT}`));