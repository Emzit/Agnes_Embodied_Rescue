"""Validate the actual RGBA assets used by the indoor fire renderer."""
import hashlib,json,struct,unittest,zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'simulation/visual_assets/office_fire_textures'

def rgba(path):
    data=path.read_bytes()
    if data[:8]!=bytes([137,80,78,71,13,10,26,10]):raise ValueError('Invalid PNG')
    off=8;payloads=[]
    while off<len(data):
        length=struct.unpack('>I',data[off:off+4])[0]
        tag=data[off+4:off+8];payload=data[off+8:off+8+length]
        assert struct.unpack('>I',data[off+8+length:off+12+length])[0]==zlib.crc32(tag+payload)&0xffffffff
        if tag==b'IHDR':
            w,h,depth,kind,_,_,interlace=struct.unpack('>IIBBBBB',payload)
            assert (depth,kind,interlace)==(8,6,0)
        if tag==b'IDAT':payloads.append(payload)
        off+=12+length
    raw=zlib.decompress(b''.join(payloads));stride=w*4+1
    assert len(raw)==stride*h
    assert all(raw[y*stride]==0 for y in range(h))
    pixels=b''.join(raw[y*stride+1:(y+1)*stride] for y in range(h))
    return w,h,pixels

class OfficeFireAssetsTests(unittest.TestCase):
    def test_authored_asset_manifest_and_png_integrity(self):
        m=json.loads((ASSETS.parent/'office_fire_manifest.json').read_text())
        self.assertEqual(m['models_called'],[])
        self.assertEqual(m['third_party_assets'],[])
        self.assertEqual(len(m['files']),10)
        for row in m['files']:
            p=ROOT/row['path']
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),row['sha256'])
            w,h,_=rgba(p)
            self.assertEqual((w,h),(256,1) if '_life' in p.name else (512,512))
    def test_transparent_sprite_borders_and_no_black_flame_background(self):
        for p in sorted(ASSETS.glob('*.png')):
            if '_life' in p.name:continue
            w,h,data=rgba(p)
            for x in range(w):
                self.assertEqual(data[x*4+3],0)
                self.assertEqual(data[((h-1)*w+x)*4+3],0)
            for y in range(h):
                self.assertEqual(data[(y*w)*4+3],0)
                self.assertEqual(data[(y*w+w-1)*4+3],0)
            if 'flame' in p.name or 'roll' in p.name:
                # Fully emissive colors under alpha, never opaque dark patches.
                for i in range(0,len(data),4):
                    if data[i+3]>0:self.assertGreaterEqual(data[i],250)
    def test_multiple_fire_shapes_and_soft_smoke(self):
        sprites=[ASSETS/f'wall_flame_{s}.png' for s in 'abc']+[ASSETS/f'ceiling_roll_{s}.png' for s in 'ab']
        self.assertEqual(len({hashlib.sha256(p.read_bytes()).hexdigest() for p in sprites}),5)
        for p in sprites:
            _,_,data=rgba(p)
            fraction=sum(v>25 for v in data[3::4])/(512*512)
            self.assertGreater(fraction,.05)
            self.assertLess(fraction,.75)
        _,_,data=rgba(ASSETS/'smoke.png')
        self.assertLessEqual(max(data[3::4]),110)
        self.assertGreater(min(data[1::4]),70)
    def test_lifetime_fades_at_both_ends(self):
        for p in ASSETS.glob('*_life.png'):
            _,_,data=rgba(p)
            self.assertEqual(data[3],0)
            self.assertEqual(data[-1],0)
            self.assertGreater(max(data[3::4]),50)
if __name__=='__main__':unittest.main()
