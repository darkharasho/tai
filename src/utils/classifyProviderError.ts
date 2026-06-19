export function classifyProviderError(text: string): {
  category: 'auth' | 'rate-limit' | 'permission' | 'network' | 'unknown';
  message: string;
} {
  const t = text.toLowerCase();
  let category: ReturnType<typeof classifyProviderError>['category'] = 'unknown';
  if (/\b401\b|unauthorized|invalid api key|authentication|not logged in/.test(t)) category = 'auth';
  else if (/\b429\b|rate limit|too many requests|quota/.test(t)) category = 'rate-limit';
  else if (/permission denied|forbidden|\b403\b/.test(t)) category = 'permission';
  else if (/econnrefused|etimedout|enotfound|network|getaddrinfo/.test(t)) category = 'network';
  return { category, message: text.trim() };
}
