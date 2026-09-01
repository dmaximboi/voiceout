'use client';

import { useEffect, useState } from 'react';
import { processingCount, subscribeProcessing } from './processing';

export function useProcessing() {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(processingCount());
    return subscribeProcessing(() => setN(processingCount()));
  }, []);
  return n > 0;
}
