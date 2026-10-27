
import json, subprocess, sys, tempfile, os, glob
from PIL import Image, ImageChops, ImageStat
exp = json.load(open('test/out/export.json'))
rep = json.load(open(exp['outDir'] + '/rapport.json'))
video = exp['video']
ok_all = True
for n in rep['notes']:
    N = n['frame']
    raw = Image.open(exp['outDir'] + '/' + n['images']['raw']).convert('RGB').resize((480, 270))
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf', 'select=between(n\\,%d\\,%d),scale=480:270' % (N - 2, N + 2), '-fps_mode', 'passthrough', '-frames:v', '5', os.path.join(d, 'f%d.png')], check=True)
        files = sorted(glob.glob(os.path.join(d, 'f*.png')), key=lambda p: int(os.path.basename(p)[1:-4]))
        diffs = {N - 2 + i: sum(ImageStat.Stat(ImageChops.difference(raw, Image.open(p).convert('RGB'))).mean) / 3 for i, p in enumerate(files)}
    best = min(diffs, key=diffs.get)
    ok = diffs[N] <= diffs[best] + 0.05
    ok_all &= ok
    distinct = max(diffs.values()) - min(diffs.values()) > 0.5
    print('commentaire', n['number'], '· image', N, '· meilleure image ffmpeg', best, '·', 'OK' if ok else 'ÉCHEC', '(images voisines différentes)' if distinct else '(plan fixe)', {k: round(v, 2) for k, v in diffs.items()})
sys.exit(0 if ok_all else 1)

