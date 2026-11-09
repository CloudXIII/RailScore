import { describe, expect, it } from "vitest";
import type { ScheduledService } from "@/shared/scheduled-service";
import { earlierDaysTrain, parseEarlierDaysQuery } from "./earlier-days-query";

const train = earlierDaysTrain(
  {
    originCrs: "LIV",
    destinationCrs: "MIA",
    publicDeparture: "1000",
    publicArrival: "1058",
    operatorCode: "NT",
    rids: [],
    days: ["weekdays"],
    variants: [
      {
        originCrs: "LIV",
        destinationCrs: "MAN",
        publicDeparture: "1002",
        publicArrival: "1050",
        runCount: 1,
        rids: [],
      },
    ],
  },
  "weekdays",
);

const body = {
  fromCrs: "LIV",
  toCrs: "MCO",
  days: "weekdays",
  periodDays: 30,
  trains: [train],
  runsOf: train.key,
};

describe("parseEarlierDaysQuery", () => {
  it("sends each train with the schedules folded into it", () => {
    expect(train).toEqual({
      key: "1000-1058-NT-LIV-MIA",
      operatorCode: "NT",
      legs: [
        {
          originCrs: "LIV",
          destinationCrs: "MIA",
          publicDeparture: "1000",
          publicArrival: "1058",
        },
        {
          originCrs: "LIV",
          destinationCrs: "MAN",
          publicDeparture: "1002",
          publicArrival: "1050",
        },
      ],
    });
    expect(parseEarlierDaysQuery(JSON.parse(JSON.stringify(body)))).toEqual(
      body,
    );
  });

  it("refuses a request out of shape or too large", () => {
    expect(parseEarlierDaysQuery({ ...body, periodDays: 7 })).toBeUndefined();
    expect(parseEarlierDaysQuery({ ...body, fromCrs: "liv" })).toBeUndefined();
    expect(
      parseEarlierDaysQuery({
        ...body,
        trains: [
          { ...train, legs: [{ ...train.legs[0], publicDeparture: "2460" }] },
        ],
      }),
    ).toBeUndefined();
    const spread = Array.from({ length: 16 }, (_, index) => ({
      ...train,
      key: `t${index}`,
      legs: [
        {
          originCrs: "LIV",
          destinationCrs: "MIA",
          publicDeparture: `${String(index).padStart(2, "0")}00`,
        },
      ],
    }));
    expect(parseEarlierDaysQuery({ ...body, trains: spread })).toBeDefined();
    expect(
      parseEarlierDaysQuery({
        ...body,
        trains: [
          ...spread,
          {
            ...train,
            key: "x",
            legs: [{ ...train.legs[0], publicDeparture: "2200" }],
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("gives a train after midnight from the next night's list its own day types", () => {
    const service: ScheduledService = {
      originCrs: "VIC",
      destinationCrs: "LIT",
      publicDeparture: "0002",
      publicArrival: "0135",
      operatorCode: "SN",
      rids: [],
      days: ["sunday"],
    };
    const sunday = earlierDaysTrain(service, "saturday");
    expect(sunday.days).toEqual(["sunday"]);
    expect(
      parseEarlierDaysQuery({ ...body, days: "saturday", trains: [sunday] })
        ?.trains[0]?.days,
    ).toEqual(["sunday"]);
    expect(
      parseEarlierDaysQuery({
        ...body,
        trains: [{ ...sunday, days: ["friday"] }],
      }),
    ).toBeUndefined();
    expect(
      earlierDaysTrain({ ...service, days: ["saturday"] }, "saturday").days,
    ).toBeUndefined();
    expect(earlierDaysTrain(service, "all").days).toBeUndefined();
  });
});
