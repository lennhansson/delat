import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path


YT_DLP = "yt-dlp"

FFMPEG = (
    r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages"
    r"\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffmpeg.exe"
)

FFPROBE = (
    r"C:\Users\lennh\AppData\Local\Microsoft\WinGet\Packages"
    r"\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-N-124716-g054dffd133-win64-gpl\bin\ffprobe.exe"
)


DB_THRESHOLD = -30.0
MIN_NON_SILENT_SEC = 0.5
WINDOW_SEC = 0.05
MARGIN_SEC = 12


def run_cmd(cmd, capture=True, timeout=180):
    try:
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            check=True,
            errors="replace",
            timeout=timeout,
        )
        return result.stdout, result.stderr, None

    except Exception as exc:
        return "", str(exc), exc


def fetch_audio_segment(
    video_id,
    start_offset=None,
    end_offset=None,
    total_duration=None,
    out_path=None,
):
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
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--extractor-args",
        "youtube:player_client=default,web_embedded",
        "--download-sections",
        section,
        "--no-check-certificates",
        "--ffmpeg-location",
        str(Path(FFMPEG).parent),
        "-o",
        downloaded_template,
        url,
    ]

    _, err, exc = run_cmd(cmd)

    if exc is not None:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False, out_path, f"yt-dlp misslyckades: {err}"

    candidates = [
        path
        for path in Path(temp_dir).glob("audio.*")
        if path.suffix.lower() == ".mp3"
    ]

    if not candidates:
        candidates = [
            path
            for path in Path(temp_dir).glob("audio.*")
            if path.is_file() and path.suffix != ".part"
        ]

    if not candidates:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return False, out_path, "yt-dlp skapade ingen ljudfil"

    source_path = candidates[0]

    ffmpeg_cmd = [
        FFMPEG,
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-c:a",
        "pcm_s16le",
        out_path,
    ]

    _, err2, exc2 = run_cmd(ffmpeg_cmd)

    shutil.rmtree(temp_dir, ignore_errors=True)

    if (
        exc2 is not None
        or not os.path.exists(out_path)
        or os.path.getsize(out_path) == 0
    ):
        return False, out_path, f"ffmpeg-konvertering misslyckades: {err2}"

    return True, out_path, ""


def compute_rms_db_from_file(wav_path):
    rms_values = []

    try:
        with wave.open(wav_path, "rb") as wav_file:
            frame_rate = wav_file.getframerate()
            sample_width = wav_file.getsampwidth()
            channels = wav_file.getnchannels()
            frame_count = wav_file.getnframes()
            frames = wav_file.readframes(frame_count)

        if sample_width != 2:
            raise ValueError(
                f"Förväntade 16-bitars ljud, fick {sample_width * 8} bitar"
            )

        raw_sample_count = len(frames) // 2
        data = struct.unpack(f"<{raw_sample_count}h", frames)

        if channels > 1:
            data = data[::channels]

        chunk_size = max(1, int(frame_rate * WINDOW_SEC))

        for index in range(0, len(data), chunk_size):
            chunk = data[index:index + chunk_size]

            if not chunk:
                continue

            sum_squares = sum(sample ** 2 for sample in chunk)
            rms = math.sqrt(sum_squares / len(chunk))

            if rms > 0:
                db = 20 * math.log10(rms / 32767.0)
            else:
                db = -100.0

            current_time = index / frame_rate
            rms_values.append((current_time, db))

    except Exception as exc:
        print(f"[VARNING] Kunde inte läsa WAV-fil: {exc}")

    return rms_values


def find_play_from(rms_series):
    non_silent_window = 0.0

    for time_position, rms_db in rms_series:
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC

            if non_silent_window >= MIN_NON_SILENT_SEC:
                return max(
                    0.0,
                    time_position - non_silent_window + WINDOW_SEC,
                )
        else:
            non_silent_window = 0.0

    return 0.0


def find_play_to(rms_series, duration_sec):
    non_silent_window = 0.0

    for time_position, rms_db in reversed(rms_series):
        if rms_db >= DB_THRESHOLD:
            non_silent_window += WINDOW_SEC

            if non_silent_window >= MIN_NON_SILENT_SEC:
                return min(
                    duration_sec,
                    time_position + non_silent_window,
                )
        else:
            non_silent_window = 0.0

    return duration_sec


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_already_analyzed(future):
    return (
        isinstance(future, list)
        and len(future) >= 2
        and is_number(future[0])
        and is_number(future[1])
    )


def ensure_future_list(record):
    future = record.get("future")

    if not isinstance(future, list):
        future = ["F2", "F3", "F4"]
        record["future"] = future

    while len(future) < 3:
        future.append("F4")

    return future


