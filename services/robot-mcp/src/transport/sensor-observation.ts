import type { ObservationResult, RobotPose } from "../contract/types.ts";

export type SensorTimestamp = { sec: number; nanosec: number };
export type UnavailableSensor = { available: false; status: string };
export type LidarSummary = {
  available: true;
  min_range: number | null;
  front_min_range: number | null;
  left_min_range: number | null;
  right_min_range: number | null;
  valid_points: number;
  sample_count: number;
  frame_id: string;
  frame_timestamp: SensorTimestamp;
};
export type CameraSummary = {
  available: true;
  width: number;
  height: number;
  encoding: string;
  frame_id: string;
  frame_timestamp: SensorTimestamp;
  data_length: number;
  summary: { mean: number; std: number; min: number; max: number; sha256: string };
};

/** Additive backend summary: unchanged wire tool names, input schema and base result. */
export type Ros2SensorObservation = ObservationResult & {
  source: "ros2_real_sensors";
  timestamp: SensorTimestamp;
  robot_pose: RobotPose;
  lidar: LidarSummary | UnavailableSensor;
  camera: CameraSummary | UnavailableSensor;
  semantic_objects: Array<{id:string;label:string;confidence:number;bbox:number[];center:number[];
    source:"ros2_camera_perception";timestamp:SensorTimestamp;evidence:Record<string,unknown>}>;
};
