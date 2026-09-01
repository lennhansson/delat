import json
import subprocess
import tempfile
import os
import wave
import struct
from pathlib import Path

YT_DLP = "yt-dlp"
FFMPEG = r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffmpeg.exe"
FFPROBE = r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffprobe.exe"

DB_THRESHOLD = -30.0      # Gräns för vad som räknas som ljud (t.ex. -30 dB)
MIN_NON_SILENT_SEC = 0.5  # Kräv minst 0.5 sekunder ljud för att trigga
WINDOW_SEC = 0.05         # Analysfönster: 50 ms
MARGIN_SEC = 12           # Hämta 12 sek i början och slutet

def run_cmd(cmd, capture=True, timeout=180):
    try:
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            check=True,
            errors="replace",
            timeout=timeout
        )
        return result.stdout, result.stderr, None
    except Exception as e:
        return "", str(e), e

def fetch_audio_segment(video_id, start_offset=None, end_offset=None, total_duration=None, out_path=None):
    url = f"https://www.youtube.com/watch?v={video_id}"

    if out_path is None:
        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

    temp_dir = tempfile.mkdtemp(prefix="yt_audio_")
    downloaded_template = os.path.join(temp_dir, "audio.%(ext)s")

    if end_offset is not None and total_duration is not None:
        start_sec = max(0, int(total_duration - end_offset))
        section = f"*{start_sec}-{int(total_duration)}"
    else:
        duration_sec = MARGIN_SEC if start_offset is None else start_offset
        section = f"*0-{int(duration_sec)}"

    cmd = [
        YT_DLP,
        "--no-playlist",
        "-f", "bestaudio/best",
        "--extract-audio",
        "--audio-format", "mp3",
        "--extractor-args", "youtube:player_client=default,web_embedded",
        "--download-sections", section,
        "--no-check-certificates",
        "--ffmpeg-location", str(Path(FFMPEG).parent),
        "-o", downloaded_template,
        url
    ]

    out, err, exc = run_cmd(cmd)
    if exc is not None:
        return False, out_path, f"yt-dlp misslyckades: {err}"

    candidates = [p for p in Path(temp_dir).glob("audio.*") if p.suffix.lower() == ".mp3"]
    if not candidates:
        candidates = [p for p in Path(temp_dir).glob("audio.*") if p.is_file() and p.suffix != ".part"]
    
    if not candidates:
        return False, out_path, "yt-dlp skapade ingen ljudfil"

    source_path = candidates[0]

    ffmpeg_cmd = [
        FFMPEG,
        "-y",
        "-i", str(source_path),
        "-vn",
        "-ac", "1",
        "-ar", "22050",
        "-c:a", "pcm_s16le",
        out_path
    ]

    _, err2, exc2 = run_cmd(ffmpeg_cmd)
    if exc2 is not None or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return False, out_path, f"ffmpeg konvertering misslyckades: {err2}"

    try:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass

    return True, out_path, ""

def compute_rms_db_from_file(wav_path):
    import math
    rms_values = []
    
    try:
        with wave.open(wav_path, 'rb') as wf:
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            frames = wf.readframes(n_frames)
            
            chunk_size = int(framerate * WINDOW_SEC)
            fmt = f"<{len(frames)//2}h"
            data = struct.unpack(fmt, frames)
            
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i + chunk_size]
                if not chunk:
                    break
                
                sum_squares = sum(val ** 2 for val in chunk)
                rms = math.sqrt(sum_squares / len(chunk))
                
                if rms > 0:
                    db = 20 * math.log10(rms / 32767.0)
                else:
                    db = -100.0
                    
                current_time = (i / framerate)
                rms_values.append((current_time, db))
    except Exception as e:
        print(f"[VARNING] Kunde inte läsa WAV-fil: {e}")

    return rms_values

def find_play_from(rms_series):
    non_silent_window = 0.0
    for t, rms_db in rms_series:
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC
            if non_silent_window >= MIN_NON_SILENT_SEC:
                return max(0.0, t - non_silent_window + WINDOW_SEC)
        else:
            non_silent_window = 0.0
    return 0.0

def find_play_to(rms_series, duration_sec):
    non_silent_window = 0.0
    for t, rms_db in reversed(rms_series):
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC
            if non_silent_window >= MIN_NON_SILENT_SEC:
                return min(duration_sec, t + non_silent_window)
        else:
            non_silent_window = 0.0
    return duration_sec

def save_json_atomic(path, data):
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)

def main():
    json_path_str = input("Ange sökväg till JSON-filen att analysera: ").strip()
    json_path = Path(json_path_str)

    if not json_path.exists():
        print(f"Filen '{json_path}' finns inte.")
        return

    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    items = list(data.items())
    total = len(items)
    already_done = 0
    analyzed = 0
    errors = 0

    print(f"Totalt {total} låtar.\n")

    for idx, (key, record) in enumerate(items, start=1):
        future = record.get("future", [])
        if not isinstance(future, list) or len(future) < 3:
            record["future"] = ["F2", "F3", "F4"]
            future = record["future"]

        f2 = future[0]
        f3 = future[1]
        
      #  if isinstance(f2, (int, float)) and isinstance(f3, (int, float)):
      #      already_done += 1
      #      continue

        video_id = record.get("videoId", "")
        duration = record.get("duration")
        artist = record.get("artist", "Okänd artist")
        title = record.get("title", "Okänd titel")

        if not video_id or duration is None or duration == 0:
            future[2] = "F4: ingen videoId/duration"
            save_json_atomic(json_path, data)
            errors += 1
            continue

        print(f"[{idx}/{total}] {key} – {artist} – {title} ... ", end="", flush=True)

        ok_start, path_start, err_start = fetch_audio_segment(video_id, start_offset=None, total_duration=duration)
        if not ok_start:
            future[2] = f"F4: kunde inte hämta startljud ({err_start})"
            save_json_atomic(json_path, data)
            errors += 1
            print(f"fel vid startljud: {err_start}")
            continue

        ok_end, path_end, err_end = fetch_audio_segment(video_id, end_offset=MARGIN_SEC, total_duration=duration)
        if not ok_end:
            for p in [path_start]:
                try: 
                    os.remove(p) 
                except: 
                    pass
            future[2] = f"F4: kunde inte hämta slutljud ({err_end})"
            save_json_atomic(json_path, data)
            errors += 1
            print(f"fel vid slutljud: {err_end}")
            continue

        rms_start = compute_rms_db_from_file(path_start)
        play_from = find_play_from(rms_start)

        rms_end = compute_rms_db_from_file(path_end)
        duration_end = len(rms_end) * WINDOW_SEC
        play_to_rel = find_play_to(rms_end, duration_end)
        play_to = max(0.0, min(duration, (duration - duration_end) + play_to_rel))

        for p in (path_start, path_end):
            try:
                os.remove(p)
            except Exception:
                pass

        future[0] = round(play_from, 2)
        future[1] = round(play_to, 2)
        future[2] = "F4"

        save_json_atomic(json_path, data)
        analyzed += 1
        
        note = ""
        if play_from > 0.05 or play_to < duration:
            note = f" [TRIMMAD! start={play_from:.2f}s, slut={play_to:.2f}s]"

        print(f"F2={future[0]:.2f}, F3={future[1]:.2f} → sparad.{note}")

    print("\n" + "=" * 60)
    print("Klar!")
    print(f" - Redan klara: {already_done}")
    print(f" - Analyserade denna körning: {analyzed}")
    print(f" - Fel / hoppar över: {errors}")

if __name__ == "__main__":
    main()