def remove_file(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def save_json_atomic(path, data):
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with temp_path.open("w", encoding="utf-8") as json_file:
        json.dump(
            data,
            json_file,
            ensure_ascii=False,
            indent=2,
        )

    temp_path.replace(path)


def analyze_record(key, record, json_path, data):
    future = ensure_future_list(record)

    video_id = record.get("videoId", "")
    duration = record.get("duration")
    artist = record.get("artist", "Okänd artist")
    title = record.get("title", "Okänd titel")

    if not video_id or not isinstance(duration, (int, float)) or duration <= 0:
        future[2] = "F4: ingen giltig videoId/duration"
        save_json_atomic(json_path, data)
        return False, f"{key}: saknar videoId eller giltig duration"

    path_start = None
    path_end = None

    try:
        ok_start, path_start, err_start = fetch_audio_segment(
            video_id=video_id,
            start_offset=None,
            total_duration=duration,
        )

        if not ok_start:
            future[2] = f"F4: kunde inte hämta startljud ({err_start})"
            save_json_atomic(json_path, data)
            return False, f"{key}: fel vid startljud – {err_start}"

        ok_end, path_end, err_end = fetch_audio_segment(
            video_id=video_id,
            end_offset=MARGIN_SEC,
            total_duration=duration,
        )

        if not ok_end:
            future[2] = f"F4: kunde inte hämta slutljud ({err_end})"
            save_json_atomic(json_path, data)
            return False, f"{key}: fel vid slutljud – {err_end}"

        rms_start = compute_rms_db_from_file(path_start)
        play_from = find_play_from(rms_start)

        rms_end = compute_rms_db_from_file(path_end)
        duration_end = len(rms_end) * WINDOW_SEC
        play_to_relative = find_play_to(rms_end, duration_end)

        play_to = max(
            0.0,
            min(
                duration,
                (duration - duration_end) + play_to_relative,
            ),
        )

        future[0] = round(play_from, 2)
        future[1] = round(play_to, 2)
        future[2] = "F4"

        save_json_atomic(json_path, data)

        note = ""

        if play_from > 0.05 or play_to < duration:
            note = (
                f" [TRIMMAD! start={play_from:.2f}s, "
                f"slut={play_to:.2f}s]"
            )

        message = (
            f"{key} – {artist} – {title}: "
            f"F2={play_from:.2f}, F3={play_to:.2f}{note}"
        )

        return True, message

    except Exception as exc:
        future[2] = f"F4: oväntat fel ({exc})"
        save_json_atomic(json_path, data)
        return False, f"{key}: oväntat fel – {exc}"

    finally:
        remove_file(path_start)
        remove_file(path_end)


def main():
    json_path_str = input(
        "Ange sökväg till JSON-filen att analysera: "
    ).strip()

    json_path = Path(json_path_str)

    if not json_path.exists():
        print(f"Filen '{json_path}' finns inte.")
        return

    try:
        with json_path.open("r", encoding="utf-8") as json_file:
            data = json.load(json_file)

    except json.JSONDecodeError as exc:
        print(f"JSON-filen kunde inte läsas: {exc}")
        return

    if not isinstance(data, dict):
        print("JSON-filen måste innehålla ett objekt med låtar.")
        return

    items = list(data.items())
    total = len(items)

    already_done = 0
    analyzed = 0
    errors = 0

    print(f"\nTotalt {total} låtar.\n")

    for index, (key, record) in enumerate(items, start=1):
        if not isinstance(record, dict):
            print(f"[{index}/{total}] {key}: ogiltig post – hoppas över")
            errors += 1
            continue

        future = ensure_future_list(record)

        # Hoppa över poster som redan har numeriska start- och sluttider.
        if is_already_analyzed(future):
            already_done += 1
            print(
                f"[{index}/{total}] {key} – redan klar "
                f"(F2={future[0]:.2f}, F3={future[1]:.2f})"
            )
            continue

        print(
            f"[{index}/{total}] "
            f"{key} – "
            f"{record.get('artist', 'Okänd artist')} – "
            f"{record.get('title', 'Okänd titel')} ..."
        )

        success, message = analyze_record(
            key=key,
            record=record,
            json_path=json_path,
            data=data,
        )

        if success:
            analyzed += 1
            print(f"  {message} → sparad.")
        else:
            errors += 1
            print(f"  FEL: {message}")

    print("\n" + "=" * 60)
    print("Klar!")
    print(f" - Redan klara: {already_done}")
    print(f" - Analyserade denna körning: {analyzed}")
    print(f" - Fel / överhoppade: {errors}")


if __name__ == "__main__":
    main()