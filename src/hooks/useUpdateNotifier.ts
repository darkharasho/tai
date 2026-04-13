import { useState, useEffect } from 'react';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export function useUpdateNotifier() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.tai?.update) return;

    const unsubs = [
      window.tai.update.onStatus((status) => {
        if (status === 'checking') setState({ status: 'checking' });
        else if (status === 'up-to-date') setState({ status: 'up-to-date' });
      }),
      window.tai.update.onAvailable((info) => {
        setState({ status: 'available', version: info.version });
        setDismissed(false);
      }),
      window.tai.update.onProgress((progress) => {
        setState({ status: 'downloading', percent: Math.round(progress.percent) });
      }),
      window.tai.update.onDownloaded((info) => {
        setState({ status: 'ready', version: info.version });
        setDismissed(false);
      }),
      window.tai.update.onError((err) => {
        setState({ status: 'error', message: err.message });
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  }, []);

  const install = () => window.tai?.update?.install();
  const check = () => window.tai?.update?.check();
  const dismiss = () => setDismissed(true);

  return { state, dismissed, install, check, dismiss };
}
