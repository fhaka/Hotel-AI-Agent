import { describe, expect, it } from "vitest";
import { parseList, parsePriceToCents, parseRoomNumbers } from "@/lib/onboarding/parsing";
import { nextStep, readCompletedSteps, resumeStep, stepsFor } from "@/lib/onboarding/steps";

describe("parsePriceToCents", () => {
  it.each([
    ["120", 12000],
    ["120.5", 12050],
    ["120.50", 12050],
    ["99,90", 9990],
    ["1,250.00", 125000],
    ["1.250,50", 125050],
    [" 80 ", 8000],
    ["0", 0],
  ])("%s -> %d", (input, cents) => expect(parsePriceToCents(input)).toBe(cents));

  it.each(["", "abc", "-5", "1.234", "12.345", "1e3", "100000000"])("rejects %j", (input) =>
    expect(parsePriceToCents(input)).toBeNull(),
  );
});

describe("parseRoomNumbers", () => {
  it("expands ranges and keeps explicit numbers", () => {
    expect(parseRoomNumbers("101-103, 201, A1")).toEqual({ rooms: ["101", "102", "103", "201", "A1"] });
  });
  it("keeps zero padding in ranges", () => {
    expect(parseRoomNumbers("01-03")).toEqual({ rooms: ["01", "02", "03"] });
  });
  it.each([
    ["", "Enter at least one room number"],
    ["105-101", "goes backwards"],
    ["1-500", "too large"],
    ["101, 101", "listed twice"],
    ["101-103, 102", "listed twice"],
    ["<script>", "not a valid room number"],
  ])("rejects %j", (input, message) => {
    const result = parseRoomNumbers(input);
    expect("error" in result && result.error).toContain(message);
  });
});

describe("parseList", () => {
  it("splits, trims and de-duplicates", () => {
    expect(parseList("Wi-Fi, Balcony,\nWi-Fi, , Minibar")).toEqual(["Wi-Fi", "Balcony", "Minibar"]);
  });
});

describe("steps", () => {
  it("only hotels get the hotel step", () => {
    expect(stepsFor("hotel")).toEqual(["company", "operations", "hotel", "review"]);
    expect(stepsFor("restaurant")).toEqual(["company", "operations", "review"]);
  });
  it("computes next and resume steps", () => {
    expect(nextStep("hotel", "operations")).toBe("hotel");
    expect(nextStep("restaurant", "operations")).toBe("review");
    expect(resumeStep("hotel", ["company"])).toBe("operations");
    expect(resumeStep("hotel", ["company", "operations"])).toBe("hotel");
    expect(resumeStep("hotel", ["company", "operations", "hotel"])).toBe("review");
  });
  it("reads completed steps defensively", () => {
    expect(readCompletedSteps({ completed_steps: ["company", 3] })).toEqual(["company"]);
    expect(readCompletedSteps(null)).toEqual([]);
    expect(readCompletedSteps({ completed_steps: "x" })).toEqual([]);
  });
});
