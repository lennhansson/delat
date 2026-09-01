/*
 * check_songs.js
 * Starta med: node check_songs.js
 * Förutsätter: npm install express, samt yt-dlp och ffmpeg/ffprobe i PATH.
 */

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(ROOT, { index: false }));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    process.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Programmet '${command}' hittades inte i PATH.`));
      } else {
        reject(error);
      }
    });
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} avslutades med felkod ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

function validVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function youtubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normaliseFuture(value) {
  return Array.isArray(value) ? [...value].map(String) : [];
}

function replaceFutureTag(record, tag, replacement) {
  const future = normaliseFuture(record.future).filter((item) => !item.trim().startsWith(tag));
  if (replacement) future.push(replacement);
  record.future = future;
}

function setFailure(record, reason) {
  record.blocked = true;
  replaceFutureTag(record, 'F1', `F1: ${reason}`);
}

function clearFailure(record) {
  delete record.blocked;
  replaceFutureTag(record, 'F1', null);
}

function extractMetadataOutput(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const duration = Number(lines[0]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('yt-dlp returnerade ingen giltig duration.');
  }
  return Math.round(duration);
}

async function checkSong(record) {
  if (!record || typeof record !== 'object') throw new Error('Ogiltig låtpost.');
  const videoId = String(record.videoId || '').trim();

  if (!validVideoId(videoId)) {
    setFailure(record, 'saknar eller har ogiltigt videoId');
    return { record, ok: false, message: 'Saknar ett giltigt YouTube-videoId (11 tecken).' };
  }

  try {
    const { stdout } = await run('yt-dlp', [
      '--no-playlist', '--skip-download', '--no-warnings',
      '--print', '%(duration)s', youtubeUrl(videoId),
    ]);
    record.duration = extractMetadataOutput(stdout);
    clearFailure(record);
    return { record, ok: true, message: `Kontrollerad. Duration: ${record.duration} sekunder.` };
  } catch (error) {
    setFailure(record, 'blocked eller otillgänglig YouTube-länk');
    return { record, ok: false, message: error.message };
  }
}

function secondsToF3(seconds) {
  const wholeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}.${String(remainingSeconds).padStart(2, '0')}`;
}

