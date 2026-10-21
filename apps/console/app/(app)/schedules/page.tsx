import type { Metadata } from 'next';
import { SchedulesView } from './schedules-view';

export const metadata: Metadata = { title: 'Target region schedule' };

export default function SchedulesPage() {
  return <SchedulesView />;
}
