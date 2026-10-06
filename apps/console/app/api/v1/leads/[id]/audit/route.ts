import { proxyWorkerApi } from '@/lib/worker-api';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyWorkerApi(req, `/api/v1/leads/${encodeURIComponent(id)}/audit`, 'POST');
}