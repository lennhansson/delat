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

function broadcastPubState(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;

  io.to(pubId).emit("state", {
    pubNamn: pub.config.namn,
    aktivtValv: pub.config.aktivtValv || "Standard Rock",
    qrKrav: pub.config.qrKrav,
    låtarPerBiljett: pub.config.låtarPerBiljett,
    valvLista: Object.keys(pub.config.valv || {}),
    nowPlaying: pub.nowPlaying ? { title: pub.nowPlaying.title } : null,
    fullQueue: pub.queue
  });
}

async function fyllPåMedRadiolåt(pubId) {
  const pub = pubar[pubId];
  if (!pub) return;
  const pool = pub.config.valv[pub.config.aktivtValv] || [];
  if (pool.length === 0) return;
  const slumpadText = pool[Math.floor(Math.random() * pool.length)];
  try {
    const searchResult = await youTubeSearchApi.GetListByKeyword(slumpadText, false, 1);
    if (searchResult && searchResult.items.length > 0) {
      pub.queue.push({
        id: Math.random().toString(36).substr(2, 9),
        videoId: searchResult.items[0].id,
        title: searchResult.items[0].title,
        addedBy: "Radio",
        isRadio: true
      });
    }
  } catch (err) {
    console.error("Fel vid hämtning av radiolåt:", err);
  }
}

async function hanteraSpelning(pubId) {
  const pub = hämtaPubData(pubId);

  // 1. Om ingenting spelas just nu, leta efter nästa låt
  if (!pub.nowPlaying) {
    // Leta först efter en gästlåt (dvs där isRadio INTE är sant)
    let nastaLatIndex = pub.queue.findIndex(l => !l.isRadio);
    
    // Om det inte fanns några gästlåtar, ta den första radiolåten i listan istället
    if (nastaLatIndex === -1 && pub.queue.length > 0) {
      nastaLatIndex = 0;
    }

    // Om vi hittade en låt (gäst eller radio), spela den!
    if (nastaLatIndex !== -1) {
      pub.nowPlaying = pub.queue.splice(nastaLatIndex, 1)[0];
      io.to(pubId).emit("player:change_track", { videoId: pub.nowPlaying.videoId });
    }
  }

  // 2. Se till att det ALLTID finns minst 2 radiolåtar som ligger i slutet av kön i backup
  let antalRadioIKon = pub.queue.filter(l => l.isRadio).length;
  while (antalRadioIKon < 2) {
    await fyllPåMedRadiolåt(pubId);
    antalRadioIKon = pub.queue.filter(l => l.isRadio).length;
  }

  // Skicka uppdaterad status till alla skärmar
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
    } catch (err) {}
  });

  socket.on("addSong", (data) => {
    const pubId = socket.pubId;
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
        return socket.emit("kupong_error", { msg: `Denna biljett är redan förbrukad (${användaGånger}/${maxLåtar}).` });
      }

      const strängAttSignera = `${kupongId}-${maxLåtar}`;
      const förväntadMasterSig = crypto.createHmac('sha256', MASTER_SECRET).update(strängAttSignera).digest('hex').substr(0, 6).toUpperCase();

      if (inskickadSignatur !== förväntadMasterSig) {
        return socket.emit("kupong_error", { msg: "Ogiltig signatur! Felaktig biljett." });
      }

      // Godkänd kod! Öka räknaren
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
        isRadio: false // VIKTIGT: Sätts till false så att prioriteringen vet att det är en gäst
      };

      // HÄR SÄTTER VI PRIO: Hitta index för första radiolåten och skjut in gästlåten FÖRE den.
      const förstaRadioIndex = pub.queue.findIndex(l => l.isRadio);
      if (förstaRadioIndex !== -1) {
        pub.queue.splice(förstaRadioIndex, 0, nyGästLåt);
      } else {
        pub.queue.push(nyGästLåt);
      }

      socket.emit("kupong_success", { 
        msg: pub.config.qrKrav ? `Låt tillagd! Du har ${textKvar} låtar kvar på biljetten.` : "Låten har lagts till i kön!", 
        resterande: textKvar 
      });

      hanteraSpelning(pubId);
    }
  });

  socket.on("player:toggle_qr", (data) => {
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.qrKrav = data.qrKrav;
    fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2));
    broadcastPubState(socket.pubId);
  });

  socket.on("player:set_lator_per_biljett", (data) => {
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.låtarPerBiljett = parseInt(data.antal) || 1;
    fs.writeFileSync(path.join(DATA_DIR, `${socket.pubId}.json`), JSON.stringify(pubar[socket.pubId].config, null, 2));
    broadcastPubState(socket.pubId);
  });

  socket.on("player:skip", () => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].nowPlaying = null; 
    hanteraSpelning(socket.pubId); 
  });

  socket.on("player:remove_song", (data) => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => l.id !== data.id); 
    hanteraSpelning(socket.pubId); 
  });

  socket.on("player:byt_valv", (data) => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].config.aktivtValv = data.valvNamn; 
    pubar[socket.pubId].queue = pubar[socket.pubId].queue.filter(l => !l.isRadio); 
    hanteraSpelning(socket.pubId); 
  });

  socket.on("player:ready_for_next", () => { 
    if(!socket.pubId || !pubar[socket.pubId]) return;
    pubar[socket.pubId].nowPlaying = null; 
    hanteraSpelning(socket.pubId); 
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Jukebox rullar på port ${PORT}`));