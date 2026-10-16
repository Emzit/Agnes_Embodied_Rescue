"""Compose measured odometry with a calibrated/localized map transform."""
import math
def project_odometry(x, y, yaw, tx, ty, rotation):
    return (tx+math.cos(rotation)*x-math.sin(rotation)*y,
            ty+math.sin(rotation)*x+math.cos(rotation)*y,
            math.atan2(math.sin(yaw+rotation),math.cos(yaw+rotation)))
