import { useState, useEffect, useCallback } from 'react';

const DEFAULTS = {
  'general.shell': '',
  'general.startDir': '',
  'general.fontSize': 14,
  'general.cursorStyle': 'bar',
  'ai.provider': 'claude',
  'ai.model': 'sonnet',
  'trust.default': 'ask',
  'appearance.gradientBorder': true,
  'appearance.animationSpeed': 20,
};

export function useSettings() {
  const [config, setConfig] = useState<Record<string, any>>(DEFAULTS);

  useEffect(() => {
    window.tai.config.get().then((saved: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...saved });
    });
    const cleanup = window.tai.config.onChanged((updated: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...updated });
    });
    return cleanup;
  }, []);

  const setSetting = useCallback((key: string, value: any) => {
    window.tai.config.set(key, value);
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  return { config, setSetting };
}
