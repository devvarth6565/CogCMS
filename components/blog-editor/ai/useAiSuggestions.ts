'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AiRequestError,
  fetchAiStatus,
  requestAiSuggestions,
  type AiResultFor,
  type AiStatus,
} from '@/lib/ai/client';
import type { AiDraft, AiSuggestionKind } from '@/lib/validation/ai-suggestions';

/** Null while checking. If the check itself fails, the first request explains why. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchAiStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ enabled: true, models: [] });
      });
    return () => controller.abort();
  }, []);
  return status;
}

type RequestState<K extends AiSuggestionKind> = {
  result: AiResultFor<K> | null;
  loading: boolean;
  error: string | null;
};

export type SuggestionRequest<K extends AiSuggestionKind> = RequestState<K> & {
  run: (draft: AiDraft) => void;
  cancel: () => void;
};

/**
 * One request at a time per kind. A new run, cancel() or unmount aborts the one in flight,
 * and earlier results are kept until new ones arrive.
 */
export function useSuggestionRequest<K extends AiSuggestionKind>(kind: K): SuggestionRequest<K> {
  const [state, setState] = useState<RequestState<K>>({
    result: null,
    loading: false,
    error: null,
  });
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(
    (draft: AiDraft) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState((current) => ({ ...current, loading: true, error: null }));
      requestAiSuggestions(kind, draft, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setState({ result, loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof AiRequestError
              ? error.message
              : 'The assistant could not answer. Try again.';
          setState((current) => ({ ...current, loading: false, error: message }));
        });
    },
    [kind],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((current) => ({ ...current, loading: false }));
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, run, cancel };
}
