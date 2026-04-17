const cardClass =
  'w-[372px] h-[188px] rounded-[18px] px-[18px] py-[14px] gap-[10px] bg-white shadow-sm';

export function PromoCard() {
  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-[28px] leading-[36px] font-semibold tracking-[-0.02em]">
          AI Review Pipeline
        </h2>
        <span className="rounded-full bg-black px-3 py-1 text-xs text-white">beta</span>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Focus on real business risk instead of noisy magic-number suggestions.
      </p>
    </section>
  );
}
