"""Narration: one WAV per caption phrase, rendered locally with the free Piper TTS (en_GB-alba-medium voice). Usage: VIDEO_SRC=video/build PIPER_VOICE=<path to .onnx> python3 video/gen_vo.py (copy video/script.json into VIDEO_SRC first)."""
# One WAV per caption phrase (Piper, local, free). Scene VO = phrases joined with short gaps.
import json, subprocess, os
os.chdir(os.environ.get('VIDEO_SRC', 'video/build'))
GAP = 0.18
s = json.load(open('script.json'))
tot = 0
for x in s:
    caps = x['cap']; says = x.get('says') or caps
    x['phrases'] = []; t = 0.0; parts = []
    for i, (cap, say) in enumerate(zip(caps, says)):
        raw = f"vo/{x['id']}-{i}-raw.wav"; out = f"vo/{x['id']}-{i}.wav"
        subprocess.run(['python3', '-m', 'piper', '-m', os.environ['PIPER_VOICE'], '--length-scale', '0.95', '-f', raw], input=say.encode(), check=True, capture_output=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '48000', '-ac', '1', out], check=True)
        d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]))
        x['phrases'].append({'cap': cap, 'wav': out, 'start': round(t, 3), 'dur': round(d, 3)})
        t += d + GAP
    x['dur'] = round(t - GAP, 3); tot += x['dur'] + 0.25
    print(x['id'], x['dur'])
json.dump(s, open('script.json', 'w'), indent=1)
print('total', round(tot, 1))
