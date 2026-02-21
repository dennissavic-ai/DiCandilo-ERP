import { PageHeader } from '../../components/ui/PageHeader';

export function NestingPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Linear Nesting" subtitle="Coming soon" />
      <div className="card">
        <div className="card-body py-16 text-center text-steel-400">
          <p className="text-sm">This module is under active development.</p>
          <div className="mt-6 mx-auto max-w-lg">
            <div className="h-10 w-full rounded bg-steel-100 flex overflow-hidden">
              <div className="h-full bg-blue-400 flex items-center justify-center text-xs text-white font-medium" style={{ width: '40%' }}>Part A</div>
              <div className="h-full bg-green-400 flex items-center justify-center text-xs text-white font-medium" style={{ width: '25%' }}>Part B</div>
              <div className="h-full bg-amber-400 flex items-center justify-center text-xs text-white font-medium" style={{ width: '20%' }}>Part C</div>
              <div className="h-full bg-steel-200 flex items-center justify-center text-xs text-steel-400 font-medium" style={{ width: '15%' }}>Waste</div>
            </div>
            <p className="mt-2 text-xs text-steel-400">Sample linear nesting preview — full optimisation engine coming soon.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
