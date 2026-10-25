// Shared ports and URLs for the throwaway stack that global setup starts.
export const PORTS = { db: 54330, nvd: 54331, smtp: 54332, sinkHttp: 54333, web: 3100 };
export const BASE_URL = `http://127.0.0.1:${PORTS.web}`;
export const DATABASE_URL = `postgresql://homeguard:homeguard@127.0.0.1:${PORTS.db}/homeguard_e2e`;

/** True in the second, short pass that runs the worker without any SMTP settings. */
export const SMTP_OFF = process.env.E2E_SMTP === "off";
export const MAIL_SINK_URL = `http://127.0.0.1:${PORTS.sinkHttp}`;
