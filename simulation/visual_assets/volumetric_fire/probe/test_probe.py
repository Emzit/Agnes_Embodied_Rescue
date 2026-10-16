"""Regression checks over the actual native probe and no-fire baseline captures."""
import hashlib,json,math,struct,unittest,xml.etree.ElementTree as E,zlib
from pathlib import Path
P=Path(__file__).resolve().parent
BASE=P.parent
ROOT=BASE.parents[2]
def png_rgb(path):
    data=path.read_bytes();assert data[:8]==b"\x89PNG\r\n\x1a\n"
    at=8;compressed=b"";w=h=None
    while at<len(data):
        n=struct.unpack(">I",data[at:at+4])[0];kind=data[at+4:at+8];payload=data[at+8:at+8+n];at+=12+n
        if kind==b"IHDR":
            w,h,bits,color=struct.unpack(">IIBB",payload[:10])
            assert bits==8 and color==2
        elif kind==b"IDAT":compressed+=payload
    raw=zlib.decompress(compressed);stride=w*3+1
    assert len(raw)==h*stride and all(raw[y*stride]==0 for y in range(h))
    return w,h,b"".join(raw[y*stride+1:(y+1)*stride] for y in range(h))

class NativeProbe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fire=json.loads((P/"capture.json").read_text())
        cls.base=json.loads((P/"baseline-capture.json").read_text())
        cls.status=json.loads((P/"runtime.json").read_text())

    def test_six_native_volumes_and_gpu_ray_mask(self):
        s=self.status
        self.assertEqual(s["status"],"STOPPED") # clean owned-process teardown
        self.assertEqual(s["volumes"],6)
        self.assertEqual(s["shader_mode"],"raymarch_3d")
        self.assertEqual(s["billboards"],0)
        self.assertEqual(s["masked_lidar_sensors"],1)
        self.assertEqual(s["visibility_bit"],1<<24)
        self.assertGreater(s["render_frames"],100)
        self.assertEqual(s["error"],"")

    def test_static_cameras_see_animated_fire(self):
        for name in ("front","oblique"):
            self.assertGreater(self.fire["counts"][name],100)
            hashes=[x["sha256"] for x in self.fire["frames"][name]]
            self.assertEqual(len(hashes),5)
            self.assertEqual(len(set(hashes)),5)
            self.assertEqual(len(set(x["sha256"] for x in self.base["frames"][name])),1)

    def test_no_phantom_lidar_geometry(self):
        a,b=self.fire["scan"],self.base["scan"]
        self.assertEqual(len(a),101)
        self.assertEqual(len(a),len(b))
        self.assertGreaterEqual(self.fire["scan_count"],20)
        self.assertTrue(all(math.isfinite(x) for x in a+b))
        self.assertLess(max(abs(x-y) for x,y in zip(a,b)),1e-5)
        self.assertAlmostEqual(a[50],3.11,delta=.01) # real foreground bar
        self.assertGreater(a[30],4.4) # real wall, past volume proxy

    def test_foreground_occludes_without_fire_color_leak(self):
        for name in ("front","oblique"):
            w,h,baseline=png_rgb(P/self.base["frames"][name][0]["file"])
            # Cyan bar pixels are unambiguous and interior to the opaque object.
            mask={i//3 for i in range(0,len(baseline),3)
                  if baseline[i+1]>baseline[i]+35 and baseline[i+2]>baseline[i]+35}
            # Erode two pixels to exclude MSAA silhouette pixels, which mix
            # the correctly visible background flame with foreground coverage.
            bar=[3*i for i in mask if all(i+dy*w+dx in mask
                  for dx in range(-2,3) for dy in range(-2,3))]
            self.assertGreater(len(bar),300)
            for frame in self.fire["frames"][name]:
                fw,fh,rgb=png_rgb(P/frame["file"]);self.assertEqual((w,h),(fw,fh))
                self.assertTrue(all(rgb[i:i+3]==baseline[i:i+3] for i in bar))

    def test_visible_fire_without_changes_to_baseline_world(self):
        for name in ("front","oblique"):
            _,_,baseline=png_rgb(P/self.base["frames"][name][0]["file"])
            _,_,rgb=png_rgb(P/self.fire["frames"][name][2]["file"])
            warm=sum(rgb[i]>rgb[i+2]+45 and rgb[i]>baseline[i]+20 for i in range(0,len(rgb),3))
            self.assertGreater(warm,3000)
        fire=E.parse(P/"world.sdf").getroot();base=E.parse(P/"baseline.sdf").getroot()
        w=fire.find("world")
        plugin=w.find("./plugin[@name='agnes::VolumetricFire']")
        self.assertEqual(len(plugin.findall("volume")),6)
        w.remove(plugin)
        # Ignore pretty-printer whitespace in otherwise identical physical world.
        for tree in (fire,base):
            for e in tree.iter():
                if e.text is not None:e.text=e.text.strip()
                if e.tail is not None:e.tail=e.tail.strip()
        self.assertEqual(E.tostring(fire),E.tostring(base))

    def test_compiled_manifest_and_all_shader_variants_match(self):
        manifest=json.loads((BASE/"build/manifest.json").read_text())
        self.assertEqual(manifest["third_party_assets"],[])
        self.assertEqual(manifest["models_called"],[])
        for item in manifest["files"]:
            self.assertEqual(hashlib.sha256((ROOT/item["path"]).read_bytes()).hexdigest(),item["sha256"])
        for stage in ("vert","frag"):
            source=(BASE/"shaders"/("fire."+stage)).read_bytes()
            for i in range(16):
                self.assertEqual(source,(BASE/"shaders"/("fire_"+str(i)+"."+stage)).read_bytes())

if __name__=="__main__":
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(NativeProbe)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (P/"verification.json").write_text(json.dumps({
        "ok":result.wasSuccessful(),"tests":result.testsRun,
        "failures":len(result.failures),"errors":len(result.errors),
        "evidence":"actual Gazebo Ogre2 camera and GPU-ray captures",
        "capture_stage":"native probe before final office-specific field tuning",
        "coverage":"unchanged proxy/material/mask/occlusion mechanics; current build hashes checked separately",
        "final_appearance_and_fps":"requires integrated office validation",
        "max_scan_difference":max(abs(a-b) for a,b in zip(NativeProbe.fire["scan"],NativeProbe.base["scan"])),
        "limitations":["No per-sample scene depth for opaque geometry intersecting inside a volume","Appearance-only field; not combustion physics"]
    },indent=2)+"\n")
    raise SystemExit(not result.wasSuccessful())
