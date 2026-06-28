const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');
const fs = require('fs');

// Bestäm var pub-data ska läsas ifrån (Render fast disk '/data', eller lokal 'data' mapp för test)
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data');

// Globalt minne för att hålla reda på varje pubs aktiva kö och nuvarande låt
const pubar = {};

// Funktion för att ladda eller uppdatera en pubs inställningar från disken
function hämtaPubData(pubId) {
  const filStig = path.join(DATA_DIR, `${pubId}.json`);
  
  // Om puben inte har en konfigurationsfil, skapa en standard
  if (!fs.existsSync(filStig)) {
    const standardConfig = {
      namn: `${pubId.toUpperCase()} Jukebox`,
      pris: 10,
      swish: "0000000000",
      radioPool: ["Rick Astley - Never Gonna Give You Up", "Metallica - Enter Sandman"]
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    fs.writeFileSync(filStig, JSON.stringify(standardConfig, null, 2));
  }

  const config = JSON.parse(fs.readFileSync(filStig, 'utf8'));

  // Om puben inte är laddad i RAM-minnet än, initiera den
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

// DYNAMISKA SÖKBANOR: Sänder ut HTML-filerna till besökarna
app.get('/pub/:pubId/mobile', (req, res) => {
  hämtaPubData(req.params.pubId); // Säkerställ att puben skapas/laddas direkt
  res.sendFile(path.join(__dirname, 'test-mobile.html'));
});

app.get('/pub/:pubId/player', (req, res) => {
  hämtaPubData(req.params.pubId); // Säkerställ att puben skapas/laddas direkt
  res.sendFile(path.join(__dirname, 'test-player.html'));
});

// Skicka ut uppdaterat tillstånd till just den pubens gäster och spelare
function broadcastPubState(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;

  let gästLåtar = pub.queue.filter(l => !l.isRadio);
  let radioLåtar = pub.queue.filter(l => l.isRadio);
  let synligKö = [...gästLåtar, ...radioLåtar.slice(0, 2)];

  io.to(pubId).emit("state", {
    pubNamn: pub.config.namn,
    pris: pub.config.pris,
    swish: pub.config.swish,
    nowPlaying: pub.nowPlaying ? { title: pub.nowPlaying.title } : null,
    queue: synligKö
  });
}

async function fyllPåMedRadiolåt(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;
  const pool = pub.config.radioPool;
  const slumpadText = pool[Math.floor(Math.random() * pool.length)];
  
  try {
    const searchResult = await youTubeSearchApi.GetListByKeyword(slumpadText, false, 1);
    if (searchResult && searchResult.items.length > 0) {
      const item = searchResult.items[0];
      pub.queue.push({
        videoId: item.id,
        title: item.title,
        addedBy: "Radio 📻",
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
    console.log(`[${pub.config.namn}] Spelar nu: ${pub.nowPlaying.title}`);
    io.to(pubId).emit("player:change_track", { videoId: pub.nowPlaying.videoId });
  }

  let antalRadioIKön = pub.queue.filter(l => l.isRadio).length;
  if (antalRadioIKön < 2) {
    await fyllPåMedRadiolåt(pubId);
  }

  broadcastPubState(pubId);
}

// SOCKET.IO med rum-hantering (Rooms)
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

    pubar[pubId].queue.push({
      videoId: data.videoId,
      title: data.title,
      addedBy: "Gäst"
    });
    hanteraSpelning(pubId);
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

    console.log(`[${pubar[pubId].config.namn}] Låt skippad via player.`);
    pubar[pubId].nowPlaying = null;
    hanteraSpelning(pubId);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Multi-Jukebox Plattform rullar på port ${PORT}!`));