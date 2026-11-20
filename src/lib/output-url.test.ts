import { expect, test, vi } from "vitest";
import { DOWNLOAD_HANDOFF_MS, OutputUrlOwner } from "./output-url";

test("retired output URL survives download handoff then releases exactly once", () => {
  vi.useFakeTimers();
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    const owner = new OutputUrlOwner();
    expect(owner.replace(new Blob(["first"]))).toBe("blob:first");
    expect(owner.replace(new Blob(["second"]))).toBe("blob:second");
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_HANDOFF_MS);
    expect(revoke.mock.calls).toEqual([["blob:first"]]);
    owner.clear(); owner.clear();
    vi.advanceTimersByTime(DOWNLOAD_HANDOFF_MS);
    expect(revoke.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
    expect(create).toHaveBeenCalledTimes(2);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});