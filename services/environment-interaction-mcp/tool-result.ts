/** Keep raw camera bytes in the sensor trace; door results carry bounded visual evidence. */
export function environmentToolResult(value: any) {
  const { _camera_image: directImage, ...result } = value;
  const observation = result.verification?.fresh_camera_observation;
  if (observation && typeof observation === "object") {
    const { _camera_image: nestedImage, ...sensorSummary } = observation;
    result.verification = { ...result.verification, fresh_camera_observation: sensorSummary };
  }
  return {
    // The native door workflow needs the validated Agnes detection and hash.
    // Raw image attachment authority remains with Robot MCP get_observation;
    // duplicating it here can leave an unreadable native artifact reference.
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    ...(result.status === "FAILED" ? { isError: true } : {}),
  };
}
