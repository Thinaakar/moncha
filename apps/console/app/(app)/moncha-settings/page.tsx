import type { Metadata } from 'next';
import { MonchaSettingsView } from './moncha-settings-view';

export const metadata: Metadata = { title: 'MonCha settings' };

export default function MonchaSettingsPage() {
  return <MonchaSettingsView />;
}
