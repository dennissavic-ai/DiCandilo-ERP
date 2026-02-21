import { PageHeader } from '../components/ui/PageHeader';

export function NotFoundPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="404 — Page Not Found" subtitle="The page you are looking for does not exist." />
      <div className="card">
        <div className="card-body py-16 text-center text-steel-400">
          <p className="text-sm">This module is under active development.</p>
        </div>
      </div>
    </div>
  );
}
