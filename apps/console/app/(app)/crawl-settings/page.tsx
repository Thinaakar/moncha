import { CrawlSettingsView } from './crawl-settings-view';

export const metadata = {
  title: 'Crawl & Pipeline Settings | MonCha',
  description: 'Configure dynamic crawl batch sizes, daily website creation limits, outreach quotas, and follow-up schedules.',
};

export default function CrawlSettingsPage() {
  return <CrawlSettingsView />;
}
