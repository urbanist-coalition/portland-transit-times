"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { CloseIcon, SearchIcon } from "@/components/icons";
import { StopSummary } from "@/types";

import styles from "./stop-search.module.css";

/** Rendering every stop would be slow and useless — nobody scrolls 500 rows. */
const MAX_RESULTS = 30;
/** How many of the top results get their page warmed up ahead of a click. */
const PREFETCH_COUNT = 5;

/**
 * Lower is better. Ranks so that typing a stop number puts that exact stop
 *   first, and typing a street name puts stops starting with it above stops
 *   that merely mention it.
 */
function score(stop: StopSummary, query: string): number | null {
  const code = stop.stopCode.toLowerCase();
  const name = stop.stopName.toLowerCase();

  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  // A match at the start of any word, e.g. "congress" in "Elm at Congress"
  if (
    new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)
  )
    return 3;
  if (name.includes(query)) return 4;
  return null;
}

/** Splits text around the first match so it can be visually emphasised. */
function highlight(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.mark}>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export default function StopSearch({ allStops }: { allStops: StopSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const scored: { stop: StopSummary; rank: number }[] = [];
    for (const stop of allStops) {
      const rank = score(stop, trimmed);
      if (rank !== null) scored.push({ stop, rank });
    }

    return scored
      .sort(
        (a, b) =>
          a.rank - b.rank || a.stop.stopCode.localeCompare(b.stop.stopCode)
      )
      .slice(0, MAX_RESULTS)
      .map(({ stop }) => stop);
  }, [allStops, query]);

  const expanded = open && results.length > 0;

  // Warm up the pages the user is most likely to open next. This replaces the
  //   per-option <Link> the old autocomplete used purely to get prefetching.
  useEffect(() => {
    if (!expanded) return;
    const timeout = setTimeout(() => {
      for (const stop of results.slice(0, PREFETCH_COUNT)) {
        router.prefetch(`/stops/${stop.stopCode}`);
      }
    }, 150);
    return () => clearTimeout(timeout);
  }, [expanded, results, router]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex]);

  function selectStop(stop: StopSummary) {
    setOpen(false);
    router.push(`/stops/${stop.stopCode}`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((index) => (index + 1) % Math.max(results.length, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        setActiveIndex(
          (index) => (index - 1 + results.length) % Math.max(results.length, 1)
        );
        break;
      case "Enter":
        if (expanded && results[activeIndex]) {
          event.preventDefault();
          selectStop(results[activeIndex]);
        }
        break;
      case "Escape":
        if (expanded) {
          setOpen(false);
        } else if (query) {
          setQuery("");
        }
        break;
    }
  }

  const trimmedQuery = query.trim().toLowerCase();

  return (
    <section className={styles.root} ref={rootRef}>
      <h2 className={styles.heading} id={`${listId}-label`}>
        Enter a Stop Number or Name
      </h2>

      <div className={styles.field} data-expanded={expanded}>
        <SearchIcon size={20} className={styles.searchIcon} />
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="e.g. 123 or Congress St"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          role="combobox"
          aria-labelledby={`${listId}-label`}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && results[activeIndex]
              ? `${listId}-${results[activeIndex].stopCode}`
              : undefined
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      {expanded && (
        <ul
          id={listId}
          ref={listRef}
          className={styles.list}
          role="listbox"
          aria-label="Matching stops"
          // Keep focus in the input so the combobox keeps its keyboard state
          onMouseDown={(event) => event.preventDefault()}
        >
          {results.map((stop, index) => (
            <li
              key={stop.stopCode}
              id={`${listId}-${stop.stopCode}`}
              role="option"
              aria-selected={index === activeIndex}
              className={styles.option}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => selectStop(stop)}
            >
              <span className={styles.optionCode}>
                {highlight(stop.stopCode, trimmedQuery)}
              </span>
              <span className={styles.optionName}>
                {highlight(stop.stopName, trimmedQuery)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim() && results.length === 0 && (
        <p className={styles.empty}>No stops match “{query.trim()}”.</p>
      )}
    </section>
  );
}
