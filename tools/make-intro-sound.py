"""Makes the sound for the 4-second logo intro. Every sound is generated here from scratch
(no downloaded or licensed audio), so it is free to use anywhere.
Run:  python3 tools/make-intro-sound.py scenes/03-tawassl-logo-reveal/sound.wav
The timings match the animation: rise 0.15-2.3 s, light sweep 2.2-3.25 s, name at 2.65 s.
"""
import sys, wave
import numpy as np

RATE, LENGTH = 48000, 4.0
n = int(RATE * LENGTH)
t = np.arange(n) / RATE
rng = np.random.default_rng(3)

def noise_band(low, high):
    """Hiss limited to a range of pitches (low..high in Hz)."""
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= np.exp(-0.5 * ((np.log(freqs + 1) - np.log((low * high) ** 0.5)) / (np.log(high / low) / 2.5)) ** 2)
    out = np.fft.irfft(spectrum, n)
    return out / np.abs(out).max()

def bump(start, peak, end):
    """Volume shape: silent, swells to a peak, fades away."""
    up = np.clip((t - start) / (peak - start), 0, 1) ** 2
    down = np.clip((end - t) / (end - peak), 0, 1) ** 1.5
    return np.where(t < peak, up, down)

def hit(at, decay):
    return np.where(t >= at, np.exp(-(t - at) / decay), 0.0)

left = np.zeros(n); right = np.zeros(n)
def add(sound, pan=0.0):  # pan: -1 = left, +1 = right (may change over time)
    global left, right
    left += sound * np.sqrt((1 - pan) / 2); right += sound * np.sqrt((1 + pan) / 2)

# 1. Rising out of darkness: a deep hum that swells and climbs in pitch, with a dark airy rumble
pitch = 42 + 30 * np.clip(t / 2.3, 0, 1) ** 2
hum = np.sin(2 * np.pi * np.cumsum(pitch) / RATE)
hum += 0.35 * np.sin(2 * np.pi * np.cumsum(pitch * 2.01) / RATE)
add(0.42 * hum * bump(0.05, 2.25, 2.6))
add(0.30 * noise_band(60, 260) * bump(0.1, 2.2, 2.7))

# 2. The turn: a whoosh of air that rises as the logo swings round to face the camera
add(0.34 * noise_band(300, 1400) * bump(0.9, 2.15, 2.45), pan=-0.5 + np.clip((t - 0.9) / 1.4, 0, 1))
add(0.22 * noise_band(1200, 5000) * bump(1.5, 2.22, 2.4), pan=-0.3 + 0.6 * np.clip((t - 1.5) / 0.8, 0, 1))

# 3. Landing: a soft deep thump as it settles facing the camera
drop = 95 * np.exp(-(np.clip(t - 2.3, 0, None)) / 0.09) + 46
add(0.85 * np.sin(2 * np.pi * np.cumsum(np.where(t >= 2.3, drop, 0)) / RATE) * hit(2.3, 0.38))
add(0.25 * noise_band(80, 700) * hit(2.3, 0.12))

# 4. The light sweep: a bright shimmer gliding from left to right
glide = np.clip((t - 2.2) / 1.05, 0, 1)
add(0.20 * noise_band(4500, 13000) * bump(2.2, 2.75, 3.4), pan=-0.8 + 1.6 * glide)
for f in (2093, 3136, 4186):
    add(0.035 * np.sin(2 * np.pi * f * t + 3 * np.sin(2 * np.pi * 5 * t)) * bump(2.25, 2.8, 3.5), pan=-0.6 + 1.2 * glide)

# 5. The channel name appears: a gentle warm chime (a D major chord)
for f, level, delay in ((293.66, 0.16, 0.0), (440.0, 0.13, 0.03), (587.33, 0.14, 0.06), (880.0, 0.08, 0.09), (1174.66, 0.05, 0.12)):
    at = 2.68 + delay
    tone = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2.76 * t) * hit(at, 0.15)
    add(level * tone * hit(at, 0.75) * np.clip((t - at) / 0.006, 0, 1))

# Finish: fade out the last moments, keep clear of distortion, and save
stereo = np.stack([left, right], axis=1)
stereo *= np.clip((LENGTH - t) / 0.35, 0, 1)[:, None] * np.clip(t / 0.02, 0, 1)[:, None]
stereo *= 0.89 / np.abs(stereo).max()
with wave.open(sys.argv[1], 'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(RATE)
    f.writeframes((stereo * 32767).astype('<i2').tobytes())
print('saved', sys.argv[1], 'peak', round(float(np.abs(stereo).max()), 3))
for a, b in ((0, 1), (1, 2), (2, 2.6), (2.6, 3.3), (3.3, 4)):
    part = stereo[int(a * RATE):int(b * RATE)]
    print(f'  loudness {a}-{b}s: {20 * np.log10(np.sqrt((part ** 2).mean()) + 1e-9):.1f} dB')
