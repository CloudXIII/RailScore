import { describe, expect, it } from "vitest";
import {
  CIRCUIT_OPEN_MS,
  circuitOpen,
  freshCircuit,
  noteStatus,
} from "./circuit";

describe("HSP circuit breaker", () => {
  it("stays closed through two 5xx responses", () => {
    const now = 1_000;
    let circuit = noteStatus(freshCircuit(), 503, now);
    circuit = noteStatus(circuit, 504, now + 10);
    expect(circuitOpen(circuit, now + 10)).toBe(false);
    expect(circuit.streak).toBe(2);
  });

  it("opens on the third consecutive 5xx and stays open for 45 seconds", () => {
    const now = 5_000;
    let circuit = freshCircuit();
    for (const status of [500, 502, 503]) {
      circuit = noteStatus(circuit, status, now);
    }
    expect(circuitOpen(circuit, now)).toBe(true);
    expect(circuitOpen(circuit, now + CIRCUIT_OPEN_MS - 1)).toBe(true);
    expect(circuitOpen(circuit, now + CIRCUIT_OPEN_MS)).toBe(false);
  });

  it("a success clears the streak so the next 5xx does not open it", () => {
    let circuit = noteStatus(freshCircuit(), 503, 0);
    circuit = noteStatus(circuit, 503, 10);
    circuit = noteStatus(circuit, 200, 20);
    circuit = noteStatus(circuit, 503, 30);
    expect(circuit.streak).toBe(1);
    expect(circuitOpen(circuit, 30)).toBe(false);
  });
});
