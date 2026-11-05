/**
 * HSP names the Elizabeth line's own platforms with codes of its own, where Darwin gives the
 * station's usual code: Paddington's Elizabeth line platforms are PAA in HSP and PAD in
 * Darwin. Asked for PAD, HSP lists the Great Western trains and none of the Elizabeth line
 * ones. Read from HSP runs of the Abbey Wood and Shenfield branches (October 2026). Custom
 * House, Tottenham Court Road, Stratford and the stations on the branches have the same code
 * in both. Thameslink, the Overground, Merseyrail and Glasgow's low-level lines use Darwin's.
 */
const HSP_ELIZABETH_LINE: Readonly<Record<string, string>> = {
  ABW: "ABX",
  WWC: "WOW",
  CWX: "CWF",
  ZLW: "WCC",
  LST: "LIX",
  ZFD: "FAC",
  BDS: "BSZ",
  PAD: "PAA",
};

const DARWIN_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(HSP_ELIZABETH_LINE).map(([darwin, hsp]) => [hsp, darwin]),
);

const ELIZABETH_LINE = "XR";

/** The station code HSP files a train of this operator under. */
export function hspStationCode(crs: string, operatorCode: string): string {
  return operatorCode === ELIZABETH_LINE
    ? (HSP_ELIZABETH_LINE[crs] ?? crs)
    : crs;
}

/** Darwin's code for a station code HSP gave. No other station uses HSP's own codes. */
export function darwinStationCode(code: string): string {
  return DARWIN_CODE[code] ?? code;
}
