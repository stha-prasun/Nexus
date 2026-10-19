import { useEffect, useRef, useState } from 'react';
import { useNavigation } from 'react-router';
import { useLoadingBar } from 'react-top-loading-bar';
import { subscribeToRequests } from '@/lib/progress';

/**
 * Drives the shared top loading line: it runs while any API request is in
 * flight or a navigation is pending, and completes once both are quiet.
 * Renders nothing itself — LoadingBarContainer owns the bar element.
 */
export function TopLoadingBar() {
  const { start, complete, getProgress } = useLoadingBar();
  const navigation = useNavigation();
  const [apiActive, setApiActive] = useState(false);
  const showingRef = useRef(false);

  useEffect(
    () => subscribeToRequests((active) => setApiActive(active > 0)),
    [],
  );

  const running = apiActive || navigation.state !== 'idle';

  // Edge-triggered: start/complete are fresh identities on every container
  // render, so the effect keys off `running` alone — never off the methods.
  useEffect(() => {
    if (running === showingRef.current) return;
    showingRef.current = running;
    if (running) start();
    else complete();
  }, [running, start, complete]);

  // The library resets the line ~1.3s after complete(); a request that
  // starts inside that window would leave the line hidden until it ends,
  // so revive it while there is still something to show.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (getProgress() === 0) start();
    }, 400);
    return () => clearInterval(timer);
  }, [running, start, getProgress]);

  return null;
}
