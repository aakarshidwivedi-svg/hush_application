import type { Response } from 'express';

export interface PageInfo {
  nextCursor: string | null;
}

/** Consistent success envelope: `{ data }` or `{ data, page }`. */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

export function okPage<T>(res: Response, data: T[], page: PageInfo): void {
  res.status(200).json({ data, page });
}
