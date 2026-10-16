"""Fast lossless evidence PNG and optional JPEG for browser display only.

Uses the project's existing TurboJPEG library. No models, external dependencies,
resizing or synthesized frames; both representations use the same sensor pixels.
"""
import ctypes
import struct
import zlib
from pathlib import Path


def rgb_pixels(msg):
    if (msg.encoding != 'rgb8' or msg.width <= 0 or msg.height <= 0
            or msg.step < msg.width * 3 or len(msg.data) != msg.height * msg.step):
        raise ValueError('UNSUPPORTED_IMAGE_LAYOUT')
    return bytes(msg.data)


def fast_png(msg, raw=None):
    raw = rgb_pixels(msg) if raw is None else raw
    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data)))
    rows = b''.join(b'\0' + raw[y * msg.step:y * msg.step + msg.width * 3]
                    for y in range(msg.height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', msg.width, msg.height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 1)) + chunk(b'IEND', b''))


class DisplayJpeg:
    """Single-threaded reusable TurboJPEG encoder, explicitly closed by caller."""
    def __init__(self, library, quality=85):
        if not 1 <= quality <= 100:
            raise ValueError('INVALID_JPEG_QUALITY')
        self.quality = quality
        self.lib = ctypes.CDLL(str(Path(library)))
        byte_pointer = ctypes.POINTER(ctypes.c_ubyte)
        self.lib.tjInitCompress.restype = ctypes.c_void_p
        self.lib.tjCompress2.argtypes = [
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            ctypes.c_int, ctypes.POINTER(byte_pointer), ctypes.POINTER(ctypes.c_ulong),
            ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.lib.tjCompress2.restype = ctypes.c_int
        self.lib.tjFree.argtypes = [ctypes.c_void_p]
        self.lib.tjFree.restype = None
        self.lib.tjDestroy.argtypes = [ctypes.c_void_p]
        self.lib.tjDestroy.restype = ctypes.c_int
        self.lib.tjGetErrorStr2.argtypes = [ctypes.c_void_p]
        self.lib.tjGetErrorStr2.restype = ctypes.c_char_p
        self.handle = self.lib.tjInitCompress()
        if not self.handle:
            raise RuntimeError('JPEG_ENCODER_INIT_FAILED')

    def encode(self, msg, raw=None):
        if not self.handle:
            raise RuntimeError('JPEG_ENCODER_CLOSED')
        raw = rgb_pixels(msg) if raw is None else raw
        output = ctypes.POINTER(ctypes.c_ubyte)()
        length = ctypes.c_ulong()
        try:
            # TJPF_RGB=0, TJSAMP_420=2, TJFLAG_FASTDCT=2048 (bundled turbojpeg.h).
            result = self.lib.tjCompress2(self.handle, ctypes.c_char_p(raw),
                msg.width, msg.step, msg.height, 0, ctypes.byref(output),
                ctypes.byref(length), 2, self.quality, 2048)
            if result != 0:
                raise RuntimeError(self.lib.tjGetErrorStr2(self.handle).decode('utf-8', 'replace'))
            return ctypes.string_at(output, length.value)
        finally:
            if output:
                self.lib.tjFree(output)

    def close(self):
        if self.handle:
            self.lib.tjDestroy(self.handle)
            self.handle = None
