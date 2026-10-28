/** How many HSP 5xx responses in a row open the breaker. */
export const CIRCUIT_STREAK = 3;
/** While the breaker is open, callers are told the source is busy and HSP is not called. */
export const CIRCUIT_OPEN_MS = 45_000;

export type Circuit = { streak: number; openUntil: number };

export function freshCircuit(): Circuit {
  return { streak: 0, openUntil: 0 };
}

/** A 2xx closes the streak. A 5xx counts, and the third one opens the breaker. */
export function noteStatus(circuit: Circuit, status: number, now: number): Circuit {
  if (status >= 200 && status < 300) {
    return { streak: 0, openUntil: circuit.openUntil };
  }
  if (status >= 500 && status <= 599) {
    const streak = circuit.streak + 1;
    if (streak >= CIRCUIT_STREAK) {
      return { streak, openUntil: now + CIRCUIT_OPEN_MS };
    }
    return { streak, openUntil: circuit.openUntil };
  }
  return circuit;
}

export function circuitOpen(circuit: Circuit, now: number): boolean {
  return now < circuit.openUntil;
}

let state = freshCircuit();

export function hspCircuitOpen(now = Date.now()): boolean {
  return circuitOpen(state, now);
}

export function recordHspStatus(status: number, now = Date.now()): void {
  state = noteStatus(state, status, now);
}

export function resetHspCircuit(): void {
  state = freshCircuit();
}
