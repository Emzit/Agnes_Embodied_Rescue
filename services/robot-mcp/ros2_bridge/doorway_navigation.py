"""Static door-centre waypoints only. Door state and collision checks remain live."""
import math

class DoorwayRouteError(ValueError):
    def __init__(self,code):
        self.code=code
        super().__init__(code)

def _contains(bounds,pose):
    return bounds and bounds["min_x"]<=pose["x"]<bounds["max_x"] and bounds["min_y"]<=pose["y"]<bounds["max_y"]

def plan_doorway_route(geometry,registry,start_pose,target_location,target_pose):
    locations=registry.get("locations",[])
    rooms=[l for l in locations if l.get("type")=="room" and _contains(l.get("bounds"),start_pose)]
    if len(rooms)>1:raise DoorwayRouteError("AMBIGUOUS_SOURCE_ROOM")
    source=rooms[0] if rooms else None
    target=next((l for l in locations if l.get("id")==target_location),None)
    if source and target and source["id"]==target["id"]:
        return [{"pose":dict(target_pose),"stage":"target","door_id":None}]
    route=[]
    def stages(room,entering):
        doors=[d for d in geometry.get("doors",[]) if room["id"] in d.get("connects",[])]
        if len(doors)!=1:raise DoorwayRouteError("AMBIGUOUS_ROOM_DOOR")
        door=doors[0];a=door.get("at");outside=door.get("interaction_pose")
        if not a or len(a)!=2 or not outside:raise DoorwayRouteError("MISSING_DOORWAY_APPROACH")
        dx,dy=a[0]-outside["x"],a[1]-outside["y"]
        length=math.hypot(dx,dy)
        if not math.isfinite(length) or length<.5:raise DoorwayRouteError("INVALID_DOORWAY_APPROACH")
        width = float(door.get("width", 0))
        if not math.isfinite(width) or width <= 0:
            raise DoorwayRouteError("INVALID_DOOR_WIDTH")
        # A hinged leaf occupies almost one door-width inside the room.
        # Put the interior waypoint beyond its tip, rather than alongside it.
        # Half a door-width of clearance accommodates any base fitting the gap.
        inside_distance = max(length, 1.5 * width)
        inside={"x":a[0]+dx/length*inside_distance,"y":a[1]+dy/length*inside_distance}
        if not _contains(room.get("bounds"),inside):raise DoorwayRouteError("INVALID_DOORWAY_INSIDE")
        yaw=math.atan2(dy,dx) if entering else math.atan2(-dy,-dx)
        pts=[(outside,"doorway_approach"),({"x":a[0],"y":a[1]},"doorway_center"),(inside,"doorway_inside")]
        if not entering:
            pts=[(inside,"doorway_exit_inside"),({"x":a[0],"y":a[1]},"doorway_exit_center"),(outside,"doorway_exit_outside")]
            progress=((start_pose["x"]-a[0])*dx+(start_pose["y"]-a[1])*dy)/length
            cross=abs((start_pose["x"]-a[0])*dy-(start_pose["y"]-a[1])*dx)/length
            if 0 < progress < inside_distance and cross <= width/2-.42-.04:
                pts=pts[1:]  # Already in the exit lane; avoid an out-and-back path.
        if entering:
            progress=((start_pose["x"]-outside["x"])*dx+(start_pose["y"]-outside["y"])*dy)/length
            cross=abs((start_pose["x"]-outside["x"])*dy-(start_pose["y"]-outside["y"])*dx)/length
            if 0<progress<length and cross<=.08:
                pts=pts[1:]  # Already aligned in the open approach lane; do not reverse.
        for point,stage in pts:
            route.append({"pose":{"x":float(point["x"]),"y":float(point["y"]),"yaw":yaw,"frame_id":"map"},"stage":stage,"door_id":door["id"]})
    if source:stages(source,False)
    if target and target.get("type")=="room":stages(target,True)
    route.append({"pose":dict(target_pose),"stage":"target","door_id":None})
    return route
