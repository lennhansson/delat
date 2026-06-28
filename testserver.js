const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');
const pubar = {};

const MASTER_SECRET = "din-hemliga-globala-paniknyckel-2026";

function hämtaPubData(pubId) {
  const filStig = path.join(DATA_DIR, `${pubId}.json`);
  
  if (!fs.existsSync(filStig)) {
    const standardConfig = {
      namn: `${pubId.toUpperCase()} Jukebox`,
      aktivtValv: "Standard Rock",
      qrKrav: false, // NYTT: Standard är att det är FRITT FRAM i vårt PoC
      valv: {
        "Standard Rock": ["Creedence - Have You Ever Seen The Rain", "Eddie Meduza - Gasen i botten", "Volbeat - Still Counting"],
        "Schlager & Party": ["Gyllene Tider - Sommartider", "Arvingarna - Eloise", "Fronda - Rullar fram"],
        "Lugn AW / Blues": ["Gary Moore - Still Got The Blues", "Otis Redding - Sittin On The Dock", "Norah Jones - Don't Know Why"]
      },
      användaKoder: []
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    fs.writeFileSync(filStig, JSON.stringify(standardConfig, null, 2));
  }

  const config = JSON.parse(fs.readFileSync(filStig, 'utf8'));

  if (!config.användaKoder) config.användaKoder = [];
  if (config.qrKrav === undefined) config.qrKrav = false; // Säkerställ fallback

  if (!pubar[pubId]) {
    pubar[pubId] = {
      queue: [],
      nowPlaying: null,
      config: config
    };
  } else {
    pubar[pubId].config = config;
  }

  return pubar[pubId];
}

app.get('/pub/:pubId/mobile', (req, res) => {
  hämtaPubData(req.params.pubId);
  res.sendFile(path.join(__dirname, 'test-mobile.html'));
});

app.get('/pub/:pubId/player', (req, res) => {
  hämtaPubData(req.params.pubId);
  res.sendFile(path.join(__dirname, 'test-player.html'));
});

function broadcastPubState(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;

  let gästLåtar = pub.queue.filter(l => !l.isRadio);
  let radioLåtar = pub.queue.filter(l => l.isRadio);
  let synligKö = [...gästLåtar, ...radioLåtar.slice(0, 2)];

  io.to(pubId).emit("state", {
    pubNamn: pub.config.namn,
    aktivtValv: pub.config.aktivtValv || "Standard Rock",
    qrKrav: pub.config.qrKrav, // Skicka med inställningen till mobil och spelare
    valvLista: Object.keys(pub.config.valv || {}),
    nowPlaying: pub.nowPlaying ? { title: pub.nowPlaying.title } : null,
    queue: synligKö,
    fullQueue: pub.queue
  });
}

async function fyllPåMedRadiolåt(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;
  
  const aktivtValvNamn = pub.config.aktivtValv || Object.keys(pub.config.valv)[0];
  const pool = pub.config.valv[aktivtValvNamn] || [];
  if (pool.length === 0) return;

  const slumpadText = pool[Math.floor(Math.random() * pool.length)];
  
  try {
    const searchResult = await youTubeSearchApi.GetListByKeyword(slumpadText, false, 1);
    if (searchResult && searchResult.items.length > 0) {
      const item = searchResult.items[0];
      pub.queue.push({
        id: Math.random().toString(36).substr(2, 9),
        videoId: item.id,
        title: item.title,
        addedBy: `Radio (${aktivtValvNamn})`,
        isRadio: true
      });
    }
  } catch (err) {
    console.error(`[RADIO ${pubId}] Sökningsfel:`, err);
  }
}

async function hanteraSpelning(pubId) {
  const pub = hämtaPubData(pubId);

  if (pub.queue.length === 0) {
    await fyllPåMedRadiolåt(pubId);
  }

  if (!pub.nowPlaying && pub.queue.length > 0) {
    let nastaLatIndex = pub.queue.findIndex(l => !l.isRadio);
    if (nastaLatIndex === -1) nastaLatIndex = 0;

    pub.nowPlaying = pub.queue.splice(nastaLatIndex, 1)[0];
    io.to(pubId).emit("player:change_track", { videoId: pub.nowPlaying.videoId });
  }

  let antalRadioIKön = pub.queue.filter(l => l.isRadio).length;
  if (antalRadioIKön < 2) {
    await fyllPåMedRadiolåt(pubId);
  }

  broadcastPubState(pubId);
}

io.on('connection', (socket) => {
  
  socket.on("join_pub", (pubId) => {
    socket.join(pubId);
    socket.pubId = pubId;
    hanteraSpelning(pubId);
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
    } catch (err) {
      console.error("Sökningsfel:", err);
    }
  });

  socket.on("addSong", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;

    const pub = pubar[pubId];
    
    // NYTT: Kolla om QR-kod ens krävs på denna pub just nu!
    if (pub.config.qrKrav) {
      const fullKod = data.kupongKod ? data.kupongKod.trim() : "";

      if (!fullKod.includes("-")) {
        return socket.emit("kupong_error", { msg: "Felaktigt kodformat. Använd ID-SIGNATUR." });
      }

      const [kupongId, inskickadSignatur] = fullKod.split("-");

      if (pub.config.användaKoder.includes(kupongId)) {
        return socket.emit("kupong_error", { msg: "Denna papperslapp är redan förbrukad!" });
      }

      let kodÄrGiltig = false;

      const förväntadMasterSig = crypto.createHmac('sha256', MASTER_SECRET).update(kupongId).digest('hex').substr(0, 6);
      if (inskickadSignatur === förväntadMasterSig) {
        kodÄrGiltig = true;
      }

      if (!kodÄrGiltig) {
        const pubSecret = `hemlis-${pubId}-2026`;
        const förväntadPubSig = crypto.createHmac('sha256', pubSecret).update(kupongId).digest('hex').substr(0, 6);
        if (inskickadSignatur === förväntadPubSig) {
          kodÄrGiltig = true;
        }
      }

      if (!kodÄrGiltig) {
        return socket.emit("kupong_error", { msg: "Ogiltig kod! Kontrollera papperslappen." });
      }

      pub.config.användaKoder.push(kupongId);
      const filStig = path.join(DATA_DIR, `${pubId}.json`);
      fs.writeFileSync(filStig, JSON.stringify(pub.config, null, 2));
    }

    // Lägg till låten (om qrKrav var false, eller om koden ovan godkändes)
    pub.queue.push({
      id: Math.random().toString(36).substr(2, 9),
      videoId: data.videoId,
      title: data.title,
      addedBy: pub.config.qrKrav ? "Gäst (Kupong)" : "Gäst (Fritt)"
    });

    socket.emit("kupong_success", { msg: "Låten har lagts till i kön!" });
    hanteraSpelning(pubId);
  });

  // NYTT: Aktivera/Inaktivera QR-krav från baren (Player-sidan)
  socket.on("player:toggle_qr", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;

    pubar[pubId].config.qrKrav = data.qrKrav;
    
    const filStig = path.join(DATA_DIR, `${pubId}.json`);
    fs.writeFileSync(filStig, JSON.stringify(pubar[pubId].config, null, 2));

    broadcastPubState(pubId);
  });

  socket.on("player:remove_song", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;
    pubar[pubId].queue = pubar[pubId].queue.filter(l => l.id !== data.id);
    hanteraSpelning(pubId);
  });

  socket.on("player:byt_valv", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;
    pubar[pubId].config.aktivtValv = data.valvNamn;
    const filStig = path.join(DATA_DIR, `${pubId}.json`);
    fs.writeFileSync(filStig, JSON.stringify(pubar[pubId].config, null, 2));
    pubar[pubId].queue = pubar[pubId].queue.filter(l => !l.isRadio);
    hanteraSpelning(pubId);
  });

  socket.on("player:add_to_valv", (data) => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;
    const pub = pubar[pubId];
    if (pub.config.valv[data.valvNamn]) {
      pub.config.valv[data.valvNamn].push(data.title);
      const filStig = path.join(DATA_DIR, `${pubId}.json`);
      fs.writeFileSync(filStig, JSON.stringify(pub.config, null, 2));
      broadcastPubState(pubId);
    }
  });

  socket.on("player:ready_for_next", () => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;
    pubar[pubId].nowPlaying = null;
    hanteraSpelning(pubId);
  });

  socket.on("player:skip", () => {
    const pubId = socket.pubId;
    if (!pubId || !pubar[pubId]) return;
    pubar[pubId].nowPlaying = null;
    hanteraSpelning(pubId);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Multi-Jukebox Plattform rullar på port ${PORT}!`));