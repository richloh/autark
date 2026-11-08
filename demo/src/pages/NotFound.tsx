import { Compass } from 'lucide-react';
import { Page } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <Page>
      <EmptyState icon={Compass} title="Page not found" description="The page you're looking for doesn't exist or the resource was deleted." action={<Button variant="primary" to="/dashboard">Go to dashboard</Button>} />
    </Page>
  );
}
