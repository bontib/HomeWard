"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useEffect, useState } from "react";
import type { ProductOption } from "@/lib/contracts";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/Field";
import { RadioCards } from "@/components/ui/RadioCards";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/store/api";
import { useSearchProductsQuery } from "./productsApi";

const DEBOUNCE_MS = 300;
const POLL_MS = 1000;
const GIVE_UP_MS = 10_000;
const MIN_LETTERS = 2;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Debounced value: changes only after the user stops typing. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function ProductSearch({
  selectedCpe,
  onSelect,
  onChooseOther,
}: {
  selectedCpe: string | null;
  onSelect: (product: ProductOption) => void;
  /** Called with the typed text when the user adds the device as "Other". */
  onChooseOther: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const query = normalize(useDebounced(text, DEBOUNCE_MS));
  const active = query.length >= MIN_LETTERS;

  const { data, error, refetch, fulfilledTimeStamp, isFetching } = useSearchProductsQuery(query, {
    skip: !active,
  });
  const pending = active && data?.query === query && data.status === "PENDING";

  // Ask again every second while the worker fills the catalogue. Give up after 10 s.
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setTimedOutFor(query), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [pending, query]);
  const timedOut = timedOutFor === query;

  useEffect(() => {
    if (!pending || timedOut) return;
    const timer = setTimeout(() => void refetch(), POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, timedOut, refetch, fulfilledTimeStamp]);

  const products = active && data?.query === query ? data.products : [];
  const searching = active && (isFetching || pending) && !timedOut && products.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Search for the brand or model"
        leadingIcon={<Icon name="search" />}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="For example PlayStation 5"
        autoComplete="off"
        help={text.trim().length > 0 && !active ? "Type at least 2 letters." : undefined}
      />

      <div aria-live="polite" className="flex flex-col gap-3">
        {searching ? (
          <p className="t-body text-ink-muted flex items-center gap-2">
            <Spinner label="Searching" className="size-4" /> Searching…
          </p>
        ) : null}
        {error ? <ErrorText>{errorMessage(error)}</ErrorText> : null}
        {timedOut ? (
          <p className="t-body text-ink-muted">
            Search is taking longer than usual. Try again in a minute.
          </p>
        ) : null}
        {data?.status === "FAILED" && data.query === query ? (
          <p className="t-body text-ink-muted">
            We couldn&apos;t search right now. Try again in a minute.
          </p>
        ) : null}
        {active &&
        !searching &&
        !error &&
        !timedOut &&
        data?.status === "READY" &&
        products.length === 0 ? (
          <p className="t-body text-ink-muted">No matches. You can add it as Other.</p>
        ) : null}
      </div>

      {products.length > 0 ? (
        <RadioCards
          legend="Matching products"
          name="product"
          value={selectedCpe}
          onChange={(cpe) => {
            const match = products.find((p) => p.cpe === cpe);
            if (match) onSelect(match);
          }}
          options={products.map((p) => ({
            value: p.cpe,
            title: p.title,
            description: (
              <>
                {p.vendor}
                {p.latestVersion ? (
                  <>
                    {" · latest version "}
                    <span className="font-mono">{p.latestVersion}</span>
                  </>
                ) : null}
              </>
            ),
          }))}
        />
      ) : null}

      <p className="t-caption flex flex-wrap items-center gap-1">
        Can&apos;t find it?
        <Button variant="quiet" size="sm" onClick={() => onChooseOther(text.trim())}>
          Add it as Other
        </Button>
        We won&apos;t be able to check it yet.
      </p>
    </div>
  );
}
