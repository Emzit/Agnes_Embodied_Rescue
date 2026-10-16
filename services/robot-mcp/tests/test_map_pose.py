
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ros2_bridge"))
from map_pose import project_odometry
x,y,yaw=project_odometry(0,0,0,0,-6.7,math.pi/2)
assert (x,y)==(0,-6.7) and abs(yaw-math.pi/2)<1e-12
x,y,yaw=project_odometry(1,2,.3,4,5,-.4)
assert abs(yaw-(-.1))<1e-12
assert abs(x-(4+math.cos(-.4)-2*math.sin(-.4)))<1e-12
assert abs(y-(5+math.sin(-.4)+2*math.cos(-.4)))<1e-12
# An AMCL transform replaces the spawn rotation, rather than adding it again.
assert abs(project_odometry(0,0,.3,0,0,-.4)[2]+.1)<1e-12
print("spawn and corrected map transforms applied exactly once")
