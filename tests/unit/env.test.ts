import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

describe("loadConfig network binding", () => {
  it("binds to loopback on port 8787 by default", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
  });

  it("honors explicit HOST and PORT", () => {
    const config = loadConfig({ HOST: "0.0.0.0", PORT: "9000" });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9000);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
  });
});
