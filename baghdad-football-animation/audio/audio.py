# Score + sound effects: Baghdad Street Football. Hijaz-flavoured oud tune over a maqsum darbuka groove.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audiolib import *

B = beats(); cue = B['cues']; D = B['duration']
mx = Mix(D)

# ---------------- music: D hijaz, 120 bpm ----------------
bt = 0.5
hij = [62, 63, 66, 67, 69, 70, 72, 74]            # D Eb F# G A Bb C D
mx.pads([(0.0, 4.5, 62, 'M'), (4.5, 4.0, 67, 'm'), (8.5, 2.5, 62, 'M'), (11.0, 4.0, 62, 'M')], 0.18, cut=1200)
# darbuka maqsum: doum tek . tek doum . tek .   (8 eighths per bar)
pat = ['D', 'T', None, 'T', 'D', None, 'T', None]
for i in range(int(D / (bt / 2))):
    t = 0.25 + i * bt / 2; s = pat[i % 8]
    if t > D - 0.6: break
    if 8.75 < t < 9.4: continue                     # hold the breath before the goal
    if s == 'D': mx.music(t, kick(0.7), 0.7)
    elif s == 'T': mx.music(t, clap(0.35), 0.3, 0.15); mx.music(t, hat(0.6), 0.4, 0.15)
    else: mx.music(t, hat(0.25), 0.25, -0.2)
mel = [0, 2, 1, 2, 3, 2, 1, 0,  4, 3, 2, 3, 4, 5, 4, 3,  2, 3, 4, 5, 6, 5, 4, 2,  4, 4, 3, 2, 1, 2, 0, 0]
for i, n in enumerate(mel):
    t = 0.25 + i * bt / 2 * 1.0
    if t < 8.7: mx.music(t, pluck(mf(hij[n]), 0.6, 1.2), 0.38, 0.2 if i % 2 else -0.1)
for k in range(4): mx.music(cue['kick'] - 0.5 + k * 0.1, pluck(mf(hij[k + 3]), 0.4), 0.3)   # rising run into the kick
# victory phrase after the goal
win = [(0, 7, 0.5), (0.5, 6, 0.25), (0.75, 5, 0.25), (1.0, 6, 0.5), (1.5, 4, 0.5), (2.0, 7, 1.0), (3.0, 4, 0.25), (3.25, 5, 0.25), (3.5, 6, 0.5), (4.0, 7, 1.5)]
for dt, n, d in win:
    mx.music(cue['goal'] + 0.3 + dt, lead(mf(hij[n]), d + 0.1), 0.42)
    mx.music(cue['goal'] + 0.3 + dt, pluck(mf(hij[n] - 12), 0.5), 0.3)
mx.music(cue['end-text'], bell(mf(74), 3.0), 0.35); mx.music(cue['end-text'] + 0.1, bell(mf(81), 3.0), 0.25)

# ---------------- street ambience + sound effects ----------------
mx.bed(0, D, room, 0.7, fi=0.5, fo=1.0)
mx.bed(0, D, wind, 0.25)
for k in range(5): mx.sfx(0.6 + k * 2.6 + rng.uniform(0, 0.8), chirp(0.35), 1, rng.uniform(-0.8, 0.8))
for tk in [cue['pass1'], cue['pass2'], cue['pass3'], cue['pass4']]:
    mx.sfx(tk, thud(0.6, 90, 0.25), 1, 0.1); mx.sfx(tk, click(0.4), 1, 0.1)
for tr in [cue['pass1'] + 0.7, cue['pass2'] + 0.7, cue['pass3'] + 0.7, cue['receive']]: mx.sfx(tr, thud(0.35, 110, 0.2), 1, -0.1)
mx.steps(cue['run-start'] + 0.3, 8.6, 0.24, 'stone', 0.32, -0.1)
for i in range(7): mx.sfx(5.5 + i * 0.45, thud(0.25, 120, 0.15), 1, 0)   # dribble touches
mx.steps(5.6, 10.8, 0.27, 'stone', 0.18, 0.3)
mx.sfx(cue['kick'] - 0.1, whoosh(0.35, True, 0.4), 1, 0)
mx.sfx(cue['kick'], thud(1.0, 70, 0.35), 1, 0); mx.sfx(cue['kick'], pop(0.5), 1, 0, 0.3)
mx.sfx(cue['dive'], whoosh(0.4, False, 0.35), 1, -0.4); mx.sfx(cue['dive'] + 0.4, thud(0.7, 60, 0.5), 1, -0.4)
mx.sfx(cue['ball-bounce'], boing(200, 0.45), 1, 0.3)
for j, dt in enumerate([0.35, 0.62, 0.82]): mx.sfx(cue['ball-bounce'] + dt, thud(0.3 - j * 0.07, 130, 0.15), 1, 0.3)
mx.sfx(cue['goal'] + 0.05, whistle(mf(98), 0.35), 0.8, 0.0, 0.3); mx.sfx(cue['goal'] + 0.5, whistle(mf(98), 0.7), 0.8, 0.0, 0.3)
for i in range(16): mx.sfx(cue['cheer'] + i * 0.28 + rng.uniform(-0.03, 0.03), clap(0.5), 1, rng.uniform(-0.5, 0.5), 0.2)
mx.sfx(cue['cheer'], shimmer(2.0, 0.4), 1, 0, 0.4)
for k in range(5): mx.sfx(cue['cheer'] + 0.2 + k * 0.53, step('stone', 0.4), 1, -0.15); mx.sfx(cue['cheer'] + 0.7 + k * 0.48, step('stone', 0.35), 1, 0.2)

mx.write(sys.argv[1] if len(sys.argv) > 1 else 'build/audio.wav', fade_out=0.9)
