import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const request = useRef(0);
  const run = useCallback(async () => {
    const currentRequest = ++request.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      if (currentRequest === request.current) setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      if (currentRequest === request.current) setState({ loading: false, data: null, error });
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => { run(); return () => { request.current += 1; }; }, [run]);
  return { ...state, reload: run };
}
