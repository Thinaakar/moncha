import { proxyWorkerApi } from '@/lib/worker-api';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyWorkerApi(req, `/api/v1/schedules/${encodeURIComponent(id)}`, 'DELETE');
}