export function BrandLoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading WENDAXY portfolio"
      className="min-h-dvh w-full flex flex-col items-center justify-center px-6 bg-[#FAF8F3] dark:bg-[#0A120F] text-[#18221D] dark:text-[#F4F1EA]"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="space-y-1.5">
          <p className="font-display text-3xl sm:text-4xl font-semibold tracking-[0.08em] text-[#1B4332] dark:text-[#F4F1EA]">
            WENDAXY
          </p>
          <p className="text-xs tracking-wide text-[#5B6B63] dark:text-[#8E9F96]">
            Loading portfolio...
          </p>
        </div>
        <div className="w-36 h-1 rounded-full overflow-hidden bg-[#DFD5C3]/80 dark:bg-[#1E2E26]">
          <div className="h-full w-1/2 rounded-full bg-[#1B4332] dark:bg-[#52A58C] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
