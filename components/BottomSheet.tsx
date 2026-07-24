"use client";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-enter fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-2xl border border-hairline bg-sheet px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hairline" aria-hidden />
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-hairline py-2.5 text-sm font-bold text-ink-dim transition-colors duration-150 hover:text-ink cursor-pointer"
        >
          Close
        </button>
      </div>
    </>
  );
}
