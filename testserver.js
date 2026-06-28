const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');
const fs = require('fs');

// Läs in radiolåtarna
let radioPool = [];
try {
  radioPool = JSON.parse(fs.readFileSync(path.join(__dirname, 'radio.json'), 'utf8'));
  console.log(`Radio-pool laddad med ${radioPool.length} låtar.`);
} catch (err) {
  console.error("Kunde inte ladda radio.json.", err);
  radioPool = ["Rick Astley - Never Gonna Give You Up", "Metallica - Enter Sandman"];
}

// Servera filer
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, 'test-mobile.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'test-player.html')));

let queue = [];
let nowPlaying = null;

function broadcastState() {
  let gästLåtar = queue.filter(l => !l.isRadio);
  let radioLåtar = queue.filter(l => l.isRadio);
  let synligKö = [...gästLåtar, ...radioLåtar.slice(0, 2)];

  io.emit("state", {
    version: "7-an v2.0",
    user: { credits: 99 },
    nowPlaying: nowPlaying ? {
      title: nowPlaying.title,
      thumbnail: nowPlaying.thumbnail,
      votes: { up: 0, down: 0 },
      volVotes: { up: 0, down: 0, good: 0 }
    } : null,
    queue: synligKö,
    config: { lyricsEnabled: false, currentVol: 0.7, activeUsersList: [] }
  });
}

async function fyllPåMedRadiolåt() {
  const slumpadText = radioPool[Math.floor(Math.random() * radioPool.length)];
  try {
    const searchResult = await youTubeSearchApi.GetListByKeyword(slumpadText, false, 1);
    if (searchResult && searchResult.items.length > 0) {
      const item = searchResult.items[0];
      queue.push({
        videoId: item.id,
        title: item.title,
        thumbnail: item.thumbnail?.thumbnails[0]?.url || `https://img.youtube.com/vi/${item.id}/0.jpg`,
        addedBy: "Radio 📻",
        isRadio: true
      });
    }
  } catch (err) {
    console.error("[RADIO] Sökningsfel:", err);
  }
}

async function hanteraSpelning() {
  if (queue.length === 0) {
    await fyllPåMedRadiolåt();
  }

  if (!nowPlaying && queue.length > 0) {
    let nastaLatIndex = queue.findIndex(l => !l.isRadio);
    if (nastaLatIndex === -1) nastaLatIndex = 0;

    nowPlaying = queue.splice(nastaLatIndex, 1)[0];
    console.log(`[7-an] Spelar: ${nowPlaying.title}`);
    io.emit("player:change_track", { videoId: nowPlaying.videoId });
  }

  let antalRadioIKön = queue.filter(l => l.isRadio).length;
  if (antalRadioIKön < 2) {
    await fyllPåMedRadiolåt();
  }

  broadcastState();
}

io.on('connection', (socket) => {
  hanteraSpelning();

  socket.on("search", async (data) => {
    try {
      const searchResult = await youTubeSearchApi.GetListByKeyword(data.query, false, 8);
      const results = searchResult.items.map(item => ({
        videoId: item.id,
        title: item.title,
        thumbnail: item.thumbnail?.thumbnails[0]?.url || `https://img.youtube.com/vi/${item.id}/0.jpg`
      }));
      socket.emit("searchResults", { results, append: false });
    } catch (err) {
      console.error("Sökningsfel:", err);
    }
  });

  socket.on("addSong", (data) => {
    queue.push({
      videoId: data.videoId,
      title: data.title,
      thumbnail: data.thumbnail,
      addedBy: "Gäst"
    });
    hanteraSpelning();
  });

  socket.on("player:ready_for_next", () => {
    nowPlaying = null;
    hanteraSpelning();
  });

  // NYTT EVENT: När någon klickar på SKIP i spelaren
  socket.on("player:skip", () => {
    console.log("[7-an] Låt skippad av baren.");
    nowPlaying = null;
    hanteraSpelning();
  });
});

const PORT = 3000;
http.listen(PORT, () => console.log(`7-an Jukebox är igång på port ${PORT}!`));