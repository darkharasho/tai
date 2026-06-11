import { describe, it, expect } from 'vitest';
import { classifySessionCommand, shouldRootSession, detectPort } from '@/utils/sessionKind';

describe('classifySessionCommand', () => {
  it('classifies dev servers', () => {
    expect(classifySessionCommand('rails server')).toBe('server');
    expect(classifySessionCommand('rails s')).toBe('server');
    expect(classifySessionCommand('npm run dev')).toBe('server');
    expect(classifySessionCommand('npm start')).toBe('server');
    expect(classifySessionCommand('yarn dev')).toBe('server');
    expect(classifySessionCommand('pnpm dev')).toBe('server');
    expect(classifySessionCommand('vite')).toBe('server');
    expect(classifySessionCommand('next dev')).toBe('server');
    expect(classifySessionCommand('python -m http.server 8080')).toBe('server');
    expect(classifySessionCommand('flask run')).toBe('server');
    expect(classifySessionCommand('php -S localhost:8000')).toBe('server');
    expect(classifySessionCommand('docker compose up')).toBe('server');
  });

  it('classifies watchers and follow-tails', () => {
    expect(classifySessionCommand('tail -f log/development.log')).toBe('watch');
    expect(classifySessionCommand('watch -n1 date')).toBe('watch');
    expect(classifySessionCommand('journalctl -fu nginx')).toBe('watch');
    expect(classifySessionCommand('kubectl logs -f pod/web')).toBe('watch');
    expect(classifySessionCommand('npm run watch')).toBe('watch');
    expect(classifySessionCommand('while true; do date; sleep 1; done')).toBe('watch');
  });

  it('classifies agent CLIs', () => {
    expect(classifySessionCommand('claude')).toBe('agent');
    expect(classifySessionCommand('codex --model o3')).toBe('agent');
    expect(classifySessionCommand('gemini')).toBe('agent');
  });

  it('sees through common wrappers', () => {
    expect(classifySessionCommand('sudo rails server')).toBe('server');
    expect(classifySessionCommand('bundle exec rails s')).toBe('server');
    expect(classifySessionCommand('RAILS_ENV=development rails server')).toBe('server');
    expect(classifySessionCommand('npx vite')).toBe('server');
  });

  it('classifies everything else as oneshot', () => {
    expect(classifySessionCommand('ls -la')).toBe('oneshot');
    expect(classifySessionCommand('git status')).toBe('oneshot');
    expect(classifySessionCommand('npm install')).toBe('oneshot');
    expect(classifySessionCommand('rails db:migrate')).toBe('oneshot');
    expect(classifySessionCommand('')).toBe('oneshot');
  });
});

describe('shouldRootSession', () => {
  it('roots servers and watchers immediately', () => {
    expect(shouldRootSession('server', 0)).toBe(true);
    expect(shouldRootSession('watch', 0)).toBe(true);
  });

  it('never roots agents (raw mode already docks them)', () => {
    expect(shouldRootSession('agent', 60_000)).toBe(false);
  });

  it('promotes unknown long-runners only after the elapsed threshold', () => {
    expect(shouldRootSession('oneshot', 3_000)).toBe(false);
    expect(shouldRootSession('oneshot', 11_000)).toBe(true);
  });
});

describe('detectPort', () => {
  it('finds localhost ports in output', () => {
    expect(detectPort('* Listening on http://127.0.0.1:3000')).toBe(3000);
    expect(detectPort('ready - started server on http://localhost:5173')).toBe(5173);
    expect(detectPort('Local:   http://localhost:8080/app')).toBe(8080);
  });

  it('returns the first port seen', () => {
    expect(detectPort('on localhost:3000 and 127.0.0.1:3035')).toBe(3000);
  });

  it('returns null when no port appears', () => {
    expect(detectPort('compiling…')).toBeNull();
    expect(detectPort('')).toBeNull();
  });
});
