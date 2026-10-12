import { Button } from '@/components/ui/button';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  decremented,
  incremented,
  incrementedBy,
} from '@/store/slices/counterSlice';

export function HomePage() {
  const count = useAppSelector((state) => state.counter.value);
  const dispatch = useAppDispatch();

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Nexus
      </h1>
      <p className="text-muted-foreground">
        Tailwind CSS, React Router, Redux Toolkit, and shadcn/ui are ready.
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => dispatch(decremented())}
          aria-label="Decrement"
        >
          −
        </Button>
        <span className="w-12 text-2xl font-medium tabular-nums">{count}</span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => dispatch(incremented())}
          aria-label="Increment"
        >
          +
        </Button>
      </div>
      <Button variant="secondary" onClick={() => dispatch(incrementedBy(5))}>
        Add 5
      </Button>
    </section>
  );
}
