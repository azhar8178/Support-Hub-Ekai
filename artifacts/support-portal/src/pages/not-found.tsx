export default function NotFoundPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center bg-stone-50 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-[#0F1F3D]">404</h1>
      <p className="mt-2 font-medium text-stone-600">Page not found.</p>
      <p className="mt-4 text-sm text-stone-500">
        The page you are looking for doesn't exist or has been moved.
      </p>
    </div>
  );
}
