// Project-authored native 3-D fire. Rendering only; no ECM motion/collision edits.
#include <atomic>
#include <chrono>
#include <cmath>
#include <cctype>
#include <functional>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>
#include <gz/common/Console.hh>
#include <gz/common/Event.hh>
#include <gz/plugin/Register.hh>
#include <gz/sim/System.hh>
#include <gz/sim/EventManager.hh>
#include <gz/sim/components/Name.hh>
#include <gz/sim/rendering/Events.hh>
#include <gz/rendering/RenderingIface.hh>
#include <gz/rendering/Scene.hh>
#include <gz/rendering/Visual.hh>
#include <gz/rendering/Geometry.hh>
#include <gz/rendering/GpuRays.hh>
#include <gz/rendering/Material.hh>
#include <gz/rendering/ShaderParams.hh>
#include <gz/rendering/ogre2/Ogre2Material.hh>
#include <gz/rendering/ogre2/Ogre2Geometry.hh>
#include <OgreMovableObject.h>
#include <OgreMaterial.h>
#include <OgreTechnique.h>
#include <OgrePass.h>
#include <OgreGpuProgramParams.h>
#include <OgreHlmsCommon.h>
#include <OgreHlmsDatablock.h>
#include <sdf/Element.hh>

namespace agnes {
namespace fs=std::filesystem;
constexpr uint32_t kFireMask=0x01000000u;
struct Volume {
  std::string name; gz::math::Vector3d center,size,direction;
  float seed=1.f,intensity=1.f; int kind=0,steps=36;
  gz::rendering::VisualPtr visual;
  gz::rendering::MaterialPtr material;
};
class VolumetricFire final : public gz::sim::System,
    public gz::sim::ISystemConfigure, public gz::sim::ISystemPreUpdate {
  std::vector<Volume> volumes;
  gz::rendering::ScenePtr scene;
  gz::common::ConnectionPtr renderConnection,teardownConnection;
  std::atomic<double> simTime{0.0};
  std::string shaderDir,statusPath,worldName,error;
  uint64_t frames=0; double lastStatus=-1;
  bool initialized=false,failed=false;
  std::set<std::string> maskedSensors;
  static bool InWorkspace(const std::string &p) {
    const std::string root="/data-ssd/zhongchengkai/agnes/";
    auto s=fs::weakly_canonical(p).string();
    return s.compare(0,root.size(),root)==0;
  }
  static std::string Quote(const std::string &s) {
    std::ostringstream o;o << '"';
    for(unsigned char c:s) {
      if(c=='"' || c=='\\')o << '\\' << char(c);
      else if(c<32)o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << unsigned(c);
      else o << char(c);
    }
    o << '"';return o.str();
  }
  void Status(const std::string &state) {
    if(statusPath.empty())return;
    try {
      fs::create_directories(fs::path(statusPath).parent_path());
      std::ofstream out(statusPath+".tmp");
      const auto now=std::chrono::duration<double>(
        std::chrono::system_clock::now().time_since_epoch()).count();
      out<<std::setprecision(12)<<"{\"status\":\""<<state<<"\",\"shader_mode\":\"raymarch_3d\","
         <<"\"billboards\":0,\"volumes\":"<<volumes.size()<<",\"render_frames\":"<<frames
         <<",\"world_name\":"<<Quote(worldName)<<",\"sim_time\":"<<simTime.load()
         <<",\"updated_at\":"<<now<<",\"masked_lidar_sensors\":"<<maskedSensors.size()
         <<",\"visibility_bit\":"<<kFireMask<<",\"error\":"<<Quote(error)<<"}\n";
      out.close();fs::rename(statusPath+".tmp",statusPath);
    }catch(const std::exception &e){gzerr<<"VolumetricFire status: "<<e.what()<<std::endl;}
  }
  void OnRender() {
    if(failed)return;
    try {
      if(!scene)scene=gz::rendering::sceneFromFirstRenderEngine();
      if(!scene)return;
      if(!initialized) {
        for(size_t i=0;i<volumes.size();++i) {
          auto &v=volumes[i];
          v.visual=scene->CreateVisual("agnes_volume_"+v.name);
          v.visual->AddGeometry(scene->CreateBox());
          v.visual->SetLocalPosition(v.center);
          v.visual->SetLocalScale(v.size);
          v.visual->SetVisibilityFlags(kFireMask);
          v.material=scene->CreateMaterial("agnes_volume_material_"+v.name);
          v.material->SetCastShadows(false);
          v.material->SetDepthWriteEnabled(false);
          v.material->SetDepthCheckEnabled(true);
          // Unique shader basenames prevent Ogre program name collisions.
          const auto stem=shaderDir+"/fire_"+std::to_string(i);
          v.material->SetVertexShader(stem+".vert");
          v.material->SetFragmentShader(stem+".frag");
          auto vp=v.material->VertexShaderParams();
          (*vp)["worldviewproj_matrix"]=1;
          auto fp=v.material->FragmentShaderParams();
          (*fp)["camera_position"]=1;
          (*fp)["simTime"]=0.f;(*fp)["seed"]=v.seed;
          (*fp)["intensity"]=v.intensity;(*fp)["fireKind"]=v.kind;
          (*fp)["marchSteps"]=v.steps;
          // Use the low-level pass: the regular material macroblock belongs
          // to PBS, while this proxy renders through a custom GLSL program.
          auto mat=std::dynamic_pointer_cast<gz::rendering::Ogre2Material>(v.material);
          if(!mat)throw std::runtime_error("Ogre2 is required for volumetric fire");
          auto pass=mat->Material()->getTechnique(0)->getPass(0);
          Ogre::HlmsMacroblock mb;mb.mDepthCheck=true;mb.mDepthWrite=false;
          mb.mCullMode=Ogre::CULL_NONE;pass->setMacroblock(mb);
          auto params=pass->getFragmentProgramParameters();
          params->setNamedConstant("volumeCenter",Ogre::Vector3(v.center.X(),v.center.Y(),v.center.Z()));
          params->setNamedConstant("volumeSize",Ogre::Vector3(v.size.X(),v.size.Y(),v.size.Z()));
          params->setNamedConstant("flowDirection",Ogre::Vector3(v.direction.X(),v.direction.Y(),v.direction.Z()));
          // Paired domains share the seed. Bend only the ceiling gas entering
          // above that real fuel source, without changing the public SDF API.
          gz::math::Vector3d sourceCenter=v.center,sourceSize=v.size;
          if(v.kind==1)for(const auto &source:volumes) {
            if(source.kind==0 && std::abs(source.seed-v.seed)<.0001f) {
              sourceCenter=source.center;sourceSize=source.size;break;
            }
          }
          params->setNamedConstant("sourceCenter",Ogre::Vector3(sourceCenter.X(),sourceCenter.Y(),sourceCenter.Z()));
          params->setNamedConstant("sourceSize",Ogre::Vector3(sourceSize.X(),sourceSize.Y(),sourceSize.Z()));
          v.visual->SetMaterial(v.material,false);
          auto geometry=std::dynamic_pointer_cast<gz::rendering::Ogre2Geometry>(v.visual->GeometryByIndex(0));
          // Ogre2SubMesh only selects queue 200 for PBS transparency, not
          // custom shader materials. Explicitly render fire after opaque items.
          geometry->OgreObject()->setRenderQueueGroup(200);
          geometry->OgreObject()->setVisibilityFlags(kFireMask);
          pass->setMacroblock(mb);
          scene->RootVisual()->AddChild(v.visual);
        }
        initialized=true;
        gzmsg<<"AGNES_VOLUME_FIRE_READY count="<<volumes.size()
             <<" renderer=raymarch_3d billboards=0"<<std::endl;
      }
      // GPU rays render visual geometry even when it has no collision.
      // Exclude only this plugin's private bit, retaining all obstacle masks.
      for(unsigned int i=0;i<scene->SensorCount();++i) {
        auto s=scene->SensorByIndex(i);
        if(auto rays=std::dynamic_pointer_cast<gz::rendering::GpuRays>(s)) {
          rays->SetVisibilityMask(rays->VisibilityMask() & ~kFireMask);
          maskedSensors.insert(rays->Name());
        }
      }
      for(auto &v:volumes)(*v.material->FragmentShaderParams())["simTime"]=float(simTime.load());
      ++frames;
      double t=simTime.load();
      if(lastStatus<0 || t-lastStatus>=.5 || t<lastStatus) {Status("RUNNING");lastStatus=t;}
    }catch(const std::exception &e){
      failed=true;error=e.what();gzerr<<"AGNES_VOLUME_FIRE_FAILED "<<error<<std::endl;Status("FAILED");
    }
  }
public:
  void Configure(const gz::sim::Entity &entity,
    const std::shared_ptr<const sdf::Element> &sdf,
    gz::sim::EntityComponentManager &ecm,gz::sim::EventManager &events) override {
    try {
      auto cfg=sdf->Clone();
      shaderDir=cfg->Get<std::string>("shader_dir");
      statusPath=cfg->Get<std::string>("status_path","").first;
      if(!InWorkspace(shaderDir)||(!statusPath.empty()&&!InWorkspace(statusPath)))
        {statusPath.clear();throw std::runtime_error("all volumetric fire paths must be project-local");}
      if(auto n=ecm.Component<gz::sim::components::Name>(entity))worldName=n->Data();
      int defaultSteps=cfg->Get<int>("steps",36).first;
      auto e=cfg->FindElement("volume");
      while(e) {
        Volume v;
        v.name=e->Get<std::string>("name","volume_"+std::to_string(volumes.size())).first;
        for(char c:v.name)if(!std::isalnum(static_cast<unsigned char>(c))&&c!='_')
          throw std::runtime_error("volume name must be alphanumeric or underscore");
        v.center=e->Get<gz::math::Vector3d>("center");
        v.size=e->Get<gz::math::Vector3d>("size");
        v.kind=e->Get<int>("kind",0).first;
        v.seed=e->Get<float>("seed",float(volumes.size()+1)).first;
        v.intensity=e->Get<float>("intensity",1.f).first;
        v.steps=e->Get<int>("steps",defaultSteps).first;
        v.direction=e->Get<gz::math::Vector3d>("direction",v.kind?gz::math::Vector3d(1,0,0):gz::math::Vector3d(0,0,1)).first;
        if(!v.size.IsFinite()||!v.center.IsFinite()||!v.direction.IsFinite()||
          v.size.Min()<=0||v.size.Max()>8||v.steps<16||v.steps>64||
          (v.kind!=0&&v.kind!=1)||!std::isfinite(v.seed)||!std::isfinite(v.intensity)||v.intensity<=0||v.intensity>2||
          v.direction.Length()<.01||volumes.size()>=16)
          throw std::runtime_error("invalid bounded volumetric fire configuration");
        v.direction.Normalize();volumes.push_back(v);
        e=e->GetNextElement("volume");
      }
      if(volumes.empty())throw std::runtime_error("at least one volume is required");
      Status("STARTING");
      renderConnection=events.Connect<gz::sim::events::SceneUpdate>(std::bind(&VolumetricFire::OnRender,this));
      teardownConnection=events.Connect<gz::sim::events::RenderTeardown>([this](){
        // Release render references only on Gazebo's rendering thread.
        for(auto &v:volumes){v.visual.reset();v.material.reset();}
        scene.reset();initialized=false;Status("STOPPED");
      });
    }catch(const std::exception &e){failed=true;error=e.what();gzerr<<"AGNES_VOLUME_FIRE_CONFIG_FAILED "<<e.what()<<std::endl;Status("FAILED");}
  }
  void PreUpdate(const gz::sim::UpdateInfo &info,gz::sim::EntityComponentManager &) override {
    simTime.store(std::chrono::duration<double>(info.simTime).count());
  }
};
}
GZ_ADD_PLUGIN(agnes::VolumetricFire,gz::sim::System,
  gz::sim::ISystemConfigure,gz::sim::ISystemPreUpdate)
GZ_ADD_PLUGIN_ALIAS(agnes::VolumetricFire,"agnes::VolumetricFire")
