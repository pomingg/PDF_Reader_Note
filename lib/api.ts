import { NextResponse } from "next/server";
import { HttpError } from "./library";

/** Wrap a route handler so thrown HttpErrors become JSON error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error(err);
      return NextResponse.json({ error: "伺服器錯誤" }, { status: 500 });
    }
  };
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export type IdContext = { params: Promise<{ id: string }> };
