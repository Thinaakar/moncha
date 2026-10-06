import type { Metadata } from 'next';
import { SchedulesView } from './schedules-view';

export const metadata: Metadata = { title: 'Schedules' };

export default function SchedulesPage() {
  return <SchedulesView />;
}
