import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigation } from 'react-router';
import { useLoadingBar } from 'react-top-loading-bar';
import { subscribeToRequests } from '@/lib/progress';

/** Every route change shows the line for at least this long. */
const MIN_ROUTE_MS = 500;

/**
 * Drives the shared top loading line: it runs while any API request is in
 * flight, a navigation is pending, or a route change is still inside its
 * minimum window — the last one matters because these routes have no
 * loaders, so a cache-hit navigation resolves before the bar could ever
 * start. Renders nothing itself — LoadingBarContainer owns the element.
 */
export function TopLoadingBar() {
  const { start, complete, getProgress } = useLoadingBar();
  const navigation = useNavigation();
  const location = useLocation();
  const [apiActive, setApiActive] = useState(false);
  const [routeActive, setRouteActive] = useState(false);
  const showingRef = useRef(false);
  const pathRef = useRef(location.pathname);

  useEffect(
    () => subscribeToRequests((active) => setApiActive(active > 0)),
    [],
  );

  // Ref compare, not a first-render flag: StrictMode re-runs effects on
  // mount and would otherwise flash the line before any real navigation.
  useEffect(() => {
    if (pathRef.current === location.pathname) return;
    pathRef.current = location.pathname;
    setRouteActive(true);
    const timer = setTimeout(() => setRouteActive(false), MIN_ROUTE_MS);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  const running = apiActive || routeActive || navigation.state !== 'idle';

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
