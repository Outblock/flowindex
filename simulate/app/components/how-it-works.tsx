const STEPS = [
  { num: '01', title: 'Write Code', comment: '// write or pick a template' },
  { num: '02', title: 'Simulate', comment: '// fork mainnet, execute, revert' },
  { num: '03', title: 'Verify & Send', comment: '// check results, then send for real' },
]

export function HowItWorks() {
  return (
    <section className="py-24 px-6 border-t border-zinc-800/50">
      <div className="mx-auto max-w-4xl">
        <div className="text-[10px] text-zinc-600 tracking-[3px] mb-12">// HOW IT WORKS</div>
        <div className="flex items-start justify-between">
          {STEPS.map((step, i) => (
            <div key={step.num} className="flex items-start gap-4 flex-1">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center text-xs text-zinc-500 font-semibold">
                  {step.num}
                </div>
                <h4 className="text-sm font-semibold text-zinc-200">{step.title}</h4>
                <p className="text-[11px] text-zinc-600">{step.comment}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 mt-5 border-t border-dashed border-zinc-800" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
