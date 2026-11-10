"""Renders the page's WebAudio chiptune (loop + sfx) to WAV files, same recipe."""
import sys, wave, numpy as np
SR = 22050; MASTER = 0.16; BEAT = 60 / 112
rng = np.random.default_rng(7)

def env(n, vol, dur):
    t = np.arange(n) / SR
    return vol * np.power(0.0001 / vol, np.minimum(t / dur, 1.0))

def osc(kind, f, n):
    ph = (np.arange(n) / SR * f) % 1.0
    if kind == 'square': return np.where(ph < 0.5, 1.0, -1.0)
    if kind == 'triangle': return 4 * np.abs(ph - 0.5) - 1
    return np.sin(2 * np.pi * ph)

def highpass(x, fc, q=1.0):
    w = 2 * np.pi * fc / SR; a = np.sin(w) / (2 * q); c = np.cos(w)
    b0, b1, b2, a0, a1, a2 = (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, v, y1, o; y[i] = o
    return y

def add(buf, at, sig):
    i = int(at * SR)
    if i >= len(buf): return
    end = min(len(buf), i + len(sig)); buf[i:end] += sig[:end - i]

def tone(buf, f, t, dur, kind, vol):
    n = int((dur + 0.05) * SR); add(buf, t, osc(kind, f, n) * env(n, vol, dur))

def noise(buf, t, dur, vol, hp):
    n = int((dur + 0.02) * SR); add(buf, t, highpass(rng.uniform(-1, 1, n), hp) * env(n, vol, dur))

def kick(buf, t):
    n = int(0.2 * SR); tt = np.arange(n) / SR
    f = 140 * np.power(42 / 140, np.minimum(tt / 0.12, 1.0))
    ph = 2 * np.pi * np.cumsum(f) / SR
    add(buf, t, np.sin(ph) * env(n, 0.55, 0.16))

def write(path, buf, loop=False):
    x = np.clip(buf * MASTER * 2.2, -1, 1)
    if not loop:
        nz = np.nonzero(np.abs(x) > 1e-4)[0]
        x = x[: (nz[-1] + 1 if len(nz) else 1)]
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())

out = sys.argv[1]
BASS = [[110, 110, 220, 110], [87.31, 87.31, 174.61, 87.31], [130.81, 130.81, 261.63, 130.81], [98, 98, 196, 98]]
step = BEAT / 2; n_steps = 32; length = n_steps * step
loop = np.zeros(int(length * SR) + int(0.3 * SR))
for i in range(n_steps):
    t = i * step; s = i % 8; bar = (i // 8) % 4
    if s in (0, 4) or (s == 3 and bar % 2): kick(loop, t)
    if s in (2, 6): noise(loop, t, 0.09, 0.2, 1800)
    noise(loop, t, 0.03, 0.05, 7000)
    if s % 2 == 0: tone(loop, BASS[bar][s // 2], t, 0.18, 'triangle', 0.32)
body = loop[: int(length * SR)].copy(); tail = loop[int(length * SR):]
body[: len(tail)] += tail  # wrap the ring-out so the loop is seamless
write(f'{out}/loop.wav', body, loop=True)
SEQ = {'done': [784, 1047], 'duet': [523, 659, 784, 1047], 'bug': [392, 311], 'ship': [523, 659, 784, 1047, 784, 1047], 'start': [440, 554, 659]}
for k, seq in SEQ.items():
    b = np.zeros(int(1.0 * SR))
    for i, f in enumerate(seq): tone(b, f, 0.01 + i * 0.07, 0.12, 'square', 0.1)
    write(f'{out}/{k}.wav', b)
b = np.zeros(int(1.0 * SR))
for i, f in enumerate([587, 880, 587, 880]): tone(b, f, 0.01 + i * 0.16 + (0.1 if i >= 2 else 0), 0.14, 'triangle', 0.16)
write(f'{out}/alert.wav', b)
b = np.zeros(int(1.5 * SR))
for _ in range(16): noise(b, rng.uniform(0, 1.2), 0.04, 0.12, 1500)
write(f'{out}/clap.wav', b)
