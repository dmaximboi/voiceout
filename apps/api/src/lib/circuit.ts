type Breaker = { fails: number; openUntil: number };

const breakers = new Map<string, Breaker>();

export function circuitAllow(name: string) {
  const b = breakers.get(name);
  if (!b) return true;
  if (Date.now() < b.openUntil) return false;
  return true;
}

export function circuitOk(name: string) {
  breakers.set(name, { fails: 0, openUntil: 0 });
}

export function circuitFail(name: string, openMs = 15_000) {
  const prev = breakers.get(name) ?? { fails: 0, openUntil: 0 };
  const fails = prev.fails + 1;
  breakers.set(name, {
    fails,
    openUntil: fails >= 3 ? Date.now() + openMs : 0,
  });
}
