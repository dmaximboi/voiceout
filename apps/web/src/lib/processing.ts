type Listener = () => void;

let count = 0;
const listeners = new Set<Listener>();

export function processingCount() {
  return count;
}

export function subscribeProcessing(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

export async function withProcessing<T>(fn: () => Promise<T>): Promise<T> {
  count += 1;
  emit();
  try {
    return await fn();
  } finally {
    count = Math.max(0, count - 1);
    emit();
  }
}
