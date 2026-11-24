"""Real-ESRGAN compact (realesr-general-x4v3) on the CPU with onnxruntime: the VM has no GPU, and the ncnn
binary on its software Vulkan (llvmpipe) took 122 s for a 320x350 crop (2026-11-24). Same contract as the
realesrgan-ncnn-vulkan wrapper the photo path calls: `-i in.png -o out.png [-s 4]`; always ×4 (the model's
native scale), the caller resizes. Tiled so memory stays flat on any input.

Usage: python esrgan_onnx.py -i in.png -o out.png [-s 4] [-m model.onnx] [-t 256] [-j threads]
The model is exported from the official .pth by export_compact_onnx.py.
"""
import argparse, os, sys
import numpy as np
from PIL import Image
import onnxruntime as ort

ap = argparse.ArgumentParser()
ap.add_argument('-i', required=True); ap.add_argument('-o', required=True)
ap.add_argument('-s', type=int, default=4); ap.add_argument('-n', default='')  # -n accepted and ignored (the ncnn flags)
ap.add_argument('-m', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'realesr-general-x4v3.onnx'))
ap.add_argument('-t', type=int, default=256); ap.add_argument('-j', type=int, default=int(os.environ.get('ESRGAN_THREADS', '1')))
a = ap.parse_args()
SCALE, PAD = 4, 10

opts = ort.SessionOptions()
opts.intra_op_num_threads = max(1, a.j); opts.inter_op_num_threads = 1
opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
sess = ort.InferenceSession(a.m, opts, providers=['CPUExecutionProvider'])

img = np.asarray(Image.open(a.i).convert('RGB'), dtype=np.float32) / 255.0
h, w, _ = img.shape
x = img.transpose(2, 0, 1)[None]
out = np.zeros((3, h * SCALE, w * SCALE), dtype=np.float32)
t = max(32, a.t)
for y0 in range(0, h, t):
    for x0 in range(0, w, t):
        y1, x1 = min(h, y0 + t), min(w, x0 + t)
        py0, px0, py1, px1 = max(0, y0 - PAD), max(0, x0 - PAD), min(h, y1 + PAD), min(w, x1 + PAD)
        r = sess.run(None, {'input': np.ascontiguousarray(x[:, :, py0:py1, px0:px1])})[0][0]
        oy, ox = (y0 - py0) * SCALE, (x0 - px0) * SCALE
        out[:, y0 * SCALE:y1 * SCALE, x0 * SCALE:x1 * SCALE] = r[:, oy:oy + (y1 - y0) * SCALE, ox:ox + (x1 - x0) * SCALE]
res = (np.clip(out.transpose(1, 2, 0), 0, 1) * 255.0 + 0.5).astype(np.uint8)
im = Image.fromarray(res)
if a.s != SCALE:
    im = im.resize((w * a.s, h * a.s), Image.LANCZOS)
im.save(a.o)
