import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type DeviceGroup = "all" | "attention" | "consoles" | "media" | "computers" | "smartHome";

type State = { search: string; group: DeviceGroup };

export const devicesFilterSlice = createSlice({
  name: "devicesFilter",
  initialState: { search: "", group: "all" } as State,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    groupChanged(state, action: PayloadAction<DeviceGroup>) {
      state.group = action.payload;
    },
  },
  selectors: {
    selectSearch: (state) => state.search,
    selectGroup: (state) => state.group,
  },
});

export const { searchChanged, groupChanged } = devicesFilterSlice.actions;
export const { selectSearch, selectGroup } = devicesFilterSlice.selectors;
