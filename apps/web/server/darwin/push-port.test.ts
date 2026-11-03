import { describe, expect, it } from "vitest";
import { parsePushPort } from "./push-port";

/** A Kafka message body: one train status, prefixed as the feed sends it. */
const status = `<?xml version="1.0" encoding="utf-8"?><Pport xmlns="http://www.thalesgroup.com/rtti/PushPort/v18" xmlns:ns5="http://www.thalesgroup.com/rtti/PushPort/Forecasts/v4" ts="2026-11-02T22:59:10" version="18.0"><uR updateOrigin="TD"><TS rid="202611026792991" uid="C92991" ssd="2026-11-02"><ns5:LateReason>104</ns5:LateReason><ns5:Location tpl="PBRO" wtd="22:23" ptd="22:23"><ns5:dep at="22:22" atClass="Automatic" src="TD" /><ns5:plat platsrc="A" conf="true">2</ns5:plat></ns5:Location><ns5:Location tpl="FLETTON" wtp="22:25"><ns5:pass at="22:25" src="TRUST" /></ns5:Location><ns5:Location tpl="HNTNGDN" wta="22:36:30" wtd="22:40" pta="22:37" ptd="22:40"><ns5:arr at="22:36" src="TD" /><ns5:dep at="22:39" src="TD" /></ns5:Location><ns5:Location tpl="ARLSEY" wta="23:04:30" wtd="23:05" pta="23:05" ptd="23:05"><ns5:arr et="23:05" src="Darwin" /><ns5:dep et="23:05" src="Darwin" /></ns5:Location></TS></uR></Pport>`;

/** Snapshot style: default namespace on the schedule, `s5:` calls, two documents in one file. */
const snapshot = `<?xml version="1.0" encoding="utf-8"?><pp:Pport xmlns:pp="http://www.thalesgroup.com/rtti/PushPort/v18"><pp:SnapshotId>20261102230000</pp:SnapshotId></pp:Pport><?xml version="1.0" encoding="utf-8"?><Pport xmlns:s5="http://www.thalesgroup.com/rtti/PushPort/Schedules/v5" xmlns="http://www.thalesgroup.com/rtti/PushPort/v18"><sR><schedule rid="202611026782766" uid="C82766" trainId="1E53" ssd="2026-11-02" toc="SN" trainCat="OO"><s5:OR tpl="LNDNBDC" act="TB" ptd="23:07" wtd="23:07" /><s5:PP tpl="LNDNASJ" wtp="23:09" /><s5:IP tpl="ECROYDN" act="T " pta="23:25" ptd="23:26" wta="23:25" wtd="23:26" can="true" /><s5:OPIP tpl="SELHRST" wta="23:28" wtd="23:29" /><s5:DT tpl="BRGHTN" act="TF" pta="00:10" wta="00:10" can="true" /></schedule><schedule rid="202611027000001" uid="Y00001" ssd="2026-11-02" toc="ZZ" isPassengerSvc="false"><s5:OR tpl="BRGHTN" ptd="23:00" wtd="23:00" /></schedule></sR></Pport>`;

describe("parsePushPort", () => {
  it("keeps public calls of a train status with an actual time or platform, and its late reason", () => {
    expect(parsePushPort(status)).toEqual([
      {
        kind: "status",
        rid: "202611026792991",
        serviceDate: "2026-11-02",
        lateReason: "104",
        calls: [
          { tpl: "PBRO", ptd: "2223", atd: "2222", platform: "2" },
          {
            tpl: "HNTNGDN",
            pta: "2237",
            ptd: "2240",
            ata: "2236",
            atd: "2239",
          },
        ],
      },
    ]);
  });

  it("reads a schedule's public calls with their cancellations, across documents", () => {
    expect(parsePushPort(snapshot)).toEqual([
      {
        kind: "schedule",
        rid: "202611026782766",
        serviceDate: "2026-11-02",
        uid: "C82766",
        toc: "SN",
        calls: [
          { tpl: "LNDNBDC", ptd: "2307" },
          { tpl: "ECROYDN", pta: "2325", ptd: "2326", cancelled: true },
          { tpl: "BRGHTN", pta: "0010", cancelled: true },
        ],
      },
    ]);
  });

  it("leaves out a platform Darwin suppresses from public display", () => {
    const suppressed = status.replace(
      '<ns5:plat platsrc="A" conf="true">2</ns5:plat>',
      '<ns5:plat platsup="true" cisPlatsup="true">2</ns5:plat>',
    );
    const [update] = parsePushPort(suppressed);
    expect(update?.calls[0]).toEqual({ tpl: "PBRO", ptd: "2223", atd: "2222" });
  });

  it("keeps a call that has only a platform so far", () => {
    const platformOnly = status.replace(
      '<ns5:dep at="22:22" atClass="Automatic" src="TD" />',
      '<ns5:dep et="22:23" src="Darwin" />',
    );
    const [update] = parsePushPort(platformOnly);
    expect(update?.calls[0]).toEqual({
      tpl: "PBRO",
      ptd: "2223",
      platform: "2",
    });
  });

  it("reads a schedule's cancellation reason", () => {
    const cancelled = snapshot.replace(
      '<s5:DT tpl="BRGHTN" act="TF" pta="00:10" wta="00:10" can="true" /></schedule>',
      '<s5:DT tpl="BRGHTN" act="TF" pta="00:10" wta="00:10" can="true" /><s5:cancelReason tiploc="ECROYDN">526</s5:cancelReason></schedule>',
    );
    expect(parsePushPort(cancelled)[0]).toMatchObject({ cancelReason: "526" });
  });

  it("leaves out an actual time Darwin removed", () => {
    const removed = status.replace(
      '<ns5:arr at="22:36" src="TD" />',
      '<ns5:arr at="22:36" atRemoved="true" src="TD" />',
    );
    const [update] = parsePushPort(removed);
    expect(update?.calls[1]).toEqual({
      tpl: "HNTNGDN",
      pta: "2237",
      ptd: "2240",
      atd: "2239",
    });
  });

  it("returns nothing for a message with neither schedules nor statuses", () => {
    expect(
      parsePushPort(
        '<Pport xmlns="http://www.thalesgroup.com/rtti/PushPort/v18"><uR><deactivated rid="202611026782766" /></uR></Pport>',
      ),
    ).toEqual([]);
  });
});
