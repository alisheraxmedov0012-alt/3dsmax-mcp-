import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, describeError, isAuthError } from '../api/client';
import { createSingleFlight } from '../util/singleFlight';

export type AsyncStatus = 'idle' | 'working' | 'ok' | 'error';

export interface AsyncActionState {
  status: AsyncStatus;
  message: string;
  /** True when the last failure could plausibly succeed on retry. */
  retryable: boolean;
  /** True when the last failure was an authentication problem (401). */
  authRequired: boolean;
  /** Human-readable wait hint from a 429/503 (seconds), if any. */
  retryAfter: number | null;
}

const IDLE: AsyncActionState = {
  status: 'idle',
  message: '',
  retryable: false,
  authRequired: false,
  retryAfter: null,
};

/**
 * Runs an async action while preventing duplicate submissions and exposing a
 * loading/error/retry state to the UI.
 *
 * Two guarantees the UX depends on:
 * * a second call while the action is in flight is ignored (no double submit);
 * * success is only reported **after** the action resolves — the component never
 *   shows a fake success while a request is still pending.
 *
 * The `onSuccess` handler receives the resolved value so callers can update the
 * rest of their state only once the server has actually confirmed.
 */
export function useAsyncAction<T>(
  run: () => Promise<T>,
  options: { successMessage?: string } = {},
) {
  const [state, setState] = useState<AsyncActionState>(IDLE);
  const [lastResult, setLastResult] = useState<T | null>(null);
  const flight = useRef(createSingleFlight());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const execute = useCallback(
    async (onSuccess?: (value: T) => void, workingMessage = 'Bajarilmoqda…') => {
      const outcome = await flight.current.run(async () => {
        setState({ ...IDLE, status: 'working', message: workingMessage });
        try {
          const value = await run();
          if (!mounted.current) {
            return value;
          }
          setLastResult(value);
          onSuccess?.(value);
          setState({
            ...IDLE,
            status: 'ok',
            message: options.successMessage ?? 'Bajarildi.',
          });
          return value;
        } catch (error) {
          if (!mounted.current) {
            return null;
          }
          const retryAfter = error instanceof ApiRequestError ? error.retryAfter : null;
          const retryable = error instanceof ApiRequestError ? error.retryable : true;
          setState({
            status: 'error',
            message: describeError(error),
            retryable,
            authRequired: isAuthError(error),
            retryAfter,
          });
          return null;
        }
      });

      // A skipped run means the action was already in flight; return nothing.
      return outcome.skipped ? null : outcome.value;
    },
    [run, options.successMessage],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, execute, reset, result: lastResult, isWorking: state.status === 'working' };
}
