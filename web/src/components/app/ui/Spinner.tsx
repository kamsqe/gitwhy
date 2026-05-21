export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent text-gw-text-dim"
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}
