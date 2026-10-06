import { proxyWorkerApi } from '@/lib/worker-api';

export async function GET(req: Request) {
  return proxyWorkerApi(req, '/health');
}