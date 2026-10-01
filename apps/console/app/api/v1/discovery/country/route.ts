import { proxyWorkerApi } from '@/lib/worker-api';

export async function POST(req: Request) {
  return proxyWorkerApi(req, '/api/v1/discovery/country', 'POST');
}