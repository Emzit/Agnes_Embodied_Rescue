/** Parse image-only Agnes detections; no simulator or CV inputs. */
export const VISUAL_LABELS = ["person", "fire_extinguisher", "toolbox", "hazard_marker", "door"] as const;

export const VISUAL_INSPECTION_PROMPT = "This is a sensor perception subrequest, not a rescue mission, robot task, or candidate-action decision. The attached image is already supplied and is the complete, sole input. Read its pixels directly and return the JSON answer immediately. Do not plan, score candidate answers, or call any tool, including decision_score_candidates, mission_get_state, world_memory_get, or Robot MCP. The rescue workflow does not apply to this image classification subrequest. Do not use any task/world/session knowledge. Identify ONLY visibly supported objects: "
  + VISUAL_LABELS.join(", ")
  + ". If absent return exactly {\"detections\":[]}. The detections field is always required; {} is invalid. Return ONLY JSON {\"detections\":[{\"label\":\"person\",\"confidence\":0.0,\"bbox\":[x1,y1,x2,y2]}]}. Bbox coordinates normalized 0..1. Confidence must reflect visual uncertainty; do not force high confidence. A red object alone is NOT proof of an extinguisher. Person means visible human-shaped figure, not confirmed researcher identity. Door means a visually supported physical door leaf in a doorway, using its shape, frame, or handle. Fire, orange light, smoke, or a rectangular wall patch alone is NOT proof of a door; omit uncertain or obscured doors.";

/** A focused image query still has no map IDs, coordinates or simulator state. */
export const DOOR_INSPECTION_PROMPT = "This is an image-only door perception subrequest. The supplied camera image is your ONLY source of evidence. This is not a robot mission: do not call any tools or follow rescue workflow steps. Inspect visible pixels for physical door leaves, including transparent glass doors. A glass door can be identified by its perimeter frame together with a handle, hinge edge, safety band or seams; the room or person seen through the glass does not make that glass doorway absent. Partially cropped doors may be reported when the visible frame and door hardware support them. Do not infer a door from an unseen map, room name, fire, orange light, smoke or a plain rectangle alone. When no physical door is visually supported, return exactly {\"detections\":[]}; the detections field is mandatory and {} is invalid. Return ONLY JSON {\"detections\":[{\"label\":\"door\",\"confidence\":0.0,\"bbox\":[x1,y1,x2,y2]}]}. Use label door exactly, normalized bounding box coordinates in [0,1], and confidence reflecting visual uncertainty. Identify the visible door leaf rather than the person or space behind it.";

export const VISUAL_SCHEMA_CORRECTION_PROMPT =
  "\nThe previous inference on these identical sensor pixels did not match the required JSON schema. This is the single schema-correction attempt, not a new observation. Re-evaluate only the attached same image. Always include the top-level detections array. If no allowed object is visually supported, return exactly {\"detections\":[]}. An empty object {} is invalid. Return one JSON object without prose or code fences. Do not interpret the invalid previous answer as evidence of absence, and do not invent detections to fill the array.";

function jsonObjects(text:string):any[] {
  const results:any[]=[];let start=-1,depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'&&depth){quoted=true;continue;}
    if(c==="{"){if(!depth)start=i;depth++;}
    if(c==="}"&&depth&&!--depth){try{results.push(JSON.parse(text.slice(start,i+1)));}catch{}}
  }
  return results;
}

export function parseVisualDetections(text: string) {
  // Some valid image replies omit the requested object wrapper. Accept only
  // a complete JSON document here, never a guessed/extracted partial array.
  let arrayReply: any[] | undefined;
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) arrayReply = parsed;
  } catch { /* Existing complete-object extraction handles prose/fences. */ }
  const output = jsonObjects(text).findLast((item: any) => Array.isArray(item?.detections));
  const detections = arrayReply ?? output?.detections;
  if (!detections) throw new Error("VLM_INVALID_OUTPUT");
  return detections.filter((item: any) => item !== null && typeof item === "object"
    && VISUAL_LABELS.includes(item.label)
    && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1
    && Array.isArray(item.bbox) && item.bbox.length === 4
    && item.bbox.every((value: any) => Number.isFinite(value) && value >= 0 && value <= 1)
    && item.bbox[0] < item.bbox[2] && item.bbox[1] < item.bbox[3]);
}
