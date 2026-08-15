import { useEffect, useRef, useState } from "react";

/**
 * Keeps items around briefly after they are removed so they can animate out,
 * replacing MUI's `Collapse` inside a `TransitionGroup`.
 *
 * Returns the live items followed by any recently-removed ones, each flagged
 * with `leaving` so the caller can apply an exit animation.
 */
export default function useLeavingList<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs = 400
) {
  const [leaving, setLeaving] = useState<T[]>([]);
  const previous = useRef(items);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const liveKeys = new Set(items.map(getKey));
    const removed = previous.current.filter(
      (item) => !liveKeys.has(getKey(item))
    );
    previous.current = items;

    // An item that came back before its timer fired is live again
    for (const key of liveKeys) {
      const timer = timers.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(key);
      }
    }
    setLeaving((current) =>
      current.filter((item) => !liveKeys.has(getKey(item)))
    );

    if (removed.length === 0) return;

    setLeaving((current) => [...current, ...removed]);
    for (const item of removed) {
      const key = getKey(item);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setLeaving((current) =>
            current.filter((leavingItem) => getKey(leavingItem) !== key)
          );
        }, durationMs)
      );
    }
  }, [items, getKey, durationMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return [
    ...items.map((item) => ({ item, key: getKey(item), leaving: false })),
    ...leaving.map((item) => ({ item, key: getKey(item), leaving: true })),
  ];
}