function parseDuration(probeOutput) {
  const probe = JSON.parse(probeOutput);
  const duration = Number(probe?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Kunde inte läsa ljudfilens duration.');
  return duration;
}

function calculateTrim(silenceLog, duration) {
  const starts = [...silenceLog.matchAll(/silence_start:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...silenceLog.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  let start = 0;
  let end = duration;

  // En sammanhängande tystnad i början får som mest vara fem sekunder lång.
  if (starts.some((value) => value <= 0.15)) {
    const initialEnd = ends.find((value) => value > 0 && value <= 5.1);
    if (initialEnd !== undefined) start = initialEnd;
  }

  // En sammanhängande tystnad i slutet måste inledas inom de sista fem sekunderna.
  const finalStart = [...starts].reverse().find((value) => value >= Math.max(0, duration - 5.1));
  if (finalStart !== undefined && finalStart > start) end = finalStart;

  // Skydd mot olämpliga analysresultat.
  if (end - start < 1) {
    start = 0;
    end = duration;
  }
  return { start, end };
}

async function analyseTrim(record) {
  if (!record || typeof record !== 'object') throw new Error('Ogiltig låtpost.');
  const videoId = String(record.videoId || '').trim();
  if (!validVideoId(videoId)) {
    setFailure(record, 'saknar eller har ogiltigt videoId');
    return { record, ok: false, message: 'Trimningsanalys kan inte köras utan giltigt videoId.' };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-songs-'));
  try {
    const outputTemplate = path.join(workDir, 'audio.%(ext)s');
    await run('yt-dlp', [
      '--no-playlist', '-f', 'bestaudio', '--no-warnings', '--no-progress',
      '-o', outputTemplate, youtubeUrl(videoId),
    ]);

    const downloaded = (await fs.readdir(workDir))
      .map((name) => path.join(workDir, name))
      .find((file) => !file.endsWith('.part'));
    if (!downloaded) throw new Error('yt-dlp skapade ingen ljudfil.');

    const { stdout: probeOutput } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', downloaded,
    ]);
    const duration = parseDuration(probeOutput);

    const { stderr: silenceLog } = await run('ffmpeg', [
      '-hide_banner', '-i', downloaded,
      '-af', 'silencedetect=noise=-45dB:d=0.25', '-f', 'null', '-',
    ]);
    const trim = calculateTrim(silenceLog, duration);
    record.duration = Math.round(duration);
    replaceFutureTag(record, 'F3', `F3: ${secondsToF3(trim.start)}, ${secondsToF3(trim.end)}`);
    clearFailure(record);
    return {
      record,
      ok: true,
      message: `Trimning sparad: ${secondsToF3(trim.start)}, ${secondsToF3(trim.end)}.`,
    };
  } catch (error) {
    setFailure(record, 'ljudanalys misslyckades');
    return { record, ok: false, message: error.message };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

app.get('/', (_request, response) => response.sendFile(path.join(ROOT, 'check_songs.html')));
app.get('/check_songs-client.js', (_request, response) => {
  response.type('application/javascript').send(CLIENT_SCRIPT);
});

app.post('/api/check', async (request, response) => {
  try {
    response.json(await checkSong(request.body.record));
  } catch (error) {
    response.status(400).json({ ok: false, message: error.message });
  }
});

app.post('/api/trim', async (request, response) => {
  try {
    response.json(await analyseTrim(request.body.record));
  } catch (error) {
    response.status(400).json({ ok: false, message: error.message });
  }
});

const CLIENT_SCRIPT = String.raw`
(() => {
  const state = { entries: [], fileName: '', sourceWasArray: false, busy: false };
  const elements = {
    fileInput: document.getElementById('fileInput'), fileName: document.getElementById('fileName'),
    formatInfo: document.getElementById('formatInfo'), summary: document.getElementById('summary'),
    notice: document.getElementById('notice'), actions: document.getElementById('actionsPanel'),
    table: document.getElementById('tablePanel'), body: document.getElementById('songsBody'),
    toggleAll: document.getElementById('toggleAll'), search: document.getElementById('searchInput'),
    checkSelected: document.getElementById('checkSelected'), checkAll: document.getElementById('checkAll'),
    trimSelected: document.getElementById('trimSelected'), exportButton: document.getElementById('exportButton'),
  };

  function showNotice(message, type = '') {
    elements.notice.textContent = message;
    elements.notice.className = 'notice ' + type;
  }
  function f3Of(record) {
    return (Array.isArray(record.future) ? record.future : []).find((item) => String(item).trim().startsWith('F3')) || '—';
  }
  function createBadge(text, kind) {
    const badge = document.createElement('span');
    badge.className = 'badge ' + kind;
    badge.textContent = text;
    return badge;
  }
  function visibleEntries() {
    const filter = elements.search.value.trim().toLowerCase();
    if (!filter) return state.entries;
    return state.entries.filter(({ key, record }) => [key, record.artist, record.title, record.videoId].join(' ').toLowerCase().includes(filter));
  }
  function renderSummary() {
    const failed = state.entries.filter(({ record }) => record.blocked).length;
    const trimmed = state.entries.filter(({ record }) => f3Of(record) !== '—').length;
    const selected = state.entries.filter((entry) => entry.selected).length;
    const data = [[state.entries.length, 'Låtar'], [selected, 'Markerade'], [failed, 'Flaggade F1'], [trimmed, 'Har F3-trimning']];
    elements.summary.innerHTML = '';
    data.forEach(([value, label]) => { const box = document.createElement('div'); box.className = 'stat'; box.innerHTML = '<b>' + value + '</b><span>' + label + '</span>'; elements.summary.appendChild(box); });
  }
  function render() {
    elements.body.innerHTML = '';
    const entries = visibleEntries();
    entries.forEach((entry) => {
      const record = entry.record;
      const row = document.createElement('tr');
      const selectCell = document.createElement('td');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.selected;
      checkbox.addEventListener('change', () => { entry.selected = checkbox.checked; renderSummary(); });
      selectCell.appendChild(checkbox); row.appendChild(selectCell);
      const key = document.createElement('td'); key.textContent = entry.key; row.appendChild(key);
      const song = document.createElement('td'); song.className = 'song'; const title = document.createElement('b'); title.textContent = record.title || '(titel saknas)'; const artist = document.createElement('span'); artist.textContent = record.artist || '(artist saknas)'; song.append(title, artist); row.appendChild(song);
      const idCell = document.createElement('td'); const idInput = document.createElement('input'); idInput.className = 'id-input'; idInput.value = record.videoId || ''; idInput.placeholder = '11 tecken';
      idInput.addEventListener('change', () => { record.videoId = idInput.value.trim(); entry.status = 'Video-ID ändrat – spara filen när du är klar.'; renderSummary(); });
      idCell.appendChild(idInput); row.appendChild(idCell);
      const duration = document.createElement('td'); duration.textContent = Number.isFinite(Number(record.duration)) && Number(record.duration) > 0 ? Math.round(Number(record.duration)) + ' s' : '—'; row.appendChild(duration);
      const trim = document.createElement('td'); trim.textContent = f3Of(record); row.appendChild(trim);
      const status = document.createElement('td');
      if (record.blocked) status.appendChild(createBadge('F1 / blockerad', 'bad'));
      else if (entry.status) status.appendChild(createBadge(entry.status, 'neutral'));
      else if (record.duration > 0) status.appendChild(createBadge('Kontrollerad', 'ok'));
      else status.appendChild(createBadge('Ej kontrollerad', 'warn'));
      row.appendChild(status);
      const actions = document.createElement('td'); const link = document.createElement('a'); link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(record.videoId || ''); link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Öppna'; link.className = 'tiny'; actions.appendChild(link); row.appendChild(actions);
      elements.body.appendChild(row);
    });
    elements.toggleAll.checked = entries.length > 0 && entries.every((entry) => entry.selected);
    renderSummary();
  }
  function buttonsDisabled(disabled) {
    state.busy = disabled;
    [elements.checkSelected, elements.checkAll, elements.trimSelected, elements.exportButton].forEach((button) => { button.disabled = disabled; });
  }
  async function api(action, record) {
    const response = await fetch('/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Serverfel.');
    return result;
  }
  async function processEntries(action, entries) {
    if (!entries.length) { showNotice('Markera minst en låt först.', 'error'); return; }
    buttonsDisabled(true);
    let success = 0;
    let failed = 0;
    try {
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        showNotice((action === 'trim' ? 'Analyserar trimning' : 'Kontrollerar') + ' ' + (index + 1) + ' av ' + entries.length + ': ' + (entry.record.title || entry.key));
        try {
          const result = await api(action, entry.record);
          entry.record = result.record; entry.status = result.message;
          result.ok ? success++ : failed++;
        } catch (error) { entry.status = error.message; failed++; }
        render();
      }
      showNotice('Klart. Godkända: ' + success + '. Fel/flaggar: ' + failed + '.', failed ? 'error' : 'success');
    } finally { buttonsDisabled(false); render(); }
  }
  function exportFile() {
    const payload = state.sourceWasArray ? state.entries.map((entry) => entry.record) : Object.fromEntries(state.entries.map((entry) => [entry.key, entry.record]));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url;
    const originalName = state.fileName.replace(/\.json$/i, '') || 'songs'; anchor.download = originalName + '_checked.json'; anchor.click(); URL.revokeObjectURL(url);
    showNotice('Filen har exporterats som ' + anchor.download + '.', 'success');
  }
  elements.fileInput.addEventListener('change', async () => {
    const file = elements.fileInput.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const isArray = Array.isArray(data); const isObject = data && typeof data === 'object' && !isArray;
      if (!isArray && !isObject) throw new Error('JSON-roten måste vara en lista eller ett objekt med låtposter.');
      const source = isArray ? data.map((record, index) => [String(index), record]) : Object.entries(data);
      if (!source.every(([, record]) => record && typeof record === 'object' && !Array.isArray(record))) throw new Error('Varje låtpost måste vara ett JSON-objekt.');
      state.entries = source.map(([key, record]) => ({ key, record, selected: true, status: '' })); state.fileName = file.name; state.sourceWasArray = isArray;
      elements.fileName.textContent = file.name; elements.formatInfo.textContent = isArray ? '(lista)' : '(objekt med nycklar)';
      [elements.summary, elements.actions, elements.table].forEach((element) => element.classList.remove('hidden'));
      showNotice('Låtlistan har lästs in. Kontrollera markerade låtar eller korrigera video-ID manuellt.'); render();
    } catch (error) { showNotice('Kunde inte läsa JSON-filen: ' + error.message, 'error'); }
  });
  elements.search.addEventListener('input', render);
  elements.toggleAll.addEventListener('change', () => { visibleEntries().forEach((entry) => { entry.selected = elements.toggleAll.checked; }); render(); });
  elements.checkSelected.addEventListener('click', () => processEntries('check', state.entries.filter((entry) => entry.selected)));
  elements.checkAll.addEventListener('click', () => processEntries('check', state.entries));
  elements.trimSelected.addEventListener('click', () => processEntries('trim', state.entries.filter((entry) => entry.selected)));
  elements.exportButton.addEventListener('click', exportFile);
})();
`;

app.listen(PORT, () => {
  console.log(`check_songs kör på http://localhost:${PORT}`);
  console.log('Öppna adressen i en webbläsare och välj en JSON-låtlista.');
});
