"""Verify display codec and benchmark against a real lossless camera frame."""
import ctypes
import importlib.util
import json
import statistics
import struct
import sys
import time
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace
from camera_encoding import DisplayJpeg, fast_png, rgb_pixels

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / 'runtime/ros2-jazzy/.pixi/envs/default/lib/libturbojpeg.so'


def decode_png(png):
    assert png.startswith(b'\x89PNG\r\n\x1a\n')
    offset, compressed = 8, b''
    while offset < len(png):
        length = struct.unpack('>I', png[offset:offset+4])[0]
        kind = png[offset+4:offset+8]
        data = png[offset+8:offset+8+length]
        assert zlib.crc32(kind + data) == struct.unpack('>I', png[offset+8+length:offset+12+length])[0]
        if kind == b'IHDR':
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data)
            assert (depth, color, compression, filtering, interlace) == (8, 2, 0, 0, 0)
        if kind == b'IDAT':
            compressed += data
        offset += length + 12
    rows = zlib.decompress(compressed)
    stride = width * 3 + 1
    assert len(rows) == height * stride
    assert all(rows[y * stride] == 0 for y in range(height))
    return width, height, b''.join(rows[y * stride+1:(y+1) * stride] for y in range(height))


class CameraEncodingTests(unittest.TestCase):
    def test_lossless_png_preserves_rgb_and_ignores_stride_padding(self):
        msg = SimpleNamespace(width=3, height=2, step=11, encoding='rgb8',
            data=bytes(range(9)) + b'zz' + bytes(range(9,18)) + b'zz')
        width, height, pixels = decode_png(fast_png(msg))
        self.assertEqual((width, height), (3, 2))
        self.assertEqual(pixels, bytes(range(18)))

    def test_rejects_unsupported_or_truncated_layout(self):
        for encoding, width, height, step, data in [
            ('rgba8',1,1,4,b'1234'), ('rgb8',1,1,2,b'12'),
            ('rgb8',1,1,3,b'12'), ('rgb8',0,1,0,b'')]:
            with self.assertRaises(ValueError):
                rgb_pixels(SimpleNamespace(encoding=encoding,width=width,height=height,step=step,data=data))

    def test_jpeg_is_decodable_at_original_resolution_and_reasonable_error(self):
        encoder = DisplayJpeg(LIB)
        raw = b''.join(bytes((x*4, y*4, 80)) for y in range(64) for x in range(64))
        msg = SimpleNamespace(width=64,height=64,step=192,encoding='rgb8',data=raw)
        try:
            jpeg = encoder.encode(msg)
            self.assertTrue(jpeg.startswith(b'\xff\xd8') and jpeg.endswith(b'\xff\xd9'))
            lib = encoder.lib
            lib.tjInitDecompress.restype = ctypes.c_void_p
            lib.tjDecompressHeader3.argtypes = [ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ulong,
                ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int),
                ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int)]
            lib.tjDecompress2.argtypes = [ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ulong,
                ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int]
            handle = lib.tjInitDecompress()
            try:
                w,h,sub,color = (ctypes.c_int() for _ in range(4))
                self.assertEqual(lib.tjDecompressHeader3(handle,ctypes.c_char_p(jpeg),len(jpeg),
                    ctypes.byref(w),ctypes.byref(h),ctypes.byref(sub),ctypes.byref(color)),0)
                self.assertEqual((w.value,h.value),(64,64))
                decoded = ctypes.create_string_buffer(len(raw))
                self.assertEqual(lib.tjDecompress2(handle,ctypes.c_char_p(jpeg),len(jpeg),
                    decoded,64,192,64,0,0),0)
                self.assertLess(statistics.mean(abs(a-b) for a,b in zip(raw,decoded.raw)),4)
            finally:
                lib.tjDestroy(handle)
        finally:
            encoder.close()
        with self.assertRaisesRegex(RuntimeError,'CLOSED'):
            encoder.encode(msg)


def benchmark():
    evidence = ROOT / 'artifacts/camera-display-20261012'
    evidence.mkdir(parents=True,exist_ok=True)
    source = (ROOT/'artifacts/interactive-live/camera/latest.png').read_bytes()
    (evidence/'benchmark-source.png').write_bytes(source)
    width,height,raw = decode_png(source)
    msg = SimpleNamespace(width=width,height=height,step=width*3,encoding='rgb8',data=raw)
    spec = importlib.util.spec_from_file_location('perception', ROOT/'services/robot-mcp/ros2_bridge/perception.py')
    perception = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(perception)
    encoder = DisplayJpeg(LIB)
    def both():
        return fast_png(msg,raw),encoder.encode(msg,raw)
    results = {}
    try:
        for label,fn in [('original_png',lambda:perception.png_bytes(msg)),('fast_png',lambda:fast_png(msg,raw)),
                         ('display_jpeg',lambda:encoder.encode(msg,raw)),('combined',both)]:
            times=[]
            for _ in range(25):
                start=time.perf_counter();data=fn();times.append((time.perf_counter()-start)*1000)
            results[label]={'median_ms':statistics.median(times),'p95_ms':sorted(times)[23],
                           'bytes':sum(map(len,data)) if isinstance(data,tuple) else len(data)}
        (evidence/'benchmark-display.jpg').write_bytes(encoder.encode(msg,raw))
        self_check=decode_png(fast_png(msg,raw))
        assert self_check == (width,height,raw)
    finally:
        encoder.close()
    report={'source':'real camera latest.png','width':width,'height':height,'quality':85,'samples':25,
            'png_pixel_identity':True,'encoders':results}
    (evidence/'encoding-benchmark.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    if '--benchmark' in sys.argv:
        benchmark()
    else:
        unittest.main()
