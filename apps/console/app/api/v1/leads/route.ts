import { proxyWorkerApi } from '@/lib/worker-api';

export async function GET(req: Request) {
  return proxyWorkerApi(req, '/api/v1/leads');
}

export async function POST(req: Request) {
  return proxyWorkerApi(req, '/api/v1/leads', 'POST');
}
