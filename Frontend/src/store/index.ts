import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/store/slices/authSlice';
import membersReducer from '@/store/slices/membersSlice';
import orgReducer from '@/store/slices/orgSlice';
import projectsReducer from '@/store/slices/projectsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    org: orgReducer,
    members: membersReducer,
    projects: projectsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
