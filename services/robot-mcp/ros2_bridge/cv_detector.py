"""Pixel-only colored-demo-marker/contour detector, NOT general object recognition.

Public class appearance convention: magenta coat marks a person demo, tall red
cylinder an extinguisher demo, blue case a toolbox demo. No positions, entity
names, room IDs or ground-truth files are accepted as detector input.
"""
import hashlib
import math
import numpy as np

CLASSES=['person','fire_extinguisher','toolbox','door']
def components(mask):
    height,width=mask.shape
    seen=np.zeros(mask.shape,dtype=bool)
    for y,x in zip(*np.nonzero(mask)):
        if seen[y,x]:continue
        queue=[(int(y),int(x))];seen[y,x]=True;points=[]
        while queue:
            a,b=queue.pop();points.append((a,b))
            for c,d in [(a-1,b),(a+1,b),(a,b-1),(a,b+1)]:
                if 0<=c<height and 0<=d<width and mask[c,d] and not seen[c,d]:
                    seen[c,d]=True;queue.append((c,d))
        yield points

def detect_pixels(msg):
    if msg.encoding!='rgb8' or len(msg.data)!=msg.height*msg.step:
        raise ValueError('UNSUPPORTED_IMAGE_LAYOUT')
    pixels=np.frombuffer(bytes(msg.data),dtype=np.uint8).reshape(msg.height,msg.step)[:,:msg.width*3].reshape(msg.height,msg.width,3).astype(float)
    r,g,b=pixels[:,:,0],pixels[:,:,1],pixels[:,:,2]
    masks=[(np.minimum(r,b)>60)&(g<np.minimum(r,b)*0.45)&(np.abs(r-b)<np.maximum(r,b)*0.5),
           (r>50)&(r>g*1.9)&(r>b*1.9),
           (b>50)&(b>r*1.7)&(b>g*1.4),
           (r>90)&(g>55)&(r>g*1.15)&(g>b*1.35)]
    detections=[]
    stamp={'sec':msg.header.stamp.sec,'nanosec':msg.header.stamp.nanosec}
    digest=hashlib.sha256(bytes(msg.data)).hexdigest()
    for label,mask in zip(CLASSES,masks):
        for points in components(mask):
            if len(points)<12:continue
            ys,xs=zip(*points);x1,x2=min(xs),max(xs)+1;y1,y2=min(ys),max(ys)+1
            width,height=x2-x1,y2-y1
            if width<3 or height<3:continue
            if label=='fire_extinguisher' and height/width<1.25:continue
            # A real door viewed from the interaction pose can be a narrow
            # vertical projection when the panel is nearly edge-on.  Keep a
            # small but filled, color-consistent contour (the interaction
            # layer also requires the robot to be near the map-prior door and
            # cross-checks the real Gazebo panel pose).  Only discard a true
            # one/two-pixel line, which is sensor/render noise rather than a
            # usable visual observation.
            if label=='door' and width < 3: continue
            fill=len(points)/(width*height)
            if fill<0.3:continue
            values=pixels[list(ys),list(xs)]
            if label=='person':purity=float(np.median((np.minimum(values[:,0],values[:,2])-values[:,1])/np.maximum(np.minimum(values[:,0],values[:,2]),1)))
            elif label=='fire_extinguisher':purity=float(np.median((values[:,0]-np.maximum(values[:,1],values[:,2]))/np.maximum(values[:,0],1)))
            elif label=='toolbox':purity=float(np.median((values[:,2]-np.maximum(values[:,0],values[:,1]))/np.maximum(values[:,2],1)))
            else:purity=float(np.median((values[:,0]+values[:,1]-2*values[:,2])/np.maximum(values[:,0]+values[:,1],1)))
            resolution=min(1,math.sqrt(len(points))/25)
            edge=0.2 if x1<3 or y1<3 or x2>msg.width-3 or y2>msg.height-3 else 1.0
            confidence=max(0,min(1,0.4*purity+0.2*fill+0.25*resolution+0.15*edge))
            ident=hashlib.sha256((str(stamp)+label+str([x1,y1,x2,y2])).encode()).hexdigest()[:16]
            detections.append({'id':'visual_'+ident,'label':label,'confidence':confidence,
                'bbox':[x1,y1,x2,y2],'center':[(x1+x2)/2,(y1+y2)/2],
                'source':'ros2_camera_perception','frame_id':msg.header.frame_id,'timestamp':stamp,
                'evidence':{'method':'cv_color_contour','demo_marker':True,'general_recognition':False,
                    'frame_timestamp':stamp,'frame_sha256':digest,'image_width':msg.width,'image_height':msg.height,
                    'confidence_components':{'color_purity':purity,'fill':fill,'resolution':resolution,'edge_visibility':edge},
                    'confidence_calibrated_probability':False}})
    return detections

class CvPerception:
    def detect(self,msg):return detect_pixels(msg)
    def close(self):pass
