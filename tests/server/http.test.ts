import { describe, expect, it } from "vitest";
import { lanUrls } from "../../server/http";

describe("lanUrls (final review minor)", () => {
  it("lists every non-internal IPv4 address", () => {
    const ifaces = {
      lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
      eth0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }, { family: "IPv6", internal: false, address: "fe80::1" }],
      wlan0: [{ family: "IPv4", internal: false, address: "10.0.0.5" }],
    };
    expect(lanUrls(ifaces as never, 3000)).toEqual(["http://192.168.1.20:3000", "http://10.0.0.5:3000"]);
    expect(lanUrls({}, 3000)).toEqual(["http://localhost:3000"]);
  });
});
