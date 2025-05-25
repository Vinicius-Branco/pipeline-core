import { setupTestPipeline } from "./setup";

describe("Setup Tests", () => {
  it("should create a pipeline with default configuration", () => {
    const pipeline = setupTestPipeline();
    expect(pipeline).toBeDefined();
    expect(pipeline["visitedSteps"]).toBeDefined();
  });
});
