import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { loadRepliedConversations, appendRepliedConversation } from "../bot";

vi.mock("node:fs");

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadRepliedConversations", () => {
  it("returns conversation IDs from file when under the limit", () => {
    mockFs.readFileSync = vi.fn().mockReturnValue("conv-a\nconv-b\nconv-c\n");
    const ids = loadRepliedConversations("./replied.txt", 500);
    expect(ids).toEqual(["conv-a", "conv-b", "conv-c"]);
  });

  it("returns empty array when file does not exist", () => {
    mockFs.readFileSync = vi.fn().mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });
    const ids = loadRepliedConversations("./replied.txt", 500);
    expect(ids).toEqual([]);
  });

  it("filters out blank lines from the file", () => {
    mockFs.readFileSync = vi.fn().mockReturnValue("conv-a\n\nconv-b\n\n");
    const ids = loadRepliedConversations("./replied.txt", 500);
    expect(ids).toEqual(["conv-a", "conv-b"]);
  });

  it("rotates to last maxLines entries and rewrites file when over limit", () => {
    // Build a file with 10 lines
    const allLines = Array.from({ length: 10 }, (_, i) => `conv-${i}`).join("\n") + "\n";
    mockFs.readFileSync = vi.fn().mockReturnValue(allLines);
    mockFs.writeFileSync = vi.fn();

    const ids = loadRepliedConversations("./replied.txt", 5);

    // Should keep only the last 5 entries
    expect(ids).toEqual(["conv-5", "conv-6", "conv-7", "conv-8", "conv-9"]);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "./replied.txt",
      "conv-5\nconv-6\nconv-7\nconv-8\nconv-9\n"
    );
  });

  it("does not rewrite file when at or under the limit", () => {
    mockFs.readFileSync = vi.fn().mockReturnValue("conv-a\nconv-b\n");
    mockFs.writeFileSync = vi.fn();

    loadRepliedConversations("./replied.txt", 5);

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("returns empty array when file is empty", () => {
    mockFs.readFileSync = vi.fn().mockReturnValue("");
    const ids = loadRepliedConversations("./replied.txt", 500);
    expect(ids).toEqual([]);
  });
});

describe("appendRepliedConversation", () => {
  it("appends the conversation ID followed by a newline", () => {
    mockFs.appendFileSync = vi.fn();
    appendRepliedConversation("./replied.txt", "conv-xyz");
    expect(mockFs.appendFileSync).toHaveBeenCalledWith("./replied.txt", "conv-xyz\n");
  });

  it("does not throw when appendFileSync fails", () => {
    mockFs.appendFileSync = vi.fn().mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(() => appendRepliedConversation("./replied.txt", "conv-xyz")).not.toThrow();
  });
});
