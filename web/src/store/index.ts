import { configureStore } from "@reduxjs/toolkit";
import { devicesFilterSlice } from "@/features/devices/devicesFilterSlice";
import { api } from "./api";

// A new store per request on the server; the provider keeps one per browser tab.
export function makeStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      devicesFilter: devicesFilterSlice.reducer,
    },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
