import json
import subprocess
import re

def search_youtube(query):
    cmd = [
        "yt-dlp",
        "ytsearch5:" + query,
        "--dump-json",
        "--no-playlist",
        "--no-warnings"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        entries = []
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                entries.append(json.loads(line))
        return entries
    except subprocess.CalledProcessError as e:
        print(f"Kunde inte söka på YouTube: {e}")
        return []

def is_live_version(title):
    # Kollar om titeln innehåller typiska ord för live-inspelningar
    live_keywords = ["live", "konsert", "concert", "tour", "live at", "in concert"]
    title_lower = title.lower()
    return any(keyword in title_lower for keyword in live_keywords)

def main():
    input_file = input("Ange namn på JSON-filen att laga (t.ex. alla_låtar.json): ").strip()
    
    try:
        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Hittade inte filen '{input_file}'.")
        return

    is_array = isinstance(data, list)
    items = enumerate(data) if is_array else data.items()

    fixed_count = 0
    skipped_count = 0

    print("\nStartar automatiskt sökning och matchning...")
    print("Regler: Väljer första icke-live-låten som är under 6 minuter.\n")

    for key, record in items:
        video_id = str(record.get("videoId", "")).strip()
        
        # Kolla om videoId saknas eller är ogiltigt
        if not video_id or len(video_id) != 11:
            artist = record.get("artist", "Okänd artist")
            title = record.get("title", "Okänd titel")
            query = f"{artist} - {title}"
            
            print(f"Letar ID för: {artist} - {title} ... ", end="")
            
            results = search_youtube(query)
            
            if not results:
                print("Inga träffar.")
                skipped_count += 1
                continue
                
            chosen_match = None
            
            # Gå igenom träffarna och leta efter en som passar våra regler
            for res in results:
                res_title = res.get("title", "")
                duration = res.get("duration", 0)
                
                # Regler: Ej live och max 6 minuter (360 sekunder)
                if not is_live_version(res_title) and duration and duration <= 360:
                    chosen_match = res
                    break
            
            # Om vi inte hittade någon som uppfyllde alla regler, ta den första som är under 6 minuter ändå (om den finns)
            if not chosen_match and results:
                for res in results:
                    duration = res.get("duration", 0)
                    if duration and duration <= 360:
                        chosen_match = res
                        break
            
            if chosen_match:
                record["videoId"] = chosen_match.get("id")
                if "duration" in chosen_match:
                    record["duration"] = round(chosen_match.get("duration"))
                
                fixed_count += 1
                print(f"Hittad! ({chosen_match.get('title')})")
            else:
                print("Ingen passande (för lång eller bara live). Hoppar över.")
                skipped_count += 1

    output_file = input_file.replace(".json", "_fixed.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    print("\n" + "="*60)
    print(f"Klar!")
    print(f" - Automatiskt matchade och lagade: {fixed_count} låtar")
    print(f" - Hoppades över / Inga träffar: {skipped_count} låtar")
    print(f"Det nya resultatet har sparats till: {output_file}")

if __name__ == "__main__":
    main()