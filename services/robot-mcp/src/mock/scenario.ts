import { MockRobot } from "./robot.ts";
import { MockWorld, type MockWorldEvent } from "./world.ts";

export type MockScenarioName = "static" | "dynamic_rescue";

export type MockRescueScenario = {
  world: MockWorld;
  robot: MockRobot;
};

export type MockRescueScenarioOptions = {
  name?: MockScenarioName;
  onEvent?: (event: MockWorldEvent) => void;
};

export const createMockRescueScenario = (
  options: MockRescueScenarioOptions = {},
): MockRescueScenario => {
  const world = new MockWorld({
    dynamicRescue: options.name === "dynamic_rescue",
    onEvent: options.onEvent,
  });
  const robot = new MockRobot(world, "Start");
  return { world, robot };
};
