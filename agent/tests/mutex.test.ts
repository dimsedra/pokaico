import { describe, it, expect } from "vitest";
import { withTopicLock } from "../src/memory/mutex";

describe("withTopicLock", () => {
  it("runs the function and returns its result", async () => {
    const result = await withTopicLock("test-topic", async () => 42);
    expect(result).toBe(42);
  });

  it("serializes concurrent calls to the same topic", async () => {
    const order: number[] = [];

    const p1 = withTopicLock("same", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    const p2 = withTopicLock("same", async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("allows parallel execution for different topics", async () => {
    const order: number[] = [];

    await Promise.all([
      withTopicLock("topic-a", async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push("a");
      }),
      withTopicLock("topic-b", async () => {
        order.push("b");
      }),
    ]);

    expect(order).toEqual(["b", "a"]);
  });

  it("cleans up the lock after completion", async () => {
    await withTopicLock("cleanup", () => Promise.resolve());
    const result = await withTopicLock("cleanup", () => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("cleans up the lock even on rejection", async () => {
    await expect(
      withTopicLock("error-topic", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    const result = await withTopicLock("error-topic", () => "recovered");
    expect(result).toBe("recovered");
  });

  it("throws if fn is not a function", async () => {
    await expect(
      withTopicLock("invalid", null as unknown as () => Promise<void>),
    ).rejects.toThrow();
  });
});