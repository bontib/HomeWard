import type {
  ConfirmEmailAlertsResponse,
  NotificationActionResponse,
  NotificationLinkResponse,
  NotificationLinkView,
  NotificationSettings,
  NotificationSettingsResponse,
  UnsubscribeEmailAlertsResponse,
} from "@/lib/contracts";
import { api } from "@/store/api";

type LinkArgs = { purpose: NotificationLinkView["purpose"]; token: string };

export const notificationsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getNotificationSettings: build.query<NotificationSettings, void>({
      query: () => "notifications",
      transformResponse: (response: NotificationSettingsResponse) => response.settings,
      providesTags: ["Notifications"],
    }),
    setEmailAlerts: build.mutation<NotificationActionResponse, { enabled: boolean }>({
      query: (body) => ({ url: "notifications/email", method: "PUT", body }),
      invalidatesTags: ["Notifications"],
    }),
    sendTestEmail: build.mutation<NotificationActionResponse, void>({
      query: () => ({ url: "notifications/test", method: "POST", body: {} }),
      invalidatesTags: ["Notifications"],
    }),
    // The landing pages are public and read-only: a GET never changes anything.
    getNotificationLink: build.query<NotificationLinkView, LinkArgs>({
      query: ({ purpose, token }) => ({ url: "notifications/link", params: { purpose, token } }),
      transformResponse: (response: NotificationLinkResponse) => response.link,
    }),
    confirmEmailAlerts: build.mutation<ConfirmEmailAlertsResponse, { token: string }>({
      query: (body) => ({ url: "notifications/confirm", method: "POST", body }),
    }),
    unsubscribeEmailAlerts: build.mutation<UnsubscribeEmailAlertsResponse, { token: string }>({
      query: (body) => ({ url: "notifications/unsubscribe", method: "POST", body }),
    }),
  }),
});

export const {
  useGetNotificationSettingsQuery,
  useSetEmailAlertsMutation,
  useSendTestEmailMutation,
  useGetNotificationLinkQuery,
  useConfirmEmailAlertsMutation,
  useUnsubscribeEmailAlertsMutation,
} = notificationsApi;
