// jukebox-player-logic.js
const fs = require('fs');
const path = require('path');
const youTubeSearchApi = require('youtube-search-api');

// Hjälpfunktion för att hämta en radiolåt från poolen
async function hämtaEnRadiolåt(pub) {
  const pool = pub.config.valv[pub.config.aktivtValv] || [];
  if (pool.length === 0) return null;
  const slumpadText = pool[Math.floor(Math.random() * pool.length)];
  try {
    const searchResult = await youTubeSearchApi.GetListByKeyword(slumpadText, false, 1);
    if (searchResult && searchResult.items.length > 0) {
      return {
        id: Math.random().toString(36).substr(2, 9),
        videoId: searchResult.items[0].id,
        title: searchResult.items[0].title,
        addedBy: "Radio",
        isRadio: true
      };
    }
  } catch (err) {
    console.error("Fel vid hämtning av radiolåt:", err);
  }
  return null;
}

// Den centrala motorn som styr kön och vad som ska spelas härnäst
async function hanteraSpelning(pubId, pubar, hämtaPubData, io) {
  const pub = hämtaPubData(pubId);
  if (!pub) return;

  // 1. Om ingenting spelas just nu, ta nästa låt från kön
  if (!pub.nowPlaying) {
    // Leta efter den första låten som skickats in av en GÄST (inte radio)
    let nastaLatIndex = pub.queue.findIndex(l => !l.isRadio);
    
    // Om det inte finns några gästlåtar, ta den första radiolåten istället
    if (nastaLatIndex === -1 && pub.queue.length > 0) {
      nastaLatIndex = 0;
    }

    // Om vi hittade en låt att spela
    if (nastaLatIndex !== -1) {
      pub.nowPlaying = pub.queue.splice(nastaLatIndex, 1)[0];
      io.to(pubId).emit("player:change_track", { videoId: pub.nowPlaying.videoId });
    }
  }

  // 2. Skicka ut det uppdaterade läget till alla spelare och mobiler
  io.to(pubId).emit("state", {
    pubNamn: pub.config.namn,
    aktivtValv: pub.config.aktivtValv || "Standard Rock",
    qrKrav: pub.config.qrKrav,
    låtarPerBiljett: pub.config.låtarPerBiljett,
    valvLista: Object.keys(pub.config.valv || {}),
    nowPlaying: pub.nowPlaying ? { title: pub.nowPlaying.title } : null,
    fullQueue: pub.queue
  });

  // 3. Se till att det ALLTID ligger minst 2 radiolåtar i slutet av kön
  let antalRadioIKon = pub.queue.filter(l => l.isRadio).length;
  if (antalRadioIKon < 2) {
    // Kör påfyllning i bakgrunden utan att blockera
    (async () => {
      while (pubar[pubId] && pub.queue.filter(l => l.isRadio).length < 2) {
        const nyRadioLat = await hämtaEnRadiolåt(pub);
        if (nyRadioLat) {
          pub.queue.push(nyRadioLat);
          // Skicka ut uppdaterad kö till gränssnittet
          io.to(pubId).emit("state", {
            pubNamn: pub.config.namn,
            aktivtValv: pub.config.aktivtValv || "Standard Rock",
            qrKrav: pub.config.qrKrav,
            låtarPerBiljett: pub.config.låtarPerBiljett,
            valvLista: Object.keys(pub.config.valv || {}),
            nowPlaying: pub.nowPlaying ? { title: pub.nowPlaying.title } : null,
            fullQueue: pub.queue
          });
        } else {
          break;
        }
      }
    })();
  }
}

module.exports = { hanteraSpelning };