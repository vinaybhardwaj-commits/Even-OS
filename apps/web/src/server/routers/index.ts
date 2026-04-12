import { router } from '../trpc';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { profileRouter } from './profile';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  profile: profileRouter,
});

export type AppRouter = typeof appRouter;
