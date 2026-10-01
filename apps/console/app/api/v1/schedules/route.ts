import { proxyWorkerApi } from '@/lib/worker-api';

export async function GET(req: Request) {
  return proxyWorkerApi(req, '/api/v1/schedules');
}

export async function POST(req: Request) {
  return proxyWorkerApi(req, '/api/v1/schedules', 'POST');
}

export async function DELETE(req: Request) {
  return proxyWorkerApi(req, '/api/v1/schedules', 'DELETE');
}