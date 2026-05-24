/// <reference types="vite/client" />

import type { DbmindApi } from '../shared/types';

declare global {
  interface Window {
    dbmind?: DbmindApi;
  }
}
