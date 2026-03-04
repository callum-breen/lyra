import { TRPCError } from "@trpc/server";
import { Prisma } from "../../generated/prisma/client";

export function notFound(message = "Resource not found"): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message });
}

export function badRequest(message: string, cause?: unknown): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message, cause });
}

export function toTRPCError(err: unknown): TRPCError {
  // Zod / tRPC will handle input parsing errors before resolver execution.
  if (err instanceof TRPCError) return err;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // https://www.prisma.io/docs/orm/reference/error-reference
    switch (err.code) {
      case "P2025": // Record not found
        return new TRPCError({
          code: "NOT_FOUND",
          message: "Resource not found",
          cause: err,
        });
      case "P2002": // Unique constraint failed
        return new TRPCError({
          code: "CONFLICT",
          message: "Conflict",
          cause: err,
        });
      case "P2003": // Foreign key constraint failed
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid reference",
          cause: err,
        });
      case "P2000": // Value too long for column type
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid value",
          cause: err,
        });
      default:
        return new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database error",
          cause: err,
        });
    }
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    cause: err,
  });
}

