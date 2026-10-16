"""Build only this project-local native plugin; no package installs."""
from pathlib import Path
import os,subprocess,shutil,hashlib,json
BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
PREFIX=ROOT/"runtime/ros2-jazzy/.pixi/envs/default"
BUILD=BASE/"build"
def main():
    BUILD.mkdir(exist_ok=True)
    for i in range(16):
        for suffix in ("vert","frag"):
            shutil.copyfile(BASE/"shaders"/("fire."+suffix),BASE/"shaders"/("fire_"+str(i)+"."+suffix))
    for suffix in ("vert","frag"):
        subprocess.run([str(PREFIX/"bin/glslangValidator"),"-S",suffix,str(BASE/"shaders"/("fire."+suffix))],check=True)
    includes=[PREFIX/"include",PREFIX/"include/OGRE-Next",PREFIX/"include/sdformat-14.8",PREFIX/"include/eigen3"]
    includes+=list((PREFIX/"include/gz").glob("*"))
    includes+=list((PREFIX/"include").glob("sdformat*"))
    args=["g++","-std=c++17","-shared","-fPIC","-O2","-Wl,-z,defs"]
    args+=["-I"+str(p) for p in includes if p.is_dir()]
    args+=[str(BASE/"VolumetricFire.cc"),"-o",str(BUILD/"libagnes_volume_fire.so.tmp"),"-L"+str(PREFIX/"lib"),"-Wl,-rpath,"+str(PREFIX/"lib")]
    args+=["-l"+lib for lib in ["gz-sim8","gz-rendering8","gz-rendering8-ogre2","gz-plugin2","gz-common5","gz-common5-events","gz-common5-graphics","gz-math7","gz-msgs10","protobuf","sdformat14","OgreNextMain"]]
    (BUILD/"tmp").mkdir(exist_ok=True)
    env=os.environ.copy();env["TMPDIR"]=str(BUILD/"tmp");env["LD_LIBRARY_PATH"]=str(PREFIX/"lib")+":"+env.get("LD_LIBRARY_PATH","")
    result=subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (BUILD/"build.log").write_text(result.stdout)
    print(result.stdout)
    result.check_returncode()
    os.replace(BUILD/"libagnes_volume_fire.so.tmp",BUILD/"libagnes_volume_fire.so")
    files=[BASE/"VolumetricFire.cc",BASE/"shaders/fire.vert",BASE/"shaders/fire.frag",BASE/"build.py",BUILD/"libagnes_volume_fire.so"]
    manifest={"schema":"agnes.volumetric-fire.native.v1","source":"Project-authored C++ and procedural GLSL; no third-party assets or model calls","third_party_assets":[],"models_called":[],"appearance_only":True,"combustion_physics":False,"files":[{"path":str(p.relative_to(ROOT)),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size} for p in files]}
    (BUILD/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(BUILD/"libagnes_volume_fire.so")
if __name__=="__main__":main()
