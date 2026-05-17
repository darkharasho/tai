import { useState, useEffect, useCallback } from 'react';

const DEFAULTS = {
  'general.shell': '',
  'general.startDir': '',
  'general.fontSize': 14,
  'general.cursorStyle': 'bar',
  'ai.provider': 'claude',
  'ai.model': 'sonnet',
  'claude.model': 'sonnet',
  'claude.effort': 'auto',
  'trust.default': 'ask',
  'ai.expandToolCalls': false,
  'appearance.gradientBorder': true,
  'appearance.animationSpeed': 20,
  'appearance.colorMode': 'high',
  'appearance.cardAccent': 'brackets',
  'appearance.noise': true,
};

export function useSettings() {
  const [config, setConfig] = useState<Record<string, any>>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!window.tai?.config) return;
    window.tai.config.get().then((saved: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...saved });
      setLoaded(true);
    });
    const cleanup = window.tai.config.onChanged((updated: Record<string, any>) => {
      setConfig({ ...DEFAULTS, ...updated });
    });
    return cleanup;
  }, []);

  const setSetting = useCallback((key: string, value: any) => {
    window.tai?.config?.set(key, value);
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  return { config, loaded, setSetting };
}
