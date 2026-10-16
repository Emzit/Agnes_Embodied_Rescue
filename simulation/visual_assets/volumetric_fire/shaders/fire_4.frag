#version 330 core
in vec3 objectPosition;
out vec4 fragColor;
uniform vec3 camera_position;
uniform vec3 volumeSize;
uniform vec3 volumeCenter;
uniform vec3 flowDirection;
uniform vec3 sourceCenter;
uniform vec3 sourceSize;
uniform float simTime;
uniform float seed;
uniform float intensity;
uniform int fireKind;
uniform int marchSteps;

float hash3(vec3 p) {
    p=fract(p*.1031);
    p+=dot(p,p.yzx+33.33);
    return fract((p.x+p.y)*p.z);
}
float valueNoise(vec3 p) {
    vec3 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                   mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                   mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) {
    return .66*valueNoise(p)+.26*valueNoise(p*2.03+vec3(3.1,8.7,1.2))
           +.08*valueNoise(p*4.11+vec3(8.4,2.1,5.8));
}
float square(float x){return x*x;}
float fourth(float x){float y=x*x;return y*y;}
float densityAt(vec3 p, out float heat) {
    vec3 q=p*volumeSize+volumeCenter;
    float t=simTime;
    float h=p.z+.5;
    // A source-sized inlet joins a rising plume to its paired ceiling domain.
    vec2 sourceXY=(q.xy-sourceCenter.xy)/(sourceSize.xy*.34);
    float join=fireKind==1 ? exp(-dot(sourceXY,sourceXY)*1.8) : 0.;
    float inlet=join*(1.-smoothstep(.025,.42,h));
    vec3 flow=normalize(mix(flowDirection,vec3(0.,0.,1.),inlet));
    // Stretch the reaction field along the gas flow, breaking round bubble cells
    // into rising torn tongues / lateral curls at the same sampling cost.
    vec3 sourcePosition=q-sourceCenter;
    vec3 travel=sourcePosition*7.2-flow*dot(sourcePosition,flow)*4.1
                 -flow*t*2.4+vec3(seed*.73,seed*1.19,seed*.37);
    float n=fbm(travel);
    float density;
    if(fireKind==0) {
        float bendX=.08*sin(h*8.-t*2.1+seed)+.055*sin(h*15.+t*1.3);
        float bendY=.075*sin(h*9.-t*1.65+seed*1.7);
        vec2 xy=p.xy+vec2(bendX,bendY)*h;
        float taper=.39*(1.-.48*h);
        // Several connected, asynchronous fuel tongues form a continuous field.
        float core=exp(-dot(xy/vec2(taper,.34),xy/vec2(taper,.34))*2.3);
        float left=exp(-dot((xy-vec2(-.23,.08))/vec2(taper*.61,.22),
                           (xy-vec2(-.23,.08))/vec2(taper*.61,.22))*2.1);
        float right=exp(-dot((xy-vec2(.21,-.07))/vec2(taper*.64,.23),
                            (xy-vec2(.21,-.07))/vec2(taper*.64,.23))*2.1);
        float fuel=clamp(core+left*.66+right*.73,0.,1.);
        float mixture=n+fuel*.26-h*.06;
        // Light the thin moving reaction boundary, not the whole noisy volume.
        float tongues=exp(-square((mixture-.66)/.085));
        tongues*=smoothstep(.18,.42,n);
        density=fuel*tongues*smoothstep(0.,.04,h)*(1.-.32*smoothstep(.73,1.,h));
        heat=clamp(pow(fuel,3.)*pow(tongues,5.)*.68+(.12+.20*n),0.,1.);
    } else {
        // A thin turbulent gas sheet rolls laterally under the real ceiling.
        float center=.03+.095*sin(p.x*9.+p.y*5.-t*2.+seed)
                          +.045*sin(p.x*17.+t*1.4);
        // Only the hot-source inlet bends down to the shared proxy plane.
        // The rest remains a horizontal rolling sheet under the ceiling.
        center-=.42*join;
        float tube=exp(-square((p.z-center)/(.22+.10*join)));
        float side=mix(exp(-fourth(p.y/.37)),1.,join);
        float streak=exp(-square((n+.10*valueNoise(travel*1.6)-.58)/.075));
        density=tube*side*streak*.85;
        heat=clamp(pow(density,1.25)*.80+n*.12,0.,1.);
    }
    // External proxy edges fade; the paired source inlet stays continuous.
    vec3 rim=smoothstep(vec3(0.),vec3(.13),vec3(.5)-abs(p));
    // The main plume reaches its top; the thin rollover only fades near the roof.
    float zRim=fireKind==0 ? smoothstep(0.,.035,h) :
               mix(smoothstep(0.,.025,h),1.,join)*(1.-smoothstep(.70,1.,h));
    density*=rim.x*rim.y*zRim;
    return density;
}
vec3 flameColor(float heat) {
    vec3 ember=vec3(1.,.14,.012);
    vec3 orange=vec3(1.,.48,.035);
    vec3 hot=vec3(1.,.93,.58);
    vec3 c=mix(ember,orange,smoothstep(.10,.47,heat));
    return mix(c,hot,smoothstep(.47,.94,heat));
}
void main() {
    vec3 ro=(camera_position-volumeCenter)/volumeSize;
    vec3 rd=normalize(objectPosition-ro);
    vec3 signDir=vec3(rd.x<0.?-1.:1.,rd.y<0.?-1.:1.,rd.z<0.?-1.:1.);
    vec3 inv=signDir/max(abs(rd),vec3(1e-7));
    vec3 a=(-vec3(.5)-ro)*inv,b=(vec3(.5)-ro)*inv;
    vec3 lo=min(a,b),hi=max(a,b);
    float entry=max(lo.x,max(lo.y,lo.z));
    float exitT=min(hi.x,min(hi.y,hi.z));
    bool inside=entry<0.;
    // Render the first surface outside, the exit surface when inside a volume.
    float surfaceT=dot(objectPosition-ro,rd);
    if(!inside && abs(surfaceT-entry)>abs(surfaceT-exitT))discard;
    entry=max(entry,0.);
    if(exitT<=entry)discard;
    float dt=(exitT-entry)/float(marchSteps);
    float worldStep=length(rd*volumeSize)*dt;
    vec3 color=vec3(0.);
    float alpha=0.;
    // Narrow substep dither breaks slice bands without visible fixed-pixel grain.
    float jitter=.5+.10*(hash3(vec3(gl_FragCoord.xy,seed))-.5);
    for(int i=0;i<64;i++) {
        if(i>=marchSteps || alpha>.965)break;
        vec3 p=ro+rd*(entry+(float(i)+jitter)*dt);
        float heat;
        float density=densityAt(p,heat);
        float opacity=1.-exp(-density*worldStep*8.5*intensity);
        color+=(1.-alpha)*opacity*flameColor(heat);
        alpha+=(1.-alpha)*opacity;
    }
    if(alpha<.004)discard;
    // Ogre uses straight alpha blending for this material.
    fragColor=vec4(color/max(alpha,.0001),alpha);
}
