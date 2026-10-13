"""Builds walkthrough.mp4 from recorded frames, per-phrase narration WAVs and burned-in captions.
Usage: VIDEO_SRC=<dir with script.json, rec-log.json, frames/, vo/> python3 video/compose.py"""
import json, os, subprocess
SRC = os.environ.get("VIDEO_SRC", "video/build")
OUT = os.environ.get("OUT_DIR", "video")
FONTS = os.environ.get("FONTS_DIR", os.path.join(SRC, "fonts"))
script = {s["id"]: s for s in json.load(open(f"{SRC}/script.json"))}
log = json.load(open(f"{SRC}/rec-log.json"))
t0 = log["scenes"][0]["t"]
frames = log["frames"]
first = max(i for i, f in enumerate(frames) if f["t"] <= t0) if frames[0]["t"] <= t0 else 0
frames = frames[first:]
with open(f"{SRC}/concat.txt", "w") as c:
    for i, f in enumerate(frames):
        start = max(f["t"], t0)
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else log["end"]
        c.write(f"file 'frames/{f['f']}'\nduration {max(nxt - start, 1) / 1000:.3f}\n")
    c.write(f"file 'frames/{frames[-1]['f']}'\n")
total = (log["end"] - t0) / 1000

def ts(s):
    h, m = int(s // 3600), int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"
def srt(s):
    ms = int(round(s * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

cues, delays = [], []
for sc in log["scenes"]:
    s = script[sc["id"]]; base = (sc["t"] - t0) / 1000
    for i, ph in enumerate(s["phrases"]):
        st = base + ph["start"]
        en = base + (s["phrases"][i + 1]["start"] if i + 1 < len(s["phrases"]) else s["dur"] + 0.25)
        cues.append((st, en, ph["cap"])); delays.append((ph["wav"], st))
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "",
       "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Cap,Rethink Sans Medium,46,&H00EEF1F2,&H00EEF1F2,&H00221F1F,&H00221F1F,0,0,0,0,100,100,0,0,1,0,0,2,60,60,46,1", "",
       "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
ass += [f"Dialogue: 0,{ts(a)},{ts(b)},Cap,,0,0,0,,{t}" for a, b, t in cues]
open(f"{SRC}/captions.ass", "w").write("\n".join(ass) + "\n")
open(f"{OUT}/walkthrough.srt", "w").write("".join(f"{i + 1}\n{srt(a)} --> {srt(b)}\n{t}\n\n" for i, (a, b, t) in enumerate(cues)))

inputs = sum((["-i", f"{SRC}/{w}"] for w, _ in delays), [])
mix = ";".join(f"[{i}:a]adelay={int(st * 1000)}:all=1[a{i}]" for i, (_, st) in enumerate(delays))
mix += ";" + "".join(f"[a{i}]" for i in range(len(delays))) + f"amix=inputs={len(delays)}:normalize=0,apad,atrim=0:{total:.3f}[out]"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", mix, "-map", "[out]", "-ar", "48000", "-ac", "2", f"{SRC}/narration.wav"], check=True)
vf = f"scale=1632:918:flags=lanczos,pad=1920:1080:144:14:color=0x1F2022,ass={SRC}/captions.ass:fontsdir={FONTS},format=yuv420p"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{SRC}/concat.txt", "-i", f"{SRC}/narration.wav",
                "-vf", vf, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-c:a", "aac", "-b:a", "160k", "-shortest",
                "-map_metadata", "-1", "-metadata", "title=Forecast Evidence Workbench walkthrough", "-metadata", "artist=Ayo Ahmed", f"{OUT}/walkthrough.mp4"], check=True)
print(f"duration {total:.1f}s, {len(cues)} captions, {len(frames)} frames")
