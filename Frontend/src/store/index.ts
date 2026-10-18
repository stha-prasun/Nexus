import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/store/slices/authSlice';
import membersReducer from '@/store/slices/membersSlice';
import orgReducer from '@/store/slices/orgSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    org: orgReducer,
    members: membersReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
