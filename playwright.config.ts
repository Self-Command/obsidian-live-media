import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 180000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:8123', headless: true},
  webServer: {command: 'python3 -m http.server 8123 --bind 127.0.0.1', port: 8123},
  reporter: [['list'], ['html', {open: 'never'}]]
});
