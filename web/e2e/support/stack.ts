// Shared ports and URLs for the throwaway stack that global setup starts.
export const PORTS = { db: 54330, nvd: 54331, web: 3100 };
export const BASE_URL = `http://127.0.0.1:${PORTS.web}`;
export const DATABASE_URL = `postgresql://homeward:homeward@127.0.0.1:${PORTS.db}/homeward_e2e`;
