import json
import subprocess
import tempfile
import os
import math
from pathlib import Path

YT_DLP = "yt-dlp"
FFMPEG = r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffmpeg.exe"
FFPROBE = r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffprobe.exe"

DB_THRESHOLD = -45.0      # RMS-tröskel i dB
MIN_NON_SILENT_SEC = 0.4  # Kräv minst 0,4 sek av icke-tyst för att säga att musiken börjat/slutit
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
    except subprocess.CalledProcessError as e:
        return e.stdout or "", e.stderr or "", e
    except subprocess.TimeoutExpired as e:
        return e.stdout or "", e.stderr or "", e

def fetch_audio_segment(video_id, start_offset=None, end_offset=None, out_path=None):
    """
    Hämtar ett ljudsegment med yt-dlp och undviker postprocessing-fel genom 
    att använda tilläggsflaggor för nedladdning.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"

    if out_path is None:
        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

    temp_dir = tempfile.mkdtemp(prefix="yt_audio_")
    downloaded_template = os.path.join(temp_dir, "audio.%(ext)s")

    if end_offset is not None and start_offset is None:
        section = f"*-{int(end_offset)}-end"
    else:
        duration_sec = MARGIN_SEC if start_offset is None else start_offset
        section = f"*0:00-0:{int(duration_sec)}"

    cmd = [
        YT_DLP,
        "--no-playlist",
        "-f", "bestaudio/best",
        "--extractor-args", "youtube:player_client=android",
        "--download-sections", section,
        "--no-post-overwrites",
        "--no-check-certificates",
        "--ffmpeg-location", str(Path(FFMPEG).parent),
        "-o", downloaded_template,
        url
    ]

    try:
        out, err, exc = run_cmd(cmd)
        if exc is not None:
            return False, out_path, f"yt-dlp misslyckades: {err.strip()}"

        candidates = [
            p for p in Path(temp_dir).glob("audio.*")
            if p.is_file() and p.suffix.lower() != ".part"
        ]
        if not candidates:
            return False, out_path, "yt-dlp skapade ingen ljudfil"

        source_path = candidates[0]

        # Använd uttryckligen den fungerande ffmpeg-installationen för WAV.
        ffmpeg_cmd = [
            FFMPEG,
            "-y",
            "-i", str(source_path),
            "-vn",
            "-ac", "2",
            "-ar", "44100",
            "-c:a", "pcm_s16le",
            out_path
        ]

        out2, err2, exc2 = run_cmd(ffmpeg_cmd)
        if exc2 is not None:
            return False, out_path, f"ffmpeg misslyckades: {err2.strip()}"

        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            return False, out_path, "ffmpeg skapade ingen WAV-fil"

        return True, out_path, ""

    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass

def compute_rms_db_from_file(wav_path):
    window_ms = int(WINDOW_SEC * 1000)
    cmd = [
        FFMPEG,
        "-i", wav_path,
        "-af", f"astats=metadata=1:reset={window_ms}",
        "-f", "null",
        "-"
    ]
    _, stderr, exc = run_cmd(cmd, capture=True)
    if exc is not None:
        pass

    rms_values = []
    current_time = 0.0

    for line in stderr.splitlines():
        if "lavfi.astats.Overall.RMS_level" in line:
            parts = line.split("lavfi.astats.Overall.RMS_level:")
            if len(parts) < 2:
                continue
            val_part = parts[-1].strip()
            tokens = val_part.split()
            if not tokens:
                continue
            try:
                rms_db = float(tokens[0])
            except ValueError:
                continue
            rms_values.append((current_time, rms_db))
            current_time += WINDOW_SEC

    return rms_values

def find_play_from(rms_series, duration_sec):
    non_silent_window = 0.0
    for t, rms_db in rms_series:
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC
            if non_silent_window >= MIN_NON_SILENT_SEC:
                start_of_burst = t - non_silent_window + WINDOW_SEC
                return max(0.0, start_of_burst)
        else:
            non_silent_window = 0.0
    return 0.0

def find_play_to(rms_series, duration_sec):
    non_silent_window = 0.0
    last_time = duration_sec

    for t, rms_db in reversed(rms_series):
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC
            if non_silent_window >= MIN_NON_SILENT_SEC:
                end_of_burst = t + non_silent_window
                return min(duration_sec, end_of_burst)
        else:
            non_silent_window = 0.0

    return last_time

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

    print(f"FFmpeg:  {FFMPEG}")
    print(f"ffprobe: {FFPROBE}")
    print(f"yt-dlp:  {YT_DLP}")
    print("Läser in JSON...")
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
            errors += 1
            continue

        f2 = future[0]
        f3 = future[1]

        if isinstance(f2, (int, float)) and isinstance(f3, (int, float)):
            already_done += 1
            continue

        video_id = record.get("videoId", "")
        duration = record.get("duration")
        artist = record.get("artist", "Okänd artist")
        title = record.get("title", "Okänd titel")

        if not video_id or duration is None:
            future[2] = "F4: ingen videoId/duration"
            save_json_atomic(json_path, data)
            errors += 1
            print(f"[{idx}/{total}] {key} – {artist} – {title} → ingen videoId/duration, F4 satt.")
            continue

        print(f"[{idx}/{total}] {key} – {artist} – {title} ... ", end="", flush=True)

        ok_start, path_start, err_start = fetch_audio_segment(video_id, start_offset=None)
        if not ok_start:
            future[2] = f"F4: kunde inte hämta startljud ({err_start})"
            save_json_atomic(json_path, data)
            errors += 1
            print(f"fel vid startljud: {err_start}")
            continue

        ok_end, path_end, err_end = fetch_audio_segment(video_id, end_offset=MARGIN_SEC)
        if not ok_end:
            try:
                os.remove(path_start)
            except Exception:
                pass
            future[2] = f"F4: kunde inte hämta slutljud ({err_end})"
            save_json_atomic(json_path, data)
            errors += 1
            print(f"fel vid slutljud: {err_end}")
            continue

        rms_start = compute_rms_db_from_file(path_start)
        duration_start = len(rms_start) * WINDOW_SEC
        play_from = find_play_from(rms_start, duration_start)

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
        if isinstance(future[2], str) and future[2].startswith("F4:"):
            pass
        else:
            future[2] = "F4"

        save_json_atomic(json_path, data)
        analyzed += 1
        print(f"F2={future[0]:.2f}, F3={future[1]:.2f} → sparad.")

    print("\n" + "=" * 60)
    print("Klar!")
    print(f" - Redan klara (F2/F3 är tal): {already_done}")
    print(f" - Analyserade denna körning: {analyzed}")
    print(f" - Fel / hoppar över: {errors}")
    print(f"Resultatet har sparats löpande till: {json_path}")

if __name__ == "__main__":
    main()