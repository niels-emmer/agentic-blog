import { NextResponse } from 'next/server';

import { openApiSpec } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

/**
 * Serves the OpenAPI 3.0 spec for the content API at the conventional
 * /openapi.json path so agents can discover the API contract without probing.
 */
export function GET() {
  return NextResponse.json(openApiSpec, {
    headers: { 'Content-Type': 'application/json' },
  });
}