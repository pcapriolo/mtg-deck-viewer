import { describe, it, expect, vi } from "vitest";
import { deleteTweet } from "../twitter";

function mockWriter(behavior: "success" | "404" | "429" | "error") {
  const mock = {
    v2: {
      deleteTweet: vi.fn(),
    },
  };
  switch (behavior) {
    case "success":
      mock.v2.deleteTweet.mockResolvedValue({ data: { deleted: true } });
      break;
    case "404":
      mock.v2.deleteTweet.mockRejectedValue({ code: 404 });
      break;
    case "429":
      mock.v2.deleteTweet.mockRejectedValue({ code: 429 });
      break;
    case "error":
      mock.v2.deleteTweet.mockRejectedValue(new Error("Unknown error"));
      break;
  }
  return mock;
}

describe("deleteTweet", () => {
  it("returns true on successful deletion", async () => {
    const writer = mockWriter("success");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(true);
    expect(writer.v2.deleteTweet).toHaveBeenCalledWith("123");
  });

  it("returns true when tweet already gone (404)", async () => {
    const writer = mockWriter("404");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(true);
  });

  it("returns false when rate limited (429)", async () => {
    const writer = mockWriter("429");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(false);
  });

  it("returns false on unknown error", async () => {
    const writer = mockWriter("error");
    const result = await deleteTweet(writer as any, "123");
    expect(result).toBe(false);
  });
});
